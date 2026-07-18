import { readCompatibleStorageValue } from "../core/constellation-storage-compatibility.js";
import { EVENT_IDENTITIES, STORAGE_IDENTITIES } from "../core/constellation-identity-contract.js";
import { getSidePanelRuntimeWorkspaceAuthority, RUNTIME_WORKSPACE_COMMIT_EVENT } from "../core/runtime-workspace-activation/side-panel-runtime.js";

const WORKSPACE_ARCHIVE_KEY = "chromeFlowWorkspaceArchive";
const DIAGNOSTICS_KEY = "chromeFlowDiagnostics";
const MAX_ARCHIVED_WORKSPACES = 20;
const MAX_DIAGNOSTICS = 200;
const runtimeWorkspaceAuthority = getSidePanelRuntimeWorkspaceAuthority();
let workspaceSessionSummaryRefreshPending = false;

installWorkspaceSessionControl();

async function installWorkspaceSessionControl() {
  renderWorkspaceSessionControl();
  await refreshWorkspaceSessionSurface();
  attachWorkspaceSessionHandlers();
  installWorkspaceSessionSummaryRefreshListeners();
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
  help.textContent = "Archive the current workspace trace, browse archived workspaces, copy packaged snapshots for debugging, or start a clean validation workspace without clearing Developer Diagnostics.";
  section.appendChild(help);

  const summary = document.createElement("div");
  summary.id = "workspaceSessionSummary";
  summary.className = "workspace-session-summary";
  section.appendChild(summary);

  const actions = document.createElement("div");
  actions.className = "workspace-session-actions";

  actions.appendChild(createButton("archiveWorkspaceButton", "Archive Current Workspace", "secondary-button"));
  actions.appendChild(createButton("archiveAndStartFreshButton", "Archive + Start Fresh Workspace", "secondary-button"));
  actions.appendChild(createButton("copyWorkspaceSnapshotButton", "Copy Active Workspace Packet", "secondary-button"));

  section.appendChild(actions);

  const archiveBrowser = document.createElement("div");
  archiveBrowser.className = "archive-browser-panel";

  const archiveLabel = document.createElement("label");
  archiveLabel.htmlFor = "archiveWorkspaceSelect";
  archiveLabel.textContent = "Archived Workspaces";
  archiveBrowser.appendChild(archiveLabel);

  const archiveSelect = document.createElement("select");
  archiveSelect.id = "archiveWorkspaceSelect";
  archiveBrowser.appendChild(archiveSelect);

  const archiveSummary = document.createElement("div");
  archiveSummary.id = "selectedArchiveSummary";
  archiveSummary.className = "selected-archive-summary";
  archiveBrowser.appendChild(archiveSummary);

  const archiveActions = document.createElement("div");
  archiveActions.className = "workspace-session-actions";
  archiveActions.appendChild(createButton("copySelectedArchiveSnapshotButton", "Copy Selected Archive Packet", "secondary-button"));
  archiveBrowser.appendChild(archiveActions);

  section.appendChild(archiveBrowser);

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
    await copyActiveWorkspacePacket();
  });

  document.getElementById("copySelectedArchiveSnapshotButton")?.addEventListener("click", async () => {
    await copySelectedArchivePacket();
  });

  document.getElementById("archiveWorkspaceSelect")?.addEventListener("change", async () => {
    await refreshSelectedArchiveSummary();
  });
}

async function refreshWorkspaceSessionSurface() {
  await refreshWorkspaceSessionSummary();
  await refreshArchiveSelector();
  await refreshSelectedArchiveSummary();
}

async function refreshWorkspaceSessionSummary() {
  const summary = document.getElementById("workspaceSessionSummary");

  if (!summary) {
    return;
  }

  try {
    const workspace = await getWorkspace();
    const archives = await getArchivedWorkspaces();
    const workspaceSummary = createWorkspaceSummary(workspace);
    summary.textContent = "Current workspace runtime: " + (workspaceSummary.name || "Untitled Workspace") + " | Tabs: " + workspaceSummary.tabCount + " | User notes: " + workspaceSummary.journalCount + " | System events: " + workspaceSummary.timelineCount + " | Archived workspaces: " + archives.length + ".";
  } catch (error) {
    summary.textContent = "Active runtime unavailable: " + (error?.message || "compatible workspace state could not be verified") + ".";
  }
}

function installWorkspaceSessionSummaryRefreshListeners() {
  const refresh = () => queueWorkspaceSessionSummaryRefresh();
  globalThis.addEventListener?.(RUNTIME_WORKSPACE_COMMIT_EVENT, refresh);
  globalThis.addEventListener?.(EVENT_IDENTITIES.workspaceLibrarySaveCompleted.canonical, refresh);
  globalThis.addEventListener?.(EVENT_IDENTITIES.workspaceLibrarySaveCompleted.legacy, refresh);
  chrome.storage.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    const active = STORAGE_IDENTITIES.activeWorkspace;
    const archive = STORAGE_IDENTITIES.workspaceArchive;
    if ([active.canonicalKey, active.legacyKey, archive.canonicalKey, archive.legacyKey].some((key) => key && Object.hasOwn(changes, key))) queueWorkspaceSessionSummaryRefresh();
  });
}

function queueWorkspaceSessionSummaryRefresh() {
  if (workspaceSessionSummaryRefreshPending) return;
  workspaceSessionSummaryRefreshPending = true;
  window.setTimeout(() => {
    workspaceSessionSummaryRefreshPending = false;
    void refreshWorkspaceSessionSummary();
  }, 0);
}

async function refreshArchiveSelector() {
  const archiveSelect = document.getElementById("archiveWorkspaceSelect");

  if (!archiveSelect) {
    return;
  }

  const previousSelection = archiveSelect.value;
  const archives = await getArchivedWorkspaces();
  clearElement(archiveSelect);

  if (!archives.length) {
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "No archived workspaces yet";
    archiveSelect.appendChild(emptyOption);
    archiveSelect.disabled = true;
    document.getElementById("copySelectedArchiveSnapshotButton")?.setAttribute("disabled", "disabled");
    return;
  }

  archiveSelect.disabled = false;
  document.getElementById("copySelectedArchiveSnapshotButton")?.removeAttribute("disabled");

  archives.forEach((archive) => {
    const option = document.createElement("option");
    option.value = archive.archiveId;
    option.textContent = archive.archiveName + " | Tabs: " + (archive.summary?.tabCount ?? 0) + " | Events: " + (archive.summary?.timelineCount ?? 0);
    archiveSelect.appendChild(option);
  });

  if (previousSelection && archives.some((archive) => archive.archiveId === previousSelection)) {
    archiveSelect.value = previousSelection;
  }
}

async function refreshSelectedArchiveSummary() {
  const summary = document.getElementById("selectedArchiveSummary");
  const archiveSelect = document.getElementById("archiveWorkspaceSelect");

  if (!summary || !archiveSelect) {
    return;
  }

  const archives = await getArchivedWorkspaces();
  const selectedArchive = archives.find((archive) => archive.archiveId === archiveSelect.value);

  clearElement(summary);

  if (!selectedArchive) {
    summary.textContent = "No archive selected.";
    return;
  }

  const archiveSummary = selectedArchive.summary || createWorkspaceSummary(selectedArchive.workspace || {});
  summary.appendChild(createArchiveSummaryLine("Archive", selectedArchive.archiveName));
  summary.appendChild(createArchiveSummaryLine("Reason", selectedArchive.reason || "unknown"));
  summary.appendChild(createArchiveSummaryLine("Workspace", archiveSummary.name || "Untitled Workspace"));
  summary.appendChild(createArchiveSummaryLine("Type", archiveSummary.workspaceType || "unknown"));
  summary.appendChild(createArchiveSummaryLine("Tabs", String(archiveSummary.tabCount || 0)));
  summary.appendChild(createArchiveSummaryLine("User notes", String(archiveSummary.journalCount || 0)));
  summary.appendChild(createArchiveSummaryLine("System events", String(archiveSummary.timelineCount || 0)));
}

function createArchiveSummaryLine(label, value) {
  const line = document.createElement("div");
  line.className = "archive-summary-line";
  line.textContent = label + ": " + value;
  return line;
}

async function archiveCurrentWorkspaceOnly() {
  const workspace = await getWorkspace();
  const confirmed = window.confirm("Archive the current workspace and close its browser tabs? Chrome Flow will close only tabs that belong to this workspace. If those are the only tabs in a window, Chrome may close that window. Unrelated tabs stay open.");

  if (!confirmed) {
    setStatus("Archive cancelled. No action was taken.");
    return;
  }

  const archiveRecord = await archiveWorkspace(workspace, "manual_archive");
  const closePlan = await buildWorkspaceBrowserClosePlan(workspace);
  await recordWorkspaceBrowserClosePlan(archiveRecord, closePlan, "archive_current_workspace");
  setStatus("Archived current workspace: " + archiveRecord.archiveName + ". Closing " + closePlan.liveTabCount + " workspace tab(s). Unrelated tabs stay open.");
  await refreshWorkspaceSessionSurface();
  await closeWorkspaceBrowserProjectionFromPlan(closePlan);
}

async function archiveCurrentAndStartFreshWorkspace() {
  const workspace = await getWorkspace();
  const authorityState = await runtimeWorkspaceAuthority.bootstrapExisting({ workspace, force: true });
  if (authorityState.status !== "active") {
    setStatus("Start Fresh is disabled until this panel has verified workspace authority: " + (authorityState.reason || "unknown_reason") + ".");
    return;
  }
  const confirmed = window.confirm("Archive the current workspace, close its workspace tabs, and start a clean workspace? Chrome Flow will close only tabs that belong to this workspace. Unrelated tabs stay open.");

  if (!confirmed) {
    setStatus("Start fresh cancelled. No action was taken.");
    return;
  }

  const archiveRecord = await archiveWorkspace(workspace, "archive_before_start_fresh");
  const closePlan = await buildWorkspaceBrowserClosePlan(workspace);
  const freshWorkspace = createFreshWorkspace();
  const replacementState = await runtimeWorkspaceAuthority.replaceActive(freshWorkspace, authorityState.result.sourceWindowId);
  if (replacementState.status !== "active" || replacementState.result?.activeWorkspaceId !== freshWorkspace.workspaceId) {
    setStatus("The archive was preserved, but the fresh workspace did not become active because replacement authority was not verified.");
    await recordDiagnostic("error", "workspace_start_fresh_activation_failed", "Fresh workspace replacement authority was not verified.", { archivedWorkspaceId: workspace.workspaceId || "", archiveId: archiveRecord.archiveId, activation: replacementState });
    return;
  }
  await recordDiagnostic("info", "workspace_started_fresh", "Archived current workspace, prepared browser projection close, and started a fresh active workspace.", {
    archivedWorkspaceId: workspace.workspaceId || "",
    archiveId: archiveRecord.archiveId,
    newWorkspaceId: freshWorkspace.workspaceId,
    archiveName: archiveRecord.archiveName,
    closePlan: summarizeWorkspaceBrowserClosePlan(closePlan),
    activation: replacementState.result
  });
  await recordWorkspaceBrowserClosePlan(archiveRecord, closePlan, "archive_and_start_fresh_workspace");
  setStatus("Archived " + archiveRecord.archiveName + ", started a fresh workspace, and closing " + closePlan.liveTabCount + " workspace tab(s). Unrelated tabs stay open.");
  await refreshWorkspaceSessionSurface();
  await closeWorkspaceBrowserProjectionFromPlan(closePlan);
  window.setTimeout(() => window.location.reload(), 500);
}

async function copyActiveWorkspacePacket() {
  try {
    const workspace = await getWorkspace();
    const archives = await getArchivedWorkspaces();
    const packet = buildActiveWorkspacePacket(workspace, archives);

    await navigator.clipboard.writeText(JSON.stringify(packet, null, 2));
    await recordDiagnostic("info", "workspace_packet_copied", "Active workspace packet copied to clipboard.", {
      workspaceId: workspace.workspaceId || "",
      tabCount: Array.isArray(workspace.tabs) ? workspace.tabs.length : 0,
      journalCount: Array.isArray(workspace.journal) ? workspace.journal.length : 0,
      timelineCount: Array.isArray(workspace.timeline) ? workspace.timeline.length : 0,
      archiveCount: archives.length,
      schema: packet.extension.schema
    });
    setStatus("Active workspace packet copied. Review before sharing because it may include tab titles, URLs, and notes.");
  } catch (error) {
    await recordDiagnostic("error", "workspace_packet_copy_failed", "Active workspace packet copy failed.", {
      error: summarizeError(error)
    });
    setStatus("Could not copy active workspace packet. Check clipboard permissions or browser console.");
  }
}

async function copySelectedArchivePacket() {
  try {
    const archiveSelect = document.getElementById("archiveWorkspaceSelect");
    const archives = await getArchivedWorkspaces();
    const selectedArchive = archives.find((archive) => archive.archiveId === archiveSelect?.value);

    if (!selectedArchive) {
      setStatus("No archived workspace selected.");
      await recordDiagnostic("warn", "archive_packet_copy_skipped", "No archived workspace was selected for packet copy.", {
        archiveCount: archives.length
      });
      return;
    }

    const packet = buildSelectedArchivePacket(selectedArchive, archives);
    await navigator.clipboard.writeText(JSON.stringify(packet, null, 2));
    await recordDiagnostic("info", "archive_packet_copied", "Selected archived workspace packet copied to clipboard.", {
      archiveId: selectedArchive.archiveId,
      archiveName: selectedArchive.archiveName,
      summary: selectedArchive.summary,
      schema: packet.extension.schema
    });
    setStatus("Archive packet copied for: " + selectedArchive.archiveName + ". Review before sharing because it may include tab titles, URLs, notes, and system events.");
  } catch (error) {
    await recordDiagnostic("error", "archive_packet_copy_failed", "Selected archived workspace packet copy failed.", {
      error: summarizeError(error)
    });
    setStatus("Could not copy selected archive packet. Check clipboard permissions or browser console.");
  }
}

function buildActiveWorkspacePacket(workspace, archives) {
  return {
    packetType: "Chrome Flow Workspace Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "workspace-packet-v0.2"
    },
    source: {
      type: "active_workspace",
      workspaceId: workspace.workspaceId || ""
    },
    activeWorkspace: workspace,
    archiveSummary: createArchiveSummaryList(archives),
    notes: createPacketNotes("active workspace")
  };
}

function buildSelectedArchivePacket(selectedArchive, archives) {
  return {
    packetType: "Chrome Flow Archived Workspace Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "archived-workspace-packet-v0.1"
    },
    source: {
      type: "archived_workspace",
      archiveId: selectedArchive.archiveId,
      archivedAt: selectedArchive.archivedAt,
      reason: selectedArchive.reason || "unknown"
    },
    selectedArchive: {
      archiveId: selectedArchive.archiveId,
      archiveName: selectedArchive.archiveName,
      archivedAt: selectedArchive.archivedAt,
      reason: selectedArchive.reason,
      summary: selectedArchive.summary,
      workspace: selectedArchive.workspace
    },
    archiveSummary: createArchiveSummaryList(archives),
    notes: createPacketNotes("archived workspace")
  };
}

function createArchiveSummaryList(archives) {
  return archives.map((archive) => ({
    archiveId: archive.archiveId,
    archiveName: archive.archiveName,
    archivedAt: archive.archivedAt,
    reason: archive.reason,
    summary: archive.summary
  }));
}

function createPacketNotes(sourceLabel) {
  return [
    "This packet is generated locally by Chrome Flow.",
    "This is " + getIndefiniteArticle(sourceLabel) + " " + sourceLabel + " packet prepared for debugging or build validation.",
    "It may include workspace names, tab titles, URLs, User Journal notes, System Journal events, and Recovery Journal data.",
    "Review before sharing if workspace data is sensitive."
  ];
}

function getIndefiniteArticle(label) {
  return /^[aeiou]/i.test(label || "") ? "an" : "a";
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

async function buildWorkspaceBrowserClosePlan(workspace) {
  const requestedTabIds = getWorkspaceTabIds(workspace);

  if (!globalThis.chrome?.tabs?.get || !globalThis.chrome?.tabs?.query || !globalThis.chrome?.tabs?.remove) {
    return {
      available: false,
      reason: "chrome_tabs_api_unavailable",
      requestedTabIds,
      liveTabs: [],
      missingTabIds: requestedTabIds,
      liveTabCount: 0,
      closeTabIds: [],
      fullyOwnedWindowIds: [],
      partialWindowIds: []
    };
  }

  const liveTabs = [];
  const missingTabIds = [];

  for (const tabId of requestedTabIds) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.id) {
        liveTabs.push({
          tabId: tab.id,
          windowId: tab.windowId,
          title: tab.title || "",
          url: tab.url || ""
        });
      } else {
        missingTabIds.push(tabId);
      }
    } catch (_error) {
      missingTabIds.push(tabId);
    }
  }

  const closeTabIds = liveTabs.map((tab) => tab.tabId);
  const windowIds = Array.from(new Set(liveTabs.map((tab) => tab.windowId).filter((windowId) => Number.isInteger(windowId))));
  const fullyOwnedWindowIds = [];
  const partialWindowIds = [];

  for (const windowId of windowIds) {
    try {
      const windowTabs = await chrome.tabs.query({ windowId });
      const windowTabIds = windowTabs.map((tab) => tab.id).filter((tabId) => Number.isInteger(tabId));
      const workspaceTabIdsInWindow = liveTabs.filter((tab) => tab.windowId === windowId).map((tab) => tab.tabId);
      const unrelatedTabIds = windowTabIds.filter((tabId) => !workspaceTabIdsInWindow.includes(tabId));

      if (unrelatedTabIds.length === 0) {
        fullyOwnedWindowIds.push(windowId);
      } else {
        partialWindowIds.push(windowId);
      }
    } catch (_error) {
      partialWindowIds.push(windowId);
    }
  }

  return {
    available: true,
    reason: "workspace_tab_close_plan_ready",
    requestedTabIds,
    liveTabs,
    missingTabIds,
    liveTabCount: liveTabs.length,
    closeTabIds,
    fullyOwnedWindowIds,
    partialWindowIds
  };
}

async function recordWorkspaceBrowserClosePlan(archiveRecord, closePlan, action) {
  await recordDiagnostic("info", "workspace_archive_browser_close_plan_prepared", "Workspace archive browser close plan prepared.", {
    action,
    archiveId: archiveRecord.archiveId,
    archiveName: archiveRecord.archiveName,
    closePlan: summarizeWorkspaceBrowserClosePlan(closePlan),
    safety: {
      closesOnlyWorkspaceTabs: true,
      unrelatedTabsClosed: false,
      closesWholeWindowOnlyWhenAllWindowTabsBelongToWorkspace: true
    }
  });
}

async function closeWorkspaceBrowserProjectionFromPlan(closePlan) {
  if (!closePlan.available) {
    setStatus("Workspace archived, but Chrome tab closing is unavailable in this browser context.");
    return;
  }

  if (!closePlan.closeTabIds.length) {
    setStatus("Workspace archived. No live workspace tabs were found to close.");
    return;
  }

  try {
    await recordDiagnostic("info", "workspace_archive_browser_close_started", "Closing archived workspace browser tabs.", summarizeWorkspaceBrowserClosePlan(closePlan));
    await chrome.tabs.remove(closePlan.closeTabIds);
    await recordDiagnostic("info", "workspace_archive_browser_close_completed", "Archived workspace browser tabs closed.", summarizeWorkspaceBrowserClosePlan(closePlan));
  } catch (error) {
    await recordDiagnostic("error", "workspace_archive_browser_close_failed", "Could not close archived workspace browser tabs.", {
      error: summarizeError(error),
      closePlan: summarizeWorkspaceBrowserClosePlan(closePlan)
    });
    setStatus("Workspace archived, but Chrome Flow could not close one or more workspace tabs. Check Developer Diagnostics.");
  }
}

function summarizeWorkspaceBrowserClosePlan(closePlan) {
  return {
    available: closePlan.available,
    reason: closePlan.reason,
    requestedTabCount: closePlan.requestedTabIds.length,
    liveTabCount: closePlan.liveTabCount,
    missingTabCount: closePlan.missingTabIds.length,
    closeTabCount: closePlan.closeTabIds.length,
    fullyOwnedWindowIds: closePlan.fullyOwnedWindowIds,
    partialWindowIds: closePlan.partialWindowIds
  };
}

function getWorkspaceTabIds(workspace) {
  const tabs = Array.isArray(workspace.tabs) ? workspace.tabs : [];
  const tabIds = tabs
    .map((tab) => Number(tab?.tabId))
    .filter((tabId) => Number.isInteger(tabId) && tabId > 0);

  return Array.from(new Set(tabIds));
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
  const compatibleRead = await readCompatibleStorageValue("activeWorkspace");
  if (compatibleRead.conflict) throw new Error("canonical and legacy active-runtime peers conflict");
  if (!compatibleRead.canonicalPresent || !compatibleRead.legacyPresent || !compatibleRead.equivalent || !compatibleRead.value) throw new Error("compatible active-runtime peers are incomplete");
  const workspace = compatibleRead.value;
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

function clearElement(element) {
  if (!element) {
    return;
  }

  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}
