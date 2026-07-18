import { isPlainObject, nonEmptyString, serializableErrors, validDateTime } from "../runtime-contract/value-utils.js";
export const JOURNAL_APPEND_REQUEST_SCHEMA = "constellation-journal-append-request-v0.1";
export const JOURNAL_APPEND_RESPONSE_SCHEMA = "constellation-journal-append-response-v0.1";
const RESPONSE_FIELDS=["schema","operationId","entryId","workspaceId","status","previousRevision","committedRevision","workspaceCommitted","workspaceVerified","ledgerRecorded","retrySafe","reason","errors"];
const RESPONSE_STATUSES=["committed","no_change","replayed","workspace_conflict","operation_id_conflict","rejected","failed"];
const FIELDS = ["schema", "operationId", "contextId", "workspaceId", "requestedAt", "entry"];
const ENTRY_FIELDS = ["entryId", "text", "tag", "relatedRoleId", "relatedRoleLabel", "createdAt"];
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
