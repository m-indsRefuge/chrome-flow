import { deriveWindowLock, deriveWorkspaceBindingLock } from "../runtime-scoped-locks/contract.js";
import { RUNTIME_SESSION_AUTHORITY_KEY } from "../runtime-session-authority/contract.js";
import { deriveRuntimeWorkspaceKey } from "../runtime-workspace-record/contract.js";

export function createRuntimeWindowBindingChromeAdapters(chromeApi, options = {}) {
  const requestLock = typeof options.requestLock === "function"
    ? options.requestLock
    : globalThis.navigator?.locks?.request?.bind(globalThis.navigator.locks);
  if (!requestLock) throw new Error("Web Locks unavailable");
  return {
    async readAuthority() {
      const values = await chromeApi.storage.session.get(RUNTIME_SESSION_AUTHORITY_KEY);
      return Object.hasOwn(values || {}, RUNTIME_SESSION_AUTHORITY_KEY) ? values[RUNTIME_SESSION_AUTHORITY_KEY] : undefined;
    },
    async readRuntimeWorkspaceRecord(workspaceId) {
      const key = deriveRuntimeWorkspaceKey(workspaceId);
      const values = await chromeApi.storage.local.get(key);
      return Object.hasOwn(values || {}, key) ? values[key] : undefined;
    },
    deriveRuntimeWorkspaceKey,
    withWindowLock(windowId, callback) { return requestLock(deriveWindowLock(windowId), callback); },
    withWorkspaceBindingLock(workspaceId, callback) { return requestLock(deriveWorkspaceBindingLock(workspaceId), callback); }
  };
}
