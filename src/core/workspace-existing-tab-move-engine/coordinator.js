import {
  createMoveResult,
  safeError,
  snapshotAdapters,
  snapshotAndValidateProjection,
  snapshotAndValidateRequest,
  snapshotCreateWindowResult,
  snapshotFocusWindowResult,
  snapshotGroupTabsResult,
  snapshotMoveTabsResult,
  snapshotUpdateGroupResult
} from "./contract.js";

const CHECK_IDS = Object.freeze([
  "target_window_exists",
  "created_window_was_not_present_before",
  "exactly_one_destination_window_created",
  "no_additional_window_created",
  "all_planned_tabs_exist",
  "all_planned_tabs_are_in_target",
  "no_unrelated_tab_moved",
  "no_planned_tab_duplicated",
  "assigned_group_count_matches_plan",
  "assigned_group_membership_matches_plan",
  "unassigned_tabs_are_ungrouped",
  "group_titles_match_semantic_plan",
  "represented_group_colour_matches",
  "represented_group_collapsed_state_matches",
  "target_window_focused",
  "final_projection_is_serializable"
]);

function check(id, passed) {
  return { id, passed: passed === true };
}

function emptyVerification() {
  return CHECK_IDS.map((id) => check(id, false));
}

function compareNumber(left, right) {
  return left - right;
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sortedNumbers(values) {
  return [...values].sort(compareNumber);
}

function windows(projection) {
  return projection.windows;
}

function allTabs(projection) {
  return projection.windows.flatMap((browserWindow) => browserWindow.tabs);
}

function allGroups(projection) {
  return projection.windows.flatMap((browserWindow) => browserWindow.groups);
}

function windowIdArray(projection) {
  return sortedNumbers(projection.windows.map((browserWindow) => browserWindow.id));
}

function windowIdSet(projection) {
  return new Set(windowIdArray(projection));
}

function tabMap(projection) {
  return new Map(allTabs(projection).map((tab) => [tab.id, tab]));
}

function groupMap(projection) {
  return new Map(allGroups(projection).map((group) => [group.id, group]));
}

function focusedWindowId(projection) {
  const focused = projection.windows.filter((browserWindow) => browserWindow.focused);
  return focused.length === 1 ? focused[0].id : null;
}

function newWindowIds(before, after) {
  const beforeIds = windowIdSet(before);
  return windowIdArray(after).filter((windowId) => !beforeIds.has(windowId));
}

function projectionIdentityEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function plannedTabIdSet(request) {
  return new Set(request.tabs.map((tab) => tab.tabId));
}

function plannedTabIdsForGroup(request, plan) {
  const byWorkspaceTabId = new Map(request.tabs.map((tab) => [tab.workspaceTabId, tab]));
  return sortedNumbers(plan.workspaceTabIds.map((workspaceTabId) => byWorkspaceTabId.get(workspaceTabId).tabId));
}

function sameGroupMembers(group, tabIds) {
  return arraysEqual(sortedNumbers(group.tabIds), sortedNumbers(tabIds));
}

function groupsInTarget(projection, targetWindowId) {
  return allGroups(projection).filter((group) => group.windowId === targetWindowId);
}

function exactMembershipGroups(projection, targetWindowId, tabIds) {
  return groupsInTarget(projection, targetWindowId).filter((group) => sameGroupMembers(group, tabIds));
}

function exactSemanticGroups(projection, request, targetWindowId, plan) {
  const tabIds = plannedTabIdsForGroup(request, plan);
  return exactMembershipGroups(projection, targetWindowId, tabIds).filter(
    (group) =>
      group.title === plan.roleLabel &&
      (!Object.hasOwn(plan, "colour") || group.colour === plan.colour) &&
      (!Object.hasOwn(plan, "collapsed") || group.collapsed === plan.collapsed)
  );
}

function verifiedGroups(projection, request, targetWindowId) {
  if (!Number.isSafeInteger(targetWindowId) || targetWindowId < 0) return [];
  const output = [];
  const usedGroupIds = new Set();
  for (const plan of request.groups) {
    const matches = exactSemanticGroups(projection, request, targetWindowId, plan).filter(
      (group) => !usedGroupIds.has(group.id)
    );
    if (matches.length !== 1) continue;
    const group = matches[0];
    usedGroupIds.add(group.id);
    output.push({
      groupId: group.id,
      windowId: group.windowId,
      role: plan.role,
      roleLabel: plan.roleLabel,
      workspaceTabIds: [...plan.workspaceTabIds],
      tabIds: [...group.tabIds],
      title: group.title,
      colour: group.colour,
      collapsed: group.collapsed
    });
  }
  return output;
}

function provedMovedTabIds(request, before, after) {
  const beforeTabs = tabMap(before);
  const afterTabs = tabMap(after);
  return request.tabs
    .filter((plan) => {
      const beforeTab = beforeTabs.get(plan.tabId);
      const afterTab = afterTabs.get(plan.tabId);
      return beforeTab && afterTab && beforeTab.windowId !== afterTab.windowId;
    })
    .map((plan) => plan.tabId);
}

function alreadyInTargetTabIds(request, projection, targetWindowId) {
  if (!Number.isSafeInteger(targetWindowId) || targetWindowId < 0) return [];
  const tabs = tabMap(projection);
  return request.tabs
    .filter((plan) => tabs.get(plan.tabId)?.windowId === targetWindowId)
    .map((plan) => plan.tabId);
}

function verify(request, before, final, targetWindowId) {
  const beforeWindowIds = windowIdArray(before);
  const finalWindowIds = windowIdArray(final);
  const createdIds = newWindowIds(before, final);
  const finalTabs = tabMap(final);
  const plannedIds = plannedTabIdSet(request);
  const unrelatedBefore = allTabs(before).filter((tab) => !plannedIds.has(tab.id));
  const unrelatedStable = unrelatedBefore.every((tab) => {
    const finalTab = finalTabs.get(tab.id);
    return finalTab && finalTab.windowId === tab.windowId;
  });
  const assignedGroupMatches = request.groups.map((plan) =>
    exactSemanticGroups(final, request, targetWindowId, plan)
  );
  const uniqueSemanticGroupIds = new Set(
    assignedGroupMatches.flatMap((matches) => matches.map((group) => group.id))
  );
  const membershipMatches = request.groups.every((plan) => {
    const expectedTabIds = plannedTabIdsForGroup(request, plan);
    const matches = exactMembershipGroups(final, targetWindowId, expectedTabIds);
    return matches.length === 1;
  });
  const titlesMatch = request.groups.every((plan) => {
    const expectedTabIds = plannedTabIdsForGroup(request, plan);
    const matches = exactMembershipGroups(final, targetWindowId, expectedTabIds);
    return matches.length === 1 && matches[0].title === plan.roleLabel;
  });
  const coloursMatch = request.groups.every((plan) => {
    if (!Object.hasOwn(plan, "colour")) return true;
    const expectedTabIds = plannedTabIdsForGroup(request, plan);
    const matches = exactMembershipGroups(final, targetWindowId, expectedTabIds);
    return matches.length === 1 && matches[0].colour === plan.colour;
  });
  const collapsedMatch = request.groups.every((plan) => {
    if (!Object.hasOwn(plan, "collapsed")) return true;
    const expectedTabIds = plannedTabIdsForGroup(request, plan);
    const matches = exactMembershipGroups(final, targetWindowId, expectedTabIds);
    return matches.length === 1 && matches[0].collapsed === plan.collapsed;
  });
  const unassigned = request.tabs.filter((tab) => tab.role === "unassigned");
  const createMode = request.mode === "create_dedicated_window";
  const attachMode = request.mode === "attach_to_existing_dedicated_window";
  const exactlyOneCreated = createMode
    ? createdIds.length === 1 && createdIds[0] === targetWindowId
    : true;
  const noAdditionalWindow = createMode
    ? exactlyOneCreated
    : arraysEqual(beforeWindowIds, finalWindowIds);

  const checks = [
    check("target_window_exists", finalWindowIds.includes(targetWindowId)),
    check("created_window_was_not_present_before", !createMode || !beforeWindowIds.includes(targetWindowId)),
    check("exactly_one_destination_window_created", exactlyOneCreated),
    check("no_additional_window_created", noAdditionalWindow),
    check("all_planned_tabs_exist", request.tabs.every((tab) => finalTabs.has(tab.tabId))),
    check("all_planned_tabs_are_in_target", request.tabs.every((tab) => finalTabs.get(tab.tabId)?.windowId === targetWindowId)),
    check("no_unrelated_tab_moved", unrelatedStable),
    check("no_planned_tab_duplicated", request.tabs.every((tab) => finalTabs.has(tab.tabId))),
    check(
      "assigned_group_count_matches_plan",
      uniqueSemanticGroupIds.size === request.groups.length &&
        assignedGroupMatches.every((matches) => matches.length === 1)
    ),
    check("assigned_group_membership_matches_plan", membershipMatches),
    check("unassigned_tabs_are_ungrouped", unassigned.every((tab) => finalTabs.get(tab.tabId)?.groupId === -1)),
    check("group_titles_match_semantic_plan", titlesMatch),
    check("represented_group_colour_matches", coloursMatch),
    check("represented_group_collapsed_state_matches", collapsedMatch),
    check("target_window_focused", focusedWindowId(final) === targetWindowId),
    check("final_projection_is_serializable", true)
  ];

  return { checks, passed: checks.every((item) => item.passed) };
}

async function invoke(fn, ...args) {
  try {
    return { ok: true, value: await fn(...args) };
  } catch (error) {
    return { ok: false, error: safeError(error) };
  }
}

async function readProjection(adapter) {
  const invoked = await invoke(adapter);
  if (!invoked.ok) return invoked;
  const snapshot = snapshotAndValidateProjection(invoked.value);
  return snapshot.ok
    ? snapshot
    : {
        ok: false,
        error: snapshot.error || { name: "ProjectionError", message: snapshot.reason }
      };
}

function resultFromProjection({
  request,
  status,
  reason,
  before,
  projection,
  targetWindowId,
  createdWindow,
  mutationStarted,
  errors = [],
  warnings = []
}) {
  const hasProjection = projection !== null;
  const verification = hasProjection && Number.isSafeInteger(targetWindowId) && targetWindowId >= 0
    ? verify(request, before, projection, targetWindowId)
    : { checks: emptyVerification(), passed: false };
  const noMutationProved = hasProjection && projectionIdentityEqual(before, projection);
  return createMoveResult(request, {
    status,
    reason,
    targetWindowId,
    createdWindow,
    browserMutationStarted: mutationStarted,
    browserMutationVerified: false,
    movedTabIds: hasProjection ? provedMovedTabIds(request, before, projection) : [],
    alreadyInTargetTabIds: alreadyInTargetTabIds(request, before, targetWindowId),
    unassignedTabIds: request.tabs.filter((tab) => tab.role === "unassigned").map((tab) => tab.tabId),
    createdGroups: hasProjection ? verifiedGroups(projection, request, targetWindowId) : [],
    verification: verification.checks,
    retrySafe: noMutationProved,
    warnings,
    errors
  });
}

async function rereadAfterFailure(adapters, context) {
  const reread = await readProjection(adapters.readBrowserProjection);
  if (!reread.ok) {
    return createMoveResult(context.request, {
      status: "indeterminate",
      reason: context.reason,
      targetWindowId: context.targetWindowId,
      createdWindow: context.createdWindow,
      browserMutationStarted: context.mutationStarted,
      browserMutationVerified: false,
      movedTabIds: [],
      alreadyInTargetTabIds: alreadyInTargetTabIds(
        context.request,
        context.before,
        context.targetWindowId
      ),
      unassignedTabIds: context.request.tabs
        .filter((tab) => tab.role === "unassigned")
        .map((tab) => tab.tabId),
      createdGroups: [],
      verification: emptyVerification(),
      retrySafe: false,
      warnings: [],
      errors: [...context.errors, reread.error]
    });
  }
  const noMutationProved = projectionIdentityEqual(context.before, reread.value);
  return resultFromProjection({
    ...context,
    projection: reread.value,
    status: noMutationProved ? "failed" : "indeterminate"
  });
}

function validateAdapterResult(snapshot, expected = {}) {
  if (!snapshot.ok) return snapshot;
  const value = snapshot.value;
  if (Object.hasOwn(expected, "windowId") && value.windowId !== expected.windowId) {
    return { ok: false, reason: "adapter_result_window_mismatch" };
  }
  if (Object.hasOwn(expected, "groupId") && value.groupId !== expected.groupId) {
    return { ok: false, reason: "adapter_result_group_mismatch" };
  }
  if (Object.hasOwn(expected, "tabIds") && !arraysEqual(value.tabIds, expected.tabIds)) {
    return { ok: false, reason: "adapter_result_tabs_mismatch" };
  }
  return snapshot;
}

function resolveCreateTarget(before, projection, primaryTabId) {
  const beforeIds = windowIdSet(before);
  const afterTabs = tabMap(projection);
  const primary = afterTabs.get(primaryTabId);
  if (!primary) return { status: "indeterminate", targetWindowId: null };
  const createdIds = newWindowIds(before, projection);
  if (
    createdIds.length === 1 &&
    createdIds[0] === primary.windowId &&
    !beforeIds.has(primary.windowId)
  ) {
    return { status: "resolved", targetWindowId: primary.windowId };
  }
  if (createdIds.length === 0 && beforeIds.has(primary.windowId)) {
    return { status: "no_mutation", targetWindowId: null };
  }
  return { status: "indeterminate", targetWindowId: primary.windowId };
}

function tabsAreInTarget(projection, tabIds, targetWindowId) {
  const tabs = tabMap(projection);
  return tabIds.every((tabId) => tabs.get(tabId)?.windowId === targetWindowId);
}

function groupProperties(plan) {
  const properties = { title: plan.roleLabel };
  if (Object.hasOwn(plan, "colour")) properties.colour = plan.colour;
  if (Object.hasOwn(plan, "collapsed")) properties.collapsed = plan.collapsed;
  return properties;
}

async function ensureSemanticGroup({ request, plan, targetWindowId, adapters, before, mutationState }) {
  const tabIds = plannedTabIdsForGroup(request, plan);
  let projectionRead = await readProjection(adapters.readBrowserProjection);
  if (!projectionRead.ok) {
    return {
      ok: false,
      result: createMoveResult(request, {
        status: "indeterminate",
        reason: "group_preflight_projection_unavailable",
        targetWindowId,
        createdWindow: mutationState.createdWindow,
        browserMutationStarted: mutationState.started,
        browserMutationVerified: false,
        movedTabIds: [],
        alreadyInTargetTabIds: alreadyInTargetTabIds(request, before, targetWindowId),
        unassignedTabIds: request.tabs.filter((tab) => tab.role === "unassigned").map((tab) => tab.tabId),
        createdGroups: [],
        verification: emptyVerification(),
        retrySafe: false,
        warnings: [],
        errors: [projectionRead.error]
      })
    };
  }

  const exact = exactSemanticGroups(projectionRead.value, request, targetWindowId, plan);
  if (exact.length === 1) return { ok: true };

  const membership = exactMembershipGroups(projectionRead.value, targetWindowId, tabIds);
  let groupId = membership.length === 1 ? membership[0].id : null;

  if (groupId === null) {
    mutationState.started = true;
    const grouped = await invoke(adapters.groupTabs, tabIds, targetWindowId);
    const groupedSnapshot = grouped.ok
      ? validateAdapterResult(snapshotGroupTabsResult(grouped.value), { tabIds, windowId: targetWindowId })
      : grouped;

    if (grouped.ok && groupedSnapshot.ok) {
      groupId = groupedSnapshot.value.groupId;
    } else {
      projectionRead = await readProjection(adapters.readBrowserProjection);
      if (!projectionRead.ok) {
        return {
          ok: false,
          result: createMoveResult(request, {
            status: "indeterminate",
            reason: "group_failed",
            targetWindowId,
            createdWindow: mutationState.createdWindow,
            browserMutationStarted: true,
            browserMutationVerified: false,
            movedTabIds: [],
            alreadyInTargetTabIds: alreadyInTargetTabIds(request, before, targetWindowId),
            unassignedTabIds: request.tabs.filter((tab) => tab.role === "unassigned").map((tab) => tab.tabId),
            createdGroups: [],
            verification: emptyVerification(),
            retrySafe: false,
            warnings: [],
            errors: [grouped.error || groupedSnapshot.error || { name: "GroupError", message: groupedSnapshot.reason }, projectionRead.error]
          })
        };
      }
      const recovered = exactMembershipGroups(projectionRead.value, targetWindowId, tabIds);
      if (recovered.length !== 1) {
        return {
          ok: false,
          result: resultFromProjection({
            request,
            status: "indeterminate",
            reason: "group_failed",
            before,
            projection: projectionRead.value,
            targetWindowId,
            createdWindow: mutationState.createdWindow,
            mutationStarted: true,
            errors: [grouped.error || groupedSnapshot.error || { name: "GroupError", message: groupedSnapshot.reason }]
          })
        };
      }
      groupId = recovered[0].id;
    }
  }

  mutationState.started = true;
  const updated = await invoke(adapters.updateGroup, groupId, groupProperties(plan));
  const updatedSnapshot = updated.ok
    ? validateAdapterResult(snapshotUpdateGroupResult(updated.value), { groupId })
    : updated;
  if (updated.ok && updatedSnapshot.ok) return { ok: true };

  projectionRead = await readProjection(adapters.readBrowserProjection);
  if (!projectionRead.ok) {
    return {
      ok: false,
      result: createMoveResult(request, {
        status: "indeterminate",
        reason: "group_update_failed",
        targetWindowId,
        createdWindow: mutationState.createdWindow,
        browserMutationStarted: true,
        browserMutationVerified: false,
        movedTabIds: [],
        alreadyInTargetTabIds: alreadyInTargetTabIds(request, before, targetWindowId),
        unassignedTabIds: request.tabs.filter((tab) => tab.role === "unassigned").map((tab) => tab.tabId),
        createdGroups: [],
        verification: emptyVerification(),
        retrySafe: false,
        warnings: [],
        errors: [updated.error || updatedSnapshot.error || { name: "GroupUpdateError", message: updatedSnapshot.reason }, projectionRead.error]
      })
    };
  }
  if (exactSemanticGroups(projectionRead.value, request, targetWindowId, plan).length === 1) {
    return { ok: true };
  }
  return {
    ok: false,
    result: resultFromProjection({
      request,
      status: "indeterminate",
      reason: "group_update_failed",
      before,
      projection: projectionRead.value,
      targetWindowId,
      createdWindow: mutationState.createdWindow,
      mutationStarted: true,
      errors: [updated.error || updatedSnapshot.error || { name: "GroupUpdateError", message: updatedSnapshot.reason }]
    })
  };
}

export async function moveExistingWorkspaceTabs(input, adapterInput) {
  const validated = snapshotAndValidateRequest(input);
  if (!validated.ok) {
    return createMoveResult(null, {
      reason: validated.reason,
      verification: emptyVerification(),
      errors: validated.error ? [validated.error] : []
    });
  }
  const request = validated.value;
  const adapterResult = snapshotAdapters(adapterInput);
  if (!adapterResult.ok) {
    return createMoveResult(request, {
      reason: adapterResult.reason,
      verification: emptyVerification(),
      errors: adapterResult.error ? [adapterResult.error] : []
    });
  }
  const adapters = adapterResult.value;
  const initial = await readProjection(adapters.readBrowserProjection);
  if (!initial.ok) {
    return createMoveResult(request, {
      status: "failed",
      reason: "initial_projection_unavailable",
      verification: emptyVerification(),
      retrySafe: true,
      errors: [initial.error]
    });
  }

  const before = initial.value;
  const beforeTabs = tabMap(before);
  if (
    request.tabs.some(
      (tab) =>
        !beforeTabs.has(tab.tabId) ||
        beforeTabs.get(tab.tabId).windowId !== tab.sourceWindowId
    )
  ) {
    return createMoveResult(request, {
      status: "conflict",
      reason: "preflight_projection_conflict",
      verification: emptyVerification(),
      retrySafe: true
    });
  }

  let targetWindowId = request.targetWindowId;
  const mutationState = { started: false, createdWindow: false };
  const initialAlready = alreadyInTargetTabIds(request, before, targetWindowId);

  if (request.mode === "attach_to_existing_dedicated_window") {
    if (!windowIdSet(before).has(targetWindowId)) {
      return createMoveResult(request, {
        status: "conflict",
        reason: "target_window_missing",
        verification: emptyVerification(),
        retrySafe: true
      });
    }
    const preflight = verify(request, before, before, targetWindowId);
    if (preflight.passed) {
      return createMoveResult(request, {
        status: "no_change",
        reason: "already_correctly_placed",
        targetWindowId,
        alreadyInTargetTabIds: initialAlready,
        unassignedTabIds: request.tabs.filter((tab) => tab.role === "unassigned").map((tab) => tab.tabId),
        createdGroups: verifiedGroups(before, request, targetWindowId),
        verification: preflight.checks,
        retrySafe: true
      });
    }
  }

  if (request.mode === "create_dedicated_window") {
    mutationState.started = true;
    const created = await invoke(adapters.createWindowFromTab, request.tabs[0].tabId);
    const createdSnapshot = created.ok ? snapshotCreateWindowResult(created.value) : created;
    if (
      created.ok &&
      createdSnapshot.ok &&
      !windowIdSet(before).has(createdSnapshot.value.id)
    ) {
      targetWindowId = createdSnapshot.value.id;
      mutationState.createdWindow = true;
    } else {
      const reread = await readProjection(adapters.readBrowserProjection);
      if (!reread.ok) {
        return createMoveResult(request, {
          status: "indeterminate",
          reason: "create_result_uncertain",
          browserMutationStarted: true,
          verification: emptyVerification(),
          retrySafe: false,
          errors: [created.error || createdSnapshot.error || { name: "CreateError", message: createdSnapshot.reason }, reread.error]
        });
      }
      const resolution = resolveCreateTarget(before, reread.value, request.tabs[0].tabId);
      if (resolution.status === "no_mutation") {
        return resultFromProjection({
          request,
          status: "failed",
          reason: "create_failed_without_mutation",
          before,
          projection: reread.value,
          targetWindowId: null,
          createdWindow: false,
          mutationStarted: true,
          errors: [created.error || createdSnapshot.error || { name: "CreateError", message: createdSnapshot.reason }]
        });
      }
      if (resolution.status !== "resolved") {
        return resultFromProjection({
          request,
          status: "indeterminate",
          reason: "create_target_not_proven",
          before,
          projection: reread.value,
          targetWindowId: resolution.targetWindowId,
          createdWindow: Number.isSafeInteger(resolution.targetWindowId),
          mutationStarted: true,
          errors: [created.error || createdSnapshot.error || { name: "CreateError", message: createdSnapshot.reason }]
        });
      }
      targetWindowId = resolution.targetWindowId;
      mutationState.createdWindow = true;
    }
  }

  let currentRead = await readProjection(adapters.readBrowserProjection);
  if (!currentRead.ok) {
    return createMoveResult(request, {
      status: "indeterminate",
      reason: "post_create_projection_unavailable",
      targetWindowId,
      createdWindow: mutationState.createdWindow,
      browserMutationStarted: mutationState.started,
      verification: emptyVerification(),
      retrySafe: false,
      errors: [currentRead.error]
    });
  }

  const currentTabs = tabMap(currentRead.value);
  const toMove = request.tabs
    .filter((tab) => currentTabs.get(tab.tabId)?.windowId !== targetWindowId)
    .map((tab) => tab.tabId);

  if (toMove.length > 0) {
    mutationState.started = true;
    const moved = await invoke(adapters.moveTabs, toMove, targetWindowId);
    const movedSnapshot = moved.ok
      ? validateAdapterResult(snapshotMoveTabsResult(moved.value), { tabIds: toMove, windowId: targetWindowId })
      : moved;
    if (!moved.ok || !movedSnapshot.ok) {
      const reread = await readProjection(adapters.readBrowserProjection);
      if (!reread.ok) {
        return createMoveResult(request, {
          status: "indeterminate",
          reason: "move_failed",
          targetWindowId,
          createdWindow: mutationState.createdWindow,
          browserMutationStarted: true,
          verification: emptyVerification(),
          retrySafe: false,
          errors: [moved.error || movedSnapshot.error || { name: "MoveError", message: movedSnapshot.reason }, reread.error]
        });
      }
      if (!tabsAreInTarget(reread.value, toMove, targetWindowId)) {
        const noMutationProved = projectionIdentityEqual(before, reread.value);
        return resultFromProjection({
          request,
          status: noMutationProved ? "failed" : "indeterminate",
          reason: "move_failed",
          before,
          projection: reread.value,
          targetWindowId,
          createdWindow: mutationState.createdWindow,
          mutationStarted: true,
          errors: [moved.error || movedSnapshot.error || { name: "MoveError", message: movedSnapshot.reason }]
        });
      }
      currentRead = reread;
    } else {
      currentRead = await readProjection(adapters.readBrowserProjection);
      if (!currentRead.ok) {
        return createMoveResult(request, {
          status: "indeterminate",
          reason: "post_move_projection_unavailable",
          targetWindowId,
          createdWindow: mutationState.createdWindow,
          browserMutationStarted: true,
          verification: emptyVerification(),
          retrySafe: false,
          errors: [currentRead.error]
        });
      }
    }
  }

  for (const plan of request.groups) {
    const ensured = await ensureSemanticGroup({
      request,
      plan,
      targetWindowId,
      adapters,
      before,
      mutationState
    });
    if (!ensured.ok) return ensured.result;
  }

  mutationState.started = true;
  const focused = await invoke(adapters.focusWindow, targetWindowId);
  const focusedSnapshot = focused.ok
    ? validateAdapterResult(snapshotFocusWindowResult(focused.value), { windowId: targetWindowId })
    : focused;
  if (!focused.ok || !focusedSnapshot.ok) {
    const reread = await readProjection(adapters.readBrowserProjection);
    if (!reread.ok) {
      return createMoveResult(request, {
        status: "indeterminate",
        reason: "focus_failed",
        targetWindowId,
        createdWindow: mutationState.createdWindow,
        browserMutationStarted: true,
        verification: emptyVerification(),
        retrySafe: false,
        errors: [focused.error || focusedSnapshot.error || { name: "FocusError", message: focusedSnapshot.reason }, reread.error]
      });
    }
    if (focusedWindowId(reread.value) !== targetWindowId) {
      return resultFromProjection({
        request,
        status: "indeterminate",
        reason: "focus_failed",
        before,
        projection: reread.value,
        targetWindowId,
        createdWindow: mutationState.createdWindow,
        mutationStarted: true,
        errors: [focused.error || focusedSnapshot.error || { name: "FocusError", message: focusedSnapshot.reason }]
      });
    }
  }

  const finalRead = await readProjection(adapters.readBrowserProjection);
  if (!finalRead.ok) {
    return createMoveResult(request, {
      status: "indeterminate",
      reason: "final_projection_unavailable",
      targetWindowId,
      createdWindow: mutationState.createdWindow,
      browserMutationStarted: mutationState.started,
      verification: emptyVerification(),
      retrySafe: false,
      errors: [finalRead.error]
    });
  }

  const verification = verify(request, before, finalRead.value, targetWindowId);
  const movedTabIds = provedMovedTabIds(request, before, finalRead.value);
  const noChange = !mutationState.started && verification.passed;
  return createMoveResult(request, {
    status: verification.passed
      ? noChange
        ? "no_change"
        : "completed_verified"
      : "indeterminate",
    reason: verification.passed
      ? noChange
        ? "already_correctly_placed"
        : "final_projection_verified"
      : "final_verification_failed",
    targetWindowId,
    createdWindow: mutationState.createdWindow,
    browserMutationStarted: mutationState.started,
    browserMutationVerified: verification.passed && mutationState.started,
    movedTabIds,
    alreadyInTargetTabIds: initialAlready,
    unassignedTabIds: request.tabs.filter((tab) => tab.role === "unassigned").map((tab) => tab.tabId),
    createdGroups: verifiedGroups(finalRead.value, request, targetWindowId),
    verification: verification.checks,
    retrySafe: noChange
  });
}
