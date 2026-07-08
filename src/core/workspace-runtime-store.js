import {
  addJournalEntry,
  addTimelineEvent,
  getWorkspace,
  saveWorkspace
} from "./workspace-store.js";

const WORKSPACE_ARCHIVE_KEY = "chromeFlowWorkspaceArchive";
const DIAGNOSTICS_KEY = "chromeFlowDiagnostics";
const MAX_DIAGNOSTICS = 200;

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
  const result = await chrome.storage.local.get(DIAGNOSTICS_KEY);
  return Array.isArray(result[DIAGNOSTICS_KEY]) ? result[DIAGNOSTICS_KEY] : [];
}

async function appendRuntimeDiagnostic(level, action, message, details = {}) {
  const diagnostics = await getRuntimeDiagnostics();
  diagnostics.push({
    diagnosticId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    level,
    action,
    message,
    details
  });
  await chrome.storage.local.set({ [DIAGNOSTICS_KEY]: diagnostics.slice(-MAX_DIAGNOSTICS) });
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
  WORKSPACE_RUNTIME_CONTRACT,
  appendActiveWorkspaceJournalEntry,
  appendActiveWorkspaceTimelineEvent,
  appendRuntimeDiagnostic,
  getActiveWorkspaceRuntime,
  getLegacyRuntimeArchiveRecords,
  getRuntimeDiagnostics,
  getRuntimeMemorySummary,
  saveActiveWorkspaceRuntime,
  saveLegacyRuntimeArchiveRecords
};
