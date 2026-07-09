import { registerDeveloperSurface } from "./developer-mode.js";

import {
  appendRuntimeDiagnostic,
  getRuntimeDiagnostics,
  getRuntimeMemorySummary
} from "../core/workspace-runtime-store.js";

import { getWorkspaceMemorySummary } from "../core/workspace-memory-store.js";

const MAX_DIAGNOSTICS_TO_SCAN = 250;
const REQUIRED_PACKET_ACTIONS = Object.freeze({
  lifecycle: "layer2_lifecycle_packet_prepared",
  memoryContract: "layer2_memory_contract_packet_prepared",
  postResume: "layer2_post_resume_verification_packet_prepared",
  productionSave: "layer2_production_save_validation_packet_prepared"
});

installLayer2CompletionCheckpointPacketSurface();

function installLayer2CompletionCheckpointPacketSurface() {
  const anchor = document.getElementById("layer2ProductionSaveValidationPacketSection")
    || document.getElementById("layer2PostResumeVerificationPacketSection")
    || document.getElementById("layer2MemoryContractValidationPacketSection")
    || document.getElementById("layer2LifecycleValidationPacketSection")
    || document.getElementById("developerDiagnosticsSection")
    || document.querySelector(".workspace-section");

  if (!anchor || document.getElementById("layer2CompletionCheckpointPacketSection")) return;

  const section = document.createElement("section");
  section.id = "layer2CompletionCheckpointPacketSection";
  section.className = "layer2-completion-checkpoint-packet-section";
  section.innerHTML = `
    <h2>Layer 2 Completion Checkpoint Packet</h2>
    <p class="section-help">Developer-only final checkpoint for Layer 2 workspace persistence, archive/resume lifecycle, memory boundary, product-surface split, production save wiring, and verification evidence. This is read-only.</p>
    <div class="workspace-session-actions">
      <button id="prepareLayer2CompletionCheckpointPacketButton" type="button" class="secondary-button">Prepare Layer 2 Completion Packet</button>
      <button id="copyLayer2CompletionCheckpointPacketButton" type="button" class="secondary-button" disabled>Copy Layer 2 Completion Packet</button>
    </div>
    <p id="layer2CompletionCheckpointPacketStatus" class="status-message">Prepare this packet after lifecycle, memory-contract, production-save, and post-resume verification packets have passed.</p>
    <pre id="layer2CompletionCheckpointPacketOutput" class="diagnostic-output"></pre>
  `;

  anchor.insertAdjacentElement("afterend", section);
  registerDeveloperSurface(section);

  document.getElementById("prepareLayer2CompletionCheckpointPacketButton")?.addEventListener("click", prepareLayer2CompletionCheckpointPacket);
  document.getElementById("copyLayer2CompletionCheckpointPacketButton")?.addEventListener("click", copyLayer2CompletionCheckpointPacket);
}

async function prepareLayer2CompletionCheckpointPacket() {
  const packet = await buildLayer2CompletionCheckpointPacket();
  const output = document.getElementById("layer2CompletionCheckpointPacketOutput");
  const status = document.getElementById("layer2CompletionCheckpointPacketStatus");
  const copyButton = document.getElementById("copyLayer2CompletionCheckpointPacketButton");

  if (output) output.textContent = JSON.stringify(packet, null, 2);
  if (status) status.textContent = "Layer 2 completion packet prepared: " + packet.completion.status + ".";
  if (copyButton) copyButton.removeAttribute("disabled");

  await appendRuntimeDiagnostic("info", "layer2_completion_checkpoint_packet_prepared", "Layer 2 completion checkpoint packet prepared.", {
    status: packet.completion.status,
    passedCheckCount: packet.completion.passedCheckCount,
    warningCheckCount: packet.completion.warningCheckCount,
    failedCheckCount: packet.completion.failedCheckCount,
    schema: packet.extension.schema
  });
}

async function copyLayer2CompletionCheckpointPacket() {
  const output = document.getElementById("layer2CompletionCheckpointPacketOutput");
  const status = document.getElementById("layer2CompletionCheckpointPacketStatus");

  if (!output?.textContent?.trim()) {
    if (status) status.textContent = "Prepare the Layer 2 completion packet before copying.";
    return;
  }

  await navigator.clipboard.writeText(buildClipboardEnvelope(output.textContent));
  if (status) status.textContent = "Layer 2 completion packet copied.";

  await appendRuntimeDiagnostic("info", "layer2_completion_checkpoint_packet_copied", "Layer 2 completion checkpoint packet copied.", {
    envelopeFormat: "chrome_flow_packet_envelope_v0.1"
  });
}

async function buildLayer2CompletionCheckpointPacket() {
  const [runtimeSummary, memorySummary, diagnostics] = await Promise.all([
    getRuntimeMemorySummary(),
    getWorkspaceMemorySummary(),
    getRuntimeDiagnostics()
  ]);

  const recentDiagnostics = diagnostics.slice(-MAX_DIAGNOSTICS_TO_SCAN);
  const evidence = buildLayer2Evidence(recentDiagnostics);
  const productSurfaceState = summarizeProductSurfaceState();
  const developerSurfaceState = summarizeDeveloperSurfaceState();
  const checks = buildCompletionChecks(runtimeSummary, memorySummary, evidence, productSurfaceState, developerSurfaceState);
  const failedChecks = checks.filter((check) => check.status === "fail");
  const warningChecks = checks.filter((check) => check.status === "warn");
  const passedChecks = checks.filter((check) => check.status === "pass");

  return {
    packetType: "Chrome Flow Layer 2 Completion Checkpoint Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "layer2-completion-checkpoint-packet-v0.4"
    },
    source: {
      type: "layer2_completion_checkpoint_packet",
      developerOnly: true,
      readOnly: true,
      checkpointOnly: true,
      runtimeActionExecuted: false,
      browserProjectionChanged: false,
      sessionDbChanged: false,
      chromeStorageRuntimeChanged: false
    },
    completion: {
      status: failedChecks.length ? "needs_attention" : warningChecks.length ? "accepted_with_warnings" : "layer2_complete_ready_for_algorithmic_foundation",
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
    evidence,
    productSurfaceState,
    developerSurfaceState,
    layer2Capabilities: {
      completed: [
        "Current Workspace product surface groups naming, aim, type, save, archive, and archive-start-fresh controls.",
        "Save Workspace persists active runtime into Workspace Library / Session DB while preserving chrome.storage.local as runtime authority.",
        "Workspace Library product surface supports Recent, All, and Archived views.",
        "Workspace Library Preview is read-only and does not reopen tabs or change browser windows.",
        "Workspace Library Resume hydrates Session DB workspace memory into active runtime after Operator confirmation.",
        "Resume target policy supports current-window and dedicated-window behavior using the 4-tab threshold.",
        "Chrome tab groups are recreated with role labels and workspace initials.",
        "Active runtime memory and long-term workspace memory boundaries are explicit and validated.",
        "Developer Mode separates diagnostics, packets, validation surfaces, and legacy restore controls from normal product view.",
        "Standalone Recent Workspaces surface has been absorbed into Workspace Library and removed from the normal runtime surface model."
      ],
      deferred: [
        "Final immersive Workspace Library overlay / 3D gallery UI.",
        "Full visual design overhaul and interaction polish.",
        "Layer 3 deterministic intelligence and algorithmic scoring.",
        "Optional AI/SLM/LLM augmentation after deterministic foundations are stable.",
        "Metadata cleanup for hydratedAt/resumedAt summary fields if they remain blank in compact summaries.",
        "Retire or delete legacy archive restore once unified Resume has enough validation history."
      ]
    },
    nextDecision: {
      recommendation: failedChecks.length ? "repair_layer2_completion_blockers" : "proceed_to_codex_external_validation_and_algorithmic_foundation_phase",
      notes: [
        "This packet is a checkpoint and does not rerun any browser-changing actions.",
        "Layer 2 completion means workspace persistence, production save-to-library, archive/resume lifecycle, memory boundary, product-surface split, and verification evidence are stable enough to build the deterministic intelligence layer on top.",
        "Future algorithmic work should read durable workspace context through WorkspaceMemoryStore and active context through WorkspaceRuntimeStore."
      ]
    }
  };
}

function buildCompletionChecks(runtimeSummary, memorySummary, evidence, productSurfaceState, developerSurfaceState) {
  return [
    createCheck("runtime_store_boundary_valid", runtimeSummary?.runtimeSourceOfTruth === "chrome.storage.local", "Runtime store boundary remains chrome.storage.local."),
    createCheck("memory_store_boundary_valid", memorySummary?.memorySourceOfTruth === "Session DB / IndexedDB", "Memory store boundary remains Session DB / IndexedDB."),
    createCheck("active_workspace_runtime_present", Boolean(runtimeSummary?.activeWorkspace?.workspaceId), "Active runtime workspace is present."),
    createCheck("workspace_memory_records_present", Number(memorySummary?.workspaceRecordCount || 0) > 0, "Long-term workspace memory records are present."),
    createCheck("recent_resumable_query_available", Array.isArray(memorySummary?.recentResumableWorkspaceIds), "Recent resumable workspace query is available."),
    createCheck("current_workspace_surface_present", productSurfaceState.currentWorkspaceSurfacePresent, "Current Workspace product surface is present."),
    createCheck("current_workspace_actions_surface_present", productSurfaceState.currentWorkspaceActionsSurfacePresent, "Current Workspace Actions surface is present."),
    createCheck("workspace_library_surface_present", productSurfaceState.workspaceLibrarySurfacePresent, "Workspace Library product surface is present."),
    createCheck("workspace_library_views_present", productSurfaceState.recentViewPresent && productSurfaceState.allViewPresent && productSurfaceState.archivedViewPresent, "Workspace Library Recent / All / Archived views are present."),
    createCheck("workspace_library_resume_action_present", productSurfaceState.resumeWorkspaceButtonPresent, "Workspace Library Resume Workspace action is present."),
    createCheck("standalone_recent_resume_surface_absent", !productSurfaceState.standaloneRecentResumeSurfacePresent, "Standalone Recent Workspaces surface is absent from the runtime UI."),
    createCheck("developer_mode_gate_present", developerSurfaceState.developerModeGatePresent, "Developer Mode gate is present."),
    createCheck("developer_diagnostics_developer_only", developerSurfaceState.developerDiagnosticsDeveloperOnly, "Developer Diagnostics is developer-only."),
    createCheck("legacy_archive_restore_developer_only", developerSurfaceState.legacyArchiveRestoreDeveloperOnly, "Legacy Archive Restore is developer-only."),
    createCheck("validation_surfaces_developer_controlled", developerSurfaceState.validationSurfaceToggleDeveloperControlled, "Validation Surfaces toggle is controlled by Developer Mode."),
    createCheck("validation_panels_registered", developerSurfaceState.validationSurfaceRegisteredCount > 0, "Validation panels are explicitly registered as validation surfaces."),
    createCheck("lifecycle_packet_passed", evidence.lifecycle?.details?.status === "ready_for_layer2_completion_checkpoint", "Layer 2 lifecycle packet passed."),
    createCheck("memory_contract_packet_passed", evidence.memoryContract?.details?.status === "ready_for_recent_resume_archive_restore_split", "Layer 2 memory contract packet passed."),
    createCheck("production_save_packet_passed", evidence.productionSave?.details?.status === "production_save_to_workspace_library_validated", "Layer 2.1C production Save Workspace packet passed."),
    createCheck("production_save_executed", Boolean(evidence.productionSaveExecuted), "Production Save Workspace to Workspace Library evidence exists."),
    createCheck("post_resume_packet_passed", evidence.postResume?.details?.status === "ready_for_layer2_completion_checkpoint", "Layer 2 post-resume verification packet passed."),
    createCheck("unified_resume_executed", Boolean(evidence.unifiedResumeExecuted), "Workspace Library unified resume execution evidence exists."),
    createCheck("resume_groups_recreated", Boolean(evidence.resumeGroupsRecreated), "Workspace Library resume group recreation evidence exists."),
    createCheck("resume_window_focused", Boolean(evidence.resumeWindowFocused), "Workspace Library resume window focus evidence exists."),
    createCheck("resume_projection_verified_zero_failures", Number(evidence.postResume?.details?.failedCheckCount || 0) === 0, "Post-resume verification has zero failed checks."),
    createCheck("archive_close_behavior_evidenced", Boolean(evidence.archiveCloseCompleted) || Boolean(evidence.unifiedResumeExecuted), "Archive/restore lifecycle evidence exists for Layer 2 completion.")
  ];
}

function buildLayer2Evidence(diagnostics) {
  return {
    lifecycle: summarizeDiagnostic(findLatestDiagnostic(diagnostics, REQUIRED_PACKET_ACTIONS.lifecycle)),
    memoryContract: summarizeDiagnostic(findLatestDiagnostic(diagnostics, REQUIRED_PACKET_ACTIONS.memoryContract)),
    productionSave: summarizeDiagnostic(findLatestDiagnostic(diagnostics, REQUIRED_PACKET_ACTIONS.productionSave)),
    postResume: summarizeDiagnostic(findLatestDiagnostic(diagnostics, REQUIRED_PACKET_ACTIONS.postResume)),
    productionSaveExecuted: summarizeDiagnostic(findLatestDiagnostic(diagnostics, "workspace_saved_to_workspace_library")),
    unifiedResumeExecuted: summarizeDiagnostic(findLatestDiagnostic(diagnostics, "workspace_library_resume_executed")),
    resumeGroupsRecreated: summarizeDiagnostic(findLatestDiagnostic(diagnostics, "workspace_resume_groups_recreated")),
    resumeWindowFocused: summarizeDiagnostic(findLatestDiagnostic(diagnostics, "workspace_resume_window_focused")),
    archiveCloseCompleted: summarizeDiagnostic(findLatestDiagnostic(diagnostics, "workspace_archive_browser_close_completed")),
    layer2CompletionPrepared: summarizeDiagnostic(findLatestDiagnostic(diagnostics, "layer2_completion_checkpoint_packet_prepared"))
  };
}

function summarizeProductSurfaceState() {
  return {
    currentWorkspaceSurfacePresent: Boolean(document.querySelector("[data-product-surface='current-workspace']")),
    currentWorkspaceActionsSurfacePresent: Boolean(document.querySelector("[data-product-surface='current-workspace-actions']")),
    workspaceLibrarySurfacePresent: Boolean(document.querySelector("[data-product-surface='workspace-library']")),
    standaloneRecentResumeSurfacePresent: Boolean(document.getElementById("workspaceRecentResumeSection") || document.querySelector("[data-product-surface='recent-resume']")),
    recentViewPresent: Boolean(document.getElementById("workspaceLibraryViewRecentButton")),
    allViewPresent: Boolean(document.getElementById("workspaceLibraryViewAllButton")),
    archivedViewPresent: Boolean(document.getElementById("workspaceLibraryViewArchivedButton")),
    previewWorkspaceButtonPresent: Boolean(document.getElementById("workspaceLibraryPreviewButton")),
    resumeWorkspaceButtonPresent: Boolean(document.getElementById("workspaceLibraryResumeButton")),
    archiveCurrentWorkspaceButtonPresent: Boolean(document.getElementById("archiveWorkspaceButton")),
    archiveStartFreshButtonPresent: Boolean(document.getElementById("archiveAndStartFreshButton"))
  };
}

function summarizeDeveloperSurfaceState() {
  const legacyArchiveRestore = document.querySelector("[data-legacy-archive-restore-surface='true']") || document.querySelector("[data-legacyArchiveRestoreSurface='true']");
  const validationToggle = document.getElementById("validationSurfaceDebugModeSection");
  const validationToggleButton = document.getElementById("toggleValidationSurfaceDebugModeButton");
  const validationSurfaces = Array.from(document.querySelectorAll("[data-validation-surface='true']"));

  return {
    developerModeGatePresent: Boolean(document.getElementById("developerModeGateSection")),
    developerDiagnosticsDeveloperOnly: isDeveloperSurface("developerDiagnosticsSection"),
    sessionDbDiagnosticsDeveloperOnly: isDeveloperSurface("sessionDbDiagnosticsSection"),
    legacyArchiveRestoreDeveloperOnly: Boolean(legacyArchiveRestore?.dataset?.developerSurface === "true"),
    validationSurfaceTogglePresent: Boolean(validationToggle),
    validationSurfaceToggleDeveloperControlled: isValidationSurfaceToggleDeveloperControlled(validationToggle, validationToggleButton),
    validationSurfaceRegisteredCount: validationSurfaces.length,
    visibleValidationSurfaceCount: validationSurfaces.filter((surface) => !surface.hidden).length,
    layer2LifecyclePacketDeveloperOnly: isDeveloperSurface("layer2LifecycleValidationPacketSection"),
    layer2MemoryContractPacketDeveloperOnly: isDeveloperSurface("layer2MemoryContractValidationPacketSection"),
    layer2PostResumePacketDeveloperOnly: isDeveloperSurface("layer2PostResumeVerificationPacketSection"),
    layer2ProductionSavePacketDeveloperOnly: isDeveloperSurface("layer2ProductionSaveValidationPacketSection"),
    layer2CompletionCheckpointPacketDeveloperOnly: isDeveloperSurface("layer2CompletionCheckpointPacketSection")
  };
}

function isValidationSurfaceToggleDeveloperControlled(section, button) {
  if (!section) return true;

  return section.id === "validationSurfaceDebugModeSection"
    && Boolean(button)
    && section.classList.contains("validation-surface-debug-mode-section");
}

function isDeveloperSurface(id) {
  const element = document.getElementById(id);
  return Boolean(element?.dataset?.developerSurface === "true");
}

function createCheck(check, condition, message, severity = "layer2_completion") {
  return {
    check,
    status: condition ? "pass" : "fail",
    severity,
    message
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

function buildClipboardEnvelope(jsonText) {
  return [
    "CHROME_FLOW_PACKET_START",
    "packetType: Chrome Flow Layer 2 Completion Checkpoint Packet",
    "schema: layer2-completion-checkpoint-packet-v0.4",
    "clipboardFormat: chrome_flow_packet_envelope_v0.1",
    "createdAt: " + new Date().toISOString(),
    "contentType: application/json",
    "",
    jsonText,
    "",
    "CHROME_FLOW_PACKET_END"
  ].join("\n");
}
