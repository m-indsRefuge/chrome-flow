import { readCompatibleStorageValue, writeCompatibleStorageValue } from "../constellation-storage-compatibility.js";
import { appendRuntimeDiagnostic } from "../workspace-runtime-store.js";

export function createChromeReconciliationAdapters(chromeApi) {
  return {
    withRuntimeStateLock(name,callback){if(!globalThis.navigator?.locks?.request)throw new Error("Web Locks unavailable");return globalThis.navigator.locks.request(name,callback);},
    readLatestActiveWorkspace(){return readCompatibleStorageValue("activeWorkspace");},
    writeCompatibleActiveWorkspace(workspace){return writeCompatibleStorageValue("activeWorkspace",workspace);},
    queryTabs(){return chromeApi.tabs.query({});},
    createId(){return crypto.randomUUID();},
    now(){return new Date().toISOString();},
    appendDiagnostic(diagnostic){return appendRuntimeDiagnostic(diagnostic.level,diagnostic.action,diagnostic.message,diagnostic.details);},
    sendNotification(summary){return chromeApi.runtime.sendMessage({type:"chrome-flow-workspace-projection-reconciled",summary});}
  };
}
