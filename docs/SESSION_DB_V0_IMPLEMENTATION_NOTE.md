# Session DB v0 Implementation Note

## Purpose

This note records the first implementation slices for Chrome Flow Layer 2: Session Continuity and Workspace Session Runtime.

The goal is to introduce the local persistence foundation and a safe active-workspace import bridge without disturbing the validated Layer 1 tab-management runtime.

## Branch

```text
layer2-session-db-v0
```

## Added Files

```text
src/core/session-db.js
src/core/session-repository.js
src/sidepanel/session-db-diagnostics.js
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

It also provides repository actions for:

```text
createWorkspaceWithSession
importLegacyWorkspaceToSessionDb
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
getWorkspaceJournalEntries
getWorkspaceTimelineEvents
getSummaryCardForWorkspace
saveSummaryCard
setActiveWorkspaceId
getActiveWorkspaceId
getDedicatedWindowThreshold
setDedicatedWindowThreshold
```

### session-db-diagnostics.js

Provides a Layer 2 diagnostic and validation surface in the side panel.

Controls:

```text
Open Session DB
Create Test Workspace Record
Import Active Workspace to Session DB
List Saved DB Workspaces
Copy Session DB Packet
```

The Session DB packet is copied with a bounded text envelope:

```text
CHROME_FLOW_PACKET_START
...
CHROME_FLOW_PACKET_END
```

## Active Workspace Import Bridge

The active workspace import bridge copies the current active workspace from the existing `chrome.storage.local` runtime path into Session DB v0.

It imports:

```text
workspace metadata
workspace tab records
journal entries
timeline events
session snapshot
projection snapshot
summary card
```

The bridge preserves the active workspace `workspaceId` and stable `workspaceTabId` values where available.

The bridge is copy-only. It does not make Session DB the active runtime source of truth yet.

## Safety Boundary

This slice does not replace the current active workspace runtime yet.

Current active workspace behavior still uses the existing `workspace-store.js` / `chrome.storage.local` path until migration is deliberately implemented and validated.

This means the branch should not affect existing Layer 1 tab-management behavior simply by being present.

## Validation Targets

Current validation targets:

```text
- open Session DB from the extension context
- create a test workspace/session/projection record
- list saved workspace records
- copy a Session DB diagnostic packet
- confirm database persistence across extension reloads
- import active workspace into Session DB
- confirm imported workspace tabs, journal entries, timeline events, projection snapshot, and summary card appear in the Session DB packet
```

## Why This Comes First

The discovery document established that Layer 2 needs a real persistence foundation and should not rely on Chrome native tab groups or a single active Chrome storage blob as the durable source of truth.

This implementation sequence creates the persistence foundation early while keeping the validated Layer 1 behavior stable.

## Next Build Slice

Recommended next slice after the import bridge validates:

```text
Saved Workspace Registry / Inspect Saved Workspace
```

Purpose:

```text
- show saved Session DB workspaces in a human-readable registry
- inspect an imported workspace without reopening browser tabs
- display deterministic summary card content
- expose available future actions without executing runtime projection changes
```
