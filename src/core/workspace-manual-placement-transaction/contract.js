import { nonEmptyString, stableStringify, validDateTime } from "../runtime-contract/value-utils.js";
import { snapshotAndValidateRequest as snapshotAndValidateMoveRequest } from "../workspace-existing-tab-move-engine/contract.js";
import {
  ACTIVATION_OPERATIONS,
  RUNTIME_WORKSPACE_ACTIVATION_REQUEST_SCHEMA,
  RUNTIME_WORKSPACE_ACTIVATION_TYPE,
  createActivationRequestFingerprint,
  snapshotSerializable,
  validateActivationResult
} from "../runtime-workspace-activation/contract.js";

export { snapshotSerializable };

export const MANUAL_PLACEMENT_TYPE = "constellation-workspace-manual-placement";
export const MANUAL_PLACEMENT_REQUEST_SCHEMA = "constellation-workspace-manual-placement-request-v0.1";
export const MANUAL_PLACEMENT_PENDING_SCHEMA = "constellation-workspace-manual-placement-pending-v0.1";
export const MANUAL_PLACEMENT_RESULT_SCHEMA = "constellation-workspace-manual-placement-result-v0.1";

export const MANUAL_PLACEMENT_ADAPTER_FIELDS = Object.freeze([
  "runExclusiveOperation",
  "readOperationLedger",
  "writeOperationLedger",
  "readPlacementState",
  "readManualPlacementEvidence",
  "executeExistingTabMove",
  "transferActive",
  "writeWorkspacePlacement"
]);

export const MANUAL_PLACEMENT_REQUEST_FIELDS = Object.freeze([
  "type", "schema", "operationId", "workspaceId", "sourceContextId", "sourceWindowId",
  "expectedWorkspaceRevision", "expectedRuntimeAssignmentId", "expectedAssignmentEpoch",
  "transferOperationId", "nextRuntimeAssignmentId", "requestedAt", "moveRequest"
]);

export const MANUAL_PLACEMENT_RESULT_FIELDS = Object.freeze([
  "schema", "status", "reason", "decision", "phase", "operationId", "workspaceId",
  "sourceContextId", "sourceWindowId", "targetWindowId", "requestFingerprint",
  "workspaceRevisionBefore", "workspaceRevisionAfter", "previousRuntimeAssignmentId",
  "previousAssignmentEpoch", "currentRuntimeAssignmentId", "currentAssignmentEpoch",
  "browserMutationStarted", "browserMutationVerified", "assignmentTransferred",
  "assignmentVerified", "workspacePlacementWritten", "workspacePlacementVerified",
  "timelineEvidenceWritten", "timelineEvidenceVerified", "timelineEventId",
  "moveResult", "activationResult", "replayed", "retrySafe", "indeterminate", "warnings", "errors"
]);

const MANUAL_MOVE_RESULT_FIELDS = Object.freeze([
  "schema", "status", "reason", "operationId", "workspaceId", "mode", "targetWindowId",
  "createdWindow", "browserMutationStarted", "browserMutationVerified", "movedTabIds",
  "alreadyInTargetTabIds", "unassignedTabIds", "createdGroups", "verification",
  "retrySafe", "warnings", "errors"
]);

const MANUAL_MOVE_CREATED_GROUP_FIELDS = Object.freeze([
  "groupId", "windowId", "role", "roleLabel", "workspaceTabIds", "tabIds",
  "title", "colour", "collapsed"
]);

const MANUAL_MOVE_VERIFICATION_CHECK_IDS = Object.freeze([
  "target_window_exists", "created_window_was_not_present_before",
  "exactly_one_destination_window_created", "no_additional_window_created",
  "all_planned_tabs_exist", "all_planned_tabs_are_in_target", "no_unrelated_tab_moved",
  "no_planned_tab_duplicated", "assigned_group_count_matches_plan",
  "assigned_group_membership_matches_plan", "unassigned_tabs_are_ungrouped",
  "group_titles_match_semantic_plan", "represented_group_colour_matches",
  "represented_group_collapsed_state_matches", "target_window_focused",
  "final_projection_is_serializable"
]);

export function snapshotAndValidateManualPlacementRequest(input) {
  const snapshot = snapshotSerializable(input);
  if (!snapshot.ok) return { ok: false, reason: "invalid_manual_placement_request", errors: [snapshot.reason] };
  const request = snapshot.value;
  const errors = [];
  if (!plain(request) || !exactFields(request, MANUAL_PLACEMENT_REQUEST_FIELDS)) errors.push("request_fields_invalid");
  if (request.type !== MANUAL_PLACEMENT_TYPE || request.schema !== MANUAL_PLACEMENT_REQUEST_SCHEMA) errors.push("request_identity_invalid");
  for (const field of ["operationId", "workspaceId", "sourceContextId", "expectedRuntimeAssignmentId", "transferOperationId", "nextRuntimeAssignmentId"]) if (!nonEmptyString(request[field])) errors.push(field + "_invalid");
  for (const field of ["sourceWindowId", "expectedWorkspaceRevision"]) if (!safeId(request[field])) errors.push(field + "_invalid");
  if (!positive(request.expectedAssignmentEpoch) || !validDateTime(request.requestedAt)) errors.push("expected_assignment_or_time_invalid");
  const move = snapshotAndValidateMoveRequest(request.moveRequest);
  if (!move.ok || request.moveRequest.workspaceId !== request.workspaceId || request.moveRequest.mode !== "create_dedicated_window" || request.moveRequest.targetWindowId !== null || request.moveRequest.requestedAt !== request.requestedAt) errors.push("move_request_invalid");
  return errors.length ? { ok: false, reason: "invalid_manual_placement_request", errors: [...new Set(errors)].sort(), value: request } : { ok: true, value: request };
}

export function createManualPlacementResult(identities, fields = {}) {
  return {
    schema: MANUAL_PLACEMENT_RESULT_SCHEMA,
    status: fields.status || "failed",
    reason: fields.reason || "manual_placement_failed",
    decision: fields.decision || "retry_transaction",
    phase: fields.phase || "result_serialization",
    operationId: identities.operationId,
    workspaceId: identities.workspaceId,
    sourceContextId: identities.sourceContextId,
    sourceWindowId: identities.sourceWindowId,
    targetWindowId: Number.isInteger(fields.targetWindowId) ? fields.targetWindowId : null,
    requestFingerprint: typeof fields.requestFingerprint === "string" ? fields.requestFingerprint : "",
    workspaceRevisionBefore: Number.isInteger(identities.expectedWorkspaceRevision) ? identities.expectedWorkspaceRevision : null,
    workspaceRevisionAfter: Number.isInteger(fields.workspaceRevisionAfter) ? fields.workspaceRevisionAfter : null,
    previousRuntimeAssignmentId: identities.expectedRuntimeAssignmentId,
    previousAssignmentEpoch: Number.isInteger(identities.expectedAssignmentEpoch) ? identities.expectedAssignmentEpoch : null,
    currentRuntimeAssignmentId: typeof fields.currentRuntimeAssignmentId === "string" ? fields.currentRuntimeAssignmentId : "",
    currentAssignmentEpoch: Number.isInteger(fields.currentAssignmentEpoch) ? fields.currentAssignmentEpoch : null,
    browserMutationStarted: fields.browserMutationStarted === true,
    browserMutationVerified: fields.browserMutationVerified === true,
    assignmentTransferred: fields.assignmentTransferred === true,
    assignmentVerified: fields.assignmentVerified === true,
    workspacePlacementWritten: fields.workspacePlacementWritten === true,
    workspacePlacementVerified: fields.workspacePlacementVerified === true,
    timelineEvidenceWritten: fields.timelineEvidenceWritten === true,
    timelineEvidenceVerified: fields.timelineEvidenceVerified === true,
    timelineEventId: typeof fields.timelineEventId === "string" ? fields.timelineEventId : "",
    moveResult: fields.moveResult ? structuredClone(fields.moveResult) : null,
    activationResult: fields.activationResult ? structuredClone(fields.activationResult) : null,
    replayed: fields.replayed === true,
    retrySafe: fields.retrySafe === true,
    indeterminate: fields.indeterminate === true,
    warnings: Array.isArray(fields.warnings) ? fields.warnings.filter((item) => typeof item === "string") : [],
    errors: Array.isArray(fields.errors) ? fields.errors.filter((item) => typeof item === "string") : []
  };
}

export function validateManualPlacementResult(value, expected = {}) {
  try {
    const snapshot = snapshotSerializable(value);
    if (!snapshot.ok) return false;
    value = snapshot.value;
    if (!plain(value) || !exactFields(value, MANUAL_PLACEMENT_RESULT_FIELDS) || value.schema !== MANUAL_PLACEMENT_RESULT_SCHEMA) return false;
    if (!["committed", "replayed", "conflict", "invalid", "failed", "indeterminate"].includes(value.status) || !["use_dedicated_window", "retry_transaction", "manual_resolution_required", "reject_request"].includes(value.decision)) return false;
    if (!["request_validation", "lock_acquisition", "operation_inspection", "state_reread", "pending_recording", "browser_move", "assignment_transfer", "placement_write", "final_verification", "operation_recording", "result_serialization", "complete"].includes(value.phase)) return false;
    for (const field of ["reason", "operationId", "workspaceId", "sourceContextId"]) if (!nonEmptyString(value[field])) return false;
    for (const field of ["sourceWindowId", "workspaceRevisionBefore"]) if (!safeId(value[field])) return false;
    for (const field of ["targetWindowId", "workspaceRevisionAfter"]) if (!(value[field] === null || safeId(value[field]))) return false;
    for (const field of ["previousAssignmentEpoch", "currentAssignmentEpoch"]) if (!(value[field] === null || positive(value[field]))) return false;
    for (const field of ["browserMutationStarted", "browserMutationVerified", "assignmentTransferred", "assignmentVerified", "workspacePlacementWritten", "workspacePlacementVerified", "timelineEvidenceWritten", "timelineEvidenceVerified", "replayed", "retrySafe", "indeterminate"]) if (typeof value[field] !== "boolean") return false;
    for (const field of ["requestFingerprint", "previousRuntimeAssignmentId", "currentRuntimeAssignmentId", "timelineEventId"]) if (typeof value[field] !== "string") return false;
    if (!stringArray(value.warnings) || !stringArray(value.errors)) return false;
    if (!(value.moveResult === null || plain(value.moveResult)) || !(value.activationResult === null || plain(value.activationResult))) return false;
    if (expected.operationId && value.operationId !== expected.operationId) return false;
    if (nonEmptyString(expected.workspaceId) && value.workspaceId !== expected.workspaceId) return false;
    if (nonEmptyString(expected.sourceContextId) && value.sourceContextId !== expected.sourceContextId) return false;
    if (safeId(expected.sourceWindowId) && value.sourceWindowId !== expected.sourceWindowId) return false;
    if (safeId(expected.expectedWorkspaceRevision) && value.workspaceRevisionBefore !== expected.expectedWorkspaceRevision) return false;
    if (nonEmptyString(expected.expectedRuntimeAssignmentId) && value.previousRuntimeAssignmentId !== expected.expectedRuntimeAssignmentId) return false;
    if (positive(expected.expectedAssignmentEpoch) && value.previousAssignmentEpoch !== expected.expectedAssignmentEpoch) return false;
    if (["committed", "replayed"].includes(value.status)) {
      if (value.phase !== "complete" || value.decision !== "use_dedicated_window" || !value.browserMutationStarted || !value.browserMutationVerified || !value.assignmentTransferred || !value.assignmentVerified || !value.workspacePlacementVerified || !value.timelineEvidenceVerified) return false;
      if (!safeId(value.targetWindowId) || !nonEmptyString(value.currentRuntimeAssignmentId) || !positive(value.currentAssignmentEpoch) || !nonEmptyString(value.requestFingerprint) || !nonEmptyString(value.timelineEventId)) return false;
      if (!validateManualPlacementMoveEvidence(value.moveResult, expected) || !validateManualPlacementActivationEvidence(value.activationResult, expected, value.targetWindowId)) return false;
      if (value.moveResult.targetWindowId !== value.targetWindowId || value.activationResult.targetWindowId !== value.targetWindowId) return false;
      if (value.activationResult.previousRuntimeAssignmentId !== value.previousRuntimeAssignmentId || value.activationResult.previousAssignmentEpoch !== value.previousAssignmentEpoch) return false;
      if (value.activationResult.currentRuntimeAssignmentId !== value.currentRuntimeAssignmentId || value.activationResult.currentAssignmentEpoch !== value.currentAssignmentEpoch) return false;
      if (!safeId(value.workspaceRevisionBefore) || value.workspaceRevisionAfter !== value.workspaceRevisionBefore + 1) return false;
      if (nonEmptyString(expected.nextRuntimeAssignmentId) && value.currentRuntimeAssignmentId !== expected.nextRuntimeAssignmentId) return false;
    }
    if (value.status === "replayed" && !value.replayed) return false;
    if (value.status === "invalid" && value.decision !== "reject_request") return false;
    if (value.status === "conflict" && value.decision !== "manual_resolution_required") return false;
    if (["failed", "indeterminate"].includes(value.status) && value.decision !== "retry_transaction") return false;
    return true;
  } catch { return false; }
}

export function createManualPlacementTransferRequest(request, targetWindowId) {
  return {
    type: RUNTIME_WORKSPACE_ACTIVATION_TYPE,
    schema: RUNTIME_WORKSPACE_ACTIVATION_REQUEST_SCHEMA,
    operationId: request.transferOperationId,
    operation: ACTIVATION_OPERATIONS.transferActive,
    sourceContextId: request.sourceContextId,
    sourceWindowId: request.sourceWindowId,
    expectedWorkspaceId: request.workspaceId,
    expectedWorkspaceRevision: request.expectedWorkspaceRevision,
    candidateWorkspace: null,
    targetWindowId,
    expectedRuntimeAssignmentId: request.expectedRuntimeAssignmentId,
    expectedAssignmentEpoch: request.expectedAssignmentEpoch,
    nextRuntimeAssignmentId: request.nextRuntimeAssignmentId,
    requestedAt: request.requestedAt
  };
}

export function validateManualPlacementMoveEvidence(value, request = null) {
  try {
    const snapshot = snapshotSerializable(value);
    if (!snapshot.ok || !plain(snapshot.value) || !exactFields(snapshot.value, MANUAL_MOVE_RESULT_FIELDS)) return false;
    const result = snapshot.value;
    if (result.schema !== "constellation-workspace-existing-tab-move-result-v0.1" || result.status !== "completed_verified" || !nonEmptyString(result.reason)) return false;
    if (!nonEmptyString(result.operationId) || !nonEmptyString(result.workspaceId) || result.mode !== "create_dedicated_window" || !safeId(result.targetWindowId)) return false;
    if (result.createdWindow !== true || result.browserMutationStarted !== true || result.browserMutationVerified !== true || typeof result.retrySafe !== "boolean") return false;
    for (const field of ["movedTabIds", "alreadyInTargetTabIds", "unassignedTabIds"]) if (!idArray(result[field])) return false;
    if (result.movedTabIds.some((tabId) => result.alreadyInTargetTabIds.includes(tabId)) || !validCreatedGroups(result.createdGroups, result.targetWindowId)) return false;
    if (!validMoveVerification(result) || result.retrySafe !== false || !stringArray(result.warnings) || !stringArray(result.errors) || result.errors.length !== 0) return false;
    if (!request?.moveRequest) return true;
    const moveRequest = request.moveRequest;
    if (result.operationId !== moveRequest.operationId || result.workspaceId !== request.workspaceId || result.mode !== moveRequest.mode || result.targetWindowId === request.sourceWindowId) return false;
    const represented = [...result.movedTabIds, ...result.alreadyInTargetTabIds].sort((left, right) => left - right);
    const requested = moveRequest.tabs.map((tab) => tab.tabId).sort((left, right) => left - right);
    const unassigned = moveRequest.tabs.filter((tab) => tab.role === "unassigned").map((tab) => tab.tabId).sort((left, right) => left - right);
    return stableStringify(represented) === stableStringify(requested) &&
      stableStringify([...result.unassignedTabIds].sort((left, right) => left - right)) === stableStringify(unassigned) &&
      createdGroupsMatchRequest(result, moveRequest);
  } catch { return false; }
}

export function validateManualPlacementActivationEvidence(value, request = null, targetWindowId = null) {
  try {
    if (!plain(value) || !["committed", "no_change", "replayed"].includes(value.status) || value.workspaceVerified !== true || value.assignmentVerified !== true) return false;
    if (!request?.moveRequest) return validateActivationResult(value) && value.targetWindowId === targetWindowId;
    const transferRequest = createManualPlacementTransferRequest(request, targetWindowId);
    return validateActivationResult(value, transferRequest) && value.requestFingerprint === createActivationRequestFingerprint(transferRequest) && value.targetWindowId === targetWindowId;
  } catch { return false; }
}

export function normalizeManualPlacementIdentities(input) {
  return {
    operationId: safeString(input, "operationId"), workspaceId: safeString(input, "workspaceId"), sourceContextId: safeString(input, "sourceContextId"),
    sourceWindowId: safeInteger(input, "sourceWindowId"), expectedWorkspaceRevision: safeInteger(input, "expectedWorkspaceRevision"),
    expectedRuntimeAssignmentId: safeString(input, "expectedRuntimeAssignmentId"), expectedAssignmentEpoch: safeInteger(input, "expectedAssignmentEpoch")
  };
}

export function createManualPlacementPending(request, fingerprint, patch = {}) {
  return {
    schema: MANUAL_PLACEMENT_PENDING_SCHEMA,
    operationId: request.operationId,
    requestFingerprint: fingerprint,
    workspaceId: request.workspaceId,
    sourceContextId: request.sourceContextId,
    sourceWindowId: request.sourceWindowId,
    expectedWorkspaceRevision: request.expectedWorkspaceRevision,
    expectedRuntimeAssignmentId: request.expectedRuntimeAssignmentId,
    expectedAssignmentEpoch: request.expectedAssignmentEpoch,
    transferOperationId: request.transferOperationId,
    nextRuntimeAssignmentId: request.nextRuntimeAssignmentId,
    requestedAt: request.requestedAt,
    baselineSourceWindowIds: Array.isArray(patch.baselineSourceWindowIds) ? [...patch.baselineSourceWindowIds] : [],
    browserMutationStarted: patch.browserMutationStarted === true,
    targetWindowId: Number.isInteger(patch.targetWindowId) ? patch.targetWindowId : null,
    moveResult: patch.moveResult ? structuredClone(patch.moveResult) : null,
    activationResult: patch.activationResult ? structuredClone(patch.activationResult) : null
  };
}

export function validateManualPlacementPending(value, request, fingerprint) {
  const snapshot = snapshotSerializable(value);
  if (!snapshot.ok || !plain(snapshot.value)) return false;
  const pending = snapshot.value;
  const fields = ["schema", "operationId", "requestFingerprint", "workspaceId", "sourceContextId", "sourceWindowId", "expectedWorkspaceRevision", "expectedRuntimeAssignmentId", "expectedAssignmentEpoch", "transferOperationId", "nextRuntimeAssignmentId", "requestedAt", "baselineSourceWindowIds", "browserMutationStarted", "targetWindowId", "moveResult", "activationResult"];
  return exactFields(pending, fields) && pending.schema === MANUAL_PLACEMENT_PENDING_SCHEMA && pending.operationId === request.operationId && pending.requestFingerprint === fingerprint && pending.workspaceId === request.workspaceId && pending.sourceContextId === request.sourceContextId && pending.sourceWindowId === request.sourceWindowId && pending.expectedWorkspaceRevision === request.expectedWorkspaceRevision && pending.expectedRuntimeAssignmentId === request.expectedRuntimeAssignmentId && pending.expectedAssignmentEpoch === request.expectedAssignmentEpoch && pending.transferOperationId === request.transferOperationId && pending.nextRuntimeAssignmentId === request.nextRuntimeAssignmentId && pending.requestedAt === request.requestedAt && Array.isArray(pending.baselineSourceWindowIds) && pending.baselineSourceWindowIds.every(safeId) && new Set(pending.baselineSourceWindowIds).size === pending.baselineSourceWindowIds.length && pending.baselineSourceWindowIds.every((windowId, index) => index === 0 || pending.baselineSourceWindowIds[index - 1] < windowId) && typeof pending.browserMutationStarted === "boolean" && (pending.targetWindowId === null || safeId(pending.targetWindowId));
}

export function readManualPlacementAdapters(input) {
  try { if (!plain(input) || !exactFields(input, MANUAL_PLACEMENT_ADAPTER_FIELDS)) return null; const output = {}; for (const field of MANUAL_PLACEMENT_ADAPTER_FIELDS) { if (typeof input[field] !== "function") return null; output[field] = input[field]; } return output; }
  catch { return null; }
}

function exactFields(value, fields) { try { return stableStringify(Object.keys(value).sort()) === stableStringify([...fields].sort()); } catch { return false; } }
function plain(value) { try { const prototype = Object.getPrototypeOf(value); return value !== null && typeof value === "object" && !Array.isArray(value) && (prototype === Object.prototype || prototype === null); } catch { return false; } }
function safeId(value) { return Number.isSafeInteger(value) && value >= 0; }
function positive(value) { return Number.isSafeInteger(value) && value > 0; }
function idArray(value) { return Array.isArray(value) && value.every(safeId) && new Set(value).size === value.length; }
function stringArray(value) { return Array.isArray(value) && value.every((item) => typeof item === "string"); }
function textArray(value) { return Array.isArray(value) && value.every(nonEmptyString) && new Set(value).size === value.length; }
function validCreatedGroups(groups, targetWindowId) {
  return Array.isArray(groups) && groups.every((group) => plain(group) && exactFields(group, MANUAL_MOVE_CREATED_GROUP_FIELDS) &&
    safeId(group.groupId) && group.windowId === targetWindowId && nonEmptyString(group.role) && group.role !== "unassigned" &&
    nonEmptyString(group.roleLabel) && textArray(group.workspaceTabIds) && idArray(group.tabIds) && nonEmptyString(group.title) &&
    typeof group.colour === "string" && typeof group.collapsed === "boolean") &&
    new Set(groups.map((group) => group.groupId)).size === groups.length &&
    new Set(groups.map((group) => group.role)).size === groups.length;
}
function validMoveVerification(result) {
  return Array.isArray(result.verification) && result.verification.length === MANUAL_MOVE_VERIFICATION_CHECK_IDS.length &&
    result.verification.every((check, index) => plain(check) && exactFields(check, ["id", "passed"]) &&
      check.id === MANUAL_MOVE_VERIFICATION_CHECK_IDS[index] && check.passed === true);
}
function createdGroupsMatchRequest(result, moveRequest) {
  if (result.createdGroups.length !== moveRequest.groups.length) return false;
  return moveRequest.groups.every((plan) => {
    const matches = result.createdGroups.filter((group) => group.role === plan.role && group.roleLabel === plan.roleLabel);
    if (matches.length !== 1) return false;
    const group = matches[0];
    const expectedTabIds = moveRequest.tabs.filter((tab) => plan.workspaceTabIds.includes(tab.workspaceTabId)).map((tab) => tab.tabId).sort((left, right) => left - right);
    return group.title === plan.roleLabel &&
      stableStringify([...group.workspaceTabIds].sort()) === stableStringify([...plan.workspaceTabIds].sort()) &&
      stableStringify([...group.tabIds].sort((left, right) => left - right)) === stableStringify(expectedTabIds) &&
      (!Object.hasOwn(plan, "colour") || group.colour === plan.colour) &&
      (!Object.hasOwn(plan, "collapsed") || group.collapsed === plan.collapsed);
  });
}
function safeString(value, key) { try { return typeof value?.[key] === "string" ? value[key] : ""; } catch { return ""; } }
function safeInteger(value, key) { try { return safeId(value?.[key]) ? value[key] : null; } catch { return null; } }
