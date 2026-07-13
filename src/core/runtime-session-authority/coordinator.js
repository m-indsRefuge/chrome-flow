import { LOCK_NAMES } from "../runtime-contract/constants.js";
import { assignRuntime, releaseRuntime, resolveAssignmentByWindow, resolveAssignmentByWorkspace, transferRuntime } from "../runtime-contract/assignments.js";
import { clone } from "../runtime-contract/value-utils.js";
import { createContextResult, createSessionAuthority, registerContext, rootsEqual, validateActiveContext, validateContextRegisterRequest, validateSessionAuthority } from "./contract.js";

export async function coordinateContextRegistration(request, senderEvidence, adapters) {
  const validation = validateContextRegisterRequest(request);
  if (!validation.valid) return createContextResult({ ...request, status: "rejected", reason: "invalid_request", errors: validation.errors });
  return coordinateWithDiagnostic(adapters, async () => adapters.withRuntimeStateLock(LOCK_NAMES.runtimeState, async () => {
    const verifiedWindow = await verifyWindow(adapters, request.windowId);
    if (!verifiedWindow.valid) return createContextResult({ ...request, status: "rejected", reason: "window_not_verified", retrySafe: true, errors: verifiedWindow.errors });
    const current = await adapters.readAuthority();
    const genesis = current === undefined;
    const root = genesis ? createSessionAuthority(adapters.createId()) : current;
    const rootValidation = validateSessionAuthority(root);
    if (!rootValidation.valid) return createContextResult({ ...request, status: "rejected", reason: "malformed_authority", errors: rootValidation.errors });
    const transitioned = registerContext(root, { contextId: request.contextId, windowId: request.windowId, createdAt: adapters.now(), sourceUrl: senderEvidence.sourceUrl }, { genesis });
    if (["context_conflict", "rejected"].includes(transitioned.status)) return createContextResult({ ...request, status: transitioned.status, reason: transitioned.reason, runtimeSessionId: root.runtimeSessionId, authorityRevision: root.authorityRevision, errors: transitioned.errors });
    if (transitioned.status === "no_change") {
      const verification = await verifyExisting(adapters, root);
      const result = createContextResult({ ...request, status: verification.verified ? "no_change" : "failed", runtimeSessionId: root.runtimeSessionId, authorityRevision: root.authorityRevision, authorityVerified: verification.verified, context: transitioned.context, assignment: verification.verified ? transitioned.assignment : null, retrySafe: verification.retrySafe, reason: verification.reason });
      if (!verification.verified) result.diagnosticAction = "runtime_session_authority_verification_failed";
      return result;
    }
    return writeAndVerify(adapters, request, transitioned.root, transitioned, genesis ? "runtime_session_authority_genesis_registered" : "runtime_session_context_replaced_or_registered");
  }), (error) => {
    const result = createContextResult({ ...request, status: "failed", reason: "coordination_failure", retrySafe: true, errors: [String(error?.message || error)] });
    result.diagnosticAction = "runtime_session_authority_coordination_failed";
    return result;
  });
}

export async function resolveAssignmentForWindow(windowId, adapters) {
  return adapters.withRuntimeStateLock(LOCK_NAMES.runtimeState, async () => {
    const loaded = await loadValid(adapters);
    if (!loaded.valid) return loaded.result;
    return { status: "resolved", assignment: resolveAssignmentByWindow(loaded.root.assignmentRegistry, windowId), authorityRevision: loaded.root.authorityRevision, runtimeSessionId: loaded.root.runtimeSessionId };
  });
}

export async function resolveAssignmentForWorkspace(workspaceId, adapters) {
  return adapters.withRuntimeStateLock(LOCK_NAMES.runtimeState, async () => {
    const loaded = await loadValid(adapters);
    if (!loaded.valid) return loaded.result;
    return { status: "resolved", assignment: resolveAssignmentByWorkspace(loaded.root.assignmentRegistry, workspaceId), authorityRevision: loaded.root.authorityRevision, runtimeSessionId: loaded.root.runtimeSessionId };
  });
}

export async function coordinateAssignmentCreate(details, adapters) {
  return coordinateWithDiagnostic(adapters, () => adapters.withExclusiveOperationLock(LOCK_NAMES.exclusiveOperation, () => adapters.withRuntimeStateLock(LOCK_NAMES.runtimeState, async () => {
    const loaded = await loadValid(adapters); if (!loaded.valid) return loaded.result;
    const verifiedWindow = await verifyWindow(adapters, details.windowId); if (!verifiedWindow.valid) return internalResult(details, "rejected", "window_not_verified", loaded.root);
    const context = validateActiveContext(loaded.root, details.sourceContextId, details.windowId); if (!context.valid) return internalResult(details, "rejected", context.reason, loaded.root);
    const transitioned = assignRuntime(loaded.root.assignmentRegistry, { ...details, id: adapters.createId, now: adapters.now() });
    return commitAssignmentTransition(adapters, details, loaded.root, transitioned, "runtime_session_assignment_created");
  })));
}

export async function coordinateAssignmentTransfer(details, adapters) {
  return coordinateWithDiagnostic(adapters, () => adapters.withExclusiveOperationLock(LOCK_NAMES.exclusiveOperation, () => adapters.withRuntimeStateLock(LOCK_NAMES.runtimeState, async () => {
    const loaded = await loadValid(adapters); if (!loaded.valid) return loaded.result;
    const verifiedWindow = await verifyWindow(adapters, details.windowId); if (!verifiedWindow.valid) return internalResult(details, "rejected", "window_not_verified", loaded.root);
    const context = validateActiveContext(loaded.root, details.sourceContextId, details.windowId); if (!context.valid) return internalResult(details, "rejected", context.reason, loaded.root);
    const transitioned = transferRuntime(loaded.root.assignmentRegistry, { ...details, id: adapters.createId, now: adapters.now() });
    return commitAssignmentTransition(adapters, details, loaded.root, transitioned, "runtime_session_assignment_transferred");
  })));
}

export async function coordinateAssignmentRelease(details, adapters) {
  return coordinateWithDiagnostic(adapters, () => adapters.withRuntimeStateLock(LOCK_NAMES.runtimeState, async () => {
    const loaded = await loadValid(adapters); if (!loaded.valid) return loaded.result;
    const transitioned = releaseRuntime(loaded.root.assignmentRegistry, { ...details, now: adapters.now() });
    return commitAssignmentTransition(adapters, details, loaded.root, transitioned, "runtime_session_assignment_released");
  }));
}

export async function coordinateWindowCloseCleanup(windowId, adapters) {
  return coordinateWithDiagnostic(adapters, () => adapters.withRuntimeStateLock(LOCK_NAMES.runtimeState, async () => {
    const root = await adapters.readAuthority();
    if (root === undefined) return { status: "no_change", reason: "authority_absent", authorityCommitted: false, authorityVerified: false };
    const validation = validateSessionAuthority(root);
    if (!validation.valid) return { status: "rejected", reason: "malformed_authority", errors: validation.errors, authorityCommitted: false, authorityVerified: false };
    const matchingAssignment = resolveAssignmentByWindow(root.assignmentRegistry, windowId);
    const hasContexts = root.contexts.some((context) => context.windowId === windowId);
    if (!matchingAssignment && !hasContexts) return { status: "no_change", reason: "window_authority_absent", authorityCommitted: false, authorityVerified: false, authorityRevision: root.authorityRevision };
    const next = clone(root);
    next.contexts = next.contexts.filter((context) => context.windowId !== windowId);
    if (matchingAssignment) {
      const released = releaseRuntime(next.assignmentRegistry, { runtimeAssignmentId: matchingAssignment.runtimeAssignmentId, assignmentEpoch: matchingAssignment.assignmentEpoch, now: adapters.now() });
      if (released.status !== "released") return { status: released.status, reason: released.reason || "release_failed", authorityCommitted: false, authorityVerified: false };
      next.assignmentRegistry = released.registry;
    }
    next.authorityRevision += 1;
    const verification = await persistExpected(adapters, next);
    const committedStatus = matchingAssignment ? "released" : "context_removed";
    return { status: verification.verified ? committedStatus : "failed", reason: verification.reason, windowId, assignment: matchingAssignment, authorityRevision: next.authorityRevision, runtimeSessionId: next.runtimeSessionId, authorityCommitted: verification.committed, authorityVerified: verification.verified, retrySafe: verification.retrySafe, diagnosticAction: verification.verified ? "runtime_session_window_authority_cleaned" : "runtime_session_authority_verification_failed" };
  }));
}

async function commitAssignmentTransition(adapters, details, root, transitioned, action) {
  if (transitioned.status !== "assigned" && transitioned.status !== "released") return internalResult(details, transitioned.status, transitioned.reason || "", root, transitioned.assignment);
  const next = clone(root); next.assignmentRegistry = transitioned.registry; next.authorityRevision += 1;
  const verification = await persistExpected(adapters, next);
  return { ...internalResult(details, verification.verified ? transitioned.status : "failed", verification.reason, next, verification.verified ? transitioned.assignment : null), authorityCommitted: verification.committed, authorityVerified: verification.verified, retrySafe: verification.retrySafe, diagnosticAction: verification.verified ? action : "runtime_session_authority_verification_failed" };
}

async function writeAndVerify(adapters, request, expected, transitioned, action) {
  const verification = await persistExpected(adapters, expected);
  const result = createContextResult({ ...request, status: verification.verified ? transitioned.status : "failed", reason: verification.reason, runtimeSessionId: expected.runtimeSessionId, authorityRevision: expected.authorityRevision, authorityCommitted: verification.committed, authorityVerified: verification.verified, context: transitioned.context, assignment: verification.verified ? transitioned.assignment : null, retrySafe: verification.retrySafe, warnings: [], errors: [] });
  result.diagnosticAction = verification.verified ? action : "runtime_session_authority_verification_failed";
  return result;
}

async function persistExpected(adapters, expected) {
  try { await adapters.writeAuthority(expected); }
  catch (error) { return { verified: false, committed: false, retrySafe: true, reason: "authority_write_failed", error }; }
  let fresh;
  try { fresh = await adapters.readAuthority(); }
  catch (error) { return { verified: false, committed: true, retrySafe: false, reason: "authority_verification_read_failed", error }; }
  const verified = validateSessionAuthority(fresh).valid && rootsEqual(expected, fresh);
  return { fresh, verified, committed: true, retrySafe: false, reason: verified ? "" : "authority_verification_failed" };
}

async function verifyExisting(adapters, expected) {
  let fresh;
  try { fresh = await adapters.readAuthority(); }
  catch (error) { return { verified: false, committed: false, retrySafe: true, reason: "authority_verification_read_failed", error }; }
  const verified = validateSessionAuthority(fresh).valid && rootsEqual(expected, fresh);
  return { fresh, verified, committed: false, retrySafe: !verified, reason: verified ? "" : "authority_verification_failed" };
}

async function loadValid(adapters) {
  const root = await adapters.readAuthority();
  if (root === undefined) return { valid: false, result: { status: "rejected", reason: "authority_absent", authorityCommitted: false, authorityVerified: false } };
  const validation = validateSessionAuthority(root);
  return validation.valid ? { valid: true, root } : { valid: false, result: { status: "rejected", reason: "malformed_authority", errors: validation.errors, authorityCommitted: false, authorityVerified: false } };
}

async function verifyWindow(adapters, windowId) {
  try { const verifiedWindow = await adapters.getWindow(windowId); return verifiedWindow && verifiedWindow.id === windowId && Number.isInteger(verifiedWindow.id) && verifiedWindow.id >= 0 ? { valid: true, verifiedWindow } : { valid: false, errors: ["window identity mismatch"] }; }
  catch (error) { return { valid: false, errors: [String(error?.message || error)] }; }
}

function internalResult(details, status, reason, root, assignment = null) {
  return { status, reason, operationId: details.operationId || "", workspaceId: details.workspaceId || assignment?.workspaceId || "", windowId: details.windowId ?? assignment?.windowId ?? -1, runtimeSessionId: root?.runtimeSessionId || "", authorityRevision: root?.authorityRevision ?? -1, assignment: assignment ? clone(assignment) : null, authorityCommitted: false, authorityVerified: false, retrySafe: false, warnings: [], errors: [] };
}

async function coordinateWithDiagnostic(adapters, operation, failureFactory) {
  let result;
  try { result = await operation(); }
  catch (error) { result = failureFactory ? failureFactory(error) : { status: "failed", reason: "coordination_failure", authorityCommitted: false, authorityVerified: false, retrySafe: true, warnings: [], errors: [String(error?.message || error)] }; }
  const action = result.diagnosticAction;
  if (action && adapters.recordDiagnostic) {
    try { await adapters.recordDiagnostic(action, result); }
    catch { result = { ...result, warnings: [...(result.warnings || []), "diagnostic_failed"] }; }
  }
  if (Object.hasOwn(result, "diagnosticAction")) { result = { ...result }; delete result.diagnosticAction; }
  return result;
}
