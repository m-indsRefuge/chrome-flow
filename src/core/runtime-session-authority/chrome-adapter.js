import { appendDiagnosticEvent } from "../diagnostic-event-store.js";
import { deriveWindowLock, deriveWorkspaceBindingLock } from "../runtime-scoped-locks/contract.js";
import { RUNTIME_SESSION_AUTHORITY_KEY } from "./contract.js";

export function createChromeRuntimeSessionAuthorityAdapters(chromeApi) {
  return {
    async readAuthority() {
      const values = await chromeApi.storage.session.get(RUNTIME_SESSION_AUTHORITY_KEY);
      return Object.hasOwn(values, RUNTIME_SESSION_AUTHORITY_KEY) ? values[RUNTIME_SESSION_AUTHORITY_KEY] : undefined;
    },
    writeAuthority(authority) { return chromeApi.storage.session.set({ [RUNTIME_SESSION_AUTHORITY_KEY]: authority }); },
    getWindow(windowId) { return chromeApi.windows.get(windowId); },
    createId: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
    withRuntimeStateLock(name, callback) { if (!globalThis.navigator?.locks?.request) throw new Error("Web Locks unavailable"); return globalThis.navigator.locks.request(name, callback); },
    withExclusiveOperationLock(name, callback) { if (!globalThis.navigator?.locks?.request) throw new Error("Web Locks unavailable"); return globalThis.navigator.locks.request(name, callback); },
    withWindowLock(windowId, callback) { if (!globalThis.navigator?.locks?.request) throw new Error("Web Locks unavailable"); return globalThis.navigator.locks.request(deriveWindowLock(windowId), callback); },
    withWorkspaceBindingLock(workspaceId, callback) { if (!globalThis.navigator?.locks?.request) throw new Error("Web Locks unavailable"); return globalThis.navigator.locks.request(deriveWorkspaceBindingLock(workspaceId), callback); },
    recordDiagnostic(action, result) { return appendDiagnosticEvent(result.status === "failed" ? "error" : "info", action, "Runtime session authority operation completed.", { operationId: result.operationId || "", windowId: result.windowId ?? null, status: result.status, reason: result.reason || "", authorityRevision: result.authorityRevision ?? null, authorityCommitted: result.authorityCommitted === true, authorityVerified: result.authorityVerified === true }); }
  };
}
