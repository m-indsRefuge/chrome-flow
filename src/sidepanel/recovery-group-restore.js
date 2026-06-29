import {
  DEFAULT_WORKSPACE_TYPE,
  getWorkspaceRoleLabel
} from "../core/workspace-role-sets.js";

const WORKSPACE_KEY = "chromeFlowWorkspace";
const DIAGNOSTICS_KEY = "chromeFlowDiagnostics";
const MAX_DIAGNOSTICS = 200;
const RECOVERY_GROUP_RESTORE_DELAY_MS = 1600;

installRecoveryGroupRestore();

function installRecoveryGroupRestore() {
  document.addEventListener("click", (event) => {
    const button = event.target?.closest?.(".timeline-readd-workspace-button");

    if (!button) {
      return;
    }

    const recoverySourceEventId = button.dataset.eventId || "";

    if (!recoverySourceEventId) {
      return;
    }

    window.setTimeout(() => {
      void restoreRecoveredTabToRoleGroup(recoverySourceEventId);
    }, RECOVERY_GROUP_RESTORE_DELAY_MS);
  });
}

async function restoreRecoveredTabToRoleGroup(recoverySourceEventId) {
  const workspace = await getWorkspace();
  const readdEvent = findLatestReaddEventForRecovery(workspace, recoverySourceEventId);

  if (!readdEvent?.workspaceTabId) {
    await recordDiagnostic("warn", "recovery_group_restore_skipped", "No completed workspace_tab_readded event was found for recovery group restore.", {
      recoverySourceEventId
    });
    return;
  }

  const workspaceTab = workspace.tabs.find((tab) => tab.workspaceTabId === readdEvent.workspaceTabId);

  if (!workspaceTab) {
    await recordDiagnostic("warn", "recovery_group_restore_skipped", "Recovered workspace tab record was not found for group restore.", {
      recoverySourceEventId,
      workspaceTabId: readdEvent.workspaceTabId
    });
    return;
  }

  let liveTabs = await chrome.tabs.query({});
  let liveTab = resolveLiveTabForWorkspaceTab(workspaceTab, liveTabs);
  let browserTabReopenedByHelper = false;
  let browserTabReusedByHelper = false;

  if (!liveTab) {
    const reopenedTab = findPreviouslyReopenedTabForRecovery(workspace, recoverySourceEventId, readdEvent.tabSnapshot || workspaceTab, liveTabs);

    if (reopenedTab) {
      liveTab = reopenedTab;
      browserTabReusedByHelper = true;
    } else if (workspaceTab.url) {
      liveTab = await chrome.tabs.create({ url: workspaceTab.url, active: true });
      browserTabReopenedByHelper = true;
    }
  }

  if (!liveTab) {
    await addTimelineEvent(workspace, "recovered_tab_group_restore_skipped", "Could not restore recovered tab to a Chrome group because the live browser tab was not found and no URL could be reopened.", {
      recoverySourceEventId,
      workspaceTabId: workspaceTab.workspaceTabId,
      role: workspaceTab.role || "unassigned"
    });
    await recordDiagnostic("warn", "recovery_group_restore_skipped", "Live browser tab was not found for recovered workspace tab and no URL could be reopened.", {
      recoverySourceEventId,
      workspaceTabId: workspaceTab.workspaceTabId,
      tabId: workspaceTab.tabId
    });
    return;
  }

  updateWorkspaceTabFromLiveTab(workspaceTab, liveTab);
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);

  liveTabs = await chrome.tabs.query({});
  const roleId = workspaceTab.role || "unassigned";
  const roleLabel = getWorkspaceRoleLabel(workspace.workspaceType || DEFAULT_WORKSPACE_TYPE, roleId);
  const groupTitle = createChromeGroupTitle(workspace, roleLabel);
  const sameRoleGroupedTabs = workspace.tabs
    .filter((tab) => tab.workspaceTabId !== workspaceTab.workspaceTabId)
    .filter((tab) => (tab.role || "unassigned") === roleId)
    .map((tab) => resolveLiveTabForWorkspaceTab(tab, liveTabs))
    .filter(Boolean)
    .filter((tab) => tab.windowId === liveTab.windowId && isValidChromeGroupId(tab.groupId));

  let groupId = sameRoleGroupedTabs[0]?.groupId;
  let restoreMode = "added_to_existing_role_group";

  if (isValidChromeGroupId(liveTab.groupId)) {
    await chrome.tabGroups.update(liveTab.groupId, {
      title: groupTitle,
      collapsed: false
    });
    await updateWorkspaceFromLiveTabs(workspace, await chrome.tabs.query({}));
    await addTimelineEvent(workspace, "recovered_tab_group_restore_skipped", "Recovered tab was already in a native Chrome group. Chrome Flow refreshed the group title.", {
      recoverySourceEventId,
      workspaceTabId: workspaceTab.workspaceTabId,
      tabId: liveTab.id,
      groupId: liveTab.groupId,
      roleId,
      roleLabel,
      groupTitle,
      browserTabReopenedByHelper,
      browserTabReusedByHelper
    });
    await recordDiagnostic("info", "recovery_group_restore_skipped", "Recovered tab was already grouped. Chrome Flow refreshed the group title.", {
      recoverySourceEventId,
      workspaceTabId: workspaceTab.workspaceTabId,
      tabId: liveTab.id,
      groupId: liveTab.groupId,
      roleId,
      roleLabel,
      groupTitle,
      browserTabReopenedByHelper,
      browserTabReusedByHelper
    });
    return;
  }

  if (isValidChromeGroupId(groupId)) {
    await chrome.tabs.group({
      tabIds: [liveTab.id],
      groupId
    });
    await chrome.tabGroups.update(groupId, {
      title: groupTitle,
      collapsed: false
    });
  } else {
    groupId = await chrome.tabs.group({
      tabIds: [liveTab.id],
      createProperties: {
        windowId: liveTab.windowId
      }
    });
    await chrome.tabGroups.update(groupId, {
      title: groupTitle,
      collapsed: false
    });
    restoreMode = "created_role_group_for_recovered_tab";
  }

  const refreshedLiveTabs = await chrome.tabs.query({});
  await updateWorkspaceFromLiveTabs(workspace, refreshedLiveTabs);
  const refreshedLiveTab = refreshedLiveTabs.find((tab) => tab.id === liveTab.id);
  const finalGroupId = refreshedLiveTab?.groupId ?? groupId;

  await addTimelineEvent(workspace, "recovered_tab_group_restored", "Restored recovered tab to its " + roleLabel + " Chrome group.", {
    recoverySourceEventId,
    workspaceTabId: workspaceTab.workspaceTabId,
    tabId: liveTab.id,
    roleId,
    roleLabel,
    groupTitle,
    windowId: liveTab.windowId,
    groupId: finalGroupId,
    restoreMode,
    browserTabReopenedByHelper,
    browserTabReusedByHelper
  });
  await recordDiagnostic("info", "recovery_group_restored", "Recovered tab was restored to a titled role-based Chrome group.", {
    recoverySourceEventId,
    workspaceTabId: workspaceTab.workspaceTabId,
    tabId: liveTab.id,
    roleId,
    roleLabel,
    groupTitle,
    windowId: liveTab.windowId,
    groupId: finalGroupId,
    restoreMode,
    browserTabReopenedByHelper,
    browserTabReusedByHelper
  });
}

function findLatestReaddEventForRecovery(workspace, recoverySourceEventId) {
  return [...workspace.timeline]
    .reverse()
    .find((event) => event.type === "workspace_tab_readded" && event.recoverySourceEventId === recoverySourceEventId);
}

function findPreviouslyReopenedTabForRecovery(workspace, recoverySourceEventId, tabSnapshot, liveTabs) {
  const reopenedEvents = [...workspace.timeline]
    .reverse()
    .filter((event) => event.type === "timeline_url_reopened" && event.recoverySourceEventId === recoverySourceEventId && Number.isInteger(event.tabId));

  for (const reopenedEvent of reopenedEvents) {
    const liveTab = liveTabs.find((tab) => tab.id === reopenedEvent.tabId);

    if (liveTab && (!tabSnapshot?.url || liveTab.url === tabSnapshot.url)) {
      return liveTab;
    }
  }

  return null;
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

async function updateWorkspaceFromLiveTabs(workspace, liveTabs) {
  workspace.tabs.forEach((workspaceTab) => {
    const liveTab = resolveLiveTabForWorkspaceTab(workspaceTab, liveTabs);

    if (!liveTab) {
      workspaceTab.isOpen = false;
      return;
    }

    updateWorkspaceTabFromLiveTab(workspaceTab, liveTab);
  });

  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
}

function updateWorkspaceTabFromLiveTab(workspaceTab, liveTab) {
  workspaceTab.tabId = liveTab.id;
  workspaceTab.tabKey = createTabKey(liveTab);
  workspaceTab.windowId = liveTab.windowId;
  workspaceTab.groupId = liveTab.groupId;
  workspaceTab.url = liveTab.url || workspaceTab.url;
  workspaceTab.displayUrl = createDisplayUrl(workspaceTab.url || "");
  workspaceTab.originalTitle = liveTab.title || workspaceTab.originalTitle;
  workspaceTab.isOpen = true;
  workspaceTab.lastSeenAt = new Date().toISOString();
  workspaceTab.lastOpenedAt = workspaceTab.lastOpenedAt || new Date().toISOString();
  workspaceTab.lastMatchStatus = "exact_tab_id";
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
    console.warn("Chrome Flow recovery group restore diagnostics failed:", error);
  }
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

function createTabKey(tab) {
  return (tab.url || "") + "::" + (tab.title || "");
}

function createChromeGroupTitle(workspace, roleLabel) {
  const role = roleLabel || "Unassigned";
  const suffix = " · " + getWorkspaceGroupToken(workspace);
  const maxLength = 32;
  const availableRoleLength = maxLength - suffix.length;

  if (availableRoleLength <= 3) {
    return (role + suffix).slice(0, maxLength - 3) + "...";
  }

  const trimmedRole = role.length <= availableRoleLength ? role : role.slice(0, availableRoleLength - 3) + "...";
  return trimmedRole + suffix;
}

function getWorkspaceGroupToken(workspace) {
  const rawName = (workspace.name || "").trim();

  if (!rawName) {
    return "CF";
  }

  const words = rawName.split(/\s+/).filter(Boolean);
  const initials = words
    .map((word) => word.replace(/[^a-zA-Z0-9]/g, ""))
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

  if (initials) {
    return initials.slice(0, 4);
  }

  const compactName = rawName.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return compactName ? compactName.slice(0, 4) : "CF";
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

function isValidChromeGroupId(groupId) {
  return Number.isInteger(groupId) && groupId >= 0;
}
