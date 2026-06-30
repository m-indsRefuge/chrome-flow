import {
  SESSION_DB_SCHEMA,
  openSessionDb
} from "../core/session-db.js";

import {
  getWorkspace
} from "../core/workspace-store.js";

import {
  getActiveWorkspaceId,
  getDedicatedWindowThreshold,
  getSummaryCardForWorkspace,
  getWorkspaceJournalEntries,
  getWorkspaceProjections,
  getWorkspaceSessions,
  getWorkspaceTabs,
  getWorkspaceTimelineEvents,
  listConstellationRecords,
  listWorkspaceRecords
} from "../core/session-repository.js";

const DIAGNOSTICS_KEY = "chromeFlowDiagnostics";
const MAX_DIAGNOSTICS = 200;
const SMOKE_TEST_WORKSPACE_NAME = "Session DB Smoke Test Workspace";
const SMOKE_TEST_WORKSPACE_AIM = "Validate Session DB v0 workspace/session/projection persistence.";
const PACKET_ENVELOPE_START = "CHROME_FLOW_PACKET_START";
const PACKET_ENVELOPE_END = "CHROME_FLOW_PACKET_END";
const PACKET_CLIPBOARD_FORMAT = "chrome_flow_packet_envelope_v0.1";
const PACKET_CONTENT_TYPE = "application/json";

installLayer2PersistenceValidation();

async function installLayer2PersistenceValidation() {
  renderLayer2PersistenceValidation();
  attachLayer2PersistenceValidationHandlers();
  await refreshLayer2ValidationSummary();
}

function renderLayer2PersistenceValidation() {
  if (document.getElementById("layer2PersistenceValidationSection")) return;

  const anchor = document.getElementById("savedWorkspaceRegistrySection") || document.getElementById("sessionDbDiagnosticsSection") || document.querySelector(".workspace-section");
  if (!anchor) return;

  const section = document.createElement("section");
  section.id = "layer2PersistenceValidationSection";
  section.className = "layer2-persistence-validation-section";

  const heading = document.createElement("h2");
  heading.textContent = "Layer 2 Persistence Validation";
  section.appendChild(heading);

  const help = document.createElement("p");
  help.className = "section-help";
  help.textContent = "Read-only stabilization check for Session DB, saved workspace registry consistency, cleanup state, and runtime safety boundaries.";
  section.appendChild(help);

  const summary = document.createElement("div");
  summary.id = "layer2PersistenceValidationSummary";
  summary.className = "workspace-session-summary";
  section.appendChild(summary);

  const actions = document.createElement("div");
  actions.className = "workspace-session-actions";
  actions.appendChild(createButton("validateLayer2PersistenceButton", "Validate Layer 2 Persistence", "secondary-button"));
  actions.appendChild(createButton("copyLayer2ValidationPacketButton", "Copy Layer 2 Validation Packet", "secondary-button"));
  section.appendChild(actions);

  const status = document.createElement("p");
  status.id = "layer2PersistenceValidationStatus";
  status.className = "status-message";
  section.appendChild(status);

  const output = document.createElement("pre");
  output.id = "layer2PersistenceValidationOutput";
  output.className = "diagnostics-output";
  output.textContent = "Layer 2 persistence validation output will appear here.";
  section.appendChild(output);

  anchor.insertAdjacentElement("afterend", section);
}

function attachLayer2PersistenceValidationHandlers() {
  document.getElementById("validateLayer2PersistenceButton")?.addEventListener("click", validateLayer2Persistence);
  document.getElementById("copyLayer2ValidationPacketButton")?.addEventListener("click", copyLayer2ValidationPacket);
}

async function refreshLayer2ValidationSummary() {
  try {
    const packet = await buildLayer2ValidationPacket();
    setSummary(createSummaryText(packet));
  } catch (error) {
    setSummary("Layer 2 validation summary unavailable: " + (error?.message || String(error)));
  }
}

async function validateLayer2Persistence() {
  try {
    const packet = await buildLayer2ValidationPacket();
    setOutput(packet);
    setSummary(createSummaryText(packet));
    setStatus("Layer 2 persistence validation completed: " + packet.validation.status + ".");
    await recordDiagnostic("info", "layer2_persistence_validated", "Layer 2 persistence validation completed.", {
      status: packet.validation.status,
      passed: packet.validation.passedChecks.length,
      warnings: packet.validation.warningChecks.length,
      failed: packet.validation.failedChecks.length,
      workspaceCount: packet.sessionDbSummary.workspaceCount,
      timelineEventCount: packet.sessionDbSummary.timelineEventCount,
      runtimeSource: packet.runtimeBoundary.activeWorkspaceRuntimeSource
    });
  } catch (error) {
    await handleValidationError("layer2_persistence_validation_failed", "Could not validate Layer 2 persistence.", error);
  }
}

async function copyLayer2ValidationPacket() {
  try {
    const packet = await buildLayer2ValidationPacket();
    await navigator.clipboard.writeText(formatLayer2ValidationPacketForClipboard(packet));
    setOutput(packet);
    setSummary(createSummaryText(packet));
    setStatus("Packaged Layer 2 validation packet copied: " + packet.validation.status + ".");
    await recordDiagnostic("info", "layer2_validation_packet_copied", "Packaged Layer 2 validation packet copied.", {
      schema: packet.extension.schema,
      status: packet.validation.status,
      workspaceCount: packet.sessionDbSummary.workspaceCount,
      timelineEventCount: packet.sessionDbSummary.timelineEventCount,
      clipboardFormat: packet.clipboard.format
    });
  } catch (error) {
    await handleValidationError("layer2_validation_packet_copy_failed", "Could not copy Layer 2 validation packet.", error);
  }
}

async function buildLayer2ValidationPacket() {
  const createdAt = new Date().toISOString();
  const db = await openSessionDb();
  const expectedStores = Object.values(SESSION_DB_SCHEMA.stores);
  const actualStores = Array.from(db.objectStoreNames);
  const missingStores = expectedStores.filter((storeName) => !actualStores.includes(storeName));
  const workspaces = await listWorkspaceRecords();
  const constellations = await listConstellationRecords();
  const activeDbWorkspaceId = await getActiveWorkspaceId();
  const dedicatedWindowThreshold = await getDedicatedWindowThreshold();
  const activeRuntimeWorkspace = await getWorkspace();
  const workspaceDetails = [];

  for (const workspace of workspaces) {
    const tabs = await getWorkspaceTabs(workspace.workspaceId);
    const sessions = await getWorkspaceSessions(workspace.workspaceId);
    const projections = await getWorkspaceProjections(workspace.workspaceId);
    const journalEntries = await getWorkspaceJournalEntries(workspace.workspaceId);
    const timelineEvents = await getWorkspaceTimelineEvents(workspace.workspaceId);
    const summaryCard = await getSummaryCardForWorkspace(workspace.workspaceId);

    workspaceDetails.push({
      workspace,
      counts: {
        tabs: tabs.length,
        sessions: sessions.length,
        projections: projections.length,
        journalEntries: journalEntries.length,
        timelineEvents: timelineEvents.length,
        summaryCards: summaryCard ? 1 : 0
      },
      lifecycle: {
        lifecycleState: workspace.lifecycleState,
        latestSessionState: sessions[0]?.sessionState || "none",
        latestProjectionState: projections[0]?.projectionState || "none",
        latestProjectionMode: projections[0]?.projectionMode || "none"
      },
      summaryCard: summaryCard ? {
        summaryCardId: summaryCard.summaryCardId,
        summaryVersion: summaryCard.summaryVersion,
        aiAugmentationStatus: summaryCard.aiAugmentationStatus,
        deterministicSummary: summaryCard.deterministicSummary,
        continuationSummary: summaryCard.continuationSummary
      } : null,
      recentTimelineEvents: timelineEvents.slice(0, 8).map((event) => ({
        eventId: event.eventId,
        type: event.type,
        message: event.message,
        createdAt: event.createdAt
      }))
    });
  }

  const sessionDbSummary = createSessionDbSummary(workspaces, workspaceDetails, constellations, activeDbWorkspaceId, dedicatedWindowThreshold);
  const runtimeBoundary = createRuntimeBoundary(activeRuntimeWorkspace, activeDbWorkspaceId);
  const registryState = createRegistryState(workspaces, workspaceDetails, activeDbWorkspaceId);
  const validation = createValidationResult({
    missingStores,
    workspaces,
    workspaceDetails,
    activeDbWorkspaceId,
    runtimeBoundary,
    registryState,
    sessionDbSummary
  });

  return {
    packetType: "Chrome Flow Layer 2 Persistence Validation Packet",
    createdAt,
    extension: {
      name: "Chrome Flow",
      schema: "layer2-persistence-validation-packet-v0.1"
    },
    clipboard: {
      format: PACKET_CLIPBOARD_FORMAT,
      contentType: PACKET_CONTENT_TYPE,
      copyMode: "text_envelope",
      envelopeStart: PACKET_ENVELOPE_START,
      envelopeEnd: PACKET_ENVELOPE_END
    },
    source: {
      type: "layer2_persistence_validation",
      readOnly: true,
      runtimeSourceOfTruth: false,
      browserProjectionOpened: false
    },
    sessionDb: {
      status: missingStores.length ? "schema_incomplete" : "ready",
      name: db.name,
      version: db.version,
      expectedStores,
      actualStores,
      missingStores
    },
    sessionDbSummary,
    runtimeBoundary,
    registryState,
    workspaceDetails,
    constellations: constellations.map((constellation) => ({
      constellationId: constellation.constellationId,
      name: constellation.name,
      rootWorkspaceId: constellation.rootWorkspaceId,
      workspaceIds: constellation.workspaceIds,
      updatedAt: constellation.updatedAt
    })),
    validation,
    notes: [
      "This packet is generated locally by Chrome Flow.",
      "This validation is read-only and does not open tabs, close tabs, create windows, or rehydrate saved workspaces.",
      "Session DB remains a persistence and inspection layer only; active runtime remains chrome.storage.local.",
      "This packet is copied with the standard Chrome Flow text envelope for review.",
      "Review before sharing because workspace names, tab titles, URLs in timeline evidence, and notes may be sensitive."
    ]
  };
}

function createSessionDbSummary(workspaces, workspaceDetails, constellations, activeDbWorkspaceId, dedicatedWindowThreshold) {
  return {
    workspaceCount: workspaces.length,
    workspaceTabCount: countWorkspaceDetails(workspaceDetails, "tabs"),
    sessionCount: countWorkspaceDetails(workspaceDetails, "sessions"),
    projectionCount: countWorkspaceDetails(workspaceDetails, "projections"),
    journalEntryCount: countWorkspaceDetails(workspaceDetails, "journalEntries"),
    timelineEventCount: countWorkspaceDetails(workspaceDetails, "timelineEvents"),
    summaryCardCount: countWorkspaceDetails(workspaceDetails, "summaryCards"),
    constellationCount: constellations.length,
    activeDbWorkspaceId,
    dedicatedWindowThreshold,
    smokeTestWorkspaceCount: workspaces.filter(isSmokeTestWorkspace).length,
    importedSnapshotCount: workspaceDetails.filter((detail) => detail.lifecycle.latestSessionState === "imported_snapshot").length,
    hydratedProjectionCount: workspaceDetails.filter((detail) => detail.lifecycle.latestProjectionState === "hydrated").length,
    dehydratedProjectionCount: workspaceDetails.filter((detail) => detail.lifecycle.latestProjectionState === "dehydrated").length,
    pausedWorkspaceCount: workspaces.filter((workspace) => workspace.lifecycleState === "paused").length,
    activeWorkspaceRecordCount: workspaces.filter((workspace) => workspace.lifecycleState === "active").length,
    archivedWorkspaceCount: workspaces.filter((workspace) => workspace.lifecycleState === "archived").length
  };
}

function createRuntimeBoundary(activeRuntimeWorkspace, activeDbWorkspaceId) {
  const runtimeWorkspaceId = activeRuntimeWorkspace?.workspaceId || "";

  return {
    activeWorkspaceRuntimeSource: "chrome.storage.local",
    sessionDbRuntimeSourceOfTruth: false,
    activeRuntimeWorkspaceId: runtimeWorkspaceId,
    activeRuntimeWorkspaceName: activeRuntimeWorkspace?.name || "Untitled Workspace",
    activeRuntimeWorkspaceType: activeRuntimeWorkspace?.workspaceType || "research",
    activeRuntimeTabCount: Array.isArray(activeRuntimeWorkspace?.tabs) ? activeRuntimeWorkspace.tabs.length : 0,
    activeRuntimeTimelineCount: Array.isArray(activeRuntimeWorkspace?.timeline) ? activeRuntimeWorkspace.timeline.length : 0,
    activeDbWorkspaceId,
    runtimeAndDbSelectionMatch: Boolean(runtimeWorkspaceId && activeDbWorkspaceId && runtimeWorkspaceId === activeDbWorkspaceId),
    runtimeAndDbSelectionMayDifferSafely: true,
    explanation: "Until Session DB becomes runtime authority, the active chrome.storage.local workspace and selected/imported Session DB workspace may differ."
  };
}

function createRegistryState(workspaces, workspaceDetails, activeDbWorkspaceId) {
  const activeWorkspaceExists = !activeDbWorkspaceId || workspaces.some((workspace) => workspace.workspaceId === activeDbWorkspaceId);

  return {
    savedWorkspaceIds: workspaces.map((workspace) => workspace.workspaceId),
    savedWorkspaceNames: workspaces.map((workspace) => workspace.name || "Untitled Workspace"),
    activeDbWorkspaceId,
    activeDbWorkspaceExists: activeWorkspaceExists,
    smokeTestWorkspaceIds: workspaces.filter(isSmokeTestWorkspace).map((workspace) => workspace.workspaceId),
    importedSnapshotWorkspaceIds: workspaceDetails
      .filter((detail) => detail.lifecycle.latestSessionState === "imported_snapshot")
      .map((detail) => detail.workspace.workspaceId),
    orphanLikeRecords: workspaceDetails.filter((detail) => {
      return !detail.counts.sessions || !detail.counts.projections || !detail.counts.summaryCards;
    }).map((detail) => ({
      workspaceId: detail.workspace.workspaceId,
      name: detail.workspace.name,
      counts: detail.counts
    }))
  };
}

function createValidationResult(context) {
  const passedChecks = [];
  const warningChecks = [];
  const failedChecks = [];

  pushCheck(context.missingStores.length === 0, passedChecks, failedChecks, "session_db_schema_ready", "Session DB schema has no missing stores.");
  pushCheck(context.sessionDbSummary.smokeTestWorkspaceCount === 0, passedChecks, warningChecks, "smoke_test_records_removed", "No smoke-test workspace records remain in Session DB.");
  pushCheck(context.registryState.activeDbWorkspaceExists, passedChecks, failedChecks, "active_db_workspace_reference_valid", "Session DB active workspace setting is empty or points to an existing DB workspace.");
  pushCheck(context.runtimeBoundary.sessionDbRuntimeSourceOfTruth === false, passedChecks, failedChecks, "runtime_authority_preserved", "Session DB is not marked as active runtime source of truth.");
  pushCheck(context.runtimeBoundary.activeWorkspaceRuntimeSource === "chrome.storage.local", passedChecks, failedChecks, "legacy_runtime_source_preserved", "Active workspace runtime remains chrome.storage.local.");
  pushCheck(context.sessionDbSummary.hydratedProjectionCount === 0, passedChecks, warningChecks, "no_hydrated_projections", "No saved workspace is currently marked as hydrated.");
  pushCheck(context.registryState.orphanLikeRecords.length === 0, passedChecks, warningChecks, "saved_workspace_records_complete", "Saved workspace records have session, projection, and summary-card records.");
  pushCheck(context.sessionDbSummary.workspaceCount >= 1, passedChecks, warningChecks, "saved_workspace_registry_nonempty", "Saved workspace registry contains at least one workspace.");
  pushCheck(context.sessionDbSummary.importedSnapshotCount >= 1, passedChecks, warningChecks, "imported_snapshot_available", "At least one imported active-workspace snapshot is available for inspection.");

  return {
    status: failedChecks.length ? "FAIL" : warningChecks.length ? "WARN" : "PASS",
    passedChecks,
    warningChecks,
    failedChecks
  };
}

function pushCheck(condition, passedChecks, failedOrWarningChecks, check, message) {
  const result = { check, message };
  if (condition) {
    passedChecks.push(result);
  } else {
    failedOrWarningChecks.push(result);
  }
}

function countWorkspaceDetails(workspaceDetails, key) {
  return workspaceDetails.reduce((count, detail) => count + (Number.isInteger(detail.counts[key]) ? detail.counts[key] : 0), 0);
}

function isSmokeTestWorkspace(workspace = {}) {
  return workspace.name === SMOKE_TEST_WORKSPACE_NAME && workspace.aim === SMOKE_TEST_WORKSPACE_AIM;
}

function createSummaryText(packet) {
  return "Layer 2 validation: " + packet.validation.status + " | Workspaces: " + packet.sessionDbSummary.workspaceCount + " | Smoke tests: " + packet.sessionDbSummary.smokeTestWorkspaceCount + " | Imported snapshots: " + packet.sessionDbSummary.importedSnapshotCount + " | Runtime: " + packet.runtimeBoundary.activeWorkspaceRuntimeSource + ".";
}

function formatLayer2ValidationPacketForClipboard(packet) {
  return [
    packet.clipboard.envelopeStart,
    "packetType: " + packet.packetType,
    "schema: " + packet.extension.schema,
    "clipboardFormat: " + packet.clipboard.format,
    "createdAt: " + packet.createdAt,
    "contentType: " + packet.clipboard.contentType,
    "",
    JSON.stringify(packet, null, 2),
    "",
    packet.clipboard.envelopeEnd
  ].join("\n");
}

function createButton(id, text, className) {
  const button = document.createElement("button");
  button.id = id;
  button.type = "button";
  button.className = className;
  button.textContent = text;
  return button;
}

function setSummary(message) {
  const summary = document.getElementById("layer2PersistenceValidationSummary");
  if (summary) summary.textContent = message;
}

function setStatus(message) {
  const status = document.getElementById("layer2PersistenceValidationStatus");
  if (status) status.textContent = message;
}

function setOutput(value) {
  const output = document.getElementById("layer2PersistenceValidationOutput");
  if (output) output.textContent = JSON.stringify(value, null, 2);
}

async function handleValidationError(action, message, error) {
  const details = { error: summarizeError(error) };
  setOutput({ status: "error", action, message, ...details });
  setStatus(message + " Check the output or browser console.");
  await recordDiagnostic("error", action, message, details);
}

async function recordDiagnostic(level, action, message, details = {}) {
  try {
    const result = await chrome.storage.local.get(DIAGNOSTICS_KEY);
    const diagnostics = Array.isArray(result[DIAGNOSTICS_KEY]) ? result[DIAGNOSTICS_KEY] : [];

    diagnostics.push({
      diagnosticId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      level,
      action,
      message,
      details
    });

    await chrome.storage.local.set({ [DIAGNOSTICS_KEY]: diagnostics.slice(-MAX_DIAGNOSTICS) });
  } catch (error) {
    console.warn("Chrome Flow Layer 2 validation diagnostic record failed:", error);
  }
}

function summarizeError(error) {
  if (!error) return { message: "Unknown error" };

  return {
    name: error.name || "Error",
    message: error.message || String(error),
    stack: typeof error.stack === "string" ? error.stack.slice(0, 2000) : ""
  };
}
