const WORKSPACE_KEY = "chromeFlowWorkspace";
const DIAGNOSTICS_KEY = "chromeFlowDiagnostics";
const MAX_DIAGNOSTICS = 200;

installRemoveWorkspaceTabCleanup();

function installRemoveWorkspaceTabCleanup() {
  document.addEventListener("click", (event) => {
    const button = event.target?.closest?.(".remove-tab-button");

    if (!button) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    const workspaceTabId = button.dataset.workspaceTabId || "";

    if (!workspaceTabId) {
      return;
    }

    void removeWorkspaceTabAndCloseBrowserTab(workspaceTabId);
  }, true);
}

async function removeWorkspaceTabAndCloseBrowserTab(workspaceTabId) {
  const workspace = await getWorkspace();
  const tabIndex = workspace.tabs.findIndex((tab) => tab.workspaceTabId === workspaceTabId);

  if (tabIndex < 0) {
    setStatus("Could not find that workspace tab record.");
    await recordDiagnostic("warn", "workspace_tab_remove_cleanup_skipped", "Could not find workspace tab record for cleanup remove.", {
      workspaceTabId
    });
    return;
  }

  const workspaceTab = workspace.tabs[tabIndex];
  const liveTabs = await chrome.tabs.query({});
  const liveTab = resolveLiveTabForWorkspaceTab(workspaceTab, liveTabs);
  const confirmed = window.confirm("Remove this tab from the workspace and close the browser tab? Recovery will be available from the Recovery Journal.");

  if (!confirmed) {
    setStatus("Remove cancelled. No action was taken.");
    return;
  }

  const reason = window.prompt("Reason for removing this tab from the workspace and browser? This will be recorded in the System Journal and Recovery Journal.\n\nTab: " + getTabName(workspaceTab), "");

  if (reason === null) {
    setStatus("Remove cancelled. No action was taken.");
    return;
  }

  const tabSnapshot = createTabSnapshot(workspaceTab, workspace);
  let browserTabClosed = false;
  let closeError = null;

  if (liveTab) {
    try {
      await chrome.tabs.remove(liveTab.id);
      browserTabClosed = true;
    } catch (error) {
      closeError = summarizeError(error);
    }
  }

  workspace.tabs.splice(tabIndex, 1);
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);

  await addTimelineEvent(workspace, "workspace_tab_removed", "Removed " + snapshotName(tabSnapshot) + " from workspace" + (browserTabClosed ? " and closed the browser tab." : "."), {
    reason: reason.trim() || "No reason recorded.",
    tabSnapshot,
    workspaceTabId: tabSnapshot.workspaceTabId,
    browserTabClosed,
    browserTabFound: Boolean(liveTab),
    liveTabId: liveTab?.id ?? null,
    liveWindowId: liveTab?.windowId ?? null,
    liveGroupId: liveTab?.groupId ?? null,
    closeError,
    removeMode: "remove_workspace_and_close_browser_tab",
    recoveryActions: {
      canReopenUrl: true,
      canReaddToWorkspace: true
    }
  });

  await recordDiagnostic("info", "workspace_tab_removed_and_browser_closed", "Removed workspace tab record and attempted to close its browser tab.", {
    workspaceTabId: tabSnapshot.workspaceTabId,
    tabId: tabSnapshot.tabId,
    browserTabClosed,
    browserTabFound: Boolean(liveTab),
    liveTabId: liveTab?.id ?? null,
    liveGroupId: liveTab?.groupId ?? null,
    closeError
  });

  setStatus(browserTabClosed ? "Removed " + snapshotName(tabSnapshot) + " from workspace and closed the browser tab." : "Removed " + snapshotName(tabSnapshot) + " from workspace. Browser tab was not safely found or could not be closed.");
  window.setTimeout(() => window.location.reload(), 250);
}

function resolveLiveTabForWorkspaceTab(workspaceTab, liveTabs) {
  if (Number.isInteger(workspaceTab.tabId)) {
    const exact = liveTabs.find((tab) => tab.id === workspaceTab.tabId);

    if (exact) {
      return exact;
    }
  }

  const urlMatches = liveTabs.filter((tab) => workspaceTab.url && tab.url === workspaceTab.url);

  if (urlMatches.length === 1) {
    return urlMatches[0];
  }

  return null;
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

async function saveWorkspace(workspace) {
  await chrome.storage.local.set({ [WORKSPACE_KEY]: workspace });
}

async function addTimelineEvent(workspace, type, message, details = {}) {
  const event = {
    eventId: crypto.randomUUID(),
    type,
    message,
    createdAt: new Date().toISOString(),
    ...details
  };

  workspace.timeline.push(event);
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  return event;
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
    console.warn("Chrome Flow remove workspace tab cleanup diagnostics failed:", error);
  }
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

function createTabSnapshot(tab, workspace) {
  return {
    workspaceTabId: tab.workspaceTabId,
    tabId: tab.tabId,
    tabKey: tab.tabKey,
    windowId: tab.windowId,
    groupId: tab.groupId,
    url: tab.url,
    displayUrl: tab.displayUrl || createDisplayUrl(tab.url || ""),
    originalTitle: tab.originalTitle,
    alias: tab.alias || "",
    role: tab.role || "unassigned",
    workspaceType: workspace.workspaceType || "research",
    isOpen: tab.isOpen !== false,
    firstSeenAt: tab.firstSeenAt,
    lastSeenAt: tab.lastSeenAt,
    capturedAt: new Date().toISOString()
  };
}

function getTabName(tab) {
  return tab.alias || tab.originalTitle || tab.displayUrl || "Untitled tab";
}

function snapshotName(tabSnapshot) {
  return tabSnapshot.alias || tabSnapshot.originalTitle || tabSnapshot.displayUrl || "Untitled tab";
}

function createDisplayUrl(rawUrl) {
  if (!rawUrl) {
    return "";
  }

  try {
    const parsedUrl = new URL(rawUrl);
    const host = parsedUrl.hostname.replace(/^www\./, "");
    const path = parsedUrl.pathname === "/" ? "" : parsedUrl.pathname;
    const cleanUrl = host + path;

    if (cleanUrl.length <= 72) {
      return cleanUrl;
    }

    return cleanUrl.slice(0, 69) + "...";
  } catch (error) {
    return rawUrl.length <= 72 ? rawUrl : rawUrl.slice(0, 69) + "...";
  }
}

function setStatus(message) {
  const status = document.getElementById("intakeStatus");

  if (status) {
    status.textContent = message;
  }
}

function summarizeError(error) {
  if (!error) {
    return null;
  }

  return {
    name: error.name || "Error",
    message: error.message || String(error),
    stack: typeof error.stack === "string" ? error.stack.slice(0, 2000) : ""
  };
}
