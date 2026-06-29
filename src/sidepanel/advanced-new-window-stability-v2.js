import {
  DEFAULT_WORKSPACE_TYPE,
  getWorkspaceRoleLabel,
  getWorkspaceRoles
} from "../core/workspace-role-sets.js";

const WORKSPACE_KEY = "chromeFlowWorkspace";
const DIAGNOSTICS_KEY = "chromeFlowDiagnostics";
const MAX_DIAGNOSTICS = 200;
const WINDOW_SETTLE_DELAY_MS = 600;

let moveInProgress = false;

installStableNewWindowMoveV2();

function installStableNewWindowMoveV2() {
  const button = document.getElementById("moveWorkspaceTabsToNewWindowButton");

  if (!button) {
    return;
  }

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    void moveWorkspaceTabsIntoNewWindowStableV2();
  }, true);
}

async function moveWorkspaceTabsIntoNewWindowStableV2() {
  if (moveInProgress) {
    setStatus("Move Workspace Into New Window is already running. Please wait for it to finish.");
    await recordDiagnostic("warn", "workspace_tabs_new_window_in_progress", "Move Workspace Into New Window was clicked while another move was still in progress.");
    return;
  }

  moveInProgress = true;
  const button = document.getElementById("moveWorkspaceTabsToNewWindowButton");

  if (button) {
    button.disabled = true;
  }

  let workspace = null;
  let newWindowId = null;

  try {
    setStatus("Moving workspace into a new Chrome window...");
    workspace = await getWorkspace();
    const resolution = await resolveWorkspaceTabsToLiveTabs(workspace);
    const liveResults = resolution.results.filter((result) => result.liveTab);

    if (!liveResults.length) {
      await addTimelineEvent(workspace, "workspace_tabs_new_window_skipped", "No open workspace tabs were found to move into a new Chrome window.", {
        resolutionMode: "stable_one_to_one",
        newWindowCreationMode: "primary_tab_new_window_focus_recovery_v2"
      });
      await recordDiagnostic("warn", "workspace_tabs_new_window_skipped", "No open workspace tabs were found to move into a new Chrome window.");
      setStatus("No open workspace tabs found to move into a new window.");
      return;
    }

    const sortedResults = sortResultsByRoleOrder(workspace, liveResults);
    const primaryResult = sortedResults[0];
    const remainingResults = sortedResults.slice(1);
    const movedTabIds = sortedResults.map((result) => result.liveTab.id);
    const workspaceTabIds = sortedResults.map((result) => result.workspaceTab.workspaceTabId);

    const newWindow = await chrome.windows.create({
      tabId: primaryResult.liveTab.id,
      focused: true,
      state: "normal"
    });

    newWindowId = newWindow.id;
    await focusNormalWindow(newWindowId);
    await delay(WINDOW_SETTLE_DELAY_MS);

    if (remainingResults.length) {
      await chrome.tabs.move(
        remainingResults.map((result) => result.liveTab.id),
        {
          windowId: newWindowId,
          index: -1
        }
      );
    }

    await delay(WINDOW_SETTLE_DELAY_MS);
    await focusNormalWindow(newWindowId);
    await refreshWorkspaceTabMetadataAfterBrowserAction(workspace);

    const postMoveResolution = await resolveWorkspaceTabsToLiveTabs(workspace);
    const groupSummary = await recreateChromeGroupsInWindow(workspace, postMoveResolution.results, newWindowId);
    await delay(WINDOW_SETTLE_DELAY_MS);
    await focusNormalWindow(newWindowId);
    await refreshWorkspaceTabMetadataAfterBrowserAction(workspace);

    const finalWindow = await getWindowSummary(newWindowId);

    await addTimelineEvent(workspace, "workspace_tabs_moved_to_new_window", "Moved " + movedTabIds.length + " open workspace tab(s) into a new Chrome window and recreated " + groupSummary.groups.length + " workspace Chrome group(s).", {
      newWindowId,
      primaryTabId: primaryResult.liveTab.id,
      tabIds: movedTabIds,
      workspaceTabIds,
      resolutionMode: "stable_one_to_one",
      newWindowCreationMode: "primary_tab_new_window_focus_recovery_v2",
      finalWindow,
      recreatedChromeGroups: true,
      recreatedGroupCount: groupSummary.groups.length,
      groupedTabCount: groupSummary.groupedTabCount,
      groups: groupSummary.groups
    });

    await recordDiagnostic("info", "workspace_tabs_moved_to_new_window", "Moved workspace tabs into a new Chrome window using v2 focus recovery and recreated workspace Chrome groups.", {
      newWindowId,
      tabIds: movedTabIds,
      workspaceTabIds,
      newWindowCreationMode: "primary_tab_new_window_focus_recovery_v2",
      finalWindow,
      recreatedChromeGroups: true,
      recreatedGroupCount: groupSummary.groups.length,
      groupedTabCount: groupSummary.groupedTabCount
    });

    setStatus("Moved " + movedTabIds.length + " workspace tab(s) into a new Chrome window and recreated " + groupSummary.groups.length + " Chrome group(s).");
  } catch (error) {
    await recordDiagnostic("error", "workspace_tabs_new_window_failed", "Stable v2 Move Workspace Into New Window failed.", {
      newWindowId,
      error: summarizeError(error)
    });

    if (workspace) {
      await refreshWorkspaceTabMetadataAfterBrowserAction(workspace).catch(() => undefined);
      await addTimelineEvent(workspace, "workspace_tabs_new_window_failed", "Stable v2 Move Workspace Into New Window failed before Chrome Flow could complete the tab move.", {
        newWindowId,
        error: summarizeError(error),
        newWindowCreationMode: "primary_tab_new_window_focus_recovery_v2"
      });
    }

    setStatus("Move Workspace Into New Window failed. Copy the diagnostic packet for review.");
  } finally {
    moveInProgress = false;

    if (button) {
      button.disabled = false;
    }
  }
}

async function focusNormalWindow(windowId) {
  if (!Number.isInteger(windowId)) {
    return;
  }

  try {
    await chrome.windows.update(windowId, { state: "normal" });
    await chrome.windows.update(windowId, { focused: true });
  } catch (error) {
    await recordDiagnostic("warn", "workspace_new_window_focus_recovery_failed", "Could not force the new workspace window into a normal focused state.", {
      windowId,
      error: summarizeError(error)
    });
  }
}

async function getWindowSummary(windowId) {
  try {
    const windowInfo = await chrome.windows.get(windowId, { populate: false });
    return {
      id: windowInfo.id,
      focused: Boolean(windowInfo.focused),
      state: windowInfo.state,
      type: windowInfo.type,
      top: windowInfo.top,
      left: windowInfo.left,
      width: windowInfo.width,
      height: windowInfo.height
    };
  } catch (error) {
    return {
      id: windowId,
      unavailable: true,
      error: summarizeError(error)
    };
  }
}

async function refreshWorkspaceTabMetadataAfterBrowserAction(workspace) {
  const resolution = await resolveWorkspaceTabsToLiveTabs(workspace);

  resolution.results.forEach((result) => {
    if (result.liveTab) {
      updateWorkspaceTabFromBrowserTab(result.workspaceTab, result.liveTab, {
        isOpen: true,
        lastSeenAt: new Date().toISOString(),
        lastMatchStatus: result.matchStatus
      });
    } else {
      result.workspaceTab.isOpen = false;
      result.workspaceTab.lastMatchStatus = result.matchStatus;
    }
  });

  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
}

async function recreateChromeGroupsInWindow(workspace, resolutionResults, windowId) {
  const workspaceType = workspace.workspaceType || DEFAULT_WORKSPACE_TYPE;
  const groupedResults = groupBy(
    resolutionResults.filter((result) => result.liveTab && result.liveTab.windowId === windowId),
    (result) => result.workspaceTab.role || "unassigned"
  );
  const roleOrder = createRoleOrderMap(workspaceType);
  const groups = [];
  let groupedTabCount = 0;

  const orderedEntries = Array.from(groupedResults.entries()).sort(([leftRole], [rightRole]) => {
    const leftIndex = roleOrder.get(leftRole) ?? 999;
    const rightIndex = roleOrder.get(rightRole) ?? 999;
    return leftIndex - rightIndex;
  });

  for (const [roleId, results] of orderedEntries) {
    const sortedResults = sortResultsByRoleOrder(workspace, results);
    const tabIds = sortedResults.map((result) => result.liveTab.id);

    if (!tabIds.length) {
      continue;
    }

    const roleLabel = getWorkspaceRoleLabel(workspaceType, roleId);
    const groupId = await chrome.tabs.group({
      tabIds,
      createProperties: {
        windowId
      }
    });

    await chrome.tabGroups.update(groupId, {
      title: createChromeGroupTitle(workspace, roleLabel),
      collapsed: false
    });

    sortedResults.forEach((result) => {
      result.workspaceTab.groupId = groupId;
      result.workspaceTab.windowId = windowId;
      result.workspaceTab.lastSeenAt = new Date().toISOString();
      result.workspaceTab.lastMatchStatus = "exact_tab_id";
    });

    groupedTabCount += tabIds.length;
    groups.push({
      groupId,
      roleId,
      roleLabel,
      tabIds,
      windowId,
      workspaceTabIds: sortedResults.map((result) => result.workspaceTab.workspaceTabId)
    });
  }

  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  return { groups, groupedTabCount };
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
    console.warn("Chrome Flow stable new-window v2 diagnostics failed:", error);
  }
}

async function resolveWorkspaceTabsToLiveTabs(workspace) {
  const browserTabs = await chrome.tabs.query({});
  const browserTabSnapshots = browserTabs.map(createBrowserTabSnapshotWithFallback);
  const consumedLiveTabIds = new Set();
  const results = [];

  workspace.tabs.forEach((workspaceTab) => {
    if (!workspaceTab.workspaceTabId) {
      workspaceTab.workspaceTabId = crypto.randomUUID();
    }

    const result = resolveWorkspaceTabAgainstBrowserTabs(workspaceTab, browserTabSnapshots, consumedLiveTabIds);

    if (result.liveTab) {
      consumedLiveTabIds.add(result.liveTab.id);
    }

    results.push(result);
  });

  return { browserTabs, results };
}

function resolveWorkspaceTabAgainstBrowserTabs(workspaceTab, browserTabs, consumedLiveTabIds) {
  if (Number.isInteger(workspaceTab.tabId)) {
    const exactTab = browserTabs.find((tab) => tab.id === workspaceTab.tabId);

    if (exactTab && !consumedLiveTabIds.has(exactTab.id)) {
      return createResolutionResult(workspaceTab, exactTab, "exact_tab_id", 1);
    }

    if (exactTab && consumedLiveTabIds.has(exactTab.id)) {
      const unconsumedUrlMatches = findUnconsumedUrlMatches(workspaceTab, browserTabs, consumedLiveTabIds);

      if (unconsumedUrlMatches.length === 1) {
        return createResolutionResult(workspaceTab, unconsumedUrlMatches[0], "exact_tab_id_consumed_single_url_repair", 1);
      }

      return createResolutionResult(workspaceTab, null, "exact_tab_id_consumed", unconsumedUrlMatches.length);
    }
  }

  const urlMatches = findUnconsumedUrlMatches(workspaceTab, browserTabs, consumedLiveTabIds);

  if (urlMatches.length === 1) {
    return createResolutionResult(workspaceTab, urlMatches[0], "single_url_fallback", 1);
  }

  if (urlMatches.length > 1) {
    return createResolutionResult(workspaceTab, null, "ambiguous_url_matches", urlMatches.length);
  }

  return createResolutionResult(workspaceTab, null, "not_found", 0);
}

function findUnconsumedUrlMatches(workspaceTab, browserTabs, consumedLiveTabIds) {
  return browserTabs.filter((tab) =>
    !consumedLiveTabIds.has(tab.id) && workspaceTab.url && tab.url === workspaceTab.url
  );
}

function createResolutionResult(workspaceTab, liveTab, matchStatus, candidateCount) {
  return { workspaceTab, liveTab, matchStatus, candidateCount };
}

function sortResultsByRoleOrder(workspace, results) {
  const roleOrder = createRoleOrderMap(workspace.workspaceType || DEFAULT_WORKSPACE_TYPE);

  return [...results].sort((left, right) => {
    const leftRole = roleOrder.get(left.workspaceTab.role || "unassigned") ?? 999;
    const rightRole = roleOrder.get(right.workspaceTab.role || "unassigned") ?? 999;

    if (leftRole !== rightRole) {
      return leftRole - rightRole;
    }

    return (left.liveTab.index ?? 0) - (right.liveTab.index ?? 0);
  });
}

function createRoleOrderMap(workspaceType) {
  const map = new Map();
  getWorkspaceRoles(workspaceType).forEach((role, index) => {
    map.set(role.id, index);
  });
  return map;
}

function updateWorkspaceTabFromBrowserTab(workspaceTab, browserTab, extraFields = {}) {
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

function createBrowserTabSnapshotWithFallback(tab, fallback = {}) {
  const title = tab.title || fallback.originalTitle || fallback.title || "";
  const url = tab.url || fallback.url || "";

  return {
    id: tab.id,
    tabKey: url + "::" + title,
    windowId: tab.windowId,
    groupId: tab.groupId,
    index: tab.index,
    title,
    url,
    active: tab.active,
    pinned: tab.pinned
  };
}

function createFreshWorkspace() {
  const now = new Date().toISOString();
  return {
    workspaceId: crypto.randomUUID(),
    name: "Untitled Workspace",
    aim: "",
    workspaceType: DEFAULT_WORKSPACE_TYPE,
    createdAt: now,
    updatedAt: now,
    tabs: [],
    journal: [],
    timeline: []
  };
}

function createChromeGroupTitle(workspace, roleLabel) {
  const initials = createWorkspaceInitials(workspace.name || "Chrome Flow");
  const title = roleLabel + " · " + initials;
  return title.length <= 32 ? title : title.slice(0, 32);
}

function createWorkspaceInitials(name) {
  const initials = String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("")
    .slice(0, 4);

  return initials || "CF";
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

function groupBy(items, getKey) {
  const groups = new Map();

  items.forEach((item) => {
    const key = getKey(item);

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(item);
  });

  return groups;
}

function setStatus(message) {
  const status = document.getElementById("advancedTabControlsStatus");

  if (status) {
    status.textContent = message;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
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
