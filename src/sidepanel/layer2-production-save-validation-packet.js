import { registerDeveloperSurface } from "./developer-mode.js";

import {
  appendRuntimeDiagnostic,
  getActiveWorkspaceRuntime,
  getRuntimeDiagnostics
} from "../core/workspace-runtime-store.js";

import { getWorkspaceMemoryRecord } from "../core/workspace-memory-store.js";

const MAX_DIAGNOSTICS_TO_SCAN = 200;
const EXPECTED_PERSISTENCE_MODE = "exact_atomic_snapshot_replacement";
const EXPECTED_PROJECTION_MODE = "production_workspace_snapshot";
const LEGACY_IMPORT_EVENT_TYPE = "legacy_workspace_imported_to_session_db";

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
    <h2>Layer 2.1D Exact Snapshot Validation Packet</h2>
    <p class="section-help">Developer-only readout that verifies the end-user Save Workspace action replaces snapshot-owned Workspace Library records exactly and atomically. This is read-only.</p>
    <div class="workspace-session-actions">
      <button id="prepareLayer2ProductionSaveValidationPacketButton" type="button" class="secondary-button">Prepare Exact Snapshot Packet</button>
      <button id="copyLayer2ProductionSaveValidationPacketButton" type="button" class="secondary-button" disabled>Copy Exact Snapshot Packet</button>
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
  if (status) status.textContent = "Exact snapshot packet prepared: " + packet.validation.status + ".";
  if (copyButton) copyButton.removeAttribute("disabled");

  await appendRuntimeDiagnostic("info", "layer2_production_save_validation_packet_prepared", "Layer 2.1D exact production snapshot validation packet prepared.", {
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
    if (status) status.textContent = "Prepare the exact snapshot packet before copying.";
    return;
  }

  await navigator.clipboard.writeText(buildClipboardEnvelope(output.textContent));
  if (status) status.textContent = "Exact snapshot packet copied.";

  await appendRuntimeDiagnostic("info", "layer2_production_save_validation_packet_copied", "Layer 2.1D exact production snapshot validation packet copied.", {
    envelopeFormat: "chrome_flow_packet_envelope_v0.1"
  });
}

async function buildLayer2ProductionSaveValidationPacket() {
  const [runtimeWorkspace, diagnostics] = await Promise.all([
    getActiveWorkspaceRuntime(),
    getRuntimeDiagnostics()
  ]);

  const memoryRecord = runtimeWorkspace?.workspaceId ? await getWorkspaceMemoryRecord(runtimeWorkspace.workspaceId) : null;
  const recentDiagnostics = diagnostics.slice(-MAX_DIAGNOSTICS_TO_SCAN);
  const latestProductionSave = findLatestDiagnostic(recentDiagnostics, "workspace_saved_to_workspace_library");
  const latestProductionSaveFailure = findLatestDiagnostic(recentDiagnostics, "workspace_save_to_workspace_library_failed");
  const checks = buildValidationChecks(runtimeWorkspace, memoryRecord, latestProductionSave, latestProductionSaveFailure);
  const failedChecks = checks.filter((check) => check.status === "fail");
  const warningChecks = checks.filter((check) => check.status === "warn");
  const passedChecks = checks.filter((check) => check.status === "pass");

  return {
    packetType: "Chrome Flow Layer 2.1D Exact Production Snapshot Validation Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "layer2-production-save-validation-packet-v0.3"
    },
    source: {
      type: "layer2_exact_production_snapshot_validation_packet",
      developerOnly: true,
      readOnly: true,
      validationOnly: true,
      runtimeActionExecuted: false,
      browserProjectionChanged: false,
      sessionDbChanged: false,
      chromeStorageRuntimeChanged: false
    },
    validation: {
      status: failedChecks.length ? "needs_attention" : warningChecks.length ? "accepted_with_warnings" : "exact_production_snapshot_validated",
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
    snapshotIdentityEvidence: summarizeSnapshotIdentityEvidence(memoryRecord, latestProductionSave),
    latestProductionSaveEvidence: summarizeDiagnostic(latestProductionSave),
    latestProductionSaveFailure: summarizeDiagnostic(latestProductionSaveFailure),
    nextDecision: {
      recommendation: failedChecks.length ? "repair_exact_workspace_snapshot_replacement" : "proceed_to_resume_rollback_and_idempotency_repair",
      notes: [
        "This packet verifies exact snapshot identity rather than counts alone.",
        "Workspace tabs, journal entries, and runtime timeline events are snapshot-owned and must match the latest production-save identity exactly.",
        "Production save must retain chrome.storage.local as runtime authority and must not write Session DB active-workspace authority.",
        "A deliberate remove-save validation should produce deletedObsoleteCount greater than zero for the removed child collection."
      ]
    }
  };
}

function buildValidationChecks(runtimeWorkspace, memoryRecord, latestProductionSave, latestProductionSaveFailure) {
  const runtimeTabs = Array.isArray(runtimeWorkspace?.tabs) ? runtimeWorkspace.tabs : [];
  const runtimeJournal = Array.isArray(runtimeWorkspace?.journal) ? runtimeWorkspace.journal : [];
  const memoryTabs = Array.isArray(memoryRecord?.tabs) ? memoryRecord.tabs : [];
  const memoryJournal = Array.isArray(memoryRecord?.journalEntries) ? memoryRecord.journalEntries : [];
  const memoryTimeline = Array.isArray(memoryRecord?.timelineEvents) ? memoryRecord.timelineEvents : [];
  const memorySessions = Array.isArray(memoryRecord?.sessions) ? memoryRecord.sessions : [];
  const memoryProjections = Array.isArray(memoryRecord?.projections) ? memoryRecord.projections : [];
  const snapshotIdentity = latestProductionSave?.details?.snapshotIdentity || {};
  const replacementStats = latestProductionSave?.details?.replacementStats || {};
  const savedTabIds = sortUniqueStrings(snapshotIdentity.workspaceTabIds || []);
  const savedJournalIds = sortUniqueStrings(snapshotIdentity.journalEntryIds || []);
  const savedTimelineIds = sortUniqueStrings(snapshotIdentity.timelineEventIds || []);
  const memoryTabIds = sortUniqueStrings(memoryTabs.map((tab) => tab.workspaceTabId));
  const memoryJournalIds = sortUniqueStrings(memoryJournal.map((entry) => entry.journalEntryId));
  const memoryTimelineIds = sortUniqueStrings(memoryTimeline.map((event) => event.eventId));

  return [
    createCheck("active_runtime_workspace_exists", Boolean(runtimeWorkspace?.workspaceId), "Active runtime workspace exists."),
    createCheck("production_save_diagnostic_exists", Boolean(latestProductionSave), "Production Save Workspace diagnostic exists."),
    createCheck("exact_snapshot_persistence_mode_recorded", latestProductionSave?.details?.persistenceMode === EXPECTED_PERSISTENCE_MODE, "Exact atomic snapshot-replacement mode is recorded."),
    createCheck("no_later_production_save_failure", !latestProductionSaveFailure || new Date(latestProductionSaveFailure.createdAt) < new Date(latestProductionSave?.createdAt || 0), "No unresolved production save failure exists after the latest successful save."),
    createCheck("workspace_library_record_exists", Boolean(memoryRecord?.workspace?.workspaceId), "Matching Workspace Library memory record exists."),
    createCheck("runtime_and_memory_workspace_ids_match", Boolean(runtimeWorkspace?.workspaceId && memoryRecord?.workspace?.workspaceId === runtimeWorkspace.workspaceId), "Runtime workspace id matches Workspace Library record id."),
    createCheck("workspace_name_matches", String(memoryRecord?.workspace?.name || "") === String(runtimeWorkspace?.name || "Untitled Workspace"), "Workspace name matches between runtime and Workspace Library."),
    createCheck("workspace_aim_matches", String(memoryRecord?.workspace?.aim || "") === String(runtimeWorkspace?.aim || ""), "Workspace aim matches between runtime and Workspace Library."),
    createCheck("workspace_type_matches", String(memoryRecord?.workspace?.workspaceType || "") === String(runtimeWorkspace?.workspaceType || ""), "Workspace type matches between runtime and Workspace Library."),
    createCheck("tab_count_matches", memoryTabs.length === runtimeTabs.length, "Workspace Library tab count matches active runtime tab count."),
    createCheck("journal_count_matches", memoryJournal.length === runtimeJournal.length, "Workspace Library journal count matches active runtime journal count."),
    createCheck("snapshot_identity_recorded", Boolean(snapshotIdentity.workspaceId && snapshotIdentity.sessionId && snapshotIdentity.projectionId), "Latest save records exact snapshot identity."),
    createCheck("workspace_tab_identity_exact", equalStringSets(memoryTabIds, savedTabIds), "Workspace Library workspaceTabId set exactly matches the latest saved snapshot."),
    createCheck("journal_identity_exact", equalStringSets(memoryJournalIds, savedJournalIds), "Workspace Library journal-entry id set exactly matches the latest saved snapshot."),
    createCheck("timeline_identity_exact", equalStringSets(memoryTimelineIds, savedTimelineIds), "Workspace Library timeline-event id set exactly matches the latest saved snapshot."),
    createCheck("stable_snapshot_session_present", memorySessions.some((session) => session.sessionId === snapshotIdentity.sessionId && session.sessionState === "production_snapshot"), "Stable production snapshot session is present."),
    createCheck("stable_snapshot_projection_present", memoryProjections.some((projection) => projection.projectionId === snapshotIdentity.projectionId && projection.projectionMode === EXPECTED_PROJECTION_MODE), "Stable production snapshot projection is present."),
    createCheck("replacement_stats_recorded", replacementStats.workspaceTabs && replacementStats.journalEntries && replacementStats.timelineEvents && replacementStats.sessions && replacementStats.projections, "Exact replacement statistics are recorded for all managed stores."),
    createCheck("legacy_import_events_absent", !memoryTimeline.some((event) => event.type === LEGACY_IMPORT_EVENT_TYPE), "Production snapshot timeline excludes legacy-import audit events."),
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
    workspaceTabIds: sortUniqueStrings(tabs.map((tab) => tab.workspaceTabId)),
    journalCount: Array.isArray(workspace?.journal) ? workspace.journal.length : 0,
    timelineCount: Array.isArray(workspace?.timeline) ? workspace.timeline.length : 0,
    latestTimelineEventType: getLatestTimelineEventType(workspace),
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
    workspaceTabIds: sortUniqueStrings((record.tabs || []).map((tab) => tab.workspaceTabId)),
    sessionCount: Array.isArray(record.sessions) ? record.sessions.length : 0,
    sessionIds: sortUniqueStrings((record.sessions || []).map((session) => session.sessionId)),
    projectionCount: Array.isArray(record.projections) ? record.projections.length : 0,
    projectionIds: sortUniqueStrings((record.projections || []).map((projection) => projection.projectionId)),
    journalCount: Array.isArray(record.journalEntries) ? record.journalEntries.length : 0,
    journalEntryIds: sortUniqueStrings((record.journalEntries || []).map((entry) => entry.journalEntryId)),
    timelineCount: Array.isArray(record.timelineEvents) ? record.timelineEvents.length : 0,
    timelineEventIds: sortUniqueStrings((record.timelineEvents || []).map((event) => event.eventId)),
    hasSummaryCard: Boolean(record.summaryCard),
    summaryVersion: record.summaryCard?.summaryVersion || "",
    updatedAt: record.workspace?.updatedAt || ""
  };
}

function summarizeSnapshotIdentityEvidence(memoryRecord, latestProductionSave) {
  const snapshotIdentity = latestProductionSave?.details?.snapshotIdentity || {};

  return {
    persistenceMode: latestProductionSave?.details?.persistenceMode || "",
    savedSnapshotIdentity: snapshotIdentity,
    memoryWorkspaceTabIds: sortUniqueStrings((memoryRecord?.tabs || []).map((tab) => tab.workspaceTabId)),
    memoryJournalEntryIds: sortUniqueStrings((memoryRecord?.journalEntries || []).map((entry) => entry.journalEntryId)),
    memoryTimelineEventIds: sortUniqueStrings((memoryRecord?.timelineEvents || []).map((event) => event.eventId)),
    replacementStats: latestProductionSave?.details?.replacementStats || null
  };
}

function getLatestTimelineEventType(workspace) {
  const timeline = Array.isArray(workspace?.timeline) ? workspace.timeline : [];
  return timeline.length ? timeline[timeline.length - 1]?.type || "" : "";
}

function equalStringSets(left, right) {
  const leftValues = sortUniqueStrings(left);
  const rightValues = sortUniqueStrings(right);
  return leftValues.length === rightValues.length && leftValues.every((value, index) => value === rightValues[index]);
}

function sortUniqueStrings(values) {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value))).sort();
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

function createCheck(check, condition, message, severity = "layer2_1d_exact_snapshot") {
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
    "packetType: Chrome Flow Layer 2.1D Exact Production Snapshot Validation Packet",
    "schema: layer2-production-save-validation-packet-v0.3",
    "clipboardFormat: chrome_flow_packet_envelope_v0.1",
    "createdAt: " + new Date().toISOString(),
    "contentType: application/json",
    "",
    jsonText,
    "",
    "CHROME_FLOW_PACKET_END"
  ].join("\n");
}
