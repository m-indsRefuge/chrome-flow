import { appendDiagnosticEvent } from "../diagnostic-event-store.js";
import {
  MANUAL_PLACEMENT_REQUEST_SCHEMA,
  MANUAL_PLACEMENT_TYPE,
  createManualPlacementResult,
  normalizeManualPlacementIdentities,
  snapshotAndValidateManualPlacementRequest,
  snapshotSerializable,
  validateManualPlacementResult
} from "./contract.js";
import { coordinateWorkspaceManualPlacement } from "./coordinator.js";
import { createWorkspaceManualPlacementChromeAdapters } from "./chrome-adapter.js";
import { createManualPlacementFingerprint } from "./fingerprint.js";

export function handleWorkspaceManualPlacementMessage(message, sender, sendResponse, options = {}) {
  if (!isWorkspaceManualPlacementMessage(message)) return false;
  const validation = snapshotAndValidateManualPlacementRequest(message);
  const identities = normalizeManualPlacementIdentities(validation.value || {});
  if (!authorized(sender, options.runtimeId, options.sidePanelUrl)) {
    sendResponse(createManualPlacementResult(identities, { status: "invalid", reason: "sender_not_authorized", decision: "reject_request", phase: "request_validation", errors: ["sender_not_authorized"] }));
    return false;
  }
  if (!validation.ok) {
    sendResponse(createManualPlacementResult(identities, { status: "invalid", reason: "invalid_manual_placement_request", decision: "reject_request", phase: "request_validation", errors: validation.errors || [validation.reason] }));
    return false;
  }
  const request = validation.value;
  Promise.resolve().then(async () => {
    let result;
    try {
      const adapters = (options.createAdapters || createWorkspaceManualPlacementChromeAdapters)(options.chromeApi, options.adapterDependencies);
      const candidate = options.coordinate ? await options.coordinate(request, adapters) : await coordinateWorkspaceManualPlacement(request, adapters);
      const candidateSnapshot = snapshotSerializable(candidate);
      result = candidateSnapshot.ok && validateManualPlacementResult(candidateSnapshot.value, request) && candidateSnapshot.value.requestFingerprint === createManualPlacementFingerprint(request) ? candidateSnapshot.value : createManualPlacementResult(identities, { status: "failed", reason: "manual_placement_result_invalid", decision: "retry_transaction", phase: "result_serialization", retrySafe: true });
    } catch {
      result = createManualPlacementResult(identities, { status: "failed", reason: "unhandled_coordination_failure", decision: "retry_transaction", phase: "result_serialization", retrySafe: true });
    }
    try { await (options.recordDiagnostic || recordWorkspaceManualPlacementDiagnostic)(result, options.diagnosticDependencies); } catch { /* Non-authoritative. */ }
    sendResponse(result);
  });
  return true;
}

export function isWorkspaceManualPlacementMessage(message) {
  try { return Reflect.get(message, "type") === MANUAL_PLACEMENT_TYPE || Reflect.get(message, "schema") === MANUAL_PLACEMENT_REQUEST_SCHEMA; }
  catch { return false; }
}

export async function recordWorkspaceManualPlacementDiagnostic(result, dependencies = {}) {
  if (result?.replayed) return { recorded: false, reason: "replay_not_duplicated" };
  const append = dependencies.appendDiagnostic || appendDiagnosticEvent;
  await append(result?.status === "committed" ? "info" : result?.status === "conflict" ? "warn" : "error", "workspace_manual_placement_completed", "Manual dedicated-window placement transaction completed.", result);
  return { recorded: true, reason: "" };
}

function authorized(sender, runtimeId, url) { try { return sender?.id === runtimeId && sender?.url === url; } catch { return false; } }
