import { inspectOperation, recordOperation } from "../runtime-contract/ledger.js";
import { clone, nonEmptyString, stableStringify } from "../runtime-contract/value-utils.js";
import { validateOperationLedger } from "../journal-append-coordination/ledger-validation.js";
import { createActivationRequestFingerprint } from "../runtime-workspace-activation/contract.js";
import { snapshotAndValidatePromotionState } from "../workspace-automatic-promotion-transaction/contract.js";
import {
  createManualPlacementPending,
  createManualPlacementResult,
  createManualPlacementTransferRequest,
  normalizeManualPlacementIdentities,
  readManualPlacementAdapters,
  snapshotAndValidateManualPlacementRequest,
  snapshotSerializable,
  validateManualPlacementPending,
  validateManualPlacementResult,
  validateManualPlacementActivationEvidence,
  validateManualPlacementMoveEvidence
} from "./contract.js";
import { createManualPlacementFingerprint } from "./fingerprint.js";

export async function coordinateWorkspaceManualPlacement(input, adaptersInput) {
  const validation = snapshotAndValidateManualPlacementRequest(input);
  const identities = normalizeManualPlacementIdentities(validation.value || {});
  if (!validation.ok) return invalid(identities, "", validation.errors);
  const request = validation.value;
  const fingerprint = createManualPlacementFingerprint(request);
  const adapters = readManualPlacementAdapters(adaptersInput);
  if (!adapters) return failed(identities, fingerprint, "lock_acquisition", "manual_placement_adapters_invalid", false);
  return runExclusive(adapters.runExclusiveOperation, (isExclusiveActive) => coordinateLocked(request, identities, fingerprint, adapters, isExclusiveActive), identities, fingerprint, request);
}

async function coordinateLocked(request, identities, fingerprint, adapters, isExclusiveActive) {
  let ledgerRead = await readLedger(adapters);
  if (!ledgerRead.valid) return failed(identities, fingerprint, "operation_inspection", ledgerRead.reason, true);
  const inspection = inspectOperation(ledgerRead.ledger, request.operationId, fingerprint);
  if (inspection.status === "conflict") return conflict(identities, fingerprint, "operation_inspection", "operation_id_conflict");
  if (inspection.status === "replay" && validateManualPlacementResult(inspection.entry.result, request) && inspection.entry.result.requestFingerprint === fingerprint) return replay(identities, fingerprint, inspection.entry.result);

  let pending = inspection.status === "replay" && validateManualPlacementPending(inspection.entry.result, request, fingerprint)
    ? inspection.entry.result
    : null;
  if (inspection.status === "replay" && !pending) return conflict(identities, fingerprint, "operation_inspection", "operation_replay_result_invalid");

  let state = await readState(adapters, request.workspaceId);
  if (!state.valid) return failed(identities, fingerprint, "state_reread", state.reason, true);
  if (state.workspaceId !== request.workspaceId) return conflict(identities, fingerprint, "state_reread", "active_workspace_changed");
  if (pending === null && state.workspaceRevision !== request.expectedWorkspaceRevision) return conflict(identities, fingerprint, "state_reread", "workspace_revision_changed");

  if (pending === null) {
    pending = createManualPlacementPending(request, fingerprint, { baselineSourceWindowIds: state.sourceWindowIds });
    if (!isExclusiveActive()) return failed(identities, fingerprint, "lock_acquisition", "exclusive_operation_detached", true);
    const persisted = await persistNewPending(adapters, ledgerRead.ledger, request, fingerprint, pending);
    if (!persisted.valid) return failed(identities, fingerprint, "pending_recording", persisted.reason, true);
    ledgerRead = persisted.ledgerRead;
  }

  let moveResult = pending.moveResult;
  let targetWindowId = pending.targetWindowId;
  const warnings = [];
  if (moveResult && (!verifiedMoveResult(moveResult, request) || targetWindowId !== moveResult.targetWindowId)) {
    return conflict(identities, fingerprint, "operation_inspection", "pending_move_evidence_invalid");
  }
  if (pending.activationResult && (!moveResult || !verifiedTransferResult(pending.activationResult, request, targetWindowId))) {
    return conflict(identities, fingerprint, "operation_inspection", "pending_activation_evidence_invalid");
  }
  if (!moveResult) {
    if (pending.browserMutationStarted) {
      return indeterminate(identities, fingerprint, "browser_move", "pending_browser_move_unresolved", { browserMutationStarted: true, browserMutationVerified: false, warnings: ["second_destination_suppressed"] });
    } else {
      pending = createManualPlacementPending(request, fingerprint, { ...pending, browserMutationStarted: true });
      if (!isExclusiveActive()) return failed(identities, fingerprint, "lock_acquisition", "exclusive_operation_detached", true);
      const attemptRecorded = await replacePending(adapters, request, fingerprint, pending);
      if (!attemptRecorded.valid) return failed(identities, fingerprint, "pending_recording", "browser_move_attempt_recording_failed", true);
      if (!isExclusiveActive()) return failed(identities, fingerprint, "lock_acquisition", "exclusive_operation_detached", true);
      const move = await invoke(adapters.executeExistingTabMove, request.moveRequest);
      if (!move.ok || !verifiedMoveResult(move.value, request)) {
        if (move.ok && move.value?.browserMutationStarted === false) {
          pending = createManualPlacementPending(request, fingerprint, { ...pending, browserMutationStarted: false });
          const reset = isExclusiveActive() ? await replacePending(adapters, request, fingerprint, pending) : { valid: false };
          if (reset.valid) return failed(identities, fingerprint, "browser_move", "browser_move_not_verified", true, { moveResult: move.value, browserMutationStarted: false, browserMutationVerified: false });
        }
        return indeterminate(identities, fingerprint, "browser_move", move.ok ? "browser_move_not_verified" : "browser_move_outcome_unknown", { moveResult: move.ok ? move.value : null, browserMutationStarted: true, browserMutationVerified: false, warnings: ["second_destination_suppressed"] });
      }
      moveResult = move.value;
      targetWindowId = moveResult.targetWindowId;
    }
    pending = createManualPlacementPending(request, fingerprint, { ...pending, browserMutationStarted: true, moveResult, targetWindowId });
    if (!isExclusiveActive()) return indeterminate(identities, fingerprint, "pending_recording", "exclusive_operation_detached_after_browser_move", { targetWindowId, moveResult, browserMutationStarted: true, browserMutationVerified: true, warnings });
    const updated = await replacePending(adapters, request, fingerprint, pending);
    if (!updated.valid) return indeterminate(identities, fingerprint, "pending_recording", "moved_browser_evidence_recording_failed", { targetWindowId, moveResult, browserMutationStarted: true, browserMutationVerified: true, warnings });
    state = await readState(adapters, request.workspaceId);
    if (!state.valid || !browserStateMatchesTarget(state, request, targetWindowId)) return indeterminate(identities, fingerprint, "browser_move", "moved_browser_projection_not_verified", { targetWindowId, moveResult, browserMutationStarted: true, browserMutationVerified: false, warnings });
  }

  let activationResult = pending.activationResult;
  if (!activationResult) {
    const currentLedger = await readLedger(adapters);
    const transferRequest = createManualPlacementTransferRequest(request, targetWindowId);
    const transferFingerprint = createActivationRequestFingerprint(transferRequest);
    const transferInspection = currentLedger.valid ? inspectOperation(currentLedger.ledger, request.transferOperationId, transferFingerprint) : { status: "missing" };
    const storedTransfer = transferInspection.status === "replay" ? transferInspection.entry.result : null;
    if (verifiedTransferResult(storedTransfer, request, targetWindowId)) {
      activationResult = storedTransfer;
      warnings.push("verified_transfer_recovered_from_shared_ledger");
    }
  }
  if (!activationResult) {
    if (!isExclusiveActive()) return indeterminate(identities, fingerprint, "assignment_transfer", "exclusive_operation_detached_after_browser_move", { targetWindowId, moveResult, browserMutationStarted: true, browserMutationVerified: true, warnings });
    const transfer = await invoke(adapters.transferActive, createManualPlacementTransferRequest(request, targetWindowId));
    activationResult = transfer.ok ? transfer.value : null;
    if (!verifiedTransferResult(activationResult, request, targetWindowId)) return indeterminate(identities, fingerprint, "assignment_transfer", "assignment_transfer_not_verified", { targetWindowId, moveResult, activationResult, browserMutationStarted: true, browserMutationVerified: true, warnings });
    pending = createManualPlacementPending(request, fingerprint, { ...pending, baselineSourceWindowIds: pending.baselineSourceWindowIds, moveResult, targetWindowId, activationResult });
    if (!isExclusiveActive()) return indeterminate(identities, fingerprint, "pending_recording", "exclusive_operation_detached_after_transfer", transferEvidence(activationResult, { targetWindowId, moveResult, warnings }));
    const updated = await replacePending(adapters, request, fingerprint, pending);
    if (!updated.valid) return indeterminate(identities, fingerprint, "pending_recording", "assignment_evidence_recording_failed", transferEvidence(activationResult, { targetWindowId, moveResult, warnings }));
  }

  state = await readState(adapters, request.workspaceId);
  if (!state.valid) return indeterminate(identities, fingerprint, "placement_write", "placement_state_read_failed", transferEvidence(activationResult, { targetWindowId, moveResult, warnings }));
  const timelineEvent = createManualPlacementTimelineEvent(request, targetWindowId, activationResult);
  let placementWritten = false;
  let timelineEvidenceWritten = false;
  let placementVerified = state.placementMode === "dedicated_window" && state.dedicatedWindowId === targetWindowId && state.workspaceRevision === request.expectedWorkspaceRevision + 1 && browserStateMatchesTarget(state, request, targetWindowId);
  let timelineEvidence = await readTimelineEvidence(adapters, request.workspaceId, timelineEvent);
  if (!placementVerified) {
    if (state.workspaceRevision !== request.expectedWorkspaceRevision) return indeterminate(identities, fingerprint, "placement_write", "workspace_revision_changed_after_transfer", transferEvidence(activationResult, { targetWindowId, moveResult, warnings }));
    if (!isExclusiveActive()) return indeterminate(identities, fingerprint, "placement_write", "exclusive_operation_detached_after_transfer", transferEvidence(activationResult, { targetWindowId, moveResult, warnings }));
    const write = await invoke(adapters.writeWorkspacePlacement, {
      workspaceId: request.workspaceId,
      expectedWorkspaceRevision: request.expectedWorkspaceRevision,
      nextWorkspaceRevision: request.expectedWorkspaceRevision + 1,
      placementMode: "dedicated_window",
      dedicatedWindowId: targetWindowId,
      moveResult,
      timelineEvent
    });
    const finalState = await readState(adapters, request.workspaceId);
    timelineEvidence = await readTimelineEvidence(adapters, request.workspaceId, timelineEvent);
    placementVerified = finalState.valid && finalState.workspaceRevision === request.expectedWorkspaceRevision + 1 && finalState.placementMode === "dedicated_window" && finalState.dedicatedWindowId === targetWindowId && browserStateMatchesTarget(finalState, request, targetWindowId);
    if (!placementVerified || !timelineEvidence.valid) {
      return indeterminate(identities, fingerprint, "placement_write", placementVerified ? "manual_placement_timeline_evidence_not_verified" : "workspace_placement_not_verified", transferEvidence(activationResult, {
        targetWindowId,
        moveResult,
        workspacePlacementWritten: write.ok && write.value?.status === "written",
        workspacePlacementVerified: placementVerified,
        timelineEvidenceWritten: write.ok && write.value?.status === "written",
        timelineEvidenceVerified: timelineEvidence.valid,
        timelineEventId: timelineEvent.eventId,
        warnings
      }));
    }
    placementWritten = write.ok && write.value?.status === "written";
    timelineEvidenceWritten = placementWritten;
    if (!placementWritten) warnings.push("placement_write_outcome_verified_by_reread");
  } else if (!timelineEvidence.valid) {
    return indeterminate(identities, fingerprint, "placement_write", "manual_placement_timeline_evidence_not_verified", transferEvidence(activationResult, {
      targetWindowId,
      moveResult,
      workspacePlacementVerified: true,
      timelineEvidenceVerified: false,
      timelineEventId: timelineEvent.eventId,
      warnings
    }));
  }

  const successful = createManualPlacementResult(identities, {
    status: "committed", reason: "manual_placement_committed", decision: "use_dedicated_window", phase: "complete", requestFingerprint: fingerprint,
    targetWindowId, workspaceRevisionAfter: request.expectedWorkspaceRevision + 1, moveResult, activationResult,
    browserMutationStarted: true, browserMutationVerified: true, assignmentTransferred: transferOccurred(activationResult),
    assignmentVerified: true, currentRuntimeAssignmentId: activationResult.currentRuntimeAssignmentId,
    currentAssignmentEpoch: activationResult.currentAssignmentEpoch, workspacePlacementWritten: placementWritten,
    workspacePlacementVerified: true, timelineEvidenceWritten, timelineEvidenceVerified: true,
    timelineEventId: timelineEvent.eventId, warnings
  });
  if (!isExclusiveActive()) return indeterminate(identities, fingerprint, "operation_recording", "exclusive_operation_detached_after_business_state", { ...successful, warnings });
  const terminal = await replacePendingWithTerminal(adapters, request, fingerprint, successful);
  return terminal.valid ? successful : indeterminate(identities, fingerprint, "operation_recording", "terminal_operation_recording_failed", { ...successful, warnings });
}

function browserStateMatchesTarget(state, request, targetWindowId) {
  if (!safeId(targetWindowId) || targetWindowId === request.sourceWindowId || state.sourceWindowIds.length !== 1 || state.sourceWindowIds[0] !== targetWindowId) return false;
  if (!Array.isArray(state.tabs) || state.tabs.some((tab) => tab?.sourceWindowId !== targetWindowId)) return false;
  const expectedTabs = request.moveRequest.tabs
    .map((tab) => ({ workspaceTabId: tab.workspaceTabId, tabId: tab.tabId }))
    .sort(compareWorkspaceTabs);
  const observedTabs = state.tabs
    .map((tab) => ({ workspaceTabId: tab.workspaceTabId, tabId: tab.tabId }))
    .sort(compareWorkspaceTabs);
  return stableStringify(observedTabs) === stableStringify(expectedTabs);
}

function compareWorkspaceTabs(left, right) {
  return left.workspaceTabId < right.workspaceTabId ? -1 : left.workspaceTabId > right.workspaceTabId ? 1 : left.tabId - right.tabId;
}

function verifiedMoveResult(result, request) {
  return validateManualPlacementMoveEvidence(result, request);
}
function verifiedTransferResult(result, request, targetWindowId) {
  return validateManualPlacementActivationEvidence(result, request, targetWindowId);
}

async function readState(adapters, workspaceId) {
  const invoked = await invoke(adapters.readPlacementState, { workspaceId });
  if (!invoked.ok) return { valid: false, reason: "placement_state_invalid" };
  const validation = snapshotAndValidatePromotionState(invoked.value);
  if (!validation.ok || validation.value.status !== "present" || validation.value.workspaceId !== workspaceId || validation.value.error !== "") return { valid: false, reason: "placement_state_invalid" };
  return { valid: true, ...validation.value };
}

async function readTimelineEvidence(adapters, workspaceId, timelineEvent) {
  const invoked = await invoke(adapters.readManualPlacementEvidence, { workspaceId, timelineEvent });
  if (
    !invoked.ok ||
    !exact(invoked.value, ["status", "count", "error"]) ||
    !["verified", "missing", "conflict", "failed"].includes(invoked.value.status) ||
    !(invoked.value.count === null || (Number.isSafeInteger(invoked.value.count) && invoked.value.count >= 0)) ||
    typeof invoked.value.error !== "string"
  ) return { valid: false, reason: "manual_placement_timeline_evidence_read_failed" };
  return invoked.value.status === "verified" && invoked.value.count === 1 && invoked.value.error === ""
    ? { valid: true, reason: "" }
    : { valid: false, reason: invoked.value.error || "manual_placement_timeline_evidence_not_verified" };
}

async function readLedger(adapters) {
  const invoked = await invoke(adapters.readOperationLedger);
  if (!invoked.ok || !exact(invoked.value, ["status", "ledger", "error"]) || invoked.value.status !== "present" || !validateOperationLedger(invoked.value.ledger).valid) return { valid: false, reason: "operation_ledger_read_failed" };
  return { valid: true, ledger: invoked.value.ledger };
}

async function persistNewPending(adapters, ledger, request, fingerprint, pending) {
  const recorded = recordOperation(ledger, { operationId: request.operationId, requestFingerprint: fingerprint, result: pending, recordedAt: request.requestedAt });
  if (recorded.status !== "recorded") return { valid: false, reason: "pending_operation_record_conflict" };
  const write = await invoke(adapters.writeOperationLedger, recorded.ledger);
  if (!write.ok || write.value?.status !== "written") return { valid: false, reason: "pending_operation_recording_failed" };
  const reread = await readLedger(adapters);
  const inspection = reread.valid ? inspectOperation(reread.ledger, request.operationId, fingerprint) : { status: "missing" };
  return inspection.status === "replay" && validateManualPlacementPending(inspection.entry.result, request, fingerprint) ? { valid: true, ledgerRead: reread } : { valid: false, reason: "pending_operation_verification_failed" };
}

async function replacePending(adapters, request, fingerprint, pending) { return replaceLedgerResult(adapters, request, fingerprint, pending, (value) => validateManualPlacementPending(value, request, fingerprint)); }
async function replacePendingWithTerminal(adapters, request, fingerprint, result) { return replaceLedgerResult(adapters, request, fingerprint, result, (value) => validateManualPlacementResult(value, request) && value.requestFingerprint === fingerprint); }
async function replaceLedgerResult(adapters, request, fingerprint, result, validate) {
  const read = await readLedger(adapters);
  if (!read.valid) return { valid: false };
  const next = clone(read.ledger);
  const entry = next.entries.find((candidate) => candidate.operationId === request.operationId && candidate.requestFingerprint === fingerprint);
  if (!entry) return { valid: false };
  entry.result = clone(result);
  const write = await invoke(adapters.writeOperationLedger, next);
  if (!write.ok || write.value?.status !== "written") return { valid: false };
  const reread = await readLedger(adapters);
  const stored = reread.valid ? reread.ledger.entries.find((candidate) => candidate.operationId === request.operationId) : null;
  return { valid: Boolean(stored && stored.requestFingerprint === fingerprint && validate(stored.result)) };
}

async function runExclusive(adapter, callback, identities, fingerprint, request) {
  let calls = 0;
  let active = true;
  try {
    const result = await adapter(async () => { calls += 1; if (!active || calls !== 1) throw new Error("exclusive_callback_invalid"); return callback(() => active && calls === 1); });
    active = false;
    const snapshot = snapshotSerializable(result);
    return calls === 1 && snapshot.ok && validateManualPlacementResult(snapshot.value, request) ? snapshot.value : failed(identities, fingerprint, "lock_acquisition", "exclusive_callback_invalid", true);
  } catch { active = false; return failed(identities, fingerprint, "lock_acquisition", "exclusive_operation_failed", true); }
}
async function invoke(adapter, ...args) { try { return { ok: true, value: structuredClone(await adapter(...structuredClone(args))) }; } catch { return { ok: false, value: null }; } }
function exact(value, fields) { try { return value && stableStringify(Object.keys(value).sort()) === stableStringify([...fields].sort()); } catch { return false; } }

function transferOccurred(activationResult) { return nonEmptyString(activationResult?.previousRuntimeAssignmentId) && nonEmptyString(activationResult?.currentRuntimeAssignmentId) && activationResult.previousRuntimeAssignmentId !== activationResult.currentRuntimeAssignmentId; }
function transferEvidence(activationResult, fields = {}) { return { ...fields, activationResult, browserMutationStarted: true, browserMutationVerified: true, assignmentTransferred: transferOccurred(activationResult), assignmentVerified: activationResult?.assignmentVerified === true, currentRuntimeAssignmentId: activationResult?.currentRuntimeAssignmentId || "", currentAssignmentEpoch: activationResult?.currentAssignmentEpoch ?? null }; }
function createManualPlacementTimelineEvent(request, targetWindowId, activationResult) {
  return {
    eventId: request.operationId + ":manual-placement-committed",
    type: "workspace_tabs_moved_to_new_window",
    message: "Moved workspace tabs into dedicated-window placement with verified browser, assignment, compatible-runtime, and transaction-owned timeline evidence.",
    createdAt: request.requestedAt,
    evidenceOwner: "service_worker_manual_placement_transaction",
    manualPlacementOperationId: request.operationId,
    moveOperationId: request.moveRequest.operationId,
    transferOperationId: request.transferOperationId,
    workspaceId: request.workspaceId,
    sourceContextId: request.sourceContextId,
    sourceWindowId: request.sourceWindowId,
    targetWindowId,
    currentRuntimeAssignmentId: activationResult.currentRuntimeAssignmentId,
    currentAssignmentEpoch: activationResult.currentAssignmentEpoch,
    browserMutationVerified: true,
    assignmentVerified: true,
    resolutionMode: "stable_one_to_one",
    newWindowCreationMode: "manual_placement_transaction_v0.1"
  };
}
function safeId(value) { return Number.isSafeInteger(value) && value >= 0; }
function invalid(identities, fingerprint, errors) { return createManualPlacementResult(identities, { status: "invalid", reason: "invalid_manual_placement_request", decision: "reject_request", phase: "request_validation", requestFingerprint: fingerprint, errors }); }
function failed(identities, fingerprint, phase, reason, retrySafe, fields = {}) { return createManualPlacementResult(identities, { ...fields, status: "failed", reason, decision: "retry_transaction", phase, requestFingerprint: fingerprint, retrySafe }); }
function conflict(identities, fingerprint, phase, reason, fields = {}) { return createManualPlacementResult(identities, { ...fields, status: "conflict", reason, decision: "manual_resolution_required", phase, requestFingerprint: fingerprint }); }
function indeterminate(identities, fingerprint, phase, reason, fields = {}) { return createManualPlacementResult(identities, { ...fields, status: "indeterminate", reason, decision: "retry_transaction", phase, requestFingerprint: fingerprint, retrySafe: true, indeterminate: true }); }
function replay(identities, fingerprint, stored) { return createManualPlacementResult(identities, { ...clone(stored), status: "replayed", reason: "manual_placement_replayed", phase: "complete", requestFingerprint: fingerprint, replayed: true }); }
