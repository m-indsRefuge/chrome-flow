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

  const liveTabs = await chrome.tabs.query({});
  const liveTab = resolveLiveTabForWorkspaceTab(workspaceTab, liveTabs);

  if (!liveTab) {
    await addTimelineEvent(workspace, "recovered_tab_group_restore_skipped", "Could not restore recovered tab to a Chrome group because the live browser tab was not found.", {
      recoverySourceEventId,
      workspaceTabId: workspaceTab.workspaceTabId,
      role: workspaceTab.role || "unassigned"
    });
    await recordDiagnostic("warn", "recovery_group_restore_skipped", "Live browser tab was not found for recovered workspace tab.", {
      recoverySourceEventId,
      workspaceTabId: workspaceTab.workspaceTabId,
      tabId: workspaceTab.tabId
    });
    return;
  }

  const roleId = workspaceTab.role || "unassigned";
  const sameRoleGroupedTabs = workspace.tabs
    .filter((tab) => tab.workspaceTabId !== workspaceTab.workspaceTabId)
    .filter((tab) => (tab.role || "unassigned") === roleId)
    .map((tab) => resolveLiveTabForWorkspaceTab(tab, liveTabs))
    .filter(Boolean)
    .filter((tab) => tab.windowId === liveTab.windowId && isValidChromeGroupId(tab.groupId));

  let groupId = sameRoleGroupedTabs[0]?.groupId;
  let restoreMode = "added_to_existing_role_group";

  if (isValidChromeGroupId(liveTab.groupId)) {
    await updateWorkspaceFromLiveTabs(workspace, await chrome.tabs.query({}));
    await addTimelineEvent(workspace, "recovered_tab_group_restore_skipped", "Recovered tab was already in a native Chrome group.", {
      recoverySourceEventId,
      workspaceTabId: workspaceTab.workspaceTabId,
      tabId: liveTab.id,
      groupId: liveTab.groupId,
      roleId
    });
    await recordDiagnostic("info", "recovery_group_restore_skipped", "Recovered tab was already grouped.", {
      recoverySourceEventId,
      workspaceTabId: workspaceTab.workspaceTabId,
      tabId: liveTab.id,
      groupId: liveTab.groupId,
      roleId
    });
    return;
  }

  if (isValidChromeGroupId(groupId)) {
    await chrome.tabs.group({
      tabIds: [liveTab.id],
      groupId
    });
  } else {
    groupId = await chrome.tabs.group({
      tabIds: [liveTab.id],
      createProperties: {
        windowId: liveTab.windowId
      }
    });
    restoreMode = "created_role_group_for_recovered_tab";
  }

  const refreshedLiveTabs = await chrome.tabs.query({});
  await updateWorkspaceFromLiveTabs(workspace, refreshedLiveTabs);
  const refreshedLiveTab = refreshedLiveTabs.find((tab) => tab.id === liveTab.id);
  const finalGroupId = refreshedLiveTab?.groupId ?? groupId;

  await addTimelineEvent(workspace, "recovered_tab_group_restored", "Restored recovered tab to its " + roleId + " Chrome group.", {
    recoverySourceEventId,
    workspaceTabId: workspaceTab.workspaceTabId,
    tabId: liveTab.id,
    roleId,
    windowId: liveTab.windowId,
    groupId: finalGroupId,
    restoreMode
  });
  await recordDiagnostic("info", "recovery_group_restored", "Recovered tab was restored to a role-based Chrome group.", {
    recoverySourceEventId,
    workspaceTabId: workspaceTab.workspaceTabId,
    tabId: liveTab.id,
    roleId,
    windowId: liveTab.windowId,
    groupId: finalGroupId,
    restoreMode
  });
}

function findLatestReaddEventForRecovery(workspace, recoverySourceEventId) {
  return [...workspace.timeline]
    .reverse()
    .find((event) => event.type === "workspace_tab_readded" && event.recoverySourceEventId === recoverySourceEventId);
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

    workspaceTab.tabId = liveTab.id;
    workspaceTab.tabKey = createTabKey(liveTab);
    workspaceTab.windowId = liveTab.windowId;
    workspaceTab.groupId = liveTab.groupId;
    workspaceTab.url = liveTab.url || workspaceTab.url;
    workspaceTab.displayUrl = createDisplayUrl(workspaceTab.url || "");
    workspaceTab.originalTitle = liveTab.title || workspaceTab.originalTitle;
    workspaceTab.isOpen = true;
    workspaceTab.lastSeenAt = new Date().toISOString();
    workspaceTab.lastMatchStatus = "exact_tab_id";
  });

  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
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
    workspaceType: "research",
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
