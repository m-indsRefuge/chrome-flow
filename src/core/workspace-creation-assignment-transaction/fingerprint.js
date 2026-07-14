import { stableStringify } from "../runtime-contract/value-utils.js";

export function createTransactionRequestFingerprint(request) {
  return stableStringify({
    schema: request.schema,
    contextId: request.contextId,
    windowId: request.windowId,
    workspaceId: request.workspaceId,
    runtimeAssignmentId: request.runtimeAssignmentId,
    requestedAt: request.requestedAt,
    workspaceRecord: request.workspaceRecord,
    authorization: {
      resolutionOperationId: request.authorization.resolutionOperationId,
      resolutionResultSchema: request.authorization.resolutionResultSchema,
      status: request.authorization.status,
      decision: request.authorization.decision,
      contextId: request.authorization.contextId,
      windowId: request.authorization.windowId,
      operatorAuthorized: request.authorization.operatorAuthorized
    }
  });
}

export function createWorkspaceFingerprint(workspace) { return stableStringify(workspace); }
