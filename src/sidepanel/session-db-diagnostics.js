import {
  SESSION_DB_SCHEMA,
  openSessionDb
} from "../core/session-db.js";

import {
  createWorkspaceWithSession,
  getActiveWorkspaceId,
  getDedicatedWindowThreshold,
  getSummaryCardForWorkspace,
  getWorkspaceProjections,
  getWorkspaceSessions,
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
  help.textContent = "Layer 2 smoke-test surface for the IndexedDB-backed Session DB v0. This does not replace the active workspace runtime yet.";
  section.appendChild(help);

  const summary = document.createElement("div");
  summary.id = "sessionDbDiagnosticsSummary";
  summary.className = "workspace-session-summary";
  section.appendChild(summary);

  const actions = document.createElement("div");
  actions.className = "workspace-session-actions";
  actions.appendChild(createButton("openSessionDbButton", "Open Session DB", "secondary-button"));
  actions.appendChild(createButton("createSessionDbTestWorkspaceButton", "Create Test Workspace Record", "secondary-button"));
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

async function listWorkspacesForDiagnostics() {
  try {
    const workspaces = await listWorkspaceRecords();
    const records = [];

    for (const workspace of workspaces) {
      const sessions = await getWorkspaceSessions(workspace.workspaceId);
      const projections = await getWorkspaceProjections(workspace.workspaceId);
      const summaryCard = await getSummaryCardForWorkspace(workspace.workspaceId);
      records.push({
        workspace,
        sessionCount: sessions.length,
        projectionCount: projections.length,
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
    await navigator.clipboard.writeText(JSON.stringify(packet, null, 2));
    setOutput(packet);
    setStatus("Session DB packet copied. Review before sharing because future records may include workspace names, URLs, notes, and summaries.");
    await recordDiagnostic("info", "session_db_packet_copied", "Session DB diagnostic packet copied.", {
      workspaceCount: packet.sessionDbSummary.workspaceCount,
      constellationCount: packet.sessionDbSummary.constellationCount,
      activeWorkspaceId: packet.sessionDbSummary.activeWorkspaceId,
      schema: packet.extension.schema
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
    const sessions = await getWorkspaceSessions(workspace.workspaceId);
    const projections = await getWorkspaceProjections(workspace.workspaceId);
    const summaryCard = await getSummaryCardForWorkspace(workspace.workspaceId);
    workspaceDetails.push({ workspace, sessions, projections, summaryCard });
  }

  return {
    packetType: "Chrome Flow Session DB Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "session-db-packet-v0.2"
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
      migrationStatus: "not_started",
      layer2Status: "session_db_smoke_test"
    },
    notes: createPacketNotes()
  };
}

function createSavedWorkspaceSummary(workspaceDetails) {
  return workspaceDetails.map((detail) => ({
    workspaceId: detail.workspace.workspaceId,
    name: detail.workspace.name,
    workspaceType: detail.workspace.workspaceType,
    lifecycleState: detail.workspace.lifecycleState,
    sessionCount: detail.sessions.length,
    projectionCount: detail.projections.length,
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
    "It validates the IndexedDB-backed Session DB v0 foundation and repository boundary.",
    "Session DB is not yet the active workspace runtime source of truth.",
    "It does not intentionally include page content.",
    "Review before sharing once real workspace records are migrated because future records may include workspace names, tab titles, URLs, notes, and summaries."
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
