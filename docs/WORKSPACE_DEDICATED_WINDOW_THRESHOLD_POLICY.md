# Workspace Dedicated Window Threshold Policy

## Purpose

This slice begins the product-policy path for dedicated/new-window workspace projection.

It corresponds to:

```text
projection.workspace_dedicated_window_threshold_policy
```

This first slice is policy-only.

No live browser action is performed.

## Product Rule

```text
0-3 tabs = current-window workspace can remain valid
4+ tabs = dedicated/new-window workspace policy activates
```

This rule preserves the distinction established in the storage/memory contract:

```text
3-tab fixture = minimal technical fixture, not product limit
4+ tabs = product-policy path for organisational integrity
```

## Updated Files

```text
src/sidepanel/workspace-dedicated-window-threshold-policy.js
src/sidepanel/sidepanel.html
```

## Surface

The sidepanel adds:

```text
Dedicated Window Threshold Policy
```

Controls:

```text
Prepare Threshold Policy Packet
Copy Threshold Policy Packet
```

## Packet Schema

```text
dedicated-window-threshold-policy-packet-v0.1
```

## Packet Sections

```text
source
workspace
thresholdPolicy
tabStatus
policy
```

## Policy Classification

The policy classifies the active runtime workspace from `chrome.storage.local` runtime workspace state.

### Empty or uninitialized workspace

```text
tab count: 0
status: no_workspace_tabs_detected
recommendedAction: continue_workspace_intake
dedicatedWindowPolicyActive: false
currentWindowStillValid: true
```

### Small workspace

```text
tab count: 1-3
status: current_window_valid
classification: small_workspace
recommendedAction: remain_in_current_window
dedicatedWindowPolicyActive: false
currentWindowStillValid: true
```

### Dedicated-window threshold reached

```text
tab count: 4+
status: dedicated_window_policy_active
classification: dedicated_window_recommended
recommendedAction: prepare_dedicated_window_projection
dedicatedWindowPolicyActive: true
currentWindowStillValid: false
```

## Authority Boundary

Required packet flags:

```text
source.readOnly: true
source.policyOnly: true
source.runtimeActionExecuted: false
source.browserProjectionChanged: false
source.sessionDbChanged: false
source.chromeStorageRuntimeChanged: false
```

## Expected 4+ Tab Policy Packet

For a 4-tab active workspace:

```text
packetType: Chrome Flow Dedicated Window Threshold Policy Packet
extension.schema: dedicated-window-threshold-policy-packet-v0.1
tabStatus.totalTabs: 4
policy.status: dedicated_window_policy_active
policy.classification: dedicated_window_recommended
policy.recommendedAction: prepare_dedicated_window_projection
policy.dedicatedWindowPolicyActive: true
policy.currentWindowStillValid: false
source.runtimeActionExecuted: false
source.browserProjectionChanged: false
source.sessionDbChanged: false
source.chromeStorageRuntimeChanged: false
```

## Expected 0-3 Tab Policy Packet

For a 1-3 tab active workspace:

```text
policy.status: current_window_valid
policy.classification: small_workspace
policy.recommendedAction: remain_in_current_window
policy.dedicatedWindowPolicyActive: false
policy.currentWindowStillValid: true
```

## Build Ladder From Here

After the policy packet validates:

```text
1. add dedicated-window threshold preflight packet
2. add programmatic threshold validation suite
3. add Operator review/confirmation gate
4. add live controlled dedicated-window projection for 4+ tab active workspace
5. add post-action verification
```

## Merge Gate

Do not merge if:

```text
policy surface fails to load
policy packet cannot be copied
4+ tab active workspace is not classified as dedicated_window_policy_active
0-3 tab active workspace is not classified as current_window_valid or no_workspace_tabs_detected
policy packet performs browser action
policy packet writes Session DB
policy packet replaces chrome.storage.local active workspace
```
