const WORKSPACE_KEY = "chromeFlowWorkspace";
const WORKSPACE_ARCHIVE_KEY = "chromeFlowWorkspaceArchive";
const DIAGNOSTICS_KEY = "chromeFlowDiagnostics";
const MAX_ARCHIVED_WORKSPACES = 20;
const MAX_DIAGNOSTICS = 200;

installWorkspaceSessionControl();

async function installWorkspaceSessionControl() {
  renderWorkspaceSessionControl();
  await refreshWorkspaceSessionSummary();
  attachWorkspaceSessionHandlers();
}

function renderWorkspaceSessionControl() {
  const existing = document.getElementById("workspaceSessionControlSection");

  if (existing) {
    return;
  }

  const workspaceSection = document.querySelector(".workspace-section");

  if (!workspaceSection) {
    return;
  }

  const section = document.createElement("section");
  section.id = "workspaceSessionControlSection";
  section.className = "workspace-session-control-section";

  const heading = document.createElement("h2");
  heading.textContent = "Workspace Session Control";
  section.appendChild(heading);

  const help = document.createElement("p");
  help.className = "section-help";
  help.textContent = "Archive the current workspace trace, copy a snapshot for debugging, or start a clean validation workspace without clearing Developer Diagnostics.";
  section.appendChild(help);

  const summary = document.createElement("div");
  summary.id = "workspaceSessionSummary";
  summary.className = "workspace-session-summary";
  section.appendChild(summary);

  const actions = document.createElement("div");
  actions.className = "workspace-session-actions";

  actions.appendChild(createButton("archiveWorkspaceButton", "Archive Current Workspace", "secondary-button"));
  actions.appendChild(createButton("archiveAndStartFreshButton", "Archive + Start Fresh Workspace", "secondary-button"));
  actions.appendChild(createButton("copyWorkspaceSnapshotButton", "Copy Workspace Snapshot", "secondary-button"));

  section.appendChild(actions);

  const status = document.createElement("p");
  status.id = "workspaceSessionStatus";
  status.className = "status-message";
  section.appendChild(status);

  workspaceSection.insertAdjacentElement("afterend", section);
}

function createButton(id, text, className) {
  const button = document.createElement("button");
  button.id = id;
  button.type = "button";
  button.className = className;
  button.textContent = text;
  return button;
}

function attachWorkspaceSessionHandlers() {
  document.getElementById("archiveWorkspaceButton")?.addEventListener("click", async () => {
    await archiveCurrentWorkspaceOnly();
  });

  document.getElementById("archiveAndStartFreshButton")?.addEventListener("click", async () => {
    await archiveCurrentAndStartFreshWorkspace();
  });

  document.getElementById("copyWorkspaceSnapshotButton")?.addEventListener("click", async () => {
    await copyWorkspaceSnapshot();
  });
}

async function refreshWorkspaceSessionSummary() {
  const summary = document.getElementById("workspaceSessionSummary");

  if (!summary) {
    return;
  }

  const workspace = await getWorkspace();
  const archives = await getArchivedWorkspaces();
  const tabCount = Array.isArray(workspace.tabs) ? workspace.tabs.length : 0;
  const journalCount = Array.isArray(workspace.journal) ? workspace.journal.length : 0;
  const timelineCount = Array.isArray(workspace.timeline) ? workspace.timeline.length : 0;

  summary.textContent = "Active: " + (workspace.name || "Untitled Workspace") + " | Tabs: " + tabCount + " | User notes: " + journalCount + " | System events: " + timelineCount + " | Archived workspaces: " + archives.length + ".";
}

async function archiveCurrentWorkspaceOnly() {
  const workspace = await getWorkspace();
  const confirmed = window.confirm("Archive the current workspace trace? This keeps the active workspace as-is and stores a copy in local Chrome storage.");

  if (!confirmed) {
    setStatus("Archive cancelled. No action was taken.");
    return;
  }

  const archiveRecord = await archiveWorkspace(workspace, "manual_archive");
  setStatus("Archived current workspace: " + archiveRecord.archiveName + ". Active workspace was not changed.");
  await refreshWorkspaceSessionSummary();
}

async function archiveCurrentAndStartFreshWorkspace() {
  const workspace = await getWorkspace();
  const confirmed = window.confirm("Archive the current workspace trace and start a clean workspace? Browser tabs and Developer Diagnostics will not be cleared.");

  if (!confirmed) {
    setStatus("Start fresh cancelled. No action was taken.");
    return;
  }

  const archiveRecord = await archiveWorkspace(workspace, "archive_before_start_fresh");
  const freshWorkspace = createFreshWorkspace();
  await chrome.storage.local.set({ [WORKSPACE_KEY]: freshWorkspace });
  await recordDiagnostic("info", "workspace_started_fresh", "Archived current workspace and started a fresh active workspace.", {
    archivedWorkspaceId: workspace.workspaceId || "",
    archiveId: archiveRecord.archiveId,
    newWorkspaceId: freshWorkspace.workspaceId,
    archiveName: archiveRecord.archiveName
  });
  setStatus("Archived " + archiveRecord.archiveName + " and started a fresh workspace. Reloading...");
  window.setTimeout(() => window.location.reload(), 500);
}

async function copyWorkspaceSnapshot() {
  try {
    const workspace = await getWorkspace();
    const archives = await getArchivedWorkspaces();
    const snapshot = {
      packetType: "Chrome Flow Workspace Snapshot",
      createdAt: new Date().toISOString(),
      activeWorkspace: workspace,
      archiveSummary: archives.map((archive) => ({
        archiveId: archive.archiveId,
        archiveName: archive.archiveName,
        archivedAt: archive.archivedAt,
        reason: archive.reason,
        summary: archive.summary
      })),
      notes: [
        "This snapshot is generated locally by Chrome Flow.",
        "It may include workspace names, tab titles, URLs, User Journal notes, System Journal events, and Recovery Journal data.",
        "Review before sharing if workspace data is sensitive."
      ]
    };

    await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
    await recordDiagnostic("info", "workspace_snapshot_copied", "Workspace snapshot copied to clipboard.", {
      workspaceId: workspace.workspaceId || "",
      tabCount: Array.isArray(workspace.tabs) ? workspace.tabs.length : 0,
      journalCount: Array.isArray(workspace.journal) ? workspace.journal.length : 0,
      timelineCount: Array.isArray(workspace.timeline) ? workspace.timeline.length : 0,
      archiveCount: archives.length
    });
    setStatus("Workspace snapshot copied. Review before sharing because it may include tab titles, URLs, and notes.");
  } catch (error) {
    await recordDiagnostic("error", "workspace_snapshot_copy_failed", "Workspace snapshot copy failed.", {
      error: summarizeError(error)
    });
    setStatus("Could not copy workspace snapshot. Check clipboard permissions or browser console.");
  }
}

async function archiveWorkspace(workspace, reason) {
  const archives = await getArchivedWorkspaces();
  const archivedAt = new Date().toISOString();
  const archiveName = buildArchiveName(workspace, archivedAt);
  const archiveRecord = {
    archiveId: crypto.randomUUID(),
    archiveName,
    archivedAt,
    reason,
    summary: createWorkspaceSummary(workspace),
    workspace: JSON.parse(JSON.stringify(workspace))
  };

  const nextArchives = [archiveRecord, ...archives].slice(0, MAX_ARCHIVED_WORKSPACES);
  await chrome.storage.local.set({ [WORKSPACE_ARCHIVE_KEY]: nextArchives });
  await recordDiagnostic("info", "workspace_archived", "Workspace archived into local Chrome storage.", {
    archiveId: archiveRecord.archiveId,
    archiveName: archiveRecord.archiveName,
    reason,
    summary: archiveRecord.summary,
    archiveCount: nextArchives.length,
    maxArchivedWorkspaces: MAX_ARCHIVED_WORKSPACES
  });

  return archiveRecord;
}

function buildArchiveName(workspace, archivedAt) {
  const name = (workspace.name || "Untitled Workspace").trim() || "Untitled Workspace";
  return name + " @ " + archivedAt;
}

function createWorkspaceSummary(workspace) {
  return {
    workspaceId: workspace.workspaceId || "",
    name: workspace.name || "",
    workspaceType: workspace.workspaceType || "unknown",
    tabCount: Array.isArray(workspace.tabs) ? workspace.tabs.length : 0,
    journalCount: Array.isArray(workspace.journal) ? workspace.journal.length : 0,
    timelineCount: Array.isArray(workspace.timeline) ? workspace.timeline.length : 0,
    createdAt: workspace.createdAt || "",
    updatedAt: workspace.updatedAt || ""
  };
}

function createFreshWorkspace() {
  const now = new Date().toISOString();
  return {
    workspaceId: crypto.randomUUID(),
    name: "Untitled Workspace",
    aim: "",
    workspaceType: "research",
    createdAt: now,
    updatedAt: now,
    tabs: [],
    journal: [],
    timeline: []
  };
}

async function getWorkspace() {
  const result = await chrome.storage.local.get(WORKSPACE_KEY);
  const workspace = result[WORKSPACE_KEY] || createFreshWorkspace();
  return {
    ...workspace,
    tabs: Array.isArray(workspace.tabs) ? workspace.tabs : [],
    journal: Array.isArray(workspace.journal) ? workspace.journal : [],
    timeline: Array.isArray(workspace.timeline) ? workspace.timeline : []
  };
}

async function getArchivedWorkspaces() {
  const result = await chrome.storage.local.get(WORKSPACE_ARCHIVE_KEY);
  return Array.isArray(result[WORKSPACE_ARCHIVE_KEY]) ? result[WORKSPACE_ARCHIVE_KEY] : [];
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
    console.warn("Chrome Flow workspace session diagnostics failed:", error);
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

function setStatus(message) {
  const status = document.getElementById("workspaceSessionStatus");

  if (status) {
    status.textContent = message;
  }
}
