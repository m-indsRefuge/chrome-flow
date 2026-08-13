import { readCompatibleStorageValue, stableStringify, writeCompatibleStorageValue } from "../constellation-storage-compatibility.js";
import { createOperationLedger } from "../runtime-contract/ledger.js";
import { createRuntimeWorkspaceMutationChromeAdapters } from "../runtime-workspace-mutation/chrome-adapter.js";
import { verifyCompatibleWorkspaceRead } from "./readonly-workspace.js";
export const OPERATION_LEDGER_KEY = "constellationRecentOperationLedger";
export function createChromeJournalAdapters(chromeApi) { return {
  withRuntimeStateLock(name, callback) { if (!globalThis.navigator?.locks?.request) throw new Error("Web Locks unavailable"); return globalThis.navigator.locks.request(name, callback); },
  readLatestActiveWorkspace() { return readCompatibleStorageValue("activeWorkspace"); },
  writeCompatibleActiveWorkspace(workspace) { return writeCompatibleStorageValue("activeWorkspace", workspace); },
  async verifyCompatibleActiveWorkspace(expected, entry) { return verifyCompatibleWorkspaceRead(await readCompatibleStorageValue("activeWorkspace"),expected,entry); },
  async readOperationLedger() { const result=await chromeApi.storage.session.get(OPERATION_LEDGER_KEY); return Object.hasOwn(result,OPERATION_LEDGER_KEY)?result[OPERATION_LEDGER_KEY]:createOperationLedger(); },
  writeOperationLedger(ledger) { return chromeApi.storage.session.set({ [OPERATION_LEDGER_KEY]: ledger }); }, now() { return new Date().toISOString(); }
}; }

export function createChromeAssignedJournalAdapters(chromeApi) {
  return createRuntimeWorkspaceMutationChromeAdapters(chromeApi);
}
