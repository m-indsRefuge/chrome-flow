import {
  appendRuntimeDiagnostic,
  saveActiveWorkspaceRuntime
} from "./workspace-runtime-store.js";

const DEDICATED_WINDOW_THRESHOLD_TAB_COUNT = 4;
const WINDOW_SETTLE_DELAY_MS = 350;

async function hydrateWorkspaceMemoryRecordToRuntime(record, options = {}) {
  const runtimeWorkspace = buildRuntimeWorkspaceFromMemoryRecord(record);
  const restoreTargetMode = determineHydrationTargetMode(record, runtimeWorkspace);
  const restorableTabs = getRestorableTabs(runtimeWorkspace);
  const skippedTabCount = runtimeWorkspace.tabs.length - restorableTabs.length;

  if (!restorableTabs.length) {
    throw new Error("Selected workspace has no restorable web tabs.");
  }

  const restoreResult = await restoreWorkspaceTabs(restorableTabs, restoreTargetMode);
  await delay(WINDOW_SETTLE_DELAY_MS);
  const groupResult = await recreateRestoredChromeGroups(restoreResult.openedTabs, restoreResult.windowId, runtimeWorkspace);
  await delay(WINDOW_SETTLE_DELAY_MS);
  const focusRequested = await refocusRestoredWindow(restoreResult.windowId, restoreResult.openedTabs[0]?.tabId || null);
  const hydratedWorkspace = buildHydratedWorkspace(runtimeWorkspace, record, restoreResult, groupResult, restoreTargetMode);

  await saveActiveWorkspaceRuntime(hydratedWorkspace);
  await appendRuntimeDiagnostic("info", "workspace_library_resume_executed", "Workspace Library resume executed and hydrated saved workspace into active runtime.", {
    source: options.source || "workspace_library_resume",
    workspaceId: hydratedWorkspace.workspaceId,
    workspaceName: hydratedWorkspace.name,
    restoreTargetMode,
    restorePolicy: buildHydrationPolicyEvidence(record, runtimeWorkspace),
    restoreCreationMode: restoreResult.creationMode,
    reopenedTabCount: restoreResult.openedTabs.length,
    skippedTabCount,
    windowId: restoreResult.windowId,
    temporaryTabIds: restoreResult.temporaryTabIds || [],
    removedTemporaryTabIds: restoreResult.removedTemporaryTabIds || [],
    recreatedGroupCount: groupResult.recreatedGroupCount,
    skippedGroupCount: groupResult.skippedGroupCount,
    focusRequested
  });

  return {
    hydratedWorkspace,
    restoreTargetMode,
    restoreResult,
    groupResult,
    focusRequested,
    skippedTabCount
  };
}

function buildRuntimeWorkspaceFromMemoryRecord(record) {
  const workspace = record.workspace || {};
  const tabs = Array.isArray(record.tabs) ? record.tabs : [];
  const journalEntries = Array.isArray(record.journalEntries) ? record.journalEntries : [];
  const timelineEvents = Array.isArray(record.timelineEvents) ? record.timelineEvents : [];
  const now = new Date().toISOString();

  return {
    workspaceId: workspace.workspaceId || crypto.randomUUID(),
    name: workspace.name || "Untitled Workspace",
    aim: workspace.aim || "",
    workspaceType: workspace.workspaceType || "research",
    createdAt: workspace.createdAt || now,
    updatedAt: now,
    hydratedAt: now,
    hydratedFromMemory: true,
    tabs: tabs.map((tab) => buildRuntimeTabFromMemoryTab(tab)),
    journal: journalEntries.map((entry) => buildRuntimeJournalEntry(entry)),
    timeline: timelineEvents.map((event) => buildRuntimeTimelineEvent(event))
  };
}

function buildRuntimeTabFromMemoryTab(tab) {
  return {
    workspaceTabId: tab.workspaceTabId || crypto.randomUUID(),
    tabId: null,
    windowId: null,
    groupId: -1,
    url: tab.url || "",
    displayUrl: tab.displayUrl || tab.url || "",
    title: tab.originalTitle || tab.title || tab.alias || "Untitled tab",
    originalTitle: tab.originalTitle || tab.title || tab.alias || "Untitled tab",
    alias: tab.alias || "",
    role: tab.role || "unassigned",
    firstSeenAt: tab.firstSeenAt || tab.createdAt || new Date().toISOString(),
    lastSeenAt: tab.lastSeenAt || tab.updatedAt || new Date().toISOString(),
    isOpen: false
  };
}

function buildRuntimeJournalEntry(entry) {
  return {
    entryId: entry.journalEntryId || entry.entryId || crypto.randomUUID(),
    text: entry.text || "",
    tag: entry.tag || "",
    relatedRoleId: entry.relatedRole || "",
    relatedRoleLabel: entry.relatedRole || "",
    createdAt: entry.createdAt || new Date().toISOString()
  };
}

function buildRuntimeTimelineEvent(event) {
  return {
    eventId: event.eventId || crypto.randomUUID(),
    type: event.type || "memory_event",
    message: event.message || "Imported memory event.",
    createdAt: event.createdAt || new Date().toISOString(),
    evidence: event.evidence || {},
    recoveryActions: event.recoveryActions || null
  };
}

async function restoreWorkspaceTabs(restorableTabs, restoreTargetMode) {
  if (restoreTargetMode === "dedicated_window") {
    return restoreWorkspaceTabsInDedicatedWindow(restorableTabs);
  }

  return restoreWorkspaceTabsInCurrentWindow(restorableTabs);
}

async function restoreWorkspaceTabsInDedicatedWindow(restorableTabs) {
  if (!globalThis.chrome?.windows?.create || !globalThis.chrome?.tabs?.create) {
    throw new Error("Chrome windows/tabs API is unavailable.");
  }

  const createdWindow = await chrome.windows.create({
    focused: true,
    state: "normal"
  });
  const windowId = createdWindow.id;
  const temporaryTabIds = Array.isArray(createdWindow.tabs)
    ? createdWindow.tabs.map((tab) => tab.id).filter((tabId) => Number.isInteger(tabId))
    : [];
  const openedTabs = [];

  if (!Number.isInteger(windowId)) {
    throw new Error("Chrome did not return a valid dedicated resume window id.");
  }

  await chrome.windows.update(windowId, { focused: true, state: "normal" });
  await delay(WINDOW_SETTLE_DELAY_MS);

  for (const [index, tab] of restorableTabs.entries()) {
    const openedTab = await chrome.tabs.create({
      windowId,
      url: tab.url,
      active: index === 0
    });
    openedTabs.push(createOpenedTabRecord(tab, openedTab));
  }

  await delay(WINDOW_SETTLE_DELAY_MS);

  const openedTabIds = openedTabs.map((tab) => tab.tabId).filter((tabId) => Number.isInteger(tabId));
  const removedTemporaryTabIds = [];

  for (const temporaryTabId of temporaryTabIds) {
    if (openedTabIds.includes(temporaryTabId)) continue;

    try {
      await chrome.tabs.remove(temporaryTabId);
      removedTemporaryTabIds.push(temporaryTabId);
    } catch (error) {
      await appendRuntimeDiagnostic("warn", "workspace_resume_temporary_tab_remove_failed", "Could not remove temporary tab from dedicated resume window.", {
        temporaryTabId,
        windowId,
        error: summarizeError(error)
      });
    }
  }

  await chrome.windows.update(windowId, { focused: true, state: "normal" });

  return {
    windowId,
    openedTabs,
    temporaryTabIds,
    removedTemporaryTabIds,
    creationMode: "empty_window_then_create_resumed_tabs"
  };
}

async function restoreWorkspaceTabsInCurrentWindow(restorableTabs) {
  if (!globalThis.chrome?.tabs?.create) {
    throw new Error("Chrome tabs API is unavailable.");
  }

  const currentWindow = await getCurrentWindowSafe();
  const windowId = currentWindow?.id || null;
  const openedTabs = [];

  for (const [index, tab] of restorableTabs.entries()) {
    const createArgs = {
      url: tab.url,
      active: index === 0
    };

    if (Number.isInteger(windowId)) {
      createArgs.windowId = windowId;
    }

    const openedTab = await chrome.tabs.create(createArgs);
    openedTabs.push(createOpenedTabRecord(tab, openedTab));
  }

  return {
    windowId: openedTabs[0]?.windowId || windowId,
    openedTabs,
    temporaryTabIds: [],
    removedTemporaryTabIds: [],
    creationMode: "current_window_create_resumed_tabs"
  };
}

async function recreateRestoredChromeGroups(openedTabs, windowId, workspace = {}) {
  const result = {
    groupAvailable: Boolean(globalThis.chrome?.tabs?.group && globalThis.chrome?.tabGroups?.update),
    windowId,
    recreatedGroupCount: 0,
    skippedGroupCount: 0,
    groups: []
  };

  if (!openedTabs.length) return result;

  if (!result.groupAvailable) {
    result.skippedGroupCount = countRestorableRoleGroups(openedTabs, workspace);
    await appendRuntimeDiagnostic("warn", "workspace_resume_groups_skipped", "Chrome tab group API is unavailable during Workspace Library resume.", result);
    return result;
  }

  const groupsByRole = groupOpenedTabsByRole(openedTabs, workspace);

  for (const group of groupsByRole) {
    if (!group.tabIds.length) {
      result.skippedGroupCount += 1;
      continue;
    }

    try {
      const groupOptions = { tabIds: group.tabIds };
      if (Number.isInteger(windowId)) {
        groupOptions.createProperties = { windowId };
      }

      const groupId = await chrome.tabs.group(groupOptions);
      await chrome.tabGroups.update(groupId, {
        title: group.title,
        collapsed: false
      });

      for (const openedTab of group.openedTabs) {
        openedTab.groupId = groupId;
      }

      result.recreatedGroupCount += 1;
      result.groups.push({
        groupId,
        role: group.role,
        roleLabel: group.roleLabel,
        title: group.title,
        tabIds: group.tabIds,
        workspaceTabIds: group.openedTabs.map((openedTab) => openedTab.workspaceTabId)
      });
    } catch (error) {
      result.skippedGroupCount += 1;
      result.groups.push({
        role: group.role,
        roleLabel: group.roleLabel,
        title: group.title,
        tabIds: group.tabIds,
        status: "failed",
        error: summarizeError(error)
      });
    }
  }

  await appendRuntimeDiagnostic("info", "workspace_resume_groups_recreated", "Workspace Library resume role groups recreated.", result);
  return result;
}

async function refocusRestoredWindow(windowId, activeTabId) {
  if (!windowId || !globalThis.chrome?.windows?.update) return false;

  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (attempt > 1) {
      await delay(WINDOW_SETTLE_DELAY_MS * attempt);
    }

    try {
      if (globalThis.chrome?.windows?.get) {
        await chrome.windows.get(windowId);
      }

      if (activeTabId && globalThis.chrome?.tabs?.update) {
        await chrome.tabs.update(activeTabId, { active: true });
      }

      await chrome.windows.update(windowId, { focused: true });
      await appendRuntimeDiagnostic("info", "workspace_resume_window_focused", "Workspace Library resume window focus requested.", {
        windowId,
        activeTabId,
        attempt
      });
      return true;
    } catch (error) {
      lastError = error;
    }
  }

  await appendRuntimeDiagnostic("warn", "workspace_resume_window_focus_failed", "Could not refocus Workspace Library resume window.", {
    windowId,
    activeTabId,
    error: summarizeError(lastError)
  });
  return false;
}

function buildHydratedWorkspace(runtimeWorkspace, memoryRecord, restoreResult, groupResult, restoreTargetMode) {
  const openedByWorkspaceTabId = new Map(restoreResult.openedTabs.map((openedTab) => [openedTab.workspaceTabId, openedTab]));
  const now = new Date().toISOString();
  const hydratedTabs = runtimeWorkspace.tabs.map((tab) => {
    const openedTab = openedByWorkspaceTabId.get(tab.workspaceTabId || "");

    if (!openedTab) {
      return { ...tab };
    }

    return {
      ...tab,
      tabId: openedTab.tabId,
      windowId: openedTab.windowId,
      groupId: Number.isInteger(openedTab.groupId) ? openedTab.groupId : -1,
      isOpen: true,
      hydratedAt: now,
      hydratedFromWorkspaceMemory: true
    };
  });

  const resumeEvent = {
    eventId: crypto.randomUUID(),
    type: "workspace_library_resume_hydrated",
    createdAt: now,
    message: "Resumed saved workspace from Workspace Library, reopened " + restoreResult.openedTabs.length + " tab(s), and recreated " + groupResult.recreatedGroupCount + " role group(s) " + buildRestoreTargetMessage(restoreTargetMode) + ".",
    workspaceId: runtimeWorkspace.workspaceId,
    sourceMemoryWorkspaceId: memoryRecord.workspace?.workspaceId || "",
    restoreTargetMode,
    openedTabCount: restoreResult.openedTabs.length,
    recreatedGroupCount: groupResult.recreatedGroupCount,
    skippedGroupCount: groupResult.skippedGroupCount,
    resumedWorkspaceTabIds: restoreResult.openedTabs.map((openedTab) => openedTab.workspaceTabId),
    groups: groupResult.groups,
    windowId: restoreResult.openedTabs[0]?.windowId || null
  };

  return {
    ...runtimeWorkspace,
    updatedAt: now,
    resumedAt: now,
    resumedFromWorkspaceMemoryId: memoryRecord.workspace?.workspaceId || "",
    tabs: hydratedTabs,
    timeline: [...runtimeWorkspace.timeline, resumeEvent]
  };
}

function determineHydrationTargetMode(record, runtimeWorkspace) {
  const tabCount = Array.isArray(runtimeWorkspace.tabs) ? runtimeWorkspace.tabs.length : 0;
  const projectionText = Array.isArray(record.projections)
    ? record.projections.map((projection) => [projection.projectionState, projection.projectionMode].join(" ")).join(" ").toLowerCase()
    : "";
  const summaryText = [record.summaryCard?.deterministicSummary || "", record.summaryCard?.continuationSummary || ""].join(" ").toLowerCase();

  if (tabCount >= DEDICATED_WINDOW_THRESHOLD_TAB_COUNT) return "dedicated_window";
  if (projectionText.includes("dedicated")) return "dedicated_window";
  if (projectionText.includes("new window")) return "dedicated_window";
  if (summaryText.includes("dedicated")) return "dedicated_window";
  if (summaryText.includes("new window")) return "dedicated_window";
  return "current_window";
}

function buildHydrationPolicyEvidence(record, runtimeWorkspace) {
  return {
    thresholdTabCount: DEDICATED_WINDOW_THRESHOLD_TAB_COUNT,
    memoryWorkspaceTabCount: Array.isArray(runtimeWorkspace.tabs) ? runtimeWorkspace.tabs.length : 0,
    projectionEvidence: Array.isArray(record.projections) ? record.projections.map((projection) => ({
      projectionState: projection.projectionState,
      projectionMode: projection.projectionMode
    })) : [],
    productRule: "0-3 tabs without dedicated-window evidence resume into the current window; 4+ tabs or dedicated-window evidence resume into a dedicated window."
  };
}

function createOpenedTabRecord(sourceTab, openedTab) {
  return {
    workspaceTabId: sourceTab.workspaceTabId || "",
    tabId: openedTab.id,
    windowId: openedTab.windowId,
    groupId: -1,
    role: normalizeRole(sourceTab.role),
    roleLabel: getRoleLabel(sourceTab.role),
    url: openedTab.url || sourceTab.url,
    title: openedTab.title || sourceTab.title || sourceTab.originalTitle || ""
  };
}

function groupOpenedTabsByRole(openedTabs, workspace = {}) {
  const groupsByRole = new Map();

  for (const openedTab of openedTabs) {
    const role = normalizeRole(openedTab.role);
    if (role === "unassigned" || role === "discard") continue;

    if (!groupsByRole.has(role)) {
      groupsByRole.set(role, {
        role,
        roleLabel: getRoleLabel(role),
        openedTabs: []
      });
    }

    groupsByRole.get(role).openedTabs.push(openedTab);
  }

  return Array.from(groupsByRole.values()).map((group) => ({
    ...group,
    tabIds: group.openedTabs.map((openedTab) => openedTab.tabId).filter((tabId) => Number.isInteger(tabId)),
    title: buildChromeGroupTitle(workspace, group.roleLabel || getRoleLabel(group.role) || "Group")
  }));
}

function countRestorableRoleGroups(openedTabs, workspace = {}) {
  return groupOpenedTabsByRole(openedTabs, workspace).length;
}

function getRestorableTabs(workspace) {
  return workspace.tabs.filter((tab) => isRestorableWebUrl(tab.url));
}

function isRestorableWebUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

async function getCurrentWindowSafe() {
  if (!globalThis.chrome?.windows?.getCurrent) return null;

  try {
    return await chrome.windows.getCurrent();
  } catch (_error) {
    return null;
  }
}

function normalizeRole(role) {
  return typeof role === "string" && role.trim() ? role.trim().toLowerCase() : "unassigned";
}

function getRoleLabel(role) {
  const normalizedRole = normalizeRole(role);
  const labels = {
    source: "Source",
    question: "Question",
    reference: "Reference",
    docs: "Docs",
    counterpoint: "Counterpoint",
    revisit: "Revisit",
    discard: "Discard",
    unassigned: "Unassigned"
  };

  return labels[normalizedRole] || normalizedRole.charAt(0).toUpperCase() + normalizedRole.slice(1);
}

function buildChromeGroupTitle(workspace, roleLabel) {
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

function buildRestoreTargetMessage(restoreTargetMode) {
  return restoreTargetMode === "dedicated_window" ? "in a dedicated Chrome window" : "in the current Chrome window";
}

function summarizeError(error) {
  if (!error) return { message: "Unknown error" };

  return {
    name: error.name || "Error",
    message: error.message || String(error),
    stack: typeof error.stack === "string" ? error.stack.slice(0, 2000) : ""
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export {
  DEDICATED_WINDOW_THRESHOLD_TAB_COUNT,
  buildRuntimeWorkspaceFromMemoryRecord,
  determineHydrationTargetMode,
  hydrateWorkspaceMemoryRecordToRuntime
};
