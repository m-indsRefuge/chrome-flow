# Session DB v0 Implementation Note

## Purpose

This note records the first implementation slices for Chrome Flow Layer 2: Session Continuity and Workspace Session Runtime.

The goal is to introduce the local persistence foundation, a safe active-workspace import bridge, and a saved-workspace inspection surface without disturbing the validated Layer 1 tab-management runtime.

## Branch

```text
layer2-session-db-v0
```

## Added Files

```text
src/core/session-db.js
src/core/session-repository.js
src/sidepanel/session-db-diagnostics.js
src/sidepanel/saved-workspace-registry.js
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

### saved-workspace-registry.js

Provides the first saved-workspace review surface.

Controls:

```text
Refresh Saved Workspaces
Inspect Saved Workspace
Copy Inspection Packet
```

This surface reads saved workspace records from Session DB and renders a deterministic inspection card without reopening tabs, creating browser windows, rehydrating projections, or changing the active runtime source of truth.

It can inspect:

```text
workspace metadata
lifecycle state
projection state
session state
tab count
journal entry count
timeline event count
summary card
recent deterministic activity
links and constellation membership
available future actions
```

It can also copy a bounded inspection packet:

```text
saved-workspace-inspection-packet-v0.1
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

## Saved Workspace Inspection

Saved workspace inspection is read-only.

It must not:

```text
open browser tabs
create browser windows
recreate Chrome groups
change active workspace runtime source
mark Session DB as the runtime source of truth
```

It may:

```text
load saved Session DB records
show deterministic summary-card content
show lifecycle/projection/session state
show counts and recent activity
copy an inspection packet for review
record diagnostics about inspection actions
```

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
- refresh the Saved Workspace Registry
- inspect a saved workspace without opening browser tabs
- confirm the inspection card shows deterministic summary, lifecycle state, projection state, and record counts
- copy a Saved Workspace Inspection Packet
```

## Why This Comes First

The discovery document established that Layer 2 needs a real persistence foundation and should not rely on Chrome native tab groups or a single active Chrome storage blob as the durable source of truth.

This implementation sequence creates the persistence foundation early while keeping the validated Layer 1 behavior stable.

## Next Build Slice

Recommended next slice after the saved-workspace registry validates:

```text
Saved Workspace Registry Refinement / Cleanup Controls
```

Purpose:

```text
- remove or hide smoke-test records
- separate test records from imported real workspace records
- improve saved workspace labels and sorting
- prepare the registry for future resume/dehydrate controls
```
