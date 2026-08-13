import { isPlainObject, nonEmptyString, serializableErrors, validDateTime } from "../runtime-contract/value-utils.js";
import { isValidRuntimeWorkspaceId } from "../runtime-workspace-record/contract.js";
import {
  RUNTIME_WORKSPACE_MUTATION_RESULT_SCHEMA,
  validateRuntimeWorkspaceMutationResult
} from "../runtime-workspace-mutation/contract.js";
export const JOURNAL_APPEND_REQUEST_SCHEMA = "constellation-journal-append-request-v0.1";
export const JOURNAL_APPEND_RESPONSE_SCHEMA = "constellation-journal-append-response-v0.1";
export const JOURNAL_APPEND_ASSIGNED_REQUEST_SCHEMA = "constellation-journal-append-request-v0.2";
export const JOURNAL_APPEND_ASSIGNED_RESPONSE_SCHEMA = "constellation-journal-append-response-v0.2";
const RESPONSE_FIELDS=["schema","operationId","entryId","workspaceId","status","previousRevision","committedRevision","workspaceCommitted","workspaceVerified","ledgerRecorded","retrySafe","reason","errors"];
const RESPONSE_STATUSES=["committed","no_change","replayed","workspace_conflict","operation_id_conflict","rejected","failed"];
const FIELDS = ["schema", "operationId", "contextId", "workspaceId", "requestedAt", "entry"];
const ENTRY_FIELDS = ["entryId", "text", "tag", "relatedRoleId", "relatedRoleLabel", "createdAt"];
const ASSIGNED_REQUEST_FIELDS = ["schema", "operationId", "runtimeSessionId", "sourceContextId", "sourceWindowId", "workspaceId", "expectedWorkspaceRevision", "runtimeAssignmentId", "assignmentEpoch", "requestedAt", "entry"];
const ASSIGNED_RESPONSE_FIELDS = ["schema", "status", "reason", "operationId", "runtimeSessionId", "sourceContextId", "sourceWindowId", "workspaceId", "runtimeAssignmentId", "assignmentEpoch", "entryId", "previousRevision", "committedRevision", "recordFingerprint", "phase", "mutationCommitted", "authorityVerified", "workspaceVerified", "ledgerRecorded", "retrySafe", "indeterminate", "warnings", "errors"];
export function validateJournalAppendRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ["request must be a plain object"] };
  if (request.schema !== JOURNAL_APPEND_REQUEST_SCHEMA) errors.push("schema must match journal append request schema");
  for (const field of ["operationId", "contextId", "workspaceId"]) if (!nonEmptyString(request[field])) errors.push(field + " must be a non-empty string");
  if (!validDateTime(request.requestedAt)) errors.push("requestedAt must be a valid date-time string");
  if (!isPlainObject(request.entry)) errors.push("entry must be a plain object"); else {
    if (!nonEmptyString(request.entry.entryId)) errors.push("entry.entryId must be a non-empty string");
    if (!nonEmptyString(request.entry.text)) errors.push("entry.text must be a non-empty string");
    for (const field of ["tag", "relatedRoleId", "relatedRoleLabel"]) if (typeof request.entry[field] !== "string") errors.push("entry." + field + " must be a string");
    if (!validDateTime(request.entry.createdAt)) errors.push("entry.createdAt must be a valid date-time string");
    for (const field of Object.keys(request.entry).sort()) if (!ENTRY_FIELDS.includes(field)) errors.push("unknown entry field: " + field);
    errors.push(...serializableErrors(request.entry, "entry"));
  }
  for (const field of Object.keys(request).sort()) if (!FIELDS.includes(field)) errors.push("unknown request field: " + field);
  return { valid: errors.length === 0, errors };
}
export function response(request, status, fields = {}) { const safe = (v) => typeof v === "string" ? v : ""; const revision = (v) => Number.isInteger(v) && v >= 0 ? v : null; return { schema: JOURNAL_APPEND_RESPONSE_SCHEMA, operationId: safe(request?.operationId), entryId: safe(request?.entry?.entryId), workspaceId: safe(request?.workspaceId), status: safe(status) || "failed", previousRevision: revision(fields.previousRevision), committedRevision: revision(fields.committedRevision), workspaceCommitted: fields.workspaceCommitted === true, workspaceVerified: fields.workspaceVerified === true, ledgerRecorded: fields.ledgerRecorded === true, retrySafe: fields.retrySafe === true, reason: typeof fields.reason === "string" ? fields.reason : null, errors: Array.isArray(fields.errors) ? fields.errors.map(String) : [] }; }
export function validateJournalAppendResponse(value,expected){const errors=[];if(!isPlainObject(value))return{valid:false,errors:["response must be a plain object"]};errors.push(...serializableErrors(value,"response"));if(value.schema!==JOURNAL_APPEND_RESPONSE_SCHEMA)errors.push("response schema invalid");for(const key of RESPONSE_FIELDS)if(!Object.hasOwn(value,key))errors.push("missing response field: "+key);for(const key of Object.keys(value).sort())if(!RESPONSE_FIELDS.includes(key))errors.push("unknown response field: "+key);if(!RESPONSE_STATUSES.includes(value.status))errors.push("response status invalid");if(value.operationId!==expected?.operationId)errors.push("operationId mismatch");if(value.entryId!==expected?.entry?.entryId)errors.push("entryId mismatch");if(value.workspaceId!==expected?.workspaceId)errors.push("workspaceId mismatch");for(const key of["previousRevision","committedRevision"])if(value[key]!==null&&(!Number.isInteger(value[key])||value[key]<0))errors.push(key+" invalid");for(const key of["workspaceCommitted","workspaceVerified","ledgerRecorded","retrySafe"])if(typeof value[key]!=="boolean")errors.push(key+" must be boolean");if(value.reason!==null&&typeof value.reason!=="string")errors.push("reason invalid");if(!Array.isArray(value.errors)||value.errors.some(x=>typeof x!=="string"))errors.push("errors invalid");return{valid:errors.length===0,errors}}

export function validateAssignedJournalAppendRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ["assigned journal request must be a plain object"] };
  errors.push(...serializableErrors(request, "assignedJournalRequest"));
  if (request.schema !== JOURNAL_APPEND_ASSIGNED_REQUEST_SCHEMA) errors.push("schema must match assigned journal append request schema");
  for (const field of ["operationId", "runtimeSessionId", "sourceContextId", "runtimeAssignmentId"]) if (!nonEmptyString(request[field])) errors.push(field + " must be a non-empty string");
  if (!Number.isSafeInteger(request.sourceWindowId) || request.sourceWindowId < 0) errors.push("sourceWindowId must be a non-negative safe integer");
  if (!isValidRuntimeWorkspaceId(request.workspaceId)) errors.push("workspaceId must be a valid runtime workspace id");
  if (!Number.isSafeInteger(request.expectedWorkspaceRevision) || request.expectedWorkspaceRevision < 0) errors.push("expectedWorkspaceRevision must be a non-negative safe integer");
  if (!Number.isSafeInteger(request.assignmentEpoch) || request.assignmentEpoch <= 0) errors.push("assignmentEpoch must be a positive safe integer");
  if (!validDateTime(request.requestedAt)) errors.push("requestedAt must be a valid date-time string");
  validateAssignedEntry(request.entry, errors);
  for (const field of Object.keys(request).sort()) if (!ASSIGNED_REQUEST_FIELDS.includes(field)) errors.push("unknown assigned request field: " + field);
  return { valid: errors.length === 0, errors };
}

export function assignedResponse(request, fields = {}) {
  const safeString = (value) => typeof value === "string" ? value : "";
  const safeRevision = (value) => Number.isInteger(value) && value >= 0 ? value : null;
  const safeWindow = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const safePositiveInteger = (value) => Number.isSafeInteger(value) && value > 0 ? value : null;
  return {
    schema: JOURNAL_APPEND_ASSIGNED_RESPONSE_SCHEMA,
    status: safeString(fields.status) || "failed",
    reason: safeString(fields.reason),
    operationId: safeString(request?.operationId),
    runtimeSessionId: safeString(request?.runtimeSessionId),
    sourceContextId: safeString(request?.sourceContextId),
    sourceWindowId: safeWindow(request?.sourceWindowId),
    workspaceId: safeString(request?.workspaceId),
    runtimeAssignmentId: safeString(request?.runtimeAssignmentId),
    assignmentEpoch: safePositiveInteger(request?.assignmentEpoch),
    entryId: safeString(request?.entry?.entryId),
    previousRevision: safeRevision(fields.previousRevision),
    committedRevision: safeRevision(fields.committedRevision),
    recordFingerprint: safeString(fields.recordFingerprint),
    phase: safeString(fields.phase) || "journal_coordination",
    mutationCommitted: fields.mutationCommitted === true,
    authorityVerified: fields.authorityVerified === true,
    workspaceVerified: fields.workspaceVerified === true,
    ledgerRecorded: fields.ledgerRecorded === true,
    retrySafe: fields.retrySafe === true,
    indeterminate: fields.indeterminate === true,
    warnings: Array.isArray(fields.warnings) ? fields.warnings.map(String) : [],
    errors: Array.isArray(fields.errors) ? fields.errors.map(String) : []
  };
}

export function validateAssignedJournalAppendResponse(value, expected) {
  const errors = [];
  if (!isPlainObject(value)) return { valid: false, errors: ["assigned journal response must be a plain object"] };
  errors.push(...serializableErrors(value, "assignedJournalResponse"));
  if (value.schema !== JOURNAL_APPEND_ASSIGNED_RESPONSE_SCHEMA) errors.push("assigned response schema invalid");
  for (const field of ASSIGNED_RESPONSE_FIELDS) if (!Object.hasOwn(value, field)) errors.push("missing assigned response field: " + field);
  for (const field of Object.keys(value).sort()) if (!ASSIGNED_RESPONSE_FIELDS.includes(field)) errors.push("unknown assigned response field: " + field);
  const requestValidation = validateAssignedJournalAppendRequest(expected);
  if (!requestValidation.valid) errors.push(...requestValidation.errors.map((error) => "expected request invalid: " + error));
  if (value.entryId !== expected?.entry?.entryId) errors.push("entryId mismatch");
  const mutationResult = {
    schema: RUNTIME_WORKSPACE_MUTATION_RESULT_SCHEMA,
    status: value.status,
    reason: value.reason,
    operationId: value.operationId,
    runtimeSessionId: value.runtimeSessionId,
    sourceContextId: value.sourceContextId,
    sourceWindowId: value.sourceWindowId,
    workspaceId: value.workspaceId,
    runtimeAssignmentId: value.runtimeAssignmentId,
    assignmentEpoch: value.assignmentEpoch,
    previousRevision: value.previousRevision,
    committedRevision: value.committedRevision,
    recordFingerprint: value.recordFingerprint,
    phase: value.phase,
    mutationCommitted: value.mutationCommitted,
    authorityVerified: value.authorityVerified,
    workspaceVerified: value.workspaceVerified,
    ledgerRecorded: value.ledgerRecorded,
    retrySafe: value.retrySafe,
    indeterminate: value.indeterminate,
    warnings: value.warnings,
    errors: value.errors
  };
  const mutationValidation = validateRuntimeWorkspaceMutationResult(mutationResult, expected);
  errors.push(...mutationValidation.errors);
  return { valid: errors.length === 0, errors };
}

function validateAssignedEntry(entry, errors) {
  if (!isPlainObject(entry)) {
    errors.push("entry must be a plain object");
    return;
  }
  if (!nonEmptyString(entry.entryId)) errors.push("entry.entryId must be a non-empty string");
  if (!nonEmptyString(entry.text)) errors.push("entry.text must be a non-empty string");
  for (const field of ["tag", "relatedRoleId", "relatedRoleLabel"]) if (typeof entry[field] !== "string") errors.push("entry." + field + " must be a string");
  if (!validDateTime(entry.createdAt)) errors.push("entry.createdAt must be a valid date-time string");
  for (const field of Object.keys(entry).sort()) if (!ENTRY_FIELDS.includes(field)) errors.push("unknown entry field: " + field);
  errors.push(...serializableErrors(entry, "entry"));
}
