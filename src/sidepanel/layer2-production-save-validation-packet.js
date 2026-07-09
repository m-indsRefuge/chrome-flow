import { registerDeveloperSurface } from "./developer-mode.js";

import {
  appendRuntimeDiagnostic,
  getActiveWorkspaceRuntime,
  getRuntimeDiagnostics
} from "../core/workspace-runtime-store.js";

import { getWorkspaceMemoryRecord } from "../core/workspace-memory-store.js";

const MAX_DIAGNOSTICS_TO_SCAN = 200;

installLayer2ProductionSaveValidationPacketSurface();

function installLayer2ProductionSaveValidationPacketSurface() {
  const anchor = document.getElementById("layer2PostResumeVerificationPacketSection")
    || document.getElementById("layer2MemoryContractValidationPacketSection")
    || document.getElementById("layer2LifecycleValidationPacketSection")
    || document.getElementById("developerDiagnosticsSection")
    || document.querySelector(".workspace-section");

  if (!anchor || document.getElementById("layer2ProductionSaveValidationPacketSection")) return;

  const section = document.createElement("section");
  section.id = "layer2ProductionSaveValidationPacketSection";
  section.className = "layer2-production-save-validation-packet-section";
  section.innerHTML = `
    <h2>Layer 2.1C Production Save Validation Packet</h2>
    <p class="section-help">Developer-only readout that verifies the end-user Save Workspace action writes the active runtime workspace into Workspace Library / Session DB. This is read-only.</p>
    <div class="workspace-session-actions">
      <button id="prepareLayer2ProductionSaveValidationPacketButton" type="button" class="secondary-button">Prepare Production Save Packet</button>
      <button id="copyLayer2ProductionSaveValidationPacketButton" type="button" class="secondary-button" disabled>Copy Production Save Packet</button>
    </div>
    <p id="layer2ProductionSaveValidationPacketStatus" class="status-message">Click Save Workspace first, then prepare this packet.</p>
    <pre id="layer2ProductionSaveValidationPacketOutput" class="diagnostic-output"></pre>
  `;

  anchor.insertAdjacentElement("afterend", section);
  registerDeveloperSurface(section);

  document.getElementById("prepareLayer2ProductionSaveValidationPacketButton")?.addEventListener("click", prepareLayer2ProductionSaveValidationPacket);
  document.getElementById("copyLayer2ProductionSaveValidationPacketButton")?.addEventListener("click", copyLayer2ProductionSaveValidationPacket);
}

async function prepareLayer2ProductionSaveValidationPacket() {
  const packet = await buildLayer2ProductionSaveValidationPacket();
  const output = document.getElementById("layer2ProductionSaveValidationPacketOutput");
  const status = document.getElementById("layer2ProductionSaveValidationPacketStatus");
  const copyButton = document.getElementById("copyLayer2ProductionSaveValidationPacketButton");

  if (output) output.textContent = JSON.stringify(packet, null, 2);
  if (status) status.textContent = "Production save packet prepared: " + packet.validation.status + ".";
  if (copyButton) copyButton.removeAttribute("disabled");

  await appendRuntimeDiagnostic("info", "layer2_production_save_validation_packet_prepared", "Layer 2.1C production save validation packet prepared.", {
    status: packet.validation.status,
    passedCheckCount: packet.validation.passedCheckCount,
    warningCheckCount: packet.validation.warningCheckCount,
    failedCheckCount: packet.validation.failedCheckCount,
    schema: packet.extension.schema
  });
}

async function copyLayer2ProductionSaveValidationPacket() {
  const output = document.getElementById("layer2ProductionSaveValidationPacketOutput");
  const status = document.getElementById("layer2ProductionSaveValidationPacketStatus");

  if (!output?.textContent?.trim()) {
    if (status) status.textContent = "Prepare the production save packet before copying.";
    return;
  }

  await navigator.clipboard.writeText(buildClipboardEnvelope(output.textContent));
  if (status) status.textContent = "Production save packet copied.";

  await appendRuntimeDiagnostic("info", "layer2_production_save_validation_packet_copied", "Layer 2.1C production save validation packet copied.", {
    envelopeFormat: "chrome_flow_packet_envelope_v0.1"
  });
}

async function buildLayer2ProductionSaveValidationPacket() {
  const [runtimeWorkspace, diagnostics] = await Promise.all([
    getActiveWorkspaceRuntime(),
    getRuntimeDiagnostics()
  ]);

  const memoryRecord = runtimeWorkspace?.workspaceId ? await getWorkspaceMemoryRecord(runtimeWorkspace.workspaceId) : null;
  const latestProductionSave = findLatestDiagnostic(diagnostics.slice(-MAX_DIAGNOSTICS_TO_SCAN), "workspace_saved_to_workspace_library");
  const latestProductionSaveFailure = findLatestDiagnostic(diagnostics.slice(-MAX_DIAGNOSTICS_TO_SCAN), "workspace_save_to_workspace_library_failed");
  const checks = buildValidationChecks(runtimeWorkspace, memoryRecord, latestProductionSave, latestProductionSaveFailure);
  const failedChecks = checks.filter((check) => check.status === "fail");
  const warningChecks = checks.filter((check) => check.status === "warn");
  const passedChecks = checks.filter((check) => check.status === "pass");

  return {
    packetType: "Chrome Flow Layer 2.1C Production Save Validation Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "layer2-production-save-validation-packet-v0.1"
    },
    source: {
      type: "layer2_production_save_validation_packet",
      developerOnly: true,
      readOnly: true,
      validationOnly: true,
      runtimeActionExecuted: false,
      browserProjectionChanged: false,
      sessionDbChanged: false,
      chromeStorageRuntimeChanged: false
    },
    validation: {
      status: failedChecks.length ? "needs_attention" : warningChecks.length ? "accepted_with_warnings" : "production_save_to_workspace_library_validated",
      passedCheckCount: passedChecks.length,
      warningCheckCount: warningChecks.length,
      failedCheckCount: failedChecks.length,
      checkCount: checks.length,
      checks,
      failedChecks,
      warningChecks
    },
    activeRuntimeWorkspace: summarizeRuntimeWorkspace(runtimeWorkspace),
    workspaceLibraryRecord: summarizeMemoryRecord(memoryRecord),
    latestProductionSaveEvidence: summarizeDiagnostic(latestProductionSave),
    latestProductionSaveFailure: summarizeDiagnostic(latestProductionSaveFailure),
    nextDecision: {
      recommendation: failedChecks.length ? "repair_production_save_to_workspace_library" : "proceed_with_codex_external_validation_and_algorithmic_foundation_gate",
      notes: [
        "This packet verifies that Save Workspace now persists the active runtime workspace into Workspace Library / Session DB.",
        "This packet is read-only and does not perform a save itself.",
        "The Save Workspace action keeps chrome.storage.local as active runtime authority while Session DB remains long-term memory authority."
      ]
    }
  };
}

function buildValidationChecks(runtimeWorkspace, memoryRecord, latestProductionSave, latestProductionSaveFailure) {
  const runtimeTabs = Array.isArray(runtimeWorkspace?.tabs) ? runtimeWorkspace.tabs : [];
  const runtimeJournal = Array.isArray(runtimeWorkspace?.journal) ? runtimeWorkspace.journal : [];
  const runtimeTimeline = Array.isArray(runtimeWorkspace?.timeline) ? runtimeWorkspace.timeline : [];
  const memoryTabs = Array.isArray(memoryRecord?.tabs) ? memoryRecord.tabs : [];
  const memoryJournal = Array.isArray(memoryRecord?.journalEntries) ? memoryRecord.journalEntries : [];
  const memoryTimeline = Array.isArray(memoryRecord?.timelineEvents) ? memoryRecord.timelineEvents : [];

  return [
    createCheck("active_runtime_workspace_exists", Boolean(runtimeWorkspace?.workspaceId), "Active runtime workspace exists."),
    createCheck("production_save_diagnostic_exists", Boolean(latestProductionSave), "Production Save Workspace diagnostic exists."),
    createCheck("production_save_mode_recorded", latestProductionSave?.details?.saveMode === "production_save_to_workspace_library", "Production save mode is recorded."),
    createCheck("no_later_production_save_failure", !latestProductionSaveFailure || new Date(latestProductionSaveFailure.createdAt) < new Date(latestProductionSave?.createdAt || 0), "No unresolved production save failure exists after the latest successful save."),
    createCheck("workspace_library_record_exists", Boolean(memoryRecord?.workspace?.workspaceId), "Matching Workspace Library memory record exists."),
    createCheck("runtime_and_memory_workspace_ids_match", Boolean(runtimeWorkspace?.workspaceId && memoryRecord?.workspace?.workspaceId === runtimeWorkspace.workspaceId), "Runtime workspace id matches Workspace Library record id."),
    createCheck("workspace_name_matches", String(memoryRecord?.workspace?.name || "") === String(runtimeWorkspace?.name || "Untitled Workspace"), "Workspace name matches between runtime and Workspace Library."),
    createCheck("workspace_aim_matches", String(memoryRecord?.workspace?.aim || "") === String(runtimeWorkspace?.aim || ""), "Workspace aim matches between runtime and Workspace Library."),
    createCheck("workspace_type_matches", String(memoryRecord?.workspace?.workspaceType || "") === String(runtimeWorkspace?.workspaceType || ""), "Workspace type matches between runtime and Workspace Library."),
    createCheck("tab_count_matches", memoryTabs.length === runtimeTabs.length, "Workspace Library tab count matches active runtime tab count."),
    createCheck("journal_count_matches", memoryJournal.length === runtimeJournal.length, "Workspace Library journal count matches active runtime journal count."),
    createCheck("timeline_count_preserved", memoryTimeline.length >= runtimeTimeline.length, "Workspace Library timeline count preserves active runtime timeline evidence."),
    createCheck("summary_card_exists", Boolean(memoryRecord?.summaryCard), "Workspace Library summary card exists."),
    createCheck("workspace_record_resumable", memoryRecord?.workspace?.lifecycleState === "paused", "Workspace Library record is saved as a resumable paused snapshot."),
    createCheck("source_of_truth_boundary_preserved", latestProductionSave?.details?.sessionDbRuntimeSourceOfTruth === false && latestProductionSave?.details?.activeWorkspaceRuntimeSource === "chrome.storage.local", "Production save preserves runtime/memory source-of-truth boundary.")
  ];
}

function summarizeRuntimeWorkspace(workspace) {
  const tabs = Array.isArray(workspace?.tabs) ? workspace.tabs : [];
  return {
    workspaceId: workspace?.workspaceId || "",
    name: workspace?.name || "Untitled Workspace",
    aim: workspace?.aim || "",
    workspaceType: workspace?.workspaceType || "unknown",
    tabCount: tabs.length,
    journalCount: Array.isArray(workspace?.journal) ? workspace.journal.length : 0,
    timelineCount: Array.isArray(workspace?.timeline) ? workspace.timeline.length : 0,
    updatedAt: workspace?.updatedAt || ""
  };
}

function summarizeMemoryRecord(record) {
  if (!record) return null;

  return {
    workspaceId: record.workspace?.workspaceId || "",
    name: record.workspace?.name || "Untitled Workspace",
    aim: record.workspace?.aim || "",
    workspaceType: record.workspace?.workspaceType || "unknown",
    lifecycleState: record.workspace?.lifecycleState || "unknown",
    tabCount: Array.isArray(record.tabs) ? record.tabs.length : 0,
    sessionCount: Array.isArray(record.sessions) ? record.sessions.length : 0,
    projectionCount: Array.isArray(record.projections) ? record.projections.length : 0,
    journalCount: Array.isArray(record.journalEntries) ? record.journalEntries.length : 0,
    timelineCount: Array.isArray(record.timelineEvents) ? record.timelineEvents.length : 0,
    hasSummaryCard: Boolean(record.summaryCard),
    updatedAt: record.workspace?.updatedAt || ""
  };
}

function summarizeDiagnostic(diagnostic) {
  if (!diagnostic) return null;

  return {
    createdAt: diagnostic.createdAt || "",
    level: diagnostic.level || "",
    action: diagnostic.action || "",
    message: diagnostic.message || "",
    details: diagnostic.details || {}
  };
}

function findLatestDiagnostic(diagnostics, action) {
  return [...diagnostics].reverse().find((diagnostic) => diagnostic?.action === action) || null;
}

function createCheck(check, condition, message, severity = "layer2_1c_production_save") {
  return {
    check,
    status: condition ? "pass" : "fail",
    severity,
    message
  };
}

function buildClipboardEnvelope(jsonText) {
  return [
    "CHROME_FLOW_PACKET_START",
    "packetType: Chrome Flow Layer 2.1C Production Save Validation Packet",
    "schema: layer2-production-save-validation-packet-v0.1",
    "clipboardFormat: chrome_flow_packet_envelope_v0.1",
    "createdAt: " + new Date().toISOString(),
    "contentType: application/json",
    "",
    jsonText,
    "",
    "CHROME_FLOW_PACKET_END"
  ].join("\n");
}
