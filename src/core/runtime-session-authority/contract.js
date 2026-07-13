import { SCHEMAS } from "../runtime-contract/constants.js";
import { createAssignmentRegistry, resolveAssignmentByWindow, validateAssignmentRegistry } from "../runtime-contract/assignments.js";
import { clone, isPlainObject, nonEmptyString, serializableErrors, stableStringify, validDateTime } from "../runtime-contract/value-utils.js";

export const RUNTIME_SESSION_AUTHORITY_KEY = "constellationRuntimeSessionAuthority";
export const CONTEXT_REGISTER_TYPE = "constellation-runtime-context-register";
export const CONTEXT_REGISTER_REQUEST_SCHEMA = "constellation-runtime-context-register-request-v0.1";
export const CONTEXT_REGISTER_RESULT_SCHEMA = "constellation-runtime-context-register-result-v0.1";
export const CONTEXT_REGISTER_REQUEST_FIELDS = Object.freeze(["type", "schema", "operationId", "contextId", "contextType", "windowId", "requestedAt"]);
export const CONTEXT_REGISTER_RESULT_FIELDS = Object.freeze(["schema", "status", "reason", "operationId", "contextId", "windowId", "runtimeSessionId", "authorityRevision", "authorityCommitted", "authorityVerified", "context", "assignment", "retrySafe", "warnings", "errors"]);
export const RESERVED_SESSION_AUTHORITY_ROOT_FIELDS = Object.freeze([
  "workspaceStates", "workspaceState", "workspace", "workspaces", "workspaceId", "workspaceRevision", "workspaceTabs",
  "journal", "journals", "journalEntries", "projection", "projections", "runtimeWindowId", "runtimeTabIds", "runtimeGroupIds",
  "pendingOperations", "browserOperations", "activeWorkspaceId", "constellationActiveWorkspace", "chromeFlowWorkspace",
  "indexedDb", "indexedDB", "sessionDb", "sessionDB"
]);
const RESERVED_SESSION_AUTHORITY_ROOT_FIELD_SET = new Set(RESERVED_SESSION_AUTHORITY_ROOT_FIELDS);

export function createSessionAuthority(runtimeSessionId) {
  return { schema: SCHEMAS.runtimeSessionAuthority, runtimeSessionId, authorityRevision: 0, assignmentRegistry: createAssignmentRegistry(), contexts: [] };
}

export function validateSessionAuthority(root) {
  const errors = [];
  if (!isPlainObject(root)) return { valid: false, errors: ["authority must be a plain object"] };
  errors.push(...serializableErrors(root, "authority"));
  for (const field of ["schema", "runtimeSessionId", "authorityRevision", "assignmentRegistry", "contexts"]) if (!Object.hasOwn(root, field)) errors.push("authority missing required field: " + field);
  for (const field of Object.keys(root)) if (RESERVED_SESSION_AUTHORITY_ROOT_FIELD_SET.has(field)) errors.push("authority contains reserved out-of-scope field: " + field);
  if (root.schema !== SCHEMAS.runtimeSessionAuthority) errors.push("authority schema is invalid");
  if (!nonEmptyString(root.runtimeSessionId)) errors.push("authority runtimeSessionId is invalid");
  if (!Number.isInteger(root.authorityRevision) || root.authorityRevision < 0) errors.push("authorityRevision must be a non-negative integer");
  const registryValidation = validateAssignmentRegistry(root.assignmentRegistry);
  if (!registryValidation.valid) errors.push(...registryValidation.errors);
  if (!Array.isArray(root.contexts)) errors.push("authority contexts must be an array");
  const contextIds = new Set(), contextWindows = new Set();
  if (Array.isArray(root.contexts)) root.contexts.forEach((context, index) => {
    const validation = validateStoredContext(context);
    if (!validation.valid) errors.push(...validation.errors.map((error) => `authority.contexts[${index}].${error}`));
    if (nonEmptyString(context?.contextId)) {
      if (contextIds.has(context.contextId)) errors.push(`authority.contexts[${index}].contextId is duplicate`);
      contextIds.add(context.contextId);
    }
    if (Number.isInteger(context?.windowId) && context.windowId >= 0) {
      if (contextWindows.has(context.windowId)) errors.push(`authority.contexts[${index}].windowId is duplicate`);
      contextWindows.add(context.windowId);
    }
  });
  return { valid: errors.length === 0, errors };
}

export function validateStoredContext(context) {
  const errors = [];
  if (!isPlainObject(context)) return { valid: false, errors: ["context must be a plain object"] };
  errors.push(...serializableErrors(context, "context"));
  for (const field of ["contextId", "contextType", "windowId", "createdAt", "sourceUrl"]) if (!Object.hasOwn(context, field)) errors.push("missing required field: " + field);
  if (!nonEmptyString(context.contextId)) errors.push("contextId is invalid");
  if (context.contextType !== "side_panel") errors.push("contextType is invalid");
  if (!Number.isInteger(context.windowId) || context.windowId < 0) errors.push("windowId is invalid");
  if (!validDateTime(context.createdAt)) errors.push("createdAt is invalid");
  if (!nonEmptyString(context.sourceUrl)) errors.push("sourceUrl is invalid");
  return { valid: errors.length === 0, errors };
}

export function validateContextRegisterRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ["request must be a plain object"] };
  errors.push(...serializableErrors(request, "request"));
  const actual = Object.keys(request).sort(), expected = [...CONTEXT_REGISTER_REQUEST_FIELDS].sort();
  if (stableStringify(actual) !== stableStringify(expected)) errors.push("request fields must match the exact contract");
  if (request.type !== CONTEXT_REGISTER_TYPE) errors.push("request type is invalid");
  if (request.schema !== CONTEXT_REGISTER_REQUEST_SCHEMA) errors.push("request schema is invalid");
  if (!nonEmptyString(request.operationId)) errors.push("operationId is invalid");
  if (!nonEmptyString(request.contextId)) errors.push("contextId is invalid");
  if (request.contextType !== "side_panel") errors.push("contextType is invalid");
  if (!Number.isInteger(request.windowId) || request.windowId < 0) errors.push("windowId is invalid");
  if (!validDateTime(request.requestedAt)) errors.push("requestedAt is invalid");
  return { valid: errors.length === 0, errors };
}

export function isContextRegisterMessage(message) { return message?.type === CONTEXT_REGISTER_TYPE || message?.schema === CONTEXT_REGISTER_REQUEST_SCHEMA; }
export function validateSidePanelSender(sender, runtimeId, expectedUrl) {
  return sender?.id === runtimeId && sender?.url === expectedUrl ? { valid: true } : { valid: false, reason: "sender_not_authorized" };
}

export function registerContext(root, details, { genesis = false } = {}) {
  const context = { contextId: details.contextId, contextType: "side_panel", windowId: details.windowId, createdAt: details.createdAt, sourceUrl: details.sourceUrl };
  const validation = validateStoredContext(context);
  if (!validation.valid) return { status: "rejected", reason: "invalid_context", errors: validation.errors, root };
  const sameId = root.contexts.find((item) => item.contextId === context.contextId);
  if (sameId) return sameId.windowId === context.windowId
    ? { status: "no_change", root, context: clone(sameId), assignment: resolveAssignmentByWindow(root.assignmentRegistry, context.windowId) }
    : { status: "context_conflict", reason: "context_id_bound_to_another_window", root };
  const existingWindow = root.contexts.find((item) => item.windowId === context.windowId);
  const next = clone(root);
  next.contexts = next.contexts.filter((item) => item.windowId !== context.windowId);
  next.contexts.push(context);
  if (!genesis) next.authorityRevision += 1;
  return { status: existingWindow ? "replaced" : "registered", root: next, context: clone(context), assignment: resolveAssignmentByWindow(next.assignmentRegistry, context.windowId) };
}

export function validateActiveContext(root, contextId, windowId) {
  const byId = root.contexts.find((item) => item.contextId === contextId);
  if (byId && byId.windowId !== windowId) return { valid: false, reason: "context_conflict" };
  const byWindow = root.contexts.find((item) => item.windowId === windowId);
  if (!byWindow || byWindow.contextId !== contextId) return { valid: false, reason: "stale_context" };
  return { valid: true, context: clone(byWindow) };
}

export function createContextResult(fields = {}) {
  return {
    schema: CONTEXT_REGISTER_RESULT_SCHEMA, status: fields.status || "failed", reason: fields.reason || "", operationId: safeString(fields.operationId), contextId: safeString(fields.contextId),
    windowId: Number.isInteger(fields.windowId) ? fields.windowId : -1, runtimeSessionId: safeString(fields.runtimeSessionId), authorityRevision: Number.isInteger(fields.authorityRevision) ? fields.authorityRevision : -1,
    authorityCommitted: fields.authorityCommitted === true, authorityVerified: fields.authorityVerified === true, context: fields.context ? clone(fields.context) : null, assignment: fields.assignment ? clone(fields.assignment) : null,
    retrySafe: fields.retrySafe === true, warnings: Array.isArray(fields.warnings) ? [...fields.warnings] : [], errors: Array.isArray(fields.errors) ? [...fields.errors] : []
  };
}

export function createContextResultFromRequest(request, trustedFields = {}) {
  return createContextResult({
    ...trustedFields,
    operationId: request?.operationId,
    contextId: request?.contextId,
    windowId: request?.windowId
  });
}

export function validateContextRegisterResult(result, expected = {}) {
  const errors = [];
  if (!isPlainObject(result)) return { valid: false, errors: ["result must be a plain object"] };
  errors.push(...serializableErrors(result, "result"));
  if (stableStringify(Object.keys(result).sort()) !== stableStringify([...CONTEXT_REGISTER_RESULT_FIELDS].sort())) errors.push("result fields must match the exact contract");
  if (result.schema !== CONTEXT_REGISTER_RESULT_SCHEMA) errors.push("result schema is invalid");
  if (!["registered", "replaced", "no_change", "context_conflict", "rejected", "failed"].includes(result.status)) errors.push("result status is invalid");
  if (typeof result.reason !== "string" || !nonEmptyString(result.operationId) || !nonEmptyString(result.contextId)) errors.push("result identities are invalid");
  if (!Number.isInteger(result.windowId) || result.windowId < 0) errors.push("result windowId is invalid");
  if (result.operationId !== expected.operationId || result.contextId !== expected.contextId || result.windowId !== expected.windowId) errors.push("result identities do not match request");
  if (typeof result.authorityCommitted !== "boolean" || typeof result.authorityVerified !== "boolean" || typeof result.retrySafe !== "boolean") errors.push("result flags are invalid");
  if (!Array.isArray(result.warnings) || result.warnings.some((item) => typeof item !== "string") || !Array.isArray(result.errors) || result.errors.some((item) => typeof item !== "string")) errors.push("result evidence arrays are invalid");
  const successful = ["registered", "replaced", "no_change"].includes(result.status);
  if (successful) {
    if (!nonEmptyString(result.runtimeSessionId) || !Number.isInteger(result.authorityRevision) || result.authorityRevision < 0) errors.push("verified authority identity is invalid");
    if (result.authorityVerified !== true || result.reason !== "") errors.push("successful registration status flags are invalid");
  }
  if (["registered", "replaced"].includes(result.status) && result.authorityCommitted !== true) errors.push("committed registration must report its write");
  if (result.status === "no_change" && result.authorityCommitted !== false) errors.push("no_change must not report a write");
  if (["context_conflict", "rejected"].includes(result.status) && (result.authorityCommitted !== false || result.authorityVerified !== false || !nonEmptyString(result.reason))) errors.push("conflict or rejection status flags are invalid");
  if (result.status === "failed" && (result.authorityVerified !== false || !nonEmptyString(result.reason))) errors.push("failed status flags are invalid");
  if (result.context !== null) {
    if (!validateStoredContext(result.context).valid) errors.push("result context is invalid");
    if (result.context.contextId !== result.contextId || result.context.windowId !== result.windowId || result.context.contextType !== "side_panel") errors.push("result context identities do not match result");
  }
  if (successful && result.context === null) errors.push("successful registration must return its context");
  if (result.assignment !== null) {
    const epoch = result.assignment?.assignmentEpoch;
    const validation = validateAssignmentRegistry({ schema: SCHEMAS.assignments, nextEpoch: Number.isInteger(epoch) ? epoch + 1 : 1, assignments: [result.assignment] });
    if (!validation.valid || result.assignment.state !== "active" || result.assignment.windowId !== result.windowId) errors.push("result assignment is invalid");
  }
  if (["context_conflict", "rejected", "failed"].includes(result.status) && result.assignment !== null) errors.push("non-success result must not include an assignment");
  return { valid: errors.length === 0, errors };
}

export function rootsEqual(left, right) { return stableStringify(left) === stableStringify(right); }
function safeString(value) { return nonEmptyString(value) ? value : ""; }
