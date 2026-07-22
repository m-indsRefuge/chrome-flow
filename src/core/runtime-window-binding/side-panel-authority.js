import { createRuntimeSessionContextClient } from "../runtime-session-authority/client.js";
import { createRuntimeWindowBindingClient } from "./client.js";

export const SIDE_PANEL_ASSIGNED_WORKSPACE_AUTHORITY_SCHEMA = "constellation-side-panel-assigned-workspace-authority-v0.1";

let contextClientSingleton = null;
let authoritySingleton = null;

export function getSidePanelRuntimeSessionContextClient() {
  if (contextClientSingleton) return contextClientSingleton;
  contextClientSingleton = createRuntimeSessionContextClient({
    createId: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
    getCurrentWindow: () => chrome.windows.getCurrent(),
    send: (request) => chrome.runtime.sendMessage(request)
  });
  return contextClientSingleton;
}

export function getSidePanelAssignedWorkspaceAuthority() {
  if (authoritySingleton) return authoritySingleton;
  authoritySingleton = createSidePanelAssignedWorkspaceAuthority({
    bindingClient: createRuntimeWindowBindingClient({
      contextClient: getSidePanelRuntimeSessionContextClient(),
      createId: () => crypto.randomUUID(),
      now: () => new Date().toISOString(),
      send: (request) => chrome.runtime.sendMessage(request)
    })
  });
  return authoritySingleton;
}

export function createSidePanelAssignedWorkspaceAuthority({ bindingClient }) {
  let latestState = frozenState("idle", "", null, null);
  let inFlight = null;
  const listeners = new Set();

  function resolve() {
    if (inFlight) return inFlight;
    inFlight = execute().finally(() => { inFlight = null; });
    return inFlight;
  }

  async function execute() {
    let result;
    try { result = await bindingClient.resolve(); }
    catch (error) { return update("failed", "binding_client_failed", null, null, [String(error?.message || error)]); }
    if (result.status !== "assigned") return update(result.status, result.reason, result, null);
    const authority = deepFreeze({
      schema: SIDE_PANEL_ASSIGNED_WORKSPACE_AUTHORITY_SCHEMA,
      runtimeSessionId: result.runtimeSessionId,
      sourceContextId: result.sourceContextId,
      sourceWindowId: result.sourceWindowId,
      workspaceId: result.workspaceId,
      workspaceRevision: result.workspaceRevision,
      runtimeAssignmentId: result.runtimeAssignmentId,
      assignmentEpoch: result.assignmentEpoch,
      authorityRevision: result.authorityRevision,
      lifecycleState: result.lifecycleState,
      workspace: structuredClone(result.workspace)
    });
    return update("assigned", "", result, authority);
  }

  function update(status, reason, result, authority, errors = []) {
    latestState = frozenState(status, reason, result, authority, errors);
    for (const listener of listeners) {
      try { listener(structuredClone(latestState)); } catch { /* UI observation cannot change authority. */ }
    }
    return structuredClone(latestState);
  }

  return {
    resolve,
    get latestState() { return structuredClone(latestState); },
    get assignedAuthority() { return latestState.authority || null; },
    subscribe(listener) { if (typeof listener !== "function") throw new TypeError("binding authority listener is required"); listeners.add(listener); return () => listeners.delete(listener); },
    destroy() { listeners.clear(); latestState = frozenState("destroyed", "panel_destroyed", null, null); }
  };
}

function frozenState(status, reason, result, authority, errors = []) {
  return deepFreeze({ status, reason: typeof reason === "string" ? reason : "", result: result ? structuredClone(result) : null, authority: authority ? structuredClone(authority) : null, errors: [...errors] });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
