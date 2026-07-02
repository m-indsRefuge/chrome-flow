# Projection Resume Execution Contract

## Purpose

This document defines the contract for the first future live browser-action slice in Chrome Flow Layer 2.

It corresponds to the future command-envelope command:

```text
projection.resume_workspace
```

This is a contract and implementation boundary document only. It does not implement live browser execution.

The purpose is to prevent Chrome Flow from moving from preflight validation to live browser mutation without a tightly scoped execution rulebook.

## Branch

```text
layer2-resume-execution-contract
```

## Current Control Ladder

Chrome Flow has now completed the non-executing runtime projection control ladder:

```text
Runtime Projection Readiness
-> Projection Plan Preview
-> Projection Confirmation Packet
-> Projection Resume Preflight
```

The next implementation slice may become the first live browser-action prototype, but only if it follows this contract.

## Authority Boundary

The first resume execution prototype must preserve the current Layer 2 authority boundary:

```text
Active runtime source: chrome.storage.local
Persistence source: Session DB
Session DB runtime authority: false
```

The execution prototype may create a live Chrome browser projection from saved Session DB state, but it must not make Session DB the active runtime source of truth.

Chrome runtime ids created during execution are evidence, not durable identity.

## Execution Prototype Scope

The first execution prototype must be intentionally narrow.

Allowed scope:

```text
One saved workspace target
One execution command
New Chrome window target only
Create tabs from saved workspace tab URLs
Optionally create Chrome tab groups after tabs exist
Focus the created window after successful creation
Record diagnostics
Produce execution packet
Produce post-action verification packet
```

Required target workspace for initial validation:

```text
Layer 2 Rehydration Candidate Test
```

Expected saved workspace characteristics:

```text
workspaceId: c22b5a00-c68d-4b64-8bba-01172a0dd818
savedTabCount: 3
missingUrlCount: 0
plannedTabCreates: 3
plannedGroupCreates: 3
projectionStateBefore: dehydrated
```

## Explicitly Out of Scope

The first execution prototype must not:

```text
close existing tabs
close existing windows
move existing tabs
reuse unrelated existing tabs by URL alone
modify the active current window
switch between workspaces
deactivate or dehydrate the current runtime workspace
clear active workspace state
mark Session DB as runtime authority
perform current_window execution
perform dedicated_window execution
support arbitrary saved workspaces without validation
combine resume with pause/dehydrate
silently execute from a plan or preflight packet
```

## Required Prior Evidence

Execution may only be offered after a valid preflight packet exists.

Required preflight evidence:

```text
packetType: Chrome Flow Projection Resume Preflight Packet
schema: projection-resume-preflight-packet-v0.1
preflight.status: pass
preflight.readyForFutureExecutionPrototype: true
preflight.executionAvailableInThisSlice: false
confirmationInput.decisionState: pending_operator_decision
confirmationInput.confirmationStatus: pending_operator_decision
preflightPlan.previewStatus: ready
preflightPlan.savedTabCount > 0
preflightPlan.missingUrlCount: 0
preflightPlan.plannedTabCreates length equals savedTabCount
preflightPlan.plannedTabCreates all canCreate: true
source.runtimeActionExecuted: false
source.browserProjectionChanged: false
source.sessionDbChanged: false
source.chromeStorageRuntimeChanged: false
```

A cancelled, blocked, warned, stale, or missing preflight packet must block execution.

## Operator Confirmation Requirement

The execution prototype must require an explicit second-stage Operator confirmation inside the execution slice.

Preflight approval is not enough.

The execution UI must make the following visible before action:

```text
Workspace name
Workspace id
Saved tab count
Target mode: new_window only
Number of tabs that will be opened
Number of Chrome groups that may be created
Whether the created window will be focused
Whether existing tabs/windows will be touched
Whether Session DB authority will change
Whether chrome.storage.local runtime authority will change
Cancel option
```

Required confirmation text:

```text
I understand Chrome Flow will open a new browser window and create tabs from this saved workspace.
```

The prototype may use a checkbox, typed confirmation, or explicit confirmation button, but it must not execute from a generic click alone.

## Command Envelope

The future execution packet must use this command envelope shape:

```json
{
  "commandId": "uuid",
  "commandName": "projection.resume_workspace",
  "authorityClass": "runtime_projection_action",
  "requestedBy": "operator",
  "requiresConfirmation": true,
  "confirmationState": "approved",
  "workspaceId": "uuid",
  "sessionId": "uuid|null",
  "projectionId": "uuid|null",
  "sourceState": {
    "runtimeSource": "mixed",
    "savedWorkspaceExists": true,
    "sessionDbRuntimeSourceOfTruth": false,
    "chromeStorageRuntimeAuthorityPreserved": true,
    "runtimeSelectionReviewOnly": true
  },
  "inputs": {
    "workspaceId": "uuid",
    "targetMode": "new_window",
    "includeChromeGroups": true,
    "focusAfterResume": true,
    "operatorConfirmed": true
  },
  "preconditions": [],
  "expectedEffects": [],
  "operatorReview": {},
  "execution": {},
  "verification": {}
}
```

## Execution Algorithm

The first execution prototype must follow this sequence:

```text
1. Read selected saved workspace from Session DB.
2. Rebuild or read the latest valid preflight context.
3. Verify preflight still passes.
4. Present execution review to Operator.
5. Require explicit Operator confirmation.
6. Create one new Chrome window.
7. Open saved tab URLs in that new window.
8. Capture created runtime window id.
9. Capture created runtime tab ids.
10. Optionally create Chrome groups by saved tab role.
11. Capture created runtime group ids.
12. Focus created window if requested.
13. Run post-action verification.
14. Record diagnostics.
15. Produce execution result packet.
```

The prototype must stop immediately if any required step fails.

## Browser Action Limits

Allowed Chrome API effects:

```text
create one new Chrome window
create tabs in that new window from saved URLs
create Chrome tab groups only for created tabs
set group titles from saved roles
focus the created window if requested
```

Forbidden Chrome API effects:

```text
close tabs
close windows
move existing tabs
modify unrelated existing tabs
ungroup existing groups
reuse unrelated existing tabs by URL alone
change the current active runtime workspace automatically
```

## Session DB Write Limits

The first execution prototype should prefer execution-result evidence over authority mutation.

Allowed Session DB writes:

```text
execution diagnostic evidence
runtime projection attempt record if repository support exists
post-action verification evidence if repository support exists
```

Forbidden Session DB writes:

```text
Do not mark Session DB as runtime source of truth.
Do not mark projection hydrated before verification.
Do not overwrite saved workspace tab records.
Do not delete saved sessions.
Do not delete saved projections.
```

If repository support for safe projection-result writes is not ready, the prototype may record the result only in diagnostics and packet output.

## Chrome Storage Runtime Limits

The first execution prototype must not silently replace the current active `chrome.storage.local` workspace.

Allowed:

```text
read current active runtime workspace for review evidence
record diagnostics
```

Forbidden:

```text
Do not call setWorkspace with the resumed workspace as active runtime.
Do not clear the current active runtime workspace.
Do not rewrite active workspace tabs from the resumed projection.
```

Later slices may define a deliberate runtime handoff, but this prototype must not do that.

## Post-Action Verification Requirements

Execution is not successful until verification passes.

Required verification checks:

```text
createdWindowId exists
createdTabIds count equals savedTabCount
created tabs are in the created window
created tab URLs correspond to planned saved URLs
created group ids count equals plannedGroupCreates count when grouping enabled
created groups only contain tabs created by this command
no unrelated existing tabs were moved or closed
no existing windows were closed
chrome.storage.local runtime authority remains unchanged
Session DB runtime authority remains false
execution diagnostic was recorded
```

Verification status values:

```text
passed
warn
failed
```

Success may only be reported when required verification checks pass.

## Execution Packet

The future execution result packet must include:

```text
packetType: Chrome Flow Projection Resume Execution Packet
schema: projection-resume-execution-packet-v0.1
commandId
workspaceId
workspaceName
sessionId
projectionId
targetMode
operatorConfirmed
preflightStatusBeforeExecution
savedTabCount
plannedTabCreates
plannedGroupCreates
createdWindowId
createdTabIds
createdGroupIds
runtimeActionExecuted
browserProjectionChanged
sessionDbChanged
chromeStorageRuntimeChanged
projectionStateBefore
projectionStateAfter
verificationStatus
verificationChecks
blockingErrors
warningReasons
```

## Result Statuses

Execution may resolve to:

```text
blocked_before_execution
cancelled_by_operator
running
executed_pending_verification
success
warn
failed
```

Rules:

```text
blocked_before_execution: preflight or confirmation failed before action.
cancelled_by_operator: Operator declined execution before action.
running: execution is in progress.
executed_pending_verification: browser action occurred but verification has not completed.
success: browser action occurred and verification passed.
warn: browser action occurred but non-critical verification warnings remain.
failed: execution or verification failed.
```

## Recovery and Failure Handling

The first prototype must be honest about partial failure.

If a window is created but tab creation partly fails, the packet must report:

```text
createdWindowId
createdTabIds
failedTabCreates
verificationStatus: failed or warn
```

The prototype must not attempt automatic cleanup in the first execution slice unless explicitly defined in a later recovery contract.

No automatic tab/window closing should occur as a hidden recovery side effect.

## Required Diagnostics

The future implementation should record diagnostic actions such as:

```text
projection_resume_execution_reviewed
projection_resume_execution_cancelled
projection_resume_execution_started
projection_resume_execution_window_created
projection_resume_execution_tabs_created
projection_resume_execution_groups_created
projection_resume_execution_verified
projection_resume_execution_failed
projection_resume_execution_packet_copied
```

Each diagnostic should include:

```text
commandId
workspaceId
workspaceName
createdWindowId when available
createdTabCount when available
createdGroupCount when available
status
error when available
```

## Validation Plan for Future Execution Prototype

Required positive validation:

```text
Workspace: Layer 2 Rehydration Candidate Test
Target mode: new_window
Decision state: pending_operator_decision
Preflight: pass
Operator confirmation: approved
Expected created window count: 1
Expected created tab count: 3
Expected created group count: 3
Verification status: passed
```

Required negative validation:

```text
Cancelled confirmation -> execution blocked before browser action.
Zero-tab workspace -> execution blocked before browser action.
Missing URL tab -> execution blocked before browser action.
Unchecked operator confirmation -> execution blocked before browser action.
```

Required safety validation:

```text
Existing tabs remain open.
Existing windows remain open.
Current runtime workspace is not overwritten.
Session DB is not made runtime authority.
Projection is not marked hydrated before verification.
```

## Merge Gate for Execution Implementation

The future execution implementation must not be merged unless all of the following are true:

```text
Operator explicitly confirms execution.
Only one new window is created.
Only saved workspace URLs are opened.
Created tab count matches expected count.
Created group count matches expected count when group creation is enabled.
No unrelated tabs/windows are affected.
Post-action verification packet is produced.
Diagnostics record execution and verification.
No Session DB runtime authority switch occurs.
No active chrome.storage.local workspace replacement occurs.
```

## Next Slice Recommendation

After this contract is reviewed, the safest next implementation slice is:

```text
projection.resume_execution_review_surface
```

That slice should add the execution review UI and confirmation gate, but still may stop before performing browser action if we want one more separation layer.

If implemented as a live prototype directly, it must remain limited to:

```text
Layer 2 Rehydration Candidate Test
new_window target mode only
explicit Operator confirmation
no existing-tab modification
post-action verification required
```
