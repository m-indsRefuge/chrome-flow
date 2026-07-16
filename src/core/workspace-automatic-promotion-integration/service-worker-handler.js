import {
  PROMOTION_REQUEST_SCHEMA,
  createPromotionResult,
  normalizePromotionIdentities,
  snapshotAndValidatePromotionRequest,
  validatePromotionResult
} from "../workspace-automatic-promotion-transaction/contract.js";
import { coordinateAutomaticWorkspacePromotion } from "../workspace-automatic-promotion-transaction/coordinator.js";
import {
  createAutomaticPromotionChromeAdapters,
  recordAutomaticPromotionDiagnostic
} from "./chrome-adapter.js";

export function handleAutomaticPromotionMessage(message, sender, sendResponse, options = {}) {
  if (!isAutomaticPromotionMessage(message)) return false;

  const identities = normalizePromotionIdentities(message);
  const recordDiagnostic = options.recordDiagnostic || recordAutomaticPromotionDiagnostic;
  const senderValidation = validatePrivateSender(sender, options.runtimeId, options.sidePanelUrl);
  if (!senderValidation.valid) {
    const result = rejectedResult(identities, "sender_not_authorized", [senderValidation.reason]);
    recordNonAuthoritative(result, recordDiagnostic, options.diagnosticDependencies);
    sendResponse(result);
    return false;
  }

  const requestValidation = snapshotAndValidatePromotionRequest(message);
  if (!requestValidation.ok) {
    const result = rejectedResult(
      identities,
      "invalid_promotion_request",
      requestValidation.errors || [requestValidation.reason]
    );
    recordNonAuthoritative(result, recordDiagnostic, options.diagnosticDependencies);
    sendResponse(result);
    return false;
  }

  const request = requestValidation.value;
  const createAdapters = options.createAdapters || createAutomaticPromotionChromeAdapters;

  Promise.resolve().then(async () => {
    let result;
    try {
      const adapters = createAdapters(options.chromeApi, options.adapterDependencies);
      const candidate = options.coordinate
        ? await options.coordinate(request, adapters)
        : await coordinateAutomaticWorkspacePromotion(request, adapters);
      result = validatePromotionResult(candidate)
        ? candidate
        : failedResult(identities, "promotion_result_invalid", ["result_contract_violation"]);
    } catch {
      result = failedResult(identities, "unhandled_coordination_failure", ["unexpected_route_failure"]);
    }

    try { await recordDiagnostic(result, options.diagnosticDependencies); }
    catch { /* Diagnostics are non-authoritative and cannot change a transaction result. */ }
    sendResponse(result);
  });
  return true;
}

function recordNonAuthoritative(result, recordDiagnostic, dependencies) {
  Promise.resolve().then(() => recordDiagnostic(result, dependencies)).catch(() => undefined);
}

export function isAutomaticPromotionMessage(message) {
  try { return Reflect.get(message, "schema") === PROMOTION_REQUEST_SCHEMA; }
  catch { return false; }
}

export function validatePrivateSender(sender, runtimeId, sidePanelUrl) {
  try {
    return Reflect.get(sender, "id") === runtimeId && Reflect.get(sender, "url") === sidePanelUrl
      ? { valid: true, reason: "" }
      : { valid: false, reason: "sender_not_authorized" };
  } catch {
    return { valid: false, reason: "sender_not_authorized" };
  }
}

function rejectedResult(identities, reason, errors) {
  return createPromotionResult(identities, {
    status: "invalid",
    reason,
    decision: "reject_request",
    phase: "request_validation",
    errors
  });
}

function failedResult(identities, reason, errors) {
  return createPromotionResult(identities, {
    status: "failed",
    reason,
    decision: "retry_transaction",
    phase: "result_serialization",
    retrySafe: true,
    errors
  });
}
