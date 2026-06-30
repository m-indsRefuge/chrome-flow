# Chrome Flow Session Continuity Discovery

## 1. Purpose

This document defines the discovery baseline for Chrome Flow Layer 2: Session Continuity and Workspace Session Runtime.

Layer 1 completed the V0 Tab Management and Organisation Layer. It established that Chrome Flow can safely act upon the browser through deterministic controls: tab intake, role assignment, Chrome grouping, group focus, recovery, duplicate review, missing-tab recovery, browser tab closure, and new-window movement.

Layer 2 builds upward from that foundation. It turns Chrome Flow from a single active workspace tab organiser into a self-contained workspace runtime system with persistent state, controlled browser projection, workspace switching, workspace chaining, saved workspace inspection, and AI-ready continuity surfaces.

This document is a discovery and design anchor. It is not the implementation contract yet.

## 2. Layer 2 Thesis

Layer 2 turns Chrome Flow into a governed workspace runtime.

Chrome Flow should store workspace/session state inside its own persistence layer, treat live Chrome tabs/groups/windows as temporary browser projections, promote complex workspaces into dedicated Chrome windows, support pause/dehydrate and resume/rehydrate behavior, allow standard switching between unrelated workspaces, introduce robust workspace chaining through Workspace Constellations, and provide a saved-workspace inspection surface for human and future AI review.

The layer is not complete until Chrome Flow can actively remove and recreate workspace browser projections from stored state.

## 3. Relationship to Layer 1

Layer 1 remains the guide for Layer 2.

Layer 1 established the build pattern:

```text
deterministic behavior first
real browser behavior validation
operator-facing control surface
evidence through timeline and diagnostics
recovery-aware destructive actions
contract and policy before AI runtime
UI polish deferred to a dedicated phase
```

Layer 2 should follow the same pattern, but at the workspace/session level rather than the individual tab/group level.

Layer 1 owns workspace tab organisation inside a single active workspace. Layer 2 owns the lifecycle of multiple workspaces, their live browser projections, their saved state, and their relationships to each other.

## 4. Core Mental Model

Layer 2 requires a strict distinction between durable state and live browser projection.

```text
Chrome Flow persistent state = source of truth
Chrome tabs/groups/windows = runtime projection
```

Chrome Flow must not rely on Chrome's native saved group behavior as the long-term memory system. Chrome groups are useful while a workspace is active, but they should be treated as a temporary runtime projection of Chrome Flow's own stored workspace state.

This prevents browser clutter and keeps the Agent self-contained.

## 5. Definitions

### 5.1 Workspace

A durable container of work.

A workspace includes:

```text
workspaceId
name
aim
workspaceType
tab records
roles
aliases
journal entries
timeline events
continuation notes
summary card
links
chain/constellation membership
lifecycle state
```

### 5.2 Session

A period of engagement with a workspace.

A session records:

```text
sessionId
workspaceId
startedAt
pausedAt
resumedAt
endedAt
runtime window evidence
checkpoint snapshots
continuation state
```

### 5.3 Projection

The live Chrome representation of a workspace.

A projection may include:

```text
Chrome window
Chrome tabs
Chrome groups
group titles
active/focused tab
tab ordering
group collapsed/expanded state
```

Projection is temporary. Stored workspace state is durable.

### 5.4 Hydrate / Rehydrate

Create a live browser projection from stored workspace state.

Resume should rehydrate a workspace into a Chrome window with its tabs, roles, groups, labels, and metadata restored as closely as possible.

### 5.5 Dehydrate

Remove a workspace's live browser projection while preserving its stored state.

Dehydration may close workspace-owned live tabs, remove Chrome groups as a side effect of tab closure, save projection evidence, and mark the workspace as paused or inactive.

### 5.6 Workspace Chain

A deterministic relationship path between workspaces that share a line of thought, project, or dependency.

### 5.7 Workspace Constellation

A first-class collection of linked/chained workspaces that together form a larger cognitive project or research/build structure.

A constellation may contain root, branch, continuation, reference, support, and evidence workspaces.

## 6. Accepted Design Decisions

### Decision 1: Mixed Shared-Window Mode Is Deferred Entirely

Multiple unrelated or semi-related workspaces should not share the same live Chrome window once they become meaningful workspace projections.

Mixed shared-window mode creates ambiguity around ownership, grouping, switching, pause behavior, and tab closure. It is deferred entirely.

### Decision 2: Four Tabs Triggers Dedicated Window Promotion

A workspace may begin inside the current or primary Chrome window while it is exploratory.

The accepted threshold is:

```text
1-3 tabs: current-window workspace allowed
4 tabs: prompt to promote workspace into a dedicated Chrome Flow window
5+ tabs: block or strongly gate further intake until the workspace is promoted
```

This rule protects cognitive coherence and prevents workspace clutter.

### Decision 3: Resume Means Full Rehydration

Resume should recall the entire workspace back to the point it was paused.

Resume should recreate:

```text
tabs
roles
aliases
groups
group labels
workspace metadata
session continuation note
journal/timeline context
dedicated workspace window
```

### Decision 4: Pause/Deactivate Removes Browser Projection for Standard Switching

For standard switching between unrelated workspaces, pause should save state and remove the current workspace's live browser projection.

The workspace state remains stored. The live Chrome projection is removed.

### Decision 5: Standard Switch and Constellation Switch Are Different

A standard switch moves between unrelated workspaces:

```text
save current state
deactivate/dehydrate current projection
hydrate target workspace projection
```

A constellation switch moves coherently between linked workspace windows:

```text
preserve chain context
focus or activate related workspace projection
maintain relationship awareness
avoid unnecessary dehydrate/rehydrate cycles where related workspaces are intentionally active
```

### Decision 6: Workspace Constellation Is First-Class

Workspace chaining/cross-reference is not a later nice-to-have. It is a first-class Layer 2 requirement.

Chrome Flow must support coherent navigation across related workspaces.

### Decision 7: Inspect Saved Workspace Is First-Class

Chrome Flow must allow the Operator to inspect a saved workspace without reopening it.

This inspection surface should provide enough deterministic detail for human review and future AI augmentation.

### Decision 8: Layer 2 Should Introduce a Real Persistence Foundation

Layer 2 should bypass reliance on a single active `chrome.storage.local` workspace blob as quickly as possible.

The preferred direction is an IndexedDB-backed local persistence foundation, with `chrome.storage.local` used only for tiny bootstrap/config state if needed.

### Decision 9: Chrome Flow State Is Durable; Chrome IDs Are Runtime Evidence

Durable truth should be based on Chrome Flow domain identifiers:

```text
workspaceId
sessionId
workspaceTabId
projectionId
chainId
constellationId
roleId
alias
url
title
operatorAim
continuationNote
summaryCard
timelineEvent
journalEntry
linkType
```

Chrome identifiers such as `tabId`, `windowId`, and `groupId` are runtime evidence, not durable truth.

### Decision 10: UI Polish Remains Deferred

Layer 2 must include enough UI/control surface to validate functionality, but visual design and polish remain deferred to a dedicated UI research/build phase.

### Decision 11: Chrome Flow Is a Browser Implementation of a General Workspace Runtime Pattern

Chrome Flow should be designed as a browser-specific implementation of a more general workspace runtime architecture. The pattern may later transfer into Lighthouse or an OS-level workspace management agent.

## 7. Persistence Direction

Layer 2 should introduce a persistence foundation called, conceptually:

```text
Session DB v0
```

The likely first implementation target is IndexedDB because it is local, browser-native, extension-compatible, structured, and suitable for indexed workspace/session records.

Chrome storage may remain useful for small bootstrap values:

```text
activeWorkspaceId
lastOpenedWorkspaceId
schemaVersion
migration flags
simple settings
```

But the main state should move toward a database-backed repository layer.

## 8. Persistence Entities

Session DB v0 should support the following domain entities.

### 8.1 Workspaces

```text
workspaceId
name
aim
workspaceType
lifecycleState
createdAt
updatedAt
lastActivatedAt
lastPausedAt
lastArchivedAt
summaryCardId
constellationIds
```

### 8.2 Workspace Tabs

```text
workspaceTabId
workspaceId
url
displayUrl
originalTitle
alias
role
createdAt
updatedAt
firstSeenAt
lastSeenAt
lastKnownProjectionState
```

### 8.3 Sessions

```text
sessionId
workspaceId
startedAt
pausedAt
resumedAt
endedAt
sessionState
continuationNote
checkpointIds
```

### 8.4 Projections

```text
projectionId
workspaceId
sessionId
projectionState
projectionMode
runtimeWindowId
runtimeTabIds
runtimeGroupIds
hydratedAt
dehydratedAt
lastVerifiedAt
```

### 8.5 Workspace Links

```text
linkId
fromWorkspaceId
toWorkspaceId
linkType
label
createdAt
createdFromContext
```

### 8.6 Workspace Constellations

```text
constellationId
name
rootWorkspaceId
workspaceIds
createdAt
updatedAt
constellationAim
```

### 8.7 Journal Entries

```text
journalEntryId
workspaceId
sessionId
text
tag
relatedRole
createdAt
```

### 8.8 Timeline Events

```text
eventId
workspaceId
sessionId
type
message
createdAt
evidence
recoveryActions
```

### 8.9 Summary Cards

```text
summaryCardId
workspaceId
summaryVersion
createdAt
updatedAt
deterministicSummary
workspaceAim
roleSummary
tabSummary
journalSummary
recentActivitySummary
continuationSummary
linkedWorkspaceSummary
aiAugmentationStatus
```

### 8.10 Settings / Thresholds

```text
dedicatedWindowThreshold: 4
maxConcurrentWorkspaceWindows
allowConcurrentConstellationWindows
autoPromoteComplexWorkspace: false|prompt|required
```

## 9. Repository Boundary

The rest of the app should not call IndexedDB directly.

Layer 2 should introduce a repository/storage abstraction such as:

```text
src/core/session-db.js
src/core/workspace-repository.js
src/core/session-repository.js
src/core/projection-repository.js
src/core/constellation-repository.js
```

The exact file structure can be simplified during implementation, but the boundary should remain clear.

Target repository functions may include:

```text
createWorkspace
getWorkspace
saveWorkspace
listSavedWorkspaces
setActiveWorkspace
createSessionCheckpoint
pauseWorkspace
resumeWorkspace
hydrateWorkspaceProjection
dehydrateWorkspaceProjection
createWorkspaceLink
listWorkspaceConstellations
createOrUpdateSummaryCard
inspectSavedWorkspace
```

## 10. Workspace Lifecycle States

Initial lifecycle states should remain simple:

```text
active
paused
archived
```

Additional projection state should be tracked separately:

```text
hydrated
dehydrated
partially_hydrated
projection_missing
projection_ambiguous
```

This prevents confusion between durable workspace lifecycle and live browser projection state.

## 11. Workspace Runtime Controls

Layer 2 should eventually expose a comprehensive deterministic control surface.

Controls may include:

```text
Create Workspace
Create Linked Workspace From Current Context
Inspect Saved Workspace
Activate Workspace
Pause Workspace
Deactivate Workspace Projection
Resume Workspace
Rehydrate Workspace Projection
Switch Workspace
Archive Workspace
Restore Archived Workspace
Create Workspace Link
Remove Workspace Link
Create Workspace Constellation
Open Constellation Navigator
Switch Within Constellation
Move Workspace to Dedicated Window
Copy Session Continuity Packet
```

This is a functional validation surface, not final UI design.

## 12. Pause / Dehydrate Behavior

Pause should save the workspace/session state.

For standard switching, pause should also dehydrate the current browser projection.

Pause/dehydrate should:

```text
capture workspace tab records
capture role assignments
capture aliases
capture group assignments
capture group titles where relevant
capture journal and timeline state
capture continuation note
capture runtime window evidence
close only safely resolved workspace-owned tabs
remove Chrome groups as a consequence of tab closure
mark workspace lifecycle as paused
mark projection state as dehydrated
record evidence in timeline/session history
```

Safety rule:

```text
Only close workspace-owned tabs that are safely resolved as part of the active workspace projection.
Never close tabs merely because their URL matches a workspace record.
```

## 13. Resume / Rehydrate Behavior

Resume means full rehydration.

Resume should:

```text
load the saved workspace state
create a dedicated Chrome Flow workspace window when needed
open workspace tabs from saved URLs
restore roles and aliases in Chrome Flow state
recreate native Chrome groups by role
apply group titles
restore tab ordering where practical
set projection state to hydrated
record workspace_resumed and projection_hydrated evidence
render continuation note and saved summary card
```

Resume should not depend on Chrome's native saved group behavior. Chrome Flow should recreate the projection from its own stored state.

## 14. Standard Workspace Switch

A standard switch applies to unrelated workspaces.

Expected sequence:

```text
1. Snapshot current workspace/session state.
2. Pause current workspace.
3. Dehydrate current browser projection.
4. Set current workspace lifecycle to paused.
5. Load target workspace from Session DB.
6. Set target workspace as active.
7. Rehydrate target workspace projection.
8. Record switch events and evidence.
```

Standard switch should feel like changing from one coherent work context to another, without leaving browser clutter behind.

## 15. Constellation Switch

A constellation switch applies to linked workspaces inside the same workspace constellation.

It should allow the Operator to move coherently between related workspace windows while preserving project context.

Possible behavior:

```text
focus target workspace window
show linked workspace context
preserve related active projections when intentionally concurrent
avoid dehydrate/rehydrate unless requested
record constellation_switch event
```

Constellation switch is not mixed shared-window mode. Related workspaces should remain bounded to their own dedicated windows when active.

## 16. Dedicated Window Strategy

Chrome Flow should enforce dedicated windows as the workspace grows.

Accepted threshold:

```text
4 workspace tabs triggers promotion
```

Promotion should be guided and strongly enforced:

```text
1-3 tabs: workspace may remain in current window
4 tabs: prompt and guide move to dedicated window
5+ tabs: require dedicated window before further intake
```

Prompt example:

```text
This workspace has reached 4 tabs.
To preserve workspace coherence, Chrome Flow needs to move it into a dedicated workspace window before more tabs are added.
```

This is deterministic product authority, not AI autonomy.

## 17. Workspace-Owned Tabs

Layer 2 must define workspace ownership over live tabs.

A workspace-owned runtime tab is a live Chrome tab that:

```text
belongs to a workspace tab record
was opened, moved, adopted, or rehydrated by Chrome Flow
has a workspaceTabId
is safely resolved to a live Chrome tab
belongs to the current workspace projection
```

Only workspace-owned runtime tabs may be closed during projection dehydration.

## 18. Starting New Workspaces From Current Context

Chrome Flow should support two creation paths.

### 18.1 Create New Workspace

Create a new unrelated workspace.

### 18.2 Create Linked Workspace From Current Context

Create a workspace that branches from the current workspace.

The linked workspace may preserve:

```text
parent workspace id
origin tab
origin role group
origin note
reason for branch
selected copied/adopted tabs
link type
constellation membership
```

This supports thought-chain expansion without losing coherence.

## 19. Workspace Link Types

Layer 2 should support a small initial set of link types.

Initial link types:

```text
branches_from
continues
references
supports
```

Deferred or later link types:

```text
depends_on
evidence_for
evidence_against
supersedes
blocked_by
parallel_to
```

The goal is deterministic cross-reference, not AI-inferred relationship guessing.

## 20. Inspect Saved Workspace

Inspect Saved Workspace is a first-class feature.

It should allow the Operator to review a saved workspace without reopening its browser projection.

The deterministic review should include:

```text
workspace name
workspace aim
workspace type
lifecycle state
projection state
last active time
last paused time
tab count
role group summary
tab titles and aliases
journal highlights
recent timeline events
continuation note
linked workspaces
constellation membership
available actions
```

This review surface should become the future AI summary substrate.

## 21. Workspace Summary Card

A Workspace Summary Card is a deterministic structured summary attached to a workspace.

It should be generated from reliable stored fields, not AI inference in V0.

Possible sections:

```text
Purpose
Current State
Tab/Role Structure
Operator Notes
Recent Activity
Continuation Point
Linked Workspaces
Available Actions
AI Augmentation Status
```

Future AI can augment this card into richer commentary, but it should not replace the deterministic source summary.

## 22. AI-Ready Summary Substrate

Layer 2 should prepare saved workspace summaries for future AI interpretation.

The future AI should be able to read a structured summary card and produce useful commentary such as:

```text
This workspace appears to be a research workspace about LoRA training for small models. It includes references around adapter-based fine-tuning, local model constraints, and possible integration with the Lighthouse local model pipeline. The last continuation point indicates that the next useful step is comparing LoRA, QLoRA, and adapter placement strategies before deciding what belongs in the training plan.
```

In V0, this should remain deterministic. The AI augmentation layer is deferred.

## 23. Guided Organisational Authority

Chrome Flow should be allowed to enforce deterministic organisational constraints when those constraints protect workspace coherence.

Examples:

```text
promote to dedicated window at 4 tabs
block additional intake until promotion after threshold
refuse mixed shared-window workspace mode
require confirmation before dehydrate/switch
require safe tab ownership before closing projection tabs
```

This is a core product behavior. It prevents human browser clutter from defeating the cognitive clarity purpose of the Agent.

## 24. Concurrent Workspaces

Layer 2 should support the concept of concurrent workspaces only under controlled conditions.

Allowed:

```text
multiple active workspaces if each has a dedicated Chrome Flow window
multiple related workspaces inside a Workspace Constellation
```

Deferred:

```text
multiple workspaces mixed inside one shared Chrome window
unbounded concurrent workspace projections
```

The Agent should detect growing complexity and guide the Operator into dedicated windows.

## 25. Session Continuity Packet

Layer 2 should include an exportable Session Continuity Packet.

The packet should include:

```text
active workspace id
active session id
workspace lifecycle state
projection state
runtime window evidence
workspace summary card
saved workspace registry summary
paused workspaces
archived workspaces
workspace links
workspace constellations
recent session events
continuation notes
tab status summary
available recovery/resume actions
```

This packet will be essential for validation, future AI review, and external analysis.

## 26. Safety and Confirmation Model

Layer 2 controls can affect many tabs and windows. Confirmation must be explicit for meaningful projection changes.

Always require confirmation for:

```text
deactivate workspace projection
standard switch with projection removal
archive workspace
restore archived workspace with projection hydration
close workspace-owned tabs during dehydration
clear/remove workspace records
```

Recommended confirmation for:

```text
promote workspace to dedicated window
resume workspace projection
constellation switch when multiple windows are active
create linked workspace from current context with copied/adopted tabs
```

No confirmation or low-friction confirmation may be acceptable for:

```text
inspect saved workspace
copy session continuity packet
focus existing workspace window
view constellation navigator
```

## 27. Deferred UI Phase

UI research/design remains deferred.

Layer 2 UI should prioritize:

```text
clear state visibility
operator confidence
validation evidence
safe controls
plain labels
predictable behavior
```

Layer 2 UI should not attempt final visual design, polish, or advanced user experience research during the core build.

Deferred UI items include:

```text
final workspace dashboard design
visual constellation map
advanced workspace cards
polished summary cards
animation/window transition UX
full command palette design
```

## 28. Deferred AI Phase

Layer 2 should prepare for AI but not implement AI runtime.

Deferred:

```text
AI-generated workspace summaries
AI automatic workspace linking
AI natural-language workspace switching
AI autonomous pause/resume decisions
AI command execution
AI model/provider integration
embeddings/semantic search
transformer/adapters/runtime integration
```

Allowed now:

```text
deterministic summary cards
AI-ready structured state
command/policy language
evidence packets
clear storage schemas
future tool-registry boundaries
```

## 29. Future OS-Level Pattern

Chrome Flow should be understood as a browser implementation of a broader workspace runtime concept.

Possible future OS-level mapping:

```text
Chrome tabs -> applications/windows/documents
Chrome groups -> OS workspace groups
workspace projection -> active desktop/workspace state
session continuity -> OS-level project resume
workspace constellation -> project graph across apps, files, browser, notes, terminals
```

This supports the long-term possibility that Chrome Flow patterns may inform Lighthouse or a future OS-level workspace management agent.

## 30. Proposed Build Phases

### Phase 2A: Discovery and Schema Lock

Deliverable:

```text
docs/SESSION_CONTINUITY_DISCOVERY.md
```

Define concepts, accepted decisions, schemas, state model, and validation targets.

### Phase 2B: Session DB v0 Foundation

Build local persistence foundation:

```text
IndexedDB wrapper
repository boundary
workspace records
session records
projection records
links/constellations records
summary card records
migration bridge from current active workspace model
```

### Phase 2C: Saved Workspace Registry and Inspection

Build:

```text
list saved workspaces
inspect saved workspace
workspace summary card
available actions panel
continuity packet export
```

### Phase 2D: Projection Runtime Controls

Build:

```text
pause/dehydrate
resume/rehydrate
promote to dedicated window
standard switch
safe projection removal
projection evidence
```

### Phase 2E: Workspace Chaining and Constellations

Build:

```text
create linked workspace from current context
workspace links
workspace constellation records
constellation switch
constellation review packet
```

### Phase 2F: Validation, Consolidation, Contract, Policy

After implementation stabilizes:

```text
validate full Layer 2 behavior
write SESSION_CONTINUITY_COMMAND_CONTRACT.md
write SESSION_CONTINUITY_POLICY.md
consolidate helper code if needed
freeze Layer 2
```

## 31. Validation Targets

Layer 2 should not be considered complete until the following are validated:

```text
saved workspace registry persists across reloads
workspace can be inspected without reopening tabs
workspace summary card is generated deterministically
4-tab threshold prompts/promotes to dedicated window
additional intake is blocked/gated after threshold until promotion
workspace can be paused/dehydrated
workspace projection tabs are safely closed only when owned/resolved
workspace can be resumed/rehydrated into a new window
role groups and labels are recreated on resume
standard switch pauses/dehydrates current and resumes target
linked workspace can be created from current context
workspace constellation can be created or inferred from explicit links
constellation switch focuses/navigates related workspace windows
session continuity packet captures state/evidence
UI remains functional but not final-polished
no AI runtime is introduced
```

## 32. Acceptance Criteria

Layer 2 discovery is accepted when the team agrees that:

```text
- the durable source of truth is Chrome Flow persistence, not Chrome groups;
- live Chrome tabs/groups/windows are runtime projections;
- mixed shared-window mode is deferred entirely;
- four tabs triggers dedicated window promotion;
- resume means full projection rehydration;
- pause/deactivate can remove the browser projection;
- standard switch and constellation switch are distinct;
- Workspace Constellation is first-class;
- Inspect Saved Workspace is first-class;
- Session DB v0 should be introduced early;
- deterministic summary cards prepare for future AI augmentation;
- UI polish is deferred;
- AI runtime is deferred;
- Chrome Flow remains a stepping-stone prototype for broader workspace-runtime systems.
```

## 33. Current Decision

Proceed from discovery into a Layer 2 build plan centered on:

```text
Session DB v0
Saved Workspace Registry
Inspect Saved Workspace
Workspace Summary Card
Projection Hydration/Dehydration
Dedicated Workspace Windows
Standard Switch
Workspace Constellations
Session Continuity Packet
```

Do not begin implementation until this discovery document has been reviewed and accepted.
