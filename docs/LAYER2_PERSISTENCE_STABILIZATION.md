# Layer 2 Persistence Stabilization

## Purpose

This slice stabilizes the merged Session DB v0 foundation by adding a read-only validation surface for the saved-workspace registry and persistence boundary.

The goal is to verify that Layer 2 persistence remains internally consistent after smoke-test cleanup and imported-workspace inspection, without changing browser runtime behavior.

## Branch

```text
saved-workspace-registry-stabilization
```

## Added Surface

```text
Layer 2 Persistence Validation
```

Controls:

```text
Validate Layer 2 Persistence
Copy Layer 2 Validation Packet
```

Source file:

```text
src/sidepanel/layer2-persistence-validation.js
```

## Validation Packet

Packet type:

```text
Chrome Flow Layer 2 Persistence Validation Packet
```

Schema:

```text
layer2-persistence-validation-packet-v0.1
```

Clipboard envelope:

```text
CHROME_FLOW_PACKET_START
...
CHROME_FLOW_PACKET_END
```

## What It Checks

The validation packet checks:

```text
Session DB schema readiness
missing object stores
saved workspace count
workspace tab count
session count
projection count
journal entry count
timeline event count
summary-card count
constellation count
smoke-test cleanup state
imported snapshot availability
hydrated/dehydrated projection state
active DB workspace reference validity
legacy runtime authority preservation
chrome.storage.local active workspace state
```

## Safety Boundary

This validation is read-only.

It must not:

```text
open browser tabs
close browser tabs
create browser windows
close browser windows
rehydrate saved workspaces
change active workspace runtime source
mark Session DB as runtime source of truth
```

It may:

```text
read Session DB records
read the current chrome.storage.local active workspace
compute consistency checks
render a validation report
copy a validation packet
record validation diagnostics
```

## Expected Post-Cleanup State

After the previous cleanup slice, the expected local validation state is:

```text
Session DB status: ready
Missing stores: 0
Smoke-test workspace count: 0
Saved workspace count: 1
Imported snapshot count: 1
Hydrated projection count: 0
Runtime source: chrome.storage.local
Session DB runtime source of truth: false
```

The active chrome.storage.local workspace may differ from the selected/imported Session DB workspace. This is expected until Session DB becomes the runtime authority.

## Pass Criteria

A clean stabilization pass should report:

```text
validation.status: PASS
session_db_schema_ready: passed
smoke_test_records_removed: passed
active_db_workspace_reference_valid: passed
runtime_authority_preserved: passed
legacy_runtime_source_preserved: passed
no_hydrated_projections: passed
saved_workspace_records_complete: passed
saved_workspace_registry_nonempty: passed
imported_snapshot_available: passed
```

Warnings may be acceptable during active development, but failures should block merge.

## Next Slice Options

After validation passes, the project can choose one of two paths:

```text
1. Merge this stabilization branch back to main.
2. Continue into runtime-control preparation: pause/dehydrate and resume/rehydrate design packet.
```
