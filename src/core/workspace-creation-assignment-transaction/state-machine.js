import { inspectOperation } from "../runtime-contract/ledger.js";
import { resolveAssignmentByWindow, resolveAssignmentByWorkspace, validateAssignmentRegistry } from "../runtime-contract/assignments.js";
import { createWorkspaceFingerprint } from "./fingerprint.js";

export function classifyPriorOperation(ledger, operationId, requestFingerprint) { return inspectOperation(ledger, operationId, requestFingerprint); }

export function mapFreshResolution(result) {
  if (result.status === "creation_required" && result.decision === "create_workspace_and_assign") return { action: "continue" };
  if (result.status === "resolved" && result.decision === "use_resolved_workspace" && result.resolvedWorkspaceId) return { action: "redirect", resolvedWorkspaceId: result.resolvedWorkspaceId };
  if (result.status === "ambiguous" && result.decision === "manual_resolution_required") return { action: "conflict" };
  if (result.status === "invalid" && result.decision === "reject_request") return { action: "invalid" };
  if (result.status === "failed" && result.decision === "retry_collection") return { action: "retry" };
  return { action: "invalid" };
}

export function classifyWorkspaceState(status, workspace, requestedWorkspace) {
  if (status === "absent") return { action: "create" };
  if (status !== "present") return { action: "retry" };
  return createWorkspaceFingerprint(workspace) === createWorkspaceFingerprint(requestedWorkspace) ? { action: "matching" } : { action: "conflict" };
}

export function classifyAssignmentState(registry, request) {
  const validation = validateAssignmentRegistry(registry);
  if (!validation.valid) return { action: "invalid", errors: validation.errors };
  const destination = resolveAssignmentByWindow(registry, request.windowId);
  const workspace = resolveAssignmentByWorkspace(registry, request.workspaceId);
  if (!destination && !workspace) return { action: "assign" };
  if (destination && workspace && destination.runtimeAssignmentId === workspace.runtimeAssignmentId && exactAssignment(destination, request)) return { action: "matching", assignment: destination };
  if (destination) return { action: "destination_conflict", assignment: destination };
  return { action: "workspace_conflict", assignment: workspace };
}

export function classifyFinalResult(details) {
  if (!details.workspaceVerified || !details.assignmentVerified) return { status: "failed", decision: "retry_transaction", reason: "final_verification_failed" };
  if (details.replayed) return { status: "replayed", decision: "use_created_workspace", reason: "transaction_replayed" };
  return { status: "committed", decision: "use_created_workspace", reason: "transaction_committed" };
}

export function exactAssignment(assignment, request) {
  return assignment?.state === "active" && assignment.runtimeAssignmentId === request.runtimeAssignmentId && assignment.workspaceId === request.workspaceId && assignment.windowId === request.windowId && assignment.sourceContextId === request.contextId && Number.isInteger(assignment.assignmentEpoch) && assignment.assignmentEpoch > 0;
}
