import { normalizeWorkspaceRevision } from "../runtime-contract/revision.js";
import {
  clone,
  isPlainObject,
  nonEmptyString,
  serializableErrors,
  stableStringify,
  validDateTime
} from "../runtime-contract/value-utils.js";

export const RUNTIME_WORKSPACE_KEY_PREFIX = "constellationRuntimeWorkspace:";
export const RUNTIME_WORKSPACE_SCHEMA = "constellation-runtime-workspace-v0.1";
export const RUNTIME_WORKSPACE_RESULT_SCHEMA = "constellation-runtime-workspace-record-result-v0.1";
export const RUNTIME_WORKSPACE_LIFECYCLE_STATES = Object.freeze(["available", "paused"]);
export const RUNTIME_WORKSPACE_PROVENANCE_KINDS = Object.freeze([
  "explicit_create",
  "explicit_resume",
  "explicit_restore",
  "compatibility_seed",
  "transfer",
  "replacement",
  "recovery"
]);
export const RUNTIME_WORKSPACE_COMPATIBILITY_SOURCES = Object.freeze([
  "none",
  "legacy_only",
  "canonical_only",
  "dual_equivalent"
]);

const RECORD_FIELDS = Object.freeze([
  "schema",
  "workspaceId",
  "workspaceRevision",
  "workspace",
  "lifecycleState",
  "provenance",
  "lastVerifiedAt"
]);
const PROVENANCE_FIELDS = Object.freeze(["kind", "operationId", "compatibilitySource"]);
const RESULT_STATUSES = new Set([
  "found",
  "absent",
  "created",
  "committed",
  "paused",
  "deleted",
  "no_change",
  "conflict",
  "rejected",
  "failed"
]);

export function isValidRuntimeWorkspaceId(value) {
  return nonEmptyString(value) &&
    value === value.trim() &&
    value.length <= 512 &&
    !value.includes(":") &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

export function deriveRuntimeWorkspaceKey(workspaceId) {
  if (!isValidRuntimeWorkspaceId(workspaceId)) throw new TypeError("workspaceId is invalid for a scoped runtime key");
  return RUNTIME_WORKSPACE_KEY_PREFIX + workspaceId;
}

export function snapshotAndValidateRuntimeWorkspaceRecord(value, expected = {}) {
  const errors = [];
  let record;
  try {
    if (!isPlainObject(value)) return { valid: false, errors: ["runtimeWorkspaceRecord must be a plain object"], record: null };
    errors.push(...serializableErrors(value, "runtimeWorkspaceRecord"));
    if (errors.length) return { valid: false, errors, record: null };
    record = clone(value);
  } catch (error) {
    return { valid: false, errors: ["runtimeWorkspaceRecord snapshot failed: " + safeError(error)], record: null };
  }

  exactFields(record, RECORD_FIELDS, "runtimeWorkspaceRecord", errors);
  if (record.schema !== RUNTIME_WORKSPACE_SCHEMA) errors.push("runtimeWorkspaceRecord schema is invalid");
  if (!isValidRuntimeWorkspaceId(record.workspaceId)) errors.push("runtimeWorkspaceRecord workspaceId is invalid");
  if (!Number.isInteger(record.workspaceRevision) || record.workspaceRevision < 0) errors.push("runtimeWorkspaceRecord workspaceRevision is invalid");
  if (!isPlainObject(record.workspace)) {
    errors.push("runtimeWorkspaceRecord workspace must be a plain object");
  } else {
    if (record.workspace.workspaceId !== record.workspaceId) errors.push("runtimeWorkspaceRecord workspace identity does not match its top-level workspaceId");
    const normalized = normalizeWorkspaceRevision(record.workspace);
    if (!normalized.valid) errors.push(...normalized.errors.map((error) => "runtimeWorkspaceRecord workspace " + error));
    else if (normalized.revision !== record.workspaceRevision) errors.push("runtimeWorkspaceRecord workspaceRevision does not match its workspace");
  }
  if (!RUNTIME_WORKSPACE_LIFECYCLE_STATES.includes(record.lifecycleState)) errors.push("runtimeWorkspaceRecord lifecycleState is invalid");
  validateProvenance(record.provenance, errors);
  if (!validDateTime(record.lastVerifiedAt)) errors.push("runtimeWorkspaceRecord lastVerifiedAt is invalid");

  const expectedWorkspaceId = typeof expected === "string" ? expected : expected?.workspaceId;
  const expectedKey = typeof expected === "object" && expected !== null ? expected.key : undefined;
  if (expectedWorkspaceId !== undefined && record.workspaceId !== expectedWorkspaceId) errors.push("runtimeWorkspaceRecord does not match the expected workspaceId");
  if (expectedKey !== undefined) {
    let derived = "";
    try { derived = deriveRuntimeWorkspaceKey(record.workspaceId); }
    catch (error) { errors.push(safeError(error)); }
    if (derived !== expectedKey) errors.push("runtimeWorkspaceRecord does not match the scoped storage key");
  }
  return { valid: errors.length === 0, errors, record: errors.length ? null : record };
}

export function createRuntimeWorkspaceRecord(fields) {
  let workspace;
  try { workspace = clone(fields?.workspace); }
  catch (error) { throw new TypeError("workspace is not plain JSON-serializable: " + safeError(error)); }
  const record = {
    schema: RUNTIME_WORKSPACE_SCHEMA,
    workspaceId: fields?.workspaceId ?? workspace?.workspaceId,
    workspaceRevision: fields?.workspaceRevision ?? normalizeWorkspaceRevision(workspace).revision,
    workspace,
    lifecycleState: fields?.lifecycleState,
    provenance: fields?.provenance,
    lastVerifiedAt: fields?.lastVerifiedAt
  };
  const validation = snapshotAndValidateRuntimeWorkspaceRecord(record);
  if (!validation.valid) throw new TypeError(validation.errors.join("; "));
  return validation.record;
}

export function runtimeWorkspaceFingerprint(record) {
  const validation = snapshotAndValidateRuntimeWorkspaceRecord(record);
  if (!validation.valid) throw new TypeError(validation.errors.join("; "));
  return fingerprintText(stableStringify(validation.record));
}

export function createRuntimeWorkspaceResult(fields = {}) {
  const status = RESULT_STATUSES.has(fields?.status) ? fields.status : "failed";
  const workspaceId = isValidRuntimeWorkspaceId(fields?.workspaceId) ? fields.workspaceId : "";
  let key = "";
  if (workspaceId) key = deriveRuntimeWorkspaceKey(workspaceId);
  let record = null;
  if (fields?.record !== null && fields?.record !== undefined) {
    const validation = snapshotAndValidateRuntimeWorkspaceRecord(fields.record, workspaceId ? { workspaceId, key } : {});
    if (validation.valid) record = validation.record;
  }
  return {
    schema: RUNTIME_WORKSPACE_RESULT_SCHEMA,
    status,
    reason: typeof fields?.reason === "string" ? fields.reason : "",
    workspaceId,
    key,
    record,
    recordFingerprint: typeof fields?.recordFingerprint === "string" ? fields.recordFingerprint : "",
    phase: typeof fields?.phase === "string" ? fields.phase : "none",
    committed: fields?.committed === true,
    verified: fields?.verified === true,
    retrySafe: fields?.retrySafe === true,
    warnings: stringArray(fields?.warnings),
    errors: stringArray(fields?.errors)
  };
}

function validateProvenance(value, errors) {
  if (!isPlainObject(value)) {
    errors.push("runtimeWorkspaceRecord provenance must be a plain object");
    return;
  }
  exactFields(value, PROVENANCE_FIELDS, "runtimeWorkspaceRecord.provenance", errors);
  if (!RUNTIME_WORKSPACE_PROVENANCE_KINDS.includes(value.kind)) errors.push("runtimeWorkspaceRecord provenance kind is invalid");
  if (!nonEmptyString(value.operationId)) errors.push("runtimeWorkspaceRecord provenance operationId is invalid");
  if (!RUNTIME_WORKSPACE_COMPATIBILITY_SOURCES.includes(value.compatibilitySource)) errors.push("runtimeWorkspaceRecord provenance compatibilitySource is invalid");
}

function exactFields(value, expected, path, errors) {
  const actual = Object.keys(value).sort();
  if (stableStringify(actual) !== stableStringify([...expected].sort())) errors.push(path + " fields must match the exact v0.1 contract");
}

function fingerprintText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return "fnv1a32:" + (hash >>> 0).toString(16).padStart(8, "0") + ":" + text.length;
}

function safeError(error) { return String(error?.message || error || "unknown_error"); }
function stringArray(value) { return Array.isArray(value) ? value.filter((item) => typeof item === "string") : []; }
