import { stableStringify } from "../runtime-contract/value-utils.js";

export function createPromotionRequestFingerprint(request) {
  return stableStringify({
    schema: request.schema,
    triggerOperationId: request.triggerOperationId,
    triggerKind: request.triggerKind,
    workspaceId: request.workspaceId,
    sourceContextId: request.sourceContextId,
    sourceWindowId: request.sourceWindowId,
    expectedWorkspaceRevision: request.expectedWorkspaceRevision,
    previousEligibleTabCount: request.previousEligibleTabCount,
    currentEligibleTabCount: request.currentEligibleTabCount,
    threshold: request.threshold,
    nextRuntimeAssignmentId: request.nextRuntimeAssignmentId
  });
}
