import {
  MEMBERSHIP_REQUEST_SCHEMA,
  createMembershipResult,
  normalizeMembershipIdentities,
  snapshotAndValidateMembershipRequest,
  snapshotSerializable,
  validateMembershipResult
} from "./contract.js";

export function createWorkspaceMembershipClient({ createId, now, send }) {
  let pendingRequest = null;
  let inFlight = null;
  let latestVerifiedResult = null;
  let latestVerifiedRequest = null;

  function submit(input) {
    if (inFlight) {
      if (pendingRequest && !requestMatchesInput(pendingRequest, input)) {
        return Promise.resolve(createMembershipResult(normalizeMembershipIdentities(pendingRequest), {
          status: "conflict",
          reason: "membership_client_in_flight_input_mismatch"
        }));
      }
      return inFlight;
    }
    if (pendingRequest && !requestMatchesInput(pendingRequest, input)) pendingRequest = null;
    if (!pendingRequest) pendingRequest = createRequest(input, createId, now);
    const request = pendingRequest;
    inFlight = execute(request).finally(() => { inFlight = null; });
    return inFlight;
  }

  async function execute(request) {
    let candidate;
    try { candidate = await send(request); }
    catch {
      return createMembershipResult(normalizeMembershipIdentities(request), {
        status: "failed",
        reason: "membership_transport_failed",
        retrySafe: true
      });
    }
    const validation = validateMembershipResult(candidate, request);
    if (!validation.valid) {
      return createMembershipResult(normalizeMembershipIdentities(request), {
        status: "failed",
        reason: "malformed_or_mismatched_membership_response",
        retrySafe: true,
        errors: validation.errors
      });
    }
    if (["committed", "replayed", "no_change"].includes(candidate.status) && candidate.membershipVerified && candidate.compatiblePeersVerified) {
      latestVerifiedResult = candidate;
      latestVerifiedRequest = request;
    }
    return candidate;
  }

  function acknowledgeSequenceComplete(operationId) {
    if (pendingRequest?.operationId !== operationId) return false;
    pendingRequest = null;
    return true;
  }

  return {
    get pendingRequest() { return cloneOrNull(pendingRequest); },
    get latestVerifiedResult() { return cloneOrNull(latestVerifiedResult); },
    get latestVerifiedReceipt() { return cloneOrNull(latestVerifiedResult?.receipt || null); },
    get latestVerifiedRequest() { return cloneOrNull(latestVerifiedRequest); },
    acknowledgeSequenceComplete,
    submit
  };
}

function createRequest(input, createId, now) {
  const tabsSnapshot = snapshotSerializable(input?.workspaceTabsToAdd);
  const tabs = tabsSnapshot.ok && Array.isArray(tabsSnapshot.value)
    ? tabsSnapshot.value.sort((left, right) => compareText(left.workspaceTabId, right.workspaceTabId))
    : input?.workspaceTabsToAdd;
  const request = {
    schema: MEMBERSHIP_REQUEST_SCHEMA,
    operationId: createId(),
    mutationKind: input?.mutationKind,
    workspaceId: input?.workspaceId,
    sourceContextId: input?.sourceContextId,
    sourceWindowId: input?.sourceWindowId,
    expectedWorkspaceRevision: input?.expectedWorkspaceRevision,
    requestedAt: now(),
    workspaceTabsToAdd: tabs,
    promotionOperationId: createId(),
    nextRuntimeAssignmentId: createId()
  };
  const validation = snapshotAndValidateMembershipRequest(request);
  if (!validation.ok) throw new TypeError("Membership client input is invalid: " + (validation.errors || [validation.reason]).join("; "));
  return validation.value;
}

function cloneOrNull(value) {
  if (!value) return null;
  const snapshot = snapshotSerializable(value);
  return snapshot.ok ? snapshot.value : null;
}
function requestMatchesInput(request, input) {
  const snapshot = snapshotSerializable({
    mutationKind: input?.mutationKind,
    workspaceId: input?.workspaceId,
    sourceContextId: input?.sourceContextId,
    sourceWindowId: input?.sourceWindowId,
    expectedWorkspaceRevision: input?.expectedWorkspaceRevision,
    workspaceTabsToAdd: input?.workspaceTabsToAdd
  });
  if (!snapshot.ok) return false;
  const candidate = snapshot.value;
  candidate.workspaceTabsToAdd = Array.isArray(candidate.workspaceTabsToAdd)
    ? candidate.workspaceTabsToAdd.sort((left, right) => compareText(left.workspaceTabId, right.workspaceTabId))
    : candidate.workspaceTabsToAdd;
  return request.mutationKind === candidate.mutationKind &&
    request.workspaceId === candidate.workspaceId &&
    request.sourceContextId === candidate.sourceContextId &&
    request.sourceWindowId === candidate.sourceWindowId &&
    request.expectedWorkspaceRevision === candidate.expectedWorkspaceRevision &&
    JSON.stringify(request.workspaceTabsToAdd) === JSON.stringify(candidate.workspaceTabsToAdd);
}
function compareText(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
