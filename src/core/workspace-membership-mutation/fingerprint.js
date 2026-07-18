import { stableStringify } from "../runtime-contract/value-utils.js";

export function createMembershipRequestFingerprint(request) {
  return "membership:" + fingerprintValue({
    schema: request.schema,
    mutationKind: request.mutationKind,
    workspaceId: request.workspaceId,
    sourceContextId: request.sourceContextId,
    sourceWindowId: request.sourceWindowId,
    expectedWorkspaceRevision: request.expectedWorkspaceRevision,
    workspaceTabsToAdd: request.workspaceTabsToAdd,
    promotionOperationId: request.promotionOperationId,
    nextRuntimeAssignmentId: request.nextRuntimeAssignmentId
  });
}

export function fingerprintValue(value) {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return "fnv1a32:" + (hash >>> 0).toString(16).padStart(8, "0") + ":" + text.length;
}
