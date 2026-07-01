# Projection Resume Preflight Validation

## Purpose

This slice implements the final read-only checkpoint before any future runtime projection execution prototype.

It corresponds to the command-envelope command:

```text
projection.resume_preflight_validation
```

The purpose is to validate that a pending resume confirmation remains safe immediately before future execution.

This is still not an execution slice.

## Branch

```text
layer2-resume-preflight-check
```

## Added Files

```text
src/sidepanel/projection-resume-preflight.js
docs/PROJECTION_RESUME_PREFLIGHT_VALIDATION.md
```

Updated file:

```text
src/sidepanel/sidepanel.html
```

## Added Surface

```text
Projection Resume Preflight
```

Controls:

```text
Refresh Preflight Workspaces
Run Resume Preflight
Copy Preflight Packet
```

Packet schema:

```text
projection-resume-preflight-packet-v0.1
```

## Scope

This slice may:

```text
read saved Session DB workspace records
read saved workspace tab records
read saved session and projection records
read the active runtime workspace id for comparison
rebuild the preview/confirmation context
validate pending confirmation state
produce pass/warn/blocked preflight checks
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

## Expected Pass Case

For the validated workspace:

```text
Layer 2 Rehydration Candidate Test
```

With decision state:

```text
pending_operator_decision
```

Expected result:

```text
preflight.status: pass
preflight.readyForFutureExecutionPrototype: true
preflight.executionAvailableInThisSlice: false
preflightPlan.previewStatus: ready
preflightPlan.savedTabCount: 3
preflightPlan.missingUrlCount: 0
preflightPlan.plannedTabCreates: 3
preflightPlan.plannedGroupCreates: 3
confirmationInput.decisionState: pending_operator_decision
confirmationInput.confirmationStatus: pending_operator_decision
source.preflightOnly: true
source.runtimeActionExecuted: false
source.browserProjectionChanged: false
source.sessionDbChanged: false
source.chromeStorageRuntimeChanged: false
```

The preflight may include runtime selection review evidence. Runtime/browser selection mismatch is informational unless a future execution slice makes it authoritative.

## Expected Cancelled Case

For the same validated workspace, with decision state:

```text
cancelled_by_operator
```

Expected result:

```text
preflight.status: blocked
confirmationInput.decisionState: cancelled_by_operator
confirmationInput.confirmationStatus: cancelled
preflight.blockedReasons includes: Operator decision is pending, not cancelled or blocked.
preflight.executionAvailableInThisSlice: false
```

Cancelled confirmations must not advance toward future execution.

## Expected Blocked Workspace Case

For the older validation workspace:

```text
V0 Consolidation Validation
```

Expected result:

```text
preflight.status: blocked
preflightPlan.previewStatus: blocked
preflightPlan.savedTabCount: 0
confirmationInput.confirmationStatus: blocked
preflight.blockedReasons includes: Saved workspace has tab records.
preflight.executionAvailableInThisSlice: false
```

This proves that a zero-tab saved workspace cannot pass preflight.

## Pass Criteria

The slice passes when:

```text
Projection Resume Preflight appears in the side panel.
The validated test workspace with pending decision produces a pass preflight packet.
The cancelled decision state produces a blocked preflight packet.
The zero-tab workspace produces a blocked preflight packet.
The packet confirms no browser/session/runtime mutation occurred.
The packet preserves the runtime authority boundary.
Diagnostics record refresh, run, and copy actions.
```

## Failure Conditions

Block merge if:

```text
The side panel fails to load.
The preflight surface opens or changes browser tabs.
The preflight surface creates windows or Chrome groups.
The preflight surface changes Session DB state.
The preflight surface marks projections hydrated.
The preflight surface exposes a real execute/approve action.
A cancelled decision state passes preflight.
The zero-tab workspace passes preflight.
The ready pending workspace is blocked by non-authoritative runtime-selection context.
```

## Next Slice After This

After this preflight validation passes, Chrome Flow will have completed the non-executing control ladder:

```text
readiness -> preview plan -> confirmation packet -> preflight validation
```

The next possible slice may be a minimal explicitly confirmed execution prototype.

Recommended next slice:

```text
projection.resume_execution_prototype
```

That slice should be extremely narrow, likely limited to a safe test workspace and a new-window target mode, with explicit Operator approval and post-action verification.
