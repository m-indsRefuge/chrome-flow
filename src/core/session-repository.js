import {
  SESSION_DB_SCHEMA,
  getAllFromIndex,
  getAllFromStore,
  getFromStore,
  putInStore,
  runSessionDbTransaction
} from "./session-db.js";

import {
  DEFAULT_WORKSPACE_TYPE
} from "./workspace-role-sets.js";

const ACTIVE_WORKSPACE_SETTING_KEY = "activeWorkspaceId";
const DEDICATED_WINDOW_THRESHOLD_SETTING_KEY = "dedicatedWindowThreshold";
const DEFAULT_DEDICATED_WINDOW_THRESHOLD = 4;

export function createWorkspaceRecord(details = {}) {
  const now = new Date().toISOString();

  return normalizeWorkspaceRecord({
    workspaceId: crypto.randomUUID(),
    name: details.name || "Untitled Workspace",
    aim: details.aim || "",
    workspaceType: details.workspaceType || DEFAULT_WORKSPACE_TYPE,
    lifecycleState: details.lifecycleState || "active",
    createdAt: now,
    updatedAt: now,
    lastActivatedAt: details.lastActivatedAt || now,
    lastPausedAt: "",
    lastArchivedAt: "",
    summaryCardId: "",
    constellationIds: []
  });
}

export function createWorkspaceTabRecord(workspaceId, tab, details = {}) {
  const now = new Date().toISOString();
  const url = details.url ?? tab?.url ?? "";

  return normalizeWorkspaceTabRecord({
    workspaceTabId: details.workspaceTabId || crypto.randomUUID(),
    workspaceId,
    url,
    displayUrl: details.displayUrl || createDisplayUrl(url),
    originalTitle: details.originalTitle || tab?.title || "Untitled tab",
    alias: details.alias || "",
    role: details.role || "unassigned",
    createdAt: details.createdAt || now,
    updatedAt: now,
    firstSeenAt: details.firstSeenAt || now,
    lastSeenAt: details.lastSeenAt || now,
    lastKnownProjectionState: details.lastKnownProjectionState || "not_projected"
  });
}

export function createSessionRecord(workspaceId, details = {}) {
  const now = new Date().toISOString();

  return normalizeSessionRecord({
    sessionId: details.sessionId || crypto.randomUUID(),
    workspaceId,
    startedAt: details.startedAt || now,
    pausedAt: details.pausedAt || "",
    resumedAt: details.resumedAt || "",
    endedAt: details.endedAt || "",
    sessionState: details.sessionState || "active",
    continuationNote: details.continuationNote || "",
    checkpointIds: Array.isArray(details.checkpointIds) ? details.checkpointIds : []
  });
}

export function createProjectionRecord(workspaceId, sessionId, details = {}) {
  const now = new Date().toISOString();

  return normalizeProjectionRecord({
    projectionId: details.projectionId || crypto.randomUUID(),
    workspaceId,
    sessionId,
    projectionState: details.projectionState || "dehydrated",
    projectionMode: details.projectionMode || "none",
    runtimeWindowId: Number.isInteger(details.runtimeWindowId) ? details.runtimeWindowId : null,
    runtimeTabIds: Array.isArray(details.runtimeTabIds) ? details.runtimeTabIds : [],
    runtimeGroupIds: Array.isArray(details.runtimeGroupIds) ? details.runtimeGroupIds : [],
    hydratedAt: details.hydratedAt || "",
    dehydratedAt: details.dehydratedAt || "",
    lastVerifiedAt: details.lastVerifiedAt || now
  });
}

export function createWorkspaceLinkRecord(fromWorkspaceId, toWorkspaceId, details = {}) {
  return normalizeWorkspaceLinkRecord({
    linkId: details.linkId || crypto.randomUUID(),
    fromWorkspaceId,
    toWorkspaceId,
    linkType: details.linkType || "references",
    label: details.label || "",
    createdAt: details.createdAt || new Date().toISOString(),
    createdFromContext: details.createdFromContext || null
  });
}

export function createConstellationRecord(details = {}) {
  const now = new Date().toISOString();

  return normalizeConstellationRecord({
    constellationId: details.constellationId || crypto.randomUUID(),
    name: details.name || "Untitled Workspace Constellation",
    rootWorkspaceId: details.rootWorkspaceId || "",
    workspaceIds: Array.isArray(details.workspaceIds) ? details.workspaceIds : [],
    createdAt: details.createdAt || now,
    updatedAt: details.updatedAt || now,
    constellationAim: details.constellationAim || ""
  });
}

export function createJournalEntryRecord(workspaceId, sessionId, details = {}) {
  return normalizeJournalEntryRecord({
    journalEntryId: details.journalEntryId || crypto.randomUUID(),
    workspaceId,
    sessionId: sessionId || "",
    text: details.text || "",
    tag: details.tag || "",
    relatedRole: details.relatedRole || "",
    createdAt: details.createdAt || new Date().toISOString()
  });
}

export function createTimelineEventRecord(workspaceId, sessionId, type, message, details = {}) {
  return normalizeTimelineEventRecord({
    eventId: details.eventId || crypto.randomUUID(),
    workspaceId,
    sessionId: sessionId || "",
    type,
    message,
    createdAt: details.createdAt || new Date().toISOString(),
    evidence: details.evidence || {},
    recoveryActions: details.recoveryActions || null
  });
}

export function createSummaryCardRecord(workspace, details = {}) {
  const now = new Date().toISOString();
  const workspaceId = workspace.workspaceId || details.workspaceId || "";

  return normalizeSummaryCardRecord({
    summaryCardId: details.summaryCardId || workspace.summaryCardId || crypto.randomUUID(),
    workspaceId,
    summaryVersion: details.summaryVersion || "summary-card-v0.1",
    createdAt: details.createdAt || now,
    updatedAt: now,
    deterministicSummary: details.deterministicSummary || createDeterministicWorkspaceSummary(workspace, details),
    workspaceAim: workspace.aim || details.workspaceAim || "",
    roleSummary: details.roleSummary || [],
    tabSummary: details.tabSummary || [],
    journalSummary: details.journalSummary || [],
    recentActivitySummary: details.recentActivitySummary || [],
    continuationSummary: details.continuationSummary || "",
    linkedWorkspaceSummary: details.linkedWorkspaceSummary || [],
    aiAugmentationStatus: "not_augmented"
  });
}

export async function createWorkspaceWithSession(details = {}) {
  const workspace = createWorkspaceRecord(details);
  const session = createSessionRecord(workspace.workspaceId, { sessionState: "active" });
  const projection = createProjectionRecord(workspace.workspaceId, session.sessionId, { projectionState: "dehydrated" });
  const summaryCard = createSummaryCardRecord(workspace);
  workspace.summaryCardId = summaryCard.summaryCardId;

  await runSessionDbTransaction([
    SESSION_DB_SCHEMA.stores.workspaces,
    SESSION_DB_SCHEMA.stores.sessions,
    SESSION_DB_SCHEMA.stores.projections,
    SESSION_DB_SCHEMA.stores.summaryCards,
    SESSION_DB_SCHEMA.stores.settings
  ], "readwrite", (stores) => {
    stores.get(SESSION_DB_SCHEMA.stores.workspaces).put(workspace);
    stores.get(SESSION_DB_SCHEMA.stores.sessions).put(session);
    stores.get(SESSION_DB_SCHEMA.stores.projections).put(projection);
    stores.get(SESSION_DB_SCHEMA.stores.summaryCards).put(summaryCard);
    stores.get(SESSION_DB_SCHEMA.stores.settings).put({ key: ACTIVE_WORKSPACE_SETTING_KEY, value: workspace.workspaceId, updatedAt: new Date().toISOString() });
  });

  return { workspace, session, projection, summaryCard };
}

export async function importLegacyWorkspaceToSessionDb(legacyWorkspace, details = {}) {
  const now = new Date().toISOString();
  const sourceWorkspace = normalizeLegacyWorkspace(legacyWorkspace);
  const workspaceId = sourceWorkspace.workspaceId;
  const legacyTabs = sourceWorkspace.tabs;
  const legacyJournal = sourceWorkspace.journal;
  const legacyTimeline = sourceWorkspace.timeline;
  const workspace = normalizeWorkspaceRecord({
    workspaceId,
    name: sourceWorkspace.name || "Untitled Workspace",
    aim: sourceWorkspace.aim || "",
    workspaceType: sourceWorkspace.workspaceType || DEFAULT_WORKSPACE_TYPE,
    lifecycleState: details.lifecycleState || "paused",
    createdAt: sourceWorkspace.createdAt || now,
    updatedAt: now,
    lastActivatedAt: sourceWorkspace.updatedAt || sourceWorkspace.createdAt || now,
    lastPausedAt: details.lastPausedAt || now,
    lastArchivedAt: "",
    summaryCardId: createStableSummaryCardId(workspaceId),
    constellationIds: []
  });
  const session = createSessionRecord(workspaceId, {
    sessionState: "imported_snapshot",
    startedAt: sourceWorkspace.createdAt || now,
    pausedAt: now,
    endedAt: now,
    continuationNote: details.continuationNote || "Imported from active chrome.storage.local workspace into Session DB v0."
  });
  const projection = createProjectionRecord(workspaceId, session.sessionId, {
    projectionState: "dehydrated",
    projectionMode: "legacy_active_workspace_snapshot",
    runtimeWindowId: getSingleRuntimeWindowId(legacyTabs),
    runtimeTabIds: collectUniqueIntegers(legacyTabs.map((tab) => tab.tabId)),
    runtimeGroupIds: collectUniqueIntegers(legacyTabs.map((tab) => tab.groupId).filter((groupId) => groupId !== -1)),
    dehydratedAt: now,
    lastVerifiedAt: now
  });
  const workspaceTabs = legacyTabs.map((tab) => createWorkspaceTabRecord(workspaceId, tab, {
    workspaceTabId: tab.workspaceTabId || crypto.randomUUID(),
    url: tab.url || "",
    displayUrl: tab.displayUrl || createDisplayUrl(tab.url || ""),
    originalTitle: tab.originalTitle || tab.title || "Untitled tab",
    alias: tab.alias || "",
    role: tab.role || "unassigned",
    createdAt: tab.firstSeenAt || sourceWorkspace.createdAt || now,
    firstSeenAt: tab.firstSeenAt || sourceWorkspace.createdAt || now,
    lastSeenAt: tab.lastSeenAt || sourceWorkspace.updatedAt || now,
    lastKnownProjectionState: tab.isOpen === false ? "legacy_missing_at_import" : "legacy_open_at_import"
  }));
  const journalEntries = legacyJournal.map((entry) => createJournalEntryRecord(workspaceId, session.sessionId, {
    journalEntryId: entry.entryId || entry.journalEntryId || crypto.randomUUID(),
    text: entry.text || "",
    tag: entry.tag || "",
    relatedRole: entry.relatedRoleId || entry.relatedRoleLabel || entry.relatedRole || "",
    createdAt: entry.createdAt || now
  }));
  const timelineEvents = legacyTimeline.map((event) => createTimelineEventRecord(
    workspaceId,
    session.sessionId,
    event.type || "legacy_event",
    event.message || "Imported legacy workspace event.",
    {
      eventId: event.eventId || crypto.randomUUID(),
      createdAt: event.createdAt || now,
      evidence: createTimelineEvidence(event),
      recoveryActions: event.recoveryActions || null
    }
  ));
  const importEvent = createTimelineEventRecord(
    workspaceId,
    session.sessionId,
    "legacy_workspace_imported_to_session_db",
    "Imported active workspace snapshot into Session DB v0.",
    {
      createdAt: now,
      evidence: {
        source: "chrome.storage.local",
        sourceWorkspaceId: sourceWorkspace.workspaceId,
        tabCount: workspaceTabs.length,
        journalCount: journalEntries.length,
        timelineCount: timelineEvents.length,
        migrationMode: "copy_only_runtime_bridge"
      }
    }
  );
  timelineEvents.push(importEvent);
  const summaryCard = createSummaryCardRecord(workspace, {
    summaryCardId: workspace.summaryCardId,
    createdAt: sourceWorkspace.createdAt || now,
    deterministicSummary: createLegacyWorkspaceDeterministicSummary(sourceWorkspace, workspaceTabs, journalEntries, timelineEvents),
    tabCount: workspaceTabs.length,
    roleSummary: createRoleSummaryFromTabs(workspaceTabs),
    tabSummary: createTabSummaryFromTabs(workspaceTabs),
    journalSummary: createJournalSummary(journalEntries),
    recentActivitySummary: createRecentActivitySummary(timelineEvents),
    continuationSummary: details.continuationNote || "Imported snapshot is available for saved-workspace inspection. Runtime migration has not started.",
    linkedWorkspaceSummary: []
  });

  await runSessionDbTransaction([
    SESSION_DB_SCHEMA.stores.workspaces,
    SESSION_DB_SCHEMA.stores.workspaceTabs,
    SESSION_DB_SCHEMA.stores.sessions,
    SESSION_DB_SCHEMA.stores.projections,
    SESSION_DB_SCHEMA.stores.journalEntries,
    SESSION_DB_SCHEMA.stores.timelineEvents,
    SESSION_DB_SCHEMA.stores.summaryCards,
    SESSION_DB_SCHEMA.stores.settings
  ], "readwrite", (stores) => {
    stores.get(SESSION_DB_SCHEMA.stores.workspaces).put(workspace);
    stores.get(SESSION_DB_SCHEMA.stores.sessions).put(session);
    stores.get(SESSION_DB_SCHEMA.stores.projections).put(projection);
    stores.get(SESSION_DB_SCHEMA.stores.summaryCards).put(summaryCard);
    workspaceTabs.forEach((tab) => stores.get(SESSION_DB_SCHEMA.stores.workspaceTabs).put(tab));
    journalEntries.forEach((entry) => stores.get(SESSION_DB_SCHEMA.stores.journalEntries).put(entry));
    timelineEvents.forEach((event) => stores.get(SESSION_DB_SCHEMA.stores.timelineEvents).put(event));
    stores.get(SESSION_DB_SCHEMA.stores.settings).put({ key: ACTIVE_WORKSPACE_SETTING_KEY, value: workspace.workspaceId, updatedAt: now });
  });

  return {
    importedAt: now,
    workspace,
    session,
    projection,
    summaryCard,
    counts: {
      workspaceTabs: workspaceTabs.length,
      journalEntries: journalEntries.length,
      timelineEvents: timelineEvents.length,
      runtimeTabIds: projection.runtimeTabIds.length,
      runtimeGroupIds: projection.runtimeGroupIds.length
    },
    bridgeStatus: {
      sessionDbRuntimeSourceOfTruth: false,
      activeWorkspaceRuntimeSource: "chrome.storage.local",
      migrationMode: "copy_only_runtime_bridge"
    }
  };
}

export async function getWorkspaceRecord(workspaceId) {
  const workspace = await getFromStore(SESSION_DB_SCHEMA.stores.workspaces, workspaceId);
  return workspace ? normalizeWorkspaceRecord(workspace) : null;
}

export async function saveWorkspaceRecord(workspace) {
  return putInStore(SESSION_DB_SCHEMA.stores.workspaces, normalizeWorkspaceRecord(workspace));
}

export async function listWorkspaceRecords() {
  const workspaces = await getAllFromStore(SESSION_DB_SCHEMA.stores.workspaces);
  return workspaces.map(normalizeWorkspaceRecord).sort(sortByUpdatedAtDescending);
}

export async function listWorkspacesByLifecycleState(lifecycleState) {
  const workspaces = await getAllFromIndex(SESSION_DB_SCHEMA.stores.workspaces, "lifecycleState", lifecycleState);
  return workspaces.map(normalizeWorkspaceRecord).sort(sortByUpdatedAtDescending);
}

export async function getWorkspaceTabs(workspaceId) {
  const tabs = await getAllFromIndex(SESSION_DB_SCHEMA.stores.workspaceTabs, "workspaceId", workspaceId);
  return tabs.map(normalizeWorkspaceTabRecord);
}

export async function saveWorkspaceTab(tab) {
  return putInStore(SESSION_DB_SCHEMA.stores.workspaceTabs, normalizeWorkspaceTabRecord(tab));
}

export async function getWorkspaceSessions(workspaceId) {
  const sessions = await getAllFromIndex(SESSION_DB_SCHEMA.stores.sessions, "workspaceId", workspaceId);
  return sessions.map(normalizeSessionRecord).sort(sortByStartedAtDescending);
}

export async function saveSessionRecord(session) {
  return putInStore(SESSION_DB_SCHEMA.stores.sessions, normalizeSessionRecord(session));
}

export async function getWorkspaceProjections(workspaceId) {
  const projections = await getAllFromIndex(SESSION_DB_SCHEMA.stores.projections, "workspaceId", workspaceId);
  return projections.map(normalizeProjectionRecord);
}

export async function saveProjectionRecord(projection) {
  return putInStore(SESSION_DB_SCHEMA.stores.projections, normalizeProjectionRecord(projection));
}

export async function getWorkspaceLinks(workspaceId) {
  const outgoing = await getAllFromIndex(SESSION_DB_SCHEMA.stores.workspaceLinks, "fromWorkspaceId", workspaceId);
  const incoming = await getAllFromIndex(SESSION_DB_SCHEMA.stores.workspaceLinks, "toWorkspaceId", workspaceId);

  return [...outgoing, ...incoming].map(normalizeWorkspaceLinkRecord);
}

export async function saveWorkspaceLink(link) {
  return putInStore(SESSION_DB_SCHEMA.stores.workspaceLinks, normalizeWorkspaceLinkRecord(link));
}

export async function getConstellationRecord(constellationId) {
  const constellation = await getFromStore(SESSION_DB_SCHEMA.stores.constellations, constellationId);
  return constellation ? normalizeConstellationRecord(constellation) : null;
}

export async function saveConstellationRecord(constellation) {
  return putInStore(SESSION_DB_SCHEMA.stores.constellations, normalizeConstellationRecord(constellation));
}

export async function listConstellationRecords() {
  const constellations = await getAllFromStore(SESSION_DB_SCHEMA.stores.constellations);
  return constellations.map(normalizeConstellationRecord).sort(sortByUpdatedAtDescending);
}

export async function getWorkspaceJournalEntries(workspaceId) {
  const entries = await getAllFromIndex(SESSION_DB_SCHEMA.stores.journalEntries, "workspaceId", workspaceId);
  return entries.map(normalizeJournalEntryRecord).sort(sortByCreatedAtDescending);
}

export async function getWorkspaceTimelineEvents(workspaceId) {
  const events = await getAllFromIndex(SESSION_DB_SCHEMA.stores.timelineEvents, "workspaceId", workspaceId);
  return events.map(normalizeTimelineEventRecord).sort(sortByCreatedAtDescending);
}

export async function getSummaryCardForWorkspace(workspaceId) {
  const cards = await getAllFromIndex(SESSION_DB_SCHEMA.stores.summaryCards, "workspaceId", workspaceId);
  return cards.length ? normalizeSummaryCardRecord(cards[0]) : null;
}

export async function saveSummaryCard(summaryCard) {
  return putInStore(SESSION_DB_SCHEMA.stores.summaryCards, normalizeSummaryCardRecord(summaryCard));
}

export async function setActiveWorkspaceId(workspaceId) {
  await putInStore(SESSION_DB_SCHEMA.stores.settings, { key: ACTIVE_WORKSPACE_SETTING_KEY, value: workspaceId, updatedAt: new Date().toISOString() });
}

export async function getActiveWorkspaceId() {
  const record = await getFromStore(SESSION_DB_SCHEMA.stores.settings, ACTIVE_WORKSPACE_SETTING_KEY);
  return record?.value || "";
}

export async function getDedicatedWindowThreshold() {
  const record = await getFromStore(SESSION_DB_SCHEMA.stores.settings, DEDICATED_WINDOW_THRESHOLD_SETTING_KEY);
  return Number.isInteger(record?.value) ? record.value : DEFAULT_DEDICATED_WINDOW_THRESHOLD;
}

export async function setDedicatedWindowThreshold(value) {
  const threshold = Number.isInteger(value) && value > 0 ? value : DEFAULT_DEDICATED_WINDOW_THRESHOLD;
  await putInStore(SESSION_DB_SCHEMA.stores.settings, { key: DEDICATED_WINDOW_THRESHOLD_SETTING_KEY, value: threshold, updatedAt: new Date().toISOString() });
}

export function normalizeWorkspaceRecord(workspace = {}) {
  const now = new Date().toISOString();

  return {
    workspaceId: workspace.workspaceId || crypto.randomUUID(),
    name: workspace.name || "Untitled Workspace",
    aim: workspace.aim || "",
    workspaceType: workspace.workspaceType || DEFAULT_WORKSPACE_TYPE,
    lifecycleState: workspace.lifecycleState || "active",
    createdAt: workspace.createdAt || now,
    updatedAt: workspace.updatedAt || now,
    lastActivatedAt: workspace.lastActivatedAt || "",
    lastPausedAt: workspace.lastPausedAt || "",
    lastArchivedAt: workspace.lastArchivedAt || "",
    summaryCardId: workspace.summaryCardId || "",
    constellationIds: Array.isArray(workspace.constellationIds) ? workspace.constellationIds : []
  };
}

export function normalizeWorkspaceTabRecord(tab = {}) {
  const now = new Date().toISOString();
  const url = tab.url || "";

  return {
    workspaceTabId: tab.workspaceTabId || crypto.randomUUID(),
    workspaceId: tab.workspaceId || "",
    url,
    displayUrl: tab.displayUrl || createDisplayUrl(url),
    originalTitle: tab.originalTitle || "Untitled tab",
    alias: tab.alias || "",
    role: tab.role || "unassigned",
    createdAt: tab.createdAt || now,
    updatedAt: tab.updatedAt || now,
    firstSeenAt: tab.firstSeenAt || now,
    lastSeenAt: tab.lastSeenAt || now,
    lastKnownProjectionState: tab.lastKnownProjectionState || "not_projected"
  };
}

export function normalizeSessionRecord(session = {}) {
  return {
    sessionId: session.sessionId || crypto.randomUUID(),
    workspaceId: session.workspaceId || "",
    startedAt: session.startedAt || new Date().toISOString(),
    pausedAt: session.pausedAt || "",
    resumedAt: session.resumedAt || "",
    endedAt: session.endedAt || "",
    sessionState: session.sessionState || "active",
    continuationNote: session.continuationNote || "",
    checkpointIds: Array.isArray(session.checkpointIds) ? session.checkpointIds : []
  };
}

export function normalizeProjectionRecord(projection = {}) {
  return {
    projectionId: projection.projectionId || crypto.randomUUID(),
    workspaceId: projection.workspaceId || "",
    sessionId: projection.sessionId || "",
    projectionState: projection.projectionState || "dehydrated",
    projectionMode: projection.projectionMode || "none",
    runtimeWindowId: Number.isInteger(projection.runtimeWindowId) ? projection.runtimeWindowId : null,
    runtimeTabIds: Array.isArray(projection.runtimeTabIds) ? projection.runtimeTabIds : [],
    runtimeGroupIds: Array.isArray(projection.runtimeGroupIds) ? projection.runtimeGroupIds : [],
    hydratedAt: projection.hydratedAt || "",
    dehydratedAt: projection.dehydratedAt || "",
    lastVerifiedAt: projection.lastVerifiedAt || ""
  };
}

export function normalizeWorkspaceLinkRecord(link = {}) {
  return {
    linkId: link.linkId || crypto.randomUUID(),
    fromWorkspaceId: link.fromWorkspaceId || "",
    toWorkspaceId: link.toWorkspaceId || "",
    linkType: link.linkType || "references",
    label: link.label || "",
    createdAt: link.createdAt || new Date().toISOString(),
    createdFromContext: link.createdFromContext || null
  };
}

export function normalizeConstellationRecord(constellation = {}) {
  const now = new Date().toISOString();

  return {
    constellationId: constellation.constellationId || crypto.randomUUID(),
    name: constellation.name || "Untitled Workspace Constellation",
    rootWorkspaceId: constellation.rootWorkspaceId || "",
    workspaceIds: Array.isArray(constellation.workspaceIds) ? constellation.workspaceIds : [],
    createdAt: constellation.createdAt || now,
    updatedAt: constellation.updatedAt || now,
    constellationAim: constellation.constellationAim || ""
  };
}

export function normalizeJournalEntryRecord(entry = {}) {
  return {
    journalEntryId: entry.journalEntryId || crypto.randomUUID(),
    workspaceId: entry.workspaceId || "",
    sessionId: entry.sessionId || "",
    text: entry.text || "",
    tag: entry.tag || "",
    relatedRole: entry.relatedRole || "",
    createdAt: entry.createdAt || new Date().toISOString()
  };
}

export function normalizeTimelineEventRecord(event = {}) {
  return {
    eventId: event.eventId || crypto.randomUUID(),
    workspaceId: event.workspaceId || "",
    sessionId: event.sessionId || "",
    type: event.type || "unknown_event",
    message: event.message || "",
    createdAt: event.createdAt || new Date().toISOString(),
    evidence: event.evidence || {},
    recoveryActions: event.recoveryActions || null
  };
}

export function normalizeSummaryCardRecord(card = {}) {
  const now = new Date().toISOString();

  return {
    summaryCardId: card.summaryCardId || crypto.randomUUID(),
    workspaceId: card.workspaceId || "",
    summaryVersion: card.summaryVersion || "summary-card-v0.1",
    createdAt: card.createdAt || now,
    updatedAt: card.updatedAt || now,
    deterministicSummary: card.deterministicSummary || "",
    workspaceAim: card.workspaceAim || "",
    roleSummary: Array.isArray(card.roleSummary) ? card.roleSummary : [],
    tabSummary: Array.isArray(card.tabSummary) ? card.tabSummary : [],
    journalSummary: Array.isArray(card.journalSummary) ? card.journalSummary : [],
    recentActivitySummary: Array.isArray(card.recentActivitySummary) ? card.recentActivitySummary : [],
    continuationSummary: card.continuationSummary || "",
    linkedWorkspaceSummary: Array.isArray(card.linkedWorkspaceSummary) ? card.linkedWorkspaceSummary : [],
    aiAugmentationStatus: card.aiAugmentationStatus || "not_augmented"
  };
}

function normalizeLegacyWorkspace(workspace = {}) {
  const now = new Date().toISOString();

  return {
    workspaceId: workspace.workspaceId || crypto.randomUUID(),
    name: workspace.name || "Untitled Workspace",
    aim: workspace.aim || "",
    workspaceType: workspace.workspaceType || DEFAULT_WORKSPACE_TYPE,
    createdAt: workspace.createdAt || now,
    updatedAt: workspace.updatedAt || now,
    tabs: Array.isArray(workspace.tabs) ? workspace.tabs : [],
    journal: Array.isArray(workspace.journal) ? workspace.journal : [],
    timeline: Array.isArray(workspace.timeline) ? workspace.timeline : []
  };
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

function createLegacyWorkspaceDeterministicSummary(workspace, tabs, journalEntries, timelineEvents) {
  const name = workspace.name || "Untitled Workspace";
  const aim = workspace.aim || "No workspace aim recorded.";
  const workspaceType = workspace.workspaceType || DEFAULT_WORKSPACE_TYPE;
  return name + " is a " + workspaceType + " workspace imported from the active Chrome Flow runtime. Aim: " + aim + " Tabs recorded: " + tabs.length + ". User notes: " + journalEntries.length + ". System events: " + timelineEvents.length + ".";
}

function createDeterministicWorkspaceSummary(workspace = {}, details = {}) {
  const name = workspace.name || "Untitled Workspace";
  const aim = workspace.aim || "No workspace aim recorded.";
  const workspaceType = workspace.workspaceType || DEFAULT_WORKSPACE_TYPE;
  const tabCount = Number.isInteger(details.tabCount) ? details.tabCount : 0;

  return name + " is a " + workspaceType + " workspace. Aim: " + aim + " Tabs recorded: " + tabCount + ".";
}

function createRoleSummaryFromTabs(tabs) {
  const roles = new Map();

  tabs.forEach((tab) => {
    const role = tab.role || "unassigned";
    const current = roles.get(role) || { role, tabCount: 0 };
    current.tabCount += 1;
    roles.set(role, current);
  });

  return Array.from(roles.values()).sort((left, right) => left.role.localeCompare(right.role));
}

function createTabSummaryFromTabs(tabs) {
  return tabs.map((tab) => ({
    workspaceTabId: tab.workspaceTabId,
    title: tab.alias || tab.originalTitle,
    alias: tab.alias,
    role: tab.role,
    displayUrl: tab.displayUrl,
    url: tab.url,
    lastKnownProjectionState: tab.lastKnownProjectionState
  }));
}

function createJournalSummary(entries) {
  return entries.slice(0, 10).map((entry) => ({
    journalEntryId: entry.journalEntryId,
    tag: entry.tag,
    relatedRole: entry.relatedRole,
    text: entry.text,
    createdAt: entry.createdAt
  }));
}

function createRecentActivitySummary(events) {
  return events
    .slice()
    .sort(sortByCreatedAtDescending)
    .slice(0, 12)
    .map((event) => ({
      eventId: event.eventId,
      type: event.type,
      message: event.message,
      createdAt: event.createdAt
    }));
}

function collectUniqueIntegers(values) {
  return Array.from(new Set(values.filter(Number.isInteger)));
}

function getSingleRuntimeWindowId(tabs) {
  const windowIds = collectUniqueIntegers(tabs.map((tab) => tab.windowId));
  return windowIds.length === 1 ? windowIds[0] : null;
}

function createDisplayUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname + parsed.pathname;
  } catch {
    return url || "";
  }
}

function sortByUpdatedAtDescending(left, right) {
  return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
}

function sortByStartedAtDescending(left, right) {
  return String(right.startedAt || "").localeCompare(String(left.startedAt || ""));
}

function sortByCreatedAtDescending(left, right) {
  return String(right.createdAt || "").localeCompare(String(left.createdAt || ""));
}
