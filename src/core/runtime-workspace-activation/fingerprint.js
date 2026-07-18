import { stableStringify } from "../runtime-contract/value-utils.js";

export function createActivationRequestFingerprint(request) {
  return stableStringify({
    schema: request.schema,
    operation: request.operation,
    operationId: request.operationId,
    sourceContextId: request.sourceContextId,
    sourceWindowId: request.sourceWindowId,
    expectedWorkspaceId: request.expectedWorkspaceId,
    expectedWorkspaceRevision: request.expectedWorkspaceRevision,
    candidateWorkspace: request.candidateWorkspace,
    targetWindowId: request.targetWindowId,
    expectedRuntimeAssignmentId: request.expectedRuntimeAssignmentId,
    expectedAssignmentEpoch: request.expectedAssignmentEpoch,
    nextRuntimeAssignmentId: request.nextRuntimeAssignmentId,
    requestedAt: request.requestedAt
  });
}
