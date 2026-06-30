# Session DB v0 Implementation Note

## Purpose

This note records the first implementation slice for Chrome Flow Layer 2: Session Continuity and Workspace Session Runtime.

The goal of this slice is to introduce the local persistence foundation without disturbing the validated Layer 1 tab-management runtime.

## Branch

```text
layer2-session-db-v0
```

## Added Files

```text
src/core/session-db.js
src/core/session-repository.js
docs/SESSION_DB_V0_IMPLEMENTATION_NOTE.md
```

## What This Adds

### session-db.js

Provides the IndexedDB foundation for Session DB v0.

Database:

```text
chrome-flow-session-db
```

Version:

```text
1
```

Object stores:

```text
workspaces
workspaceTabs
sessions
projections
workspaceLinks
constellations
journalEntries
timelineEvents
summaryCards
settings
```

This file owns low-level database opening, schema creation, store reads/writes, indexed reads, clearing, and multi-store transactions.

### session-repository.js

Provides the repository/domain boundary over Session DB v0.

It creates and normalizes records for:

```text
workspace records
workspace tab records
session records
projection records
workspace link records
constellation records
journal entry records
timeline event records
summary card records
settings records
```

It also provides early repository actions for:

```text
createWorkspaceWithSession
getWorkspaceRecord
saveWorkspaceRecord
listWorkspaceRecords
listWorkspacesByLifecycleState
getWorkspaceTabs
saveWorkspaceTab
getWorkspaceSessions
saveSessionRecord
getWorkspaceProjections
saveProjectionRecord
getWorkspaceLinks
saveWorkspaceLink
getConstellationRecord
saveConstellationRecord
listConstellationRecords
getSummaryCardForWorkspace
saveSummaryCard
setActiveWorkspaceId
getActiveWorkspaceId
getDedicatedWindowThreshold
setDedicatedWindowThreshold
```

## Safety Boundary

This slice does not replace the current active workspace runtime yet.

Current active workspace behavior still uses the existing `workspace-store.js` / `chrome.storage.local` path until migration is deliberately implemented and validated.

This means the branch should not affect existing side panel behavior simply by being present.

## Why This Comes First

The discovery document established that Layer 2 needs a real persistence foundation and should not rely on Chrome native tab groups or a single active Chrome storage blob as the durable source of truth.

This implementation slice creates that persistence foundation early while keeping the validated Layer 1 behavior stable.

## Next Build Slice

Recommended next slice:

```text
Session DB Smoke Test / Developer Diagnostic Surface
```

Purpose:

```text
- open Session DB from the extension context
- create a test workspace/session/projection record
- list saved workspace records
- copy a Session DB diagnostic packet
- confirm database persistence across extension reloads
```

After that, we can begin the migration bridge from the current active workspace model into Session DB v0.
