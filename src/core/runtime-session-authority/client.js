import { CONTEXT_REGISTER_REQUEST_SCHEMA, CONTEXT_REGISTER_TYPE, validateContextRegisterResult } from "./contract.js";

export function createRuntimeSessionContextClient({ createId, now, getCurrentWindow, send }) {
  const contextId = createId();
  let pendingRequest, inFlight, latestVerifiedResult = null;
  function register() {
    if (inFlight) return inFlight;
    inFlight = execute().finally(() => { inFlight = undefined; });
    return inFlight;
  }
  async function execute() {
    if (!pendingRequest) {
      const currentWindow = await getCurrentWindow();
      if (!Number.isInteger(currentWindow?.id) || currentWindow.id < 0) throw new Error("Current side-panel window identity is invalid");
      pendingRequest = { type: CONTEXT_REGISTER_TYPE, schema: CONTEXT_REGISTER_REQUEST_SCHEMA, operationId: createId(), contextId, contextType: "side_panel", windowId: currentWindow.id, requestedAt: now() };
    }
    const result = await send(pendingRequest);
    const validation = validateContextRegisterResult(result, pendingRequest);
    if (!validation.valid) throw new Error("Runtime context registration response is invalid: " + validation.errors.join("; "));
    if (result.authorityVerified) latestVerifiedResult = result;
    return result;
  }
  return {
    get contextId() { return contextId; },
    get pendingRequest() { return pendingRequest ? structuredClone(pendingRequest) : null; },
    get latestVerifiedResult() { return latestVerifiedResult ? structuredClone(latestVerifiedResult) : null; },
    get verifiedContextEvidence() {
      return latestVerifiedResult?.authorityVerified === true && latestVerifiedResult.context
        ? structuredClone({
          runtimeSessionId: latestVerifiedResult.runtimeSessionId,
          authorityRevision: latestVerifiedResult.authorityRevision,
          contextId: latestVerifiedResult.context.contextId,
          windowId: latestVerifiedResult.context.windowId
        })
        : null;
    },
    register
  };
}

export function startRuntimeSessionContextRegistration(client, recordEvidence) {
  return client.register().then(
    (result) => { recordEvidence(result); return result; },
    (error) => { const evidence = { status: "failed", reason: String(error?.message || error) }; recordEvidence(evidence); return evidence; }
  );
}
