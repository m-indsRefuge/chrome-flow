# Projection Confirmation Packet

## Purpose

This slice implements the first explicit Operator decision packet surface for future Layer 2 runtime projection controls.

It corresponds to the command-envelope command:

```text
projection.resume_confirmation_packet
```

The purpose is to transform a ready dry-run resume plan into a confirmation packet that the Operator can inspect before any future execution behavior exists.

This is still not an execution slice.

## Branch

```text
layer2-confirmation-packet
```

## Added Files

```text
src/sidepanel/projection-confirmation-packet.js
docs/PROJECTION_CONFIRMATION_PACKET.md
```

Updated file:

```text
src/sidepanel/sidepanel.html
```

## Added Surface

```text
Projection Confirmation Packet
```

Controls:

```text
Refresh Confirmation Workspaces
Prepare Confirmation Packet
Mark Packet Cancelled
Copy Confirmation Packet
```

Packet schema:

```text
projection-resume-confirmation-packet-v0.1
```

## Scope

This slice may:

```text
read saved Session DB workspace records
read saved workspace tab records
read saved session and projection records
read the active runtime workspace id for comparison
compute a confirmation packet from a ready preview plan
represent a pending Operator decision
represent a cancelled Operator decision
copy a bounded packet
record diagnostics
```

This slice must not:

```text
open browser tabs
close browser tabs
move browser tabs
create browser windows
close browser windows
create or remove Chrome groups
mark a projection as hydrated
change Session DB authority
change chrome.storage.local runtime authority
execute resume/dehydrate/switch behavior
create a real approval execution path
```

## Expected Pending Case

For the validated workspace:

```text
Layer 2 Rehydration Candidate Test
```

Expected result after `Prepare Confirmation Packet`:

```text
confirmation.status: pending_operator_decision
confirmation.decisionState: pending_operator_decision
confirmation.readyForOperatorDecision: true
confirmation.executionAvailableInThisSlice: false
confirmation.approveAvailable: false
confirmation.cancelAvailable: true
confirmation.willChangeBrowserStateIfExecutedLater: true
previewPlan.status: ready
previewPlan.savedTabCount: 3
previewPlan.missingUrlCount: 0
previewPlan.plannedTabCreates: 3
previewPlan.plannedGroupCreates: 3
source.confirmationOnly: true
source.runtimeActionExecuted: false
source.browserProjectionChanged: false
source.sessionDbChanged: false
source.chromeStorageRuntimeChanged: false
```

## Expected Cancelled Case

For the same validated workspace, after `Mark Packet Cancelled`:

```text
confirmation.status: cancelled
confirmation.decisionState: cancelled_by_operator
confirmation.readyForOperatorDecision: true
confirmation.executionAvailableInThisSlice: false
previewPlan.status: ready
```

This records a non-executing operator cancellation state.

## Expected Blocked Case

For the older validation workspace:

```text
V0 Consolidation Validation
```

Expected result:

```text
previewPlan.status: blocked
previewPlan.savedTabCount: 0
confirmation.status: blocked
confirmation.decisionState: blocked_no_decision_available
confirmation.readyForOperatorDecision: false
confirmation.executionAvailableInThisSlice: false
confirmation.blockedReasons includes: Saved workspace has no tab records to plan.
```

## Pass Criteria

The slice passes when:

```text
Projection Confirmation Packet appears in the side panel.
The validated test workspace produces a pending confirmation packet.
The pending packet carries the ready preview plan evidence.
The pending packet confirms execution is unavailable in this slice.
The cancelled path produces a cancelled confirmation packet without browser action.
The zero-tab workspace produces a blocked confirmation packet.
The packet confirms no browser/session/runtime mutation occurred.
Diagnostics record prepare, cancel, and copy actions.
```

## Failure Conditions

Block merge if:

```text
The side panel fails to load.
The confirmation surface opens or changes browser tabs.
The confirmation surface creates windows or Chrome groups.
The confirmation surface changes Session DB state.
The confirmation surface marks projections hydrated.
The confirmation surface exposes a real execute/approve action.
The ready workspace does not produce a pending confirmation packet.
The cancelled path does not preserve preview evidence.
The zero-tab workspace does not produce a blocked packet.
```

## Next Slice After This

After this confirmation packet passes, the next safe slice is not full execution yet.

Recommended next slice:

```text
projection.resume_preflight_validation
```

That slice should validate that a confirmation packet is still safe immediately before future execution. It should still not open tabs or create windows.

Only after preflight validation passes should Chrome Flow move toward a minimal explicitly confirmed execution prototype.
