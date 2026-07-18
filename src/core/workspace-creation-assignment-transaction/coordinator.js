import { assignRuntime, validateAssignmentRegistry } from "../runtime-contract/assignments.js";
import { recordOperation } from "../runtime-contract/ledger.js";
import { clone, isPlainObject, nonEmptyString, serializableErrors, stableStringify } from "../runtime-contract/value-utils.js";
import {
  COORDINATION_DECISIONS,
  COORDINATION_STATUSES,
  WORKSPACE_RESOLUTION_COORDINATION_RESULT_SCHEMA
} from "../workspace-resolution-coordination/contract.js";
import {
  RESULT_FIELDS,
  TRANSACTION_DECISIONS,
  TRANSACTION_PHASES,
  TRANSACTION_STATUSES,
  createTransactionResult,
  normalizeTransactionIdentities,
  readAdapterFunctions,
  snapshotTransactionRequest,
  validateTransactionRequest,
  validateTransactionResult
} from "./contract.js";
import { createTransactionRequestFingerprint } from "./fingerprint.js";
import { classifyAssignmentState, classifyFinalResult, classifyPriorOperation, classifyWorkspaceState, exactAssignment, mapFreshResolution } from "./state-machine.js";

const LEDGER_SCHEMA = "constellation-runtime-operation-ledger-v0.1";
const RESOLUTION_FIELDS = Object.freeze(["schema", "status", "reason", "decision", "operationId", "contextId", "windowId", "resolvedWorkspaceId", "expectedAssignmentEpoch", "collection", "resolution", "retrySafe", "warnings", "errors"]);

export async function coordinateWorkspaceCreationAssignment(request, adapters) {
  const snapshot = snapshotTransactionRequest(request);
  const identities = normalizeTransactionIdentities(snapshot.valid ? snapshot.request : request);
  let requestFingerprint = "";

  if (!snapshot.valid) return result(identities, {
    status: TRANSACTION_STATUSES.invalid,
    reason: "invalid_transaction_request",
    decision: TRANSACTION_DECISIONS.rejectRequest,
    phase: TRANSACTION_PHASES.requestValidation,
    errors: ["request_snapshot_failed"]
  });

  const trustedRequest = snapshot.request;

  try {
    const requestErrors = validateTransactionRequest(trustedRequest);
    if (requestErrors.length) return result(identities, {
      status: TRANSACTION_STATUSES.invalid,
      reason: "invalid_transaction_request",
      decision: TRANSACTION_DECISIONS.rejectRequest,
      phase: TRANSACTION_PHASES.requestValidation,
      errors: requestErrors
    });

    requestFingerprint = createTransactionRequestFingerprint(trustedRequest);
    const extracted = readAdapterFunctions(adapters);
    if (!extracted.valid) return result(identities, {
      status: TRANSACTION_STATUSES.invalid,
      reason: "invalid_transaction_adapters",
      decision: TRANSACTION_DECISIONS.rejectRequest,
      phase: TRANSACTION_PHASES.requestValidation,
      requestFingerprint,
      errors: ["adapter_contract_invalid"]
    });

    const functions = extracted.functions;
    const prior = await readAndInspectLedger(functions, trustedRequest.operationId, requestFingerprint);
    if (!prior.valid) return failure(identities, requestFingerprint, TRANSACTION_PHASES.operationInspection, prior.reason, true);
    if (prior.inspection.status === "conflict") return conflict(identities, requestFingerprint, TRANSACTION_PHASES.operationInspection, "operation_id_fingerprint_conflict");
    if (prior.inspection.status === "replay") return replayStored(identities, requestFingerprint, prior.inspection.entry);

    let callbackCount = 0;
    let callbackResult;
    let callbackOpen = true;
    try {
      const lockReturn = await functions.runExclusiveOperation(async () => {
        callbackCount += 1;
        if (!callbackOpen) return failure(identities, requestFingerprint, TRANSACTION_PHASES.lockAcquisition, "exclusive_operation_callback_after_completion", true);
        if (callbackCount !== 1) return failure(identities, requestFingerprint, TRANSACTION_PHASES.lockAcquisition, "exclusive_operation_callback_reused", true);
        callbackResult = await executeLocked(trustedRequest, identities, requestFingerprint, functions);
        return callbackResult;
      });
    } catch {
      callbackOpen = false;
      return callbackCount > 0
        ? indeterminate(identities, requestFingerprint, TRANSACTION_PHASES.lockAcquisition, "exclusive_operation_completion_uncertain")
        : failure(identities, requestFingerprint, TRANSACTION_PHASES.lockAcquisition, "exclusive_operation_failed", true);
    }
    callbackOpen = false;

    if (callbackCount === 0) return failure(identities, requestFingerprint, TRANSACTION_PHASES.lockAcquisition, "exclusive_operation_callback_not_invoked", true);
    if (callbackCount !== 1 || callbackResult === undefined) return indeterminate(identities, requestFingerprint, TRANSACTION_PHASES.lockAcquisition, "exclusive_operation_callback_count_invalid");
    return ensureCompleteResult(identities, requestFingerprint, callbackResult);
  } catch {
    return result(identities, {
      status: TRANSACTION_STATUSES.failed,
      reason: "transaction_coordination_failed",
      decision: TRANSACTION_DECISIONS.retryTransaction,
      phase: TRANSACTION_PHASES.resultSerialization,
      requestFingerprint,
      retrySafe: true,
      errors: ["unexpected_coordination_failure"]
    });
  }
}

async function executeLocked(request, identities, fingerprint, adapters) {
  const warnings = [];
  const prior = await readAndInspectLedger(adapters, request.operationId, fingerprint);
  if (!prior.valid) return failure(identities, fingerprint, TRANSACTION_PHASES.operationInspection, prior.reason, true);
  if (prior.inspection.status === "conflict") return conflict(identities, fingerprint, TRANSACTION_PHASES.operationInspection, "operation_id_fingerprint_conflict");
  if (prior.inspection.status === "replay") return replayStored(identities, fingerprint, prior.inspection.entry);

  const authorityBaseline = await readAuthority(adapters, request);
  if (!authorityBaseline.valid) return failure(identities, fingerprint, TRANSACTION_PHASES.authorityReread, authorityBaseline.reason, true);

  const fresh = await invoke(adapters.reconfirmWorkspaceResolution, {
    operationId: request.authorization.resolutionOperationId,
    contextId: request.contextId,
    windowId: request.windowId
  });
  if (!fresh.ok || !validResolutionResult(fresh.value, request)) return failure(identities, fingerprint, TRANSACTION_PHASES.resolutionReconfirmation, "resolution_reconfirmation_failed", true);

  const mapped = mapFreshResolution(fresh.value);
  if (mapped.action === "redirect") return result(identities, {
    status: TRANSACTION_STATUSES.redirected,
    reason: "fresh_resolution_found_workspace",
    decision: TRANSACTION_DECISIONS.useExistingWorkspace,
    phase: TRANSACTION_PHASES.complete,
    requestFingerprint: fingerprint,
    resolvedWorkspaceId: mapped.resolvedWorkspaceId
  });
  if (mapped.action === "conflict") return conflict(identities, fingerprint, TRANSACTION_PHASES.resolutionReconfirmation, "fresh_resolution_ambiguous");
  if (mapped.action === "invalid") return result(identities, {
    status: TRANSACTION_STATUSES.invalid,
    reason: "fresh_resolution_invalid",
    decision: TRANSACTION_DECISIONS.rejectRequest,
    phase: TRANSACTION_PHASES.resolutionReconfirmation,
    requestFingerprint: fingerprint
  });
  if (mapped.action === "retry") return failure(identities, fingerprint, TRANSACTION_PHASES.resolutionReconfirmation, "fresh_resolution_failed", true);

  let workspaceCreated = false;
  const workspaceRead = await readWorkspace(adapters, request.workspaceId);
  if (!workspaceRead.valid) return failure(identities, fingerprint, TRANSACTION_PHASES.workspaceRead, workspaceRead.reason, true);

  const workspaceState = classifyWorkspaceState(workspaceRead.status, workspaceRead.workspace, request.workspaceRecord);
  if (workspaceState.action === "conflict") return conflict(identities, fingerprint, TRANSACTION_PHASES.workspaceRead, "workspace_identity_conflict");
  if (workspaceState.action === "retry") return failure(identities, fingerprint, TRANSACTION_PHASES.workspaceRead, "workspace_read_failed", true);

  const baselineAssignmentState = classifyAssignmentState(authorityBaseline.assignmentRegistry, request);
  if (baselineAssignmentState.action === "invalid") return failure(identities, fingerprint, TRANSACTION_PHASES.assignmentTransition, "assignment_registry_invalid", false, { errors: baselineAssignmentState.errors });
  if (workspaceState.action === "create" && baselineAssignmentState.action === "matching") return conflict(identities, fingerprint, TRANSACTION_PHASES.workspaceRead, "assignment_exists_without_workspace", {
    runtimeSessionId: authorityBaseline.runtimeSessionId,
    authorityRevisionBefore: authorityBaseline.authorityRevision
  });
  if (["destination_conflict", "workspace_conflict"].includes(baselineAssignmentState.action)) return conflict(identities, fingerprint, TRANSACTION_PHASES.assignmentTransition, baselineAssignmentState.action, {
    runtimeSessionId: authorityBaseline.runtimeSessionId,
    authorityRevisionBefore: authorityBaseline.authorityRevision
  });

  let workspaceVerification = workspaceRead;
  if (workspaceState.action === "create") {
    const written = await writeWorkspace(adapters, request.workspaceRecord);
    workspaceCreated = written.valid && written.status === "written";
    workspaceVerification = await readWorkspace(adapters, request.workspaceId);
    const verificationAction = workspaceVerification.valid
      ? classifyWorkspaceState(workspaceVerification.status, workspaceVerification.workspace, request.workspaceRecord).action
      : "retry";

    if (verificationAction !== "matching") {
      if (written.valid && written.status === "conflict") return conflict(identities, fingerprint, TRANSACTION_PHASES.workspaceWrite, "workspace_write_conflict");
      if (workspaceVerification.valid && workspaceVerification.status === "absent" && (!written.valid || written.status === "failed")) return failure(identities, fingerprint, TRANSACTION_PHASES.workspaceWrite, "workspace_write_failed", true);
      if (workspaceVerification.valid && workspaceVerification.status === "present") return conflict(identities, fingerprint, TRANSACTION_PHASES.workspaceVerification, "workspace_identity_conflict", { workspaceCreated });
      return indeterminate(identities, fingerprint, TRANSACTION_PHASES.workspaceVerification, "workspace_write_outcome_unverified", { workspaceCreated });
    }
    if (!workspaceCreated) warnings.push("workspace_write_outcome_verified_by_reread");
  } else {
    workspaceVerification = await readWorkspace(adapters, request.workspaceId);
    if (!workspaceVerification.valid || classifyWorkspaceState(workspaceVerification.status, workspaceVerification.workspace, request.workspaceRecord).action !== "matching") return failure(identities, fingerprint, TRANSACTION_PHASES.workspaceVerification, "workspace_verification_failed", true);
  }

  const authority = await readAuthority(adapters, request);
  if (!authority.valid) return failure(identities, fingerprint, TRANSACTION_PHASES.authorityReread, authority.reason, true, { workspaceCreated, workspaceVerified: true, warnings });
  if (authority.runtimeSessionId !== authorityBaseline.runtimeSessionId) return conflict(identities, fingerprint, TRANSACTION_PHASES.authorityReread, "runtime_session_changed", {
    workspaceCreated,
    workspaceVerified: true,
    runtimeSessionId: authority.runtimeSessionId,
    authorityRevisionBefore: authorityBaseline.authorityRevision,
    authorityRevisionAfter: authority.authorityRevision,
    warnings
  });
  if (authority.authorityRevision !== authorityBaseline.authorityRevision) return conflict(identities, fingerprint, TRANSACTION_PHASES.authorityReread, "authority_revision_changed", {
    workspaceCreated,
    workspaceVerified: true,
    runtimeSessionId: authority.runtimeSessionId,
    authorityRevisionBefore: authorityBaseline.authorityRevision,
    authorityRevisionAfter: authority.authorityRevision,
    warnings
  });

  const authorityRevisionBefore = authority.authorityRevision;
  const assignmentState = classifyAssignmentState(authority.assignmentRegistry, request);
  if (assignmentState.action === "invalid") return failure(identities, fingerprint, TRANSACTION_PHASES.assignmentTransition, "assignment_registry_invalid", false, {
    workspaceCreated,
    workspaceVerified: true,
    runtimeSessionId: authority.runtimeSessionId,
    authorityRevisionBefore,
    errors: assignmentState.errors,
    warnings
  });
  if (["destination_conflict", "workspace_conflict"].includes(assignmentState.action)) return conflict(identities, fingerprint, TRANSACTION_PHASES.assignmentTransition, assignmentState.action, {
    workspaceCreated,
    workspaceVerified: true,
    runtimeSessionId: authority.runtimeSessionId,
    authorityRevisionBefore,
    warnings
  });

  let assignmentCreated = false;
  let replayed = assignmentState.action === "matching";
  let expectedAssignment = assignmentState.assignment || null;
  let expectedRevision = authorityRevisionBefore;

  if (assignmentState.action === "assign") {
    const transition = assignRuntime(authority.assignmentRegistry, {
      workspaceId: request.workspaceId,
      windowId: request.windowId,
      sourceContextId: request.contextId,
      now: request.requestedAt,
      id: () => request.runtimeAssignmentId
    });
    if (transition.status !== "assigned" && transition.status !== "no_change") return conflict(identities, fingerprint, TRANSACTION_PHASES.assignmentTransition, transition.reason || transition.status, {
      workspaceCreated,
      workspaceVerified: true,
      runtimeSessionId: authority.runtimeSessionId,
      authorityRevisionBefore,
      warnings
    });

    expectedAssignment = transition.assignment;
    if (transition.status === "assigned") {
      const write = await writeAuthority(adapters, authority, transition.registry);
      expectedRevision = authorityRevisionBefore + 1;
      const verificationAfterWrite = await readAuthority(adapters, request);
      if (!verificationAfterWrite.valid) return indeterminate(identities, fingerprint, TRANSACTION_PHASES.assignmentVerification, "assignment_write_outcome_unverified", {
        workspaceCreated,
        workspaceVerified: true,
        runtimeSessionId: authority.runtimeSessionId,
        authorityRevisionBefore,
        assignmentEpoch: expectedAssignment.assignmentEpoch,
        warnings
      });

      if (!verifiedAuthorityAssignment(verificationAfterWrite, request, expectedAssignment, authority.runtimeSessionId, expectedRevision)) {
        const observedState = classifyAssignmentState(verificationAfterWrite.assignmentRegistry, request);
        const authorityUnchanged = verificationAfterWrite.runtimeSessionId === authority.runtimeSessionId && verificationAfterWrite.authorityRevision === authorityRevisionBefore && observedState.action === "assign";
        if ((!write.valid || write.status !== "written") && authorityUnchanged) return failure(identities, fingerprint, TRANSACTION_PHASES.assignmentVerification, "assignment_write_failed", true, {
          workspaceCreated,
          workspaceVerified: true,
          runtimeSessionId: verificationAfterWrite.runtimeSessionId,
          authorityRevisionBefore,
          authorityRevisionAfter: verificationAfterWrite.authorityRevision,
          assignmentEpoch: expectedAssignment.assignmentEpoch,
          warnings
        });
        if (["destination_conflict", "workspace_conflict"].includes(observedState.action)) return conflict(identities, fingerprint, TRANSACTION_PHASES.assignmentVerification, observedState.action, {
          workspaceCreated,
          workspaceVerified: true,
          runtimeSessionId: verificationAfterWrite.runtimeSessionId,
          authorityRevisionBefore,
          authorityRevisionAfter: verificationAfterWrite.authorityRevision,
          assignmentEpoch: expectedAssignment.assignmentEpoch,
          warnings
        });
        return indeterminate(identities, fingerprint, TRANSACTION_PHASES.assignmentVerification, "assignment_verification_failed", {
          workspaceCreated,
          workspaceVerified: true,
          runtimeSessionId: verificationAfterWrite.runtimeSessionId,
          authorityRevisionBefore,
          authorityRevisionAfter: verificationAfterWrite.authorityRevision,
          assignmentEpoch: expectedAssignment.assignmentEpoch,
          warnings
        });
      }

      assignmentCreated = write.valid && write.status === "written";
      replayed = write.valid && write.status === "conflict";
      if (!assignmentCreated && !replayed) warnings.push("assignment_write_outcome_verified_by_reread");
    }
  }

  const finalWorkspace = await readWorkspace(adapters, request.workspaceId);
  const finalAuthority = await readAuthority(adapters, request);
  const workspaceVerified = finalWorkspace.valid && classifyWorkspaceState(finalWorkspace.status, finalWorkspace.workspace, request.workspaceRecord).action === "matching";
  const assignmentVerified = finalAuthority.valid && verifiedAuthorityAssignment(finalAuthority, request, expectedAssignment, authority.runtimeSessionId, expectedRevision);
  if (!workspaceVerified || !assignmentVerified) return indeterminate(identities, fingerprint, TRANSACTION_PHASES.finalTransactionVerification, "final_transaction_verification_failed", {
    workspaceCreated,
    workspaceVerified,
    assignmentCreated,
    assignmentVerified,
    runtimeSessionId: finalAuthority.runtimeSessionId || authority.runtimeSessionId,
    authorityRevisionBefore,
    authorityRevisionAfter: finalAuthority.authorityRevision,
    assignmentEpoch: expectedAssignment?.assignmentEpoch,
    warnings
  });

  const classification = classifyFinalResult({ workspaceVerified, assignmentVerified, replayed });
  const successful = result(identities, {
    ...classification,
    phase: TRANSACTION_PHASES.complete,
    requestFingerprint: fingerprint,
    workspaceCreated,
    workspaceVerified,
    assignmentCreated,
    assignmentVerified,
    runtimeSessionId: finalAuthority.runtimeSessionId,
    authorityRevisionBefore,
    authorityRevisionAfter: finalAuthority.authorityRevision,
    assignmentEpoch: expectedAssignment.assignmentEpoch,
    replayed,
    warnings
  });
  const recorded = recordOperation(prior.ledger, {
    operationId: request.operationId,
    requestFingerprint: fingerprint,
    result: successful,
    recordedAt: request.requestedAt
  });
  if (recorded.status !== "recorded") return conflict(identities, fingerprint, TRANSACTION_PHASES.operationRecording, "operation_record_conflict", successful);

  const ledgerWrite = await writeLedger(adapters, recorded.ledger);
  if (!ledgerWrite.valid || ledgerWrite.status !== "written") return indeterminate(identities, fingerprint, TRANSACTION_PHASES.operationRecording, "operation_recording_failed", successful);
  return successful;
}

async function readAndInspectLedger(adapters, operationId, fingerprint) {
  const invoked = await invoke(adapters.readOperationLedger);
  if (!invoked.ok || !validLedgerRead(invoked.value)) return { valid: false, reason: "operation_ledger_read_failed" };
  if (invoked.value.status === "failed") return { valid: false, reason: "operation_ledger_read_failed" };
  try {
    const ledger = clone(invoked.value.ledger);
    return { valid: true, ledger, inspection: classifyPriorOperation(ledger, operationId, fingerprint) };
  } catch {
    return { valid: false, reason: "operation_ledger_inspection_failed" };
  }
}

async function readWorkspace(adapters, workspaceId) {
  const invoked = await invoke(adapters.readWorkspace, { workspaceId });
  if (!invoked.ok || !validExactResult(invoked.value, ["status", "workspace", "error"])) return { valid: false, reason: "workspace_read_failed" };
  const value = invoked.value;
  if (!["present", "absent", "failed"].includes(value.status) || typeof value.error !== "string") return { valid: false, reason: "workspace_read_failed" };
  if (value.status === "present" && (!isPlainObject(value.workspace) || serializableErrors(value.workspace, "workspace").length || value.error !== "")) return { valid: false, reason: "workspace_read_malformed" };
  if (value.status === "absent" && (value.workspace !== null || value.error !== "")) return { valid: false, reason: "workspace_read_malformed" };
  if (value.status === "failed") return { valid: false, reason: "workspace_read_failed" };
  return { valid: true, status: value.status, workspace: value.status === "present" ? clone(value.workspace) : null };
}

async function writeWorkspace(adapters, workspace) {
  const invoked = await invoke(adapters.writeWorkspace, { workspace: clone(workspace), expectedAbsent: true });
  if (!invoked.ok || !validExactResult(invoked.value, ["status", "error"]) || !["written", "conflict", "failed"].includes(invoked.value.status) || typeof invoked.value.error !== "string") return { valid: false, status: "failed", reason: "workspace_write_failed" };
  if (invoked.value.status === "written" && invoked.value.error !== "") return { valid: false, status: "failed", reason: "workspace_write_failed" };
  return { valid: true, status: invoked.value.status, reason: invoked.value.status === "conflict" ? "workspace_write_conflict" : "workspace_write_failed" };
}

async function readAuthority(adapters, request) {
  const invoked = await invoke(adapters.readRuntimeAuthority, { contextId: request.contextId, windowId: request.windowId });
  if (!invoked.ok || !validExactResult(invoked.value, ["status", "runtimeSessionId", "authorityRevision", "contextVerified", "assignmentRegistry", "error"])) return { valid: false, reason: "runtime_authority_read_failed" };
  const value = invoked.value;
  if (value.status !== "present" || !nonEmptyString(value.runtimeSessionId) || !Number.isInteger(value.authorityRevision) || value.authorityRevision < 0 || value.contextVerified !== true || typeof value.error !== "string" || value.error !== "") return { valid: false, reason: "runtime_authority_invalid" };
  const validation = validateAssignmentRegistry(value.assignmentRegistry);
  if (!validation.valid) return { valid: false, reason: "assignment_registry_invalid" };
  return { valid: true, runtimeSessionId: value.runtimeSessionId, authorityRevision: value.authorityRevision, assignmentRegistry: clone(value.assignmentRegistry) };
}

async function writeAuthority(adapters, authority, nextAssignmentRegistry) {
  const invoked = await invoke(adapters.writeRuntimeAuthority, {
    expectedRuntimeSessionId: authority.runtimeSessionId,
    expectedAuthorityRevision: authority.authorityRevision,
    nextAssignmentRegistry: clone(nextAssignmentRegistry)
  });
  if (!invoked.ok || !validExactResult(invoked.value, ["status", "runtimeSessionId", "authorityRevision", "error"])) return { valid: false, status: "failed" };
  const value = invoked.value;
  if (!["written", "conflict", "failed"].includes(value.status) || typeof value.error !== "string") return { valid: false, status: "failed" };
  if (value.status === "written" && (value.runtimeSessionId !== authority.runtimeSessionId || value.authorityRevision !== authority.authorityRevision + 1 || value.error !== "")) return { valid: false, status: "failed" };
  return { valid: true, status: value.status };
}

async function writeLedger(adapters, ledger) {
  const invoked = await invoke(adapters.writeOperationLedger, clone(ledger));
  if (!invoked.ok || !validExactResult(invoked.value, ["status", "error"]) || !["written", "conflict", "failed"].includes(invoked.value.status) || typeof invoked.value.error !== "string") return { valid: false, status: "failed" };
  if (invoked.value.status === "written" && invoked.value.error !== "") return { valid: false, status: "failed" };
  return { valid: true, status: invoked.value.status };
}

function validResolutionResult(value, request) {
  try {
    if (!validExactResult(value, RESOLUTION_FIELDS) || value.schema !== WORKSPACE_RESOLUTION_COORDINATION_RESULT_SCHEMA || value.operationId !== request.authorization.resolutionOperationId || value.contextId !== request.contextId || value.windowId !== request.windowId) return false;
    if (!nonEmptyString(value.reason) || typeof value.retrySafe !== "boolean" || !Array.isArray(value.collection) || !(value.resolution === null || isPlainObject(value.resolution)) || !Array.isArray(value.warnings) || !value.warnings.every((item) => typeof item === "string") || !Array.isArray(value.errors) || !value.errors.every((item) => typeof item === "string")) return false;
    if (!(value.expectedAssignmentEpoch === null || (Number.isInteger(value.expectedAssignmentEpoch) && value.expectedAssignmentEpoch > 0))) return false;
    if (value.status === COORDINATION_STATUSES.creationRequired) return value.decision === COORDINATION_DECISIONS.createWorkspaceAndAssign && value.resolvedWorkspaceId === null;
    if (value.status === COORDINATION_STATUSES.resolved) return value.decision === COORDINATION_DECISIONS.useResolvedWorkspace && nonEmptyString(value.resolvedWorkspaceId);
    if (value.status === COORDINATION_STATUSES.ambiguous) return value.decision === COORDINATION_DECISIONS.manualResolutionRequired && value.resolvedWorkspaceId === null;
    if (value.status === COORDINATION_STATUSES.invalid) return value.decision === COORDINATION_DECISIONS.rejectRequest && value.resolvedWorkspaceId === null;
    if (value.status === COORDINATION_STATUSES.failed) return value.decision === COORDINATION_DECISIONS.retryCollection && value.resolvedWorkspaceId === null && value.retrySafe;
    return false;
  } catch {
    return false;
  }
}

function validLedgerRead(value) {
  try {
    if (!validExactResult(value, ["status", "ledger", "error"]) || !["present", "failed"].includes(value.status) || typeof value.error !== "string") return false;
    if (value.status === "failed") return value.ledger === null && nonEmptyString(value.error);
    const ledger = value.ledger;
    if (!(value.error === "" && isPlainObject(ledger) && ledger.schema === LEDGER_SCHEMA && Number.isInteger(ledger.maxEntries) && ledger.maxEntries > 0 && Number.isInteger(ledger.nextSequence) && ledger.nextSequence > 0 && Array.isArray(ledger.entries) && serializableErrors(ledger, "ledger").length === 0)) return false;
    const operationIds = new Set(), sequences = new Set();
    let maximumSequence = 0;
    for (const entry of ledger.entries) {
      if (!isPlainObject(entry) || !nonEmptyString(entry.operationId) || typeof entry.requestFingerprint !== "string" || !Number.isInteger(entry.sequence) || entry.sequence <= 0 || operationIds.has(entry.operationId) || sequences.has(entry.sequence)) return false;
      operationIds.add(entry.operationId);
      sequences.add(entry.sequence);
      maximumSequence = Math.max(maximumSequence, entry.sequence);
    }
    return ledger.entries.length <= ledger.maxEntries && ledger.nextSequence > maximumSequence;
  } catch {
    return false;
  }
}

function validExactResult(value, fields) {
  try {
    return isPlainObject(value) && stableStringify(Object.keys(value).sort()) === stableStringify([...fields].sort()) && serializableErrors(value, "adapterResult").length === 0;
  } catch {
    return false;
  }
}

function verifiedAuthorityAssignment(authority, request, expected, sessionId, revision) {
  const state = authority.valid ? classifyAssignmentState(authority.assignmentRegistry, request) : { action: "invalid" };
  return authority.valid && authority.runtimeSessionId === sessionId && authority.authorityRevision === revision && state.action === "matching" && exactAssignment(state.assignment, request) && state.assignment.assignmentEpoch === expected?.assignmentEpoch;
}

async function invoke(adapter, ...args) {
  try {
    const value = await adapter(...args);
    const snapshot = structuredClone(value);
    if (serializableErrors(snapshot, "adapterResult").length) return { ok: false };
    return { ok: true, value: snapshot };
  } catch {
    return { ok: false };
  }
}

function replayStored(identities, fingerprint, entry) {
  try {
    if (!validateTransactionResult(entry?.result) || !resultMatchesExpected(entry.result, identities, fingerprint) || ![TRANSACTION_STATUSES.committed, TRANSACTION_STATUSES.replayed].includes(entry.result.status) || !entry.result.workspaceVerified || !entry.result.assignmentVerified) return conflict(identities, fingerprint, TRANSACTION_PHASES.operationInspection, "operation_replay_result_invalid");
    return ensureCompleteResult(identities, fingerprint, {
      ...clone(entry.result),
      status: TRANSACTION_STATUSES.replayed,
      reason: "operation_replayed",
      phase: TRANSACTION_PHASES.complete,
      replayed: true
    });
  } catch {
    return conflict(identities, fingerprint, TRANSACTION_PHASES.operationInspection, "operation_replay_result_invalid");
  }
}

function result(identities, fields) { return createTransactionResult(identities, fields); }
function failure(identities, fingerprint, phase, reason, retrySafe, fields = {}) { return result(identities, { ...fields, status: TRANSACTION_STATUSES.failed, reason, decision: TRANSACTION_DECISIONS.retryTransaction, phase, requestFingerprint: fingerprint, retrySafe }); }
function conflict(identities, fingerprint, phase, reason, fields = {}) { return result(identities, { ...fields, status: TRANSACTION_STATUSES.conflict, reason, decision: TRANSACTION_DECISIONS.manualResolutionRequired, phase, requestFingerprint: fingerprint }); }
function indeterminate(identities, fingerprint, phase, reason, fields = {}) { return result(identities, { ...fields, status: TRANSACTION_STATUSES.indeterminate, reason, decision: TRANSACTION_DECISIONS.retryTransaction, phase, requestFingerprint: fingerprint, retrySafe: true, indeterminate: true }); }
function resultMatchesExpected(value, identities, fingerprint) {
  return value.operationId === identities.operationId && value.contextId === identities.contextId && value.windowId === identities.windowId && value.workspaceId === identities.workspaceId && value.runtimeAssignmentId === identities.runtimeAssignmentId && value.requestFingerprint === fingerprint;
}

function ensureCompleteResult(identities, fingerprint, value) {
  try { return validateTransactionResult(value) && resultMatchesExpected(value, identities, fingerprint) ? value : failure(identities, fingerprint, TRANSACTION_PHASES.resultSerialization, "invalid_coordinator_result", true); }
  catch { return failure(identities, fingerprint, TRANSACTION_PHASES.resultSerialization, "invalid_coordinator_result", true); }
}
