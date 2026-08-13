import { runWithScopedLocks } from "../runtime-scoped-locks/chrome-adapter.js";
import { RUNTIME_SESSION_AUTHORITY_KEY } from "../runtime-session-authority/contract.js";
import { deriveRuntimeWorkspaceKey } from "../runtime-workspace-record/contract.js";
import { deriveWorkspaceOperationLedgerKey } from "../runtime-workspace-operation-ledger/contract.js";

export function createRuntimeWorkspaceMutationChromeAdapters(chromeApi, options = {}) {
  const requestLock = typeof options.requestLock === "function"
    ? options.requestLock
    : globalThis.navigator?.locks?.request?.bind(globalThis.navigator.locks);
  const now = typeof options.now === "function"
    ? options.now
    : () => new Date().toISOString();

  return {
    withScopedLocks(plan, callback) {
      return runWithScopedLocks(plan, callback, { requestLock });
    },
    async readAuthority() {
      const values = await chromeApi.storage.session.get(
        RUNTIME_SESSION_AUTHORITY_KEY
      );
      return Object.hasOwn(values || {}, RUNTIME_SESSION_AUTHORITY_KEY)
        ? values[RUNTIME_SESSION_AUTHORITY_KEY]
        : undefined;
    },
    async readRuntimeWorkspaceRecord(workspaceId) {
      const key = deriveRuntimeWorkspaceKey(workspaceId);
      const values = await chromeApi.storage.local.get(key);
      return Object.hasOwn(values || {}, key) ? values[key] : undefined;
    },
    writeRuntimeWorkspaceRecord(workspaceId, record) {
      const key = deriveRuntimeWorkspaceKey(workspaceId);
      return chromeApi.storage.local.set({ [key]: record });
    },
    async readWorkspaceOperationLedger(workspaceId) {
      const key = deriveWorkspaceOperationLedgerKey(workspaceId);
      const values = await chromeApi.storage.local.get(key);
      return Object.hasOwn(values || {}, key) ? values[key] : undefined;
    },
    writeWorkspaceOperationLedger(workspaceId, ledger) {
      const key = deriveWorkspaceOperationLedgerKey(workspaceId);
      return chromeApi.storage.local.set({ [key]: ledger });
    },
    now
  };
}
