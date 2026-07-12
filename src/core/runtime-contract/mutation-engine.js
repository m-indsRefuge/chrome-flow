import { SCHEMAS } from "./constants.js";
import { validateEnvelopeAssignment } from "./assignments.js";
import { createRequestFingerprint, validateMutationEnvelope } from "./envelope.js";
import { inspectOperation, recordOperation } from "./ledger.js";
import { applyDomainMutation } from "./reducers.js";
import { normalizeWorkspaceRevision } from "./revision.js";
import { clone } from "./value-utils.js";
function safeIdentity(value) { return typeof value === "string" && value.trim().length ? value : ""; }
function resultFor(envelope, status, fields = {}) { return { schema: SCHEMAS.result, operationId: safeIdentity(envelope.operationId), status, workspaceId: safeIdentity(envelope.workspaceId), runtimeAssignmentId: safeIdentity(envelope.runtimeAssignmentId), writerContextId: safeIdentity(envelope.contextId), ...fields }; }
export function evaluateRuntimeMutation({ workspace, envelope, operationLedger, assignmentRegistry, now }) {
  const original = clone(workspace); const validation = validateMutationEnvelope(envelope);
  if (!validation.valid) return { workspace: original, operationLedger: clone(operationLedger), result: resultFor(envelope || {}, "rejected", { reason: "invalid_envelope", errors: validation.errors }) };
  const fingerprint = createRequestFingerprint(envelope); const inspected = inspectOperation(operationLedger, envelope.operationId, fingerprint);
  if (inspected.status === "replay") return { workspace: original, operationLedger: clone(operationLedger), result: { ...clone(inspected.entry.result), status: "replayed", replayedAt: now, originalStatus: inspected.entry.result.status } };
  if (inspected.status === "conflict") return { workspace: original, operationLedger: clone(operationLedger), result: resultFor(envelope, "operation_id_conflict", { reason: "operation_id_reused_with_different_request" }) };
  let status; let reason; let nextWorkspace = original; let previousRevision = null; let committedRevision = null;
  if (original.workspaceId !== envelope.workspaceId) { status = "workspace_conflict"; reason = "workspace_id_mismatch"; }
  else { const revision = normalizeWorkspaceRevision(original); previousRevision = revision.revision;
    if (!revision.valid) { status = "rejected"; reason = "invalid_workspace_revision"; }
    else if (!validateEnvelopeAssignment(assignmentRegistry, envelope).valid) { status = "assignment_conflict"; reason = "stale_or_missing_assignment"; }
    else if (revision.revision !== envelope.expectedRevision) { status = "revision_conflict"; reason = "expected_revision_mismatch"; }
    else { const reduced = applyDomainMutation(original, envelope.mutationType, envelope.payload);
      if (reduced.outcome === "changed") { status = "committed"; committedRevision = revision.revision + 1; nextWorkspace = { ...reduced.workspace, workspaceRevision: committedRevision }; }
      else if (reduced.outcome === "no_change") { status = "no_change"; committedRevision = revision.revision; }
      else { status = "rejected"; reason = reduced.reason; }
    }
  }
  const result = resultFor(envelope, status, { previousRevision, committedRevision, committedAt: status === "committed" ? now : null, reason: reason || null });
  const recorded = recordOperation(operationLedger, { operationId: envelope.operationId, requestFingerprint: fingerprint, result, recordedAt: now });
  return { workspace: nextWorkspace, operationLedger: recorded.ledger, result };
}
