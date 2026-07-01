# Runtime Projection Command Envelope

## 1. Purpose

This document defines the command envelope for future Chrome Flow Layer 2 runtime projection controls.

Runtime projection controls are the future commands that will eventually convert saved Session DB workspace state into live browser projections and convert live workspace projections back into durable saved state.

This is not an implementation document for live pause/resume behavior. It is a boundary, authority, evidence, and permission contract for future implementation work.

The purpose of this document is to prevent Chrome Flow from jumping directly from validated saved-workspace state to live browser mutation without a clear command grammar.

## 2. Layer Status

```text
Layer: Runtime Projection Controls
Runtime owner today: chrome.storage.local active workspace runtime
Persistence owner today: Session DB v0
Current branch: runtime-projection-command-envelope
Status: command-envelope design slice
Live runtime projection actions: not implemented in this slice
AI runtime: deferred
AI contract: active as design boundary
```

## 3. Current Validated Foundation

The command envelope builds on the following completed Layer 2 validations:

```text
Session DB v0 foundation: merged
Layer 2 persistence validation: merged
Runtime projection readiness: merged
Rehydratable workspace validation: merged
```

The following cases are now validated:

```text
No saved workspace tab records -> readiness warning
Saved workspace with tab records and URLs -> readiness pass
```

The command envelope must preserve the current boundary:

```text
Active runtime source remains chrome.storage.local.
Session DB remains persistence and inspection state.
Session DB is not yet active runtime authority.
```

## 4. Relationship to Existing Command Contract

The existing V0 tab-management command contract defines deterministic browser and workspace actions as future AI-callable commands without implementing an AI runtime.

Runtime projection commands follow the same doctrine:

```text
Operator authority first
explicit command envelope
preconditions before action
evidence after action
no silent browser mutation
no guessing from ambiguous state
```

Runtime projection commands differ from V0 tab-management commands because they operate across two state surfaces:

```text
1. Durable saved workspace state in Session DB
2. Live browser projection state in Chrome
```

Because they bridge those surfaces, they require stronger confirmation and stronger post-action verification than ordinary inspection or tab-organisation commands.

## 5. Projection Concepts

### 5.1 Runtime Projection

A runtime projection is the live Chrome representation of a Chrome Flow workspace.

It may include:

```text
browser window id
browser tab ids
browser group ids
focused tab/group state
role-based tab ordering
open/missing tab status
```

Chrome IDs are runtime evidence only. They are not durable identity.

### 5.2 Saved Projection

A saved projection is the Session DB projection record associated with a saved workspace/session snapshot.

It may include:

```text
projectionId
workspaceId
sessionId
projectionState
projectionMode
runtimeWindowId at import time
runtimeTabIds at import time
runtimeGroupIds at import time
hydratedAt
dehydratedAt
lastVerifiedAt
```

Saved projection records preserve evidence about the last known projection but must not be trusted blindly as live Chrome state.

### 5.3 Hydrated Projection

A hydrated projection means the saved workspace is currently represented by a live Chrome browser projection that Chrome Flow has created or verified.

Hydrated state must only be assigned after post-action verification.

### 5.4 Dehydrated Projection

A dehydrated projection means the saved workspace exists as durable state without being actively represented by a live browser projection under Chrome Flow control.

The current imported snapshots are treated as dehydrated saved projections.

## 6. Authority Classes

### 6.1 Projection Read-Only

Reads saved/runtime state and computes readiness without changing browser state or workspace state.

Examples:

```text
projection.inspect_saved
projection.validate_readiness
projection.preview_resume_plan
projection.preview_dehydrate_plan
```

Confirmation required: no.

### 6.2 Projection Plan

Creates a command plan or packet that describes a future action but does not execute it.

Examples:

```text
projection.plan_resume_workspace
projection.plan_dehydrate_active_workspace
projection.plan_switch_workspace
```

Confirmation required: no for planning, yes before execution.

### 6.3 Projection Write

Writes Session DB state or runtime metadata without opening, closing, or moving browser tabs.

Examples:

```text
projection.mark_verified
projection.record_checkpoint
projection.record_projection_result
```

Confirmation required: contextual.

### 6.4 Runtime Projection Action

Creates, updates, verifies, or removes live Chrome projection state for a workspace.

Examples:

```text
projection.resume_workspace
projection.dehydrate_active_workspace
projection.switch_workspace
projection.reverify_hydrated_projection
```

Confirmation required: yes.

### 6.5 High-Impact Projection Action

May affect multiple windows, many tabs, current active context, or operator flow.

Examples:

```text
projection.resume_workspace_to_dedicated_window
projection.dehydrate_and_close_workspace_projection
projection.switch_workspace_with_projection_cleanup
```

Confirmation required: yes, with reviewable plan and cancellation path.

## 7. Shared Runtime Projection Command Envelope

Future runtime projection commands must use a consistent envelope.

```json
{
  "commandId": "uuid",
  "commandName": "projection.resume_workspace",
  "authorityClass": "projection_read_only|projection_plan|projection_write|runtime_projection_action|high_impact_projection_action",
  "requestedBy": "operator|ai_suggestion|system",
  "requiresConfirmation": true,
  "confirmationState": "not_required|pending|approved|denied",
  "workspaceId": "uuid",
  "sessionId": "uuid|null",
  "projectionId": "uuid|null",
  "sourceState": {
    "runtimeSource": "chrome.storage.local|session_db|mixed",
    "savedWorkspaceExists": true,
    "activeRuntimeWorkspaceId": "uuid|null",
    "activeDbWorkspaceId": "uuid|null",
    "runtimeAndDbSelectionMatch": false
  },
  "inputs": {},
  "preconditions": [],
  "expectedEffects": [],
  "riskSummary": "",
  "operatorReview": {
    "summary": "",
    "willChangeBrowserState": false,
    "willChangeSessionDbState": false,
    "willChangeChromeStorageRuntime": false,
    "estimatedTabCount": 0,
    "estimatedWindowCount": 0,
    "cancellationAvailable": true
  },
  "execution": {
    "status": "planned|pending_confirmation|approved|running|success|skipped|failed|cancelled",
    "startedAt": "",
    "completedAt": "",
    "timelineEventTypes": [],
    "diagnosticAction": "",
    "evidence": {},
    "error": null
  },
  "verification": {
    "required": true,
    "status": "not_started|passed|warn|failed",
    "checks": [],
    "verifiedAt": "",
    "evidence": {}
  }
}
```

## 8. Status Values

Runtime projection commands should resolve to one of the following statuses:

```text
planned               Command has been prepared but not offered for execution.
pending_confirmation  Operator review is required before execution.
approved              Operator approved the command.
running               Command is executing.
success               Command completed and verification passed.
skipped               Command safely did nothing because preconditions were not met.
failed                Command attempted to run but encountered an error.
cancelled             Operator cancelled or denied execution.
```

## 9. Core Preconditions

Every runtime projection action must check the relevant preconditions before execution.

Common preconditions:

```text
Session DB schema is ready.
Saved workspace exists.
Saved workspace is not archived.
Saved workspace has session records when required.
Saved workspace has projection records when required.
Saved workspace has tab records when rehydration is required.
Saved tab records have URLs when browser tabs may be recreated.
Saved workspace has no ambiguous identity conflict with active runtime workspace.
Target action has an explicit operator confirmation when browser state may change.
Active runtime source is known.
Runtime authority transition is not implied accidentally.
```

Preconditions must produce explicit pass/warn/fail results. Failed preconditions must block execution.

## 10. Required Evidence Fields

Every runtime projection command must preserve evidence sufficient for later review.

Common evidence fields:

```text
commandId
workspaceId
sessionId
projectionId
workspaceName
workspaceType
savedTabCount
runtimeTabCount
missingUrlCount
runtimeWindowId
runtimeTabIds
runtimeGroupIds
createdRuntimeWindowId
createdRuntimeTabIds
createdRuntimeGroupIds
projectionStateBefore
projectionStateAfter
sessionStateBefore
sessionStateAfter
activeRuntimeWorkspaceId
activeDbWorkspaceId
runtimeAndDbSelectionMatch
resolutionMode
skippedCount
blockedReason
verificationStatus
verificationChecks
```

## 11. Runtime Projection Command Groups

## 11.1 Readiness and Preview Commands

### projection.validate_readiness

Purpose: Validate whether saved and runtime state can support future runtime projection actions.

Authority class: projection_read_only.

Current implementation surface:

```text
Runtime Projection Readiness
```

Expected packet:

```text
runtime-projection-readiness-packet-v0.1
```

Required behavior:

- Must not open tabs.
- Must not close tabs.
- Must not create windows.
- Must not move tabs.
- Must not change Session DB runtime authority.
- Must report whether a saved workspace can become a future rehydration candidate.

### projection.preview_resume_plan

Purpose: Build a reviewable plan for resuming a saved workspace without executing it.

Authority class: projection_plan.

Inputs:

```json
{
  "workspaceId": "uuid",
  "targetMode": "current_window|new_window|dedicated_window|operator_selects",
  "includeChromeGroups": true,
  "focusAfterResume": true
}
```

Required output:

```json
{
  "workspaceId": "uuid",
  "workspaceName": "",
  "savedTabCount": 0,
  "missingUrlCount": 0,
  "targetMode": "dedicated_window",
  "requiresConfirmation": true,
  "plannedTabCreates": [],
  "plannedGroupCreates": [],
  "blockedReasons": [],
  "riskSummary": ""
}
```

Required behavior:

- Must not create browser tabs.
- Must not create browser windows.
- Must not change projection state.
- Must produce enough information for Operator review.

### projection.preview_dehydrate_plan

Purpose: Build a reviewable plan for saving current runtime projection state without executing browser cleanup.

Authority class: projection_plan.

Inputs:

```json
{
  "workspaceId": "uuid",
  "includeRuntimeIds": true,
  "includeChromeGroups": true,
  "closeProjectionAfterSave": false
}
```

Required behavior:

- Must inspect active runtime workspace state.
- Must identify tab/window/group evidence to preserve.
- Must not remove browser projections.
- Must not close tabs.
- Must not change Session DB authority.

## 11.2 Future Execution Commands

### projection.resume_workspace

Purpose: Recreate or activate a live browser projection from saved Session DB workspace state.

Authority class: runtime_projection_action or high_impact_projection_action depending on scope.

Implementation status:

```text
not_implemented
```

Required confirmation: yes.

Minimum inputs:

```json
{
  "workspaceId": "uuid",
  "targetMode": "current_window|new_window|dedicated_window",
  "includeChromeGroups": true,
  "focusAfterResume": true
}
```

Preconditions:

```text
Saved workspace exists.
Saved workspace is not archived.
Saved workspace has one or more tab records.
Saved tab records have URLs.
Projection is not already verified as hydrated unless operator chooses reverify/focus.
Operator approved the plan.
```

Expected effects:

```text
Browser projection is created or verified.
Session DB projection state may become hydrated only after verification.
Runtime evidence is recorded.
Timeline and diagnostics record the result.
```

Forbidden behavior:

```text
Do not recreate tabs from incomplete saved state.
Do not infer missing URLs.
Do not silently reuse unrelated open tabs by URL alone.
Do not mark projection hydrated before verification.
```

### projection.dehydrate_active_workspace

Purpose: Save or update durable Session DB projection evidence for the active runtime workspace.

Authority class: runtime_projection_action.

Implementation status:

```text
not_implemented
```

Required confirmation: yes when browser projection cleanup is included. Contextual when only snapshotting state.

Minimum inputs:

```json
{
  "workspaceId": "uuid",
  "snapshotRuntimeState": true,
  "closeProjectionAfterSave": false,
  "preserveBrowserTabs": true
}
```

Preconditions:

```text
Active runtime workspace exists.
Active runtime source is chrome.storage.local or explicitly transitioned.
Runtime tab records can be mapped to workspaceTabId values.
Operator approved any browser cleanup behavior.
```

Expected effects:

```text
Session DB receives updated workspace/session/projection evidence.
Projection may become dehydrated after verification.
Browser tabs remain open unless the operator approved cleanup.
```

Forbidden behavior:

```text
Do not close browser tabs as a hidden side effect.
Do not clear active workspace records without a recovery path.
Do not treat stale Chrome tab ids as durable identity.
```

### projection.switch_workspace

Purpose: Move from one workspace projection to another through an explicit plan.

Authority class: high_impact_projection_action.

Implementation status:

```text
not_implemented
```

Required confirmation: yes.

This command must be decomposed into reviewable subcommands:

```text
1. preview_dehydrate_plan for current workspace
2. optional dehydrate_active_workspace
3. preview_resume_plan for target workspace
4. optional resume_workspace
5. verification packet
```

Forbidden behavior:

```text
Do not combine dehydrate and resume into an opaque one-click action until each subcommand is independently validated.
Do not discard current runtime state before target resume has a validated plan.
```

## 12. Confirmation Requirements

Runtime projection actions require a visible Operator review packet before execution.

The review packet must include:

```text
workspace name
workspace id
action name
saved tab count
missing URL count
estimated tabs to open or verify
estimated windows to create or use
whether Chrome groups will be created
whether active runtime state will change
whether Session DB state will change
whether chrome.storage.local state will change
risk summary
cancel option
```

The Operator must be able to approve or cancel the command before browser state changes.

## 13. Verification Requirements

Runtime projection actions are not complete until verified.

Verification checks may include:

```text
created/open tab count matches expected count
workspaceTabId values are represented in runtime evidence
created/open windows match target mode
created/open groups match role grouping plan
projectionState updated only after verification
no unrelated browser tabs were affected
diagnostics event recorded
timeline event recorded
```

Verification status values:

```text
passed
warn
failed
```

A warning may allow the Operator to inspect or repair. A failed verification must not silently mark the command successful.

## 14. Safety Boundary for This Slice

This branch must not implement live runtime projection commands.

This branch may:

```text
add documentation
define command envelopes
define command names
define preconditions
define expected evidence
define validation requirements
```

This branch must not:

```text
open browser tabs
close browser tabs
move browser tabs
create browser windows
close browser windows
create or remove Chrome groups
change chrome.storage.local runtime authority
mark Session DB as active runtime source of truth
implement pause/dehydrate execution
implement resume/rehydrate execution
```

## 15. Next Implementation Slice Options

After this command envelope is reviewed, the next safest implementation slice is:

```text
projection.preview_resume_plan
```

That slice should generate a dry-run resume plan for the validated `Layer 2 Rehydration Candidate Test` workspace.

It should not open tabs or create windows.

Only after preview planning passes should Chrome Flow move toward an explicitly confirmed resume action.
