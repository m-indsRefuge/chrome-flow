import { registerDeveloperSurface } from "./developer-mode.js";

import {
  WORKSPACE_RUNTIME_CONTRACT,
  appendRuntimeDiagnostic,
  getRuntimeMemorySummary
} from "../core/workspace-runtime-store.js";

import {
  WORKSPACE_MEMORY_CONTRACT,
  getWorkspaceMemorySummary
} from "../core/workspace-memory-store.js";

installLayer2MemoryContractValidationPacketSurface();

function installLayer2MemoryContractValidationPacketSurface() {
  const anchor = document.getElementById("layer2LifecycleValidationPacketSection")
    || document.getElementById("developerDiagnosticsSection")
    || document.getElementById("workspaceSessionControlSection")
    || document.querySelector(".workspace-section");

  if (!anchor || document.getElementById("layer2MemoryContractValidationPacketSection")) return;

  const section = document.createElement("section");
  section.id = "layer2MemoryContractValidationPacketSection";
  section.className = "layer2-memory-contract-validation-packet-section";
  section.innerHTML = `
    <h2>Layer 2 Memory Contract Packet</h2>
    <p class="section-help">Developer-only readout for the active runtime memory and long-term workspace memory boundary. This is read-only and does not migrate runtime authority.</p>
    <div class="workspace-session-actions">
      <button id="prepareLayer2MemoryContractPacketButton" type="button" class="secondary-button">Prepare Memory Contract Packet</button>
      <button id="copyLayer2MemoryContractPacketButton" type="button" class="secondary-button" disabled>Copy Memory Contract Packet</button>
    </div>
    <p id="layer2MemoryContractPacketStatus" class="status-message">Prepare a packet to validate the Layer 2.1A storage boundary.</p>
    <pre id="layer2MemoryContractPacketOutput" class="diagnostic-output"></pre>
  `;

  anchor.insertAdjacentElement("afterend", section);
  registerDeveloperSurface(section);

  document.getElementById("prepareLayer2MemoryContractPacketButton")?.addEventListener("click", prepareLayer2MemoryContractPacket);
  document.getElementById("copyLayer2MemoryContractPacketButton")?.addEventListener("click", copyLayer2MemoryContractPacket);
}

async function prepareLayer2MemoryContractPacket() {
  const packet = await buildLayer2MemoryContractPacket();
  const output = document.getElementById("layer2MemoryContractPacketOutput");
  const status = document.getElementById("layer2MemoryContractPacketStatus");
  const copyButton = document.getElementById("copyLayer2MemoryContractPacketButton");

  if (output) output.textContent = JSON.stringify(packet, null, 2);
  if (status) status.textContent = "Memory contract packet prepared: " + packet.memoryContract.status + ".";
  if (copyButton) copyButton.removeAttribute("disabled");

  await appendRuntimeDiagnostic("info", "layer2_memory_contract_packet_prepared", "Layer 2 memory contract validation packet prepared.", {
    status: packet.memoryContract.status,
    passedCheckCount: packet.memoryContract.passedCheckCount,
    warningCheckCount: packet.memoryContract.warningCheckCount,
    failedCheckCount: packet.memoryContract.failedCheckCount,
    schema: packet.extension.schema
  });
}

async function copyLayer2MemoryContractPacket() {
  const output = document.getElementById("layer2MemoryContractPacketOutput");
  const status = document.getElementById("layer2MemoryContractPacketStatus");

  if (!output?.textContent?.trim()) {
    if (status) status.textContent = "Prepare the memory contract packet before copying.";
    return;
  }

  await navigator.clipboard.writeText(buildClipboardEnvelope(output.textContent));
  if (status) status.textContent = "Memory contract packet copied.";

  await appendRuntimeDiagnostic("info", "layer2_memory_contract_packet_copied", "Layer 2 memory contract validation packet copied.", {
    envelopeFormat: "chrome_flow_packet_envelope_v0.1"
  });
}

async function buildLayer2MemoryContractPacket() {
  const [runtimeSummary, memorySummary] = await Promise.all([
    getRuntimeMemorySummary(),
    getWorkspaceMemorySummary()
  ]);

  const checks = [
    createCheck("runtime_store_boundary_available", runtimeSummary?.contract?.authority === "chrome.storage.local", "Active runtime store boundary is available."),
    createCheck("memory_store_boundary_available", memorySummary?.contract?.authority === "Session DB / IndexedDB", "Long-term memory store boundary is available."),
    createCheck("active_workspace_runtime_readable", Boolean(runtimeSummary?.activeWorkspace?.workspaceId), "Active workspace can be read through the runtime store."),
    createCheck("runtime_source_is_chrome_storage_local", runtimeSummary?.runtimeSourceOfTruth === "chrome.storage.local", "Runtime source of truth remains chrome.storage.local."),
    createCheck("memory_source_is_session_db", memorySummary?.memorySourceOfTruth === "Session DB / IndexedDB", "Long-term memory source of truth is Session DB / IndexedDB."),
    createCheck("memory_records_available", Number(memorySummary?.workspaceRecordCount || 0) > 0, "Workspace memory records are available through the memory store."),
    createCheck("recent_resumable_query_available", Array.isArray(memorySummary?.recentResumableWorkspaceIds), "Recent resumable workspace query is available."),
    createCheck("workspace_library_product_surface_present", Boolean(document.querySelector("[data-product-surface='workspace-library']")), "Workspace Library product surface is present."),
    createCheck("workspace_controls_product_surface_present", Boolean(document.querySelector("[data-product-surface='workspace-controls']")), "Workspace Controls product surface is present."),
    createCheck("two_memory_contract_preserved", isTwoMemoryContractPreserved(runtimeSummary, memorySummary), "Runtime and long-term memory authority are separate and explicit."),
    createCheck("db_not_full_runtime_authority", memorySummary?.memorySourceOfTruth === "Session DB / IndexedDB" && runtimeSummary?.runtimeSourceOfTruth === "chrome.storage.local", "Session DB is long-term memory authority, not active runtime authority."),
    createCheck("algorithmic_layer_memory_path_available", Number(memorySummary?.workspaceRecordCount || 0) > 0, "Algorithmic layer has a long-term memory path through WorkspaceMemoryStore.")
  ];

  const failedChecks = checks.filter((check) => check.status === "fail");
  const warningChecks = checks.filter((check) => check.status === "warn");
  const passedChecks = checks.filter((check) => check.status === "pass");

  return {
    packetType: "Chrome Flow Layer 2 Memory Contract Validation Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "layer2-memory-contract-validation-packet-v0.1"
    },
    source: {
      type: "layer2_memory_contract_validation_packet",
      developerOnly: true,
      readOnly: true,
      validationOnly: true,
      runtimeActionExecuted: false,
      browserProjectionChanged: false,
      sessionDbChanged: false,
      chromeStorageRuntimeChanged: false
    },
    memoryContract: {
      status: failedChecks.length ? "needs_attention" : warningChecks.length ? "accepted_with_warnings" : "ready_for_recent_resume_archive_restore_split",
      passedCheckCount: passedChecks.length,
      warningCheckCount: warningChecks.length,
      failedCheckCount: failedChecks.length,
      checkCount: checks.length,
      checks,
      failedChecks,
      warningChecks
    },
    runtimeStore: runtimeSummary,
    memoryStore: memorySummary,
    contractDefinitions: {
      runtime: WORKSPACE_RUNTIME_CONTRACT,
      memory: WORKSPACE_MEMORY_CONTRACT
    },
    nextDecision: {
      recommendation: failedChecks.length ? "repair_memory_contract_boundary" : "proceed_to_recent_resume_vs_archive_restore_split",
      notes: [
        "This packet validates the storage service boundary, not full Session DB runtime authority.",
        "chrome.storage.local remains active short-term runtime memory.",
        "Session DB remains long-term workspace memory for saved records, Workspace Library, and future algorithmic inputs.",
        "Future modules should call store/service functions instead of scattering direct storage calls."
      ]
    }
  };
}

function createCheck(check, condition, message, severity = "contract") {
  return {
    check,
    status: condition ? "pass" : "fail",
    severity,
    message
  };
}

function isTwoMemoryContractPreserved(runtimeSummary, memorySummary) {
  return runtimeSummary?.contract?.layer === "active_runtime_memory"
    && memorySummary?.contract?.layer === "long_term_workspace_memory"
    && runtimeSummary?.runtimeSourceOfTruth === "chrome.storage.local"
    && memorySummary?.memorySourceOfTruth === "Session DB / IndexedDB";
}

function buildClipboardEnvelope(jsonText) {
  return [
    "CHROME_FLOW_PACKET_START",
    "packetType: Chrome Flow Layer 2 Memory Contract Validation Packet",
    "schema: layer2-memory-contract-validation-packet-v0.1",
    "clipboardFormat: chrome_flow_packet_envelope_v0.1",
    "createdAt: " + new Date().toISOString(),
    "contentType: application/json",
    "",
    jsonText,
    "",
    "CHROME_FLOW_PACKET_END"
  ].join("\n");
}
