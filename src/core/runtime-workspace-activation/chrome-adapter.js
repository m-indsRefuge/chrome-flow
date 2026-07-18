import { readCompatibleStorageValue, stableStringify, writeCompatibleStorageValue } from "../constellation-storage-compatibility.js";
import { OPERATION_LEDGER_KEY } from "../journal-append-coordination/chrome-adapter.js";
import { validateOperationLedger } from "../journal-append-coordination/ledger-validation.js";
import { validateAssignmentRegistry } from "../runtime-contract/assignments.js";
import { LOCK_NAMES } from "../runtime-contract/constants.js";
import { createOperationLedger } from "../runtime-contract/ledger.js";
import { normalizeWorkspaceRevision } from "../runtime-contract/revision.js";
import {
  RUNTIME_SESSION_AUTHORITY_KEY,
  rootsEqual,
  validateActiveContext,
  validateSessionAuthority
} from "../runtime-session-authority/contract.js";
import { snapshotSerializable } from "./contract.js";

export function createRuntimeWorkspaceActivationChromeAdapters(chromeApi, dependencyInput = {}) {
  const dependencies = createDependencies(chromeApi, dependencyInput);
  let exclusiveDepth = 0;
  let lastLedgerRead = null;

  return {
    async runExclusiveOperation(callback) {
      if (typeof callback !== "function") throw new TypeError("exclusive callback is required");
      return dependencies.requestLock(LOCK_NAMES.exclusiveOperation, async () => {
        if (exclusiveDepth !== 0) throw new Error("exclusive operation re-entry is not allowed");
        exclusiveDepth += 1;
        try { return await callback(); }
        finally { exclusiveDepth -= 1; }
      });
    },

    async readOperationLedger() {
      const read = await readLedger(dependencies);
      if (!read.valid) return { status: "failed", ledger: null, error: read.error };
      lastLedgerRead = read;
      return { status: "present", ledger: read.ledger, error: "" };
    },

    async writeOperationLedger(ledgerInput) {
      if (exclusiveDepth !== 1) return { status: "failed", error: "exclusive_operation_not_held" };
      const snapshot = snapshotSerializable(ledgerInput);
      if (!snapshot.ok || !validateOperationLedger(snapshot.value).valid || !lastLedgerRead) return { status: "failed", error: "operation_ledger_write_invalid" };
      return dependencies.requestLock(LOCK_NAMES.runtimeState, async () => {
        const current = await readLedger(dependencies);
        if (!current.valid) return { status: "failed", error: current.error };
        if (current.present !== lastLedgerRead.present || stableStringify(current.ledger) !== stableStringify(lastLedgerRead.ledger)) return { status: "conflict", error: "operation_ledger_changed" };
        let writeFailed = false;
        try { await dependencies.writeLedger(snapshot.value); } catch { writeFailed = true; }
        const verified = await readLedger(dependencies);
        if (verified.valid && stableStringify(verified.ledger) === stableStringify(snapshot.value)) {
          lastLedgerRead = verified;
          return { status: "written", error: "" };
        }
        return { status: "failed", error: writeFailed ? "operation_ledger_write_failed" : "operation_ledger_verification_failed" };
      });
    },

    async readCompatibleWorkspace() {
      try { return normalizeCompatibleWorkspaceRead(await dependencies.readCompatibleWorkspace()); }
      catch { return workspaceReadFailure("workspace_read_failed"); }
    },

    async writeCompatibleWorkspace(input) {
      if (exclusiveDepth !== 1) return workspaceWriteFailure(input, "exclusive_operation_not_held");
      const snapshot = snapshotSerializable(input);
      if (!snapshot.ok || !validWorkspaceWriteInput(snapshot.value)) return workspaceWriteFailure(input, "workspace_write_request_invalid");
      const request = snapshot.value;
      return dependencies.requestLock(LOCK_NAMES.runtimeState, async () => {
        let current;
        try { current = normalizeCompatibleWorkspaceRead(await dependencies.readCompatibleWorkspace()); }
        catch { return workspaceWriteFailure(request, "workspace_read_failed"); }
        if (current.status !== "present") return workspaceWriteFailure(request, current.status === "conflict" ? "workspace_compatibility_conflict" : "workspace_read_failed", current.status === "conflict" ? "conflict" : "failed");
        if (stableStringify(current.workspace) === stableStringify(request.workspace)) return workspaceWriteResult("written", request.workspace.workspaceId, workspaceRevision(request.workspace), "");
        if (current.workspace.workspaceId !== request.expectedWorkspaceId || current.revision !== request.expectedWorkspaceRevision) return workspaceWriteFailure(request, "workspace_expected_state_changed", "conflict");
        let writeFailed = false;
        try { await dependencies.writeCompatibleWorkspace(request.workspace); } catch { writeFailed = true; }
        let verified;
        try { verified = normalizeCompatibleWorkspaceRead(await dependencies.readCompatibleWorkspace()); }
        catch { return workspaceWriteFailure(request, "workspace_verification_read_failed"); }
        if (verified.status === "present" && stableStringify(verified.workspace) === stableStringify(request.workspace)) return workspaceWriteResult("written", verified.workspace.workspaceId, verified.revision, "");
        return workspaceWriteFailure(request, writeFailed ? "workspace_write_failed" : "workspace_verification_failed");
      });
    },

    async readRuntimeAuthority({ sourceContextId, sourceWindowId }) {
      try {
        const root = await dependencies.readAuthority();
        const snapshot = snapshotSerializable(root);
        if (!snapshot.ok || !validateSessionAuthority(snapshot.value).valid) return authorityReadFailure("runtime_authority_malformed");
        const window = await dependencies.getWindow(sourceWindowId);
        const context = validateActiveContext(snapshot.value, sourceContextId, sourceWindowId);
        return {
          status: "present",
          runtimeSessionId: snapshot.value.runtimeSessionId,
          authorityRevision: snapshot.value.authorityRevision,
          sourceContextVerified: context.valid === true && window?.id === sourceWindowId,
          assignmentRegistry: snapshot.value.assignmentRegistry,
          error: ""
        };
      } catch { return authorityReadFailure("runtime_authority_read_failed"); }
    },

    async writeRuntimeAuthority(input) {
      if (exclusiveDepth !== 1) return authorityWriteResult("failed", input?.expectedRuntimeSessionId, input?.expectedAuthorityRevision, "exclusive_operation_not_held");
      const snapshot = snapshotSerializable(input);
      if (!snapshot.ok || !validateAssignmentRegistry(snapshot.value?.nextAssignmentRegistry).valid) return authorityWriteResult("failed", input?.expectedRuntimeSessionId, input?.expectedAuthorityRevision, "runtime_authority_write_request_invalid");
      const request = snapshot.value;
      return dependencies.requestLock(LOCK_NAMES.runtimeState, async () => {
        let current;
        try { current = await dependencies.readAuthority(); } catch { return authorityWriteResult("failed", request.expectedRuntimeSessionId, request.expectedAuthorityRevision, "runtime_authority_read_failed"); }
        if (!validateSessionAuthority(current).valid) return authorityWriteResult("failed", request.expectedRuntimeSessionId, request.expectedAuthorityRevision, "runtime_authority_malformed");
        if (current.runtimeSessionId !== request.expectedRuntimeSessionId || current.authorityRevision !== request.expectedAuthorityRevision) return authorityWriteResult("conflict", current.runtimeSessionId, current.authorityRevision, "runtime_authority_changed");
        const next = { ...current, assignmentRegistry: request.nextAssignmentRegistry, authorityRevision: current.authorityRevision + 1 };
        if (!validateSessionAuthority(next).valid) return authorityWriteResult("failed", current.runtimeSessionId, current.authorityRevision, "runtime_authority_next_root_invalid");
        let writeFailed = false;
        try { await dependencies.writeAuthority(next); } catch { writeFailed = true; }
        let fresh;
        try { fresh = await dependencies.readAuthority(); } catch { return authorityWriteResult("failed", current.runtimeSessionId, current.authorityRevision, "runtime_authority_verification_read_failed"); }
        if (validateSessionAuthority(fresh).valid && rootsEqual(next, fresh)) return authorityWriteResult("written", next.runtimeSessionId, next.authorityRevision, "");
        return authorityWriteResult("failed", current.runtimeSessionId, current.authorityRevision, writeFailed ? "runtime_authority_write_failed" : "runtime_authority_verification_failed");
      });
    },

    async readBrowserEvidence({ workspace, sourceWindowId, targetWindowId }) {
      try {
        const [windows, sourceWindow] = await Promise.all([dependencies.getAllWindows(), dependencies.getWindow(sourceWindowId)]);
        if (!Array.isArray(windows) || sourceWindow?.id !== sourceWindowId) return browserFailure("source_window_not_verified");
        const windowIds = new Set();
        const tabIds = new Set();
        const liveTabs = [];
        for (const browserWindow of windows) {
          if (!safeId(browserWindow?.id) || windowIds.has(browserWindow.id) || !Array.isArray(browserWindow.tabs)) return browserFailure("browser_projection_malformed");
          windowIds.add(browserWindow.id);
          for (const tab of browserWindow.tabs) {
            if (!safeId(tab?.id) || !safeId(tab?.windowId) || tab.windowId !== browserWindow.id) return browserFailure("browser_projection_malformed");
            if (tabIds.has(tab.id)) return browserFailure("workspace_tab_identity_ambiguous");
            tabIds.add(tab.id);
            liveTabs.push(tab);
          }
        }
        if (!windowIds.has(sourceWindowId)) return browserFailure("source_window_not_verified");
        const targetWindowVerified = targetWindowId === null || windowIds.has(targetWindowId);
        const byId = new Map(liveTabs.map((tab) => [tab.id, tab]));
        const liveWorkspaceTabs = [];
        const representedIds = new Set();
        for (const workspaceTab of workspace.tabs) {
          if (!safeId(workspaceTab?.tabId)) continue;
          if (representedIds.has(workspaceTab.tabId)) return browserFailure("workspace_tab_identity_ambiguous");
          representedIds.add(workspaceTab.tabId);
          const live = byId.get(workspaceTab.tabId);
          if (!live) continue;
          const urlCorroborated = nonEmpty(workspaceTab.url) && (workspaceTab.url === live.url || workspaceTab.url === live.pendingUrl);
          const titleCorroborated = nonEmpty(workspaceTab.title) && workspaceTab.title === live.title;
          if (!urlCorroborated && !titleCorroborated) return browserFailure("workspace_tab_identity_ambiguous");
          if (!safeId(live.windowId)) return browserFailure("browser_projection_malformed");
          liveWorkspaceTabs.push(live);
        }
        const workspaceTabIds = [...new Set(liveWorkspaceTabs.map((tab) => tab.id))].sort(sortNumbers);
        const workspaceWindowIds = [...new Set(liveWorkspaceTabs.map((tab) => tab.windowId))].sort(sortNumbers);
        return { status: "present", sourceWindowVerified: true, targetWindowVerified, liveWorkspaceTabIds: workspaceTabIds, liveWorkspaceWindowIds: workspaceWindowIds, error: "" };
      } catch { return browserFailure("browser_evidence_read_failed"); }
    }
  };
}

function createDependencies(chromeApi, input) {
  return {
    requestLock: input.requestLock || ((name, callback) => {
      if (!globalThis.navigator?.locks?.request) throw new Error("Web Locks unavailable");
      return globalThis.navigator.locks.request(name, callback);
    }),
    readLedger: input.readLedger || (async () => { const value = await chromeApi.storage.session.get(OPERATION_LEDGER_KEY); return Object.hasOwn(value, OPERATION_LEDGER_KEY) ? { present: true, value: value[OPERATION_LEDGER_KEY] } : { present: false, value: undefined }; }),
    writeLedger: input.writeLedger || ((ledger) => chromeApi.storage.session.set({ [OPERATION_LEDGER_KEY]: ledger })),
    readCompatibleWorkspace: input.readCompatibleWorkspace || (() => readCompatibleStorageValue("activeWorkspace")),
    writeCompatibleWorkspace: input.writeCompatibleWorkspace || ((workspace) => writeCompatibleStorageValue("activeWorkspace", workspace)),
    readAuthority: input.readAuthority || (async () => { const value = await chromeApi.storage.session.get(RUNTIME_SESSION_AUTHORITY_KEY); return Object.hasOwn(value, RUNTIME_SESSION_AUTHORITY_KEY) ? value[RUNTIME_SESSION_AUTHORITY_KEY] : undefined; }),
    writeAuthority: input.writeAuthority || ((root) => chromeApi.storage.session.set({ [RUNTIME_SESSION_AUTHORITY_KEY]: root })),
    getWindow: input.getWindow || ((windowId) => chromeApi.windows.get(windowId)),
    getAllWindows: input.getAllWindows || (() => chromeApi.windows.getAll({ populate: true }))
  };
}

async function readLedger(dependencies) {
  let raw;
  try { raw = await dependencies.readLedger(); } catch { return { valid: false, error: "operation_ledger_read_failed" }; }
  if (!raw?.present) return { valid: true, present: false, ledger: createOperationLedger() };
  const snapshot = snapshotSerializable(raw.value);
  return snapshot.ok && validateOperationLedger(snapshot.value).valid ? { valid: true, present: true, ledger: snapshot.value } : { valid: false, error: "operation_ledger_malformed" };
}

function normalizeCompatibleWorkspaceRead(read) {
  if (!read?.canonicalPresent && !read?.legacyPresent) return { status: "absent", workspace: null, revision: null, error: "" };
  if (read?.conflict || !read?.canonicalPresent || !read?.legacyPresent || !read?.equivalent) return { status: "conflict", workspace: null, revision: null, error: "workspace_compatibility_conflict" };
  const snapshot = snapshotSerializable(read.value);
  const revision = snapshot.ok ? workspaceRevision(snapshot.value) : null;
  if (!snapshot.ok || !nonEmpty(snapshot.value?.workspaceId) || !Array.isArray(snapshot.value?.tabs) || revision === null) return workspaceReadFailure("workspace_state_malformed");
  return { status: "present", workspace: snapshot.value, revision, error: "" };
}

function validWorkspaceWriteInput(input) {
  return nonEmpty(input?.expectedWorkspaceId) && safeId(input?.expectedWorkspaceRevision) && nonEmpty(input?.workspace?.workspaceId) && Array.isArray(input?.workspace?.tabs) && workspaceRevision(input.workspace) !== null;
}
function workspaceRevision(workspace) { const value = normalizeWorkspaceRevision(workspace); return value.valid ? value.revision : null; }
function workspaceReadFailure(error) { return { status: "failed", workspace: null, revision: null, error }; }
function workspaceWriteFailure(input, error, status = "failed") { return workspaceWriteResult(status, nonEmpty(input?.workspace?.workspaceId) ? input.workspace.workspaceId : "", workspaceRevision(input?.workspace), error); }
function workspaceWriteResult(status, workspaceId, revision, error) { return { status, workspaceId: nonEmpty(workspaceId) ? workspaceId : "", workspaceRevision: Number.isInteger(revision) ? revision : null, error }; }
function authorityReadFailure(error) { return { status: "failed", runtimeSessionId: "", authorityRevision: null, sourceContextVerified: false, assignmentRegistry: null, error }; }
function authorityWriteResult(status, runtimeSessionId, authorityRevision, error) { return { status, runtimeSessionId: nonEmpty(runtimeSessionId) ? runtimeSessionId : "", authorityRevision: safeId(authorityRevision) ? authorityRevision : null, error }; }
function browserFailure(error) { return { status: "failed", sourceWindowVerified: false, targetWindowVerified: false, liveWorkspaceTabIds: [], liveWorkspaceWindowIds: [], error }; }
function safeId(value) { return Number.isSafeInteger(value) && value >= 0; }
function nonEmpty(value) { return typeof value === "string" && value.trim().length > 0; }
function sortNumbers(left, right) { return left - right; }
