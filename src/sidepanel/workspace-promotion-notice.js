import { validateMembershipResult } from "../core/workspace-membership-mutation/contract.js";
import { validatePromotionResult } from "../core/workspace-automatic-promotion-transaction/contract.js";

const CREATE_COMMITTED_TEXT = "This workspace reached four tabs and was moved to a dedicated window.";
const ATTACH_COMMITTED_TEXT = "The new tab was added to this workspace's dedicated window.";
const ALREADY_VERIFIED_TEXT = "Dedicated-window placement was already verified.";
const NOT_VERIFIED_TEXT = "The tab was added to the workspace, but dedicated-window placement could not yet be verified. Constellation preserved the workspace and recovery evidence.";
const PROMOTION_STARTING_TEXT = "This workspace reached four tabs. Moving it to a dedicated window and verifying authority and group placement…";

export function deriveWorkspacePromotionNotice(sequence) {
  const membershipValidation = validateMembershipResult(sequence?.membershipResult);
  if (!membershipValidation.valid || !["committed", "replayed", "no_change"].includes(sequence.membershipResult.status)) return null;
  const membership = membershipValidation.value;
  if (sequence.status === "membership_verified_below_threshold") return null;

  const promotion = sequence.promotionResult;
  if (validatePromotionResult(promotion)) {
    if (promotion.status === "committed" && promotion.moveMode === "create_dedicated_window") {
      return notice("create_committed", CREATE_COMMITTED_TEXT, membership.operationId, promotion.operationId, "transferred");
    }
    if (promotion.status === "committed" && promotion.moveMode === "attach_to_existing_dedicated_window") {
      return notice("attach_committed", ATTACH_COMMITTED_TEXT, membership.operationId, promotion.operationId, "unchanged");
    }
    if (["replayed", "no_change"].includes(promotion.status) && promotion.workspacePlacementVerified) {
      return notice("already_verified", ALREADY_VERIFIED_TEXT, membership.operationId, promotion.operationId, promotion.moveMode === "create_dedicated_window" ? "transferred" : "unchanged");
    }
    if (["conflict", "failed", "indeterminate", "invalid"].includes(promotion.status)) {
      return notice("placement_not_verified", NOT_VERIFIED_TEXT, membership.operationId, promotion.operationId, "unknown");
    }
  }
  if (["promotion_not_verified", "post_membership_finalizer_failed"].includes(sequence.status)) {
    return notice("placement_not_verified", NOT_VERIFIED_TEXT, membership.operationId, "", "unknown");
  }
  return null;
}

export function createWorkspacePromotionNoticeController(element) {
  const announced = new Set();
  if (element) {
    element.setAttribute("role", "status");
    element.setAttribute("aria-live", "polite");
    element.setAttribute("aria-atomic", "true");
  }

  function showPending(details = {}) {
    if (!element) return { shown: false, reason: "notice_element_absent" };
    element.dataset.noticeKind = "promotion_pending";
    element.dataset.sourceAssignmentOwnership = "pending";
    element.dataset.promotionOperationId = typeof details?.promotionRequest?.operationId === "string"
      ? details.promotionRequest.operationId
      : "";
    element.textContent = PROMOTION_STARTING_TEXT;
    element.hidden = false;
    return { shown: true, reason: "pending_notice_rendered" };
  }

  function showSequence(sequence) {
    if (!element) return { shown: false, reason: "notice_element_absent" };
    const derived = deriveWorkspacePromotionNotice(sequence);
    if (!derived) {
      element.textContent = "";
      element.hidden = true;
      delete element.dataset.noticeKind;
      delete element.dataset.sourceAssignmentOwnership;
      delete element.dataset.promotionOperationId;
      return { shown: false, reason: "no_notice_required" };
    }
    const identity = [derived.membershipOperationId, derived.promotionOperationId, derived.kind].join("::");
    if (announced.has(identity)) return { shown: false, reason: "duplicate_terminal_notice" };
    announced.add(identity);
    element.dataset.noticeKind = derived.kind;
    element.dataset.sourceAssignmentOwnership = derived.sourceAssignmentOwnership;
    element.textContent = derived.text;
    element.dataset.promotionOperationId = derived.promotionOperationId;
    element.hidden = false;
    return { shown: true, reason: "notice_rendered", notice: derived };
  }

  return { showPending, showSequence };
}

function notice(kind, text, membershipOperationId, promotionOperationId, sourceAssignmentOwnership) {
  return { kind, text, membershipOperationId, promotionOperationId, sourceAssignmentOwnership };
}

export {
  ALREADY_VERIFIED_TEXT,
  ATTACH_COMMITTED_TEXT,
  CREATE_COMMITTED_TEXT,
  NOT_VERIFIED_TEXT,
  PROMOTION_STARTING_TEXT
};
