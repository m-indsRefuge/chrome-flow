const WORKSPACE_KEY = "chromeFlowWorkspace";
const DIAGNOSTICS_KEY = "chromeFlowDiagnostics";
const MAX_DIAGNOSTICS = 200;

const intakeStatus = document.getElementById("intakeStatus");

installCombinedRecoveryHandler();

function installCombinedRecoveryHandler() {
  document.addEventListener("click", async (event) => {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    const button = target.closest("button");

    if (!button || !button.classList.contains("timeline-readd-workspace-button")) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    await readdWorkspaceTabWithBrowserRestore(button.dataset.eventId || "");
  }, true);
}

async function readdWorkspaceTabWithBrowserRestore(eventId) {
  const workspace = await getWorkspace();
  const timelineEvent = workspace.timeline.find((event) => event.eventId === eventId);

  if (!timelineEvent || !timelineEvent.tabSnapshot) {
    setIntakeStatus("Could not find a saved tab snapshot for this recovery event.");
    await recordDiagnostic("warn", "recovery_snapshot_not_found", "Re-add to Workspace could not find a saved tab snapshot.", { eventId });
    return;
  }

  const tabSnapshot = timelineEvent.tabSnapshot;
  const wasClosedTabEvent = timelineEvent.type === "browser_tab_closed_and_removed";
  const existing = findExistingWorkspaceTab(workspace, tabSnapshot);
  let restoredTabRecord = existing || createWorkspaceTabFromSnapshot(tabSnapshot);
  let browserTabReopened = false;
  let browserTabAlreadyOpen = false;
  let restoreMode = wasClosedTabEvent ? "readd_and_reopen_closed_tab" : "readd_workspace_record";

  if (wasClosedTabEvent) {
    const liveExisting = existing ? await findLiveBrowserTabForWorkspaceTab(existing) : { liveTab: null, status: "no_existing_record" };

    if (liveExisting.liveTab) {
      browserTabAlreadyOpen = true;
      updateWorkspaceTabFromBrowserTabInPlace(restoredTabRecord, liveExisting.liveTab, {
        isOpen: true,
        lastSeenAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString()
      });
      restoreMode = existing ? "existing_record_already_open" : restoreMode;
    } else if (tabSnapshot.url) {
      const createdTab = await chrome.tabs.create({ url: tabSnapshot.url, active: true });
      const browserTab = createBrowserTabSnapshot(createdTab, tabSnapshot);
      updateWorkspaceTabFromBrowserTabInPlace(restoredTabRecord, browserTab, {
        isOpen: true,
        lastSeenAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString()
      });
      browserTabReopened = true;
    }
  } else {
    const liveTab = await findLiveBrowserTabForWorkspaceTab(restoredTabRecord);

    if (liveTab.liveTab) {
      browserTabAlreadyOpen = true;
      updateWorkspaceTabFromBrowserTabInPlace(restoredTabRecord, liveTab.liveTab, {
        isOpen: true,
        lastSeenAt: new Date().toISOString()
      });
    }
  }

  if (!restoredTabRecord.workspaceTabId) {
    restoredTabRecord.workspaceTabId = crypto.randomUUID();
  }

  if (existing) {
    Object.assign(existing, restoredTabRecord);
  } else {
    workspace.tabs.push(restoredTabRecord);
  }

  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);

  const message = buildRecoveryMessage(tabSnapshot, {
    existing: Boolean(existing),
    browserTabReopened,
    browserTabAlreadyOpen,
    wasClosedTabEvent
  });

  await addTimelineEvent("workspace_tab_readded", message, {
    tabSnapshot: createTabSnapshot(restoredTabRecord, workspace),
    recoverySourceEventId: eventId,
    workspaceTabId: restoredTabRecord.workspaceTabId,
    browserTabReopened,
    browserTabAlreadyOpen,
    restoredExistingWorkspaceRecord: Boolean(existing),
    restoreMode
  });

  await recordDiagnostic("info", "recovery_readd_with_browser_restore", "Recovery re-add completed with browser restore policy.", {
    eventId,
    sourceEventType: timelineEvent.type,
    workspaceTabId: restoredTabRecord.workspaceTabId,
    browserTabReopened,
    browserTabAlreadyOpen,
    restoredExistingWorkspaceRecord: Boolean(existing),
    restoreMode
  });

  setIntakeStatus(message);
  reloadSoon();
}

function buildRecoveryMessage(tabSnapshot, result) {
  const name = snapshotName(tabSnapshot);

  if (result.browserTabReopened) {
    return "Re-added " + name + " to workspace and reopened the browser tab from Recovery View.";
  }

  if (result.browserTabAlreadyOpen && result.existing) {
    return name + " was already in the workspace and already open in the browser.";
  }

  if (result.existing) {
    return name + " was already in the workspace. The saved record was refreshed from Recovery View.";
  }

  if (result.wasClosedTabEvent) {
    return "Re-added " + name + " to workspace from Recovery View. Browser tab could not be reopened because no URL was saved.";
  }

  return "Re-added " + name + " to workspace from Recovery View.";
}

function findExistingWorkspaceTab(workspace, tabSnapshot) {
  if (tabSnapshot.workspaceTabId) {
    const byWorkspaceTabId = workspace.tabs.find((tab) => tab.workspaceTabId === tabSnapshot.workspaceTabId);

    if (byWorkspaceTabId) {
      return byWorkspaceTabId;
    }
  }

  if (Number.isInteger(tabSnapshot.tabId)) {
    const byTabId = workspace.tabs.find((tab) => tab.tabId === tabSnapshot.tabId);

    if (byTabId) {
      return byTabId;
    }
  }

  return null;
}

async function findLiveBrowserTabForWorkspaceTab(workspaceTab) {
  const browserTabs = await chrome.tabs.query({});

  if (Number.isInteger(workspaceTab.tabId)) {
    const exactTab = browserTabs.find((tab) => tab.id === workspaceTab.tabId);

    if (exactTab) {
      return { liveTab: createBrowserTabSnapshot(exactTab, workspaceTab), status: "exact_tab_id", candidateCount: 1 };
    }
  }

  const urlMatches = browserTabs.filter((tab) => workspaceTab.url && tab.url === workspaceTab.url);

  if (urlMatches.length === 1) {
    return { liveTab: createBrowserTabSnapshot(urlMatches[0], workspaceTab), status: "single_url_fallback", candidateCount: 1 };
  }

  if (urlMatches.length > 1) {
    return { liveTab: null, status: "ambiguous_url_matches", candidateCount: urlMatches.length };
  }

  return { liveTab: null, status: "not_found", candidateCount: 0 };
}

function createWorkspaceTabFromSnapshot(tabSnapshot) {
  const now = new Date().toISOString();
  return {
    workspaceTabId: tabSnapshot.workspaceTabId || crypto.randomUUID(),
    tabId: tabSnapshot.tabId,
    tabKey: tabSnapshot.tabKey,
    windowId: tabSnapshot.windowId,
    groupId: tabSnapshot.groupId,
    url: tabSnapshot.url,
    displayUrl: tabSnapshot.displayUrl || createDisplayUrl(tabSnapshot.url || ""),
    originalTitle: tabSnapshot.originalTitle,
    alias: tabSnapshot.alias || "",
    role: tabSnapshot.role || "unassigned",
    isOpen: tabSnapshot.isOpen !== false,
    firstSeenAt: tabSnapshot.firstSeenAt || now,
    lastSeenAt: now,
    recoveredAt: now
  };
}

function createBrowserTabSnapshot(tab, fallback = {}) {
  const title = tab.title || fallback.originalTitle || fallback.title || "";
  const url = tab.url || fallback.url || "";

  return {
    id: tab.id,
    tabKey: createTabKey({ url, title }),
    windowId: tab.windowId,
    groupId: tab.groupId,
    index: tab.index,
    title,
    url,
    active: tab.active,
    pinned: tab.pinned
  };
}

function updateWorkspaceTabFromBrowserTabInPlace(workspaceTab, browserTab, extraFields = {}) {
  Object.assign(workspaceTab, {
    ...workspaceTab,
    tabId: browserTab.id,
    tabKey: browserTab.tabKey,
    windowId: browserTab.windowId,
    groupId: browserTab.groupId,
    url: browserTab.url,
    displayUrl: createDisplayUrl(browserTab.url || ""),
    originalTitle: browserTab.title || workspaceTab.originalTitle,
    ...extraFields
  });
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

async function getWorkspace() {
  const result = await chrome.storage.local.get(WORKSPACE_KEY);
  const workspace = result[WORKSPACE_KEY] || null;

  if (!workspace) {
    return {
      workspaceId: crypto.randomUUID(),
      name: "",
      aim: "",
      workspaceType: "research",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tabs: [],
      journal: [],
      timeline: []
    };
  }

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

async function addTimelineEvent(type, message, details = {}) {
  const workspace = await getWorkspace();
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
    console.warn("Chrome Flow recovery diagnostics failed:", error);
  }
}

function snapshotName(tabSnapshot) {
  return tabSnapshot.alias || tabSnapshot.originalTitle || tabSnapshot.displayUrl || "Untitled tab";
}

function createTabKey(tab) {
  return (tab.url || "") + "::" + (tab.title || "");
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
    if (rawUrl.length <= 72) {
      return rawUrl;
    }

    return rawUrl.slice(0, 69) + "...";
  }
}

function setIntakeStatus(message) {
  if (intakeStatus) {
    intakeStatus.textContent = message;
  }
}

function reloadSoon() {
  window.setTimeout(() => {
    window.location.reload();
  }, 300);
}
