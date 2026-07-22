import { normalizeWorkspaceRevision } from "../runtime-contract/revision.js";
import {
  clone,
  isPlainObject,
  nonEmptyString,
  serializableErrors,
  stableStringify,
  validDateTime
} from "../runtime-contract/value-utils.js";
import { isValidRuntimeWorkspaceId } from "../runtime-workspace-record/contract.js";

export const WINDOW_BINDING_RESOLVE_TYPE = "constellation-runtime-window-binding-resolve";
export const WINDOW_BINDING_RESOLVE_COMMAND_SCHEMA = "constellation-runtime-window-binding-resolve-command-v0.1";
export const WINDOW_BINDING_RESOLVE_RESULT_SCHEMA = "constellation-runtime-window-binding-resolve-result-v0.1";
export const WINDOW_BINDING_RESOLVE_STATUSES = Object.freeze([
  "assigned",
  "unbound",
  "stale_context",
  "stale_assignment",
  "active_elsewhere",
  "malformed_runtime_record",
  "failed"
]);

const COMMAND_FIELDS = Object.freeze(["type", "schema", "operationId", "runtimeSessionId", "sourceContextId", "sourceWindowId", "requestedAt"]);
const RESULT_FIELDS = Object.freeze([
  "schema", "status", "reason", "operationId", "runtimeSessionId", "sourceContextId", "sourceWindowId",
  "workspaceId", "workspaceRevision", "runtimeAssignmentId", "assignmentEpoch", "ownerWindowId", "authorityRevision",
  "workspace", "lifecycleState", "phase", "mutationCommitted", "authorityVerified", "workspaceVerified",
  "retrySafe", "warnings", "errors"
]);

export function snapshotAndValidateWindowBindingResolveCommand(value) {
  const errors = [];
  let command;
  try {
    if (!isPlainObject(value)) return { valid: false, errors: ["resolve command must be a plain object"], command: null };
    errors.push(...serializableErrors(value, "resolveCommand"));
    if (errors.length) return { valid: false, errors, command: null };
    command = clone(value);
  } catch (error) {
    return { valid: false, errors: ["resolve command snapshot failed: " + safeError(error)], command: null };
  }
  exactFields(command, COMMAND_FIELDS, "resolve command", errors);
  if (command.type !== WINDOW_BINDING_RESOLVE_TYPE) errors.push("resolve command type is invalid");
  if (command.schema !== WINDOW_BINDING_RESOLVE_COMMAND_SCHEMA) errors.push("resolve command schema is invalid");
  if (!nonEmptyString(command.operationId)) errors.push("resolve command operationId is invalid");
  if (!nonEmptyString(command.runtimeSessionId)) errors.push("resolve command runtimeSessionId is invalid");
  if (!nonEmptyString(command.sourceContextId)) errors.push("resolve command sourceContextId is invalid");
  if (!Number.isSafeInteger(command.sourceWindowId) || command.sourceWindowId < 0) errors.push("resolve command sourceWindowId is invalid");
  if (!validDateTime(command.requestedAt)) errors.push("resolve command requestedAt is invalid");
  return { valid: errors.length === 0, errors, command: errors.length ? null : command };
}

export function isRuntimeWindowBindingResolveMessage(message) {
  try { return message?.type === WINDOW_BINDING_RESOLVE_TYPE || message?.schema === WINDOW_BINDING_RESOLVE_COMMAND_SCHEMA; }
  catch { return false; }
}

export function createWindowBindingResolveResult(command, fields = {}) {
  const status = WINDOW_BINDING_RESOLVE_STATUSES.includes(fields?.status) ? fields.status : "failed";
  let workspace = null;
  try { if (isPlainObject(fields?.workspace) && serializableErrors(fields.workspace, "workspace").length === 0) workspace = clone(fields.workspace); }
  catch { workspace = null; }
  return {
    schema: WINDOW_BINDING_RESOLVE_RESULT_SCHEMA,
    status,
    reason: typeof fields?.reason === "string" ? fields.reason : "",
    operationId: safeString(command?.operationId),
    runtimeSessionId: safeString(fields?.runtimeSessionId ?? command?.runtimeSessionId),
    sourceContextId: safeString(command?.sourceContextId),
    sourceWindowId: safeWindow(command?.sourceWindowId),
    workspaceId: isValidRuntimeWorkspaceId(fields?.workspaceId) ? fields.workspaceId : "",
    workspaceRevision: Number.isSafeInteger(fields?.workspaceRevision) && fields.workspaceRevision >= 0 ? fields.workspaceRevision : -1,
    runtimeAssignmentId: safeString(fields?.runtimeAssignmentId),
    assignmentEpoch: Number.isSafeInteger(fields?.assignmentEpoch) && fields.assignmentEpoch > 0 ? fields.assignmentEpoch : -1,
    ownerWindowId: safeWindow(fields?.ownerWindowId),
    authorityRevision: Number.isSafeInteger(fields?.authorityRevision) && fields.authorityRevision >= 0 ? fields.authorityRevision : -1,
    workspace,
    lifecycleState: ["available", "paused"].includes(fields?.lifecycleState) ? fields.lifecycleState : "",
    phase: typeof fields?.phase === "string" ? fields.phase : "none",
    mutationCommitted: false,
    authorityVerified: fields?.authorityVerified === true,
    workspaceVerified: fields?.workspaceVerified === true,
    retrySafe: fields?.retrySafe === true,
    warnings: stringArray(fields?.warnings),
    errors: stringArray(fields?.errors)
  };
}

export function validateWindowBindingResolveResult(value, expected = {}) {
  const errors = [];
  let result;
  try {
    if (!isPlainObject(value)) return { valid: false, errors: ["resolve result must be a plain object"], result: null };
    errors.push(...serializableErrors(value, "resolveResult"));
    if (errors.length) return { valid: false, errors, result: null };
    result = clone(value);
  } catch (error) {
    return { valid: false, errors: ["resolve result snapshot failed: " + safeError(error)], result: null };
  }
  exactFields(result, RESULT_FIELDS, "resolve result", errors);
  if (result.schema !== WINDOW_BINDING_RESOLVE_RESULT_SCHEMA) errors.push("resolve result schema is invalid");
  if (!WINDOW_BINDING_RESOLVE_STATUSES.includes(result.status)) errors.push("resolve result status is invalid");
  if (typeof result.reason !== "string" || !nonEmptyString(result.operationId) || !nonEmptyString(result.runtimeSessionId) || !nonEmptyString(result.sourceContextId)) errors.push("resolve result base identities are invalid");
  if (!Number.isSafeInteger(result.sourceWindowId) || result.sourceWindowId < 0) errors.push("resolve result sourceWindowId is invalid");
  if (result.operationId !== expected.operationId || result.runtimeSessionId !== expected.runtimeSessionId || result.sourceContextId !== expected.sourceContextId || result.sourceWindowId !== expected.sourceWindowId) errors.push("resolve result identities do not match the command");
  if (result.mutationCommitted !== false) errors.push("resolve result must report zero mutation");
  for (const field of ["authorityVerified", "workspaceVerified", "retrySafe"]) if (typeof result[field] !== "boolean") errors.push("resolve result flags are invalid");
  if (!Array.isArray(result.warnings) || result.warnings.some((item) => typeof item !== "string") || !Array.isArray(result.errors) || result.errors.some((item) => typeof item !== "string")) errors.push("resolve result evidence arrays are invalid");
  validateStatusEvidence(result, errors);
  return { valid: errors.length === 0, errors, result: errors.length ? null : result };
}

function validateStatusEvidence(result, errors) {
  const assigned = result.status === "assigned";
  const noWorkspace = ["unbound", "stale_context"].includes(result.status);
  if (["assigned", "unbound"].includes(result.status) && result.reason !== "") errors.push("successful resolve status must have an empty reason");
  if (!["assigned", "unbound"].includes(result.status) && !nonEmptyString(result.reason)) errors.push("non-success resolve status requires a reason");
  if (assigned) {
    if (!isValidRuntimeWorkspaceId(result.workspaceId) || !Number.isSafeInteger(result.workspaceRevision) || result.workspaceRevision < 0 || !nonEmptyString(result.runtimeAssignmentId) || !Number.isSafeInteger(result.assignmentEpoch) || result.assignmentEpoch <= 0 || !Number.isSafeInteger(result.authorityRevision) || result.authorityRevision < 0) errors.push("assigned resolve identities are invalid");
    if (!isPlainObject(result.workspace) || result.workspace.workspaceId !== result.workspaceId) errors.push("assigned workspace identity is invalid");
    else {
      const revision = normalizeWorkspaceRevision(result.workspace);
      if (!revision.valid || revision.revision !== result.workspaceRevision) errors.push("assigned workspace revision is invalid");
    }
    if (!["available", "paused"].includes(result.lifecycleState)) errors.push("assigned lifecycleState is invalid");
    if (result.authorityVerified !== true || result.workspaceVerified !== true) errors.push("assigned resolve must verify authority and workspace");
    if (result.ownerWindowId !== -1 || result.reason !== "") errors.push("assigned resolve owner evidence is invalid");
  }
  if (noWorkspace && (result.workspaceId !== "" || result.workspaceRevision !== -1 || result.runtimeAssignmentId !== "" || result.assignmentEpoch !== -1 || result.workspace !== null || result.lifecycleState !== "" || result.ownerWindowId !== -1)) errors.push("workspace-free resolve status contains workspace authority");
  if (result.status === "unbound" && (result.authorityVerified !== true || result.workspaceVerified !== false)) errors.push("unbound resolve flags are invalid");
  if (result.status === "active_elsewhere" && (!isValidRuntimeWorkspaceId(result.workspaceId) || !Number.isSafeInteger(result.ownerWindowId) || result.ownerWindowId < 0 || result.ownerWindowId === result.sourceWindowId || !nonEmptyString(result.runtimeAssignmentId) || result.assignmentEpoch <= 0 || result.workspace !== null || result.workspaceVerified !== false)) errors.push("active_elsewhere evidence is invalid");
  if (["stale_assignment", "malformed_runtime_record"].includes(result.status) && !isValidRuntimeWorkspaceId(result.workspaceId)) errors.push(result.status + " requires the resolved workspace identity");
  if (result.status === "failed" && result.workspaceId !== "" && (!isValidRuntimeWorkspaceId(result.workspaceId) || !nonEmptyString(result.runtimeAssignmentId) || result.assignmentEpoch <= 0 || result.workspace !== null)) errors.push("failed resolve contains incomplete known assignment evidence");
  if (result.status !== "assigned" && result.workspaceVerified !== false) errors.push("non-assigned resolve must not verify workspace authority");
}

function exactFields(value, expected, path, errors) { if (stableStringify(Object.keys(value).sort()) !== stableStringify([...expected].sort())) errors.push(path + " fields must match the exact v0.1 contract"); }
function safeString(value) { return nonEmptyString(value) ? value : ""; }
function safeWindow(value) { return Number.isSafeInteger(value) && value >= 0 ? value : -1; }
function safeError(error) { return String(error?.message || error || "unknown_error"); }
function stringArray(value) { return Array.isArray(value) ? value.filter((item) => typeof item === "string") : []; }
