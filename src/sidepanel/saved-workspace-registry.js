import {
  getActiveWorkspaceId,
  getConstellationRecord,
  getSummaryCardForWorkspace,
  getWorkspaceJournalEntries,
  getWorkspaceLinks,
  getWorkspaceProjections,
  getWorkspaceSessions,
  getWorkspaceTabs,
  getWorkspaceTimelineEvents,
  listWorkspaceRecords
} from "../core/session-repository.js";

const DIAGNOSTICS_KEY = "chromeFlowDiagnostics";
const MAX_DIAGNOSTICS = 200;

installSavedWorkspaceRegistry();

async function installSavedWorkspaceRegistry() {
  renderSavedWorkspaceRegistry();
  attachSavedWorkspaceRegistryHandlers();
  await refreshSavedWorkspaceRegistry();
}

function renderSavedWorkspaceRegistry() {
  if (document.getElementById("savedWorkspaceRegistrySection")) return;

  const anchor = document.getElementById("sessionDbDiagnosticsSection") || document.getElementById("workspaceSessionControlSection") || document.querySelector(".workspace-section");
  if (!anchor) return;

  const section = document.createElement("section");
  section.id = "savedWorkspaceRegistrySection";
  section.className = "saved-workspace-registry-section";

  const heading = document.createElement("h2");
  heading.textContent = "Saved Workspace Registry";
  section.appendChild(heading);

  const help = document.createElement("p");
  help.className = "section-help";
  help.textContent = "Inspect saved Session DB workspaces without reopening tabs, changing browser windows, or replacing the active workspace runtime.";
  section.appendChild(help);

  const summary = document.createElement("div");
  summary.id = "savedWorkspaceRegistrySummary";
  summary.className = "workspace-session-summary";
  section.appendChild(summary);

  const selectorPanel = document.createElement("div");
  selectorPanel.className = "archive-browser-panel";

  const label = document.createElement("label");
  label.htmlFor = "savedWorkspaceSelect";
  label.textContent = "Saved Session DB Workspaces";
  selectorPanel.appendChild(label);

  const select = document.createElement("select");
  select.id = "savedWorkspaceSelect";
  selectorPanel.appendChild(select);

  section.appendChild(selectorPanel);

  const actions = document.createElement("div");
  actions.className = "workspace-session-actions";
  actions.appendChild(createButton("refreshSavedWorkspacesButton", "Refresh Saved Workspaces", "secondary-button"));
  actions.appendChild(createButton("inspectSavedWorkspaceButton", "Inspect Saved Workspace", "secondary-button"));
  actions.appendChild(createButton("copySavedWorkspaceInspectionButton", "Copy Inspection Packet", "secondary-button"));
  section.appendChild(actions);

  const status = document.createElement("p");
  status.id = "savedWorkspaceRegistryStatus";
  status.className = "status-message";
  section.appendChild(status);

  const card = document.createElement("div");
  card.id = "savedWorkspaceInspectionCard";
  card.className = "selected-archive-summary";
  card.textContent = "Select a saved workspace and inspect it here.";
  section.appendChild(card);

  const output = document.createElement("pre");
  output.id = "savedWorkspaceInspectionOutput";
  output.className = "diagnostics-output";
  output.textContent = "Saved workspace inspection packet will appear here.";
  section.appendChild(output);

  anchor.insertAdjacentElement("afterend", section);
}

function attachSavedWorkspaceRegistryHandlers() {
  document.getElementById("refreshSavedWorkspacesButton")?.addEventListener("click", refreshSavedWorkspaceRegistry);
  document.getElementById("inspectSavedWorkspaceButton")?.addEventListener("click", inspectSelectedSavedWorkspace);
  document.getElementById("copySavedWorkspaceInspectionButton")?.addEventListener("click", copySavedWorkspaceInspectionPacket);
  document.getElementById("savedWorkspaceSelect")?.addEventListener("change", inspectSelectedSavedWorkspace);
}

async function refreshSavedWorkspaceRegistry() {
  try {
    const workspaces = await listWorkspaceRecords();
    const activeWorkspaceId = await getActiveWorkspaceId();
    const select = document.getElementById("savedWorkspaceSelect");

    if (!select) return;

    const previousValue = select.value;
    clearElement(select);

    if (!workspaces.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No saved Session DB workspaces yet";
      select.appendChild(option);
      select.disabled = true;
      setSummary("Saved workspaces: 0 | Active DB workspace: none.");
      setStatus("No saved Session DB workspaces available yet.");
      await recordDiagnostic("info", "saved_workspace_registry_empty", "Saved workspace registry is empty.", {});
      return;
    }

    select.disabled = false;

    for (const workspace of workspaces) {
      const option = document.createElement("option");
      option.value = workspace.workspaceId;
      option.textContent = createWorkspaceOptionLabel(workspace, activeWorkspaceId);
      select.appendChild(option);
    }

    if (previousValue && workspaces.some((workspace) => workspace.workspaceId === previousValue)) {
      select.value = previousValue;
    } else if (activeWorkspaceId && workspaces.some((workspace) => workspace.workspaceId === activeWorkspaceId)) {
      select.value = activeWorkspaceId;
    }

    const pausedCount = workspaces.filter((workspace) => workspace.lifecycleState === "paused").length;
    const activeCount = workspaces.filter((workspace) => workspace.lifecycleState === "active").length;
    const archivedCount = workspaces.filter((workspace) => workspace.lifecycleState === "archived").length;

    setSummary("Saved workspaces: " + workspaces.length + " | Paused: " + pausedCount + " | Active DB records: " + activeCount + " | Archived: " + archivedCount + " | Active DB workspace: " + (activeWorkspaceId || "none") + ".");
    setStatus("Saved workspace registry refreshed.");
    await recordDiagnostic("info", "saved_workspace_registry_refreshed", "Saved workspace registry refreshed.", {
      workspaceCount: workspaces.length,
      activeWorkspaceId
    });
  } catch (error) {
    await handleRegistryError("saved_workspace_registry_refresh_failed", "Could not refresh saved workspace registry.", error);
  }
}

async function inspectSelectedSavedWorkspace() {
  try {
    const workspaceId = getSelectedWorkspaceId();

    if (!workspaceId) {
      setStatus("No saved workspace selected.");
      return null;
    }

    const inspection = await buildSavedWorkspaceInspection(workspaceId);
    renderInspectionCard(inspection);
    setOutput(inspection);
    setStatus("Inspected saved workspace: " + inspection.workspace.name + ". No browser tabs were reopened.");
    await recordDiagnostic("info", "saved_workspace_inspected", "Saved workspace inspected without reopening browser projection.", {
      workspaceId: inspection.workspace.workspaceId,
      name: inspection.workspace.name,
      tabCount: inspection.counts.tabs,
      timelineEventCount: inspection.counts.timelineEvents,
      sessionCount: inspection.counts.sessions,
      projectionCount: inspection.counts.projections
    });

    return inspection;
  } catch (error) {
    await handleRegistryError("saved_workspace_inspection_failed", "Could not inspect saved workspace.", error);
    return null;
  }
}

async function copySavedWorkspaceInspectionPacket() {
  try {
    const workspaceId = getSelectedWorkspaceId();

    if (!workspaceId) {
      setStatus("No saved workspace selected for inspection packet copy.");
      return;
    }

    const inspection = await buildSavedWorkspaceInspection(workspaceId);
    const packet = buildInspectionPacket(inspection);
    await navigator.clipboard.writeText(formatInspectionPacketForClipboard(packet));
    renderInspectionCard(inspection);
    setOutput(packet);
    setStatus("Saved workspace inspection packet copied. No browser tabs were reopened.");
    await recordDiagnostic("info", "saved_workspace_inspection_packet_copied", "Saved workspace inspection packet copied.", {
      workspaceId: inspection.workspace.workspaceId,
      name: inspection.workspace.name,
      schema: packet.extension.schema,
      tabCount: inspection.counts.tabs,
      timelineEventCount: inspection.counts.timelineEvents
    });
  } catch (error) {
    await handleRegistryError("saved_workspace_inspection_packet_copy_failed", "Could not copy saved workspace inspection packet.", error);
  }
}

async function buildSavedWorkspaceInspection(workspaceId) {
  const workspaces = await listWorkspaceRecords();
  const workspace = workspaces.find((record) => record.workspaceId === workspaceId);

  if (!workspace) {
    throw new Error("Saved workspace not found in Session DB: " + workspaceId);
  }

  const tabs = await getWorkspaceTabs(workspaceId);
  const sessions = await getWorkspaceSessions(workspaceId);
  const projections = await getWorkspaceProjections(workspaceId);
  const journalEntries = await getWorkspaceJournalEntries(workspaceId);
  const timelineEvents = await getWorkspaceTimelineEvents(workspaceId);
  const summaryCard = await getSummaryCardForWorkspace(workspaceId);
  const links = await getWorkspaceLinks(workspaceId);
  const constellations = await getConstellationsForWorkspace(workspace);

  return {
    inspectedAt: new Date().toISOString(),
    inspectionMode: "saved_workspace_no_projection",
    workspace,
    counts: {
      tabs: tabs.length,
      sessions: sessions.length,
      projections: projections.length,
      journalEntries: journalEntries.length,
      timelineEvents: timelineEvents.length,
      links: links.length,
      constellations: constellations.length
    },
    lifecycle: {
      lifecycleState: workspace.lifecycleState,
      latestSessionState: sessions[0]?.sessionState || "none",
      latestProjectionState: projections[0]?.projectionState || "none",
      latestProjectionMode: projections[0]?.projectionMode || "none"
    },
    summaryCard,
    deterministicReview: createDeterministicReview(workspace, summaryCard, tabs, sessions, projections, journalEntries, timelineEvents, links, constellations),
    tabs,
    sessions,
    projections,
    journalEntries,
    timelineEvents,
    links,
    constellations,
    availableActions: createAvailableActions(workspace, tabs, projections),
    safety: {
      browserProjectionOpened: false,
      browserTabsReopened: false,
      runtimeSourceOfTruthChanged: false,
      activeWorkspaceRuntimeSource: "chrome.storage.local"
    }
  };
}

async function getConstellationsForWorkspace(workspace) {
  if (!Array.isArray(workspace.constellationIds) || !workspace.constellationIds.length) {
    return [];
  }

  const results = [];

  for (const constellationId of workspace.constellationIds) {
    const constellation = await getConstellationRecord(constellationId);
    if (constellation) results.push(constellation);
  }

  return results;
}

function createDeterministicReview(workspace, summaryCard, tabs, sessions, projections, journalEntries, timelineEvents, links, constellations) {
  const latestSession = sessions[0] || null;
  const latestProjection = projections[0] || null;
  const recentEvents = timelineEvents.slice(0, 8).map((event) => ({
    type: event.type,
    message: event.message,
    createdAt: event.createdAt
  }));
  const roleSummary = createRoleSummary(tabs);

  return {
    title: workspace.name || "Untitled Workspace",
    purpose: workspace.aim || summaryCard?.workspaceAim || "No workspace aim recorded.",
    state: "Workspace is saved in Session DB as " + workspace.lifecycleState + " with projection state " + (latestProjection?.projectionState || "none") + ".",
    structure: {
      tabCount: tabs.length,
      roleSummary,
      journalEntryCount: journalEntries.length,
      timelineEventCount: timelineEvents.length,
      linkCount: links.length,
      constellationCount: constellations.length
    },
    summary: summaryCard?.deterministicSummary || "No deterministic summary card is available yet.",
    continuation: summaryCard?.continuationSummary || latestSession?.continuationNote || "No continuation note recorded.",
    recentEvents,
    interpretationBoundary: "This review is deterministic. It does not use AI inference and did not reopen browser tabs."
  };
}

function createAvailableActions(workspace, tabs, projections) {
  const latestProjection = projections[0] || null;

  return [
    {
      action: "inspect_saved_workspace",
      available: true,
      effect: "Review saved workspace state without opening browser projection."
    },
    {
      action: "copy_inspection_packet",
      available: true,
      effect: "Copy deterministic inspection packet for validation or AI-assisted review."
    },
    {
      action: "future_resume_workspace",
      available: tabs.length > 0,
      effect: "Deferred. Rehydrate tabs/groups/window from saved state."
    },
    {
      action: "future_archive_workspace",
      available: workspace.lifecycleState !== "archived",
      effect: "Deferred. Mark workspace as archived in Session DB."
    },
    {
      action: "future_constellation_link",
      available: true,
      effect: "Deferred. Link this workspace to a Workspace Constellation."
    },
    {
      action: "future_projection_review",
      available: Boolean(latestProjection),
      effect: "Deferred. Review saved projection evidence before rehydration."
    }
  ];
}

function renderInspectionCard(inspection) {
  const card = document.getElementById("savedWorkspaceInspectionCard");
  if (!card) return;

  clearElement(card);
  card.appendChild(createSummaryLine("Workspace", inspection.workspace.name || "Untitled Workspace"));
  card.appendChild(createSummaryLine("Aim", inspection.workspace.aim || "No aim recorded"));
  card.appendChild(createSummaryLine("Type", inspection.workspace.workspaceType || "unknown"));
  card.appendChild(createSummaryLine("Lifecycle", inspection.lifecycle.lifecycleState));
  card.appendChild(createSummaryLine("Projection", inspection.lifecycle.latestProjectionState + " / " + inspection.lifecycle.latestProjectionMode));
  card.appendChild(createSummaryLine("Tabs", String(inspection.counts.tabs)));
  card.appendChild(createSummaryLine("Sessions", String(inspection.counts.sessions)));
  card.appendChild(createSummaryLine("Timeline events", String(inspection.counts.timelineEvents)));
  card.appendChild(createSummaryLine("Journal entries", String(inspection.counts.journalEntries)));
  card.appendChild(createSummaryLine("Links", String(inspection.counts.links)));
  card.appendChild(createSummaryLine("Constellations", String(inspection.counts.constellations)));
  card.appendChild(createSummaryLine("Summary", inspection.deterministicReview.summary));
  card.appendChild(createSummaryLine("Continuation", inspection.deterministicReview.continuation));
}

function buildInspectionPacket(inspection) {
  return {
    packetType: "Chrome Flow Saved Workspace Inspection Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "saved-workspace-inspection-packet-v0.1"
    },
    source: {
      type: "saved_workspace_registry",
      workspaceId: inspection.workspace.workspaceId,
      runtimeSourceOfTruth: false,
      browserProjectionOpened: false
    },
    inspection,
    notes: [
      "This packet is generated locally by Chrome Flow.",
      "This packet inspects a saved Session DB workspace without reopening browser tabs or changing active runtime state.",
      "It does not intentionally include page content.",
      "Review before sharing because saved workspaces may include names, tab titles, URLs, notes, and system events.",
      "AI augmentation is deferred; this inspection is deterministic."
    ]
  };
}

function formatInspectionPacketForClipboard(packet) {
  return [
    "CHROME_FLOW_PACKET_START",
    "packetType: " + packet.packetType,
    "schema: " + packet.extension.schema,
    "clipboardFormat: chrome_flow_packet_envelope_v0.1",
    "createdAt: " + packet.createdAt,
    "contentType: application/json",
    "",
    JSON.stringify(packet, null, 2),
    "",
    "CHROME_FLOW_PACKET_END"
  ].join("\n");
}

function createWorkspaceOptionLabel(workspace, activeWorkspaceId) {
  const activeMarker = workspace.workspaceId === activeWorkspaceId ? " [active DB]" : "";
  const name = workspace.name || "Untitled Workspace";
  const type = workspace.workspaceType || "unknown";
  const state = workspace.lifecycleState || "unknown";
  return name + " | " + type + " | " + state + activeMarker;
}

function createRoleSummary(tabs) {
  const roles = new Map();

  tabs.forEach((tab) => {
    const role = tab.role || "unassigned";
    const current = roles.get(role) || { role, tabCount: 0 };
    current.tabCount += 1;
    roles.set(role, current);
  });

  return Array.from(roles.values()).sort((left, right) => left.role.localeCompare(right.role));
}

function getSelectedWorkspaceId() {
  return document.getElementById("savedWorkspaceSelect")?.value || "";
}

function createButton(id, text, className) {
  const button = document.createElement("button");
  button.id = id;
  button.type = "button";
  button.className = className;
  button.textContent = text;
  return button;
}

function createSummaryLine(label, value) {
  const line = document.createElement("div");
  line.className = "archive-summary-line";
  line.textContent = label + ": " + value;
  return line;
}

function setSummary(message) {
  const summary = document.getElementById("savedWorkspaceRegistrySummary");
  if (summary) summary.textContent = message;
}

function setStatus(message) {
  const status = document.getElementById("savedWorkspaceRegistryStatus");
  if (status) status.textContent = message;
}

function setOutput(value) {
  const output = document.getElementById("savedWorkspaceInspectionOutput");
  if (output) output.textContent = JSON.stringify(value, null, 2);
}

async function handleRegistryError(action, message, error) {
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
    console.warn("Chrome Flow saved workspace registry diagnostic record failed:", error);
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

function clearElement(element) {
  if (!element) return;

  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}
