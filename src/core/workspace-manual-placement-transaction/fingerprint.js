import { stableStringify } from "../runtime-contract/value-utils.js";

export function createManualPlacementFingerprint(request) {
  return stableStringify({
    schema: request.schema,
    operationId: request.operationId,
    workspaceId: request.workspaceId,
    sourceContextId: request.sourceContextId,
    sourceWindowId: request.sourceWindowId,
    expectedWorkspaceRevision: request.expectedWorkspaceRevision,
    expectedRuntimeAssignmentId: request.expectedRuntimeAssignmentId,
    expectedAssignmentEpoch: request.expectedAssignmentEpoch,
    transferOperationId: request.transferOperationId,
    nextRuntimeAssignmentId: request.nextRuntimeAssignmentId,
    requestedAt: request.requestedAt,
    moveRequest: request.moveRequest
  });
}
