import { SCHEMAS } from "../runtime-contract/constants.js";
import { isPlainObject, nonEmptyString, serializableErrors, validDateTime } from "../runtime-contract/value-utils.js";

export const RECONCILIATION_REQUEST_SCHEMA = SCHEMAS.projectionReconciliation;
export const RECONCILIATION_RESULT_SCHEMA = SCHEMAS.projectionReconciliationResult;
export const PROJECTION_RECONCILIATION_HOLD_KEY = "constellationWorkspaceProjectionReconciliationHold";
export const PROJECTION_RECONCILIATION_HOLD_SCHEMA = "constellation-workspace-projection-reconciliation-hold-v0.1";
const REQUEST_FIELDS = ["schema", "operationId", "contextId", "workspaceId", "requestedAt", "payload"];
const RESULT_FIELDS = ["schema", "operationId", "workspaceId", "status", "reason", "previousRevision", "committedRevision", "workspaceCommitted", "workspaceVerified", "ledgerRecorded", "retrySafe", "phase", "authorityPhase", "recordsExamined", "recordsChanged", "transitionCount", "triggers", "diagnosticRecorded", "notificationSent", "warnings", "errors"];
const HOLD_FIELDS = ["schema", "operationId", "workspaceIds", "sourceWindowId", "startedAt", "expiresAt"];
const STATUSES = ["committed", "no_change", "workspace_conflict", "revision_conflict", "assignment_conflict", "rejected", "failed"];

export function validateReconciliationRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ["request must be a plain object"] };
  errors.push(...serializableErrors(request, "request"));
  if (!hasExactFields(request, REQUEST_FIELDS)) errors.push("request fields must match the reconciliation request contract");
  if (request.schema !== RECONCILIATION_REQUEST_SCHEMA) errors.push("schema must match reconciliation request schema");
  for (const field of ["operationId", "contextId", "workspaceId"]) if (!nonEmptyString(request[field])) errors.push(field + " must be a non-empty string");
  if (!validDateTime(request.requestedAt)) errors.push("requestedAt must be a valid date-time string");
  validatePayload(request.payload, request, errors);
  return { valid: errors.length === 0, errors };
}

export function snapshotAndValidateProjectionReconciliationHold(input) {
  let value;
  try { value = structuredClone(input); }
  catch { return { valid: false, errors: ["hold must be serializable"], value: null }; }
  const errors = [];
  if (!isPlainObject(value)) return { valid: false, errors: ["hold must be a plain object"], value: null };
  errors.push(...serializableErrors(value, "hold"));
  if (!hasExactFields(value, HOLD_FIELDS)) errors.push("hold fields must match the reconciliation hold contract");
  if (value.schema !== PROJECTION_RECONCILIATION_HOLD_SCHEMA) errors.push("hold schema is invalid");
  if (!nonEmptyString(value.operationId)) errors.push("hold operationId must be a non-empty string");
  if (!uniqueNonEmptyStrings(value.workspaceIds)) errors.push("hold workspaceIds must be unique non-empty strings");
  if (!(value.sourceWindowId === null || (Number.isSafeInteger(value.sourceWindowId) && value.sourceWindowId >= 0))) errors.push("hold sourceWindowId must be null or a non-negative safe integer");
  if (!validDateTime(value.startedAt)) errors.push("hold startedAt must be a valid date-time string");
  if (!validDateTime(value.expiresAt)) errors.push("hold expiresAt must be a valid date-time string");
  if (validDateTime(value.startedAt) && validDateTime(value.expiresAt) && Date.parse(value.expiresAt) <= Date.parse(value.startedAt)) errors.push("hold expiresAt must be later than startedAt");
  return { valid: errors.length === 0, errors, value: errors.length === 0 ? value : null };
}

function validatePayload(payload, request, errors) {
  if (!isPlainObject(payload)) { errors.push("payload must be a plain object"); return; }
  if (!hasExactFields(payload, ["schema", "operationId", "snapshot", "patches", "triggers", "reconciledAt"])) errors.push("payload fields must match reconciliation mutation payload");
  if (payload.schema !== RECONCILIATION_REQUEST_SCHEMA) errors.push("payload schema is invalid");
  if (payload.operationId !== request.operationId) errors.push("payload operationId mismatch");
  if (!validDateTime(payload.reconciledAt)) errors.push("reconciledAt must be a valid date-time string");
  if (!isPlainObject(payload.snapshot) || !hasExactFields(payload.snapshot, ["workspaceId", "observedWorkspaceRevision", "capturedAt", "workspaceTabIds"])) errors.push("snapshot fields are invalid");
  else {
    if (payload.snapshot.workspaceId !== request.workspaceId) errors.push("snapshot workspaceId mismatch");
    if (!Number.isInteger(payload.snapshot.observedWorkspaceRevision) || payload.snapshot.observedWorkspaceRevision < 0) errors.push("observedWorkspaceRevision must be non-negative");
    if (!validDateTime(payload.snapshot.capturedAt)) errors.push("capturedAt must be a valid date-time string");
    if (!uniqueStrings(payload.snapshot.workspaceTabIds)) errors.push("workspaceTabIds must be unique non-empty strings");
  }
  if (!uniqueSortedStrings(payload.triggers)) errors.push("triggers must be sorted unique non-empty strings");
  if (!Array.isArray(payload.patches)) errors.push("patches must be an array");
  else {
    const patchIds = payload.patches.map((patch) => patch?.workspaceTabId);
    if (!uniqueSortedStrings(patchIds)) errors.push("patches must have sorted unique workspaceTabIds");
    if (Array.isArray(payload.snapshot?.workspaceTabIds) && (patchIds.length !== payload.snapshot.workspaceTabIds.length || patchIds.some((id) => !payload.snapshot.workspaceTabIds.includes(id)))) errors.push("patch set must exactly cover captured membership");
    for (const patch of payload.patches) validatePatch(patch, errors);
  }
}

function validatePatch(patch, errors) {
  if (!isPlainObject(patch) || !hasExactFields(patch, ["workspaceTabId", "observedProjection", "projection", "candidateCount"])) { errors.push("patch fields are invalid"); return; }
  if (!nonEmptyString(patch.workspaceTabId)) errors.push("patch workspaceTabId is invalid");
  if (!Number.isInteger(patch.candidateCount) || patch.candidateCount < 0) errors.push("candidateCount must be non-negative");
  if (!isPlainObject(patch.observedProjection) || !isPlainObject(patch.projection)) errors.push("patch projections must be plain objects");
}

export function createReconciliationResult(request, status, fields = {}) {
  const revision = (value) => Number.isInteger(value) && value >= 0 ? value : null;
  return {
    schema: RECONCILIATION_RESULT_SCHEMA,
    operationId: nonEmptyString(request?.operationId) ? request.operationId : "",
    workspaceId: nonEmptyString(request?.workspaceId) ? request.workspaceId : "",
    status: STATUSES.includes(status) ? status : "failed",
    reason: typeof fields.reason === "string" ? fields.reason : null,
    previousRevision: revision(fields.previousRevision),
    committedRevision: revision(fields.committedRevision),
    workspaceCommitted: fields.workspaceCommitted === true,
    workspaceVerified: fields.workspaceVerified === true,
    ledgerRecorded: false,
    retrySafe: fields.retrySafe === true,
    phase: typeof fields.phase === "string" ? fields.phase : "validation",
    authorityPhase: typeof fields.authorityPhase === "string" ? fields.authorityPhase : "validation",
    recordsExamined: Number.isInteger(fields.recordsExamined) && fields.recordsExamined >= 0 ? fields.recordsExamined : 0,
    recordsChanged: Number.isInteger(fields.recordsChanged) && fields.recordsChanged >= 0 ? fields.recordsChanged : 0,
    transitionCount: Number.isInteger(fields.transitionCount) && fields.transitionCount >= 0 ? fields.transitionCount : 0,
    triggers: Array.isArray(fields.triggers) ? [...fields.triggers] : [],
    diagnosticRecorded: fields.diagnosticRecorded === true,
    notificationSent: fields.notificationSent === true,
    warnings: Array.isArray(fields.warnings) ? fields.warnings.map(String) : [],
    errors: Array.isArray(fields.errors) ? fields.errors.map(String) : []
  };
}

export function validateReconciliationResult(value, request) {
  const errors=[];
  if(!isPlainObject(value))return{valid:false,errors:["result must be a plain object"]};
  errors.push(...serializableErrors(value,"result"));
  if(!hasExactFields(value,RESULT_FIELDS))errors.push("result fields must match result contract");
  if(value.schema!==RECONCILIATION_RESULT_SCHEMA)errors.push("result schema invalid");
  if(value.operationId!==request?.operationId||value.workspaceId!==request?.workspaceId)errors.push("result identity mismatch");
  if(!STATUSES.includes(value.status))errors.push("result status invalid");
  return{valid:errors.length===0,errors};
}

function hasExactFields(value, fields) { if(!isPlainObject(value))return false;const actual=Object.keys(value).sort(),expected=[...fields].sort();return actual.length===expected.length&&actual.every((key,index)=>key===expected[index]); }
function uniqueStrings(values) { return Array.isArray(values)&&values.every(nonEmptyString)&&new Set(values).size===values.length; }
function uniqueNonEmptyStrings(values) { return uniqueStrings(values)&&values.length>0; }
function uniqueSortedStrings(values) { return uniqueStrings(values)&&values.every((value,index)=>index===0||values[index-1].localeCompare(value)<0); }
