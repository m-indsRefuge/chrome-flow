# Projection Plan Preview

## Purpose

This slice implements the first dry-run planning surface for future Layer 2 runtime projection controls.

It corresponds to the command-envelope command:

```text
projection.preview_resume_plan
```

The purpose is to generate a reviewable resume plan for a saved Session DB workspace without executing any live browser projection behavior.

## Branch

```text
layer2-projection-plan-preview
```

## Added Files

```text
src/sidepanel/projection-plan-preview.js
docs/PROJECTION_PLAN_PREVIEW.md
```

Updated file:

```text
src/sidepanel/sidepanel.html
```

## Added Surface

```text
Projection Plan Preview
```

Controls:

```text
Refresh Plan Workspaces
Preview Resume Plan
Copy Resume Plan Packet
```

Packet schema:

```text
projection-resume-plan-packet-v0.1
```

## Scope

This slice may:

```text
read saved Session DB workspace records
read saved workspace tab records
read saved session and projection records
read the current active runtime workspace id for comparison
compute a dry-run future resume plan
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
```

## Expected Plan for Current Test Workspace

For the validated workspace:

```text
Layer 2 Rehydration Candidate Test
```

Expected result:

```text
plan.status: ready
workspaceId: c22b5a00-c68d-4b64-8bba-01172a0dd818
savedTabCount: 3
missingUrlCount: 0
plannedTabCreates: 3
plannedGroupCreates: 3
requiresConfirmationForFutureExecution: true
source.planOnly: true
source.runtimeActionExecuted: false
source.browserProjectionChanged: false
source.sessionDbChanged: false
source.chromeStorageRuntimeChanged: false
```

The target mode may be:

```text
new_window
```

because the current dedicated-window threshold is 4 and the test workspace has 3 saved tab records.

## Expected Blocked Case

For the older validation workspace:

```text
V0 Consolidation Validation
```

Expected result:

```text
plan.status: blocked
savedTabCount: 0
blockedReasons includes: Saved workspace has no tab records to plan.
```

This is an expected negative case.

## Pass Criteria

The slice passes when:

```text
Projection Plan Preview appears in the side panel.
The validated test workspace produces a ready plan.
The plan includes three planned tab creates.
The plan includes role-based group creates when group planning is enabled.
The packet confirms no browser/session/runtime mutation occurred.
The blocked zero-tab workspace remains blocked.
Diagnostics record preview and packet-copy actions.
```

## Failure Conditions

Block merge if:

```text
The side panel fails to load.
The preview opens or changes browser tabs.
The preview creates windows or Chrome groups.
The preview changes Session DB state.
The preview marks projections hydrated.
The validated test workspace does not produce a ready plan.
The zero-tab workspace does not produce a blocked plan.
```

## Next Slice After This

After this preview planner passes, the next possible slice is a confirmation packet for future execution, still without performing live browser projection behavior.

Recommended next slice:

```text
projection.resume_confirmation_packet
```

That slice should transform a ready preview plan into an Operator review packet with explicit approve/cancel semantics, but should still not open tabs or create windows.
