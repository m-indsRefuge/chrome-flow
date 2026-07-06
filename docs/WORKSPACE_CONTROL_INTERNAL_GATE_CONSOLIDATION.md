# Workspace Control Internal Gate Consolidation

## Purpose

This slice begins the internal consolidation of the Workspace Control Layer.

It corresponds to:

```text
projection.workspace_control_internal_gate_consolidation
```

## Reason

The threshold policy, preflight, review, execution, verification, packet, and validation surfaces have proven the browser-control ladder. They also created repeated logic across sidepanel modules.

This slice extracts the repeated deterministic gate helpers before migrating live surfaces onto them.

## First Consolidated Module

```text
src/core/workspace-control/workspace-control-gates.js
```

It provides shared helpers for:

```text
threshold constants
target mode constants
workspace tab status
threshold classification
planned role groups
workspace identity packet blocks
threshold policy packet blocks
check creation
failed check extraction
blocked reason extraction
packet clipboard block
packet envelope formatting
read-only boundary source blocks
validation assertions
validation scenarios
role label humanization
```

## Validation Surface

```text
src/sidepanel/workspace-control-internal-gate-consolidation-validation-suite.js
```

The suite validates the extracted helpers before live policy/preflight/review/execution surfaces migrate onto them.

## Loaded Through

```text
src/sidepanel/workspace-dedicated-window-threshold-policy.js
```

## Validation Scenarios

```text
threshold_classification_matches_existing_policy
tab_status_matches_existing_shape
planned_role_groups_preserve_projection_shape
check_failure_helpers_match_gate_behavior
packet_envelope_matches_existing_format
workspace_and_policy_blocks_preserve_packet_shape
read_only_boundary_source_preserved
consolidation_suite_does_not_change_runtime
```

## Boundary

This first consolidation pass is intentionally non-invasive.

It does not change live execution behavior.
It does not move browser tabs.
It does not create or remove native Chrome groups.
It does not write Session DB.
It does not replace active chrome.storage.local workspace state.

## Expected Packet

```text
packetType: Chrome Flow Workspace Control Gate Consolidation Validation Suite Packet
schema: workspace-control-gate-consolidation-validation-suite-packet-v0.1
suite.overallStatus: pass
suite.failedScenarioCount: 0
source.helperExtractionValidation: true
source.runtimeActionExecuted: false
source.browserProjectionChanged: false
source.sessionDbChanged: false
source.chromeStorageRuntimeChanged: false
source.liveBrowserActionExecuted: false
```

## Next Step After This Pass

After the helper extraction validates, migrate live surfaces incrementally rather than all at once.

Recommended order:

```text
policy surface uses shared threshold/tab/packet helpers
preflight surface uses shared threshold/tab/group/check helpers
review surface uses shared threshold/tab/group/check/confirmation helpers
execution surface uses shared threshold/tab/group/check/packet helpers
validation suites use shared scenario/assertion helpers
```

## Important Product Doctrine

Native Chrome tab groups remain the live browser projection mechanism for now.

Do not suppress native Chrome groups in the active projection path unless Chrome later exposes a safe API-level way to prevent saved-group/bookmarks-bar clutter without breaking projection.
