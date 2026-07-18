import {
  assignRuntime,
  replaceRuntimeAssignment,
  resolveAssignmentByWindow,
  resolveAssignmentByWorkspace,
  transferRuntime,
  validateAssignmentRegistry
} from "../runtime-contract/assignments.js";
import { inspectOperation, recordOperation } from "../runtime-contract/ledger.js";
import { clone, nonEmptyString, stableStringify } from "../runtime-contract/value-utils.js";
import { validateOperationLedger } from "../journal-append-coordination/ledger-validation.js";
import {
  ACTIVATION_OPERATIONS,
  createActivationPending,
  createActivationResult,
  normalizeActivationIdentities,
  readActivationAdapterFunctions,
  snapshotAndValidateActivationRequest,
  snapshotSerializable,
  validateActivationPending,
  validateActivationResult,
  workspaceRevision
} from "./contract.js";
import { createActivationRequestFingerprint } from "./fingerprint.js";

export async function coordinateRuntimeWorkspaceActivation(input, adaptersInput) {
  const snapshot = snapshotAndValidateActivationRequest(input);
  const identities = normalizeActivationIdentities(snapshot.value || {});
  if (!snapshot.ok) return invalid(identities, "", "request_validation", snapshot.reason, snapshot.errors);
  const request = snapshot.value;
  const fingerprint = createActivationRequestFingerprint(request);
  const adapterRead = readActivationAdapterFunctions(adaptersInput);
  if (!adapterRead.valid) return failed(identities, fingerprint, "lock_acquisition", "activation_adapters_invalid", false);

  return runExclusiveExactlyOnce(adapterRead.functions.runExclusiveOperation, async (isExclusiveActive) => {
    try { return ensureResult(identities, fingerprint, await coordinateLocked(request, identities, fingerprint, adapterRead.functions, isExclusiveActive)); }
    catch (error) { return failed(identities, fingerprint, "result_serialization", "activation_coordination_failed", true, { errors: [safeError(error)] }); }
  }, identities, fingerprint);
}

async function coordinateLocked(request, identities, fingerprint, adapters, isExclusiveActive) {
  let ledgerRead = await readLedger(adapters);
  if (!ledgerRead.valid) return failed(identities, fingerprint, "operation_inspection", ledgerRead.reason, true);
  const inspection = inspectOperation(ledgerRead.ledger, request.operationId, fingerprint);
  if (inspection.status === "conflict") return conflict(identities, fingerprint, "operation_inspection", "operation_id_conflict");
  if (inspection.status === "replay" && !validateActivationPending(inspection.entry.result)) return replay(identities, fingerprint, inspection.entry);
  if (inspection.status === "replay" && inspection.entry.result.requestFingerprint !== fingerprint) return conflict(identities, fingerprint, "operation_inspection", "operation_replay_result_invalid");
  const replacementPendingRequired = inspection.status === "missing" && request.operation === ACTIVATION_OPERATIONS.replaceActive;

  const initialWorkspace = await readWorkspace(adapters);
  if (!initialWorkspace.valid) return failed(identities, fingerprint, "workspace_reread", initialWorkspace.reason, initialWorkspace.retrySafe);
  const workspaceState = classifyWorkspace(request, initialWorkspace);
  if (!workspaceState.valid) return conflict(identities, fingerprint, "workspace_reread", workspaceState.reason, { activeWorkspaceId: initialWorkspace.workspace?.workspaceId || "", activeWorkspaceRevision: initialWorkspace.revision });

  const initialAuthority = await readAuthority(adapters, request);
  if (!initialAuthority.valid) return failed(identities, fingerprint, "source_verification", initialAuthority.reason, initialAuthority.retrySafe, workspaceEvidence(initialWorkspace));
  if (!initialAuthority.sourceContextVerified) return conflict(identities, fingerprint, "source_verification", "source_context_not_verified", { ...workspaceEvidence(initialWorkspace), runtimeSessionId: initialAuthority.runtimeSessionId, authorityRevisionBefore: initialAuthority.authorityRevision });

  const browser = await readBrowser(adapters, request, workspaceState.effectiveWorkspace);
  if (!browser.valid || !browser.sourceWindowVerified) return failed(identities, fingerprint, "source_verification", browser.reason || "source_window_not_verified", true, { ...workspaceEvidence(initialWorkspace), ...authorityEvidence(initialAuthority), ...browserEvidence(browser) });

  const target = selectTarget(request, browser);
  if (!target.valid) return conflict(identities, fingerprint, "target_selection", target.reason, { ...workspaceEvidence(initialWorkspace), ...authorityEvidence(initialAuthority), ...browserEvidence(browser), targetWindowId: target.windowId, readOnly: target.readOnly });
  if (!browser.targetWindowVerified && request.operation !== ACTIVATION_OPERATIONS.bootstrapExisting) return conflict(identities, fingerprint, "target_selection", "target_window_not_verified", { ...workspaceEvidence(initialWorkspace), ...authorityEvidence(initialAuthority), ...browserEvidence(browser), targetWindowId: target.windowId });
  if (request.operation !== ACTIVATION_OPERATIONS.bootstrapExisting && browser.liveWorkspaceWindowIds.some((windowId) => windowId !== target.windowId)) return conflict(identities, fingerprint, "target_selection", "workspace_tabs_not_verified_in_target", { ...workspaceEvidence(initialWorkspace), ...authorityEvidence(initialAuthority), ...browserEvidence(browser), targetWindowId: target.windowId });

  if (request.operation === ACTIVATION_OPERATIONS.bootstrapExisting) {
    const recovery = await recoverPendingReplacementForBootstrap({ request, identities, fingerprint, adapters, ledger: ledgerRead.ledger, workspace: initialWorkspace, authority: initialAuthority, browser, targetWindowId: target.windowId, isExclusiveActive });
    if (recovery.handled) return recovery.result;
  }

  const preflight = classifyAssignmentTransition(request, initialAuthority.assignmentRegistry, target.windowId, workspaceState.action);
  if (!preflight.valid) return conflict(identities, fingerprint, "assignment_transition", preflight.reason, { ...workspaceEvidence(initialWorkspace), ...authorityEvidence(initialAuthority), ...browserEvidence(browser), targetWindowId: target.windowId, readOnly: preflight.readOnly, ...assignmentEvidence(preflight) });

  if (replacementPendingRequired) {
    if (!isExclusiveActive()) return failed(identities, fingerprint, "lock_acquisition", "exclusive_operation_detached", true);
    const pending = await persistReplacementPending(adapters, ledgerRead.ledger, request, fingerprint);
    if (!pending.valid) return failed(identities, fingerprint, "operation_recording", pending.reason, true);
    ledgerRead = pending.ledgerRead;
  }

  let effectiveWorkspace = workspaceState.effectiveWorkspace;
  let effectiveRevision = workspaceState.effectiveRevision;
  let workspaceWritten = false;
  const warnings = [];

  if (request.operation === ACTIVATION_OPERATIONS.replaceActive && workspaceState.action === "write_candidate") {
    if (!isExclusiveActive()) return failed(identities, fingerprint, "lock_acquisition", "exclusive_operation_detached", true);
    const write = await writeWorkspace(adapters, request);
    const verified = await readWorkspace(adapters);
    const candidateMatches = verified.valid && exactWorkspace(verified.workspace, request.candidateWorkspace);
    if (!candidateMatches) return failed(identities, fingerprint, "workspace_verification", write.status === "conflict" ? "workspace_write_conflict" : "workspace_write_failed", write.status !== "conflict", { ...workspaceEvidence(initialWorkspace), ...authorityEvidence(initialAuthority), ...browserEvidence(browser), targetWindowId: target.windowId });
    workspaceWritten = write.status === "written";
    if (!workspaceWritten) warnings.push("workspace_write_outcome_verified_by_reread");
    effectiveWorkspace = verified.workspace;
    effectiveRevision = verified.revision;
  }

  const transition = applyAssignmentTransition(request, initialAuthority.assignmentRegistry, target.windowId);
  if (!transition.valid) return conflict(identities, fingerprint, "assignment_transition", transition.reason, { activeWorkspaceId: effectiveWorkspace.workspaceId, activeWorkspaceRevision: effectiveRevision, workspaceWritten, workspaceVerified: true, ...authorityEvidence(initialAuthority), ...browserEvidence(browser), targetWindowId: target.windowId, ...assignmentEvidence(transition) });

  let assignmentWritten = false;
  let expectedAuthorityRevision = initialAuthority.authorityRevision;
  if (transition.changed) {
    if (!isExclusiveActive()) return failed(identities, fingerprint, "lock_acquisition", "exclusive_operation_detached", true, { activeWorkspaceId: effectiveWorkspace.workspaceId, activeWorkspaceRevision: effectiveRevision, workspaceWritten, workspaceVerified: true });
    const authorityWrite = await writeAuthority(adapters, initialAuthority, transition.registry);
    expectedAuthorityRevision += 1;
    const verifiedAuthority = await readAuthority(adapters, request);
    if (!verifiedAuthority.valid || !authorityMatches(verifiedAuthority, initialAuthority.runtimeSessionId, expectedAuthorityRevision, transition.registry, transition.assignment)) {
      return indeterminate(identities, fingerprint, "assignment_verification", "assignment_write_outcome_unverified", {
        activeWorkspaceId: effectiveWorkspace.workspaceId,
        activeWorkspaceRevision: effectiveRevision,
        workspaceWritten,
        workspaceVerified: true,
        ...authorityEvidence(initialAuthority),
        authorityRevisionAfter: verifiedAuthority.authorityRevision,
        ...browserEvidence(browser),
        targetWindowId: target.windowId,
        ...assignmentEvidence(transition),
        warnings
      });
    }
    assignmentWritten = authorityWrite.status === "written";
    if (!assignmentWritten) warnings.push("assignment_write_outcome_verified_by_reread");
  }

  const finalWorkspace = await readWorkspace(adapters);
  const finalAuthority = await readAuthority(adapters, request);
  const workspaceVerified = finalWorkspace.valid && exactWorkspace(finalWorkspace.workspace, effectiveWorkspace);
  const assignmentVerified = finalAuthority.valid && authorityMatches(finalAuthority, initialAuthority.runtimeSessionId, expectedAuthorityRevision, transition.registry, transition.assignment);
  if (!workspaceVerified || !assignmentVerified) return indeterminate(identities, fingerprint, "final_verification", "final_activation_verification_failed", {
    activeWorkspaceId: finalWorkspace.workspace?.workspaceId || effectiveWorkspace.workspaceId,
    activeWorkspaceRevision: finalWorkspace.revision ?? effectiveRevision,
    workspaceWritten,
    workspaceVerified,
    assignmentWritten,
    assignmentVerified,
    ...authorityEvidence(initialAuthority),
    authorityRevisionAfter: finalAuthority.authorityRevision,
    ...browserEvidence(browser),
    targetWindowId: target.windowId,
    ...assignmentEvidence(transition),
    warnings
  });

  const status = workspaceWritten || assignmentWritten ? "committed" : "no_change";
  const callerReadOnly = request.operation === ACTIVATION_OPERATIONS.bootstrapExisting && target.windowId !== request.sourceWindowId;
  const successful = createActivationResult(identities, {
    status,
    reason: status === "committed" ? "activation_committed" : "activation_already_verified",
    decision: callerReadOnly ? "use_read_only_workspace" : "use_active_workspace",
    phase: "complete",
    requestFingerprint: fingerprint,
    activeWorkspaceId: finalWorkspace.workspace.workspaceId,
    activeWorkspaceRevision: finalWorkspace.revision,
    workspaceWritten,
    workspaceVerified: true,
    assignmentWritten,
    assignmentVerified: true,
    runtimeSessionId: finalAuthority.runtimeSessionId,
    authorityRevisionBefore: initialAuthority.authorityRevision,
    authorityRevisionAfter: finalAuthority.authorityRevision,
    targetWindowId: target.windowId,
    readOnly: callerReadOnly,
    ...browserEvidence(browser),
    ...assignmentEvidence(transition),
    warnings
  });

  if (!isExclusiveActive()) return failed(identities, fingerprint, "lock_acquisition", "exclusive_operation_detached", true, successful);
  const terminal = await persistTerminalResult(adapters, request, fingerprint, successful);
  if (!terminal.valid) return indeterminate(identities, fingerprint, "operation_recording", "operation_recording_failed", successful);
  return successful;
}

async function persistReplacementPending(adapters, ledger, request, fingerprint) {
  const pending = createActivationPending(request, fingerprint);
  const recorded = recordOperation(ledger, { operationId: request.operationId, requestFingerprint: fingerprint, result: pending, recordedAt: request.requestedAt });
  if (recorded.status !== "recorded") return { valid: false, reason: "pending_operation_record_conflict" };
  await writeLedger(adapters, recorded.ledger);
  const reread = await readLedger(adapters);
  const inspection = reread.valid ? inspectOperation(reread.ledger, request.operationId, fingerprint) : { status: "missing" };
  return inspection.status === "replay" && validateActivationPending(inspection.entry.result)
    ? { valid: true, ledgerRead: reread }
    : { valid: false, reason: "pending_operation_recording_failed" };
}

async function persistTerminalResult(adapters, request, fingerprint, result) {
  const read = await readLedger(adapters);
  if (!read.valid) return { valid: false };
  const inspection = inspectOperation(read.ledger, request.operationId, fingerprint);
  let next;
  if (inspection.status === "missing") {
    const recorded = recordOperation(read.ledger, { operationId: request.operationId, requestFingerprint: fingerprint, result, recordedAt: request.requestedAt });
    if (recorded.status !== "recorded") return { valid: false };
    next = recorded.ledger;
  } else if (inspection.status === "replay" && validateActivationPending(inspection.entry.result)) {
    next = clone(read.ledger);
    const entry = next.entries.find((candidate) => candidate.operationId === request.operationId && candidate.requestFingerprint === fingerprint);
    if (!entry) return { valid: false };
    entry.result = clone(result);
  } else if (inspection.status === "replay" && exactActivationResult(inspection.entry.result, result, request, fingerprint)) {
    return { valid: true, ledgerRead: read };
  } else {
    return { valid: false };
  }
  await writeLedger(adapters, next);
  const reread = await readLedger(adapters);
  const stored = reread.valid ? inspectOperation(reread.ledger, request.operationId, fingerprint) : { status: "missing" };
  return stored.status === "replay" && exactActivationResult(stored.entry.result, result, request, fingerprint)
    ? { valid: true, ledgerRead: reread }
    : { valid: false };
}

async function recoverPendingReplacementForBootstrap({ request, identities, fingerprint, adapters, ledger, workspace, authority, browser, targetWindowId, isExclusiveActive }) {
  const candidates = ledger.entries.filter((entry) => {
    const candidateWorkspace = entry?.result?.request?.candidateWorkspace;
    return exactWorkspace(candidateWorkspace, workspace.workspace);
  });
  if (candidates.length === 0) return { handled: false };
  if (candidates.length !== 1) return { handled: true, result: conflict(identities, fingerprint, "operation_inspection", "multiple_pending_workspace_replacements", { ...workspaceEvidence(workspace), ...authorityEvidence(authority), ...browserEvidence(browser), targetWindowId, readOnly: targetWindowId !== request.sourceWindowId }) };

  const pendingEntry = candidates[0];
  if (
    !validateActivationPending(pendingEntry.result) ||
    pendingEntry.operationId !== pendingEntry.result.operationId ||
    pendingEntry.requestFingerprint !== pendingEntry.result.requestFingerprint
  ) {
    return { handled: true, result: conflict(identities, fingerprint, "operation_inspection", "pending_workspace_replacement_evidence_invalid", { ...workspaceEvidence(workspace), ...authorityEvidence(authority), ...browserEvidence(browser), targetWindowId, readOnly: targetWindowId !== request.sourceWindowId }) };
  }
  const pendingRequest = pendingEntry.result.request;
  if (pendingRequest.targetWindowId !== targetWindowId) {
    return { handled: true, result: conflict(identities, fingerprint, "operation_inspection", "pending_workspace_replacement_target_mismatch", { ...workspaceEvidence(workspace), ...authorityEvidence(authority), ...browserEvidence(browser), targetWindowId, readOnly: targetWindowId !== request.sourceWindowId }) };
  }
  const transition = applyAssignmentTransition(pendingRequest, authority.assignmentRegistry, targetWindowId);
  if (!transition.valid) return { handled: true, result: conflict(identities, fingerprint, "assignment_transition", "pending_workspace_replacement_conflict", { ...workspaceEvidence(workspace), ...authorityEvidence(authority), ...browserEvidence(browser), targetWindowId, ...assignmentEvidence(transition) }) };

  if (!isExclusiveActive()) return { handled: true, result: failed(identities, fingerprint, "lock_acquisition", "exclusive_operation_detached", true, { ...workspaceEvidence(workspace), ...authorityEvidence(authority), ...browserEvidence(browser), targetWindowId }) };
  const authorityWrite = transition.changed ? await writeAuthority(adapters, authority, transition.registry) : { status: "no_change" };
  const expectedRevision = authority.authorityRevision + (transition.changed ? 1 : 0);
  const verifiedAuthority = await readAuthority(adapters, request);
  if (!authorityMatches(verifiedAuthority, authority.runtimeSessionId, expectedRevision, transition.registry, transition.assignment)) {
    return { handled: true, result: indeterminate(identities, fingerprint, "assignment_verification", "pending_workspace_replacement_unverified", {
      ...workspaceEvidence(workspace), ...authorityEvidence(authority), authorityRevisionAfter: verifiedAuthority.authorityRevision,
      ...browserEvidence(browser), targetWindowId, ...assignmentEvidence(transition), readOnly: targetWindowId !== request.sourceWindowId
    }) };
  }

  const assignmentWritten = authorityWrite.status === "written";
  const recoveryWarnings = ["pending_workspace_replacement_recovered_from_operation_ledger"];
  const originalIdentities = normalizeActivationIdentities(pendingRequest);
  const originalResult = createActivationResult(originalIdentities, {
    status: assignmentWritten ? "committed" : "no_change",
    reason: assignmentWritten ? "activation_committed" : "activation_already_verified",
    decision: "use_active_workspace",
    phase: "complete",
    requestFingerprint: pendingEntry.requestFingerprint,
    activeWorkspaceId: workspace.workspace.workspaceId,
    activeWorkspaceRevision: workspace.revision,
    workspaceWritten: false,
    workspaceVerified: true,
    assignmentWritten,
    assignmentVerified: true,
    runtimeSessionId: verifiedAuthority.runtimeSessionId,
    authorityRevisionBefore: authority.authorityRevision,
    authorityRevisionAfter: verifiedAuthority.authorityRevision,
    targetWindowId,
    ...browserEvidence(browser),
    ...assignmentEvidence(transition),
    warnings: recoveryWarnings
  });
  const callerReadOnly = targetWindowId !== request.sourceWindowId;
  const bootstrapResult = createActivationResult(identities, {
    status: assignmentWritten ? "committed" : "no_change",
    reason: assignmentWritten ? "activation_committed" : "activation_already_verified",
    decision: callerReadOnly ? "use_read_only_workspace" : "use_active_workspace",
    phase: "complete",
    requestFingerprint: fingerprint,
    activeWorkspaceId: workspace.workspace.workspaceId,
    activeWorkspaceRevision: workspace.revision,
    workspaceWritten: false,
    workspaceVerified: true,
    assignmentWritten,
    assignmentVerified: true,
    runtimeSessionId: verifiedAuthority.runtimeSessionId,
    authorityRevisionBefore: authority.authorityRevision,
    authorityRevisionAfter: verifiedAuthority.authorityRevision,
    targetWindowId,
    readOnly: callerReadOnly,
    ...browserEvidence(browser),
    ...assignmentEvidence(transition),
    warnings: recoveryWarnings
  });
  if (!isExclusiveActive()) return { handled: true, result: indeterminate(identities, fingerprint, "operation_recording", "exclusive_operation_detached_after_business_state", bootstrapResult) };
  const recorded = await persistRecoveredReplacementAndBootstrap(adapters, ledger, pendingEntry, originalResult, request, fingerprint, bootstrapResult);
  return recorded.valid
    ? { handled: true, result: bootstrapResult }
    : { handled: true, result: indeterminate(identities, fingerprint, "operation_recording", "operation_recording_failed", bootstrapResult) };
}

async function persistRecoveredReplacementAndBootstrap(adapters, ledger, pendingEntry, originalResult, request, fingerprint, bootstrapResult) {
  const next = clone(ledger);
  const storedPending = next.entries.find((entry) => entry.operationId === pendingEntry.operationId && entry.requestFingerprint === pendingEntry.requestFingerprint);
  if (!storedPending || !validateActivationPending(storedPending.result)) return { valid: false };
  storedPending.result = clone(originalResult);
  const recorded = recordOperation(next, { operationId: request.operationId, requestFingerprint: fingerprint, result: bootstrapResult, recordedAt: request.requestedAt });
  if (recorded.status !== "recorded") return { valid: false };
  await writeLedger(adapters, recorded.ledger);
  const reread = await readLedger(adapters);
  if (!reread.valid) return { valid: false };
  const originalRequest = pendingEntry.result.request;
  const original = inspectOperation(reread.ledger, pendingEntry.operationId, pendingEntry.requestFingerprint);
  const bootstrap = inspectOperation(reread.ledger, request.operationId, fingerprint);
  return {
    valid: original.status === "replay" && exactActivationResult(original.entry.result, originalResult, originalRequest, pendingEntry.requestFingerprint) &&
      bootstrap.status === "replay" && exactActivationResult(bootstrap.entry.result, bootstrapResult, request, fingerprint),
    ledgerRead: reread
  };
}

function exactActivationResult(observed, expectedResult, request, fingerprint) {
  return validateActivationResult(observed, request) && observed.requestFingerprint === fingerprint && stableStringify(observed) === stableStringify(expectedResult);
}

function classifyWorkspace(request, read) {
  if (read.status !== "present") return { valid: false, reason: "active_workspace_absent" };
  const exactExpected = read.workspace.workspaceId === request.expectedWorkspaceId && read.revision === request.expectedWorkspaceRevision;
  if (request.operation !== ACTIVATION_OPERATIONS.replaceActive) return exactExpected
    ? { valid: true, action: "retain", effectiveWorkspace: read.workspace, effectiveRevision: read.revision }
    : { valid: false, reason: "active_workspace_changed" };
  const exactCandidate = exactWorkspace(read.workspace, request.candidateWorkspace);
  if (exactCandidate) return { valid: true, action: "candidate_already_written", effectiveWorkspace: read.workspace, effectiveRevision: read.revision };
  return exactExpected
    ? { valid: true, action: "write_candidate", effectiveWorkspace: request.candidateWorkspace, effectiveRevision: workspaceRevision(request.candidateWorkspace) }
    : { valid: false, reason: "active_workspace_changed" };
}

function classifyAssignmentTransition(request, registry, targetWindowId, workspaceAction) {
  const workspaceId = request.operation === ACTIVATION_OPERATIONS.replaceActive ? request.candidateWorkspace.workspaceId : request.expectedWorkspaceId;
  const current = resolveAssignmentByWorkspace(registry, workspaceId);
  const target = resolveAssignmentByWindow(registry, targetWindowId);

  if (request.operation === ACTIVATION_OPERATIONS.bootstrapExisting) {
    if (current && current.windowId !== request.sourceWindowId) return { valid: false, reason: "workspace_assigned_to_another_window", readOnly: true, assignment: current };
    if (current && current.windowId !== targetWindowId) return { valid: false, reason: "workspace_assigned_to_another_window", readOnly: true, assignment: current };
    if (target && target.workspaceId !== workspaceId) return { valid: false, reason: "target_window_occupied", assignment: target };
    return { valid: true };
  }

  if (request.operation === ACTIVATION_OPERATIONS.replaceActive) {
    if (sameWorkspaceReplacement(request)) {
      const replay = current ? exactAssignmentReplay(request, registry, current, targetWindowId) : { valid: false };
      if (workspaceAction === "candidate_already_written" && replay.valid) {
        return { valid: true, replayedTransition: true, assignment: current, releasedAssignment: replay.releasedAssignment };
      }
      if (!current || current.runtimeAssignmentId !== request.expectedRuntimeAssignmentId || current.assignmentEpoch !== request.expectedAssignmentEpoch || current.windowId !== request.sourceWindowId) {
        return { valid: false, reason: "stale_or_missing_prior_assignment", assignment: current };
      }
      if (target && target.runtimeAssignmentId !== current.runtimeAssignmentId) return { valid: false, reason: "target_window_occupied", assignment: target };
      return { valid: true };
    }

    if (current && current.windowId !== targetWindowId) return { valid: false, reason: "candidate_active_elsewhere", assignment: current };
    if (current) {
      const replay = exactAssignmentReplay(request, registry, current, targetWindowId);
      return workspaceAction === "candidate_already_written" && replay.valid
        ? { valid: true, replayedTransition: true, assignment: current, releasedAssignment: replay.releasedAssignment }
        : { valid: false, reason: "candidate_assignment_mismatch", assignment: current };
    }
    const prior = resolveAssignmentByWorkspace(registry, request.expectedWorkspaceId);
    if (request.expectedRuntimeAssignmentId !== null && (!prior || prior.runtimeAssignmentId !== request.expectedRuntimeAssignmentId || prior.assignmentEpoch !== request.expectedAssignmentEpoch || prior.windowId !== request.sourceWindowId)) return { valid: false, reason: "stale_or_missing_prior_assignment", assignment: prior };
    if (request.expectedRuntimeAssignmentId === null && prior) return { valid: false, reason: "prior_assignment_evidence_required", assignment: prior };
    if (target && target.workspaceId !== workspaceId && target.workspaceId !== request.expectedWorkspaceId) return { valid: false, reason: "target_window_occupied", assignment: target };
    return { valid: true };
  }

  const currentActive = resolveAssignmentByWorkspace(registry, request.expectedWorkspaceId);
  const transferReplay = currentActive ? exactAssignmentReplay(request, registry, currentActive, targetWindowId) : { valid: false };
  if (transferReplay.valid) return { valid: true, replayedTransition: true, assignment: currentActive, releasedAssignment: transferReplay.releasedAssignment };
  if (!currentActive || currentActive.runtimeAssignmentId !== request.expectedRuntimeAssignmentId || currentActive.assignmentEpoch !== request.expectedAssignmentEpoch || currentActive.windowId !== request.sourceWindowId) return { valid: false, reason: "stale_or_missing_prior_assignment", assignment: currentActive };
  if (target && target.workspaceId !== request.expectedWorkspaceId) return { valid: false, reason: "target_window_occupied", assignment: target };
  return { valid: true };
}

function applyAssignmentTransition(request, registry, targetWindowId) {
  let value;
  const currentForReplay = resolveAssignmentByWorkspace(
    registry,
    request.operation === ACTIVATION_OPERATIONS.replaceActive ? request.candidateWorkspace.workspaceId : request.expectedWorkspaceId
  );
  const exactReplay = currentForReplay ? exactAssignmentReplay(request, registry, currentForReplay, targetWindowId) : { valid: false };
  if (request.operation !== ACTIVATION_OPERATIONS.bootstrapExisting && exactReplay.valid) {
    return {
      valid: true,
      changed: false,
      registry: clone(registry),
      assignment: currentForReplay,
      releasedAssignment: exactReplay.releasedAssignment
    };
  }
  if (request.operation === ACTIVATION_OPERATIONS.bootstrapExisting) {
    value = assignRuntime(registry, { workspaceId: request.expectedWorkspaceId, windowId: targetWindowId, sourceContextId: request.sourceContextId, now: request.requestedAt, id: () => request.nextRuntimeAssignmentId });
  } else if (request.operation === ACTIVATION_OPERATIONS.replaceActive && sameWorkspaceReplacement(request)) {
    value = transferRuntime(registry, {
      workspaceId: request.expectedWorkspaceId,
      windowId: targetWindowId,
      sourceContextId: request.sourceContextId,
      expectedRuntimeAssignmentId: request.expectedRuntimeAssignmentId,
      expectedAssignmentEpoch: request.expectedAssignmentEpoch,
      now: request.requestedAt,
      id: () => request.nextRuntimeAssignmentId
    });
  } else if (request.operation === ACTIVATION_OPERATIONS.replaceActive) {
    value = replaceRuntimeAssignment(registry, {
      expectedWorkspaceId: request.expectedWorkspaceId,
      candidateWorkspaceId: request.candidateWorkspace.workspaceId,
      windowId: targetWindowId,
      sourceContextId: request.sourceContextId,
      expectedWindowId: request.sourceWindowId,
      expectedRuntimeAssignmentId: request.expectedRuntimeAssignmentId,
      expectedAssignmentEpoch: request.expectedAssignmentEpoch,
      now: request.requestedAt,
      id: () => request.nextRuntimeAssignmentId
    });
  } else {
    value = transferRuntime(registry, {
      workspaceId: request.expectedWorkspaceId,
      windowId: targetWindowId,
      sourceContextId: request.sourceContextId,
      expectedRuntimeAssignmentId: request.expectedRuntimeAssignmentId,
      expectedAssignmentEpoch: request.expectedAssignmentEpoch,
      now: request.requestedAt,
      id: () => request.nextRuntimeAssignmentId
    });
  }
  if (!["assigned", "no_change"].includes(value.status)) return { valid: false, reason: value.reason || value.status, assignment: value.assignment || null };
  return { valid: true, changed: value.status === "assigned", registry: value.registry, assignment: value.assignment, releasedAssignment: value.releasedAssignment || null };
}

function selectTarget(request, browser) {
  if (request.operation !== ACTIVATION_OPERATIONS.bootstrapExisting) return { valid: true, windowId: request.targetWindowId, readOnly: false };
  if (browser.liveWorkspaceWindowIds.length > 1) return { valid: false, reason: "workspace_tabs_span_multiple_windows", windowId: null, readOnly: true };
  const windowId = browser.liveWorkspaceWindowIds.length === 1 ? browser.liveWorkspaceWindowIds[0] : request.sourceWindowId;
  return { valid: true, windowId, readOnly: windowId !== request.sourceWindowId };
}

function exactAssignmentReplay(request, registry, assignment, targetWindowId) {
  if (
    assignment?.runtimeAssignmentId !== request.nextRuntimeAssignmentId ||
    assignment.windowId !== targetWindowId ||
    assignment.sourceContextId !== request.sourceContextId ||
    assignment.createdAt !== request.requestedAt ||
    assignment.updatedAt !== request.requestedAt ||
    assignment.lastVerifiedAt !== request.requestedAt
  ) return { valid: false, releasedAssignment: null };
  if (request.expectedRuntimeAssignmentId === null) {
    return request.expectedAssignmentEpoch === null
      ? { valid: true, releasedAssignment: null }
      : { valid: false, releasedAssignment: null };
  }
  const releasedAssignment = registry.assignments.find((candidate) => candidate.runtimeAssignmentId === request.expectedRuntimeAssignmentId) || null;
  return releasedAssignment?.state === "released" &&
    releasedAssignment.workspaceId === request.expectedWorkspaceId &&
    releasedAssignment.windowId === request.sourceWindowId &&
    releasedAssignment.assignmentEpoch === request.expectedAssignmentEpoch &&
    releasedAssignment.updatedAt === request.requestedAt
    ? { valid: true, releasedAssignment: clone(releasedAssignment) }
    : { valid: false, releasedAssignment: null };
}

async function runExclusiveExactlyOnce(runExclusive, callback, identities, fingerprint) {
  let calls = 0;
  let active = true;
  try {
    const value = await runExclusive(async () => {
      calls += 1;
      if (!active || calls !== 1) throw new Error("exclusive_operation_callback_invalid");
      return callback(() => active && calls === 1);
    });
    active = false;
    if (calls !== 1) return failed(identities, fingerprint, "lock_acquisition", "exclusive_operation_callback_invalid", true);
    return ensureResult(identities, fingerprint, value);
  } catch (error) {
    active = false;
    return failed(identities, fingerprint, "lock_acquisition", "exclusive_operation_failed", true, { errors: [safeError(error)] });
  }
}

async function readLedger(adapters) {
  const invoked = await invoke(adapters.readOperationLedger);
  if (!invoked.ok || !exact(invoked.value, ["status", "ledger", "error"]) || !["present", "failed"].includes(invoked.value.status) || typeof invoked.value.error !== "string") return { valid: false, reason: "operation_ledger_read_failed" };
  if (invoked.value.status === "failed" || !validateOperationLedger(invoked.value.ledger).valid) return { valid: false, reason: "operation_ledger_read_failed" };
  return { valid: true, ledger: invoked.value.ledger };
}

async function writeLedger(adapters, ledger) {
  const invoked = await invoke(adapters.writeOperationLedger, ledger);
  return invoked.ok && exact(invoked.value, ["status", "error"]) && ["written", "conflict", "failed"].includes(invoked.value.status) && typeof invoked.value.error === "string" ? invoked.value : { status: "failed", error: "operation_ledger_write_failed" };
}

async function readWorkspace(adapters) {
  const invoked = await invoke(adapters.readCompatibleWorkspace);
  if (!invoked.ok || !exact(invoked.value, ["status", "workspace", "revision", "error"]) || !["present", "absent", "conflict", "failed"].includes(invoked.value.status) || typeof invoked.value.error !== "string") return { valid: false, reason: "workspace_read_failed", retrySafe: true };
  const value = invoked.value;
  if (value.status !== "present") return { valid: false, status: value.status, workspace: null, revision: null, reason: value.status === "conflict" ? "workspace_compatibility_conflict" : "workspace_read_failed", retrySafe: value.status !== "conflict" };
  const revision = workspaceRevision(value.workspace);
  if (!nonEmptyString(value.workspace?.workspaceId) || !Array.isArray(value.workspace?.tabs) || revision === null || revision !== value.revision || value.error !== "") return { valid: false, reason: "workspace_read_malformed", retrySafe: false };
  return { valid: true, status: "present", workspace: value.workspace, revision };
}

async function writeWorkspace(adapters, request) {
  const invoked = await invoke(adapters.writeCompatibleWorkspace, { workspace: request.candidateWorkspace, expectedWorkspaceId: request.expectedWorkspaceId, expectedWorkspaceRevision: request.expectedWorkspaceRevision });
  if (!invoked.ok || !exact(invoked.value, ["status", "workspaceId", "workspaceRevision", "error"]) || !["written", "conflict", "failed"].includes(invoked.value.status) || typeof invoked.value.error !== "string") return { status: "failed", error: "workspace_write_failed" };
  return invoked.value;
}

async function readAuthority(adapters, request) {
  const invoked = await invoke(adapters.readRuntimeAuthority, { sourceContextId: request.sourceContextId, sourceWindowId: request.sourceWindowId });
  if (!invoked.ok || !exact(invoked.value, ["status", "runtimeSessionId", "authorityRevision", "sourceContextVerified", "assignmentRegistry", "error"]) || typeof invoked.value.error !== "string") return { valid: false, reason: "runtime_authority_read_failed", retrySafe: true, authorityRevision: null };
  const value = invoked.value;
  if (value.status !== "present" || !nonEmptyString(value.runtimeSessionId) || !Number.isSafeInteger(value.authorityRevision) || value.authorityRevision < 0 || typeof value.sourceContextVerified !== "boolean" || value.error !== "" || !validateAssignmentRegistry(value.assignmentRegistry).valid) return { valid: false, reason: "runtime_authority_invalid", retrySafe: false, authorityRevision: value.authorityRevision };
  return { valid: true, ...value };
}

async function writeAuthority(adapters, authority, registry) {
  const invoked = await invoke(adapters.writeRuntimeAuthority, { expectedRuntimeSessionId: authority.runtimeSessionId, expectedAuthorityRevision: authority.authorityRevision, nextAssignmentRegistry: registry });
  if (!invoked.ok || !exact(invoked.value, ["status", "runtimeSessionId", "authorityRevision", "error"]) || !["written", "conflict", "failed"].includes(invoked.value.status) || typeof invoked.value.error !== "string") return { status: "failed", error: "runtime_authority_write_failed" };
  return invoked.value;
}

async function readBrowser(adapters, request, workspace) {
  const invoked = await invoke(adapters.readBrowserEvidence, { workspace, sourceWindowId: request.sourceWindowId, targetWindowId: request.targetWindowId });
  if (!invoked.ok || !exact(invoked.value, ["status", "sourceWindowVerified", "targetWindowVerified", "liveWorkspaceTabIds", "liveWorkspaceWindowIds", "error"]) || typeof invoked.value.error !== "string" || typeof invoked.value.sourceWindowVerified !== "boolean" || typeof invoked.value.targetWindowVerified !== "boolean" || !validIdArray(invoked.value.liveWorkspaceTabIds) || !validIdArray(invoked.value.liveWorkspaceWindowIds)) return { valid: false, reason: "browser_evidence_invalid", sourceWindowVerified: false, targetWindowVerified: false, liveWorkspaceTabIds: [], liveWorkspaceWindowIds: [] };
  return invoked.value.status === "present" && invoked.value.error === "" ? { valid: true, ...invoked.value } : { valid: false, reason: invoked.value.error || "browser_evidence_failed", ...invoked.value };
}

function authorityMatches(authority, runtimeSessionId, revision, expectedRegistry, assignment) {
  if (!authority.valid || !authority.sourceContextVerified || authority.runtimeSessionId !== runtimeSessionId || authority.authorityRevision !== revision || stableStringify(authority.assignmentRegistry) !== stableStringify(expectedRegistry)) return false;
  const observed = resolveAssignmentByWorkspace(authority.assignmentRegistry, assignment.workspaceId);
  return Boolean(observed && stableStringify(observed) === stableStringify(assignment));
}

function sameWorkspaceReplacement(request) {
  return request.operation === ACTIVATION_OPERATIONS.replaceActive && request.candidateWorkspace?.workspaceId === request.expectedWorkspaceId;
}
function exactWorkspace(left, right) { try { return stableStringify(left) === stableStringify(right); } catch { return false; } }
function exact(value, fields) { try { return value && typeof value === "object" && !Array.isArray(value) && stableStringify(Object.keys(value).sort()) === stableStringify([...fields].sort()); } catch { return false; } }
function validIdArray(value) { return Array.isArray(value) && value.every((item) => Number.isSafeInteger(item) && item >= 0) && new Set(value).size === value.length; }
async function invoke(adapter, ...args) { try { return { ok: true, value: structuredClone(await adapter(...structuredClone(args))) }; } catch { return { ok: false }; } }
function safeError(error) {
  try {
    const message = error !== null && (typeof error === "object" || typeof error === "function") ? Reflect.get(error, "message") : "";
    if (typeof message === "string" && message) return message;
  } catch { /* Fall through to a guarded primitive conversion. */ }
  try {
    const value = String(error);
    return value || "unknown_error";
  } catch { return "unknown_error"; }
}

function workspaceEvidence(read) { return { activeWorkspaceId: read.workspace?.workspaceId || "", activeWorkspaceRevision: read.revision, workspaceVerified: read.valid }; }
function authorityEvidence(authority) { return { runtimeSessionId: authority.runtimeSessionId || "", authorityRevisionBefore: authority.authorityRevision }; }
function browserEvidence(browser) { return { liveWorkspaceTabIds: browser.liveWorkspaceTabIds || [], liveWorkspaceWindowIds: browser.liveWorkspaceWindowIds || [] }; }
function assignmentEvidence(value) {
  const current = value.assignment || null;
  const previous = value.releasedAssignment || null;
  return {
    previousRuntimeAssignmentId: previous?.runtimeAssignmentId || "",
    previousAssignmentEpoch: previous?.assignmentEpoch ?? null,
    currentRuntimeAssignmentId: current?.runtimeAssignmentId || "",
    currentAssignmentEpoch: current?.assignmentEpoch ?? null
  };
}

function invalid(identities, fingerprint, phase, reason, errors = []) { return createActivationResult(identities, { status: "invalid", reason, decision: "reject_request", phase, requestFingerprint: fingerprint, errors }); }
function failed(identities, fingerprint, phase, reason, retrySafe, fields = {}) { return createActivationResult(identities, { ...fields, status: "failed", reason, decision: "retry_activation", phase, requestFingerprint: fingerprint, retrySafe }); }
function conflict(identities, fingerprint, phase, reason, fields = {}) { return createActivationResult(identities, { ...fields, status: "conflict", reason, decision: fields.readOnly ? "use_read_only_workspace" : "manual_resolution_required", phase, requestFingerprint: fingerprint }); }
function indeterminate(identities, fingerprint, phase, reason, fields = {}) { return createActivationResult(identities, { ...fields, status: "indeterminate", reason, decision: "retry_activation", phase, requestFingerprint: fingerprint, retrySafe: true, indeterminate: true }); }

function replay(identities, fingerprint, entry) {
  try {
    const stored = entry?.result;
    if (!validateActivationResult(stored, identities) || stored.requestFingerprint !== fingerprint || !["committed", "no_change", "replayed"].includes(stored.status)) return conflict(identities, fingerprint, "operation_inspection", "operation_replay_result_invalid");
    return createActivationResult(identities, { ...clone(stored), status: "replayed", reason: "activation_replayed", phase: "complete", requestFingerprint: fingerprint, replayed: true });
  } catch { return conflict(identities, fingerprint, "operation_inspection", "operation_replay_result_invalid"); }
}

function ensureResult(identities, fingerprint, value) {
  const snapshot = snapshotSerializable(value);
  return snapshot.ok && validateActivationResult(snapshot.value, identities) && snapshot.value.requestFingerprint === fingerprint
    ? snapshot.value
    : failed(identities, fingerprint, "result_serialization", "invalid_coordinator_result", true);
}
