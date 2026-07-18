import {
  MANUAL_PLACEMENT_REQUEST_SCHEMA,
  MANUAL_PLACEMENT_TYPE,
  createManualPlacementResult,
  normalizeManualPlacementIdentities,
  snapshotAndValidateManualPlacementRequest,
  snapshotSerializable,
  validateManualPlacementResult
} from "./contract.js";
import { createManualPlacementFingerprint } from "./fingerprint.js";

export function createWorkspaceManualPlacementClient({ createId, now, send }) {
  let pendingRequest = null;
  let inFlight = null;
  return {
    submit(input) {
      if (inFlight) return matchesInput(pendingRequest, input) ? inFlight : Promise.resolve(pendingInputConflict(pendingRequest));
      if (pendingRequest && !matchesInput(pendingRequest, input)) return Promise.resolve(pendingInputConflict(pendingRequest));
      if (!pendingRequest) pendingRequest = createRequest(input, createId, now);
      inFlight = execute(pendingRequest, send).finally(() => { inFlight = null; });
      return inFlight.then((result) => {
        if (["committed", "replayed"].includes(result.status) && result.workspacePlacementVerified && result.timelineEvidenceVerified && result.assignmentVerified) pendingRequest = null;
        return result;
      });
    },
    get pendingRequest() { return pendingRequest ? structuredClone(pendingRequest) : null; }
  };
}

async function execute(request, send) {
  let candidate;
  try { candidate = await send(structuredClone(request)); } catch { candidate = null; }
  const candidateSnapshot = snapshotSerializable(candidate);
  return candidateSnapshot.ok && validateManualPlacementResult(candidateSnapshot.value, request) && candidateSnapshot.value.requestFingerprint === createManualPlacementFingerprint(request)
    ? candidateSnapshot.value
    : createManualPlacementResult(normalizeManualPlacementIdentities(request), { status: "failed", reason: candidate ? "malformed_or_mismatched_manual_placement_response" : "manual_placement_transport_failed", decision: "retry_transaction", phase: "result_serialization", retrySafe: true });
}

function createRequest(input, createId, now) {
  const requestedAt = now();
  const moveRequest = structuredClone(input.moveRequest);
  moveRequest.operationId = createId();
  moveRequest.requestedAt = requestedAt;
  const request = {
    type: MANUAL_PLACEMENT_TYPE,
    schema: MANUAL_PLACEMENT_REQUEST_SCHEMA,
    operationId: createId(),
    workspaceId: input.workspaceId,
    sourceContextId: input.sourceContextId,
    sourceWindowId: input.sourceWindowId,
    expectedWorkspaceRevision: input.expectedWorkspaceRevision,
    expectedRuntimeAssignmentId: input.expectedRuntimeAssignmentId,
    expectedAssignmentEpoch: input.expectedAssignmentEpoch,
    transferOperationId: createId(),
    nextRuntimeAssignmentId: createId(),
    requestedAt,
    moveRequest
  };
  const validation = snapshotAndValidateManualPlacementRequest(request);
  if (!validation.ok) throw new TypeError("Manual placement client input is invalid: " + (validation.errors || [validation.reason]).join("; "));
  return validation.value;
}

function matchesInput(request, input) {
  if (!request) return false;
  const snapshot = snapshotSerializable(input);
  if (!snapshot.ok || !snapshot.value || typeof snapshot.value !== "object" || !snapshot.value.moveRequest || typeof snapshot.value.moveRequest !== "object") return false;
  const candidate = snapshot.value;
  const moveRequest = { ...candidate.moveRequest, operationId: request.moveRequest.operationId, requestedAt: request.requestedAt };
  return request.workspaceId === candidate.workspaceId &&
    request.sourceContextId === candidate.sourceContextId &&
    request.sourceWindowId === candidate.sourceWindowId &&
    request.expectedWorkspaceRevision === candidate.expectedWorkspaceRevision &&
    request.expectedRuntimeAssignmentId === candidate.expectedRuntimeAssignmentId &&
    request.expectedAssignmentEpoch === candidate.expectedAssignmentEpoch &&
    JSON.stringify(request.moveRequest) === JSON.stringify(moveRequest);
}

function pendingInputConflict(request) {
  return createManualPlacementResult(normalizeManualPlacementIdentities(request || {}), {
    status: "conflict",
    reason: "manual_placement_pending_input_mismatch",
    decision: "manual_resolution_required",
    phase: "request_validation",
    requestFingerprint: request ? createManualPlacementFingerprint(request) : ""
  });
}
