import {
  addJournalEntry,
  addTimelineEvent,
  getWorkspace,
  saveWorkspace
} from "./workspace-store.js";

import {
  readAssignedWorkspaceReadonly
} from "./journal-append-coordination/readonly-workspace.js";

import {
  appendDiagnosticEvent,
  clearDiagnosticEvents,
  getDiagnosticEvents,
  reconcileDiagnosticEventRing
} from "./diagnostic-event-store.js";

const WORKSPACE_ARCHIVE_KEY = "chromeFlowWorkspaceArchive";
const ASSIGNED_WORKSPACE_REFRESH_EVENT = "constellation-runtime-workspace-assigned-refresh";

const WORKSPACE_RUNTIME_CONTRACT = Object.freeze({
  layer: "active_runtime_memory",
  authority: "chrome.storage.local",
  owns: [
    "active workspace state",
    "live tab ids",
    "live window ids",
    "live group ids",
    "active session timeline",
    "immediate sidepanel runtime state"
  ],
  doesNotOwn: [
    "long-term saved workspace records",
    "historical archive memory",
    "algorithmic long-term scoring inputs"
  ],
  notes: [
    "Browser tabs, windows, and groups are live projections, not durable authority.",
    "Runtime state may be dehydrated into long-term workspace memory.",
    "Runtime state may be hydrated from long-term workspace memory after explicit Operator action."
  ]
});

async function getActiveWorkspaceRuntime() {
  return getWorkspace();
}

async function saveActiveWorkspaceRuntime(workspace) {
  await saveWorkspace(workspace);
  return getWorkspace();
}

async function appendActiveWorkspaceJournalEntry(text, details = {}) {
  await addJournalEntry(text, details);
  return getWorkspace();
}

async function appendActiveWorkspaceTimelineEvent(type, message, details = {}) {
  await addTimelineEvent(type, message, details);
  return getWorkspace();
}

function readAssignedWorkspaceRuntime(authority) {
  const read = readAssignedWorkspaceReadonly(authority);
  if (!read.ok) return { ok: false, reason: "invalid_assigned_authority" };
  return {
    ok: true,
    workspaceId: read.workspace.workspaceId,
    workspaceRevision: read.workspace.workspaceRevision,
    workspace: read.workspace
  };
}

function validateAssignedWorkspaceRuntimeTabIds(authority) {
  const read = readAssignedWorkspaceRuntime(authority);
  if (!read.ok) return read;
  if (!Array.isArray(read.workspace.tabs)) {
    return { ok: false, reason: "invalid_assigned_authority" };
  }
  if (read.workspace.tabs.some((tab) => typeof tab?.workspaceTabId !== "string" || !tab.workspaceTabId.trim())) {
    return {
      ok: false,
      reason: "runtime_workspace_identity_migration_required",
      workspaceId: read.workspaceId,
      workspaceRevision: read.workspaceRevision
    };
  }
  return read;
}

function createAssignedWorkspaceRuntimeMutationGateway({
  resolveAuthority,
  mutationClient,
  createEventId = () => crypto.randomUUID(),
  now = () => new Date().toISOString()
} = {}) {
  async function resolveAssignedWorkspace() {
    let authorityState;
    try {
      authorityState = await resolveAuthority();
    } catch (error) {
      return gatewayFailure("failed", "assigned_authority_resolve_failed", null, [safeError(error)]);
    }

    if (!isAssignedWritableAuthorityState(authorityState)) {
      return gatewayFailure(
        typeof authorityState?.status === "string" ? authorityState.status : "failed",
        typeof authorityState?.reason === "string" && authorityState.reason
          ? authorityState.reason
          : "assigned_authority_unavailable",
        authorityState
      );
    }

    const read = validateAssignedWorkspaceRuntimeTabIds(authorityState.authority);
    if (!read.ok) {
      return gatewayFailure(
        "blocked",
        read.reason,
        authorityState,
        [],
        read.workspaceId,
        read.workspaceRevision
      );
    }

    return {
      ok: true,
      status: "assigned",
      reason: "",
      authorityState,
      authority: authorityState.authority,
      workspaceId: read.workspaceId,
      workspaceRevision: read.workspaceRevision,
      workspace: read.workspace,
      errors: []
    };
  }

  async function submit(input = {}) {
    const before = await resolveAssignedWorkspace();
    if (!before.ok) return before;

    let result;
    try {
      if (typeof mutationClient?.submit !== "function") {
        throw new Error("assigned mutation client is unavailable");
      }
      result = await mutationClient.submit({
        authority: before.authority,
        mutationKind: input?.mutationKind,
        payload: input?.payload
      });
    } catch (error) {
      return gatewayFailure(
        "failed",
        "assigned_mutation_client_failed",
        null,
        [safeError(error)]
      );
    }

    if (!isVerifiedAssignedMutationResult(result)) {
      return gatewayFailure(
        typeof result?.status === "string" ? result.status : "failed",
        typeof result?.reason === "string" && result.reason
          ? result.reason
          : "assigned_mutation_not_verified",
        null,
        Array.isArray(result?.errors) ? [...result.errors] : [],
        before.workspaceId,
        before.workspaceRevision,
        result
      );
    }

    const refreshed = await resolveAssignedWorkspace();
    return {
      ok: true,
      status: result.status,
      reason: result.reason || "",
      result,
      refreshed: refreshed.ok,
      refreshReason: refreshed.ok ? "" : refreshed.reason,
      authorityState: refreshed.authorityState || null,
      workspaceId: refreshed.workspaceId || before.workspaceId,
      workspaceRevision: refreshed.workspaceRevision ?? before.workspaceRevision,
      workspace: refreshed.ok ? refreshed.workspace : null,
      errors: refreshed.ok ? [] : refreshed.errors || []
    };
  }

  async function appendTimeline(type, message, details = {}) {
    let record;
    try {
      record = {
        eventId: createEventId(),
        type,
        message,
        createdAt: now(),
        ...details
      };
    } catch (error) {
      return gatewayFailure(
        "failed",
        "timeline_record_generation_failed",
        null,
        [safeError(error)]
      );
    }
    return submit({ mutationKind: "timeline.append", payload: { record } });
  }

  return {
    resolveAssignedWorkspace,
    submit,
    appendTimeline
  };
}

function isAssignedWritableAuthorityState(state) {
  return state?.status === "assigned" &&
    state.authority !== null &&
    typeof state.authority === "object" &&
    state.authority.lifecycleState === "available";
}

function isVerifiedAssignedMutationResult(result) {
  return result &&
    typeof result === "object" &&
    !Array.isArray(result) &&
    ["committed", "no_change", "replayed"].includes(result.status) &&
    result.authorityVerified === true &&
    result.workspaceVerified === true;
}

function gatewayFailure(status, reason, authorityState, errors = [], workspaceId = null, workspaceRevision = null, result = null) {
  return {
    ok: false,
    status,
    reason,
    authorityState: authorityState || null,
    workspaceId,
    workspaceRevision,
    workspace: null,
    result,
    refreshed: false,
    errors
  };
}

function safeError(error) {
  return String(error?.message || error || "unknown_error");
}

async function getLegacyRuntimeArchiveRecords() {
  const result = await chrome.storage.local.get(WORKSPACE_ARCHIVE_KEY);
  return Array.isArray(result[WORKSPACE_ARCHIVE_KEY]) ? result[WORKSPACE_ARCHIVE_KEY] : [];
}

async function saveLegacyRuntimeArchiveRecords(archives) {
  const records = Array.isArray(archives) ? archives : [];
  await chrome.storage.local.set({ [WORKSPACE_ARCHIVE_KEY]: records });
  return records;
}

async function getRuntimeDiagnostics() {
  return getDiagnosticEvents();
}

async function appendRuntimeDiagnostic(level, action, message, details = {}) {
  const diagnostic = await appendDiagnosticEvent(level, action, message, details);
  await reconcileDiagnosticEventRing();
  return diagnostic;
}

async function clearRuntimeDiagnostics() {
  return clearDiagnosticEvents();
}

async function reconcileRuntimeDiagnostics() {
  return reconcileDiagnosticEventRing();
}

async function getRuntimeMemorySummary() {
  const [workspace, archives, diagnostics] = await Promise.all([
    getActiveWorkspaceRuntime(),
    getLegacyRuntimeArchiveRecords(),
    getRuntimeDiagnostics()
  ]);

  const tabs = Array.isArray(workspace.tabs) ? workspace.tabs : [];
  const openTabs = tabs.filter((tab) => Number.isInteger(Number(tab?.tabId)) && Number(tab.tabId) > 0);
  const groupedTabs = openTabs.filter((tab) => Number.isInteger(Number(tab?.groupId)) && Number(tab.groupId) >= 0);

  return {
    contract: WORKSPACE_RUNTIME_CONTRACT,
    activeWorkspace: {
      workspaceId: workspace.workspaceId || "",
      name: workspace.name || "Untitled Workspace",
      workspaceType: workspace.workspaceType || "unknown",
      tabCount: tabs.length,
      openTabCount: openTabs.length,
      groupedOpenTabCount: groupedTabs.length,
      journalCount: Array.isArray(workspace.journal) ? workspace.journal.length : 0,
      timelineCount: Array.isArray(workspace.timeline) ? workspace.timeline.length : 0,
      updatedAt: workspace.updatedAt || ""
    },
    compatibilityArchiveCount: archives.length,
    diagnosticCount: diagnostics.length,
    runtimeSourceOfTruth: "chrome.storage.local"
  };
}

export {
  ASSIGNED_WORKSPACE_REFRESH_EVENT,
  WORKSPACE_RUNTIME_CONTRACT,
  appendActiveWorkspaceJournalEntry,
  appendActiveWorkspaceTimelineEvent,
  appendRuntimeDiagnostic,
  clearRuntimeDiagnostics,
  createAssignedWorkspaceRuntimeMutationGateway,
  getActiveWorkspaceRuntime,
  readAssignedWorkspaceRuntime,
  validateAssignedWorkspaceRuntimeTabIds,
  getLegacyRuntimeArchiveRecords,
  getRuntimeDiagnostics,
  getRuntimeMemorySummary,
  reconcileRuntimeDiagnostics,
  saveActiveWorkspaceRuntime,
  saveLegacyRuntimeArchiveRecords
};
