import {
  appendRuntimeDiagnostic,
  getActiveWorkspaceRuntime
} from "./workspace-runtime-store.js";
import { getSidePanelRuntimeWorkspaceAuthority } from "./runtime-workspace-activation/side-panel-runtime.js";
import { normalizeWorkspaceRevision } from "./runtime-contract/revision.js";
import { EVENT_IDENTITIES } from "./constellation-identity-contract.js";
import {
  PROJECTION_RECONCILIATION_HOLD_KEY,
  PROJECTION_RECONCILIATION_HOLD_SCHEMA,
  snapshotAndValidateProjectionReconciliationHold
} from "./workspace-projection-reconciliation/contract.js";

import {
  buildRuntimeWorkspaceFromMemoryRecord,
  determineHydrationTargetMode
} from "./workspace-hydration-engine.js";

const WINDOW_SETTLE_DELAY_MS = 350;
const TARGET_PROJECTION_STABILIZATION_ATTEMPTS = 12;
const TARGET_PROJECTION_STABILIZATION_DELAY_MS = 250;
const PROJECTION_RECONCILIATION_HOLD_TTL_MS = 120000;
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
  const runtimeWorkspaceAuthority = options.runtimeWorkspaceAuthority || getSidePanelRuntimeWorkspaceAuthority();
  const authorityState = await runtimeWorkspaceAuthority.bootstrapExisting({ workspace: previousRuntime, force: true });
  if (authorityState.status !== "active") {
    throw new WorkspaceResumeOperationError(
      "Workspace resume requires verified active runtime authority.",
      "resume_activation_barrier_not_verified",
      { workspaceId, activation: authorityState }
    );
  }
  const preMutationAuthorityEvidence = cloneValue(authorityState.result);
  const memoryRuntimeWorkspace = buildRuntimeWorkspaceFromMemoryRecord(record);
  const preparedWorkspace = prepareResumeWorkspaceForActivation(memoryRuntimeWorkspace, previousRuntime, preMutationAuthorityEvidence);
  if (!preparedWorkspace.valid) {
    throw new WorkspaceResumeOperationError(
      "Workspace resume could not bind the selected saved state to verified active runtime authority.",
      preparedWorkspace.reason,
      { workspaceId }
    );
  }
  const runtimeWorkspace = preparedWorkspace.workspace;
  const previousBrowserFocus = await captureBrowserFocusSnapshot();
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
    previousBrowserFocus,
    preMutationAuthorityEvidence
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
      await safeAppendRuntimeDiagnostic("info", "workspace_resume_existing_projection_recovered", "Resume reused the already-active verified workspace projection without opening duplicate tabs.", {
        operationId,
        exactLiveTabCount: alreadyActive.exactLiveTabCount,
        matchedWorkspaceTabIds: alreadyActive.matchedWorkspaceTabIds,
        activation: authorityState.result
      });
      return createAlreadyActiveRecoveryResult(operationId, previousRuntime, restoreTargetMode, skippedTabCount, authorityState, alreadyActive);
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
    context.reconciliationHold = await acquireProjectionReconciliationHold({
      operationId,
      workspaceIds: [previousRuntime?.workspaceId, workspaceId],
      sourceWindowId: preMutationAuthorityEvidence.sourceWindowId
    });
    context.reconciliationHoldVerified = true;

    if (validation.holdBeforeBrowserMutationMs > 0) {
      await delay(validation.holdBeforeBrowserMutationMs);
    }

    if (validation.failBeforeBrowserMutation) {
      throw createControlledValidationFailure("before_browser_mutation", context);
    }

    context.browserMutationStarted = true;
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

    const targetProjectionStabilization = await stabilizeOpenedTabProjection(
      restoreResult.openedTabs,
      restoreResult.windowId,
      {
        getTab: (tabId) => chrome.tabs.get(tabId),
        wait: delay,
        maxAttempts: TARGET_PROJECTION_STABILIZATION_ATTEMPTS,
        intervalMs: TARGET_PROJECTION_STABILIZATION_DELAY_MS
      }
    );
    context.targetProjectionStabilization = targetProjectionStabilization;

    if (!targetProjectionStabilization.verified) {
      await safeAppendRuntimeDiagnostic("warn", "workspace_resume_target_projection_not_stable", "Workspace resume target tabs did not settle into exact browser identity before runtime replacement.", {
        operationId,
        workspaceId,
        restoreTargetMode,
        targetProjectionStabilization
      });
      throw new WorkspaceResumeOperationError(
        "Workspace resume target tabs did not settle into exact browser identity.",
        "resume_target_projection_not_stable",
        { workspaceId, targetProjectionStabilization }
      );
    }

    await safeAppendRuntimeDiagnostic("info", "workspace_resume_target_projection_stabilized", "Workspace resume target tabs were verified before runtime replacement.", {
      operationId,
      workspaceId,
      restoreTargetMode,
      targetProjectionStabilization
    });

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
      operationId,
      preparedWorkspace.candidateWorkspaceRevision
    );

    const replacementState = await runtimeWorkspaceAuthority.replaceActiveFromVerifiedEvidence(
      hydratedWorkspace,
      restoreResult.windowId,
      preMutationAuthorityEvidence
    );
    context.workspaceReplacementVerified = isVerifiedWorkspaceReplacementForCandidate(replacementState.result, hydratedWorkspace);
    context.assignmentVerified = replacementState.result?.assignmentVerified === true;
    const replacementVerified = ["active", "read_only"].includes(replacementState.status) &&
      ["committed", "no_change", "replayed"].includes(replacementState.result?.status) &&
      replacementState.result?.activeWorkspaceId === hydratedWorkspace.workspaceId &&
      replacementState.result?.targetWindowId === restoreResult.windowId &&
      context.workspaceReplacementVerified &&
      context.assignmentVerified;
    if (!replacementVerified) {
      throw new WorkspaceResumeOperationError(
        "Workspace runtime replacement or assignment could not be verified.",
        "resume_activation_not_verified",
        { workspaceId, activation: replacementState }
      );
    }
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
      rollbackRequired: false,
      activation: replacementState.result
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
    if (context.workspaceReplacementVerified) {
      await safeAppendRuntimeDiagnostic("error", "workspace_resume_operation_post_workspace_replacement_error", "Workspace resume encountered an error after active workspace replacement; browser rollback was not attempted because verified business state must be preserved.", {
        operationId,
        workspaceId,
        error: summarizeError(error),
        runtimeCommitted: context.runtimeCommitted,
        workspaceReplacementVerified: true,
        assignmentVerified: context.assignmentVerified
      });
      throw error;
    }

    const rollback = await rollbackResumeOperation(context);
    rollback.authorityRecovery = await recoverSourceAuthorityAfterRollback(runtimeWorkspaceAuthority, previousRuntime, preMutationAuthorityEvidence);
    rollback.complete = rollback.complete && rollback.authorityRecovery.verified;
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
  } finally {
    if (context.reconciliationHoldVerified) {
      context.reconciliationHoldRelease = await releaseProjectionReconciliationHold(operationId);
      if (!context.reconciliationHoldRelease.released) {
        await safeAppendRuntimeDiagnostic("error", "workspace_resume_projection_reconciliation_hold_release_failed", "Workspace resume could not verify release of the projection reconciliation transaction boundary.", {
          operationId,
          workspaceId,
          release: context.reconciliationHoldRelease,
          runtimeCommitted: context.runtimeCommitted
        });
      }
      await requestProjectionReconciliation(context.runtimeCommitted ? "workspace_resume_committed" : "workspace_resume_rolled_back");
    }
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


export function prepareResumeWorkspaceForActivation(memoryWorkspace, activeWorkspace, authorityEvidence) {
  try {
    const memoryRevision = normalizeWorkspaceRevision(memoryWorkspace);
    if (!memoryRevision.valid || typeof memoryWorkspace?.workspaceId !== "string" || !Array.isArray(memoryWorkspace?.tabs)) {
      return { valid: false, reason: "resume_memory_workspace_invalid", workspace: null, candidateWorkspaceRevision: null, sameWorkspaceIdentity: false };
    }
    if (memoryWorkspace.workspaceId !== activeWorkspace?.workspaceId) {
      return {
        valid: true,
        reason: "different_workspace_replacement",
        workspace: cloneValue(memoryWorkspace),
        candidateWorkspaceRevision: memoryRevision.revision,
        sameWorkspaceIdentity: false
      };
    }

    const activeRevision = normalizeWorkspaceRevision(activeWorkspace);
    if (!activeRevision.valid || activeRevision.revision !== authorityEvidence?.activeWorkspaceRevision || authorityEvidence?.activeWorkspaceId !== activeWorkspace.workspaceId) {
      return { valid: false, reason: "resume_same_workspace_authority_mismatch", workspace: null, candidateWorkspaceRevision: null, sameWorkspaceIdentity: true };
    }
    if (activeRevision.revision >= Number.MAX_SAFE_INTEGER) {
      return { valid: false, reason: "resume_same_workspace_revision_exhausted", workspace: null, candidateWorkspaceRevision: null, sameWorkspaceIdentity: true };
    }

    const memoryIdentity = snapshotResumeWorkspaceTabIdentity(memoryWorkspace.tabs);
    const activeIdentity = snapshotResumeWorkspaceTabIdentity(activeWorkspace.tabs);
    if (!memoryIdentity.valid || !activeIdentity.valid || memoryIdentity.value !== activeIdentity.value) {
      return { valid: false, reason: "resume_same_workspace_snapshot_conflict", workspace: null, candidateWorkspaceRevision: null, sameWorkspaceIdentity: true };
    }

    return {
      valid: true,
      reason: "same_workspace_rehydrate",
      workspace: cloneValue(activeWorkspace),
      candidateWorkspaceRevision: activeRevision.revision + 1,
      sameWorkspaceIdentity: true
    };
  } catch {
    return { valid: false, reason: "resume_workspace_preparation_failed", workspace: null, candidateWorkspaceRevision: null, sameWorkspaceIdentity: false };
  }
}

function snapshotResumeWorkspaceTabIdentity(tabs) {
  if (!Array.isArray(tabs)) return { valid: false, value: "" };
  const identity = [];
  for (const tab of tabs) {
    const workspaceTabId = typeof tab?.workspaceTabId === "string" ? tab.workspaceTabId.trim() : "";
    if (!workspaceTabId || identity.includes(workspaceTabId)) return { valid: false, value: "" };
    identity.push(workspaceTabId);
  }
  identity.sort();
  return { valid: true, value: stableSerializableStringify(identity) };
}

function buildHydratedWorkspace(runtimeWorkspace, memoryRecord, restoreResult, groupResult, restoreTargetMode, operationId, candidateWorkspaceRevision) {
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
    workspaceRevision: candidateWorkspaceRevision,
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
    authorityRecovery: { verified: false, status: "not_attempted", reason: "", result: null },
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

async function acquireProjectionReconciliationHold({ operationId, workspaceIds, sourceWindowId }) {
  const storage = getProjectionHoldStorage();
  if (!storage?.get || !storage?.set || !storage?.remove) {
    throw new WorkspaceResumeOperationError(
      "Workspace resume could not establish the projection reconciliation transaction boundary.",
      "resume_projection_reconciliation_hold_unavailable",
      { operationId }
    );
  }
  const startedAt = new Date().toISOString();
  const existingRead = await storage.get(PROJECTION_RECONCILIATION_HOLD_KEY);
  const existingSnapshot = snapshotAndValidateProjectionReconciliationHold(existingRead?.[PROJECTION_RECONCILIATION_HOLD_KEY]);
  if (existingSnapshot.valid) {
    const existingExpired = Date.parse(existingSnapshot.value.expiresAt) <= Date.parse(startedAt);
    if (!existingExpired && existingSnapshot.value.operationId !== operationId) {
      throw new WorkspaceResumeOperationError(
        "Another workspace resume transaction owns the projection reconciliation boundary.",
        "resume_projection_reconciliation_hold_conflict",
        { operationId, existingOperationId: existingSnapshot.value.operationId }
      );
    }
  }
  if (existingRead?.[PROJECTION_RECONCILIATION_HOLD_KEY]) {
    await storage.remove(PROJECTION_RECONCILIATION_HOLD_KEY);
  }
  const hold = {
    schema: PROJECTION_RECONCILIATION_HOLD_SCHEMA,
    operationId,
    workspaceIds: [...new Set(workspaceIds.filter((value) => typeof value === "string" && value.length > 0))].sort(),
    sourceWindowId: Number.isSafeInteger(sourceWindowId) ? sourceWindowId : null,
    startedAt,
    expiresAt: new Date(Date.parse(startedAt) + PROJECTION_RECONCILIATION_HOLD_TTL_MS).toISOString()
  };
  const validation = snapshotAndValidateProjectionReconciliationHold(hold);
  if (!validation.valid) {
    throw new WorkspaceResumeOperationError(
      "Workspace resume could not bind the projection reconciliation transaction boundary.",
      "resume_projection_reconciliation_hold_invalid",
      { operationId, errors: validation.errors }
    );
  }
  await storage.set({ [PROJECTION_RECONCILIATION_HOLD_KEY]: validation.value });
  const reread = await storage.get(PROJECTION_RECONCILIATION_HOLD_KEY);
  const verifiedSnapshot = snapshotAndValidateProjectionReconciliationHold(reread?.[PROJECTION_RECONCILIATION_HOLD_KEY]);
  if (!verifiedSnapshot.valid || stableSerializableStringify(verifiedSnapshot.value) !== stableSerializableStringify(validation.value)) {
    const current = reread?.[PROJECTION_RECONCILIATION_HOLD_KEY];
    if (current?.operationId === operationId) {
      try { await storage.remove(PROJECTION_RECONCILIATION_HOLD_KEY); } catch { /* Failed acquisition cleanup is best-effort. */ }
    }
    throw new WorkspaceResumeOperationError(
      "Workspace resume could not verify the projection reconciliation transaction boundary.",
      "resume_projection_reconciliation_hold_not_verified",
      { operationId }
    );
  }
  return verifiedSnapshot.value;
}

async function releaseProjectionReconciliationHold(operationId) {
  const storage = getProjectionHoldStorage();
  if (!storage?.get || !storage?.remove) return { released: false, reason: "projection_hold_storage_unavailable" };
  try {
    const read = await storage.get(PROJECTION_RECONCILIATION_HOLD_KEY);
    const current = read?.[PROJECTION_RECONCILIATION_HOLD_KEY];
    if (!current) return { released: true, reason: "already_absent" };
    if (current.operationId !== operationId) return { released: false, reason: "projection_hold_owned_by_another_operation" };
    await storage.remove(PROJECTION_RECONCILIATION_HOLD_KEY);
    const verified = await storage.get(PROJECTION_RECONCILIATION_HOLD_KEY);
    return verified?.[PROJECTION_RECONCILIATION_HOLD_KEY]
      ? { released: false, reason: "projection_hold_remove_not_verified" }
      : { released: true, reason: "released" };
  } catch (error) {
    return { released: false, reason: "projection_hold_release_failed", error: summarizeError(error) };
  }
}

async function recoverSourceAuthorityAfterRollback(runtimeWorkspaceAuthority, previousRuntime, preMutationAuthorityEvidence) {
  try {
    const state = typeof runtimeWorkspaceAuthority.recoverActiveAfterRollback === "function"
      ? await runtimeWorkspaceAuthority.recoverActiveAfterRollback(previousRuntime, preMutationAuthorityEvidence)
      : await runtimeWorkspaceAuthority.bootstrapExisting({ workspace: previousRuntime, force: true });
    const verified = state.status === "active" && state.result?.workspaceVerified === true && state.result?.assignmentVerified === true &&
      state.result.activeWorkspaceId === previousRuntime?.workspaceId && state.result.targetWindowId === preMutationAuthorityEvidence?.sourceWindowId &&
      state.result.sourceWindowId === preMutationAuthorityEvidence?.sourceWindowId;
    return { verified, status: state.status, reason: state.reason || "", result: state.result || null };
  } catch (error) {
    return { verified: false, status: "failed", reason: "rollback_authority_recovery_failed", result: null, error: summarizeError(error) };
  }
}

async function requestProjectionReconciliation(trigger) {
  try {
    if (!globalThis.chrome?.runtime?.sendMessage) return false;
    const response = await chrome.runtime.sendMessage({
      type: EVENT_IDENTITIES.reconcileWorkspaceProjection.canonical,
      trigger
    });
    return response?.accepted === true;
  } catch { return false; }
}

function getProjectionHoldStorage() {
  return globalThis.chrome?.storage?.session || globalThis.chrome?.storage?.local || null;
}

function stableSerializableStringify(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableSerializableStringify).join(",") + "]";
  return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stableSerializableStringify(value[key])).join(",") + "}";
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

function createResumeOperationContext({ operationId, workspaceId, workspaceName, restoreTargetMode, previousRuntime, previousBrowserFocus, preMutationAuthorityEvidence }) {
  return {
    operationId,
    workspaceId,
    workspaceName,
    restoreTargetMode,
    previousRuntime,
    previousBrowserFocus,
    preMutationAuthorityEvidence,
    reconciliationHold: null,
    reconciliationHoldVerified: false,
    reconciliationHoldRelease: null,
    browserMutationStarted: false,
    createdWindowId: null,
    createdDedicatedWindow: false,
    createdTabIds: [],
    createdGroupIds: [],
    temporaryTabIds: [],
    removedTemporaryTabIds: [],
    targetProjectionStabilization: null,
    workspaceReplacementVerified: false,
    assignmentVerified: false,
    runtimeCommitted: false,
    committedAt: ""
  };
}

function createAlreadyActiveRecoveryResult(operationId, workspace, restoreTargetMode, skippedTabCount, authorityState, alreadyActive) {
  return {
    operationId,
    hydratedWorkspace: cloneValue(workspace),
    restoreTargetMode,
    restoreResult: {
      windowId: authorityState.result.targetWindowId,
      openedTabs: [],
      temporaryTabIds: [],
      removedTemporaryTabIds: [],
      creationMode: "existing_verified_projection_reused",
      recoveredExistingProjection: true
    },
    groupResult: {
      groupAvailable: true,
      windowId: authorityState.result.targetWindowId,
      recreatedGroupCount: 0,
      skippedGroupCount: 0,
      groups: []
    },
    focusRequested: false,
    skippedTabCount,
    transaction: {
      operationId,
      workspaceId: workspace.workspaceId,
      restoreTargetMode,
      previousRuntimeWorkspaceId: workspace.workspaceId,
      createdWindowId: null,
      createdTabIds: [],
      createdGroupIds: [],
      runtimeCommitted: true,
      workspaceReplacementVerified: true,
      assignmentVerified: true,
      recoveredExistingProjection: true,
      matchedWorkspaceTabIds: [...alreadyActive.matchedWorkspaceTabIds]
    }
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
    targetProjectionStabilization: cloneValue(context.targetProjectionStabilization),
    workspaceReplacementVerified: context.workspaceReplacementVerified,
    assignmentVerified: context.assignmentVerified,
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

export async function stabilizeOpenedTabProjection(openedTabsInput, targetWindowId, options = {}) {
  const openedTabs = Array.isArray(openedTabsInput)
    ? openedTabsInput.map((tab) => ({
      workspaceTabId: typeof tab?.workspaceTabId === "string" ? tab.workspaceTabId : "",
      tabId: Number.isSafeInteger(tab?.tabId) ? tab.tabId : null,
      windowId: Number.isSafeInteger(tab?.windowId) ? tab.windowId : null,
      url: typeof tab?.url === "string" ? tab.url : "",
      title: typeof tab?.title === "string" ? tab.title : ""
    }))
    : [];
  const getTab = typeof options.getTab === "function" ? options.getTab : null;
  const wait = typeof options.wait === "function" ? options.wait : async () => undefined;
  const maxAttempts = clampInteger(options.maxAttempts, 1, 50) || 1;
  const intervalMs = clampInteger(options.intervalMs, 0, 5000);
  const validTargetWindow = Number.isSafeInteger(targetWindowId) && targetWindowId >= 0;
  const uniqueTabIds = new Set(openedTabs.map((tab) => tab.tabId).filter(Number.isSafeInteger));
  const uniqueWorkspaceTabIds = new Set(openedTabs.map((tab) => tab.workspaceTabId).filter(Boolean));

  if (
    !validTargetWindow
    || !getTab
    || openedTabs.length === 0
    || uniqueTabIds.size !== openedTabs.length
    || uniqueWorkspaceTabIds.size !== openedTabs.length
    || openedTabs.some((tab) => !Number.isSafeInteger(tab.tabId) || tab.tabId < 0 || tab.windowId !== targetWindowId || (!tab.url && !tab.title))
  ) {
    return {
      verified: false,
      reason: "target_projection_input_invalid",
      attempts: 0,
      targetWindowId: validTargetWindow ? targetWindowId : null,
      tabCount: openedTabs.length,
      tabs: []
    };
  }

  let lastTabs = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastTabs = [];

    for (const expected of openedTabs) {
      let live = null;
      let readError = "";

      try {
        live = await getTab(expected.tabId);
      } catch (error) {
        readError = String(error?.message || error || "tab_read_failed");
      }

      const idVerified = live?.id === expected.tabId;
      const windowVerified = live?.windowId === targetWindowId;
      const urlCorroborated = expected.url.length > 0 && (
        live?.url === expected.url || live?.pendingUrl === expected.url
      );
      const titleCorroborated = expected.title.length > 0 && live?.title === expected.title;
      const verified = idVerified && windowVerified && (urlCorroborated || titleCorroborated);

      lastTabs.push({
        workspaceTabId: expected.workspaceTabId,
        tabId: expected.tabId,
        expectedWindowId: targetWindowId,
        liveWindowId: Number.isSafeInteger(live?.windowId) ? live.windowId : null,
        idVerified,
        windowVerified,
        urlCorroborated,
        titleCorroborated,
        verified,
        reason: verified
          ? "exact_identity_verified"
          : readError
            ? "tab_read_failed"
            : !idVerified
              ? "tab_identity_not_found"
              : !windowVerified
                ? "tab_window_mismatch"
                : "tab_url_or_title_not_settled",
        error: readError
      });
    }

    if (lastTabs.every((tab) => tab.verified)) {
      return {
        verified: true,
        reason: "target_projection_verified",
        attempts: attempt,
        targetWindowId,
        tabCount: openedTabs.length,
        tabs: lastTabs
      };
    }

    if (attempt < maxAttempts && intervalMs > 0) await wait(intervalMs);
  }

  return {
    verified: false,
    reason: "target_projection_not_stable",
    attempts: maxAttempts,
    targetWindowId,
    tabCount: openedTabs.length,
    tabs: lastTabs
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
    url: sourceTab.url || openedTab.url || "",
    title: sourceTab.title || sourceTab.originalTitle || openedTab.title || ""
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

function isVerifiedWorkspaceReplacementForCandidate(result, candidateWorkspace) {
  try {
    const revision = normalizeWorkspaceRevision(candidateWorkspace);
    return revision.valid &&
      result?.workspaceVerified === true &&
      result.activeWorkspaceId === candidateWorkspace.workspaceId &&
      result.activeWorkspaceRevision === revision.revision;
  } catch { return false; }
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
  PROJECTION_RECONCILIATION_HOLD_TTL_MS,
  RESUME_LOCK_NAME,
  VALIDATION_MODE,
  WorkspaceResumeOperationError,
  isVerifiedWorkspaceReplacementForCandidate,
  resumeWorkspaceMemoryRecordSafely
};
