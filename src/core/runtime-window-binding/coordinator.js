import { resolveAssignmentByWindow, resolveAssignmentByWorkspace } from "../runtime-contract/assignments.js";
import { stableStringify } from "../runtime-contract/value-utils.js";
import { validateActiveContext, validateSessionAuthority } from "../runtime-session-authority/contract.js";
import { runtimeWorkspaceFingerprint, snapshotAndValidateRuntimeWorkspaceRecord } from "../runtime-workspace-record/contract.js";
import {
  createWindowBindingResolveResult,
  snapshotAndValidateWindowBindingResolveCommand
} from "./contract.js";

export async function coordinateRuntimeWindowBindingResolve(request, adapters) {
  const validation = snapshotAndValidateWindowBindingResolveCommand(request);
  if (!validation.valid) return createWindowBindingResolveResult(request, { status: "failed", reason: "invalid_request", phase: "command_validation", retrySafe: false, errors: validation.errors });
  const command = validation.command;
  try {
    return await adapters.withWindowLock(command.sourceWindowId, async () => resolveUnderWindowLock(command, adapters));
  } catch (error) {
    return createWindowBindingResolveResult(command, { status: "failed", reason: "binding_resolution_failed", phase: "coordination", retrySafe: true, errors: [safeError(error)] });
  }
}

async function resolveUnderWindowLock(command, adapters) {
  const first = await readAuthority(command, adapters, "precondition_read");
  if (first.result) return first.result;
  const initialAssignment = resolveAssignmentByWindow(first.root.assignmentRegistry, command.sourceWindowId);
  if (!initialAssignment) {
    const verification = await readAuthority(command, adapters, "verification");
    if (verification.result) return verification.result;
    const lateAssignment = resolveAssignmentByWindow(verification.root.assignmentRegistry, command.sourceWindowId);
    if (lateAssignment) return assignmentChangedResult(command, initialAssignment, lateAssignment, verification.root);
    return createWindowBindingResolveResult(command, { status: "unbound", phase: "complete", authorityRevision: verification.root.authorityRevision, authorityVerified: true });
  }
  return adapters.withWorkspaceBindingLock(initialAssignment.workspaceId, async () => resolveAssigned(command, adapters, initialAssignment));
}

async function resolveAssigned(command, adapters, initialAssignment) {
  const stable = await readAuthority(command, adapters, "assignment_verification");
  if (stable.result) return stable.result;
  const currentAssignment = resolveAssignmentByWindow(stable.root.assignmentRegistry, command.sourceWindowId);
  const assignmentFailure = compareAssignments(command, initialAssignment, currentAssignment, stable.root);
  if (assignmentFailure) return assignmentFailure;

  let rawRecord;
  try { rawRecord = await adapters.readRuntimeWorkspaceRecord(initialAssignment.workspaceId); }
  catch (error) { return createWindowBindingResolveResult(command, assignmentFields(initialAssignment, stable.root, { status: "failed", reason: "runtime_record_read_failed", phase: "runtime_record_read", retrySafe: true, errors: [safeError(error)] })); }
  const recordValidation = snapshotAndValidateRuntimeWorkspaceRecord(rawRecord, { workspaceId: initialAssignment.workspaceId, key: adapters.deriveRuntimeWorkspaceKey(initialAssignment.workspaceId) });
  if (!recordValidation.valid) return createWindowBindingResolveResult(command, assignmentFields(initialAssignment, stable.root, { status: "malformed_runtime_record", reason: rawRecord === undefined ? "runtime_record_absent" : "runtime_record_invalid", phase: "runtime_record_read", authorityVerified: true, errors: recordValidation.errors }));
  const fingerprint = runtimeWorkspaceFingerprint(recordValidation.record);

  const finalAuthority = await readAuthority(command, adapters, "verification");
  if (finalAuthority.result) return finalAuthority.result;
  const finalAssignment = resolveAssignmentByWindow(finalAuthority.root.assignmentRegistry, command.sourceWindowId);
  const finalAssignmentFailure = compareAssignments(command, initialAssignment, finalAssignment, finalAuthority.root);
  if (finalAssignmentFailure) return finalAssignmentFailure;
  let finalRawRecord;
  try { finalRawRecord = await adapters.readRuntimeWorkspaceRecord(initialAssignment.workspaceId); }
  catch (error) { return createWindowBindingResolveResult(command, assignmentFields(initialAssignment, finalAuthority.root, { status: "failed", reason: "runtime_record_verification_read_failed", phase: "verification", retrySafe: true, errors: [safeError(error)] })); }
  const finalRecordValidation = snapshotAndValidateRuntimeWorkspaceRecord(finalRawRecord, { workspaceId: initialAssignment.workspaceId, key: adapters.deriveRuntimeWorkspaceKey(initialAssignment.workspaceId) });
  if (!finalRecordValidation.valid || runtimeWorkspaceFingerprint(finalRecordValidation.record) !== fingerprint) return createWindowBindingResolveResult(command, assignmentFields(initialAssignment, finalAuthority.root, { status: "stale_assignment", reason: "runtime_record_changed_during_resolution", phase: "verification", authorityVerified: true, errors: finalRecordValidation.errors }));
  return createWindowBindingResolveResult(command, assignmentFields(initialAssignment, finalAuthority.root, {
    status: "assigned",
    phase: "complete",
    workspaceRevision: finalRecordValidation.record.workspaceRevision,
    workspace: finalRecordValidation.record.workspace,
    lifecycleState: finalRecordValidation.record.lifecycleState,
    authorityVerified: true,
    workspaceVerified: true
  }));
}

async function readAuthority(command, adapters, phase) {
  let root;
  try { root = await adapters.readAuthority(); }
  catch (error) { return { result: createWindowBindingResolveResult(command, { status: "failed", reason: "session_authority_read_failed", phase, retrySafe: true, errors: [safeError(error)] }) }; }
  const validation = validateSessionAuthority(root);
  if (!validation.valid) return { result: createWindowBindingResolveResult(command, { status: "failed", reason: root === undefined ? "session_authority_absent" : "malformed_session_authority", phase, retrySafe: false, errors: validation.errors }) };
  if (root.runtimeSessionId !== command.runtimeSessionId) return { result: createWindowBindingResolveResult(command, { status: "stale_context", reason: "runtime_session_mismatch", phase, errors: [] }) };
  const context = validateActiveContext(root, command.sourceContextId, command.sourceWindowId);
  if (!context.valid) return { result: createWindowBindingResolveResult(command, { status: "stale_context", reason: context.reason, phase, errors: [] }) };
  return { root };
}

function compareAssignments(command, expected, current, root) {
  if (current && sameAssignment(expected, current)) return null;
  const elsewhere = resolveAssignmentByWorkspace(root.assignmentRegistry, expected.workspaceId);
  if (elsewhere && elsewhere.windowId !== command.sourceWindowId) return createWindowBindingResolveResult(command, assignmentFields(elsewhere, root, { status: "active_elsewhere", reason: "workspace_assigned_to_another_window", phase: "assignment_verification", ownerWindowId: elsewhere.windowId, authorityVerified: true }));
  return createWindowBindingResolveResult(command, assignmentFields(expected, root, { status: "stale_assignment", reason: current ? "window_assignment_changed" : "window_assignment_released", phase: "assignment_verification", authorityVerified: true }));
}

function assignmentChangedResult(command, expected, current, root) {
  if (current) return createWindowBindingResolveResult(command, assignmentFields(current, root, { status: "stale_assignment", reason: "window_assignment_changed_during_resolution", phase: "verification", authorityVerified: true }));
  return createWindowBindingResolveResult(command, { status: "stale_assignment", reason: "window_assignment_changed_during_resolution", phase: "verification", authorityRevision: root.authorityRevision, authorityVerified: true });
}

function assignmentFields(assignment, root, fields) {
  return {
    workspaceId: assignment?.workspaceId,
    runtimeAssignmentId: assignment?.runtimeAssignmentId,
    assignmentEpoch: assignment?.assignmentEpoch,
    authorityRevision: root?.authorityRevision,
    ...fields
  };
}

function sameAssignment(left, right) {
  return Boolean(left && right && stableStringify({ id: left.runtimeAssignmentId, workspaceId: left.workspaceId, windowId: left.windowId, epoch: left.assignmentEpoch }) === stableStringify({ id: right.runtimeAssignmentId, workspaceId: right.workspaceId, windowId: right.windowId, epoch: right.assignmentEpoch }));
}
function safeError(error) { return String(error?.message || error || "unknown_error"); }
