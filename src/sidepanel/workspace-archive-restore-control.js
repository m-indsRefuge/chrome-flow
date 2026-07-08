const WORKSPACE_KEY = "chromeFlowWorkspace";
const WORKSPACE_ARCHIVE_KEY = "chromeFlowWorkspaceArchive";
const DIAGNOSTICS_KEY = "chromeFlowDiagnostics";
const MAX_DIAGNOSTICS = 200;
const DEDICATED_WINDOW_THRESHOLD_TAB_COUNT = 4;
const WINDOW_SETTLE_DELAY_MS = 350;

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
  const restoreTargetMode = determineRestoreTargetMode(archivedWorkspace, selectedArchive);
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
    await delay(WINDOW_SETTLE_DELAY_MS);
    const groupResult = await recreateRestoredChromeGroups(restoreResult.openedTabs, restoreResult.windowId, archivedWorkspace);
    await delay(WINDOW_SETTLE_DELAY_MS);
    const focusRequested = await refocusRestoredWindow(restoreResult.windowId, restoreResult.openedTabs[0]?.tabId || null);
    const restoredWorkspace = buildRestoredWorkspace(archivedWorkspace, selectedArchive, restoreResult.openedTabs, groupResult, restoreTargetMode);

    await chrome.storage.local.set({ [WORKSPACE_KEY]: restoredWorkspace });
    await recordDiagnostic("info", "archive_restored", "Archived workspace restored as active workspace.", {
      archiveId: selectedArchive.archiveId,
      archiveName: selectedArchive.archiveName,
      workspaceId: restoredWorkspace.workspaceId,
      restoreTargetMode,
      restorePolicy: buildRestorePolicyEvidence(archivedWorkspace, selectedArchive),
      restoreCreationMode: restoreResult.creationMode,
      reopenedTabCount: restoreResult.openedTabs.length,
      skippedTabCount,
      windowId: restoreResult.windowId,
      temporaryTabIds: restoreResult.temporaryTabIds || [],
      removedTemporaryTabIds: restoreResult.removedTemporaryTabIds || [],
      recreatedGroupCount: groupResult.recreatedGroupCount,
      skippedGroupCount: groupResult.skippedGroupCount,
      focusRequested,
      archiveRecordKept: true
    });

    setWorkspaceSessionStatus("Restored archive: " + selectedArchive.archiveName + ". Reopened " + restoreResult.openedTabs.length + " tab(s) and recreated " + groupResult.recreatedGroupCount + " group(s) " + buildRestoreTargetMessage(restoreTargetMode) + ".");
    window.setTimeout(() => void refocusRestoredWindow(restoreResult.windowId, restoreResult.openedTabs[0]?.tabId || null), 650);
    window.setTimeout(() => window.location.reload(), 1200);
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
    return {
      windowId: null,
      openedTabs: [],
      temporaryTabIds: [],
      removedTemporaryTabIds: [],
      creationMode: "empty_dedicated_window_no_restorable_tabs"
    };
  }

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
    throw new Error("Chrome did not return a valid dedicated restore window id.");
  }

  await chrome.windows.update(windowId, { focused: true, state: "normal" });
  await delay(WINDOW_SETTLE_DELAY_MS);

  for (const [index, tab] of restorableTabs.entries()) {
    const openedTab = await chrome.tabs.create({
      windowId,
      url: tab.url,
      active: index === 0
    });
    openedTabs.push(createOpenedTabRecord(tab, openedTab, groupEvidenceByWorkspaceTabId));
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
      await recordDiagnostic("warn", "archive_restore_temporary_tab_remove_failed", "Could not remove temporary tab from dedicated restore window.", {
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
    creationMode: "empty_window_then_create_restored_tabs"
  };
}

async function restoreWorkspaceTabsInCurrentWindow(restorableTabs, groupEvidenceByWorkspaceTabId) {
  if (!restorableTabs.length) {
    return {
      windowId: null,
      openedTabs: [],
      temporaryTabIds: [],
      removedTemporaryTabIds: [],
      creationMode: "current_window_no_restorable_tabs"
    };
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

  return {
    windowId: openedTabs[0]?.windowId || windowId,
    openedTabs,
    temporaryTabIds: [],
    removedTemporaryTabIds: [],
    creationMode: "current_window_create_restored_tabs"
  };
}

async function getCurrentWindowSafe() {
  if (!globalThis.chrome?.windows?.getCurrent) return null;

  try {
    return await chrome.windows.getCurrent();
  } catch (_error) {
    return null;
  }
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
    await recordDiagnostic("warn", "archive_restore_groups_skipped", "Chrome tab group API is unavailable during archive restore.", result);
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

  await recordDiagnostic("info", "archive_restore_groups_recreated", "Archive restore role groups recreated.", result);
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
      await recordDiagnostic("info", "archive_restore_window_focused", "Archive restore window focus requested.", {
        windowId,
        activeTabId,
        attempt
      });
      return true;
    } catch (error) {
      lastError = error;
    }
  }

  await recordDiagnostic("warn", "archive_restore_window_focus_failed", "Could not refocus restored archive window.", {
    windowId,
    activeTabId,
    error: summarizeError(lastError)
  });
  return false;
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
    savedGroupTitle: normalizeSavedGroupTitle(groupEvidence.title),
    url: openedTab.url || sourceTab.url,
    title: openedTab.title || sourceTab.title || ""
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
    roleLabel: group.openedTabs.find((openedTab) => openedTab.roleLabel)?.roleLabel || group.roleLabel,
    tabIds: group.openedTabs.map((openedTab) => openedTab.tabId).filter((tabId) => Number.isInteger(tabId)),
    title: buildRestoreGroupTitle(group, workspace)
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
          title: normalizeSavedGroupTitle(group.title || group.roleLabel || getRoleLabel(group.role || group.roleId))
        });
      }
    }
  }

  return evidence;
}

function countRestorableRoleGroups(openedTabs, workspace = {}) {
  return groupOpenedTabsByRole(openedTabs, workspace).length;
}

function determineRestoreTargetMode(workspace, selectedArchive = {}) {
  const tabCount = getArchivedWorkspaceTabCount(workspace, selectedArchive);

  if (hasDedicatedWindowEvidence(workspace, selectedArchive)) return "dedicated_window";
  if (tabCount >= DEDICATED_WINDOW_THRESHOLD_TAB_COUNT) return "dedicated_window";
  return "current_window";
}

function getArchivedWorkspaceTabCount(workspace, selectedArchive = {}) {
  const workspaceTabCount = Array.isArray(workspace.tabs) ? workspace.tabs.length : 0;
  const summaryTabCount = Number(selectedArchive.summary?.tabCount || 0);
  return Math.max(workspaceTabCount, summaryTabCount);
}

function hasDedicatedWindowEvidence(workspace, selectedArchive = {}) {
  const timeline = Array.isArray(workspace.timeline) ? workspace.timeline : [];
  const archiveName = String(selectedArchive.archiveName || "").toLowerCase();

  return archiveName.includes("dedicated")
    || timeline.some((event) => {
      const eventType = String(event?.type || "").toLowerCase();
      const eventMessage = String(event?.message || "").toLowerCase();
      return eventType.includes("dedicated_window")
        || eventType.includes("workspace_tabs_moved_to_new_window")
        || eventMessage.includes("dedicated window")
        || eventMessage.includes("new chrome window")
        || Number.isInteger(event?.dedicatedWindowId)
        || (Number.isInteger(event?.newWindowId) && eventType.includes("window"))
        || (Number.isInteger(event?.windowId) && eventType.includes("threshold"));
    });
}

function buildRestorePolicyEvidence(workspace, selectedArchive = {}) {
  return {
    thresholdTabCount: DEDICATED_WINDOW_THRESHOLD_TAB_COUNT,
    archivedWorkspaceTabCount: getArchivedWorkspaceTabCount(workspace, selectedArchive),
    dedicatedWindowEvidence: hasDedicatedWindowEvidence(workspace, selectedArchive),
    productRule: "0-3 tabs without dedicated-window history restore into the current window; 4+ tabs or dedicated-window history restore into a dedicated window."
  };
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

function buildRestoreGroupTitle(group, workspace = {}) {
  return createChromeGroupTitle(workspace, group.roleLabel || getRoleLabel(group.role) || "Group");
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

function normalizeSavedGroupTitle(title) {
  const candidate = typeof title === "string" ? title.trim() : "";
  const lowerCandidate = candidate.toLowerCase();

  if (!candidate) return "";
  if (lowerCandidate.includes("legacy")) return "";
  if (lowerCandidate.includes("workspace_snapshot")) return "";
  if (lowerCandidate.includes("active_workspace")) return "";
  if (lowerCandidate.includes("restored")) return "";

  return candidate;
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

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
