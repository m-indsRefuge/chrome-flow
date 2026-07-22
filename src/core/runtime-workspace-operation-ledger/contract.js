import {
  clone,
  isPlainObject,
  nonEmptyString,
  serializableErrors,
  stableStringify,
  validDateTime
} from "../runtime-contract/value-utils.js";
import { isValidRuntimeWorkspaceId } from "../runtime-workspace-record/contract.js";

export const WORKSPACE_OPERATION_LEDGER_KEY_PREFIX = "constellationRuntimeWorkspaceOperationLedger:";
export const WORKSPACE_OPERATION_LEDGER_SCHEMA = "constellation-runtime-workspace-operation-ledger-v0.1";
export const WORKSPACE_OPERATION_TERMINAL_LIMIT = 256;
export const WORKSPACE_OPERATION_STATES = Object.freeze(["pending", "indeterminate", "terminal"]);
export const WORKSPACE_OPERATION_COMMAND_SCHEMAS = Object.freeze({
  create_and_bind: "constellation-runtime-workspace-create-bind-command-v0.1",
  resume_and_bind: "constellation-runtime-workspace-resume-bind-command-v0.1",
  transfer: "constellation-runtime-workspace-transfer-command-v0.1",
  release: "constellation-runtime-workspace-release-command-v0.1",
  archive_and_release: "constellation-runtime-workspace-archive-release-command-v0.1",
  replacement: "constellation-runtime-workspace-replace-command-v0.1",
  trusted_window_close: "constellation-runtime-window-close-lifecycle-command-v0.1"
});

const LEDGER_FIELDS = Object.freeze(["schema", "workspaceId", "terminalRetentionLimit", "nextSequence", "entries"]);
const ENTRY_FIELDS = Object.freeze([
  "operationId", "requestFingerprint", "commandSchema", "workspaceId", "affectedWorkspaceIds", "runtimeSessionId",
  "operationIntent", "state", "phase", "requestedAt", "updatedAt", "createdArtifacts", "compensationEvidence",
  "result", "recoveryEvidence", "sequence"
]);
const INTENT_FIELDS = Object.freeze([
  "operationKind", "commandSchema", "primaryWorkspaceId", "affectedWorkspaceIds", "sourceWindowId", "targetWindowId",
  "expectedRuntimeSessionId", "expectedAssignmentId", "expectedAssignmentEpoch", "expectedWorkspaceRevisions",
  "durableSourceIdentity", "durableSnapshotDigest", "browserPlanDigest", "projectionBaselineDigest",
  "compatibilityPreflightFingerprints", "completedPhasesAtIntentWrite", "nextRecoverablePhaseAtIntentWrite", "plannedArtifactIds"
]);
const COMPATIBILITY_FINGERPRINT_FIELDS = Object.freeze(["canonical", "legacy"]);
const COMPENSATION_FIELDS = Object.freeze(["status", "actions"]);
const RECOVERY_FIELDS = Object.freeze(["completedPhases", "nextRecoverablePhase", "createdArtifactIds"]);
const COMPENSATION_STATUSES = new Set(["not_required", "pending", "completed", "failed", "indeterminate"]);

export function deriveWorkspaceOperationLedgerKey(workspaceId) {
  if (!isValidRuntimeWorkspaceId(workspaceId)) throw new TypeError("workspaceId is invalid for a workspace operation ledger key");
  return WORKSPACE_OPERATION_LEDGER_KEY_PREFIX + workspaceId;
}

export function createWorkspaceOperationLedger(workspaceId) {
  deriveWorkspaceOperationLedgerKey(workspaceId);
  return {
    schema: WORKSPACE_OPERATION_LEDGER_SCHEMA,
    workspaceId,
    terminalRetentionLimit: WORKSPACE_OPERATION_TERMINAL_LIMIT,
    nextSequence: 1,
    entries: []
  };
}

export function snapshotAndValidateWorkspaceOperationLedger(value, expected = {}) {
  const errors = [];
  let ledger;
  try {
    if (!isPlainObject(value)) return invalid("workspaceOperationLedger must be a plain object");
    errors.push(...serializableErrors(value, "workspaceOperationLedger"));
    if (errors.length) return { valid: false, errors, ledger: null };
    ledger = clone(value);
  } catch (error) {
    return invalid("workspaceOperationLedger snapshot failed: " + safeError(error));
  }

  exactFields(ledger, LEDGER_FIELDS, "workspaceOperationLedger", errors);
  if (ledger.schema !== WORKSPACE_OPERATION_LEDGER_SCHEMA) errors.push("workspaceOperationLedger schema is invalid");
  if (!isValidRuntimeWorkspaceId(ledger.workspaceId)) errors.push("workspaceOperationLedger workspaceId is invalid");
  if (ledger.terminalRetentionLimit !== WORKSPACE_OPERATION_TERMINAL_LIMIT) errors.push("workspaceOperationLedger terminalRetentionLimit must equal 256");
  if (!Number.isSafeInteger(ledger.nextSequence) || ledger.nextSequence <= 0) errors.push("workspaceOperationLedger nextSequence must be a positive safe integer");
  if (!Array.isArray(ledger.entries)) errors.push("workspaceOperationLedger entries must be an array");

  const operationIds = new Set();
  const sequences = new Set();
  if (Array.isArray(ledger.entries)) ledger.entries.forEach((entry, index) => {
    validateEntry(entry, ledger, index, errors, operationIds, sequences);
  });
  if (ledger.entries?.filter((entry) => entry?.state === "terminal").length > WORKSPACE_OPERATION_TERMINAL_LIMIT && expected?.allowTerminalOverflow !== true) errors.push("workspaceOperationLedger contains more than 256 terminal entries");

  const expectedWorkspaceId = typeof expected === "string" ? expected : expected?.workspaceId;
  const expectedKey = typeof expected === "object" && expected !== null ? expected.key : undefined;
  if (expectedWorkspaceId !== undefined && ledger.workspaceId !== expectedWorkspaceId) errors.push("workspaceOperationLedger does not match the expected workspaceId");
  if (expectedKey !== undefined) {
    let derived = "";
    try { derived = deriveWorkspaceOperationLedgerKey(ledger.workspaceId); }
    catch (error) { errors.push(safeError(error)); }
    if (derived !== expectedKey) errors.push("workspaceOperationLedger does not match the scoped storage key");
  }
  return { valid: errors.length === 0, errors, ledger: errors.length ? null : ledger };
}

export function isValidWorkspaceOperationRuntimeSessionId(value) { return value === null || nonEmptyString(value); }

export function workspaceOperationLedgerFingerprint(ledger) {
  const validation = snapshotAndValidateWorkspaceOperationLedger(ledger);
  if (!validation.valid) throw new TypeError(validation.errors.join("; "));
  return fingerprintText(stableStringify(validation.ledger));
}

export function validateWorkspaceOperationIntent(intent, expected = {}) {
  const errors = [];
  if (!isPlainObject(intent)) return { valid: false, errors: ["operationIntent must be a plain object"], intent: null };
  try {
    errors.push(...serializableErrors(intent, "operationIntent"));
    if (errors.length) return { valid: false, errors, intent: null };
    intent = clone(intent);
  } catch (error) {
    return { valid: false, errors: ["operationIntent snapshot failed: " + safeError(error)], intent: null };
  }
  exactFields(intent, INTENT_FIELDS, "operationIntent", errors);
  if (!Object.hasOwn(WORKSPACE_OPERATION_COMMAND_SCHEMAS, intent.operationKind)) errors.push("operationIntent operationKind is invalid");
  else if (intent.commandSchema !== WORKSPACE_OPERATION_COMMAND_SCHEMAS[intent.operationKind]) errors.push("operationIntent commandSchema does not match operationKind");
  if (!isValidRuntimeWorkspaceId(intent.primaryWorkspaceId)) errors.push("operationIntent primaryWorkspaceId is invalid");
  validateAffectedWorkspaceIds(intent.affectedWorkspaceIds, intent.primaryWorkspaceId, "operationIntent.affectedWorkspaceIds", errors);
  validateNullableWindow(intent.sourceWindowId, "operationIntent.sourceWindowId", errors);
  validateNullableWindow(intent.targetWindowId, "operationIntent.targetWindowId", errors);
  if (!isValidWorkspaceOperationRuntimeSessionId(intent.expectedRuntimeSessionId)) errors.push("operationIntent expectedRuntimeSessionId is invalid");
  const assignmentAbsent = intent.expectedAssignmentId === null && intent.expectedAssignmentEpoch === null;
  const assignmentPresent = nonEmptyString(intent.expectedAssignmentId) && Number.isSafeInteger(intent.expectedAssignmentEpoch) && intent.expectedAssignmentEpoch > 0;
  if (!assignmentAbsent && !assignmentPresent) errors.push("operationIntent expected assignment identity is invalid");
  validateExpectedRevisions(intent.expectedWorkspaceRevisions, intent.affectedWorkspaceIds, errors);
  for (const field of ["durableSourceIdentity", "durableSnapshotDigest", "browserPlanDigest", "projectionBaselineDigest"]) validateNullableString(intent[field], "operationIntent." + field, errors);
  validateCompatibilityFingerprints(intent.compatibilityPreflightFingerprints, errors);
  validateUniqueStringArray(intent.completedPhasesAtIntentWrite, "operationIntent.completedPhasesAtIntentWrite", errors, false);
  if (!nonEmptyString(intent.nextRecoverablePhaseAtIntentWrite)) errors.push("operationIntent nextRecoverablePhaseAtIntentWrite is invalid");
  validateUniqueStringArray(intent.plannedArtifactIds, "operationIntent.plannedArtifactIds", errors, true);
  if (expected.commandSchema !== undefined && intent.commandSchema !== expected.commandSchema) errors.push("operationIntent commandSchema does not match its entry");
  if (expected.workspaceId !== undefined && intent.primaryWorkspaceId !== expected.workspaceId) errors.push("operationIntent primaryWorkspaceId does not match its entry");
  if (expected.affectedWorkspaceIds !== undefined && stableStringify(intent.affectedWorkspaceIds) !== stableStringify(expected.affectedWorkspaceIds)) errors.push("operationIntent affectedWorkspaceIds do not match its entry");
  if (expected.runtimeSessionId !== undefined && intent.expectedRuntimeSessionId !== expected.runtimeSessionId) errors.push("operationIntent expectedRuntimeSessionId does not match its entry");
  return { valid: errors.length === 0, errors, intent: errors.length ? null : intent };
}

export function createDefaultCompensationEvidence() { return { status: "not_required", actions: [] }; }
export function createInitialRecoveryEvidence(intent) {
  return {
    completedPhases: [...new Set([...intent.completedPhasesAtIntentWrite, "pending_evidence"])],
    nextRecoverablePhase: intent.nextRecoverablePhaseAtIntentWrite,
    createdArtifactIds: []
  };
}

function validateEntry(entry, ledger, index, errors, operationIds, sequences) {
  const path = "workspaceOperationLedger.entries[" + index + "]";
  if (!isPlainObject(entry)) { errors.push(path + " must be a plain object"); return; }
  exactFields(entry, ENTRY_FIELDS, path, errors);
  if (!nonEmptyString(entry.operationId)) errors.push(path + ".operationId is invalid");
  else if (operationIds.has(entry.operationId)) errors.push(path + ".operationId is duplicate");
  else operationIds.add(entry.operationId);
  if (!nonEmptyString(entry.requestFingerprint)) errors.push(path + ".requestFingerprint is invalid");
  if (!Object.values(WORKSPACE_OPERATION_COMMAND_SCHEMAS).includes(entry.commandSchema)) errors.push(path + ".commandSchema is invalid");
  if (entry.workspaceId !== ledger.workspaceId) errors.push(path + ".workspaceId does not match the ledger");
  validateAffectedWorkspaceIds(entry.affectedWorkspaceIds, ledger.workspaceId, path + ".affectedWorkspaceIds", errors);
  if (!isValidWorkspaceOperationRuntimeSessionId(entry.runtimeSessionId)) errors.push(path + ".runtimeSessionId is invalid");
  const intentValidation = validateWorkspaceOperationIntent(entry.operationIntent, { commandSchema: entry.commandSchema, workspaceId: entry.workspaceId, affectedWorkspaceIds: entry.affectedWorkspaceIds, runtimeSessionId: entry.runtimeSessionId });
  if (!intentValidation.valid) errors.push(...intentValidation.errors.map((error) => path + "." + error));
  if (!WORKSPACE_OPERATION_STATES.includes(entry.state)) errors.push(path + ".state is invalid");
  if (!nonEmptyString(entry.phase)) errors.push(path + ".phase is invalid");
  if (!validDateTime(entry.requestedAt)) errors.push(path + ".requestedAt is invalid");
  if (!validDateTime(entry.updatedAt)) errors.push(path + ".updatedAt is invalid");
  validatePlainJsonArray(entry.createdArtifacts, path + ".createdArtifacts", errors);
  validateCompensationEvidence(entry.compensationEvidence, path + ".compensationEvidence", errors);
  validateRecoveryEvidence(entry.recoveryEvidence, entry.state, path + ".recoveryEvidence", errors);
  if (entry.state === "terminal") {
    if (!isPlainObject(entry.result)) errors.push(path + ".result must be a plain object for terminal state");
  } else if (entry.result !== null) errors.push(path + ".result must be null before terminal state");
  if (!Number.isSafeInteger(entry.sequence) || entry.sequence <= 0) errors.push(path + ".sequence must be a positive safe integer");
  else {
    if (sequences.has(entry.sequence)) errors.push(path + ".sequence is duplicate");
    sequences.add(entry.sequence);
    if (Number.isSafeInteger(ledger.nextSequence) && entry.sequence >= ledger.nextSequence) errors.push(path + ".sequence must be below nextSequence");
  }
}

function validateAffectedWorkspaceIds(value, primaryWorkspaceId, path, errors) {
  validateUniqueStringArray(value, path, errors, true, isValidRuntimeWorkspaceId);
  if (Array.isArray(value) && !value.includes(primaryWorkspaceId)) errors.push(path + " must contain the primary workspaceId");
}

function validateExpectedRevisions(value, affectedWorkspaceIds, errors) {
  if (!isPlainObject(value)) { errors.push("operationIntent expectedWorkspaceRevisions must be a plain object"); return; }
  const keys = Object.keys(value).sort(compareCodeUnits);
  if (Array.isArray(affectedWorkspaceIds) && stableStringify(keys) !== stableStringify([...affectedWorkspaceIds].sort(compareCodeUnits))) errors.push("operationIntent expectedWorkspaceRevisions must cover exactly the affected workspaces");
  for (const key of keys) if (!Number.isSafeInteger(value[key]) || value[key] < 0) errors.push("operationIntent expectedWorkspaceRevisions contains an invalid revision");
}

function validateCompatibilityFingerprints(value, errors) {
  if (!isPlainObject(value)) { errors.push("operationIntent compatibilityPreflightFingerprints must be a plain object"); return; }
  exactFields(value, COMPATIBILITY_FINGERPRINT_FIELDS, "operationIntent.compatibilityPreflightFingerprints", errors);
  validateNullableString(value.canonical, "operationIntent.compatibilityPreflightFingerprints.canonical", errors);
  validateNullableString(value.legacy, "operationIntent.compatibilityPreflightFingerprints.legacy", errors);
}

function validateCompensationEvidence(value, path, errors) {
  if (!isPlainObject(value)) { errors.push(path + " must be a plain object"); return; }
  exactFields(value, COMPENSATION_FIELDS, path, errors);
  if (!COMPENSATION_STATUSES.has(value.status)) errors.push(path + ".status is invalid");
  validatePlainJsonArray(value.actions, path + ".actions", errors);
}

function validateRecoveryEvidence(value, state, path, errors) {
  if (!isPlainObject(value)) { errors.push(path + " must be a plain object"); return; }
  exactFields(value, RECOVERY_FIELDS, path, errors);
  validateUniqueStringArray(value.completedPhases, path + ".completedPhases", errors, false);
  if (["pending", "indeterminate"].includes(state) && !nonEmptyString(value.nextRecoverablePhase)) errors.push(path + ".nextRecoverablePhase is required for unresolved state");
  if (state === "terminal" && value.nextRecoverablePhase !== null) errors.push(path + ".nextRecoverablePhase must be null for terminal state");
  validateUniqueStringArray(value.createdArtifactIds, path + ".createdArtifactIds", errors, false);
}

function validateUniqueStringArray(value, path, errors, sorted, validator = nonEmptyString) {
  if (!Array.isArray(value)) { errors.push(path + " must be an array"); return; }
  const seen = new Set();
  for (const item of value) {
    if (!validator(item)) errors.push(path + " contains an invalid value");
    else if (seen.has(item)) errors.push(path + " contains a duplicate value");
    seen.add(item);
  }
  if (sorted && stableStringify(value) !== stableStringify([...value].sort(compareCodeUnits))) errors.push(path + " must be code-unit sorted");
}

function validatePlainJsonArray(value, path, errors) {
  if (!Array.isArray(value)) { errors.push(path + " must be an array"); return; }
  try { errors.push(...serializableErrors(value, path)); }
  catch (error) { errors.push(path + " validation failed: " + safeError(error)); }
}

function validateNullableWindow(value, path, errors) { if (value !== null && (!Number.isSafeInteger(value) || value < 0)) errors.push(path + " is invalid"); }
function validateNullableString(value, path, errors) { if (value !== null && !nonEmptyString(value)) errors.push(path + " is invalid"); }
function exactFields(value, expected, path, errors) { if (stableStringify(Object.keys(value).sort()) !== stableStringify([...expected].sort())) errors.push(path + " fields must match the exact v0.1 contract"); }
function invalid(error) { return { valid: false, errors: [error], ledger: null }; }
function safeError(error) { return String(error?.message || error || "unknown_error"); }
function compareCodeUnits(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function fingerprintText(text) { let hash = 2166136261; for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); } return "fnv1a32:" + (hash >>> 0).toString(16).padStart(8, "0") + ":" + text.length; }
