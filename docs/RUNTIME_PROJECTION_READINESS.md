# Runtime Projection Readiness

## Purpose

This slice prepares Chrome Flow for future runtime projection controls without implementing those controls yet.

Runtime projection controls are the future Layer 2 actions that will eventually pause/dehydrate and resume/rehydrate workspace browser projections from durable Session DB state.

This slice is read-only. It validates preconditions, permission boundaries, and available saved workspace state before any live browser projection behavior is added.

## Branch

```text
layer2-runtime-projection-readiness
```

## Added Surface

```text
Runtime Projection Readiness
```

Controls:

```text
Validate Runtime Projection Readiness
Copy Projection Readiness Packet
```

Source file:

```text
src/sidepanel/runtime-projection-readiness.js
```

Packet schema:

```text
runtime-projection-readiness-packet-v0.1
```

## What It Checks

The readiness packet checks:

```text
active chrome.storage.local workspace identity
active runtime workspace tab count
active runtime workspace window/group evidence
saved Session DB workspace count
saved workspace tab-record availability
saved workspace projection state
saved workspace session state
saved workspace summary-card availability
whether any saved workspace could be rehydrated later
whether current active runtime workspace has enough tab state to be dehydrated later
future permission and evidence requirements
```

## Safety Boundary

This slice must not:

```text
open browser tabs
close browser tabs
move browser tabs
create browser windows
close browser windows
create or remove Chrome tab groups
mark Session DB as runtime authority
change active chrome.storage.local runtime state
implement pause/dehydrate
implement resume/rehydrate
```

This slice may:

```text
read chrome.storage.local active workspace state
read Session DB saved workspace state
compute readiness checks
render readiness output
copy a readiness packet
record diagnostics
```

## Expected Current Result

Given the current validation state, this slice may report `WARN` rather than `PASS` because the only imported saved workspace has zero saved tab records. That means it is valid for inspection but not yet a rehydration candidate.

Expected likely state:

```text
saved workspace count: 1
rehydrate candidate count: 0
active runtime tab count: 0
readiness.status: WARN
```

A warning is acceptable here. It means the readiness checker is correctly identifying missing preconditions before future projection controls are implemented.

## Future Implementation Rule

Future runtime projection actions must be:

```text
explicitly operator-confirmed
limited to workspace-owned records
based on stable workspaceTabId / runtime tab evidence
never based on URL match alone
recorded in diagnostics and timeline
verified after execution
reversible where practical
```

## Next Possible Slice

After readiness validation passes or produces expected warnings, the next implementation options are:

```text
1. Create a real saved workspace with tab records and import it into Session DB.
2. Re-run readiness validation against a rehydratable saved workspace.
3. Design pause/dehydrate command envelope and confirmation packet.
4. Only after that, implement the first controlled pause/dehydrate action.
```
