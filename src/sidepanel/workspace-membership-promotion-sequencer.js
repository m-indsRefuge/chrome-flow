import { createWorkspaceMembershipClient } from "../core/workspace-membership-mutation/client.js";
import { evaluateMembershipPromotionTrigger } from "../core/workspace-membership-mutation/promotion-trigger.js";
import { normalizeWorkspaceRevision } from "../core/runtime-contract/revision.js";
import {
  createPromotionResult,
  validatePromotionResult
} from "../core/workspace-automatic-promotion-transaction/contract.js";

export function createWorkspaceMembershipPromotionSequencer({
  createId,
  now,
  sendMembership,
  sendPromotion,
  activateWorkspace,
  runMetadataBarrier,
  onPromotionStarting = async () => undefined
}) {
  const membershipClient = createWorkspaceMembershipClient({ createId, now, send: sendMembership });

  async function sequenceWorkspaceMembershipPromotion(input) {
    return runMetadataBarrier(async () => {
      const revision = normalizeWorkspaceRevision(input?.workspace);
      if (!revision.valid || input.workspace?.workspaceId !== input.workspaceId) return sequenceResult("membership_not_verified", null, null, null, "workspace_baseline_invalid");
      const activationState = await activateWorkspace(input.workspace);
      if (!validActivationState(activationState, input.workspaceId, revision.revision)) return sequenceResult("activation_not_verified", null, null, null, activationState?.reason || "runtime_workspace_activation_not_verified");
      const activation = activationState.result;

      const membershipInput = {
        mutationKind: input.mutationKind,
        workspaceId: input.workspaceId,
        sourceContextId: activation.sourceContextId,
        sourceWindowId: activation.sourceWindowId,
        expectedWorkspaceRevision: revision.revision,
        workspaceTabsToAdd: input.workspaceTabsToAdd
      };
      const membershipResult = await sendMembershipWithBoundedRetry(membershipClient, membershipInput);
      const membershipRequest = membershipClient.latestVerifiedRequest || membershipClient.pendingRequest;
      if (!verifiedMembershipSuccess(membershipResult) || !membershipRequest) {
        return sequenceResult("membership_not_verified", membershipResult, null, null, membershipResult?.reason || "membership_not_verified");
      }

      if (typeof input.afterMembership === "function") {
        try { await input.afterMembership({ membershipResult, membershipReceipt: membershipResult.receipt, membershipRequest }); }
        catch {
          return sequenceResult("post_membership_finalizer_failed", membershipResult, null, null, "post_membership_finalizer_failed");
        }
      }

      const promotionEvaluation = evaluateMembershipPromotionTrigger({
        membershipResult,
        membershipReceipt: membershipResult.receipt,
        promotionOperationId: membershipRequest.promotionOperationId,
        nextRuntimeAssignmentId: membershipRequest.nextRuntimeAssignmentId,
        requestedAt: membershipRequest.requestedAt
      });
      if (promotionEvaluation.decision === "no_promotion") {
        membershipClient.acknowledgeSequenceComplete(membershipRequest.operationId);
        return sequenceResult("membership_verified_below_threshold", membershipResult, promotionEvaluation, null, promotionEvaluation.reason);
      }
      if (promotionEvaluation.decision !== "submit_promotion") {
        return sequenceResult("promotion_not_verified", membershipResult, promotionEvaluation, null, promotionEvaluation.reason);
      }

      try {
        await onPromotionStarting({
          membershipResult,
          promotionEvaluation,
          promotionRequest: structuredClone(promotionEvaluation.promotionRequest)
        });
      } catch {
        // Operator feedback cannot alter deterministic promotion execution.
      }

      const promotionResult = await sendPromotionWithBoundedRetry(sendPromotion, promotionEvaluation.promotionRequest);
      if (["committed", "replayed", "no_change"].includes(promotionResult.status) && promotionResult.workspacePlacementVerified) {
        membershipClient.acknowledgeSequenceComplete(membershipRequest.operationId);
        return sequenceResult("promotion_verified", membershipResult, promotionEvaluation, promotionResult, promotionResult.reason);
      }
      return sequenceResult("promotion_not_verified", membershipResult, promotionEvaluation, promotionResult, promotionResult.reason);
    });
  }

  return {
    get membershipClient() { return membershipClient; },
    sequenceWorkspaceMembershipPromotion
  };
}

export function planSelectedMembershipBatch({ workspaceTabs, availableTabs, selectedIds, createWorkspaceTab }) {
  if (!Array.isArray(workspaceTabs) || !Array.isArray(availableTabs) || !Array.isArray(selectedIds) || typeof createWorkspaceTab !== "function") {
    throw new TypeError("Selected membership batch input is invalid");
  }
  const selectedIdSet = new Set(selectedIds);
  const selectedTabs = availableTabs.filter((tab) => selectedIdSet.has(tab.id));
  const added = [];
  let exactSkippedCount = 0;
  let duplicateUrlAddedCount = 0;
  for (const tab of selectedTabs) {
    if (workspaceTabs.some((workspaceTab) => workspaceTab.tabId === tab.id)) { exactSkippedCount += 1; continue; }
    const sameUrlDuplicate = workspaceTabs.some((workspaceTab) => workspaceTab.url && tab.url && workspaceTab.url === tab.url) || added.some((workspaceTab) => workspaceTab.url && tab.url && workspaceTab.url === tab.url);
    added.push(createWorkspaceTab(tab, { sameUrlDuplicate }));
    if (sameUrlDuplicate) duplicateUrlAddedCount += 1;
  }
  return { added, exactSkippedCount, duplicateUrlAddedCount, missingCount: selectedIds.length - selectedTabs.length };
}

export function findExactBrowserMembership(workspaceTabs, browserTabId) {
  if (!Array.isArray(workspaceTabs) || !Number.isSafeInteger(browserTabId) || browserTabId < 0) return null;
  return workspaceTabs.find((tab) => tab?.tabId === browserTabId) || null;
}

export function classifyExistingRecoveryMembership(workspaceTab, liveTabs) {
  if (!workspaceTab || typeof workspaceTab !== "object" || !Array.isArray(liveTabs)) {
    return { decision: "absent_record", liveTab: null, candidateCount: 0 };
  }
  const exact = Number.isSafeInteger(workspaceTab.tabId) && workspaceTab.tabId >= 0
    ? liveTabs.find((tab) => tab?.id === workspaceTab.tabId) || null
    : null;
  if (exact) return { decision: "existing_exact_live", liveTab: exact, candidateCount: 1 };
  const urlMatches = liveTabs.filter((tab) => workspaceTab.url && tab?.url === workspaceTab.url);
  if (urlMatches.length === 1) {
    return { decision: "existing_record_requires_refresh", liveTab: urlMatches[0], candidateCount: 1 };
  }
  if (urlMatches.length > 1) {
    return { decision: "existing_record_ambiguous", liveTab: null, candidateCount: urlMatches.length };
  }
  return { decision: "existing_record_missing", liveTab: null, candidateCount: 0 };
}


export function createBrowserTabMembershipFailureEvidence(details) {
  return {
    ...(details && typeof details === "object" ? details : {}),
    recoveryActions: { browserTabLeftOpen: true, canRetryWorkspaceMembership: true }
  };
}

function validActivationState(state, workspaceId, workspaceRevision) {
  const result = state?.result;
  return Boolean(
    state?.status === "active" &&
    ["committed", "no_change", "replayed"].includes(result?.status) &&
    result.workspaceVerified === true &&
    result.assignmentVerified === true &&
    result.activeWorkspaceId === workspaceId &&
    result.activeWorkspaceRevision === workspaceRevision &&
    result.targetWindowId === result.sourceWindowId &&
    typeof result.sourceContextId === "string" && result.sourceContextId.length > 0 &&
    Number.isSafeInteger(result.sourceWindowId) && result.sourceWindowId >= 0 &&
    typeof result.currentRuntimeAssignmentId === "string" && result.currentRuntimeAssignmentId.length > 0 &&
    Number.isSafeInteger(result.currentAssignmentEpoch) && result.currentAssignmentEpoch > 0
  );
}

function verifiedMembershipSuccess(result) {
  return ["committed", "replayed", "no_change"].includes(result?.status) && result.membershipVerified === true && result.compatiblePeersVerified === true && result.receipt;
}

function validPromotionResponse(result, request) {
  return validatePromotionResult(result) &&
    result.operationId === request.operationId &&
    result.triggerOperationId === request.triggerOperationId &&
    result.workspaceId === request.workspaceId &&
    result.sourceContextId === request.sourceContextId &&
    result.sourceWindowId === request.sourceWindowId &&
    result.threshold === request.threshold &&
    result.previousEligibleTabCount === request.previousEligibleTabCount &&
    result.currentEligibleTabCount === request.currentEligibleTabCount &&
    result.workspaceRevisionBefore === request.expectedWorkspaceRevision &&
    result.nextRuntimeAssignmentId === request.nextRuntimeAssignmentId;
}

async function sendMembershipWithBoundedRetry(membershipClient, input) {
  const first = await membershipClient.submit(input);
  if (!shouldRetryMembership(first)) return first;
  return membershipClient.submit(input);
}

function shouldRetryMembership(result) {
  return ["failed", "indeterminate"].includes(result?.status) && result.retrySafe === true;
}

async function sendPromotionWithBoundedRetry(sendPromotion, request) {
  const first = await sendPromotionAttempt(sendPromotion, request);
  if (!first.retry) return first.result;
  return (await sendPromotionAttempt(sendPromotion, request)).result;
}

async function sendPromotionAttempt(sendPromotion, request) {
  let candidate;
  try { candidate = await sendPromotion(request); }
  catch { return { result: failedPromotionResult(request, "promotion_transport_failed"), retry: true }; }
  if (!validPromotionResponse(candidate, request)) {
    return { result: failedPromotionResult(request, "malformed_or_mismatched_promotion_response"), retry: true };
  }
  return {
    result: candidate,
    retry: ["failed", "indeterminate"].includes(candidate.status) && candidate.retrySafe === true
  };
}

function failedPromotionResult(request, reason) {
  return createPromotionResult({
    operationId: request.operationId,
    triggerOperationId: request.triggerOperationId,
    workspaceId: request.workspaceId,
    sourceContextId: request.sourceContextId,
    sourceWindowId: request.sourceWindowId,
    threshold: request.threshold,
    previousEligibleTabCount: request.previousEligibleTabCount,
    currentEligibleTabCount: request.currentEligibleTabCount,
    nextRuntimeAssignmentId: request.nextRuntimeAssignmentId
  }, {
    status: "failed",
    reason,
    decision: "retry_transaction",
    phase: "result_serialization",
    retrySafe: true,
    errors: [reason]
  });
}

function sequenceResult(status, membershipResult, promotionEvaluation, promotionResult, reason) {
  return { status, reason, membershipResult, promotionEvaluation, promotionResult };
}
