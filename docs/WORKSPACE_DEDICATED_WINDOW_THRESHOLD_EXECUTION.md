# Workspace Dedicated Window Threshold Execution

## Purpose

This slice adds the first live execution layer for the dedicated/new-window threshold path.

It corresponds to:

```text
projection.workspace_dedicated_window_threshold_execution
```

This is a live browser-action slice, but it remains gated by deterministic checks and explicit Operator confirmation.

## Relationship To Earlier Layers

```text
Policy -> classify whether 4+ tab dedicated-window policy is active.
Preflight -> prove the workspace is structurally ready.
Review -> prove Operator has reviewed the path.
Execution -> perform the controlled browser action only after the gate passes.
```

## Product Rule

```text
0-3 tabs = current-window workspace can remain valid
4+ tabs = dedicated/new-window workspace policy activates
```

## Updated Files

```text
src/sidepanel/workspace-dedicated-window-threshold-execution.js
src/sidepanel/workspace-dedicated-window-threshold-execution-validation-suite.js
src/sidepanel/workspace-dedicated-window-threshold-policy.js
```

The execution and execution validation suite are loaded by the threshold policy module.

## Surface

The sidepanel adds:

```text
Dedicated Window Threshold Execution
Dedicated Window Threshold Execution Validation Suite
```

Controls:

```text
Prepare Threshold Execution Gate Packet
Run Dedicated Window Move
Copy Latest Threshold Execution Packet
Run Threshold Execution Validation Suite
Copy Threshold Execution Validation Suite Packet
```

## Required Execution Phrase

```text
MOVE WORKSPACE TO DEDICATED WINDOW
```

## Execution Behavior

When the gate passes and the Operator runs the action, this slice:

```text
reads active runtime workspace from chrome.storage.local
requires 4+ active workspace tabs
requires live tab IDs
requires URLs
requires assigned roles
requires planned role groups
requires execution phrase
requires acknowledgement
creates one new Chrome window from the first workspace-owned tab
moves remaining workspace-owned tabs into that new window
creates Chrome tab groups from active workspace role evidence
focuses the dedicated window
captures before/after browser snapshots
produces an execution packet
runs built-in verification checks
```

## Explicit Non-Goals

This slice must not:

```text
move unrelated tabs
close unrelated tabs
close unrelated windows
write Session DB
replace chrome.storage.local active workspace
perform autonomous cleanup
run without Operator confirmation
```

## Execution Gate Packet

```text
Chrome Flow Dedicated Window Threshold Execution Gate Packet
dedicated-window-threshold-execution-gate-packet-v0.1
```

Expected ready gate:

```text
executionGate.status: ready_for_live_threshold_execution
executionGate.readyForLiveAction: true
source.runButtonShouldBeEnabled: true
source.runtimeActionExecuted: false
source.browserProjectionChanged: false
source.sessionDbChanged: false
source.chromeStorageRuntimeChanged: false
```

## Execution Packet

```text
Chrome Flow Dedicated Window Threshold Execution Packet
dedicated-window-threshold-execution-packet-v0.1
```

Expected successful execution:

```text
execution.status: completed_verified
source.runtimeActionExecuted: true
source.browserProjectionChanged: true
source.sessionDbChanged: false
source.chromeStorageRuntimeChanged: false
source.existingTabsOrWindowsClosed: false
source.unrelatedTabsMoved: false
verification.status: verified
```

## Programmatic Execution Validation Suite

The suite validates execution gate logic only. It does not perform live browser action.

```text
no confirmation blocks
phrase only blocks
acknowledgement only blocks
full confirmation enables live action
small workspace confirmed still blocks
missing role confirmed blocks
missing URL confirmed blocks
missing live tab ID confirmed blocks
boundary flags remain false
```

Expected suite result:

```text
packetType: Chrome Flow Dedicated Window Threshold Execution Validation Suite Packet
extension.schema: dedicated-window-threshold-execution-validation-suite-packet-v0.1
suite.overallStatus: pass
suite.failedScenarioCount: 0
source.validationOnly: true
source.executionGateValidation: true
source.operatorManualFixtureRequired: false
source.runtimeActionExecuted: false
source.browserProjectionChanged: false
source.sessionDbChanged: false
source.chromeStorageRuntimeChanged: false
```

## Manual Live Validation Requirement

Programmatic validation verifies the gate logic.

The actual browser side effect still requires controlled Operator validation because it changes live Chrome window/tab state.

Minimum live validation:

```text
1. Create or activate a 4+ tab workspace with URLs and assigned roles.
2. Run Threshold Execution Validation Suite first.
3. Confirm suite passes.
4. Type required execution phrase.
5. Check acknowledgement.
6. Prepare Threshold Execution Gate Packet.
7. Confirm gate is ready.
8. Run Dedicated Window Move.
9. Copy Latest Threshold Execution Packet.
10. Verify new dedicated window, moved tabs, and groups visually.
```

## Merge Gate

Do not merge if:

```text
execution validation suite fails
run button enables without phrase and acknowledgement
run button enables below 4 tabs
run button enables when any workspace tab lacks live tab ID
run button enables when any workspace tab lacks URL
run button enables when any workspace tab lacks role
live execution packet omits before/after snapshots
live execution packet omits verification
live execution writes Session DB
live execution replaces chrome.storage.local active workspace
live execution moves unrelated tabs
```
