import { appendDiagnosticEvent } from "../diagnostic-event-store.js";
import {
  RUNTIME_WORKSPACE_ACTIVATION_REQUEST_SCHEMA,
  RUNTIME_WORKSPACE_ACTIVATION_TYPE,
  createActivationResult,
  normalizeActivationIdentities,
  snapshotAndValidateActivationRequest,
  snapshotSerializable,
  validateActivationResult
} from "./contract.js";
import { coordinateRuntimeWorkspaceActivation } from "./coordinator.js";
import { createRuntimeWorkspaceActivationChromeAdapters } from "./chrome-adapter.js";
import { createActivationRequestFingerprint } from "./fingerprint.js";

export function handleRuntimeWorkspaceActivationMessage(message, sender, sendResponse, options = {}) {
  if (!isRuntimeWorkspaceActivationMessage(message)) return false;
  const validation = snapshotAndValidateActivationRequest(message);
  const identities = normalizeActivationIdentities(validation.value || {});
  if (!authorized(sender, options.runtimeId, options.sidePanelUrl)) {
    sendResponse(createActivationResult(identities, { status: "invalid", reason: "sender_not_authorized", decision: "reject_request", phase: "request_validation", errors: ["sender_not_authorized"] }));
    return false;
  }
  if (!validation.ok) {
    sendResponse(createActivationResult(identities, { status: "invalid", reason: "invalid_activation_request", decision: "reject_request", phase: "request_validation", errors: validation.errors || [validation.reason] }));
    return false;
  }
  const request = validation.value;
  Promise.resolve().then(async () => {
    let result;
    try {
      const createAdapters = options.createAdapters || createRuntimeWorkspaceActivationChromeAdapters;
      const adapters = createAdapters(options.chromeApi, options.adapterDependencies);
      const candidate = options.coordinate ? await options.coordinate(request, adapters) : await coordinateRuntimeWorkspaceActivation(request, adapters);
      const candidateSnapshot = snapshotSerializable(candidate);
      result = candidateSnapshot.ok && validateActivationResult(candidateSnapshot.value, request) && candidateSnapshot.value.requestFingerprint === createActivationRequestFingerprint(request) ? candidateSnapshot.value : createActivationResult(identities, { status: "failed", reason: "activation_result_invalid", decision: "retry_activation", phase: "result_serialization", retrySafe: true, errors: ["result_contract_violation"] });
    } catch {
      result = createActivationResult(identities, { status: "failed", reason: "unhandled_coordination_failure", decision: "retry_activation", phase: "result_serialization", retrySafe: true, errors: ["unexpected_route_failure"] });
    }
    try { await (options.recordDiagnostic || recordRuntimeWorkspaceActivationDiagnostic)(result, options.diagnosticDependencies); } catch { /* Diagnostics cannot change authority outcomes. */ }
    sendResponse(result);
  });
  return true;
}

export function isRuntimeWorkspaceActivationMessage(message) {
  try { return Reflect.get(message, "type") === RUNTIME_WORKSPACE_ACTIVATION_TYPE || Reflect.get(message, "schema") === RUNTIME_WORKSPACE_ACTIVATION_REQUEST_SCHEMA; }
  catch { return false; }
}

export async function recordRuntimeWorkspaceActivationDiagnostic(result, dependencies = {}) {
  if (result?.replayed) return { recorded: false, reason: "replay_not_duplicated" };
  const append = dependencies.appendDiagnostic || appendDiagnosticEvent;
  const details = {};
  for (const field of ["operationId", "operation", "sourceContextId", "sourceWindowId", "targetWindowId", "expectedWorkspaceId", "expectedWorkspaceRevision", "activeWorkspaceId", "activeWorkspaceRevision", "status", "reason", "phase", "workspaceWritten", "workspaceVerified", "assignmentWritten", "assignmentVerified", "runtimeSessionId", "authorityRevisionBefore", "authorityRevisionAfter", "currentRuntimeAssignmentId", "currentAssignmentEpoch", "readOnly", "retrySafe", "indeterminate", "warnings", "errors"]) details[field] = result?.[field] ?? null;
  await append(["committed", "no_change"].includes(result?.status) ? "info" : result?.status === "conflict" ? "warn" : "error", "runtime_workspace_activation_completed", "Runtime workspace activation route completed.", details);
  return { recorded: true, reason: "" };
}

function authorized(sender, runtimeId, sidePanelUrl) {
  try { return Reflect.get(sender, "id") === runtimeId && Reflect.get(sender, "url") === sidePanelUrl; }
  catch { return false; }
}
