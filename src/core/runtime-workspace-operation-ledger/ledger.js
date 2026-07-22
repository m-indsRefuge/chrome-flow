import { inspectOperation } from "../runtime-contract/ledger.js";
import { clone, isPlainObject, nonEmptyString, serializableErrors, stableStringify, validDateTime } from "../runtime-contract/value-utils.js";
import {
  WORKSPACE_OPERATION_COMMAND_SCHEMAS,
  WORKSPACE_OPERATION_TERMINAL_LIMIT,
  createDefaultCompensationEvidence,
  createInitialRecoveryEvidence,
  isValidWorkspaceOperationRuntimeSessionId,
  snapshotAndValidateWorkspaceOperationLedger,
  validateWorkspaceOperationIntent
} from "./contract.js";

export function recordImmutableOperationIntent(ledger, details) {
  const validation = snapshotAndValidateWorkspaceOperationLedger(ledger);
  if (!validation.valid) return outcome("malformed_recovery_evidence", "ledger_invalid", ledger, null, validation.errors);
  const current = validation.ledger;
  const replay = inspectWorkspaceOperation(current, details?.operationId, details?.requestFingerprint);
  if (replay.status !== "missing") return { ...replay, ledger: current };
  const errors = validateIntentDetails(details, current.workspaceId);
  if (errors.length) return outcome("rejected", "operation_intent_invalid", current, null, errors);
  if (current.nextSequence >= Number.MAX_SAFE_INTEGER) return outcome("rejected", "ledger_sequence_exhausted", current);

  const intentValidation = validateWorkspaceOperationIntent(details.operationIntent, {
    commandSchema: details.commandSchema,
    workspaceId: current.workspaceId,
    affectedWorkspaceIds: details.affectedWorkspaceIds,
    runtimeSessionId: details.runtimeSessionId
  });
  if (!intentValidation.valid) return outcome("rejected", "operation_intent_invalid", current, null, intentValidation.errors);
  const entry = {
    operationId: details.operationId,
    requestFingerprint: details.requestFingerprint,
    commandSchema: details.commandSchema,
    workspaceId: current.workspaceId,
    affectedWorkspaceIds: [...details.affectedWorkspaceIds],
    runtimeSessionId: details.runtimeSessionId,
    operationIntent: intentValidation.intent,
    state: "pending",
    phase: "pending_evidence",
    requestedAt: details.requestedAt,
    updatedAt: details.requestedAt,
    createdArtifacts: [],
    compensationEvidence: createDefaultCompensationEvidence(),
    result: null,
    recoveryEvidence: createInitialRecoveryEvidence(intentValidation.intent),
    sequence: current.nextSequence
  };
  const next = clone(current);
  next.entries.push(entry);
  next.nextSequence += 1;
  const nextValidation = snapshotAndValidateWorkspaceOperationLedger(next);
  if (!nextValidation.valid) return outcome("rejected", "operation_intent_invalid", current, null, nextValidation.errors);
  return outcome("recorded", "", nextValidation.ledger, entry);
}

export function appendOperationProgress(ledger, operationId, requestFingerprint, progress) {
  const validation = snapshotAndValidateWorkspaceOperationLedger(ledger);
  if (!validation.valid) return outcome("malformed_recovery_evidence", "ledger_invalid", ledger, null, validation.errors);
  const inspected = inspectWorkspaceOperation(validation.ledger, operationId, requestFingerprint);
  if (inspected.status !== "recovery_required") return { ...inspected, ledger: validation.ledger };
  const errors = validateProgress(progress);
  if (errors.length) return outcome("rejected", "operation_progress_invalid", validation.ledger, inspected.entry, errors);
  const next = clone(validation.ledger);
  const entry = next.entries.find((candidate) => candidate.operationId === operationId);
  const originalIntent = stableStringify(entry.operationIntent);
  entry.state = progress.state || "pending";
  entry.phase = progress.phase;
  entry.updatedAt = progress.updatedAt;
  appendUnique(entry.recoveryEvidence.completedPhases, progress.completedPhases || []);
  entry.recoveryEvidence.nextRecoverablePhase = progress.nextRecoverablePhase;
  appendUnique(entry.recoveryEvidence.createdArtifactIds, progress.createdArtifactIds || []);
  entry.createdArtifacts.push(...clone(progress.createdArtifacts || []));
  if (progress.compensationActions?.length) {
    entry.compensationEvidence.status = progress.compensationStatus || "pending";
    entry.compensationEvidence.actions.push(...clone(progress.compensationActions));
  } else if (progress.compensationStatus) entry.compensationEvidence.status = progress.compensationStatus;
  if (stableStringify(entry.operationIntent) !== originalIntent) return outcome("rejected", "operation_intent_mutation", validation.ledger, inspected.entry);
  const nextValidation = snapshotAndValidateWorkspaceOperationLedger(next);
  if (!nextValidation.valid) return outcome("rejected", "operation_progress_invalid", validation.ledger, inspected.entry, nextValidation.errors);
  return outcome("progress_recorded", "", nextValidation.ledger, nextValidation.ledger.entries.find((candidate) => candidate.operationId === operationId));
}

export function recordWorkspaceOperationTerminal(ledger, operationId, requestFingerprint, terminal) {
  const validation = snapshotAndValidateWorkspaceOperationLedger(ledger);
  if (!validation.valid) return outcome("malformed_recovery_evidence", "ledger_invalid", ledger, null, validation.errors);
  const inspected = inspectWorkspaceOperation(validation.ledger, operationId, requestFingerprint);
  if (inspected.status !== "recovery_required") return { ...inspected, ledger: validation.ledger };
  const errors = [];
  if (!nonEmptyString(terminal?.phase) || !validDateTime(terminal?.updatedAt)) errors.push("terminal phase and updatedAt are required");
  if (!isPlainObject(terminal?.result)) errors.push("terminal result must be a plain object");
  try { errors.push(...serializableErrors(terminal?.result, "terminal.result")); }
  catch (error) { errors.push(String(error?.message || error)); }
  if (errors.length) return outcome("rejected", "terminal_evidence_invalid", validation.ledger, inspected.entry, errors);
  const next = clone(validation.ledger);
  const entry = next.entries.find((candidate) => candidate.operationId === operationId);
  const originalIntent = stableStringify(entry.operationIntent);
  entry.state = "terminal";
  entry.phase = terminal.phase;
  entry.updatedAt = terminal.updatedAt;
  entry.result = clone(terminal.result);
  entry.recoveryEvidence.nextRecoverablePhase = null;
  appendUnique(entry.recoveryEvidence.completedPhases, terminal.completedPhases || []);
  if (terminal.compensationStatus) entry.compensationEvidence.status = terminal.compensationStatus;
  if (terminal.compensationActions?.length) entry.compensationEvidence.actions.push(...clone(terminal.compensationActions));
  if (stableStringify(entry.operationIntent) !== originalIntent) return outcome("rejected", "operation_intent_mutation", validation.ledger, inspected.entry);
  const pruned = pruneWorkspaceOperationTerminals(next);
  if (pruned.status !== "pruned" && pruned.status !== "no_change") return pruned;
  const finalValidation = snapshotAndValidateWorkspaceOperationLedger(pruned.ledger);
  if (!finalValidation.valid) return outcome("rejected", "terminal_evidence_invalid", validation.ledger, inspected.entry, finalValidation.errors);
  return outcome("terminal_recorded", "", finalValidation.ledger, finalValidation.ledger.entries.find((candidate) => candidate.operationId === operationId) || entry);
}

export function inspectWorkspaceOperation(ledger, operationId, requestFingerprint) {
  const validation = snapshotAndValidateWorkspaceOperationLedger(ledger);
  if (!validation.valid) return outcome("malformed_recovery_evidence", "ledger_invalid", ledger, null, validation.errors);
  if (!nonEmptyString(operationId) || !nonEmptyString(requestFingerprint)) return outcome("rejected", "operation_identity_invalid", validation.ledger);
  const inspected = inspectOperation(validation.ledger, operationId, requestFingerprint);
  if (inspected.status === "missing") return outcome("missing", "", validation.ledger);
  if (inspected.status === "conflict") return outcome("operation_id_conflict", "request_fingerprint_mismatch", validation.ledger, inspected.entry);
  if (inspected.entry.state === "terminal") return outcome("terminal_replay", "", validation.ledger, inspected.entry);
  return { ...outcome("recovery_required", "unresolved_operation", validation.ledger, inspected.entry), requiresFreshAuthority: true };
}

export function pruneWorkspaceOperationTerminals(ledger) {
  const validation = snapshotAndValidateWorkspaceOperationLedger(ledger, { allowTerminalOverflow: true });
  if (!validation.valid) return outcome("malformed_recovery_evidence", "ledger_invalid", ledger, null, validation.errors);
  const terminal = validation.ledger.entries.filter((entry) => entry.state === "terminal").sort((left, right) => left.sequence - right.sequence);
  const excess = terminal.length - WORKSPACE_OPERATION_TERMINAL_LIMIT;
  if (excess <= 0) return outcome("no_change", "", validation.ledger);
  const removed = new Set(terminal.slice(0, excess).map((entry) => entry.operationId));
  const next = clone(validation.ledger);
  next.entries = next.entries.filter((entry) => !removed.has(entry.operationId));
  return { ...outcome("pruned", "", next), prunedOperationIds: [...removed] };
}

function validateIntentDetails(details, workspaceId) {
  const errors = [];
  if (!nonEmptyString(details?.operationId)) errors.push("operationId is invalid");
  if (!nonEmptyString(details?.requestFingerprint)) errors.push("requestFingerprint is invalid");
  if (!Object.values(WORKSPACE_OPERATION_COMMAND_SCHEMAS).includes(details?.commandSchema)) errors.push("commandSchema is invalid");
  if (!Array.isArray(details?.affectedWorkspaceIds) || !details.affectedWorkspaceIds.includes(workspaceId)) errors.push("affectedWorkspaceIds must include the ledger workspace");
  if (!isValidWorkspaceOperationRuntimeSessionId(details?.runtimeSessionId)) errors.push("runtimeSessionId is invalid");
  if (!validDateTime(details?.requestedAt)) errors.push("requestedAt is invalid");
  return errors;
}

function validateProgress(progress) {
  const errors = [];
  if (!isPlainObject(progress)) return ["progress must be a plain object"];
  if (!nonEmptyString(progress.phase) || !validDateTime(progress.updatedAt)) errors.push("progress phase and updatedAt are required");
  if (!nonEmptyString(progress.nextRecoverablePhase)) errors.push("progress nextRecoverablePhase is required");
  if (progress.state !== undefined && !["pending", "indeterminate"].includes(progress.state)) errors.push("progress state is invalid");
  for (const field of ["completedPhases", "createdArtifactIds"]) if (progress[field] !== undefined && (!Array.isArray(progress[field]) || progress[field].some((item) => !nonEmptyString(item)))) errors.push(field + " is invalid");
  if (progress.createdArtifacts !== undefined && !Array.isArray(progress.createdArtifacts)) errors.push("createdArtifacts is invalid");
  if (progress.compensationActions !== undefined && !Array.isArray(progress.compensationActions)) errors.push("compensationActions is invalid");
  return errors;
}

function appendUnique(target, values) { for (const value of values) if (!target.includes(value)) target.push(value); }
function outcome(status, reason, ledger, entry = null, errors = []) { return { status, reason, ledger: safeClone(ledger), entry: safeClone(entry), warnings: [], errors: Array.isArray(errors) ? errors.filter((item) => typeof item === "string") : [] }; }
function safeClone(value) { try { return value === null || value === undefined ? null : clone(value); } catch { return null; } }
