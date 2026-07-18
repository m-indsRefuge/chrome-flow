import { validateAssignmentRegistry } from "../runtime-contract/assignments.js";
import { nonEmptyString, stableStringify, validDateTime } from "../runtime-contract/value-utils.js";
import {
  MOVE_RESULT_SCHEMA,
  MOVE_MODES,
  MOVE_STATUSES
} from "../workspace-existing-tab-move-engine/contract.js";

export const PROMOTION_REQUEST_SCHEMA = "constellation-workspace-automatic-promotion-request-v0.1";
export const PROMOTION_RESULT_SCHEMA = "constellation-workspace-automatic-promotion-result-v0.1";
export const PROMOTION_STATE_SCHEMA = "constellation-workspace-automatic-promotion-state-v0.1";
export const PROMOTION_PENDING_SCHEMA = "constellation-workspace-automatic-promotion-pending-v0.1";
export const PROMOTION_THRESHOLD = 4;

export const PROMOTION_STATUSES = Object.freeze([
  "committed",
  "replayed",
  "no_change",
  "conflict",
  "invalid",
  "failed",
  "indeterminate"
]);

export const PROMOTION_DECISIONS = Object.freeze([
  "use_dedicated_window",
  "retain_current_placement",
  "retry_transaction",
  "manual_resolution_required",
  "reject_request"
]);

export const PROMOTION_PHASES = Object.freeze([
  "request_validation",
  "operation_inspection",
  "lock_acquisition",
  "state_reread",
  "authority_validation",
  "promotion_classification",
  "browser_move",
  "runtime_assignment_transition",
  "runtime_assignment_write",
  "runtime_assignment_verification",
  "workspace_placement_write",
  "workspace_placement_verification",
  "final_verification",
  "operation_recording",
  "result_serialization",
  "complete"
]);

export const ADAPTER_FIELDS = Object.freeze([
  "runExclusiveOperation",
  "readOperationLedger",
  "writeOperationLedger",
  "readPromotionState",
  "readRuntimeAuthority",
  "executeExistingTabMove",
  "writeRuntimeAuthority",
  "writeWorkspacePlacement"
]);

const REQUEST_FIELDS = Object.freeze([
  "schema",
  "operationId",
  "triggerOperationId",
  "triggerKind",
  "workspaceId",
  "sourceContextId",
  "sourceWindowId",
  "expectedWorkspaceRevision",
  "previousEligibleTabCount",
  "currentEligibleTabCount",
  "threshold",
  "nextRuntimeAssignmentId",
  "requestedAt"
]);

const STATE_FIELDS = Object.freeze([
  "schema",
  "status",
  "workspaceId",
  "workspaceRevision",
  "eligibleTabCount",
  "placementMode",
  "dedicatedWindowId",
  "sourceWindowIds",
  "tabs",
  "groups",
  "error"
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

const AUTHORITY_FIELDS = Object.freeze([
  "status",
  "runtimeSessionId",
  "authorityRevision",
  "sourceContextVerified",
  "assignmentRegistry",
  "error"
]);


const PENDING_FIELDS = Object.freeze([
  "schema",
  "operationId",
  "requestFingerprint",
  "workspaceId",
  "sourceContextId",
  "sourceWindowId",
  "expectedWorkspaceRevision",
  "previousEligibleTabCount",
  "currentEligibleTabCount",
  "threshold",
  "nextRuntimeAssignmentId",
  "requestedAt",
  "moveMode",
  "targetWindowId",
  "baselineSourceWindowIds",
  "previousRuntimeAssignmentId",
  "previousAssignmentEpoch",
  "runtimeSessionId",
  "authorityRevisionBefore"
]);

const MOVE_RESULT_FIELDS = Object.freeze([
  "schema",
  "status",
  "reason",
  "operationId",
  "workspaceId",
  "mode",
  "targetWindowId",
  "createdWindow",
  "browserMutationStarted",
  "browserMutationVerified",
  "movedTabIds",
  "alreadyInTargetTabIds",
  "unassignedTabIds",
  "createdGroups",
  "verification",
  "retrySafe",
  "warnings",
  "errors"
]);

export const REQUIRED_MOVE_VERIFICATION_CHECK_IDS = Object.freeze([
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

export const RESULT_FIELDS = Object.freeze([
  "schema",
  "status",
  "reason",
  "decision",
  "phase",
  "operationId",
  "triggerOperationId",
  "workspaceId",
  "sourceContextId",
  "sourceWindowId",
  "requestFingerprint",
  "threshold",
  "previousEligibleTabCount",
  "currentEligibleTabCount",
  "workspaceRevisionBefore",
  "workspaceRevisionAfter",
  "moveMode",
  "moveOperationId",
  "moveStatus",
  "targetWindowId",
  "browserMutationStarted",
  "browserMutationVerified",
  "runtimeSessionId",
  "authorityRevisionBefore",
  "authorityRevisionAfter",
  "previousRuntimeAssignmentId",
  "previousAssignmentEpoch",
  "nextRuntimeAssignmentId",
  "nextAssignmentEpoch",
  "assignmentTransferred",
  "assignmentVerified",
  "workspacePlacementWritten",
  "workspacePlacementVerified",
  "replayed",
  "retrySafe",
  "indeterminate",
  "warnings",
  "errors"
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
  } catch {
    return { ok: false };
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

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function exactFields(value, fields) {
  return stableStringify(Object.keys(value).sort(compareText)) === stableStringify([...fields].sort(compareText));
}

export function snapshotSerializable(input) {
  const seen = new WeakSet();

  function visit(value) {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
      return { ok: true, value };
    }
    if (typeof value === "number") {
      return Number.isFinite(value)
        ? { ok: true, value }
        : { ok: false, reason: "non_finite_number" };
    }
    if (["undefined", "function", "symbol", "bigint"].includes(typeof value)) {
      return { ok: false, reason: "unsupported_value" };
    }
    if (seen.has(value)) return { ok: false, reason: "cyclic_value" };

    if (Array.isArray(value)) {
      const keys = ownKeys(value);
      const lengthRead = readOnce(value, "length");
      if (!keys || !lengthRead.ok || !Number.isSafeInteger(lengthRead.value) || lengthRead.value < 0) {
        return { ok: false, reason: "invalid_array" };
      }
      if (keys.some((key) => typeof key !== "string")) return { ok: false, reason: "symbol_array_field" };
      const expected = new Set(["length"]);
      for (let index = 0; index < lengthRead.value; index += 1) expected.add(String(index));
      if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) {
        return { ok: false, reason: "sparse_or_extended_array" };
      }
      seen.add(value);
      const output = [];
      for (let index = 0; index < lengthRead.value; index += 1) {
        const read = readOnce(value, String(index));
        if (!read.ok) return { ok: false, reason: "throwing_array_getter" };
        const nested = visit(read.value);
        if (!nested.ok) return nested;
        output.push(nested.value);
      }
      seen.delete(value);
      return { ok: true, value: output };
    }

    if (!isPlainRecord(value)) return { ok: false, reason: "non_plain_object" };
    const keys = ownKeys(value);
    if (!keys || keys.some((key) => typeof key !== "string")) {
      return { ok: false, reason: "symbol_object_field" };
    }
    seen.add(value);
    const output = {};
    for (const key of [...keys].sort(compareText)) {
      const read = readOnce(value, key);
      if (!read.ok) return { ok: false, reason: "throwing_object_getter" };
      const nested = visit(read.value);
      if (!nested.ok) return nested;
      output[key] = nested.value;
    }
    seen.delete(value);
    return { ok: true, value: output };
  }

  try {
    return visit(input);
  } catch {
    return { ok: false, reason: "snapshot_failed" };
  }
}

export function normalizePromotionIdentities(input) {
  function stringField(key) {
    try {
      const value = Reflect.get(input, key);
      return typeof value === "string" ? value : "";
    } catch {
      return "";
    }
  }
  function integerField(key) {
    try {
      const value = Reflect.get(input, key);
      return isSafeId(value) ? value : null;
    } catch {
      return null;
    }
  }
  return {
    operationId: stringField("operationId"),
    triggerOperationId: stringField("triggerOperationId"),
    workspaceId: stringField("workspaceId"),
    sourceContextId: stringField("sourceContextId"),
    sourceWindowId: integerField("sourceWindowId"),
    threshold: integerField("threshold"),
    previousEligibleTabCount: integerField("previousEligibleTabCount"),
    currentEligibleTabCount: integerField("currentEligibleTabCount"),
    nextRuntimeAssignmentId: stringField("nextRuntimeAssignmentId")
  };
}

export function snapshotAndValidatePromotionRequest(input) {
  const snapshot = snapshotSerializable(input);
  if (!snapshot.ok) return snapshot;
  const request = snapshot.value;
  const errors = [];

  if (!isPlainRecord(request) || !exactFields(request, REQUEST_FIELDS)) {
    errors.push("request_fields_invalid");
  }
  if (request.schema !== PROMOTION_REQUEST_SCHEMA) errors.push("request_schema_invalid");
  for (const field of [
    "operationId",
    "triggerOperationId",
    "workspaceId",
    "sourceContextId",
    "nextRuntimeAssignmentId"
  ]) {
    if (!nonEmptyString(request[field])) errors.push(field + "_invalid");
  }
  if (request.triggerKind !== "workspace_membership_increased") {
    errors.push("trigger_kind_invalid");
  }
  if (!isSafeId(request.sourceWindowId)) errors.push("source_window_id_invalid");
  if (!isSafeId(request.expectedWorkspaceRevision)) errors.push("expected_workspace_revision_invalid");
  if (!isSafeId(request.previousEligibleTabCount)) errors.push("previous_eligible_tab_count_invalid");
  if (!isSafeId(request.currentEligibleTabCount)) errors.push("current_eligible_tab_count_invalid");
  if (request.threshold !== PROMOTION_THRESHOLD) errors.push("threshold_invalid");
  if (
    isSafeId(request.previousEligibleTabCount) &&
    isSafeId(request.currentEligibleTabCount) &&
    request.currentEligibleTabCount <= request.previousEligibleTabCount
  ) {
    errors.push("membership_increase_invalid");
  }
  if (
    isSafeId(request.currentEligibleTabCount) &&
    request.currentEligibleTabCount < PROMOTION_THRESHOLD
  ) {
    errors.push("promotion_threshold_not_reached");
  }
  if (!validDateTime(request.requestedAt)) errors.push("requested_at_invalid");

  return errors.length
    ? { ok: false, reason: "invalid_promotion_request", errors: [...new Set(errors)].sort(compareText) }
    : { ok: true, value: request };
}

function validateTabsAndGroups(state) {
  if (!Array.isArray(state.sourceWindowIds) || !Array.isArray(state.tabs) || !Array.isArray(state.groups)) {
    return ["promotion_state_arrays_invalid"];
  }
  if (
    state.sourceWindowIds.some((value) => !isSafeId(value)) ||
    new Set(state.sourceWindowIds).size !== state.sourceWindowIds.length ||
    !arraysEqual(state.sourceWindowIds, [...state.sourceWindowIds].sort((left, right) => left - right))
  ) {
    return ["promotion_state_source_windows_invalid"];
  }

  const workspaceTabIds = new Set();
  const tabIds = new Set();
  const orders = new Set();
  const representedWindows = new Set();

  for (const tab of state.tabs) {
    if (!isPlainRecord(tab) || !exactFields(tab, TAB_FIELDS)) return ["promotion_state_tab_fields_invalid"];
    if (
      !nonEmptyString(tab.workspaceTabId) ||
      !isSafeId(tab.tabId) ||
      !isSafeId(tab.sourceWindowId) ||
      !isGroupId(tab.sourceGroupId) ||
      !nonEmptyString(tab.role) ||
      typeof tab.roleLabel !== "string" ||
      !isSafeId(tab.order)
    ) {
      return ["promotion_state_tab_invalid"];
    }
    if (workspaceTabIds.has(tab.workspaceTabId) || tabIds.has(tab.tabId) || orders.has(tab.order)) {
      return ["promotion_state_tab_identity_duplicate"];
    }
    workspaceTabIds.add(tab.workspaceTabId);
    tabIds.add(tab.tabId);
    orders.add(tab.order);
    representedWindows.add(tab.sourceWindowId);
  }

  if (!arraysEqual(state.sourceWindowIds, [...representedWindows].sort((left, right) => left - right))) {
    return ["promotion_state_source_windows_mismatch"];
  }

  const grouped = new Set();
  const roles = new Set();
  const labels = new Set();

  for (const group of state.groups) {
    if (!isPlainRecord(group)) return ["promotion_state_group_invalid"];
    const keys = Object.keys(group);
    const requiredPresent = GROUP_REQUIRED_FIELDS.every((field) => keys.includes(field));
    const allowed = new Set([...GROUP_REQUIRED_FIELDS, ...GROUP_OPTIONAL_FIELDS]);
    if (!requiredPresent || keys.some((key) => !allowed.has(key))) return ["promotion_state_group_fields_invalid"];
    if (
      !nonEmptyString(group.role) ||
      group.role === "unassigned" ||
      !nonEmptyString(group.roleLabel) ||
      !Array.isArray(group.workspaceTabIds) ||
      group.workspaceTabIds.length === 0 ||
      (Object.hasOwn(group, "colour") && typeof group.colour !== "string") ||
      (Object.hasOwn(group, "collapsed") && typeof group.collapsed !== "boolean")
    ) {
      return ["promotion_state_group_invalid"];
    }
    if (roles.has(group.role) || labels.has(group.roleLabel)) {
      return ["promotion_state_group_duplicate"];
    }
    roles.add(group.role);
    labels.add(group.roleLabel);

    const local = new Set();
    for (const workspaceTabId of group.workspaceTabIds) {
      if (!nonEmptyString(workspaceTabId) || local.has(workspaceTabId) || grouped.has(workspaceTabId)) {
        return ["promotion_state_group_member_invalid"];
      }
      local.add(workspaceTabId);
      grouped.add(workspaceTabId);
      const tab = state.tabs.find((item) => item.workspaceTabId === workspaceTabId);
      if (!tab || tab.role !== group.role || tab.roleLabel !== group.roleLabel || tab.role === "unassigned") {
        return ["promotion_state_group_semantics_invalid"];
      }
    }

    const expected = state.tabs
      .filter((tab) => tab.role === group.role)
      .map((tab) => tab.workspaceTabId)
      .sort(compareText);
    const actual = [...group.workspaceTabIds].sort(compareText);
    if (!arraysEqual(expected, actual)) return ["promotion_state_group_not_exact"];
  }

  if (state.tabs.some((tab) => tab.role !== "unassigned" && !grouped.has(tab.workspaceTabId))) {
    return ["promotion_state_assigned_tab_missing_group"];
  }

  return [];
}

export function snapshotAndValidatePromotionState(input) {
  const snapshot = snapshotSerializable(input);
  if (!snapshot.ok) return snapshot;
  const state = snapshot.value;

  if (!isPlainRecord(state) || !exactFields(state, STATE_FIELDS)) {
    return { ok: false, reason: "promotion_state_fields_invalid" };
  }
  if (state.schema !== PROMOTION_STATE_SCHEMA) {
    return { ok: false, reason: "promotion_state_schema_invalid" };
  }
  if (!["present", "absent", "failed"].includes(state.status) || typeof state.error !== "string") {
    return { ok: false, reason: "promotion_state_status_invalid" };
  }
  if (state.status !== "present") {
    const emptyState =
      state.workspaceId === "" &&
      state.workspaceRevision === null &&
      state.eligibleTabCount === null &&
      state.placementMode === null &&
      state.dedicatedWindowId === null &&
      Array.isArray(state.sourceWindowIds) &&
      state.sourceWindowIds.length === 0 &&
      Array.isArray(state.tabs) &&
      state.tabs.length === 0 &&
      Array.isArray(state.groups) &&
      state.groups.length === 0;
    if (!emptyState || (state.status === "absent" && state.error !== "") || (state.status === "failed" && !nonEmptyString(state.error))) {
      return { ok: false, reason: "promotion_state_nonpresent_matrix_invalid" };
    }
    return { ok: true, value: state };
  }

  if (
    !nonEmptyString(state.workspaceId) ||
    !isSafeId(state.workspaceRevision) ||
    !isSafeId(state.eligibleTabCount) ||
    !["current_window", "dedicated_window"].includes(state.placementMode) ||
    state.error !== ""
  ) {
    return { ok: false, reason: "promotion_state_identity_invalid" };
  }
  if (
    (state.placementMode === "current_window" && state.dedicatedWindowId !== null) ||
    (state.placementMode === "dedicated_window" && !isSafeId(state.dedicatedWindowId))
  ) {
    return { ok: false, reason: "promotion_state_placement_invalid" };
  }

  const planErrors = validateTabsAndGroups(state);
  if (planErrors.length) return { ok: false, reason: planErrors[0] };
  if (state.eligibleTabCount !== state.tabs.length) {
    return { ok: false, reason: "promotion_state_tab_count_mismatch" };
  }

  return { ok: true, value: state };
}

export function snapshotAndValidateRuntimeAuthority(input) {
  const snapshot = snapshotSerializable(input);
  if (!snapshot.ok) return snapshot;
  const value = snapshot.value;
  if (!isPlainRecord(value) || !exactFields(value, AUTHORITY_FIELDS)) {
    return { ok: false, reason: "runtime_authority_fields_invalid" };
  }
  if (
    value.status !== "present" ||
    !nonEmptyString(value.runtimeSessionId) ||
    !isSafeId(value.authorityRevision) ||
    typeof value.sourceContextVerified !== "boolean" ||
    typeof value.error !== "string" ||
    value.error !== ""
  ) {
    return { ok: false, reason: "runtime_authority_status_invalid" };
  }
  const validation = validateAssignmentRegistry(value.assignmentRegistry);
  if (!validation.valid) return { ok: false, reason: "assignment_registry_invalid", errors: validation.errors };
  return { ok: true, value };
}

export function snapshotAndValidateMoveResult(input) {
  const snapshot = snapshotSerializable(input);
  if (!snapshot.ok) return snapshot;
  const value = snapshot.value;
  if (!isPlainRecord(value) || !exactFields(value, MOVE_RESULT_FIELDS)) {
    return { ok: false, reason: "move_result_fields_invalid" };
  }
  if (
    value.schema !== MOVE_RESULT_SCHEMA ||
    !MOVE_STATUSES.includes(value.status) ||
    !nonEmptyString(value.reason) ||
    !nonEmptyString(value.operationId) ||
    !nonEmptyString(value.workspaceId) ||
    !MOVE_MODES.includes(value.mode) ||
    !(value.targetWindowId === null || isSafeId(value.targetWindowId)) ||
    typeof value.createdWindow !== "boolean" ||
    typeof value.browserMutationStarted !== "boolean" ||
    typeof value.browserMutationVerified !== "boolean" ||
    typeof value.retrySafe !== "boolean"
  ) {
    return { ok: false, reason: "move_result_identity_invalid" };
  }
  for (const field of ["movedTabIds", "alreadyInTargetTabIds", "unassignedTabIds"]) {
    if (!Array.isArray(value[field]) || value[field].some((item) => !isSafeId(item))) {
      return { ok: false, reason: "move_result_tab_ids_invalid" };
    }
  }
  if (
    !Array.isArray(value.createdGroups) ||
    !Array.isArray(value.verification) ||
    !Array.isArray(value.warnings) ||
    !Array.isArray(value.errors)
  ) {
    return { ok: false, reason: "move_result_arrays_invalid" };
  }
  if (!value.warnings.every((item) => typeof item === "string")) {
    return { ok: false, reason: "move_result_warnings_invalid" };
  }
  if (!value.verification.every((item) =>
    isPlainRecord(item) &&
    exactFields(item, ["id", "passed"]) &&
    nonEmptyString(item.id) &&
    typeof item.passed === "boolean"
  )) {
    return { ok: false, reason: "move_result_verification_invalid" };
  }
  const verificationIds = value.verification.map((item) => item.id);
  const verifiedSuccess =
    arraysEqual(verificationIds, REQUIRED_MOVE_VERIFICATION_CHECK_IDS) &&
    new Set(verificationIds).size === REQUIRED_MOVE_VERIFICATION_CHECK_IDS.length &&
    value.verification.every((item) => item.passed === true);
  if (
    value.status === "completed_verified" &&
    (!value.browserMutationVerified || !isSafeId(value.targetWindowId) || !verifiedSuccess)
  ) {
    return { ok: false, reason: "move_result_success_matrix_invalid" };
  }
  if (
    value.status === "no_change" &&
    (!value.browserMutationVerified || !isSafeId(value.targetWindowId) || !verifiedSuccess)
  ) {
    return { ok: false, reason: "move_result_no_change_matrix_invalid" };
  }
  return { ok: true, value };
}

export function snapshotAdapters(input) {
  if (!isPlainRecord(input)) return { ok: false, reason: "adapters_not_plain_object" };
  const keys = ownKeys(input);
  if (
    !keys ||
    keys.some((key) => typeof key !== "string") ||
    keys.length !== ADAPTER_FIELDS.length ||
    keys.some((key) => !ADAPTER_FIELDS.includes(key))
  ) {
    return { ok: false, reason: "adapter_fields_invalid" };
  }
  const adapters = {};
  for (const field of ADAPTER_FIELDS) {
    const read = readOnce(input, field);
    if (!read.ok || typeof read.value !== "function") {
      return { ok: false, reason: "adapter_" + field + "_invalid" };
    }
    adapters[field] = read.value;
  }
  return { ok: true, value: adapters };
}

export function createPromotionResult(identities, patch = {}) {
  return {
    schema: PROMOTION_RESULT_SCHEMA,
    status: patch.status || "failed",
    reason: patch.reason || "promotion_transaction_failed",
    decision: patch.decision || "retry_transaction",
    phase: patch.phase || "result_serialization",
    operationId: identities.operationId,
    triggerOperationId: identities.triggerOperationId,
    workspaceId: identities.workspaceId,
    sourceContextId: identities.sourceContextId,
    sourceWindowId: identities.sourceWindowId,
    requestFingerprint: typeof patch.requestFingerprint === "string" ? patch.requestFingerprint : "",
    threshold: identities.threshold,
    previousEligibleTabCount: identities.previousEligibleTabCount,
    currentEligibleTabCount: identities.currentEligibleTabCount,
    workspaceRevisionBefore: isSafeId(patch.workspaceRevisionBefore) ? patch.workspaceRevisionBefore : null,
    workspaceRevisionAfter: isSafeId(patch.workspaceRevisionAfter) ? patch.workspaceRevisionAfter : null,
    moveMode: MOVE_MODES.includes(patch.moveMode) ? patch.moveMode : null,
    moveOperationId: typeof patch.moveOperationId === "string" ? patch.moveOperationId : "",
    moveStatus: MOVE_STATUSES.includes(patch.moveStatus) ? patch.moveStatus : null,
    targetWindowId: isSafeId(patch.targetWindowId) ? patch.targetWindowId : null,
    browserMutationStarted: patch.browserMutationStarted === true,
    browserMutationVerified: patch.browserMutationVerified === true,
    runtimeSessionId: typeof patch.runtimeSessionId === "string" ? patch.runtimeSessionId : "",
    authorityRevisionBefore: isSafeId(patch.authorityRevisionBefore) ? patch.authorityRevisionBefore : null,
    authorityRevisionAfter: isSafeId(patch.authorityRevisionAfter) ? patch.authorityRevisionAfter : null,
    previousRuntimeAssignmentId: typeof patch.previousRuntimeAssignmentId === "string" ? patch.previousRuntimeAssignmentId : "",
    previousAssignmentEpoch: Number.isSafeInteger(patch.previousAssignmentEpoch) && patch.previousAssignmentEpoch > 0 ? patch.previousAssignmentEpoch : null,
    nextRuntimeAssignmentId: typeof patch.nextRuntimeAssignmentId === "string" ? patch.nextRuntimeAssignmentId : identities.nextRuntimeAssignmentId,
    nextAssignmentEpoch: Number.isSafeInteger(patch.nextAssignmentEpoch) && patch.nextAssignmentEpoch > 0 ? patch.nextAssignmentEpoch : null,
    assignmentTransferred: patch.assignmentTransferred === true,
    assignmentVerified: patch.assignmentVerified === true,
    workspacePlacementWritten: patch.workspacePlacementWritten === true,
    workspacePlacementVerified: patch.workspacePlacementVerified === true,
    replayed: patch.replayed === true,
    retrySafe: patch.retrySafe === true,
    indeterminate: patch.indeterminate === true,
    warnings: Array.isArray(patch.warnings) ? patch.warnings : [],
    errors: Array.isArray(patch.errors) ? patch.errors : []
  };
}

export function validatePromotionResult(input) {
  const snapshot = snapshotSerializable(input);
  if (!snapshot.ok) return false;
  const value = snapshot.value;
  if (!isPlainRecord(value) || !exactFields(value, RESULT_FIELDS)) return false;
  if (
    value.schema !== PROMOTION_RESULT_SCHEMA ||
    !PROMOTION_STATUSES.includes(value.status) ||
    !PROMOTION_DECISIONS.includes(value.decision) ||
    !PROMOTION_PHASES.includes(value.phase) ||
    !nonEmptyString(value.reason) ||
    typeof value.requestFingerprint !== "string"
  ) {
    return false;
  }
  for (const field of ["operationId", "triggerOperationId", "workspaceId", "sourceContextId", "nextRuntimeAssignmentId"]) {
    if (typeof value[field] !== "string") return false;
  }
  for (const field of [
    "sourceWindowId",
    "threshold",
    "previousEligibleTabCount",
    "currentEligibleTabCount",
    "workspaceRevisionBefore",
    "workspaceRevisionAfter",
    "targetWindowId",
    "authorityRevisionBefore",
    "authorityRevisionAfter"
  ]) {
    if (!(value[field] === null || isSafeId(value[field]))) return false;
  }
  for (const field of ["previousAssignmentEpoch", "nextAssignmentEpoch"]) {
    if (!(value[field] === null || (Number.isSafeInteger(value[field]) && value[field] > 0))) return false;
  }
  for (const field of [
    "browserMutationStarted",
    "browserMutationVerified",
    "assignmentTransferred",
    "assignmentVerified",
    "workspacePlacementWritten",
    "workspacePlacementVerified",
    "replayed",
    "retrySafe",
    "indeterminate"
  ]) {
    if (typeof value[field] !== "boolean") return false;
  }
  if (
    !(value.moveMode === null || MOVE_MODES.includes(value.moveMode)) ||
    !(value.moveStatus === null || MOVE_STATUSES.includes(value.moveStatus)) ||
    typeof value.moveOperationId !== "string" ||
    typeof value.runtimeSessionId !== "string" ||
    typeof value.previousRuntimeAssignmentId !== "string" ||
    !Array.isArray(value.warnings) ||
    !value.warnings.every((item) => typeof item === "string") ||
    !Array.isArray(value.errors)
  ) {
    return false;
  }
  const dedicatedVerified =
    value.decision === "use_dedicated_window" &&
    value.phase === "complete" &&
    value.browserMutationVerified &&
    value.assignmentVerified &&
    value.workspacePlacementVerified &&
    isSafeId(value.targetWindowId) &&
    MOVE_MODES.includes(value.moveMode) &&
    ["completed_verified", "no_change"].includes(value.moveStatus);
  const retainedVerified =
    value.decision === "retain_current_placement" &&
    value.phase === "complete" &&
    !value.browserMutationStarted &&
    !value.browserMutationVerified &&
    value.moveMode === null &&
    value.moveStatus === null &&
    value.targetWindowId === null &&
    value.workspacePlacementVerified;
  if (value.status === "committed" && (!dedicatedVerified || value.replayed)) return false;
  if (
    value.status === "replayed" &&
    (!value.replayed || !(dedicatedVerified || retainedVerified))
  ) {
    return false;
  }
  if (
    value.status === "no_change" &&
    (value.replayed || !(dedicatedVerified || retainedVerified))
  ) {
    return false;
  }
  if (value.status === "conflict" && value.decision !== "manual_resolution_required") return false;
  if (value.status === "invalid" && value.decision !== "reject_request") return false;
  if (["failed", "indeterminate"].includes(value.status) && value.decision !== "retry_transaction") return false;
  if (value.status === "indeterminate" && !value.indeterminate) return false;
  return true;
}


export function createPromotionPendingRecord(request, requestFingerprint, fields) {
  return {
    schema: PROMOTION_PENDING_SCHEMA,
    operationId: request.operationId,
    requestFingerprint,
    workspaceId: request.workspaceId,
    sourceContextId: request.sourceContextId,
    sourceWindowId: request.sourceWindowId,
    expectedWorkspaceRevision: request.expectedWorkspaceRevision,
    previousEligibleTabCount: request.previousEligibleTabCount,
    currentEligibleTabCount: request.currentEligibleTabCount,
    threshold: request.threshold,
    nextRuntimeAssignmentId: request.nextRuntimeAssignmentId,
    requestedAt: request.requestedAt,
    moveMode: fields.moveMode,
    targetWindowId: fields.targetWindowId,
    baselineSourceWindowIds: [...fields.baselineSourceWindowIds],
    previousRuntimeAssignmentId: fields.previousRuntimeAssignmentId,
    previousAssignmentEpoch: fields.previousAssignmentEpoch,
    runtimeSessionId: fields.runtimeSessionId,
    authorityRevisionBefore: fields.authorityRevisionBefore
  };
}

export function snapshotAndValidatePendingRecord(input) {
  const snapshot = snapshotSerializable(input);
  if (!snapshot.ok) return snapshot;
  const value = snapshot.value;
  if (!isPlainRecord(value) || !exactFields(value, PENDING_FIELDS)) {
    return { ok: false, reason: "pending_record_fields_invalid" };
  }
  if (
    value.schema !== PROMOTION_PENDING_SCHEMA ||
    !nonEmptyString(value.operationId) ||
    typeof value.requestFingerprint !== "string" ||
    !nonEmptyString(value.workspaceId) ||
    !nonEmptyString(value.sourceContextId) ||
    !isSafeId(value.sourceWindowId) ||
    !isSafeId(value.expectedWorkspaceRevision) ||
    !isSafeId(value.previousEligibleTabCount) ||
    !isSafeId(value.currentEligibleTabCount) ||
    value.threshold !== PROMOTION_THRESHOLD ||
    !nonEmptyString(value.nextRuntimeAssignmentId) ||
    !validDateTime(value.requestedAt) ||
    !MOVE_MODES.includes(value.moveMode) ||
    !(value.targetWindowId === null || isSafeId(value.targetWindowId)) ||
    !Array.isArray(value.baselineSourceWindowIds) ||
    value.baselineSourceWindowIds.length === 0 ||
    value.baselineSourceWindowIds.some((item) => !isSafeId(item)) ||
    new Set(value.baselineSourceWindowIds).size !== value.baselineSourceWindowIds.length ||
    !arraysEqual(value.baselineSourceWindowIds, [...value.baselineSourceWindowIds].sort((left, right) => left - right)) ||
    !nonEmptyString(value.previousRuntimeAssignmentId) ||
    !Number.isSafeInteger(value.previousAssignmentEpoch) ||
    value.previousAssignmentEpoch <= 0 ||
    !nonEmptyString(value.runtimeSessionId) ||
    !isSafeId(value.authorityRevisionBefore)
  ) {
    return { ok: false, reason: "pending_record_invalid" };
  }
  if (
    (value.moveMode === "create_dedicated_window" && value.targetWindowId !== null) ||
    (
      value.moveMode === "attach_to_existing_dedicated_window" &&
      (
        !isSafeId(value.targetWindowId) ||
        !value.baselineSourceWindowIds.includes(value.targetWindowId)
      )
    )
  ) {
    return { ok: false, reason: "pending_record_mode_invalid" };
  }
  return { ok: true, value };
}
