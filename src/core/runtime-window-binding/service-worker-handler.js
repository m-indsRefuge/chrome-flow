import { validateSidePanelSender } from "../runtime-session-authority/contract.js";
import { createRuntimeWindowBindingChromeAdapters } from "./chrome-adapter.js";
import {
  createWindowBindingResolveResult,
  isRuntimeWindowBindingResolveMessage,
  snapshotAndValidateWindowBindingResolveCommand
} from "./contract.js";
import { coordinateRuntimeWindowBindingResolve } from "./coordinator.js";

export { isRuntimeWindowBindingResolveMessage };

export function handleRuntimeWindowBindingMessage(message, sender, sendResponse, options) {
  const requestValidation = snapshotAndValidateWindowBindingResolveCommand(message);
  const senderValidation = validateSidePanelSender(sender, options.runtimeId, options.sidePanelUrl);
  if (!senderValidation.valid || !requestValidation.valid) {
    sendResponse(createWindowBindingResolveResult(message, { status: "failed", reason: senderValidation.valid ? "invalid_request" : senderValidation.reason, phase: "route_validation", errors: requestValidation.errors }));
    return false;
  }
  let adapters;
  try { adapters = (options.createAdapters || createRuntimeWindowBindingChromeAdapters)(options.chromeApi); }
  catch (error) {
    sendResponse(createWindowBindingResolveResult(requestValidation.command, { status: "failed", reason: "adapter_creation_failed", phase: "route_setup", retrySafe: true, errors: [String(error?.message || error)] }));
    return false;
  }
  Promise.resolve(coordinateRuntimeWindowBindingResolve(requestValidation.command, adapters)).then(
    sendResponse,
    (error) => sendResponse(createWindowBindingResolveResult(requestValidation.command, { status: "failed", reason: "unhandled_coordination_failure", phase: "coordination", retrySafe: true, errors: [String(error?.message || error)] }))
  );
  return true;
}
