import {
  SESSION_DB_SCHEMA,
  openSessionDb
} from "../core/session-db.js";

import {
  getWorkspace
} from "../core/workspace-store.js";

import {
  createWorkspaceWithSession,
  getActiveWorkspaceId,
  getDedicatedWindowThreshold,
  getSummaryCardForWorkspace,
  getWorkspaceJournalEntries,
  getWorkspaceProjections,
  getWorkspaceSessions,
  getWorkspaceTabs,
  getWorkspaceTimelineEvents,
  importLegacyWorkspaceToSessionDb,
  listConstellationRecords,
  listWorkspaceRecords
} from "../core/session-repository.js";

const DIAGNOSTICS_KEY = "chromeFlowDiagnostics";
const MAX_DIAGNOSTICS = 200;

installSessionDbDiagnostics();

async function installSessionDbDiagnostics() {
  renderSessionDbDiagnostics();
  attachSessionDbDiagnosticsHandlers();
  await refreshSessionDbDiagnosticsSummary();
}

function renderSessionDbDiagnostics() {
  if (document.getElementById("sessionDbDiagnosticsSection")) return;

  const anchor = document.getElementById("workspaceSessionControlSection") || document.querySelector(".workspace-section");
  if (!anchor) return;

  const section = document.createElement("section");
  section.id = "sessionDbDiagnosticsSection";
  section.className = "session-db-diagnostics-section";

  const heading = document.createElement("h2");
  heading.textContent = "Session DB Diagnostics";
  section.appendChild(heading);

  const help = document.createElement("p");
  help.className = "section-help";
  help.textContent = "Layer 2 smoke-test and migration-bridge surface for the IndexedDB-backed Session DB v0. This does not replace the active workspace runtime yet.";
  section.appendChild(help);

  const summary = document.createElement("div");
  summary.id = "sessionDbDiagnosticsSummary";
  summary.className = "workspace-session-summary";
  section.appendChild(summary);

  const actions = document.createElement("div");
  actions.className = "workspace-session-actions";
  actions.appendChild(createButton("openSessionDbButton", "Open Session DB", "secondary-button"));
  actions.appendChild(createButton("createSessionDbTestWorkspaceButton", "Create Test Workspace Record", "secondary-button"));
  actions.appendChild(createButton("importActiveWorkspaceToSessionDbButton", "Import Active Workspace to Session DB", "secondary-button"));
  actions.appendChild(createButton("listSessionDbWorkspacesButton", "List Saved DB Workspaces", "secondary-button"));
  actions.appendChild(createButton("copySessionDbPacketButton", "Copy Session DB Packet", "secondary-button"));
  section.appendChild(actions);

  const status = document.createElement("p");
  status.id = "sessionDbDiagnosticsStatus";
  status.className = "status-message";
  section.appendChild(status);

  const output = document.createElement("pre");
  output.id = "sessionDbDiagnosticsOutput";
  output.className = "diagnostics-output";
  output.textContent = "Session DB diagnostics output will appear here.";
  section.appendChild(output);

  anchor.insertAdjacentElement("afterend", section);
}

function attachSessionDbDiagnosticsHandlers() {
  document.getElementById("openSessionDbButton")?.addEventListener("click", openSessionDbForDiagnostics);
  document.getElementById("createSessionDbTestWorkspaceButton")?.addEventListener("click", createTestWorkspaceForDiagnostics);
  document.getElementById("importActiveWorkspaceToSessionDbButton")?.addEventListener("click", importActiveWorkspaceForDiagnostics);
  document.getElementById("listSessionDbWorkspacesButton")?.addEventListener("click", listWorkspacesForDiagnostics);
  document.getElementById("copySessionDbPacketButton")?.addEventListener("click", copySessionDbPacket);
}

async function openSessionDbForDiagnostics() {
  try {
    const db = await openSessionDb();
    const storeNames = Array.from(db.objectStoreNames);
    const result = {
      status: "success",
      dbName: db.name,
      version: db.version,
      expectedStores: Object.values(SESSION_DB_SCHEMA.stores),
      actualStores: storeNames,
      missingStores: Object.values(SESSION_DB_SCHEMA.stores).filter((storeName) => !storeNames.includes(storeName))
    };

    setOutput(result);
    setStatus("Session DB opened successfully.");
    await recordDiagnostic("info", "session_db_opened", "Session DB opened successfully.", result);
    await refreshSessionDbDiagnosticsSummary();
  } catch (error) {
    await handleSessionDbError("session_db_open_failed", "Could not open Session DB.", error);
  }
}

async function createTestWorkspaceForDiagnostics() {
  try {
    const createdAt = new Date().toISOString();
    const result = await createWorkspaceWithSession({
      name: "Session DB Smoke Test Workspace",
      aim: "Validate Session DB v0 workspace/session/projection persistence.",
      workspaceType: "research",
      lifecycleState: "paused",
      lastActivatedAt: createdAt
    });

    const packet = {
      status: "success",
      createdAt,
      workspace: result.workspace,
      session: result.session,
      projection: result.projection,
      summaryCard: result.summaryCard
    };

    setOutput(packet);
    setStatus("Created Session DB smoke-test workspace record.");
    await recordDiagnostic("info", "session_db_test_workspace_created", "Created Session DB smoke-test workspace record.", {
      workspaceId: result.workspace.workspaceId,
      sessionId: result.session.sessionId,
      projectionId: result.projection.projectionId,
      summaryCardId: result.summaryCard.summaryCardId
    });
    await refreshSessionDbDiagnosticsSummary();
  } catch (error) {
    await handleSessionDbError("session_db_test_workspace_create_failed", "Could not create Session DB smoke-test workspace.", error);
  }
}

async function importActiveWorkspaceForDiagnostics() {
  try {
    const legacyWorkspace = await getWorkspace();
    const result = await importLegacyWorkspaceToSessionDb(legacyWorkspace);
    const packet = {
      status: "success",
      importedAt: result.importedAt,
      workspaceId: result.workspace.workspaceId,
      name: result.workspace.name,
      counts: result.counts,
      bridgeStatus: result.bridgeStatus,
      summaryCard: {
        summaryCardId: result.summaryCard.summaryCardId,
        deterministicSummary: result.summaryCard.deterministicSummary,
        roleSummary: result.summaryCard.roleSummary,
        tabSummaryCount: result.summaryCard.tabSummary.length,
        journalSummaryCount: result.summaryCard.journalSummary.length,
        recentActivitySummaryCount: result.summaryCard.recentActivitySummary.length,
        aiAugmentationStatus: result.summaryCard.aiAugmentationStatus
      }
    };

    setOutput(packet);
    setStatus("Imported active workspace into Session DB as a saved snapshot. Runtime source remains chrome.storage.local.");
    await recordDiagnostic("info", "active_workspace_imported_to_session_db", "Active workspace imported into Session DB as a saved snapshot.", {
      workspaceId: result.workspace.workspaceId,
      name: result.workspace.name,
      counts: result.counts,
      migrationMode: result.bridgeStatus.migrationMode,
      sessionDbRuntimeSourceOfTruth: result.bridgeStatus.sessionDbRuntimeSourceOfTruth
    });
    await refreshSessionDbDiagnosticsSummary();
  } catch (error) {
    await handleSessionDbError("active_workspace_import_to_session_db_failed", "Could not import active workspace into Session DB.", error);
  }
}

async function listWorkspacesForDiagnostics() {
  try {
    const workspaces = await listWorkspaceRecords();
    const records = [];

    for (const workspace of workspaces) {
      const tabs = await getWorkspaceTabs(workspace.workspaceId);
      const sessions = await getWorkspaceSessions(workspace.workspaceId);
      const projections = await getWorkspaceProjections(workspace.workspaceId);
      const journalEntries = await getWorkspaceJournalEntries(workspace.workspaceId);
      const timelineEvents = await getWorkspaceTimelineEvents(workspace.workspaceId);
      const summaryCard = await getSummaryCardForWorkspace(workspace.workspaceId);
      records.push({
        workspace,
        tabCount: tabs.length,
        sessionCount: sessions.length,
        projectionCount: projections.length,
        journalEntryCount: journalEntries.length,
        timelineEventCount: timelineEvents.length,
        summaryCard: summaryCard ? {
          summaryCardId: summaryCard.summaryCardId,
          deterministicSummary: summaryCard.deterministicSummary,
          aiAugmentationStatus: summaryCard.aiAugmentationStatus
        } : null
      });
    }

    const result = {
      status: "success",
      workspaceCount: records.length,
      records
    };

    setOutput(result);
    setStatus("Loaded " + records.length + " Session DB workspace record(s).");
    await recordDiagnostic("info", "session_db_workspaces_listed", "Session DB workspace records listed.", {
      workspaceCount: records.length
    });
    await refreshSessionDbDiagnosticsSummary();
  } catch (error) {
    await handleSessionDbError("session_db_workspaces_list_failed", "Could not list Session DB workspaces.", error);
  }
}

async function copySessionDbPacket() {
  try {
    const packet = await buildSessionDbPacket();
    const packetText = formatSessionDbPacketForClipboard(packet);
    await navigator.clipboard.writeText(packetText);
    setOutput(packet);
    setStatus("Packaged Session DB packet copied. Paste it into chat as a contained text packet for review.");
    await recordDiagnostic("info", "session_db_packet_copied", "Packaged Session DB diagnostic packet copied.", {
      workspaceCount: packet.sessionDbSummary.workspaceCount,
      workspaceTabCount: packet.sessionDbSummary.workspaceTabCount,
      timelineEventCount: packet.sessionDbSummary.timelineEventCount,
      constellationCount: packet.sessionDbSummary.constellationCount,
      activeWorkspaceId: packet.sessionDbSummary.activeWorkspaceId,
      schema: packet.extension.schema,
      clipboardFormat: "chrome_flow_packet_envelope_v0.1"
    });
  } catch (error) {
    await handleSessionDbError("session_db_packet_copy_failed", "Could not copy Session DB packet.", error);
  }
}

async function refreshSessionDbDiagnosticsSummary() {
  const summary = document.getElementById("sessionDbDiagnosticsSummary");
  if (!summary) return;

  try {
    const workspaces = await listWorkspaceRecords();
    const constellations = await listConstellationRecords();
    const activeWorkspaceId = await getActiveWorkspaceId();
    const dedicatedWindowThreshold = await getDedicatedWindowThreshold();

    summary.textContent = "Session DB: ready | Workspaces: " + workspaces.length + " | Constellations: " + constellations.length + " | Active DB workspace: " + (activeWorkspaceId || "none") + " | Dedicated window threshold: " + dedicatedWindowThreshold + ".";
  } catch (error) {
    summary.textContent = "Session DB: not ready | " + (error?.message || String(error));
  }
}

async function buildSessionDbPacket() {
  const db = await openSessionDb();
  const workspaces = await listWorkspaceRecords();
  const constellations = await listConstellationRecords();
  const activeWorkspaceId = await getActiveWorkspaceId();
  const dedicatedWindowThreshold = await getDedicatedWindowThreshold();
  const expectedStores = Object.values(SESSION_DB_SCHEMA.stores);
  const actualStores = Array.from(db.objectStoreNames);
  const missingStores = expectedStores.filter((storeName) => !actualStores.includes(storeName));
  const workspaceDetails = [];

  for (const workspace of workspaces) {
    const tabs = await getWorkspaceTabs(workspace.workspaceId);
    const sessions = await getWorkspaceSessions(workspace.workspaceId);
    const projections = await getWorkspaceProjections(workspace.workspaceId);
    const journalEntries = await getWorkspaceJournalEntries(workspace.workspaceId);
    const timelineEvents = await getWorkspaceTimelineEvents(workspace.workspaceId);
    const summaryCard = await getSummaryCardForWorkspace(workspace.workspaceId);
    workspaceDetails.push({ workspace, tabs, sessions, projections, journalEntries, timelineEvents, summaryCard });
  }

  return {
    packetType: "Chrome Flow Session DB Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "session-db-packet-v0.3"
    },
    source: {
      type: "session_db_diagnostics",
      runtimeSourceOfTruth: false,
      databaseName: db.name,
      databaseVersion: db.version
    },
    sessionDb: {
      status: missingStores.length ? "schema_incomplete" : "ready",
      name: db.name,
      version: db.version,
      expectedStores,
      actualStores,
      missingStores
    },
    sessionDbSummary: {
      workspaceCount: workspaces.length,
      workspaceTabCount: countNestedRecords(workspaceDetails, "tabs"),
      sessionCount: countNestedRecords(workspaceDetails, "sessions"),
      projectionCount: countNestedRecords(workspaceDetails, "projections"),
      journalEntryCount: countNestedRecords(workspaceDetails, "journalEntries"),
      timelineEventCount: countNestedRecords(workspaceDetails, "timelineEvents"),
      constellationCount: constellations.length,
      activeWorkspaceId,
      dedicatedWindowThreshold,
      hydratedProjectionCount: countProjectionsByState(workspaceDetails, "hydrated"),
      dehydratedProjectionCount: countProjectionsByState(workspaceDetails, "dehydrated"),
      pausedWorkspaceCount: workspaces.filter((workspace) => workspace.lifecycleState === "paused").length,
      activeWorkspaceCount: workspaces.filter((workspace) => workspace.lifecycleState === "active").length,
      archivedWorkspaceCount: workspaces.filter((workspace) => workspace.lifecycleState === "archived").length
    },
    savedWorkspaceSummary: createSavedWorkspaceSummary(workspaceDetails),
    constellationSummary: createConstellationSummary(constellations),
    workspaceDetails,
    constellations,
    bridgeStatus: {
      sessionDbRuntimeSourceOfTruth: false,
      activeWorkspaceRuntimeSource: "chrome.storage.local",
      migrationStatus: "copy_bridge_available",
      layer2Status: "active_workspace_import_bridge"
    },
    notes: createPacketNotes()
  };
}

function formatSessionDbPacketForClipboard(packet) {
  return [
    "CHROME_FLOW_PACKET_START",
    "packetType: " + (packet.packetType || "Chrome Flow Session DB Packet"),
    "schema: " + (packet.extension?.schema || "unknown"),
    "clipboardFormat: chrome_flow_packet_envelope_v0.1",
    "createdAt: " + (packet.createdAt || new Date().toISOString()),
    "contentType: application/json",
    "",
    JSON.stringify(packet, null, 2),
    "",
    "CHROME_FLOW_PACKET_END"
  ].join("\n");
}

function createSavedWorkspaceSummary(workspaceDetails) {
  return workspaceDetails.map((detail) => ({
    workspaceId: detail.workspace.workspaceId,
    name: detail.workspace.name,
    workspaceType: detail.workspace.workspaceType,
    lifecycleState: detail.workspace.lifecycleState,
    tabCount: detail.tabs.length,
    sessionCount: detail.sessions.length,
    projectionCount: detail.projections.length,
    journalEntryCount: detail.journalEntries.length,
    timelineEventCount: detail.timelineEvents.length,
    summaryCardId: detail.summaryCard?.summaryCardId || "",
    deterministicSummary: detail.summaryCard?.deterministicSummary || "",
    aiAugmentationStatus: detail.summaryCard?.aiAugmentationStatus || "not_augmented",
    createdAt: detail.workspace.createdAt,
    updatedAt: detail.workspace.updatedAt,
    lastActivatedAt: detail.workspace.lastActivatedAt,
    lastPausedAt: detail.workspace.lastPausedAt,
    lastArchivedAt: detail.workspace.lastArchivedAt
  }));
}

function createConstellationSummary(constellations) {
  return constellations.map((constellation) => ({
    constellationId: constellation.constellationId,
    name: constellation.name,
    rootWorkspaceId: constellation.rootWorkspaceId,
    workspaceCount: Array.isArray(constellation.workspaceIds) ? constellation.workspaceIds.length : 0,
    updatedAt: constellation.updatedAt
  }));
}

function countNestedRecords(workspaceDetails, key) {
  return workspaceDetails.reduce((count, detail) => count + (Array.isArray(detail[key]) ? detail[key].length : 0), 0);
}

function countProjectionsByState(workspaceDetails, projectionState) {
  return workspaceDetails.reduce((count, detail) => {
    const projections = Array.isArray(detail.projections) ? detail.projections : [];
    return count + projections.filter((projection) => projection.projectionState === projectionState).length;
  }, 0);
}

function createPacketNotes() {
  return [
    "This packet is generated locally by Chrome Flow.",
    "This is a Session DB packet prepared for debugging or Layer 2 build validation.",
    "It validates the IndexedDB-backed Session DB v0 foundation, repository boundary, and active-workspace import bridge.",
    "Session DB is not yet the active workspace runtime source of truth.",
    "It does not intentionally include page content.",
    "Review before sharing because imported real workspace records may include workspace names, tab titles, URLs, notes, and summaries."
  ];
}

function createButton(id, text, className) {
  const button = document.createElement("button");
  button.id = id;
  button.type = "button";
  button.className = className;
  button.textContent = text;
  return button;
}

function setStatus(message) {
  const status = document.getElementById("sessionDbDiagnosticsStatus");
  if (status) status.textContent = message;
}

function setOutput(value) {
  const output = document.getElementById("sessionDbDiagnosticsOutput");
  if (output) output.textContent = JSON.stringify(value, null, 2);
}

async function handleSessionDbError(action, message, error) {
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
    console.warn("Chrome Flow Session DB diagnostic record failed:", error);
  }
}

function summarizeError(error) {
  if (!error) {
    return { message: "Unknown error" };
  }

  return {
    name: error.name || "Error",
    message: error.message || String(error),
    stack: typeof error.stack === "string" ? error.stack.slice(0, 2000) : ""
  };
}
