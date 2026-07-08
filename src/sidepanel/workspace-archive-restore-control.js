const WORKSPACE_KEY = "chromeFlowWorkspace";
const WORKSPACE_ARCHIVE_KEY = "chromeFlowWorkspaceArchive";
const DIAGNOSTICS_KEY = "chromeFlowDiagnostics";
const MAX_DIAGNOSTICS = 200;
const DEDICATED_WINDOW_THRESHOLD_TAB_COUNT = 4;

installWorkspaceArchiveRestoreControl();

function installWorkspaceArchiveRestoreControl() {
  const restoreButton = document.getElementById("workspaceArchiveRestoreButton");
  if (!restoreButton) return;

  restoreButton.disabled = false;
  restoreButton.title = "Restore the selected archive as the active workspace.";
  restoreButton.addEventListener("click", restoreSelectedArchive);
}

async function restoreSelectedArchive() {
  const archiveSelect = document.getElementById("archiveWorkspaceSelect");
  const selectedArchive = await getSelectedArchive(archiveSelect?.value || "");

  if (!selectedArchive) {
    setWorkspaceSessionStatus("No archived workspace selected.");
    await recordDiagnostic("warn", "archive_restore_skipped", "No archived workspace was selected for restore.", {});
    return;
  }

  const archivedWorkspace = sanitizeWorkspace(selectedArchive.workspace || {});
  const restoreTargetMode = determineRestoreTargetMode(archivedWorkspace);
  const restorableTabs = getRestorableTabs(archivedWorkspace);
  const skippedTabCount = archivedWorkspace.tabs.length - restorableTabs.length;
  const confirmed = window.confirm(
    "Restore archive: " + selectedArchive.archiveName + "?\n\n" +
    "Chrome Flow will make this the active workspace, reopen " + restorableTabs.length + " saved web tab(s) " + buildRestoreTargetMessage(restoreTargetMode) + ", and recreate saved role groups where possible. " +
    "The archive record will be kept. " +
    (skippedTabCount > 0 ? skippedTabCount + " non-web or missing URL tab record(s) will stay saved but will not be reopened." : "")
  );

  if (!confirmed) {
    setWorkspaceSessionStatus("Restore cancelled. No action was taken.");
    await recordDiagnostic("info", "archive_restore_cancelled", "Operator cancelled archive restore.", {
      archiveId: selectedArchive.archiveId,
      archiveName: selectedArchive.archiveName,
      restoreTargetMode
    });
    return;
  }

  try {
    const groupEvidenceByWorkspaceTabId = buildSavedGroupEvidenceByWorkspaceTabId(archivedWorkspace);
    const restoreResult = await restoreWorkspaceTabs(restorableTabs, restoreTargetMode, groupEvidenceByWorkspaceTabId);
    const groupResult = await recreateRestoredChromeGroups(restoreResult.openedTabs, restoreResult.windowId);
    const focusRequested = await refocusRestoredWindow(restoreResult.windowId, restoreResult.openedTabs[0]?.tabId || null);
    const restoredWorkspace = buildRestoredWorkspace(archivedWorkspace, selectedArchive, restoreResult.openedTabs, groupResult, restoreTargetMode);

    await chrome.storage.local.set({ [WORKSPACE_KEY]: restoredWorkspace });
    await recordDiagnostic("info", "archive_restored", "Archived workspace restored as active workspace.", {
      archiveId: selectedArchive.archiveId,
      archiveName: selectedArchive.archiveName,
      workspaceId: restoredWorkspace.workspaceId,
      restoreTargetMode,
      reopenedTabCount: restoreResult.openedTabs.length,
      skippedTabCount,
      windowId: restoreResult.windowId,
      recreatedGroupCount: groupResult.recreatedGroupCount,
      skippedGroupCount: groupResult.skippedGroupCount,
      focusRequested,
      archiveRecordKept: true
    });

    setWorkspaceSessionStatus("Restored archive: " + selectedArchive.archiveName + ". Reopened " + restoreResult.openedTabs.length + " tab(s) and recreated " + groupResult.recreatedGroupCount + " group(s) " + buildRestoreTargetMessage(restoreTargetMode) + ".");
    window.setTimeout(() => window.location.reload(), 500);
  } catch (error) {
    await recordDiagnostic("error", "archive_restore_failed", "Archive restore failed.", {
      archiveId: selectedArchive.archiveId,
      archiveName: selectedArchive.archiveName,
      error: summarizeError(error)
    });
    setWorkspaceSessionStatus("Could not restore archive. Check Developer Diagnostics.");
  }
}

async function restoreWorkspaceTabs(restorableTabs, restoreTargetMode, groupEvidenceByWorkspaceTabId) {
  if (restoreTargetMode === "dedicated_window") {
    return restoreWorkspaceTabsInDedicatedWindow(restorableTabs, groupEvidenceByWorkspaceTabId);
  }

  return restoreWorkspaceTabsInCurrentWindow(restorableTabs, groupEvidenceByWorkspaceTabId);
}

async function restoreWorkspaceTabsInDedicatedWindow(restorableTabs, groupEvidenceByWorkspaceTabId) {
  if (!restorableTabs.length) {
    return { windowId: null, openedTabs: [] };
  }

  if (!globalThis.chrome?.windows?.create || !globalThis.chrome?.tabs?.create) {
    throw new Error("Chrome windows/tabs API is unavailable.");
  }

  const firstTab = restorableTabs[0];
  const createdWindow = await chrome.windows.create({ url: firstTab.url, focused: true });
  const openedTabs = [];
  const firstOpenedTab = Array.isArray(createdWindow.tabs) ? createdWindow.tabs[0] : null;

  if (firstOpenedTab?.id) {
    openedTabs.push(createOpenedTabRecord(firstTab, firstOpenedTab, groupEvidenceByWorkspaceTabId));
  }

  const windowId = createdWindow.id || firstOpenedTab?.windowId;

  for (const tab of restorableTabs.slice(1)) {
    const openedTab = await chrome.tabs.create({ windowId, url: tab.url, active: false });
    openedTabs.push(createOpenedTabRecord(tab, openedTab, groupEvidenceByWorkspaceTabId));
  }

  return { windowId, openedTabs };
}

async function restoreWorkspaceTabsInCurrentWindow(restorableTabs, groupEvidenceByWorkspaceTabId) {
  if (!restorableTabs.length) {
    return { windowId: null, openedTabs: [] };
  }

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
    openedTabs.push(createOpenedTabRecord(tab, openedTab, groupEvidenceByWorkspaceTabId));
  }

  return { windowId: openedTabs[0]?.windowId || windowId, openedTabs };
}

async function getCurrentWindowSafe() {
  if (!globalThis.chrome?.windows?.getCurrent) return null;

  try {
    return await chrome.windows.getCurrent();
  } catch (_error) {
    return null;
  }
}

async function recreateRestoredChromeGroups(openedTabs, windowId) {
  const result = {
    groupAvailable: Boolean(globalThis.chrome?.tabs?.group && globalThis.chrome?.tabGroups?.update),
    windowId,
    recreatedGroupCount: 0,
    skippedGroupCount: 0,
    groups: []
  };

  if (!openedTabs.length) return result;

  if (!result.groupAvailable) {
    result.skippedGroupCount = countRestorableRoleGroups(openedTabs);
    await recordDiagnostic("warn", "archive_restore_groups_skipped", "Chrome tab group API is unavailable during archive restore.", result);
    return result;
  }

  const groupsByRole = groupOpenedTabsByRole(openedTabs);

  for (const group of groupsByRole) {
    if (!group.tabIds.length) {
      result.skippedGroupCount += 1;
      continue;
    }

    try {
      const groupId = await chrome.tabs.group({ tabIds: group.tabIds });
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

  await recordDiagnostic("info", "archive_restore_groups_recreated", "Archive restore role groups recreated.", result);
  return result;
}

async function refocusRestoredWindow(windowId, activeTabId) {
  if (!windowId || !globalThis.chrome?.windows?.update) return false;

  try {
    if (activeTabId && globalThis.chrome?.tabs?.update) {
      await chrome.tabs.update(activeTabId, { active: true });
    }

    await chrome.windows.update(windowId, { focused: true, state: "normal" });
    await recordDiagnostic("info", "archive_restore_window_focused", "Archive restore window focus requested.", {
      windowId,
      activeTabId
    });
    return true;
  } catch (error) {
    await recordDiagnostic("warn", "archive_restore_window_focus_failed", "Could not refocus restored archive window.", {
      windowId,
      activeTabId,
      error: summarizeError(error)
    });
    return false;
  }
}

function buildRestoredWorkspace(archivedWorkspace, selectedArchive, openedTabs, groupResult, restoreTargetMode) {
  const openedByWorkspaceTabId = new Map(openedTabs.map((openedTab) => [openedTab.workspaceTabId, openedTab]));
  const now = new Date().toISOString();
  const restoredTabs = archivedWorkspace.tabs.map((tab) => {
    const openedTab = openedByWorkspaceTabId.get(tab.workspaceTabId || "");

    if (!openedTab) {
      return { ...tab };
    }

    return {
      ...tab,
      tabId: openedTab.tabId,
      windowId: openedTab.windowId,
      groupId: Number.isInteger(openedTab.groupId) ? openedTab.groupId : -1,
      restoredAt: now,
      restoredFromArchiveId: selectedArchive.archiveId
    };
  });

  const restoreEvent = {
    eventId: crypto.randomUUID(),
    type: "archive_restored",
    createdAt: now,
    message: "Restored archived workspace, reopened " + openedTabs.length + " tab(s), and recreated " + groupResult.recreatedGroupCount + " role group(s) " + buildRestoreTargetMessage(restoreTargetMode) + ".",
    archiveId: selectedArchive.archiveId,
    archiveName: selectedArchive.archiveName,
    restoreTargetMode,
    openedTabCount: openedTabs.length,
    recreatedGroupCount: groupResult.recreatedGroupCount,
    skippedGroupCount: groupResult.skippedGroupCount,
    restoredWorkspaceTabIds: openedTabs.map((openedTab) => openedTab.workspaceTabId),
    groups: groupResult.groups,
    windowId: openedTabs[0]?.windowId || null
  };

  return {
    ...archivedWorkspace,
    updatedAt: now,
    restoredAt: now,
    restoredFromArchiveId: selectedArchive.archiveId,
    restoredFromArchiveName: selectedArchive.archiveName,
    tabs: restoredTabs,
    timeline: [...archivedWorkspace.timeline, restoreEvent]
  };
}

function createOpenedTabRecord(sourceTab, openedTab, groupEvidenceByWorkspaceTabId) {
  const groupEvidence = groupEvidenceByWorkspaceTabId.get(sourceTab.workspaceTabId || "") || {};

  return {
    workspaceTabId: sourceTab.workspaceTabId || "",
    tabId: openedTab.id,
    windowId: openedTab.windowId,
    groupId: -1,
    role: normalizeRole(groupEvidence.role || sourceTab.role),
    roleLabel: groupEvidence.roleLabel || getRoleLabel(sourceTab.role),
    savedGroupTitle: groupEvidence.title || "",
    url: openedTab.url || sourceTab.url,
    title: openedTab.title || sourceTab.title || ""
  };
}

function groupOpenedTabsByRole(openedTabs) {
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
    roleLabel: group.openedTabs.find((openedTab) => openedTab.roleLabel)?.roleLabel || group.roleLabel,
    tabIds: group.openedTabs.map((openedTab) => openedTab.tabId).filter((tabId) => Number.isInteger(tabId)),
    title: buildRestoreGroupTitle(group)
  }));
}

function buildSavedGroupEvidenceByWorkspaceTabId(workspace) {
  const evidence = new Map();
  const timeline = Array.isArray(workspace.timeline) ? workspace.timeline : [];

  for (const event of [...timeline].reverse()) {
    const groups = Array.isArray(event.groups) ? event.groups : [];

    for (const group of groups) {
      const workspaceTabIds = Array.isArray(group.workspaceTabIds) ? group.workspaceTabIds : [];

      for (const workspaceTabId of workspaceTabIds) {
        if (!workspaceTabId || evidence.has(workspaceTabId)) continue;

        evidence.set(workspaceTabId, {
          role: group.role || group.roleId || "",
          roleLabel: group.roleLabel || getRoleLabel(group.role || group.roleId),
          title: group.title || group.roleLabel || getRoleLabel(group.role || group.roleId)
        });
      }
    }
  }

  return evidence;
}

function countRestorableRoleGroups(openedTabs) {
  return groupOpenedTabsByRole(openedTabs).length;
}

function determineRestoreTargetMode(workspace) {
  if (hasDedicatedWindowEvidence(workspace)) return "dedicated_window";
  if ((Array.isArray(workspace.tabs) ? workspace.tabs.length : 0) >= DEDICATED_WINDOW_THRESHOLD_TAB_COUNT) return "dedicated_window";
  return "current_window";
}

function hasDedicatedWindowEvidence(workspace) {
  const timeline = Array.isArray(workspace.timeline) ? workspace.timeline : [];
  return timeline.some((event) => event?.type === "workspace_threshold_dedicated_window_executed" || Number.isInteger(event?.dedicatedWindowId));
}

function buildRestoreTargetMessage(restoreTargetMode) {
  return restoreTargetMode === "dedicated_window" ? "in a dedicated Chrome window" : "in the current Chrome window";
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

function buildRestoreGroupTitle(group) {
  const savedTitle = group.openedTabs.find((openedTab) => openedTab.savedGroupTitle)?.savedGroupTitle;
  if (savedTitle) return savedTitle;

  const shortLabels = {
    reference: "Ref"
  };

  return shortLabels[group.role] || group.roleLabel || "Group";
}

function getRestorableTabs(workspace) {
  return workspace.tabs.filter((tab) => isRestorableWebUrl(tab.url));
}

function isRestorableWebUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

async function getSelectedArchive(archiveId) {
  const archives = await getArchivedWorkspaces();
  return archives.find((archive) => archive.archiveId === archiveId) || null;
}

async function getArchivedWorkspaces() {
  const result = await chrome.storage.local.get(WORKSPACE_ARCHIVE_KEY);
  return Array.isArray(result[WORKSPACE_ARCHIVE_KEY]) ? result[WORKSPACE_ARCHIVE_KEY] : [];
}

function sanitizeWorkspace(workspace) {
  return {
    ...workspace,
    workspaceId: workspace.workspaceId || crypto.randomUUID(),
    name: workspace.name || "Untitled Workspace",
    aim: workspace.aim || "",
    workspaceType: workspace.workspaceType || "research",
    tabs: Array.isArray(workspace.tabs) ? workspace.tabs : [],
    journal: Array.isArray(workspace.journal) ? workspace.journal : [],
    timeline: Array.isArray(workspace.timeline) ? workspace.timeline : []
  };
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
    console.warn("Chrome Flow archive restore diagnostics failed:", error);
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

function setWorkspaceSessionStatus(message) {
  const status = document.getElementById("workspaceSessionStatus");
  if (status) status.textContent = message;
}
