import {
  getSummaryCardForWorkspace,
  getWorkspaceJournalEntries,
  getWorkspaceProjections,
  getWorkspaceRecord,
  getWorkspaceSessions,
  getWorkspaceTabs,
  getWorkspaceTimelineEvents,
  importLegacyWorkspaceToSessionDb,
  listWorkspaceRecords,
  listWorkspacesByLifecycleState
} from "./session-repository.js";

import { saveRuntimeWorkspaceSnapshotToSessionDb } from "./workspace-snapshot-repository.js";

const WORKSPACE_MEMORY_CONTRACT = Object.freeze({
  layer: "long_term_workspace_memory",
  authority: "Session DB / IndexedDB",
  owns: [
    "saved workspace records",
    "archived and dehydrated workspace records",
    "historical workspace snapshots",
    "long-term timeline and journal evidence",
    "Workspace Library records",
    "future algorithmic scoring inputs"
  ],
  doesNotOwn: [
    "live Chrome tab ids as durable truth",
    "live Chrome window ids as durable truth",
    "live Chrome group ids as durable truth",
    "immediate active sidepanel runtime state"
  ],
  notes: [
    "Session DB is long-term memory authority, not live browser authority.",
    "Resume/hydrate actions copy selected memory records into active runtime memory after Operator confirmation.",
    "Production Workspace Library saves replace snapshot-owned child collections atomically.",
    "Algorithmic and AI layers should read durable workspace context through this memory boundary."
  ]
});

async function saveRuntimeWorkspaceSnapshotToMemory(runtimeWorkspace, details = {}) {
  return importLegacyWorkspaceToSessionDb(runtimeWorkspace, {
    lifecycleState: details.lifecycleState || "paused",
    lastPausedAt: details.lastPausedAt || new Date().toISOString(),
    continuationNote: details.continuationNote || "Saved from active runtime into long-term workspace memory."
  });
}

async function saveRuntimeWorkspaceToWorkspaceLibrary(runtimeWorkspace, details = {}) {
  const savedAt = details.savedAt || new Date().toISOString();
  const result = await saveRuntimeWorkspaceSnapshotToSessionDb(runtimeWorkspace, {
    savedAt,
    lifecycleState: details.lifecycleState || "paused",
    lastPausedAt: details.lastPausedAt || savedAt,
    continuationNote: details.continuationNote || "Saved from the production Save Workspace action into Workspace Library."
  });

  return {
    ...result,
    savedAt,
    saveMode: "production_save_to_workspace_library",
    persistenceMode: "exact_atomic_snapshot_replacement",
    productionSave: true,
    workspaceId: result.workspace.workspaceId,
    workspaceName: result.workspace.name,
    counts: {
      ...result.counts,
      tabs: result.counts.workspaceTabs,
      journalEntries: result.counts.journalEntries,
      timelineEvents: result.counts.timelineEvents
    }
  };
}

async function getWorkspaceMemoryRecord(workspaceId) {
  const workspace = await getWorkspaceRecord(workspaceId);
  if (!workspace) return null;

  return buildWorkspaceMemoryRecord(workspace);
}

async function listWorkspaceMemoryRecords() {
  const workspaces = await listWorkspaceRecords();
  const records = [];

  for (const workspace of workspaces) {
    records.push(await buildWorkspaceMemoryRecord(workspace));
  }

  return records;
}

async function listRecentResumableWorkspaceMemoryRecords(limit = 3) {
  const paused = await listWorkspacesByLifecycleState("paused");
  const records = [];

  for (const workspace of paused.slice(0, limit)) {
    records.push(await buildWorkspaceMemoryRecord(workspace));
  }

  return records;
}

async function getWorkspaceMemorySummary() {
  const records = await listWorkspaceMemoryRecords();
  const recentResumable = await listRecentResumableWorkspaceMemoryRecords(3);

  return {
    contract: WORKSPACE_MEMORY_CONTRACT,
    memorySourceOfTruth: "Session DB / IndexedDB",
    workspaceRecordCount: records.length,
    recentResumableCount: recentResumable.length,
    recentResumableWorkspaceIds: recentResumable.map((record) => record.workspace.workspaceId),
    records: records.map((record) => summarizeWorkspaceMemoryRecord(record))
  };
}

async function buildWorkspaceMemoryRecord(workspace) {
  const [tabs, sessions, projections, journalEntries, timelineEvents, summaryCard] = await Promise.all([
    getWorkspaceTabs(workspace.workspaceId),
    getWorkspaceSessions(workspace.workspaceId),
    getWorkspaceProjections(workspace.workspaceId),
    getWorkspaceJournalEntries(workspace.workspaceId),
    getWorkspaceTimelineEvents(workspace.workspaceId),
    getSummaryCardForWorkspace(workspace.workspaceId)
  ]);

  return {
    workspace,
    tabs,
    sessions,
    projections,
    journalEntries,
    timelineEvents,
    summaryCard,
    counts: {
      tabs: tabs.length,
      sessions: sessions.length,
      projections: projections.length,
      journalEntries: journalEntries.length,
      timelineEvents: timelineEvents.length
    }
  };
}

function summarizeWorkspaceMemoryRecord(record) {
  return {
    workspaceId: record.workspace.workspaceId,
    name: record.workspace.name,
    lifecycleState: record.workspace.lifecycleState,
    workspaceType: record.workspace.workspaceType,
    updatedAt: record.workspace.updatedAt,
    lastActivatedAt: record.workspace.lastActivatedAt,
    lastPausedAt: record.workspace.lastPausedAt,
    lastArchivedAt: record.workspace.lastArchivedAt,
    counts: record.counts,
    hasSummaryCard: Boolean(record.summaryCard)
  };
}

export {
  WORKSPACE_MEMORY_CONTRACT,
  getWorkspaceMemoryRecord,
  getWorkspaceMemorySummary,
  listRecentResumableWorkspaceMemoryRecords,
  listWorkspaceMemoryRecords,
  saveRuntimeWorkspaceSnapshotToMemory,
  saveRuntimeWorkspaceToWorkspaceLibrary,
  summarizeWorkspaceMemoryRecord
};
