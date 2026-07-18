import { readCompatibleStorageValue, writeCompatibleStorageValue } from "../constellation-storage-compatibility.js";
import { appendDiagnosticEvent } from "../diagnostic-event-store.js";
import { OPERATION_LEDGER_KEY } from "../journal-append-coordination/chrome-adapter.js";
import { validateOperationLedger } from "../journal-append-coordination/ledger-validation.js";
import { LOCK_NAMES } from "../runtime-contract/constants.js";
import { createOperationLedger } from "../runtime-contract/ledger.js";
import { resolveAssignmentByWindow } from "../runtime-contract/assignments.js";
import {
  RUNTIME_SESSION_AUTHORITY_KEY,
  validateActiveContext,
  validateSessionAuthority
} from "../runtime-session-authority/contract.js";

export function createWorkspaceMembershipChromeAdapters(chromeApi, input = {}) {
  const dependencies = createDependencies(chromeApi, input);
  let runtimeStateLockDepth = 0;
  return {
    async withRuntimeStateLock(name, callback) {
      if (name !== LOCK_NAMES.runtimeState || typeof callback !== "function") throw new TypeError("runtime-state lock request is invalid");
      return dependencies.requestLock(name, async () => {
        if (runtimeStateLockDepth !== 0) throw new Error("runtime-state lock re-entry is not allowed");
        runtimeStateLockDepth += 1;
        try { return await callback(); }
        finally { runtimeStateLockDepth -= 1; }
      });
    },
    readCompatibleWorkspace() { return dependencies.readCompatibleWorkspace(); },
    async writeCompatibleWorkspace(workspace) {
      if (runtimeStateLockDepth !== 1) throw new Error("runtime-state lock is not held");
      return dependencies.writeCompatibleWorkspace(workspace);
    },
    async readOperationLedger() {
      try {
        const result = await dependencies.readLedger();
        const ledger = result.present ? result.value : createOperationLedger();
        const validation = validateOperationLedger(ledger);
        return validation.valid
          ? { status: "present", ledger, error: "" }
          : { status: "failed", ledger: null, error: "operation_ledger_malformed" };
      } catch {
        return { status: "failed", ledger: null, error: "operation_ledger_read_failed" };
      }
    },
    async writeOperationLedger(ledger) {
      if (runtimeStateLockDepth !== 1) return { status: "failed", error: "runtime_state_lock_not_held" };
      const validation = validateOperationLedger(ledger);
      if (!validation.valid) return { status: "failed", error: "operation_ledger_malformed" };
      try {
        await dependencies.writeLedger(ledger);
        return { status: "written", error: "" };
      } catch {
        return { status: "failed", error: "operation_ledger_write_failed" };
      }
    },
    async readRuntimeAuthority({ workspaceId, sourceContextId, sourceWindowId }) {
      try {
        const root = await dependencies.readAuthority();
        const validation = validateSessionAuthority(root);
        if (!validation.valid) return { status: "failed", contextVerified: false, error: "runtime_authority_malformed" };
        const context = validateActiveContext(root, sourceContextId, sourceWindowId);
        const browserWindow = await dependencies.getWindow(sourceWindowId);
        const assignment = resolveAssignmentByWindow(root.assignmentRegistry, sourceWindowId);
        return {
          status: "present",
          contextVerified: context.valid === true &&
            browserWindow?.id === sourceWindowId &&
            assignment?.workspaceId === workspaceId &&
            assignment.windowId === sourceWindowId &&
            assignment.state === "active",
          error: ""
        };
      } catch {
        return { status: "failed", contextVerified: false, error: "runtime_authority_read_failed" };
      }
    },
    async readBrowserProjection() {
      if (runtimeStateLockDepth !== 1) return { status: "failed", tabIds: [], error: "runtime_state_lock_not_held" };
      try {
        const tabs = await dependencies.queryTabs();
        if (!Array.isArray(tabs) || tabs.some((tab) => !Number.isSafeInteger(tab?.id) || tab.id < 0)) {
          return { status: "failed", tabIds: [], error: "browser_projection_malformed" };
        }
        const tabIds = [...new Set(tabs.map((tab) => tab.id))].sort((left, right) => left - right);
        if (tabIds.length !== tabs.length) return { status: "failed", tabIds: [], error: "browser_projection_malformed" };
        return { status: "present", tabIds, error: "" };
      } catch {
        return { status: "failed", tabIds: [], error: "browser_projection_read_failed" };
      }
    }
  };
}

export async function recordWorkspaceMembershipDiagnostic(result, input = {}) {
  if (result?.replayed === true) return { recorded: false, reason: "replay_not_duplicated" };
  const appendDiagnostic = input.appendDiagnostic || appendDiagnosticEvent;
  const details = {};
  for (const field of [
    "operationId", "mutationKind", "workspaceId", "sourceContextId", "sourceWindowId",
    "status", "reason", "expectedWorkspaceRevision", "workspaceRevisionBefore",
    "workspaceRevisionAfter", "membershipWritten", "membershipVerified",
    "compatiblePeersVerified", "retrySafe", "indeterminate", "warnings", "errors"
  ]) details[field] = result?.[field] ?? null;
  await appendDiagnostic(
    ["committed", "replayed", "no_change"].includes(result?.status) ? "info" : result?.status === "conflict" ? "warn" : "error",
    "workspace_membership_mutation_completed",
    "Workspace membership mutation route completed.",
    details
  );
  return { recorded: true, reason: "" };
}

function createDependencies(chromeApi, input) {
  return {
    requestLock: input.requestLock || ((name, callback) => {
      if (!globalThis.navigator?.locks?.request) throw new Error("Web Locks unavailable");
      return globalThis.navigator.locks.request(name, callback);
    }),
    readCompatibleWorkspace: input.readCompatibleWorkspace || (() => readCompatibleStorageValue("activeWorkspace")),
    writeCompatibleWorkspace: input.writeCompatibleWorkspace || ((workspace) => writeCompatibleStorageValue("activeWorkspace", workspace)),
    readLedger: input.readLedger || (async () => {
      const result = await chromeApi.storage.session.get(OPERATION_LEDGER_KEY);
      return Object.hasOwn(result, OPERATION_LEDGER_KEY)
        ? { present: true, value: result[OPERATION_LEDGER_KEY] }
        : { present: false, value: undefined };
    }),
    writeLedger: input.writeLedger || ((ledger) => chromeApi.storage.session.set({ [OPERATION_LEDGER_KEY]: ledger })),
    readAuthority: input.readAuthority || (async () => {
      const result = await chromeApi.storage.session.get(RUNTIME_SESSION_AUTHORITY_KEY);
      return Object.hasOwn(result, RUNTIME_SESSION_AUTHORITY_KEY) ? result[RUNTIME_SESSION_AUTHORITY_KEY] : undefined;
    }),
    getWindow: input.getWindow || ((windowId) => chromeApi.windows.get(windowId)),
    queryTabs: input.queryTabs || (() => chromeApi.tabs.query({}))
  };
}
