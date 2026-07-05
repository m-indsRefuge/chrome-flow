# Workspace Dedicated Window Threshold Validation Suite

## Purpose

This slice adds a programmatic validation suite for the dedicated-window threshold policy.

It corresponds to:

```text
projection.workspace_dedicated_window_threshold_validation_suite
```

The suite prevents the Operator from needing to manually validate separate 0-3 tab and 4+ tab policy cases.

## Updated Files

```text
src/sidepanel/workspace-dedicated-window-threshold-validation-suite.js
src/sidepanel/workspace-dedicated-window-threshold-policy.js
```

The validation suite is loaded by the threshold policy module.

## Surface

The sidepanel adds:

```text
Dedicated Window Threshold Validation Suite
```

Controls:

```text
Run Threshold Validation Suite
Copy Threshold Validation Suite Packet
```

## Packet Schema

```text
dedicated-window-threshold-validation-suite-packet-v0.1
```

## Programmatic Scenarios

The suite validates:

```text
active_workspace_policy_packet_builds
zero_tab_policy_classifies_as_intake
one_tab_policy_classifies_as_current_window_valid
three_tab_policy_classifies_as_current_window_valid
four_tab_policy_activates_dedicated_window
five_tab_policy_activates_dedicated_window
active_workspace_threshold_matches_tab_count
validation_suite_boundary_preserved
```

## Simulated Policy Matrix

The suite simulates:

```text
0 tabs -> no_workspace_tabs_detected
1 tab -> current_window_valid
3 tabs -> current_window_valid
4 tabs -> dedicated_window_policy_active
5 tabs -> dedicated_window_policy_active
```

It also validates the active runtime workspace policy result.

## Required Boundary

```text
source.readOnly: true
source.validationOnly: true
source.thresholdPolicyValidation: true
source.runtimeActionExecuted: false
source.browserProjectionChanged: false
source.sessionDbChanged: false
source.chromeStorageRuntimeChanged: false
```

## Expected Pass Result

```text
packetType: Chrome Flow Dedicated Window Threshold Validation Suite Packet
extension.schema: dedicated-window-threshold-validation-suite-packet-v0.1
suite.overallStatus: pass
suite.failedScenarioCount: 0
source.runtimeActionExecuted: false
source.browserProjectionChanged: false
source.sessionDbChanged: false
source.chromeStorageRuntimeChanged: false
```

If the active runtime workspace has 4+ tabs:

```text
activeRuntimePolicy.policy.status: dedicated_window_policy_active
nextDecision.recommendation: ready_for_threshold_preflight_slice
```

If the active runtime workspace has 0-3 tabs:

```text
nextDecision.recommendation: policy_valid_current_workspace_below_threshold
```

## Corrected Validation Workflow

The Operator should no longer need to run two manual threshold packets for each validation cycle.

Use:

```text
Run Threshold Validation Suite
Copy Threshold Validation Suite Packet
```

Then inspect the single suite packet.

## Merge Gate

Do not merge if:

```text
validation suite surface fails to load
validation suite packet cannot be copied
0-tab simulated case fails
1-tab simulated case fails
3-tab simulated case fails
4-tab simulated case fails
5-tab simulated case fails
validation suite performs browser action
validation suite writes Session DB
validation suite replaces chrome.storage.local active workspace
```
