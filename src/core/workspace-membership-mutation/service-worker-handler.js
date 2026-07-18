import { coordinateWorkspaceMembershipMutation } from "./coordinator.js";
import {
  MEMBERSHIP_REQUEST_SCHEMA,
  createMembershipResult,
  snapshotAndValidateMembershipRequest,
  validateMembershipResult
} from "./contract.js";
import {
  createWorkspaceMembershipChromeAdapters,
  recordWorkspaceMembershipDiagnostic
} from "./chrome-adapter.js";

export function handleWorkspaceMembershipMessage(message, sender, sendResponse, options = {}) {
  const classification = options.membershipClassification || classifyWorkspaceMembershipMessage(message);
  if (!classification.isMembership) return false;
  const requestValidation = classification.requestValidation;

  const identities = requestValidation.identities;
  const recordDiagnostic = options.recordDiagnostic || recordWorkspaceMembershipDiagnostic;
  const senderValidation = validatePrivateSender(sender, options.runtimeId, options.sidePanelUrl);
  if (!senderValidation.valid) {
    const result = createMembershipResult(identities, { status: "invalid", reason: "sender_not_authorized", errors: [senderValidation.reason] });
    recordNonAuthoritative(result, recordDiagnostic, options.diagnosticDependencies);
    sendResponse(result);
    return false;
  }
  if (!requestValidation.ok) {
    const result = createMembershipResult(identities, { status: "invalid", reason: "invalid_membership_request", errors: requestValidation.errors || [requestValidation.reason] });
    recordNonAuthoritative(result, recordDiagnostic, options.diagnosticDependencies);
    sendResponse(result);
    return false;
  }

  const request = requestValidation.value;
  const createAdapters = options.createAdapters || createWorkspaceMembershipChromeAdapters;
  Promise.resolve().then(async () => {
    let result;
    try {
      const adapters = createAdapters(options.chromeApi, options.adapterDependencies);
      const candidate = options.coordinate
        ? await options.coordinate(request, adapters)
        : await coordinateWorkspaceMembershipMutation(request, adapters);
      const validation = validateMembershipResult(candidate, request);
      result = validation.valid
        ? candidate
        : createMembershipResult(identities, { status: "failed", reason: "membership_result_invalid", retrySafe: true, errors: validation.errors });
    } catch {
      result = createMembershipResult(identities, { status: "failed", reason: "unhandled_coordination_failure", retrySafe: true, errors: ["unexpected_route_failure"] });
    }
    try { await recordDiagnostic(result, options.diagnosticDependencies); }
    catch { /* Diagnostics cannot change membership authority. */ }
    sendResponse(result);
  });
  return true;
}

export function isWorkspaceMembershipMessage(message) {
  return classifyWorkspaceMembershipMessage(message).isMembership;
}

export function classifyWorkspaceMembershipMessage(message) {
  const schema = readMembershipSchema(message);
  if (schema !== MEMBERSHIP_REQUEST_SCHEMA) {
    return { isMembership: false, requestValidation: { ok: false, reason: "membership_schema_not_recognized", identities: {} } };
  }
  const requestValidation = snapshotAndValidateMembershipRequest(message);
  return { isMembership: true, requestValidation };
}

function readMembershipSchema(message) {
  if (message === null || (typeof message !== "object" && typeof message !== "function")) return null;
  try { return Reflect.get(message, "schema"); }
  catch { return null; }
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

function recordNonAuthoritative(result, recordDiagnostic, dependencies) {
  Promise.resolve().then(() => recordDiagnostic(result, dependencies)).catch(() => undefined);
}
