import { stableStringify, validDateTime } from "../runtime-contract/value-utils.js";
import {
  PROMOTION_REQUEST_SCHEMA,
  PROMOTION_THRESHOLD,
  snapshotAndValidatePromotionRequest
} from "../workspace-automatic-promotion-transaction/contract.js";
import { validateMembershipReceipt, validateMembershipResult } from "./contract.js";

export function evaluateMembershipPromotionTrigger(input) {
  const resultValidation = validateMembershipResult(input?.membershipResult);
  const receiptValidation = validateMembershipReceipt(input?.membershipReceipt);
  if (!resultValidation.valid || !receiptValidation.valid) return decision("invalid_receipt", "membership_contract_invalid");
  const result = resultValidation.value;
  const receipt = receiptValidation.value;
  if (!["committed", "replayed", "no_change"].includes(result.status)) return decision("no_promotion", "membership_not_verified_success");
  if (stableStringify(result.receipt) !== stableStringify(receipt)) return decision("invalid_receipt", "receipt_result_mismatch");
  if (!receipt.membershipVerified || !receipt.compatiblePeersVerified) return decision("invalid_receipt", "receipt_not_verified");
  if (receipt.currentEligibleTabCount <= receipt.previousEligibleTabCount) return decision("no_promotion", "eligible_membership_not_increased");
  if (receipt.currentEligibleTabCount < PROMOTION_THRESHOLD) return decision("no_promotion", "below_promotion_threshold");
  if (!nonEmptyString(input?.promotionOperationId) || !nonEmptyString(input?.nextRuntimeAssignmentId) || !validDateTime(input?.requestedAt)) {
    return decision("invalid_receipt", "promotion_identity_invalid");
  }
  const promotionRequest = {
    schema: PROMOTION_REQUEST_SCHEMA,
    operationId: input.promotionOperationId,
    triggerOperationId: receipt.mutationOperationId,
    triggerKind: "workspace_membership_increased",
    workspaceId: receipt.workspaceId,
    sourceContextId: receipt.sourceContextId,
    sourceWindowId: receipt.sourceWindowId,
    expectedWorkspaceRevision: receipt.workspaceRevisionAfter,
    previousEligibleTabCount: receipt.previousEligibleTabCount,
    currentEligibleTabCount: receipt.currentEligibleTabCount,
    threshold: PROMOTION_THRESHOLD,
    nextRuntimeAssignmentId: input.nextRuntimeAssignmentId,
    requestedAt: input.requestedAt
  };
  const validation = snapshotAndValidatePromotionRequest(promotionRequest);
  return validation.ok
    ? decision("submit_promotion", "threshold_crossing_verified", validation.value)
    : decision("invalid_receipt", "promotion_request_invalid");
}

function decision(value, reason, promotionRequest = null) { return { decision: value, reason, promotionRequest }; }
function nonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }
