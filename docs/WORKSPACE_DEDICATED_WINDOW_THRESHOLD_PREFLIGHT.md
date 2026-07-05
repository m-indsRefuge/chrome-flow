# Workspace Dedicated Window Threshold Preflight

## Purpose

This slice adds the preflight packet surface for the dedicated/new-window threshold path.

It corresponds to:

```text
projection.workspace_dedicated_window_threshold_preflight
```

This slice does not execute browser actions.

## Relationship To Policy

The policy packet answers:

```text
Should the workspace move toward dedicated/new-window projection?
```

The preflight packet answers:

```text
Is the active runtime workspace ready to safely prepare that projection?
```

## Product Rule

```text
0-3 tabs = current-window workspace can remain valid
4+ tabs = dedicated/new-window workspace policy activates
```

## Updated Files

```text
src/sidepanel/workspace-dedicated-window-threshold-preflight.js
src/sidepanel/workspace-dedicated-window-threshold-policy.js
```

The preflight surface is loaded by the threshold policy module.

## Surface

The sidepanel adds:

```text
Dedicated Window Threshold Preflight
```

Controls:

```text
Prepare Threshold Preflight Packet
Copy Threshold Preflight Packet
```

## Packet Schema

```text
dedicated-window-threshold-preflight-packet-v0.1
```

## Packet Sections

```text
source
workspace
thresholdPolicy
tabStatus
browserPlan
preflight
```

## Preflight Readiness Requirements

For this first threshold preflight, readiness requires:

```text
active runtime workspace exists
4+ tabs
dedicated-window policy active
all active workspace tabs have URLs
all active workspace tabs have assigned roles
planned role groups exist
target mode is new_window
no runtime action executed
no browser projection changed
no Session DB write
no chrome.storage.local runtime replacement
```

## Expected Ready Result

For a 4+ tab active runtime workspace with URLs and roles:

```text
packetType: Chrome Flow Dedicated Window Threshold Preflight Packet
extension.schema: dedicated-window-threshold-preflight-packet-v0.1
preflight.status: ready_for_threshold_review
preflight.readyForNextSlice: true
preflight.availableInThisSlice: false
thresholdPolicy.dedicatedWindowPolicyActive: true
tabStatus.totalTabs: 4 or more
tabStatus.missingUrlCount: 0
tabStatus.unassignedTabs: 0
browserPlan.targetMode: new_window
browserPlan.expectedWindowCount: 1
source.runtimeActionExecuted: false
source.browserProjectionChanged: false
source.sessionDbChanged: false
source.chromeStorageRuntimeChanged: false
```

## Expected Blocked Result

For a 0-3 tab active runtime workspace:

```text
preflight.status: blocked_before_threshold_projection
preflight.readyForNextSlice: false
preflight.failedChecks includes dedicated_window_policy_active
preflight.failedChecks includes minimum_tab_threshold_met
source.runtimeActionExecuted: false
source.browserProjectionChanged: false
source.sessionDbChanged: false
source.chromeStorageRuntimeChanged: false
```

For a 4+ tab workspace with missing roles:

```text
preflight.failedChecks includes workspace_tabs_have_roles
```

For a 4+ tab workspace with missing URLs:

```text
preflight.failedChecks includes workspace_tabs_have_urls
```

## Boundary

The preflight packet is not a live action.

```text
source.readOnly: true
source.preflightOnly: true
source.runtimeActionExecuted: false
source.browserProjectionChanged: false
source.sessionDbChanged: false
source.chromeStorageRuntimeChanged: false
preflight.availableInThisSlice: false
```

## Next Slice

After this preflight validates, the next slice should be:

```text
projection.workspace_dedicated_window_threshold_preflight_validation_suite
```

The suite should programmatically validate:

```text
0 tabs blocks
1 tab blocks
3 tabs blocks
4 tabs with roles and URLs passes
4 tabs with missing role blocks
4 tabs with missing URL blocks
5 tabs with roles and URLs passes
boundary flags remain false
```

## Merge Gate

Do not merge if:

```text
preflight surface fails to load
preflight packet cannot be copied
0-3 tab workspace passes preflight
4+ tab workspace with missing URL passes preflight
4+ tab workspace with unassigned role passes preflight
preflight packet executes browser action
preflight packet writes Session DB
preflight packet replaces chrome.storage.local active workspace
```
