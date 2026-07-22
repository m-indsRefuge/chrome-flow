import { validateContextRegisterResult } from "../runtime-session-authority/contract.js";
import {
  WINDOW_BINDING_RESOLVE_COMMAND_SCHEMA,
  WINDOW_BINDING_RESOLVE_TYPE,
  snapshotAndValidateWindowBindingResolveCommand,
  validateWindowBindingResolveResult
} from "./contract.js";

export function createRuntimeWindowBindingClient({ contextClient, createId, now, send }) {
  let inFlight = null;
  let pendingRequest = null;
  let latestResult = null;

  function resolve() {
    if (inFlight) return inFlight;
    inFlight = execute().finally(() => { inFlight = null; });
    return inFlight;
  }

  async function execute() {
    const context = await contextClient.register();
    const contextValidation = validateContextRegisterResult(context, contextClient.pendingRequest || {
      operationId: context?.operationId,
      contextId: context?.contextId,
      windowId: context?.windowId
    });
    if (!contextValidation.valid || context.authorityVerified !== true || !context.context) throw new Error("Runtime context registration is not verified");
    const evidenceChanged = pendingRequest && (
      pendingRequest.runtimeSessionId !== context.runtimeSessionId ||
      pendingRequest.sourceContextId !== context.context.contextId ||
      pendingRequest.sourceWindowId !== context.context.windowId
    );
    if (!pendingRequest || evidenceChanged) pendingRequest = {
      type: WINDOW_BINDING_RESOLVE_TYPE,
      schema: WINDOW_BINDING_RESOLVE_COMMAND_SCHEMA,
      operationId: createId(),
      runtimeSessionId: context.runtimeSessionId,
      sourceContextId: context.context.contextId,
      sourceWindowId: context.context.windowId,
      requestedAt: now()
    };
    const commandValidation = snapshotAndValidateWindowBindingResolveCommand(pendingRequest);
    if (!commandValidation.valid) throw new Error("Window binding resolve command is invalid: " + commandValidation.errors.join("; "));
    const response = await send(commandValidation.command);
    const responseValidation = validateWindowBindingResolveResult(response, commandValidation.command);
    if (!responseValidation.valid) throw new Error("Window binding resolve response is invalid: " + responseValidation.errors.join("; "));
    latestResult = responseValidation.result;
    pendingRequest = null;
    return structuredClone(latestResult);
  }

  return {
    resolve,
    get pendingRequest() { return pendingRequest ? structuredClone(pendingRequest) : null; },
    get latestResult() { return latestResult ? structuredClone(latestResult) : null; }
  };
}
