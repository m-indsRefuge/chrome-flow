import { isPlainObject, nonEmptyString, serializableErrors, stableStringify, validDateTime } from "../runtime-contract/value-utils.js";
import { WORKSPACE_RESOLUTION_COORDINATION_RESULT_SCHEMA } from "../workspace-resolution-coordination/contract.js";

export const WORKSPACE_CREATION_ASSIGNMENT_REQUEST_SCHEMA = "constellation-workspace-creation-assignment-request-v0.1";
export const WORKSPACE_CREATION_ASSIGNMENT_RESULT_SCHEMA = "constellation-workspace-creation-assignment-result-v0.1";

export const TRANSACTION_STATUSES = Object.freeze({ committed: "committed", replayed: "replayed", redirected: "redirected", conflict: "conflict", invalid: "invalid", failed: "failed", indeterminate: "indeterminate" });
export const TRANSACTION_DECISIONS = Object.freeze({ useCreatedWorkspace: "use_created_workspace", useExistingWorkspace: "use_existing_workspace", retryTransaction: "retry_transaction", manualResolutionRequired: "manual_resolution_required", rejectRequest: "reject_request" });
export const TRANSACTION_PHASES = Object.freeze({ requestValidation: "request_validation", operationInspection: "operation_inspection", lockAcquisition: "lock_acquisition", authorityReread: "authority_reread", resolutionReconfirmation: "resolution_reconfirmation", workspaceRead: "workspace_read", workspaceWrite: "workspace_write", workspaceVerification: "workspace_verification", assignmentTransition: "assignment_transition", assignmentWrite: "assignment_write", assignmentVerification: "assignment_verification", finalTransactionVerification: "final_transaction_verification", operationRecording: "operation_recording", resultSerialization: "result_serialization", complete: "complete" });

export const ADAPTER_FIELDS = Object.freeze(["runExclusiveOperation", "readOperationLedger", "writeOperationLedger", "reconfirmWorkspaceResolution", "readWorkspace", "writeWorkspace", "readRuntimeAuthority", "writeRuntimeAuthority"]);
const REQUEST_FIELDS = Object.freeze(["schema", "operationId", "contextId", "windowId", "workspaceId", "runtimeAssignmentId", "requestedAt", "workspaceRecord", "authorization"]);
const AUTHORIZATION_FIELDS = Object.freeze(["resolutionOperationId", "resolutionResultSchema", "status", "decision", "contextId", "windowId", "operatorAuthorized"]);
export const RESULT_FIELDS = Object.freeze(["schema", "status", "reason", "decision", "phase", "operationId", "contextId", "windowId", "workspaceId", "runtimeAssignmentId", "requestFingerprint", "workspaceCreated", "workspaceVerified", "assignmentCreated", "assignmentVerified", "runtimeSessionId", "authorityRevisionBefore", "authorityRevisionAfter", "assignmentEpoch", "resolvedWorkspaceId", "retrySafe", "indeterminate", "replayed", "warnings", "errors"]);

export function validateTransactionRequest(request) {
  try {
    const errors = [];
    if (!isPlainObject(request)) return ["request_must_be_plain_object"];
    if (!exactFields(request, REQUEST_FIELDS)) errors.push("request_fields_must_match_exact_contract");
    if (request.schema !== WORKSPACE_CREATION_ASSIGNMENT_REQUEST_SCHEMA) errors.push("request_schema_invalid");
    for (const field of ["operationId", "contextId", "workspaceId", "runtimeAssignmentId"]) if (!nonEmptyString(request[field])) errors.push(toSnake(field) + "_invalid");
    if (!Number.isInteger(request.windowId) || request.windowId < 0) errors.push("window_id_invalid");
    if (!validDateTime(request.requestedAt)) errors.push("requested_at_invalid");
    if (!isPlainObject(request.workspaceRecord) || serializableErrors(request.workspaceRecord, "workspaceRecord").length) errors.push("workspace_record_invalid");
    else if (request.workspaceRecord.workspaceId !== request.workspaceId) errors.push("workspace_record_identity_mismatch");
    if (!isPlainObject(request.authorization) || !exactFields(request.authorization, AUTHORIZATION_FIELDS)) errors.push("authorization_invalid");
    else {
      const authorization = request.authorization;
      if (!nonEmptyString(authorization.resolutionOperationId)) errors.push("resolution_operation_id_invalid");
      if (authorization.resolutionResultSchema !== WORKSPACE_RESOLUTION_COORDINATION_RESULT_SCHEMA) errors.push("resolution_result_schema_invalid");
      if (authorization.status !== "creation_required" || authorization.decision !== "create_workspace_and_assign") errors.push("authorization_decision_invalid");
      if (authorization.contextId !== request.contextId || authorization.windowId !== request.windowId) errors.push("authorization_identity_mismatch");
      if (authorization.operatorAuthorized !== true) errors.push("operator_authorization_required");
    }
    errors.push(...serializableErrors(request, "request"));
    return uniqueSorted(errors);
  } catch { return ["request_validation_failed"]; }
}

export function snapshotTransactionRequest(request) {
  try { return { valid: true, request: structuredClone(request) }; }
  catch { return { valid: false, request: null }; }
}

export function validateTransactionResult(value) {
  try {
    if (!isPlainObject(value) || !exactFields(value, RESULT_FIELDS) || serializableErrors(value, "result").length) return false;
    if (value.schema !== WORKSPACE_CREATION_ASSIGNMENT_RESULT_SCHEMA) return false;
    if (!Object.values(TRANSACTION_STATUSES).includes(value.status) || !Object.values(TRANSACTION_DECISIONS).includes(value.decision) || !Object.values(TRANSACTION_PHASES).includes(value.phase)) return false;
    if (!nonEmptyString(value.reason) || typeof value.requestFingerprint !== "string") return false;
    for (const field of ["operationId", "contextId", "workspaceId", "runtimeAssignmentId", "runtimeSessionId"]) if (typeof value[field] !== "string") return false;
    if (!(value.windowId === null || (Number.isInteger(value.windowId) && value.windowId >= 0))) return false;
    for (const field of ["authorityRevisionBefore", "authorityRevisionAfter"]) if (!(value[field] === null || (Number.isInteger(value[field]) && value[field] >= 0))) return false;
    if (!(value.assignmentEpoch === null || (Number.isInteger(value.assignmentEpoch) && value.assignmentEpoch > 0))) return false;
    if (!(value.resolvedWorkspaceId === null || nonEmptyString(value.resolvedWorkspaceId))) return false;
    for (const field of ["workspaceCreated", "workspaceVerified", "assignmentCreated", "assignmentVerified", "retrySafe", "indeterminate", "replayed"]) if (typeof value[field] !== "boolean") return false;
    if (!Array.isArray(value.warnings) || !value.warnings.every((item) => typeof item === "string") || !Array.isArray(value.errors) || !value.errors.every((item) => typeof item === "string")) return false;
    if (value.status === TRANSACTION_STATUSES.committed && (value.decision !== TRANSACTION_DECISIONS.useCreatedWorkspace || value.phase !== TRANSACTION_PHASES.complete || !value.workspaceVerified || !value.assignmentVerified || value.replayed)) return false;
    if (value.status === TRANSACTION_STATUSES.replayed && (value.decision !== TRANSACTION_DECISIONS.useCreatedWorkspace || value.phase !== TRANSACTION_PHASES.complete || !value.workspaceVerified || !value.assignmentVerified || !value.replayed)) return false;
    if (value.status === TRANSACTION_STATUSES.redirected && (value.decision !== TRANSACTION_DECISIONS.useExistingWorkspace || value.phase !== TRANSACTION_PHASES.complete || !nonEmptyString(value.resolvedWorkspaceId))) return false;
    if (value.status === TRANSACTION_STATUSES.conflict && value.decision !== TRANSACTION_DECISIONS.manualResolutionRequired) return false;
    if (value.status === TRANSACTION_STATUSES.invalid && value.decision !== TRANSACTION_DECISIONS.rejectRequest) return false;
    if ([TRANSACTION_STATUSES.failed, TRANSACTION_STATUSES.indeterminate].includes(value.status) && value.decision !== TRANSACTION_DECISIONS.retryTransaction) return false;
    if (value.status === TRANSACTION_STATUSES.indeterminate && !value.indeterminate) return false;
    return true;
  } catch { return false; }
}

export function normalizeTransactionIdentities(request) {
  return { operationId: safeString(request, "operationId"), contextId: safeString(request, "contextId"), windowId: safeWindow(request, "windowId"), workspaceId: safeString(request, "workspaceId"), runtimeAssignmentId: safeString(request, "runtimeAssignmentId") };
}

export function readAdapterFunctions(adapters) {
  try {
    if (!isPlainObject(adapters) || !exactFields(adapters, ADAPTER_FIELDS)) return { valid: false, functions: null };
    const functions = {};
    for (const field of ADAPTER_FIELDS) { const value = adapters[field]; if (typeof value !== "function") return { valid: false, functions: null }; functions[field] = value; }
    return { valid: true, functions };
  } catch { return { valid: false, functions: null }; }
}

export function createTransactionResult(identities, fields = {}) {
  return {
    schema: WORKSPACE_CREATION_ASSIGNMENT_RESULT_SCHEMA,
    status: fields.status || TRANSACTION_STATUSES.failed,
    reason: fields.reason || "transaction_failed",
    decision: fields.decision || TRANSACTION_DECISIONS.retryTransaction,
    phase: fields.phase || TRANSACTION_PHASES.resultSerialization,
    operationId: identities.operationId,
    contextId: identities.contextId,
    windowId: identities.windowId,
    workspaceId: identities.workspaceId,
    runtimeAssignmentId: identities.runtimeAssignmentId,
    requestFingerprint: fields.requestFingerprint || "",
    workspaceCreated: fields.workspaceCreated === true,
    workspaceVerified: fields.workspaceVerified === true,
    assignmentCreated: fields.assignmentCreated === true,
    assignmentVerified: fields.assignmentVerified === true,
    runtimeSessionId: typeof fields.runtimeSessionId === "string" ? fields.runtimeSessionId : "",
    authorityRevisionBefore: Number.isInteger(fields.authorityRevisionBefore) ? fields.authorityRevisionBefore : null,
    authorityRevisionAfter: Number.isInteger(fields.authorityRevisionAfter) ? fields.authorityRevisionAfter : null,
    assignmentEpoch: Number.isInteger(fields.assignmentEpoch) ? fields.assignmentEpoch : null,
    resolvedWorkspaceId: typeof fields.resolvedWorkspaceId === "string" && fields.resolvedWorkspaceId ? fields.resolvedWorkspaceId : null,
    retrySafe: fields.retrySafe === true,
    indeterminate: fields.indeterminate === true,
    replayed: fields.replayed === true,
    warnings: Array.isArray(fields.warnings) ? fields.warnings : [],
    errors: Array.isArray(fields.errors) ? fields.errors : []
  };
}

function exactFields(value, fields) { return stableStringify(Object.keys(value).sort(compareStrings)) === stableStringify([...fields].sort(compareStrings)); }
function safeString(value, key) { try { return typeof value?.[key] === "string" ? value[key] : ""; } catch { return ""; } }
function safeWindow(value, key) { try { return Number.isInteger(value?.[key]) && value[key] >= 0 ? value[key] : null; } catch { return null; } }
function compareStrings(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function uniqueSorted(values) { return [...new Set(values)].sort(compareStrings); }
function toSnake(value) { return value.replace(/[A-Z]/g, (letter) => "_" + letter.toLowerCase()); }
