export const MOVE_REQUEST_SCHEMA = "constellation-workspace-existing-tab-move-request-v0.1";
export const MOVE_RESULT_SCHEMA = "constellation-workspace-existing-tab-move-result-v0.1";
export const MOVE_MODES = Object.freeze([
  "create_dedicated_window",
  "attach_to_existing_dedicated_window"
]);
export const MOVE_STATUSES = Object.freeze([
  "completed_verified",
  "no_change",
  "conflict",
  "indeterminate",
  "failed",
  "invalid"
]);
export const ADAPTER_NAMES = Object.freeze([
  "readBrowserProjection",
  "createWindowFromTab",
  "moveTabs",
  "groupTabs",
  "updateGroup",
  "focusWindow"
]);

const REQUEST_FIELDS = Object.freeze([
  "schema",
  "operationId",
  "workspaceId",
  "mode",
  "sourceWindowIds",
  "targetWindowId",
  "tabs",
  "groups",
  "requestedAt"
]);
const TAB_FIELDS = Object.freeze([
  "workspaceTabId",
  "tabId",
  "sourceWindowId",
  "sourceGroupId",
  "role",
  "roleLabel",
  "order"
]);
const GROUP_REQUIRED_FIELDS = Object.freeze([
  "role",
  "roleLabel",
  "workspaceTabIds"
]);
const GROUP_OPTIONAL_FIELDS = Object.freeze(["colour", "collapsed"]);
const PROJECTION_FIELDS = Object.freeze(["windows"]);
const WINDOW_FIELDS = Object.freeze(["id", "focused", "tabs", "groups"]);
const PROJECTION_TAB_FIELDS = Object.freeze([
  "id",
  "windowId",
  "index",
  "groupId",
  "url",
  "title"
]);
const PROJECTION_GROUP_FIELDS = Object.freeze([
  "id",
  "windowId",
  "title",
  "colour",
  "collapsed",
  "tabIds"
]);

function ownKeys(value) {
  try {
    return Reflect.ownKeys(value);
  } catch {
    return null;
  }
}

function readOnce(value, key) {
  try {
    return { ok: true, value: Reflect.get(value, key) };
  } catch (error) {
    return { ok: false, error: safeError(error) };
  }
}

function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Reflect.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function isSafeId(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isGroupId(value) {
  return value === -1 || isSafeId(value);
}

function isText(value) {
  return typeof value === "string" && value.length > 0;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function safeError(error) {
  try {
    const name = readOnce(error, "name");
    const message = readOnce(error, "message");
    return {
      name: name.ok && typeof name.value === "string" ? name.value : "Error",
      message: message.ok && typeof message.value === "string" ? message.value : "Unknown error"
    };
  } catch {
    return { name: "Error", message: "Uninspectable error" };
  }
}

function snapshotExactObject(value, requiredFields, optionalFields = []) {
  if (!isPlainRecord(value)) return { ok: false, reason: "not_a_plain_object" };
  const keys = ownKeys(value);
  if (!keys || keys.some((key) => typeof key !== "string")) {
    return { ok: false, reason: "uninspectable_or_symbol_field" };
  }
  const allowed = new Set([...requiredFields, ...optionalFields]);
  if (keys.some((key) => !allowed.has(key))) return { ok: false, reason: "unknown_field" };
  if (requiredFields.some((field) => !keys.includes(field))) return { ok: false, reason: "missing_field" };
  const output = {};
  for (const field of [...requiredFields, ...optionalFields]) {
    if (!keys.includes(field)) continue;
    const item = readOnce(value, field);
    if (!item.ok) return { ok: false, reason: "throwing_getter", error: item.error };
    output[field] = item.value;
  }
  return { ok: true, value: output };
}

function snapshotStrictArray(value, mapper) {
  if (!Array.isArray(value)) return { ok: false, reason: "not_an_array" };
  const keys = ownKeys(value);
  if (!keys || keys.some((key) => typeof key !== "string")) {
    return { ok: false, reason: "uninspectable_or_symbol_array_field" };
  }
  const lengthRead = readOnce(value, "length");
  if (!lengthRead.ok || !Number.isSafeInteger(lengthRead.value) || lengthRead.value < 0) {
    return { ok: false, reason: "invalid_array_length" };
  }
  const expectedKeys = new Set(["length"]);
  for (let index = 0; index < lengthRead.value; index += 1) expectedKeys.add(String(index));
  if (keys.length !== expectedKeys.size || keys.some((key) => !expectedKeys.has(key))) {
    return { ok: false, reason: "sparse_or_extended_array" };
  }
  const output = [];
  for (let index = 0; index < lengthRead.value; index += 1) {
    const item = readOnce(value, String(index));
    if (!item.ok) return { ok: false, reason: "throwing_array_getter", error: item.error };
    const mapped = mapper(item.value, index);
    if (!mapped.ok) return mapped;
    output.push(mapped.value);
  }
  return { ok: true, value: output };
}

function snapshotSafeIdArray(value, reason = "invalid_id_array") {
  return snapshotStrictArray(value, (item) =>
    isSafeId(item) ? { ok: true, value: item } : { ok: false, reason }
  );
}

function snapshotTextArray(value, reason = "invalid_text_array") {
  return snapshotStrictArray(value, (item) =>
    isText(item) ? { ok: true, value: item } : { ok: false, reason }
  );
}

export function snapshotAndValidateRequest(input) {
  const outer = snapshotExactObject(input, REQUEST_FIELDS);
  if (!outer.ok) return outer;
  const request = outer.value;

  const sourceWindowIds = snapshotSafeIdArray(request.sourceWindowIds, "invalid_source_window_id");
  if (!sourceWindowIds.ok) return sourceWindowIds;

  const tabs = snapshotStrictArray(request.tabs, (value) => snapshotExactObject(value, TAB_FIELDS));
  if (!tabs.ok) return tabs;

  const groups = snapshotStrictArray(request.groups, (value) => {
    const group = snapshotExactObject(value, GROUP_REQUIRED_FIELDS, GROUP_OPTIONAL_FIELDS);
    if (!group.ok) return group;
    const members = snapshotTextArray(group.value.workspaceTabIds, "invalid_group_member");
    if (!members.ok) return members;
    return { ok: true, value: { ...group.value, workspaceTabIds: members.value } };
  });
  if (!groups.ok) return groups;

  const snapshot = {
    ...request,
    sourceWindowIds: sourceWindowIds.value,
    tabs: tabs.value,
    groups: groups.value
  };

  if (
    snapshot.schema !== MOVE_REQUEST_SCHEMA ||
    !isText(snapshot.operationId) ||
    !isText(snapshot.workspaceId) ||
    !MOVE_MODES.includes(snapshot.mode) ||
    !isText(snapshot.requestedAt)
  ) {
    return { ok: false, reason: "invalid_request_identity" };
  }

  if (
    (snapshot.mode === "create_dedicated_window" && snapshot.targetWindowId !== null) ||
    (snapshot.mode === "attach_to_existing_dedicated_window" && !isSafeId(snapshot.targetWindowId))
  ) {
    return { ok: false, reason: "invalid_target_window" };
  }

  if (snapshot.tabs.length === 0) return { ok: false, reason: "tabs_empty" };

  const canonicalSourceWindowIds = [...snapshot.sourceWindowIds].sort((left, right) => left - right);
  if (
    new Set(snapshot.sourceWindowIds).size !== snapshot.sourceWindowIds.length ||
    !arraysEqual(snapshot.sourceWindowIds, canonicalSourceWindowIds)
  ) {
    return { ok: false, reason: "source_window_ids_not_canonical" };
  }

  const workspaceTabIds = new Set();
  const liveTabIds = new Set();
  const orders = new Set();
  const representedSourceWindows = new Set();

  for (const tab of snapshot.tabs) {
    if (
      !isText(tab.workspaceTabId) ||
      !isSafeId(tab.tabId) ||
      !isSafeId(tab.sourceWindowId) ||
      !isGroupId(tab.sourceGroupId) ||
      !isText(tab.role) ||
      typeof tab.roleLabel !== "string" ||
      !isSafeId(tab.order)
    ) {
      return { ok: false, reason: "invalid_tab_plan" };
    }
    if (
      workspaceTabIds.has(tab.workspaceTabId) ||
      liveTabIds.has(tab.tabId) ||
      orders.has(tab.order)
    ) {
      return { ok: false, reason: "duplicate_tab_identity_or_order" };
    }
    workspaceTabIds.add(tab.workspaceTabId);
    liveTabIds.add(tab.tabId);
    orders.add(tab.order);
    representedSourceWindows.add(tab.sourceWindowId);
  }

  const representedSourceWindowIds = [...representedSourceWindows].sort((left, right) => left - right);
  if (!arraysEqual(snapshot.sourceWindowIds, representedSourceWindowIds)) {
    return { ok: false, reason: "source_window_ids_do_not_match_tabs" };
  }

  const groupedWorkspaceTabIds = new Set();
  const groupRoles = new Set();
  const groupLabels = new Set();

  for (const group of snapshot.groups) {
    if (
      !isText(group.role) ||
      group.role === "unassigned" ||
      !isText(group.roleLabel) ||
      group.workspaceTabIds.length === 0 ||
      (Object.hasOwn(group, "colour") && typeof group.colour !== "string") ||
      (Object.hasOwn(group, "collapsed") && typeof group.collapsed !== "boolean")
    ) {
      return { ok: false, reason: "invalid_group_plan" };
    }
    if (groupRoles.has(group.role) || groupLabels.has(group.roleLabel)) {
      return { ok: false, reason: "duplicate_semantic_group" };
    }
    groupRoles.add(group.role);
    groupLabels.add(group.roleLabel);

    const memberSet = new Set();
    for (const workspaceTabId of group.workspaceTabIds) {
      if (memberSet.has(workspaceTabId)) return { ok: false, reason: "duplicate_group_member" };
      memberSet.add(workspaceTabId);
      const tab = snapshot.tabs.find((item) => item.workspaceTabId === workspaceTabId);
      if (
        !tab ||
        tab.role === "unassigned" ||
        tab.role !== group.role ||
        tab.roleLabel !== group.roleLabel ||
        groupedWorkspaceTabIds.has(workspaceTabId)
      ) {
        return { ok: false, reason: "invalid_group_membership" };
      }
      groupedWorkspaceTabIds.add(workspaceTabId);
    }

    const assignedForRole = snapshot.tabs
      .filter((tab) => tab.role === group.role)
      .map((tab) => tab.workspaceTabId)
      .sort(compareText);
    const representedForRole = [...group.workspaceTabIds].sort(compareText);
    if (!arraysEqual(assignedForRole, representedForRole)) {
      return { ok: false, reason: "semantic_group_not_exact" };
    }
  }

  if (
    snapshot.tabs.some(
      (tab) => tab.role !== "unassigned" && !groupedWorkspaceTabIds.has(tab.workspaceTabId)
    )
  ) {
    return { ok: false, reason: "assigned_tab_missing_group" };
  }

  snapshot.tabs.sort(
    (left, right) => left.order - right.order || compareText(left.workspaceTabId, right.workspaceTabId)
  );
  snapshot.groups.sort(
    (left, right) => compareText(left.role, right.role) || compareText(left.roleLabel, right.roleLabel)
  );

  return { ok: true, value: snapshot };
}

export function snapshotAdapters(input) {
  if (!isPlainRecord(input)) return { ok: false, reason: "adapters_not_a_plain_object" };
  const keys = ownKeys(input);
  if (
    !keys ||
    keys.some((key) => typeof key !== "string") ||
    keys.length !== ADAPTER_NAMES.length ||
    keys.some((key) => !ADAPTER_NAMES.includes(key))
  ) {
    return { ok: false, reason: "invalid_adapter_fields" };
  }
  const adapters = {};
  for (const name of ADAPTER_NAMES) {
    const item = readOnce(input, name);
    if (!item.ok || typeof item.value !== "function") {
      return { ok: false, reason: "missing_adapter_" + name, error: item.error };
    }
    adapters[name] = item.value;
  }
  return { ok: true, value: adapters };
}

export function snapshotAndValidateProjection(input) {
  const outer = snapshotExactObject(input, PROJECTION_FIELDS);
  if (!outer.ok) return { ...outer, reason: "projection_" + outer.reason };

  const windows = snapshotStrictArray(outer.value.windows, (value) => {
    const browserWindow = snapshotExactObject(value, WINDOW_FIELDS);
    if (!browserWindow.ok) return browserWindow;

    const tabs = snapshotStrictArray(browserWindow.value.tabs, (tabValue) => {
      const tab = snapshotExactObject(tabValue, PROJECTION_TAB_FIELDS);
      if (!tab.ok) return tab;
      const item = tab.value;
      if (
        !isSafeId(item.id) ||
        !isSafeId(item.windowId) ||
        !isSafeId(item.index) ||
        !isGroupId(item.groupId) ||
        typeof item.url !== "string" ||
        typeof item.title !== "string"
      ) {
        return { ok: false, reason: "invalid_projection_tab" };
      }
      return { ok: true, value: item };
    });
    if (!tabs.ok) return tabs;

    const groups = snapshotStrictArray(browserWindow.value.groups, (groupValue) => {
      const group = snapshotExactObject(groupValue, PROJECTION_GROUP_FIELDS);
      if (!group.ok) return group;
      const tabIds = snapshotSafeIdArray(group.value.tabIds, "invalid_projection_group_tab_id");
      if (!tabIds.ok) return tabIds;
      const item = { ...group.value, tabIds: tabIds.value };
      if (
        !isSafeId(item.id) ||
        !isSafeId(item.windowId) ||
        typeof item.title !== "string" ||
        typeof item.colour !== "string" ||
        typeof item.collapsed !== "boolean" ||
        item.tabIds.length === 0
      ) {
        return { ok: false, reason: "invalid_projection_group" };
      }
      return { ok: true, value: item };
    });
    if (!groups.ok) return groups;

    if (!isSafeId(browserWindow.value.id) || typeof browserWindow.value.focused !== "boolean") {
      return { ok: false, reason: "invalid_projection_window" };
    }
    return {
      ok: true,
      value: {
        id: browserWindow.value.id,
        focused: browserWindow.value.focused,
        tabs: tabs.value,
        groups: groups.value
      }
    };
  });
  if (!windows.ok) return { ...windows, reason: "projection_" + windows.reason };

  const windowIds = new Set();
  const tabIds = new Set();
  const groupIds = new Set();
  let focusedWindowCount = 0;

  for (const browserWindow of windows.value) {
    if (windowIds.has(browserWindow.id)) return { ok: false, reason: "duplicate_projection_window_id" };
    windowIds.add(browserWindow.id);
    if (browserWindow.focused) focusedWindowCount += 1;

    const localTabs = new Map();
    for (const tab of browserWindow.tabs) {
      if (tab.windowId !== browserWindow.id) return { ok: false, reason: "projection_tab_window_mismatch" };
      if (tabIds.has(tab.id)) return { ok: false, reason: "duplicate_projection_tab_id" };
      tabIds.add(tab.id);
      localTabs.set(tab.id, tab);
    }

    const localGroups = new Map();
    const membershipByTabId = new Map();
    for (const group of browserWindow.groups) {
      if (group.windowId !== browserWindow.id) return { ok: false, reason: "projection_group_window_mismatch" };
      if (groupIds.has(group.id)) return { ok: false, reason: "duplicate_projection_group_id" };
      groupIds.add(group.id);
      localGroups.set(group.id, group);

      const members = new Set();
      for (const tabId of group.tabIds) {
        if (members.has(tabId)) return { ok: false, reason: "duplicate_projection_group_member" };
        members.add(tabId);
        if (!localTabs.has(tabId)) return { ok: false, reason: "projection_group_member_missing" };
        if (membershipByTabId.has(tabId)) return { ok: false, reason: "projection_tab_in_multiple_groups" };
        membershipByTabId.set(tabId, group.id);
      }
    }

    for (const tab of browserWindow.tabs) {
      if (tab.groupId === -1) {
        if (membershipByTabId.has(tab.id)) return { ok: false, reason: "projection_tab_group_disagreement" };
      } else {
        if (!localGroups.has(tab.groupId) || membershipByTabId.get(tab.id) !== tab.groupId) {
          return { ok: false, reason: "projection_tab_group_disagreement" };
        }
      }
    }
  }

  if (focusedWindowCount > 1) return { ok: false, reason: "multiple_focused_windows" };
  return { ok: true, value: { windows: windows.value } };
}

export function snapshotCreateWindowResult(input) {
  const result = snapshotExactObject(input, ["id"]);
  if (!result.ok) return { ...result, reason: "create_result_" + result.reason };
  return isSafeId(result.value.id)
    ? { ok: true, value: { id: result.value.id } }
    : { ok: false, reason: "create_result_invalid_id" };
}

export function snapshotMoveTabsResult(input) {
  const result = snapshotExactObject(input, ["tabIds", "windowId"]);
  if (!result.ok) return { ...result, reason: "move_result_" + result.reason };
  const tabIds = snapshotSafeIdArray(result.value.tabIds, "move_result_invalid_tab_id");
  if (!tabIds.ok) return tabIds;
  if (!isSafeId(result.value.windowId)) return { ok: false, reason: "move_result_invalid_window_id" };
  return { ok: true, value: { tabIds: tabIds.value, windowId: result.value.windowId } };
}

export function snapshotGroupTabsResult(input) {
  const result = snapshotExactObject(input, ["groupId", "tabIds", "windowId"]);
  if (!result.ok) return { ...result, reason: "group_result_" + result.reason };
  const tabIds = snapshotSafeIdArray(result.value.tabIds, "group_result_invalid_tab_id");
  if (!tabIds.ok) return tabIds;
  if (!isSafeId(result.value.groupId) || !isSafeId(result.value.windowId)) {
    return { ok: false, reason: "group_result_invalid_identity" };
  }
  return {
    ok: true,
    value: { groupId: result.value.groupId, tabIds: tabIds.value, windowId: result.value.windowId }
  };
}

export function snapshotUpdateGroupResult(input) {
  const result = snapshotExactObject(input, ["groupId"]);
  if (!result.ok) return { ...result, reason: "group_update_result_" + result.reason };
  return isSafeId(result.value.groupId)
    ? { ok: true, value: { groupId: result.value.groupId } }
    : { ok: false, reason: "group_update_result_invalid_group_id" };
}

export function snapshotFocusWindowResult(input) {
  const result = snapshotExactObject(input, ["windowId"]);
  if (!result.ok) return { ...result, reason: "focus_result_" + result.reason };
  return isSafeId(result.value.windowId)
    ? { ok: true, value: { windowId: result.value.windowId } }
    : { ok: false, reason: "focus_result_invalid_window_id" };
}

export function createMoveResult(request, patch = {}) {
  const base = {
    schema: MOVE_RESULT_SCHEMA,
    status: "invalid",
    reason: "invalid_request",
    operationId: request?.operationId || null,
    workspaceId: request?.workspaceId || null,
    mode: request?.mode || null,
    targetWindowId: request?.targetWindowId ?? null,
    createdWindow: false,
    browserMutationStarted: false,
    browserMutationVerified: false,
    movedTabIds: [],
    alreadyInTargetTabIds: [],
    unassignedTabIds: [],
    createdGroups: [],
    verification: [],
    retrySafe: false,
    warnings: [],
    errors: []
  };
  return { ...base, ...patch };
}
