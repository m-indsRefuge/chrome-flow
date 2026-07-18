import { nonEmptyString, stableStringify, validDateTime } from "../runtime-contract/value-utils.js";
import { normalizeWorkspaceRevision } from "../runtime-contract/revision.js";
import { createActivationRequestFingerprint } from "./fingerprint.js";

export { createActivationRequestFingerprint };

export const RUNTIME_WORKSPACE_ACTIVATION_TYPE = "constellation-runtime-workspace-activation";
export const RUNTIME_WORKSPACE_ACTIVATION_REQUEST_SCHEMA = "constellation-runtime-workspace-activation-request-v0.1";
export const RUNTIME_WORKSPACE_ACTIVATION_RESULT_SCHEMA = "constellation-runtime-workspace-activation-result-v0.1";
export const RUNTIME_WORKSPACE_ACTIVATION_PENDING_SCHEMA = "constellation-runtime-workspace-activation-pending-v0.1";

export const ACTIVATION_OPERATIONS = Object.freeze({
  bootstrapExisting: "bootstrap_existing",
  replaceActive: "replace_active",
  transferActive: "transfer_active"
});

export const ACTIVATION_STATUSES = Object.freeze([
  "committed",
  "no_change",
  "replayed",
  "conflict",
  "invalid",
  "failed",
  "indeterminate"
]);

export const ACTIVATION_PENDING_FIELDS = Object.freeze([
  "schema", "operationId", "requestFingerprint", "request"
]);

export const ACTIVATION_DECISIONS = Object.freeze([
  "use_active_workspace",
  "use_read_only_workspace",
  "retry_activation",
  "manual_resolution_required",
  "reject_request"
]);

export const ACTIVATION_PHASES = Object.freeze([
  "request_validation",
  "lock_acquisition",
  "operation_inspection",
  "workspace_reread",
  "source_verification",
  "target_selection",
  "workspace_write",
  "workspace_verification",
  "assignment_transition",
  "assignment_write",
  "assignment_verification",
  "final_verification",
  "operation_recording",
  "result_serialization",
  "complete"
]);

export const ACTIVATION_ADAPTER_FIELDS = Object.freeze([
  "runExclusiveOperation",
  "readOperationLedger",
  "writeOperationLedger",
  "readCompatibleWorkspace",
  "writeCompatibleWorkspace",
  "readRuntimeAuthority",
  "writeRuntimeAuthority",
  "readBrowserEvidence"
]);

export const ACTIVATION_REQUEST_FIELDS = Object.freeze([
  "type",
  "schema",
  "operationId",
  "operation",
  "sourceContextId",
  "sourceWindowId",
  "expectedWorkspaceId",
  "expectedWorkspaceRevision",
  "candidateWorkspace",
  "targetWindowId",
  "expectedRuntimeAssignmentId",
  "expectedAssignmentEpoch",
  "nextRuntimeAssignmentId",
  "requestedAt"
]);

export const ACTIVATION_RESULT_FIELDS = Object.freeze([
  "schema",
  "status",
  "reason",
  "decision",
  "phase",
  "operationId",
  "operation",
  "sourceContextId",
  "sourceWindowId",
  "targetWindowId",
  "expectedWorkspaceId",
  "expectedWorkspaceRevision",
  "activeWorkspaceId",
  "activeWorkspaceRevision",
  "requestFingerprint",
  "workspaceWritten",
  "workspaceVerified",
  "assignmentWritten",
  "assignmentVerified",
  "runtimeSessionId",
  "authorityRevisionBefore",
  "authorityRevisionAfter",
  "previousRuntimeAssignmentId",
  "previousAssignmentEpoch",
  "currentRuntimeAssignmentId",
  "currentAssignmentEpoch",
  "liveWorkspaceTabIds",
  "liveWorkspaceWindowIds",
  "readOnly",
  "replayed",
  "retrySafe",
  "indeterminate",
  "warnings",
  "errors"
]);

export function snapshotSerializable(input) {
  const seen = new WeakSet();

  function visit(value) {
    if (value === null || typeof value === "string" || typeof value === "boolean") return { ok: true, value };
    if (typeof value === "number") return Number.isFinite(value) ? { ok: true, value } : { ok: false, reason: "non_finite_number" };
    if (["undefined", "function", "symbol", "bigint"].includes(typeof value)) return { ok: false, reason: "unsupported_value" };
    if (seen.has(value)) return { ok: false, reason: "cyclic_value" };

    if (Array.isArray(value)) {
      const keys = safeOwnKeys(value);
      const length = safeRead(value, "length");
      if (!keys || !length.ok || !Number.isSafeInteger(length.value) || length.value < 0 || keys.some((key) => typeof key !== "string")) return { ok: false, reason: "invalid_array" };
      const expectedKeys = new Set(["length"]);
      for (let index = 0; index < length.value; index += 1) expectedKeys.add(String(index));
      if (keys.length !== expectedKeys.size || keys.some((key) => !expectedKeys.has(key))) return { ok: false, reason: "sparse_or_extended_array" };
      seen.add(value);
      const output = [];
      for (let index = 0; index < length.value; index += 1) {
        const read = safeRead(value, String(index));
        if (!read.ok) return { ok: false, reason: "throwing_array_getter" };
        const nested = visit(read.value);
        if (!nested.ok) return nested;
        output.push(nested.value);
      }
      seen.delete(value);
      return { ok: true, value: output };
    }

    if (!isPlainRecord(value)) return { ok: false, reason: "non_plain_object" };
    const keys = safeOwnKeys(value);
    if (!keys || keys.some((key) => typeof key !== "string")) return { ok: false, reason: "symbol_object_field" };
    seen.add(value);
    const output = {};
    for (const key of [...keys].sort(compareText)) {
      const read = safeRead(value, key);
      if (!read.ok) return { ok: false, reason: "throwing_object_getter" };
      const nested = visit(read.value);
      if (!nested.ok) return nested;
      output[key] = nested.value;
    }
    seen.delete(value);
    return { ok: true, value: output };
  }

  try { return visit(input); }
  catch { return { ok: false, reason: "snapshot_failed" }; }
}

export function snapshotAndValidateActivationRequest(input) {
  const snapshot = snapshotSerializable(input);
  if (!snapshot.ok) return { ok: false, reason: "invalid_activation_request", errors: [snapshot.reason] };
  const request = snapshot.value;
  const errors = [];
  if (!isPlainRecord(request) || !exactFields(request, ACTIVATION_REQUEST_FIELDS)) errors.push("request_fields_invalid");
  if (request.type !== RUNTIME_WORKSPACE_ACTIVATION_TYPE) errors.push("request_type_invalid");
  if (request.schema !== RUNTIME_WORKSPACE_ACTIVATION_REQUEST_SCHEMA) errors.push("request_schema_invalid");
  if (!Object.values(ACTIVATION_OPERATIONS).includes(request.operation)) errors.push("operation_invalid");
  for (const field of ["operationId", "sourceContextId", "expectedWorkspaceId", "nextRuntimeAssignmentId"]) {
    if (!nonEmptyString(request[field])) errors.push(field + "_invalid");
  }
  if (!safeId(request.sourceWindowId)) errors.push("source_window_id_invalid");
  if (!safeId(request.expectedWorkspaceRevision)) errors.push("expected_workspace_revision_invalid");
  if (!validDateTime(request.requestedAt)) errors.push("requested_at_invalid");

  if (request.operation === ACTIVATION_OPERATIONS.bootstrapExisting) {
    if (request.candidateWorkspace !== null || request.targetWindowId !== null || request.expectedRuntimeAssignmentId !== null || request.expectedAssignmentEpoch !== null) errors.push("bootstrap_fields_invalid");
  } else if (request.operation === ACTIVATION_OPERATIONS.replaceActive) {
    if (!validWorkspaceCandidate(request.candidateWorkspace)) {
      errors.push("candidate_workspace_invalid");
    } else if (request.candidateWorkspace.workspaceId === request.expectedWorkspaceId) {
      const candidateRevision = workspaceRevision(request.candidateWorkspace);
      if (candidateRevision !== request.expectedWorkspaceRevision + 1) errors.push("candidate_workspace_revision_not_next");
      if (!nonEmptyString(request.expectedRuntimeAssignmentId) || !positiveInteger(request.expectedAssignmentEpoch)) errors.push("same_workspace_replacement_assignment_invalid");
    }
    if (!safeId(request.targetWindowId)) errors.push("target_window_id_invalid");
    if (!nullableAssignmentPair(request.expectedRuntimeAssignmentId, request.expectedAssignmentEpoch)) errors.push("expected_assignment_invalid");
  } else if (request.operation === ACTIVATION_OPERATIONS.transferActive) {
    if (request.candidateWorkspace !== null || !safeId(request.targetWindowId) || request.targetWindowId === request.sourceWindowId) errors.push("transfer_fields_invalid");
    if (!nonEmptyString(request.expectedRuntimeAssignmentId) || !positiveInteger(request.expectedAssignmentEpoch)) errors.push("expected_assignment_invalid");
  }

  return errors.length
    ? { ok: false, reason: "invalid_activation_request", errors: [...new Set(errors)].sort(compareText), value: request }
    : { ok: true, value: request };
}

export function createActivationPending(request, requestFingerprint) {
  return {
    schema: RUNTIME_WORKSPACE_ACTIVATION_PENDING_SCHEMA,
    operationId: request.operationId,
    requestFingerprint,
    request: structuredClone(request)
  };
}

export function validateActivationPending(value) {
  try {
    const snapshot = snapshotSerializable(value);
    if (!snapshot.ok || !isPlainRecord(snapshot.value) || !exactFields(snapshot.value, ACTIVATION_PENDING_FIELDS)) return false;
    const pending = snapshot.value;
    const request = snapshotAndValidateActivationRequest(pending.request);
    return pending.schema === RUNTIME_WORKSPACE_ACTIVATION_PENDING_SCHEMA &&
      request.ok &&
      request.value.operation === ACTIVATION_OPERATIONS.replaceActive &&
      pending.operationId === request.value.operationId &&
      nonEmptyString(pending.requestFingerprint) &&
      pending.requestFingerprint === createActivationRequestFingerprint(request.value);
  } catch { return false; }
}

export function normalizeActivationIdentities(input) {
  return {
    operationId: safeString(input, "operationId"),
    operation: safeString(input, "operation"),
    sourceContextId: safeString(input, "sourceContextId"),
    sourceWindowId: safeInteger(input, "sourceWindowId"),
    targetWindowId: safeInteger(input, "targetWindowId"),
    expectedWorkspaceId: safeString(input, "expectedWorkspaceId"),
    expectedWorkspaceRevision: safeInteger(input, "expectedWorkspaceRevision")
  };
}

export function readActivationAdapterFunctions(adapters) {
  try {
    if (!isPlainRecord(adapters) || !exactFields(adapters, ACTIVATION_ADAPTER_FIELDS)) return { valid: false, functions: null };
    const functions = {};
    for (const field of ACTIVATION_ADAPTER_FIELDS) {
      const value = Reflect.get(adapters, field);
      if (typeof value !== "function") return { valid: false, functions: null };
      functions[field] = value;
    }
    return { valid: true, functions };
  } catch { return { valid: false, functions: null }; }
}

export function createActivationResult(identities, fields = {}) {
  return {
    schema: RUNTIME_WORKSPACE_ACTIVATION_RESULT_SCHEMA,
    status: fields.status || "failed",
    reason: fields.reason || "activation_failed",
    decision: fields.decision || "retry_activation",
    phase: fields.phase || "result_serialization",
    operationId: identities.operationId,
    operation: identities.operation,
    sourceContextId: identities.sourceContextId,
    sourceWindowId: identities.sourceWindowId,
    targetWindowId: Number.isInteger(fields.targetWindowId) ? fields.targetWindowId : identities.targetWindowId,
    expectedWorkspaceId: identities.expectedWorkspaceId,
    expectedWorkspaceRevision: identities.expectedWorkspaceRevision,
    activeWorkspaceId: typeof fields.activeWorkspaceId === "string" ? fields.activeWorkspaceId : "",
    activeWorkspaceRevision: Number.isInteger(fields.activeWorkspaceRevision) ? fields.activeWorkspaceRevision : null,
    requestFingerprint: typeof fields.requestFingerprint === "string" ? fields.requestFingerprint : "",
    workspaceWritten: fields.workspaceWritten === true,
    workspaceVerified: fields.workspaceVerified === true,
    assignmentWritten: fields.assignmentWritten === true,
    assignmentVerified: fields.assignmentVerified === true,
    runtimeSessionId: typeof fields.runtimeSessionId === "string" ? fields.runtimeSessionId : "",
    authorityRevisionBefore: Number.isInteger(fields.authorityRevisionBefore) ? fields.authorityRevisionBefore : null,
    authorityRevisionAfter: Number.isInteger(fields.authorityRevisionAfter) ? fields.authorityRevisionAfter : null,
    previousRuntimeAssignmentId: typeof fields.previousRuntimeAssignmentId === "string" ? fields.previousRuntimeAssignmentId : "",
    previousAssignmentEpoch: Number.isInteger(fields.previousAssignmentEpoch) ? fields.previousAssignmentEpoch : null,
    currentRuntimeAssignmentId: typeof fields.currentRuntimeAssignmentId === "string" ? fields.currentRuntimeAssignmentId : "",
    currentAssignmentEpoch: Number.isInteger(fields.currentAssignmentEpoch) ? fields.currentAssignmentEpoch : null,
    liveWorkspaceTabIds: numericArray(fields.liveWorkspaceTabIds),
    liveWorkspaceWindowIds: numericArray(fields.liveWorkspaceWindowIds),
    readOnly: fields.readOnly === true,
    replayed: fields.replayed === true,
    retrySafe: fields.retrySafe === true,
    indeterminate: fields.indeterminate === true,
    warnings: stringArray(fields.warnings),
    errors: stringArray(fields.errors)
  };
}

export function validateActivationResult(value, expected = {}) {
  try {
    const snapshot = snapshotSerializable(value);
    if (!snapshot.ok) return false;
    value = snapshot.value;
    if (!isPlainRecord(value) || !exactFields(value, ACTIVATION_RESULT_FIELDS)) return false;
    if (value.schema !== RUNTIME_WORKSPACE_ACTIVATION_RESULT_SCHEMA || !ACTIVATION_STATUSES.includes(value.status) || !ACTIVATION_DECISIONS.includes(value.decision) || !ACTIVATION_PHASES.includes(value.phase)) return false;
    for (const field of ["reason", "operationId", "operation", "sourceContextId", "expectedWorkspaceId"]) if (!nonEmptyString(value[field])) return false;
    if (!Object.values(ACTIVATION_OPERATIONS).includes(value.operation) || !safeId(value.sourceWindowId) || !safeId(value.expectedWorkspaceRevision)) return false;
    for (const field of ["targetWindowId", "activeWorkspaceRevision", "authorityRevisionBefore", "authorityRevisionAfter"]) if (!(value[field] === null || safeId(value[field]))) return false;
    for (const field of ["previousAssignmentEpoch", "currentAssignmentEpoch"]) if (!(value[field] === null || positiveInteger(value[field]))) return false;
    for (const field of ["activeWorkspaceId", "requestFingerprint", "runtimeSessionId", "previousRuntimeAssignmentId", "currentRuntimeAssignmentId"]) if (typeof value[field] !== "string") return false;
    for (const field of ["workspaceWritten", "workspaceVerified", "assignmentWritten", "assignmentVerified", "readOnly", "replayed", "retrySafe", "indeterminate"]) if (typeof value[field] !== "boolean") return false;
    if (!numericArrayValid(value.liveWorkspaceTabIds) || !numericArrayValid(value.liveWorkspaceWindowIds) || !stringArrayValid(value.warnings) || !stringArrayValid(value.errors)) return false;
    if (expected.operationId && value.operationId !== expected.operationId) return false;
    if (expected.operation && value.operation !== expected.operation) return false;
    if (nonEmptyString(expected.sourceContextId) && value.sourceContextId !== expected.sourceContextId) return false;
    if (safeId(expected.sourceWindowId) && value.sourceWindowId !== expected.sourceWindowId) return false;
    if (nonEmptyString(expected.expectedWorkspaceId) && value.expectedWorkspaceId !== expected.expectedWorkspaceId) return false;
    if (safeId(expected.expectedWorkspaceRevision) && value.expectedWorkspaceRevision !== expected.expectedWorkspaceRevision) return false;
    if (safeId(expected.targetWindowId) && value.targetWindowId !== expected.targetWindowId) return false;
    const successful = ["committed", "no_change", "replayed"].includes(value.status);
    if (successful) {
      const readOnlySuccess = value.readOnly && value.operation === ACTIVATION_OPERATIONS.bootstrapExisting && value.decision === "use_read_only_workspace";
      const writableSuccess = !value.readOnly && value.decision === "use_active_workspace";
      if (!value.workspaceVerified || !value.assignmentVerified || value.phase !== "complete" || (!readOnlySuccess && !writableSuccess)) return false;
      if (!safeId(value.targetWindowId) || !nonEmptyString(value.activeWorkspaceId) || !safeId(value.activeWorkspaceRevision)) return false;
      if (!nonEmptyString(value.runtimeSessionId) || !safeId(value.authorityRevisionBefore) || !safeId(value.authorityRevisionAfter)) return false;
      if (!nonEmptyString(value.currentRuntimeAssignmentId) || !positiveInteger(value.currentAssignmentEpoch) || !nonEmptyString(value.requestFingerprint)) return false;
      if (expected.operation === ACTIVATION_OPERATIONS.replaceActive) {
        if (validWorkspaceCandidate(expected.candidateWorkspace) && (value.activeWorkspaceId !== expected.candidateWorkspace.workspaceId || value.activeWorkspaceRevision !== workspaceRevision(expected.candidateWorkspace))) return false;
      } else if (nonEmptyString(expected.expectedWorkspaceId)) {
        if (value.activeWorkspaceId !== expected.expectedWorkspaceId || value.activeWorkspaceRevision !== expected.expectedWorkspaceRevision) return false;
      }
      if (nonEmptyString(expected.expectedRuntimeAssignmentId)) {
        if (value.previousRuntimeAssignmentId !== expected.expectedRuntimeAssignmentId || value.previousAssignmentEpoch !== expected.expectedAssignmentEpoch) return false;
      }
      if (nonEmptyString(expected.nextRuntimeAssignmentId) && (
        expected.operation === ACTIVATION_OPERATIONS.replaceActive ||
        (expected.operation === ACTIVATION_OPERATIONS.transferActive && expected.targetWindowId !== expected.sourceWindowId)
      ) && value.currentRuntimeAssignmentId !== expected.nextRuntimeAssignmentId) return false;
    }
    if (value.status === "replayed" && !value.replayed) return false;
    if (value.status === "conflict" && !["manual_resolution_required", "use_read_only_workspace"].includes(value.decision)) return false;
    if (value.status === "invalid" && value.decision !== "reject_request") return false;
    if (["failed", "indeterminate"].includes(value.status) && value.decision !== "retry_activation") return false;
    if (value.status === "indeterminate" && (!value.indeterminate || !value.retrySafe)) return false;
    return true;
  } catch { return false; }
}

export function workspaceRevision(workspace) {
  const normalized = normalizeWorkspaceRevision(workspace);
  return normalized.valid ? normalized.revision : null;
}

function validWorkspaceCandidate(value) {
  if (!isPlainRecord(value) || !nonEmptyString(value.workspaceId) || !Array.isArray(value.tabs)) return false;
  return workspaceRevision(value) !== null && snapshotSerializable(value).ok;
}
function nullableAssignmentPair(id, epoch) { return (id === null && epoch === null) || (nonEmptyString(id) && positiveInteger(epoch)); }
function exactFields(value, fields) { return stableStringify(Object.keys(value).sort(compareText)) === stableStringify([...fields].sort(compareText)); }
function safeOwnKeys(value) { try { return Reflect.ownKeys(value); } catch { return null; } }
function safeRead(value, key) { try { return { ok: true, value: Reflect.get(value, key) }; } catch { return { ok: false }; } }
function isPlainRecord(value) { try { if (value === null || typeof value !== "object" || Array.isArray(value)) return false; const prototype = Reflect.getPrototypeOf(value); return prototype === Object.prototype || prototype === null; } catch { return false; } }
function safeId(value) { return Number.isSafeInteger(value) && value >= 0; }
function positiveInteger(value) { return Number.isSafeInteger(value) && value > 0; }
function safeString(value, key) { try { const field = Reflect.get(value, key); return typeof field === "string" ? field : ""; } catch { return ""; } }
function safeInteger(value, key) { try { const field = Reflect.get(value, key); return safeId(field) ? field : null; } catch { return null; } }
function numericArray(value) { return Array.isArray(value) ? value.filter(safeId) : []; }
function numericArrayValid(value) { return Array.isArray(value) && value.every(safeId) && new Set(value).size === value.length; }
function stringArray(value) { return Array.isArray(value) ? value.filter((item) => typeof item === "string") : []; }
function stringArrayValid(value) { return Array.isArray(value) && value.every((item) => typeof item === "string"); }
function compareText(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
