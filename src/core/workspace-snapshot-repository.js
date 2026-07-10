import {
  SESSION_DB_SCHEMA,
  runSessionDbTransaction
} from "./session-db.js";

import {
  normalizeJournalEntryRecord,
  normalizeProjectionRecord,
  normalizeSessionRecord,
  normalizeSummaryCardRecord,
  normalizeTimelineEventRecord,
  normalizeWorkspaceRecord,
  normalizeWorkspaceTabRecord
} from "./session-repository.js";

const PRODUCTION_SNAPSHOT_SESSION_PREFIX = "production-snapshot-session:";
const PRODUCTION_SNAPSHOT_PROJECTION_PREFIX = "production-snapshot-projection:";
const PRODUCTION_SNAPSHOT_MODE = "production_workspace_snapshot";
const LEGACY_IMPORT_EVENT_TYPE = "legacy_workspace_imported_to_session_db";

async function saveRuntimeWorkspaceSnapshotToSessionDb(runtimeWorkspace, details = {}) {
  const savedAt = details.savedAt || new Date().toISOString();
  const sourceWorkspace = normalizeRuntimeWorkspace(runtimeWorkspace, savedAt);
  const workspaceId = sourceWorkspace.workspaceId;
  const sessionId = createProductionSnapshotSessionId(workspaceId);
  const projectionId = createProductionSnapshotProjectionId(workspaceId);
  const workspace = buildWorkspaceRecord(sourceWorkspace, details, savedAt);
  const tabs = buildWorkspaceTabRecords(sourceWorkspace, workspaceId, savedAt);
  const journalEntries = buildJournalEntryRecords(sourceWorkspace, workspaceId, sessionId, savedAt);
  const timelineEvents = buildTimelineEventRecords(sourceWorkspace, workspaceId, sessionId, savedAt);
  const session = buildProductionSnapshotSession(sourceWorkspace, workspaceId, sessionId, details, savedAt);
  const projection = buildProductionSnapshotProjection(sourceWorkspace, workspaceId, sessionId, projectionId, savedAt);
  const summaryCard = buildSummaryCard(workspace, tabs, journalEntries, timelineEvents, details, savedAt);
  const replacementStats = createReplacementStats();

  await runSessionDbTransaction([
    SESSION_DB_SCHEMA.stores.workspaces,
    SESSION_DB_SCHEMA.stores.workspaceTabs,
    SESSION_DB_SCHEMA.stores.sessions,
    SESSION_DB_SCHEMA.stores.projections,
    SESSION_DB_SCHEMA.stores.journalEntries,
    SESSION_DB_SCHEMA.stores.timelineEvents,
    SESSION_DB_SCHEMA.stores.summaryCards
  ], "readwrite", (stores) => {
    stores.get(SESSION_DB_SCHEMA.stores.workspaces).put(workspace);
    stores.get(SESSION_DB_SCHEMA.stores.summaryCards).put(summaryCard);

    replaceWorkspaceOwnedRows(
      stores.get(SESSION_DB_SCHEMA.stores.workspaceTabs),
      workspaceId,
      tabs,
      "workspaceTabId",
      replacementStats,
      "workspaceTabs"
    );

    replaceWorkspaceOwnedRows(
      stores.get(SESSION_DB_SCHEMA.stores.journalEntries),
      workspaceId,
      journalEntries,
      "journalEntryId",
      replacementStats,
      "journalEntries"
    );

    replaceWorkspaceOwnedRows(
      stores.get(SESSION_DB_SCHEMA.stores.timelineEvents),
      workspaceId,
      timelineEvents,
      "eventId",
      replacementStats,
      "timelineEvents"
    );

    replaceManagedSnapshotRow(
      stores.get(SESSION_DB_SCHEMA.stores.sessions),
      workspaceId,
      session,
      "sessionId",
      isManagedSnapshotSession,
      replacementStats,
      "sessions"
    );

    replaceManagedSnapshotRow(
      stores.get(SESSION_DB_SCHEMA.stores.projections),
      workspaceId,
      projection,
      "projectionId",
      isManagedSnapshotProjection,
      replacementStats,
      "projections"
    );
  });

  return {
    savedAt,
    workspace,
    session,
    projection,
    summaryCard,
    counts: {
      workspaceTabs: tabs.length,
      journalEntries: journalEntries.length,
      timelineEvents: timelineEvents.length,
      runtimeTabIds: projection.runtimeTabIds.length,
      runtimeGroupIds: projection.runtimeGroupIds.length
    },
    replacementStats,
    bridgeStatus: {
      sessionDbRuntimeSourceOfTruth: false,
      activeWorkspaceRuntimeSource: "chrome.storage.local",
      migrationMode: "exact_atomic_snapshot_replacement",
      persistenceMode: "production_workspace_snapshot"
    }
  };
}

function normalizeRuntimeWorkspace(workspace = {}, now) {
  return {
    workspaceId: workspace.workspaceId || crypto.randomUUID(),
    name: workspace.name || "Untitled Workspace",
    aim: workspace.aim || "",
    workspaceType: workspace.workspaceType || "research",
    createdAt: workspace.createdAt || now,
    updatedAt: workspace.updatedAt || now,
    tabs: Array.isArray(workspace.tabs) ? workspace.tabs : [],
    journal: Array.isArray(workspace.journal) ? workspace.journal : [],
    timeline: Array.isArray(workspace.timeline) ? workspace.timeline : []
  };
}

function buildWorkspaceRecord(sourceWorkspace, details, savedAt) {
  return normalizeWorkspaceRecord({
    workspaceId: sourceWorkspace.workspaceId,
    name: sourceWorkspace.name,
    aim: sourceWorkspace.aim,
    workspaceType: sourceWorkspace.workspaceType,
    lifecycleState: details.lifecycleState || "paused",
    createdAt: sourceWorkspace.createdAt,
    updatedAt: savedAt,
    lastActivatedAt: sourceWorkspace.updatedAt || sourceWorkspace.createdAt,
    lastPausedAt: details.lastPausedAt || savedAt,
    lastArchivedAt: details.lastArchivedAt || "",
    summaryCardId: createStableSummaryCardId(sourceWorkspace.workspaceId),
    constellationIds: []
  });
}

function buildWorkspaceTabRecords(sourceWorkspace, workspaceId, savedAt) {
  return sourceWorkspace.tabs.map((tab) => normalizeWorkspaceTabRecord({
    workspaceTabId: tab.workspaceTabId || crypto.randomUUID(),
    workspaceId,
    url: tab.url || "",
    displayUrl: tab.displayUrl || createDisplayUrl(tab.url || ""),
    originalTitle: tab.originalTitle || tab.title || "Untitled tab",
    alias: tab.alias || "",
    role: tab.role || "unassigned",
    createdAt: tab.firstSeenAt || sourceWorkspace.createdAt || savedAt,
    updatedAt: savedAt,
    firstSeenAt: tab.firstSeenAt || sourceWorkspace.createdAt || savedAt,
    lastSeenAt: tab.lastSeenAt || sourceWorkspace.updatedAt || savedAt,
    lastKnownProjectionState: tab.isOpen === false ? "runtime_closed_at_snapshot" : "runtime_open_at_snapshot"
  }));
}

function buildJournalEntryRecords(sourceWorkspace, workspaceId, sessionId, savedAt) {
  return sourceWorkspace.journal.map((entry) => normalizeJournalEntryRecord({
    journalEntryId: entry.entryId || entry.journalEntryId || crypto.randomUUID(),
    workspaceId,
    sessionId,
    text: entry.text || "",
    tag: entry.tag || "",
    relatedRole: entry.relatedRoleId || entry.relatedRoleLabel || entry.relatedRole || "",
    createdAt: entry.createdAt || savedAt
  }));
}

function buildTimelineEventRecords(sourceWorkspace, workspaceId, sessionId, savedAt) {
  return sourceWorkspace.timeline
    .filter((event) => event?.type !== LEGACY_IMPORT_EVENT_TYPE)
    .map((event) => normalizeTimelineEventRecord({
      eventId: event.eventId || crypto.randomUUID(),
      workspaceId,
      sessionId,
      type: event.type || "runtime_event",
      message: event.message || "Runtime workspace event.",
      createdAt: event.createdAt || savedAt,
      evidence: createTimelineEvidence(event),
      recoveryActions: event.recoveryActions || null
    }));
}

function buildProductionSnapshotSession(sourceWorkspace, workspaceId, sessionId, details, savedAt) {
  return normalizeSessionRecord({
    sessionId,
    workspaceId,
    startedAt: sourceWorkspace.createdAt || savedAt,
    pausedAt: savedAt,
    resumedAt: "",
    endedAt: savedAt,
    sessionState: "production_snapshot",
    continuationNote: details.continuationNote || "Current production Workspace Library snapshot.",
    checkpointIds: []
  });
}

function buildProductionSnapshotProjection(sourceWorkspace, workspaceId, sessionId, projectionId, savedAt) {
  const tabs = sourceWorkspace.tabs;

  return normalizeProjectionRecord({
    projectionId,
    workspaceId,
    sessionId,
    projectionState: "dehydrated",
    projectionMode: PRODUCTION_SNAPSHOT_MODE,
    runtimeWindowId: getSingleRuntimeWindowId(tabs),
    runtimeTabIds: collectUniqueIntegers(tabs.map((tab) => tab.tabId)),
    runtimeGroupIds: collectUniqueIntegers(tabs.map((tab) => tab.groupId).filter((groupId) => groupId !== -1)),
    hydratedAt: "",
    dehydratedAt: savedAt,
    lastVerifiedAt: savedAt
  });
}

function buildSummaryCard(workspace, tabs, journalEntries, timelineEvents, details, savedAt) {
  return normalizeSummaryCardRecord({
    summaryCardId: workspace.summaryCardId,
    workspaceId: workspace.workspaceId,
    summaryVersion: "summary-card-v0.2",
    createdAt: workspace.createdAt || savedAt,
    updatedAt: savedAt,
    deterministicSummary: createDeterministicSummary(workspace, tabs, journalEntries, timelineEvents),
    workspaceAim: workspace.aim,
    roleSummary: createRoleSummary(tabs),
    tabSummary: createTabSummary(tabs),
    journalSummary: createJournalSummary(journalEntries),
    recentActivitySummary: createRecentActivitySummary(timelineEvents),
    continuationSummary: details.continuationNote || "Current production Workspace Library snapshot.",
    linkedWorkspaceSummary: [],
    aiAugmentationStatus: "not_augmented"
  });
}

function replaceWorkspaceOwnedRows(store, workspaceId, records, keyField, stats, statsKey) {
  const request = store.index("workspaceId").getAllKeys(workspaceId);

  request.onsuccess = () => {
    const existingKeys = Array.isArray(request.result) ? request.result : [];
    const desiredKeys = new Set(records.map((record) => record[keyField]));
    let deletedCount = 0;

    for (const key of existingKeys) {
      if (desiredKeys.has(key)) continue;
      store.delete(key);
      deletedCount += 1;
    }

    records.forEach((record) => store.put(record));
    stats[statsKey] = {
      existingCount: existingKeys.length,
      writtenCount: records.length,
      deletedObsoleteCount: deletedCount
    };
  };
}

function replaceManagedSnapshotRow(store, workspaceId, record, keyField, predicate, stats, statsKey) {
  const request = store.index("workspaceId").getAll(workspaceId);

  request.onsuccess = () => {
    const existingRecords = Array.isArray(request.result) ? request.result : [];
    let deletedCount = 0;

    for (const existingRecord of existingRecords) {
      if (!predicate(existingRecord)) continue;
      if (existingRecord[keyField] === record[keyField]) continue;
      store.delete(existingRecord[keyField]);
      deletedCount += 1;
    }

    store.put(record);
    stats[statsKey] = {
      existingCount: existingRecords.length,
      writtenCount: 1,
      deletedManagedSnapshotCount: deletedCount
    };
  };
}

function isManagedSnapshotSession(session = {}) {
  return String(session.sessionId || "").startsWith(PRODUCTION_SNAPSHOT_SESSION_PREFIX)
    || session.sessionState === "imported_snapshot"
    || session.sessionState === "production_snapshot";
}

function isManagedSnapshotProjection(projection = {}) {
  return String(projection.projectionId || "").startsWith(PRODUCTION_SNAPSHOT_PROJECTION_PREFIX)
    || projection.projectionMode === "legacy_active_workspace_snapshot"
    || projection.projectionMode === PRODUCTION_SNAPSHOT_MODE;
}

function createReplacementStats() {
  return {
    workspaceTabs: null,
    journalEntries: null,
    timelineEvents: null,
    sessions: null,
    projections: null
  };
}

function createProductionSnapshotSessionId(workspaceId) {
  return PRODUCTION_SNAPSHOT_SESSION_PREFIX + workspaceId;
}

function createProductionSnapshotProjectionId(workspaceId) {
  return PRODUCTION_SNAPSHOT_PROJECTION_PREFIX + workspaceId;
}

function createStableSummaryCardId(workspaceId) {
  return "summary-card-" + workspaceId;
}

function createTimelineEvidence(event = {}) {
  const evidence = { ...event };
  delete evidence.eventId;
  delete evidence.type;
  delete evidence.message;
  delete evidence.createdAt;
  return evidence;
}

function createDeterministicSummary(workspace, tabs, journalEntries, timelineEvents) {
  const aim = workspace.aim || "No workspace aim recorded.";
  return workspace.name + " is a " + workspace.workspaceType + " workspace. Aim: " + aim
    + " Tabs recorded: " + tabs.length
    + ". User notes: " + journalEntries.length
    + ". System events: " + timelineEvents.length + ".";
}

function createRoleSummary(tabs) {
  const counts = new Map();

  for (const tab of tabs) {
    const role = tab.role || "unassigned";
    counts.set(role, (counts.get(role) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([role, count]) => ({ role, count }))
    .sort((left, right) => left.role.localeCompare(right.role));
}

function createTabSummary(tabs) {
  return tabs.map((tab) => ({
    workspaceTabId: tab.workspaceTabId,
    title: tab.alias || tab.originalTitle || "Untitled tab",
    originalTitle: tab.originalTitle || "Untitled tab",
    alias: tab.alias || "",
    role: tab.role || "unassigned",
    url: tab.url || "",
    displayUrl: tab.displayUrl || tab.url || "",
    lastKnownProjectionState: tab.lastKnownProjectionState || "not_projected"
  }));
}

function createJournalSummary(entries) {
  return [...entries]
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
    .slice(0, 5)
    .map((entry) => ({
      journalEntryId: entry.journalEntryId,
      text: entry.text,
      tag: entry.tag,
      relatedRole: entry.relatedRole,
      createdAt: entry.createdAt
    }));
}

function createRecentActivitySummary(events) {
  return [...events]
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
    .slice(0, 8)
    .map((event) => ({
      eventId: event.eventId,
      type: event.type,
      message: event.message,
      createdAt: event.createdAt
    }));
}

function getSingleRuntimeWindowId(tabs) {
  const windowIds = collectUniqueIntegers(tabs.map((tab) => tab.windowId));
  return windowIds.length === 1 ? windowIds[0] : null;
}

function collectUniqueIntegers(values) {
  return Array.from(new Set(values.filter((value) => Number.isInteger(value))));
}

function createDisplayUrl(url) {
  if (!url) return "";

  try {
    const parsed = new URL(url);
    return parsed.hostname + parsed.pathname;
  } catch (_error) {
    return url;
  }
}

export {
  PRODUCTION_SNAPSHOT_MODE,
  saveRuntimeWorkspaceSnapshotToSessionDb
};
