import {
  appendRuntimeDiagnostic,
  getActiveWorkspaceRuntime,
  saveActiveWorkspaceRuntime
} from "./workspace-runtime-store.js";

import {
  buildRuntimeWorkspaceFromMemoryRecord,
  determineHydrationTargetMode
} from "./workspace-hydration-engine.js";

const WINDOW_SETTLE_DELAY_MS = 350;
const RESUME_LOCK_NAME = "chrome-flow-workspace-resume-transaction";
const VALIDATION_MODE = "developer_controlled_resume_safety_test";
let localResumeOperationInProgress = false;

class WorkspaceResumeOperationError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "WorkspaceResumeOperationError";
    this.code = code;
    this.details = details;
  }
}

async function resumeWorkspaceMemoryRecordSafely(record, options = {}) {
  const workspaceId = record?.workspace?.workspaceId || "";

  if (!workspaceId) {
    throw new WorkspaceResumeOperationError(
      "Selected workspace has no durable workspace id.",
      "resume_workspace_id_missing"
    );
  }

  return runWithResumeExecutionLock(workspaceId, options, () =>
    executeResumeTransaction(record, options)
  );
}

async function runWithResumeExecutionLock(workspaceId, options, operation) {
  if (localResumeOperationInProgress) {
    await recordResumeBlocked(workspaceId, options, "local_resume_operation_in_progress");
    throw new WorkspaceResumeOperationError(
      "Another workspace resume operation is already running.",
      "resume_operation_in_progress",
      { workspaceId, lockMode: "module_fallback" }
    );
  }

  if (globalThis.navigator?.locks?.request) {
    return navigator.locks.request(
      RESUME_LOCK_NAME,
      { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        if (!lock) {
          await recordResumeBlocked(workspaceId, options, "cross_context_resume_lock_unavailable");
          throw new WorkspaceResumeOperationError(
            "Another workspace resume operation is already running.",
            "resume_operation_in_progress",
            { workspaceId, lockMode: "web_locks" }
          );
        }

        return runWithLocalResumeLock(operation);
      }
    );
  }

  return runWithLocalResumeLock(operation);
}

async function runWithLocalResumeLock(operation) {
  if (localResumeOperationInProgress) {
    throw new WorkspaceResumeOperationError(
      "Another workspace resume operation is already running.",
      "resume_operation_in_progress",
      { lockMode: "module_fallback" }
    );
  }

  localResumeOperationInProgress = true;

  try {
    return await operation();
  } finally {
    localResumeOperationInProgress = false;
  }
}

async function executeResumeTransaction(record, options) {
  const operationId = crypto.randomUUID();
  const workspaceId = record.workspace.workspaceId;
  const previousRuntime = cloneValue(await getActiveWorkspaceRuntime());
  const previousBrowserFocus = await captureBrowserFocusSnapshot();
  const runtimeWorkspace = buildRuntimeWorkspaceFromMemoryRecord(record);
  const restoreTargetMode = determineHydrationTargetMode(record, runtimeWorkspace);
  const restorableTabs = runtimeWorkspace.tabs.filter((tab) => isRestorableWebUrl(tab.url));
  const skippedTabCount = runtimeWorkspace.tabs.length - restorableTabs.length;
  const validation = getValidationControls(options);
  const context = createResumeOperationContext({
    operationId,
    workspaceId,
    workspaceName: runtimeWorkspace.name,
    restoreTargetMode,
    previousRuntime,
    previousBrowserFocus
  });

  if (!restorableTabs.length) {
    throw new WorkspaceResumeOperationError(
      "Selected workspace has no restorable web tabs.",
      "resume_no_restorable_tabs",
      { workspaceId }
    );
  }

  if (!validation.bypassAlreadyActiveGuard) {
    const alreadyActive = await inspectAlreadyActiveWorkspace(previousRuntime, workspaceId);

    if (alreadyActive.blocked) {
      await recordResumeBlocked(workspaceId, options, "workspace_already_active_with_live_tabs", {
        operationId,
        exactLiveTabCount: alreadyActive.exactLiveTabCount,
        matchedWorkspaceTabIds: alreadyActive.matchedWorkspaceTabIds
      });
      throw new WorkspaceResumeOperationError(
        "This workspace is already active with live browser tabs. Resume was blocked to prevent duplicates.",
        "resume_workspace_already_active",
        alreadyActive
      );
    }
  }

  await safeAppendRuntimeDiagnostic("info", "workspace_resume_operation_started", "Transactional Workspace Library resume started.", {
    operationId,
    workspaceId,
    workspaceName: runtimeWorkspace.name,
    source: options.source || "workspace_library_resume",
    restoreTargetMode,
    restorableTabCount: restorableTabs.length,
    skippedTabCount,
    previousRuntimeWorkspaceId: previousRuntime?.workspaceId || "",
    previousBrowserFocus,
    validationMode: validation.enabled,
    provisionalTabsBackgrounded: validation.keepCreatedTabsInBackground
  });

  try {
    if (validation.holdBeforeBrowserMutationMs > 0) {
      await delay(validation.holdBeforeBrowserMutationMs);
    }

    if (validation.failBeforeBrowserMutation) {
      throw createControlledValidationFailure("before_browser_mutation", context);
    }

    const restoreResult = await restoreWorkspaceTabsTransactionally(
      restorableTabs,
      restoreTargetMode,
      context,
      validation
    );

    await delay(WINDOW_SETTLE_DELAY_MS);

    const groupResult = await recreateRestoredChromeGroups(
      restoreResult.openedTabs,
      restoreResult.windowId,
      runtimeWorkspace,
      context
    );

    await delay(WINDOW_SETTLE_DELAY_MS);

    const focusRequested = await refocusRestoredWindow(
      restoreResult.windowId,
      restoreResult.openedTabs[0]?.tabId || null,
      operationId
    );

    const hydratedWorkspace = buildHydratedWorkspace(
      runtimeWorkspace,
      record,
      restoreResult,
      groupResult,
      restoreTargetMode,
      operationId
    );

    await saveActiveWorkspaceRuntime(hydratedWorkspace);
    context.runtimeCommitted = true;
    context.committedAt = new Date().toISOString();

    await safeAppendRuntimeDiagnostic("info", "workspace_library_resume_executed", "Workspace Library resume executed and hydrated saved workspace into active runtime.", {
      operationId,
      source: options.source || "workspace_library_resume",
      workspaceId: hydratedWorkspace.workspaceId,
      workspaceName: hydratedWorkspace.name,
      restoreTargetMode,
      restoreCreationMode: restoreResult.creationMode,
      reopenedTabCount: restoreResult.openedTabs.length,
      skippedTabCount,
      windowId: restoreResult.windowId,
      temporaryTabIds: restoreResult.temporaryTabIds || [],
      removedTemporaryTabIds: restoreResult.removedTemporaryTabIds || [],
      recreatedGroupCount: groupResult.recreatedGroupCount,
      skippedGroupCount: groupResult.skippedGroupCount,
      focusRequested,
      transactionalResume: true,
      rollbackRequired: false
    });

    await safeAppendRuntimeDiagnostic("info", "workspace_resume_operation_committed", "Transactional Workspace Library resume committed to active runtime.", {
      operationId,
      workspaceId,
      previousRuntimeWorkspaceId: previousRuntime?.workspaceId || "",
      restoreTargetMode,
      createdTabIds: [...context.createdTabIds],
      createdGroupIds: [...context.createdGroupIds],
      createdWindowId: context.createdWindowId,
      reopenedTabCount: restoreResult.openedTabs.length,
      recreatedGroupCount: groupResult.recreatedGroupCount,
      runtimeCommitted: true,
      committedAt: context.committedAt
    });

    return {
      operationId,
      hydratedWorkspace,
      restoreTargetMode,
      restoreResult,
      groupResult,
      focusRequested,
      skippedTabCount,
      transaction: summarizeOperationContext(context)
    };
  } catch (error) {
    if (context.runtimeCommitted) {
      await safeAppendRuntimeDiagnostic("error", "workspace_resume_operation_post_commit_error", "Workspace resume encountered an error after active runtime commit; rollback was not attempted.", {
        operationId,
        workspaceId,
        error: summarizeError(error),
        runtimeCommitted: true
      });
      throw error;
    }

    const rollback = await rollbackResumeOperation(context);
    const action = rollback.complete
      ? "workspace_resume_operation_rolled_back"
      : "workspace_resume_operation_rollback_incomplete";
    const level = rollback.complete ? "warn" : "error";

    await safeAppendRuntimeDiagnostic(level, action, rollback.complete
      ? "Failed workspace resume was rolled back before active runtime commit."
      : "Failed workspace resume could not be rolled back completely.", {
      operationId,
      workspaceId,
      restoreTargetMode,
      error: summarizeError(error),
      rollback,
      previousRuntimeWorkspaceId: previousRuntime?.workspaceId || "",
      runtimeCommitted: false,
      validationMode: validation.enabled
    });

    const wrappedError = error instanceof WorkspaceResumeOperationError
      ? error
      : new WorkspaceResumeOperationError(
        error?.message || "Workspace resume failed.",
        "resume_operation_failed",
        { originalError: summarizeError(error) }
      );

    wrappedError.details = {
      ...(wrappedError.details || {}),
      operationId,
      rollback
    };

    throw wrappedError;
  }
}

async function restoreWorkspaceTabsTransactionally(restorableTabs, restoreTargetMode, context, validation) {
  if (restoreTargetMode === "dedicated_window") {
    return restoreTabsInDedicatedWindow(restorableTabs, context, validation);
  }

  return restoreTabsInCurrentWindow(restorableTabs, context, validation);
}

async function restoreTabsInDedicatedWindow(restorableTabs, context, validation) {
  assertChromeCreationApis(true);

  const createdWindow = await chrome.windows.create({
    focused: !validation.keepCreatedTabsInBackground,
    state: "normal"
  });
  const windowId = createdWindow.id;

  if (!Number.isInteger(windowId)) {
    throw new Error("Chrome did not return a valid dedicated resume window id.");
  }

  context.createdWindowId = windowId;
  context.createdDedicatedWindow = true;
  context.temporaryTabIds = Array.isArray(createdWindow.tabs)
    ? createdWindow.tabs.map((tab) => tab.id).filter(Number.isInteger)
    : [];

  if (!validation.keepCreatedTabsInBackground) {
    await chrome.windows.update(windowId, { focused: true, state: "normal" });
  }
  await delay(WINDOW_SETTLE_DELAY_MS);

  const openedTabs = await createResumeTabs(
    restorableTabs,
    windowId,
    context,
    validation
  );

  await delay(WINDOW_SETTLE_DELAY_MS);

  const openedTabIds = openedTabs.map((tab) => tab.tabId).filter(Number.isInteger);
  const removedTemporaryTabIds = [];

  for (const temporaryTabId of context.temporaryTabIds) {
    if (openedTabIds.includes(temporaryTabId)) continue;

    try {
      await chrome.tabs.remove(temporaryTabId);
      removedTemporaryTabIds.push(temporaryTabId);
    } catch (error) {
      await safeAppendRuntimeDiagnostic("warn", "workspace_resume_temporary_tab_remove_failed", "Could not remove temporary tab from dedicated resume window.", {
        operationId: context.operationId,
        temporaryTabId,
        windowId,
        error: summarizeError(error)
      });
    }
  }

  context.removedTemporaryTabIds = removedTemporaryTabIds;

  if (!validation.keepCreatedTabsInBackground) {
    await chrome.windows.update(windowId, { focused: true, state: "normal" });
  }

  return {
    windowId,
    openedTabs,
    temporaryTabIds: [...context.temporaryTabIds],
    removedTemporaryTabIds,
    creationMode: validation.keepCreatedTabsInBackground
      ? "transactional_background_window_validation"
      : "transactional_empty_window_then_create_resumed_tabs"
  };
}

async function restoreTabsInCurrentWindow(restorableTabs, context, validation) {
  assertChromeCreationApis(false);
  const currentWindow = await getCurrentWindowSafe();
  const windowId = Number.isInteger(currentWindow?.id) ? currentWindow.id : null;
  const openedTabs = await createResumeTabs(
    restorableTabs,
    windowId,
    context,
    validation
  );

  return {
    windowId: openedTabs[0]?.windowId || windowId,
    openedTabs,
    temporaryTabIds: [],
    removedTemporaryTabIds: [],
    creationMode: validation.keepCreatedTabsInBackground
      ? "transactional_current_window_background_validation"
      : "transactional_current_window_create_resumed_tabs"
  };
}

async function createResumeTabs(restorableTabs, windowId, context, validation) {
  const openedTabs = [];

  for (const [index, tab] of restorableTabs.entries()) {
    const createArgs = {
      url: tab.url,
      active: validation.keepCreatedTabsInBackground ? false : index === 0
    };

    if (Number.isInteger(windowId)) {
      createArgs.windowId = windowId;
    }

    const openedTab = await chrome.tabs.create(createArgs);
    const openedRecord = createOpenedTabRecord(tab, openedTab);
    openedTabs.push(openedRecord);

    if (Number.isInteger(openedRecord.tabId)) {
      context.createdTabIds.push(openedRecord.tabId);
    }

    if (
      validation.failAfterOpenedTabCount > 0
      && openedTabs.length >= validation.failAfterOpenedTabCount
    ) {
      throw createControlledValidationFailure(
        "after_opened_tab_" + openedTabs.length,
        context
      );
    }
  }

  return openedTabs;
}

async function recreateRestoredChromeGroups(openedTabs, windowId, workspace, context) {
  const result = {
    groupAvailable: Boolean(globalThis.chrome?.tabs?.group && globalThis.chrome?.tabGroups?.update),
    windowId,
    recreatedGroupCount: 0,
    skippedGroupCount: 0,
    groups: []
  };

  if (!openedTabs.length) return result;

  if (!result.groupAvailable) {
    result.skippedGroupCount = groupOpenedTabsByRole(openedTabs, workspace).length;
    await safeAppendRuntimeDiagnostic("warn", "workspace_resume_groups_skipped", "Chrome tab group API is unavailable during Workspace Library resume.", {
      operationId: context.operationId,
      ...result
    });
    return result;
  }

  for (const group of groupOpenedTabsByRole(openedTabs, workspace)) {
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
      context.createdGroupIds.push(groupId);
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

  await safeAppendRuntimeDiagnostic("info", "workspace_resume_groups_recreated", "Workspace Library resume role groups recreated.", {
    operationId: context.operationId,
    ...result
  });
  return result;
}

async function refocusRestoredWindow(windowId, activeTabId, operationId) {
  if (!Number.isInteger(windowId) || !globalThis.chrome?.windows?.update) return false;
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (attempt > 1) await delay(WINDOW_SETTLE_DELAY_MS * attempt);

    try {
      if (globalThis.chrome?.windows?.get) {
        await chrome.windows.get(windowId);
      }
      if (Number.isInteger(activeTabId) && globalThis.chrome?.tabs?.update) {
        await chrome.tabs.update(activeTabId, { active: true });
      }
      await chrome.windows.update(windowId, { focused: true });
      await safeAppendRuntimeDiagnostic("info", "workspace_resume_window_focused", "Workspace Library resume window focus requested.", {
        operationId,
        windowId,
        activeTabId,
        attempt
      });
      return true;
    } catch (error) {
      lastError = error;
    }
  }

  await safeAppendRuntimeDiagnostic("warn", "workspace_resume_window_focus_failed", "Could not refocus Workspace Library resume window.", {
    operationId,
    windowId,
    activeTabId,
    error: summarizeError(lastError)
  });
  return false;
}

function buildHydratedWorkspace(runtimeWorkspace, memoryRecord, restoreResult, groupResult, restoreTargetMode, operationId) {
  const openedByWorkspaceTabId = new Map(
    restoreResult.openedTabs.map((openedTab) => [openedTab.workspaceTabId, openedTab])
  );
  const now = new Date().toISOString();
  const hydratedTabs = runtimeWorkspace.tabs.map((tab) => {
    const openedTab = openedByWorkspaceTabId.get(tab.workspaceTabId || "");

    if (!openedTab) {
      return {
        ...tab,
        tabId: null,
        windowId: null,
        groupId: -1,
        isOpen: false
      };
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
    windowId: restoreResult.openedTabs[0]?.windowId || null,
    resumeOperationId: operationId,
    transactionalResume: true
  };

  return {
    ...runtimeWorkspace,
    updatedAt: now,
    resumedAt: now,
    resumedFromWorkspaceMemoryId: memoryRecord.workspace?.workspaceId || "",
    resumeOperationId: operationId,
    tabs: hydratedTabs,
    timeline: [...runtimeWorkspace.timeline, resumeEvent]
  };
}

async function rollbackResumeOperation(context) {
  const rollback = {
    attemptedAt: new Date().toISOString(),
    createdWindowId: context.createdWindowId,
    createdTabIds: [...context.createdTabIds],
    createdGroupIds: [...context.createdGroupIds],
    removedWindow: false,
    removedTabIds: [],
    remainingTabIds: [],
    remainingWindowId: null,
    errors: [],
    previousRuntimeWorkspaceId: context.previousRuntime?.workspaceId || "",
    runtimeAfterRollbackWorkspaceId: "",
    runtimePreserved: false,
    previousBrowserFocus: cloneValue(context.previousBrowserFocus),
    focusRestoreAttempted: false,
    focusRestored: false,
    focusAfterRollback: null,
    complete: false
  };

  if (context.createdDedicatedWindow && Number.isInteger(context.createdWindowId)) {
    try {
      await chrome.windows.remove(context.createdWindowId);
      rollback.removedWindow = true;
    } catch (error) {
      rollback.errors.push({
        action: "remove_created_window",
        windowId: context.createdWindowId,
        error: summarizeError(error)
      });
    }
  }

  if (!rollback.removedWindow) {
    for (const tabId of context.createdTabIds) {
      const removed = await removeCreatedTabWithRetry(tabId, rollback.errors);
      if (removed) rollback.removedTabIds.push(tabId);
    }
  }

  await delay(WINDOW_SETTLE_DELAY_MS);

  for (const tabId of context.createdTabIds) {
    if (await chromeTabExists(tabId)) {
      rollback.remainingTabIds.push(tabId);
    }
  }

  if (Number.isInteger(context.createdWindowId) && await chromeWindowExists(context.createdWindowId)) {
    rollback.remainingWindowId = context.createdWindowId;
  }

  const focusResult = await restoreBrowserFocusSnapshot(context.previousBrowserFocus);
  rollback.focusRestoreAttempted = focusResult.attempted;
  rollback.focusRestored = focusResult.restored;
  rollback.focusAfterRollback = focusResult.after;

  try {
    const runtimeAfterRollback = await getActiveWorkspaceRuntime();
    rollback.runtimeAfterRollbackWorkspaceId = runtimeAfterRollback?.workspaceId || "";
    rollback.runtimePreserved = rollback.runtimeAfterRollbackWorkspaceId === (context.previousRuntime?.workspaceId || "");
  } catch (error) {
    rollback.errors.push({
      action: "verify_runtime_after_rollback",
      error: summarizeError(error)
    });
  }

  const focusRequirementSatisfied = !context.previousBrowserFocus?.activeTabId
    || rollback.focusRestored;

  rollback.complete = rollback.remainingTabIds.length === 0
    && rollback.remainingWindowId === null
    && rollback.runtimePreserved
    && focusRequirementSatisfied;

  return rollback;
}

async function captureBrowserFocusSnapshot() {
  const snapshot = {
    windowId: null,
    activeTabId: null,
    capturedAt: new Date().toISOString()
  };

  try {
    const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const activeTab = activeTabs[0] || null;
    snapshot.activeTabId = Number.isInteger(activeTab?.id) ? activeTab.id : null;
    snapshot.windowId = Number.isInteger(activeTab?.windowId) ? activeTab.windowId : null;
  } catch (_error) {
    try {
      const currentWindow = await getCurrentWindowSafe();
      snapshot.windowId = Number.isInteger(currentWindow?.id) ? currentWindow.id : null;
    } catch (_innerError) {
      // Focus capture is best-effort; rollback still preserves runtime and created resources.
    }
  }

  return snapshot;
}

async function restoreBrowserFocusSnapshot(snapshot) {
  const result = {
    attempted: Boolean(Number.isInteger(snapshot?.activeTabId) || Number.isInteger(snapshot?.windowId)),
    restored: false,
    after: null
  };

  if (!result.attempted) {
    result.restored = true;
    return result;
  }

  try {
    if (Number.isInteger(snapshot.windowId) && globalThis.chrome?.windows?.update) {
      await chrome.windows.update(snapshot.windowId, { focused: true });
    }

    if (Number.isInteger(snapshot.activeTabId) && globalThis.chrome?.tabs?.update) {
      await chrome.tabs.update(snapshot.activeTabId, { active: true });
    }

    await delay(100);
    result.after = await captureBrowserFocusSnapshot();
    result.restored = (!Number.isInteger(snapshot.windowId) || result.after.windowId === snapshot.windowId)
      && (!Number.isInteger(snapshot.activeTabId) || result.after.activeTabId === snapshot.activeTabId);
  } catch (_error) {
    result.after = await captureBrowserFocusSnapshot();
    result.restored = false;
  }

  return result;
}

async function removeCreatedTabWithRetry(tabId, errors) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      if (!(await chromeTabExists(tabId))) return true;
      await chrome.tabs.remove(tabId);
      return true;
    } catch (error) {
      if (attempt === 2) {
        errors.push({
          action: "remove_created_tab",
          tabId,
          attempt,
          error: summarizeError(error)
        });
      } else {
        await delay(WINDOW_SETTLE_DELAY_MS);
      }
    }
  }

  return false;
}

async function inspectAlreadyActiveWorkspace(activeRuntime, workspaceId) {
  if (!activeRuntime || activeRuntime.workspaceId !== workspaceId) {
    return {
      blocked: false,
      exactLiveTabCount: 0,
      matchedWorkspaceTabIds: []
    };
  }

  const matchedWorkspaceTabIds = [];

  for (const tab of Array.isArray(activeRuntime.tabs) ? activeRuntime.tabs : []) {
    if (!Number.isInteger(tab?.tabId) || !tab.url) continue;

    try {
      const liveTab = await chrome.tabs.get(tab.tabId);
      if (normalizeUrlForOwnership(liveTab?.url || "") === normalizeUrlForOwnership(tab.url)) {
        matchedWorkspaceTabIds.push(tab.workspaceTabId || "");
      }
    } catch (_error) {
      // Missing or stale projection identifiers are not treated as ownership proof.
    }
  }

  return {
    blocked: matchedWorkspaceTabIds.length > 0,
    exactLiveTabCount: matchedWorkspaceTabIds.length,
    matchedWorkspaceTabIds: matchedWorkspaceTabIds.filter(Boolean)
  };
}

async function recordResumeBlocked(workspaceId, options, reason, details = {}) {
  await safeAppendRuntimeDiagnostic("warn", "workspace_resume_operation_blocked", "Workspace resume was blocked before browser mutation.", {
    workspaceId,
    source: options.source || "workspace_library_resume",
    reason,
    ...details
  });
}

function createResumeOperationContext({ operationId, workspaceId, workspaceName, restoreTargetMode, previousRuntime, previousBrowserFocus }) {
  return {
    operationId,
    workspaceId,
    workspaceName,
    restoreTargetMode,
    previousRuntime,
    previousBrowserFocus,
    createdWindowId: null,
    createdDedicatedWindow: false,
    createdTabIds: [],
    createdGroupIds: [],
    temporaryTabIds: [],
    removedTemporaryTabIds: [],
    runtimeCommitted: false,
    committedAt: ""
  };
}

function summarizeOperationContext(context) {
  return {
    operationId: context.operationId,
    workspaceId: context.workspaceId,
    restoreTargetMode: context.restoreTargetMode,
    previousRuntimeWorkspaceId: context.previousRuntime?.workspaceId || "",
    previousBrowserFocus: cloneValue(context.previousBrowserFocus),
    createdWindowId: context.createdWindowId,
    createdDedicatedWindow: context.createdDedicatedWindow,
    createdTabIds: [...context.createdTabIds],
    createdGroupIds: [...context.createdGroupIds],
    temporaryTabIds: [...context.temporaryTabIds],
    removedTemporaryTabIds: [...context.removedTemporaryTabIds],
    runtimeCommitted: context.runtimeCommitted,
    committedAt: context.committedAt
  };
}

function getValidationControls(options = {}) {
  const enabled = options.validationMode === VALIDATION_MODE;
  const failAfterOpenedTabCount = enabled
    ? clampInteger(options.testFailureAfterOpenedTabCount, 0, 20)
    : 0;

  return {
    enabled,
    bypassAlreadyActiveGuard: enabled && options.bypassAlreadyActiveGuard === true,
    holdBeforeBrowserMutationMs: enabled
      ? clampInteger(options.testHoldBeforeBrowserMutationMs, 0, 5000)
      : 0,
    failBeforeBrowserMutation: enabled && options.testFailureBeforeBrowserMutation === true,
    failAfterOpenedTabCount,
    keepCreatedTabsInBackground: enabled
      && (options.keepCreatedTabsInBackground === true || failAfterOpenedTabCount > 0)
  };
}

function createControlledValidationFailure(stage, context) {
  return new WorkspaceResumeOperationError(
    "Controlled resume validation failure at " + stage + ".",
    "resume_controlled_validation_failure",
    {
      stage,
      operationId: context.operationId,
      workspaceId: context.workspaceId
    }
  );
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
    tabIds: group.openedTabs.map((openedTab) => openedTab.tabId).filter(Number.isInteger),
    title: buildChromeGroupTitle(workspace, group.roleLabel || getRoleLabel(group.role) || "Group")
  }));
}

function normalizeRole(role) {
  return typeof role === "string" && role.trim()
    ? role.trim().toLowerCase()
    : "unassigned";
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

  return labels[normalizedRole]
    || normalizedRole.charAt(0).toUpperCase() + normalizedRole.slice(1);
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
  return restoreTargetMode === "dedicated_window"
    ? "in a dedicated Chrome window"
    : "in the current Chrome window";
}

function assertChromeCreationApis(dedicatedWindow) {
  if (!globalThis.chrome?.tabs?.create) {
    throw new Error("Chrome tabs API is unavailable.");
  }

  if (dedicatedWindow && !globalThis.chrome?.windows?.create) {
    throw new Error("Chrome windows API is unavailable.");
  }
}

async function getCurrentWindowSafe() {
  if (!globalThis.chrome?.windows?.getCurrent) return null;

  try {
    return await chrome.windows.getCurrent();
  } catch (_error) {
    return null;
  }
}

async function chromeTabExists(tabId) {
  if (!Number.isInteger(tabId) || !globalThis.chrome?.tabs?.get) return false;

  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch (_error) {
    return false;
  }
}

async function chromeWindowExists(windowId) {
  if (!Number.isInteger(windowId) || !globalThis.chrome?.windows?.get) return false;

  try {
    await chrome.windows.get(windowId);
    return true;
  } catch (_error) {
    return false;
  }
}

function isRestorableWebUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

function normalizeUrlForOwnership(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch (_error) {
    return String(url || "").trim();
  }
}

function cloneValue(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function clampInteger(value, minimum, maximum) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return minimum;
  return Math.max(minimum, Math.min(maximum, number));
}

async function safeAppendRuntimeDiagnostic(level, action, message, details = {}) {
  try {
    await appendRuntimeDiagnostic(level, action, message, details);
  } catch (_error) {
    // Diagnostics must never change resume commit or rollback behavior.
  }
}

function summarizeError(error) {
  if (!error) return { message: "Unknown error" };

  return {
    name: error.name || "Error",
    message: error.message || String(error),
    code: error.code || "",
    details: error.details || {},
    stack: typeof error.stack === "string" ? error.stack.slice(0, 2000) : ""
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export {
  RESUME_LOCK_NAME,
  VALIDATION_MODE,
  WorkspaceResumeOperationError,
  resumeWorkspaceMemoryRecordSafely
};
