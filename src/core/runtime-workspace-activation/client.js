import {
  ACTIVATION_OPERATIONS,
  RUNTIME_WORKSPACE_ACTIVATION_REQUEST_SCHEMA,
  RUNTIME_WORKSPACE_ACTIVATION_TYPE,
  createActivationResult,
  normalizeActivationIdentities,
  snapshotAndValidateActivationRequest,
  snapshotSerializable,
  validateActivationResult
} from "./contract.js";
import { createActivationRequestFingerprint } from "./fingerprint.js";

export function createRuntimeWorkspaceActivationClient({ createId, now, send }) {
  let pendingRequest = null;
  let inFlight = null;
  let latestVerifiedResult = null;

  function submit(operation, input) {
    if (inFlight) {
      if (!pendingRequest || !matchesInput(pendingRequest, operation, input)) return Promise.resolve(clientConflict(pendingRequest || requestPreview(operation, input), "activation_client_in_flight_input_mismatch"));
      return inFlight;
    }
    if (pendingRequest && !matchesInput(pendingRequest, operation, input)) pendingRequest = null;
    if (!pendingRequest) pendingRequest = createRequest(operation, input, createId, now);
    const request = pendingRequest;
    inFlight = executeWithBoundedRetry(request, send).finally(() => { inFlight = null; });
    return inFlight.then((result) => {
      if (["committed", "no_change", "replayed"].includes(result.status) && result.workspaceVerified && result.assignmentVerified) {
        latestVerifiedResult = result;
        pendingRequest = null;
      }
      return result;
    });
  }

  return {
    bootstrapExisting: (input) => submit(ACTIVATION_OPERATIONS.bootstrapExisting, input),
    replaceActive: (input) => submit(ACTIVATION_OPERATIONS.replaceActive, input),
    transferActive: (input) => submit(ACTIVATION_OPERATIONS.transferActive, input),
    get pendingRequest() { return cloneOrNull(pendingRequest); },
    get latestVerifiedResult() { return cloneOrNull(latestVerifiedResult); }
  };
}

async function executeWithBoundedRetry(request, send) {
  let attempts = 0;
  let lastResult;
  while (attempts < 2) {
    attempts += 1;
    let candidate;
    try { candidate = await send(structuredClone(request)); }
    catch { candidate = null; }
    const candidateSnapshot = snapshotSerializable(candidate);
    if (!candidateSnapshot.ok || !validateActivationResult(candidateSnapshot.value, request) || candidateSnapshot.value.requestFingerprint !== createActivationRequestFingerprint(request)) {
      lastResult = createActivationResult(normalizeActivationIdentities(request), { status: "failed", reason: candidate === null ? "activation_transport_failed" : "malformed_or_mismatched_activation_response", decision: "retry_activation", phase: "result_serialization", retrySafe: true });
    } else {
      lastResult = candidateSnapshot.value;
    }
    if (!(attempts < 2 && ["failed", "indeterminate"].includes(lastResult.status) && lastResult.retrySafe)) break;
  }
  return lastResult;
}

function createRequest(operation, input, createId, now) {
  const request = {
    type: RUNTIME_WORKSPACE_ACTIVATION_TYPE,
    schema: RUNTIME_WORKSPACE_ACTIVATION_REQUEST_SCHEMA,
    operationId: createId(),
    operation,
    sourceContextId: input?.sourceContextId,
    sourceWindowId: input?.sourceWindowId,
    expectedWorkspaceId: input?.expectedWorkspaceId,
    expectedWorkspaceRevision: input?.expectedWorkspaceRevision,
    candidateWorkspace: input?.candidateWorkspace ?? null,
    targetWindowId: input?.targetWindowId ?? null,
    expectedRuntimeAssignmentId: input?.expectedRuntimeAssignmentId ?? null,
    expectedAssignmentEpoch: input?.expectedAssignmentEpoch ?? null,
    nextRuntimeAssignmentId: createId(),
    requestedAt: now()
  };
  const validation = snapshotAndValidateActivationRequest(request);
  if (!validation.ok) throw new TypeError("Activation client input is invalid: " + (validation.errors || [validation.reason]).join("; "));
  return validation.value;
}

function matchesInput(request, operation, input) {
  const preview = requestPreview(operation, input);
  const snapshot = snapshotSerializable(preview);
  if (!snapshot.ok) return false;
  return request.operation === snapshot.value.operation &&
    request.sourceContextId === snapshot.value.sourceContextId &&
    request.sourceWindowId === snapshot.value.sourceWindowId &&
    request.expectedWorkspaceId === snapshot.value.expectedWorkspaceId &&
    request.expectedWorkspaceRevision === snapshot.value.expectedWorkspaceRevision &&
    JSON.stringify(request.candidateWorkspace) === JSON.stringify(snapshot.value.candidateWorkspace) &&
    request.targetWindowId === snapshot.value.targetWindowId &&
    request.expectedRuntimeAssignmentId === snapshot.value.expectedRuntimeAssignmentId &&
    request.expectedAssignmentEpoch === snapshot.value.expectedAssignmentEpoch;
}

function requestPreview(operation, input) {
  return {
    operation,
    sourceContextId: input?.sourceContextId,
    sourceWindowId: input?.sourceWindowId,
    expectedWorkspaceId: input?.expectedWorkspaceId,
    expectedWorkspaceRevision: input?.expectedWorkspaceRevision,
    candidateWorkspace: input?.candidateWorkspace ?? null,
    targetWindowId: input?.targetWindowId ?? null,
    expectedRuntimeAssignmentId: input?.expectedRuntimeAssignmentId ?? null,
    expectedAssignmentEpoch: input?.expectedAssignmentEpoch ?? null
  };
}
function clientConflict(request, reason) { return createActivationResult(normalizeActivationIdentities(request), { status: "conflict", reason, decision: "manual_resolution_required", phase: "request_validation" }); }
function cloneOrNull(value) { const snapshot = snapshotSerializable(value); return snapshot.ok ? snapshot.value : null; }
