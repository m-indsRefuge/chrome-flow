# Workspace Dedicated Window Threshold Execution

## Purpose

This slice adds the first controlled live browser-action path for the dedicated/new-window threshold policy.

It corresponds to:

```text
projection.workspace_dedicated_window_threshold_execution
```

## Product Rule

```text
0-3 tabs = current-window workspace can remain valid
4+ tabs = dedicated/new-window workspace policy activates
```

## Execution Meaning

This execution path moves existing open workspace tabs into one dedicated Chrome window.

It does not create a duplicate copy of the workspace.

```text
move existing live workspace tabs
create/focus one dedicated Chrome window
recreate Chrome tab groups in the dedicated window
update active runtime workspace tab metadata and timeline evidence
```

## Important Storage Boundary

This live slice differs from policy/preflight/review packets.

Policy, preflight, review, and validation packets do not mutate browser or storage state.

Execution performs a live browser action and may update active runtime workspace metadata/timeline so the runtime record matches the browser state.

Allowed execution mutation:

```text
chrome.storage.local active workspace tab metadata update
chrome.storage.local active workspace timeline event
```

Still forbidden in this slice:

```text
Session DB writes
active workspace replacement
arbitrary workspace switching
closing unrelated tabs
moving unrelated tabs
automatic cleanup after partial failure
```

Expected execution source flags:

```text
runtimeActionExecuted: true
browserProjectionChanged: true
sessionDbChanged: false
chromeStorageRuntimeChanged: true
chromeStorageChangeScope: active_workspace_tab_metadata_and_timeline_only
chromeStorageActiveWorkspaceReplaced: false
existingTabsClosed: false
unrelatedTabsMoved: false
```

## Updated Files

```text
src/sidepanel/workspace-dedicated-window-threshold-execution.js
src/sidepanel/workspace-dedicated-window-threshold-execution-validation-suite.js
src/sidepanel/workspace-dedicated-window-threshold-policy.js
docs/WORKSPACE_DEDICATED_WINDOW_THRESHOLD_EXECUTION.md
```

The execution surfaces are loaded by the threshold policy module.

## Surface

The sidepanel adds:

```text
Dedicated Window Threshold Execution
Dedicated Window Threshold Execution Validation Suite
```

Controls:

```text
Prepare Threshold Execution Packet
Run Dedicated Window Move
Copy Threshold Execution Packet
Run Threshold Execution Validation Suite
Copy Threshold Execution Validation Suite Packet
```

## Required Execution Phrase

```text
MOVE WORKSPACE TO DEDICATED WINDOW
```

## Execution Gate Requirements

A live execution can only become available when:

```text
active runtime workspace exists
4+ workspace tab records exist
dedicated-window threshold policy is active
all workspace tabs have URLs
all workspace tabs have assigned roles
planned role groups exist
all workspace tab records resolve to live browser tabs
target mode is new_window
Operator typed required execution phrase
Operator checked acknowledgement
no live action has executed yet in the precheck packet
no Session DB write has occurred
no chrome.storage.local runtime change has occurred before execution
```

## Programmatic Execution Validation Suite

The suite validates execution gates without moving browser tabs.

Scenarios:

```text
no confirmation blocks
phrase only blocks
acknowledgement only blocks
full confirmation ready
small workspace confirmed blocks
missing role confirmed blocks
missing URL confirmed blocks
unresolved live tabs confirmed blocks
boundary flags remain false
```

Expected suite result:

```text
packetType: Chrome Flow Dedicated Window Threshold Execution Validation Suite Packet
extension.schema: dedicated-window-threshold-execution-validation-suite-packet-v0.1
suite.overallStatus: pass
suite.failedScenarioCount: 0
source.validationOnly: true
source.executionValidation: true
source.operatorManualFixtureRequired: false
source.liveBrowserActionExecuted: false
source.runtimeActionExecuted: false
source.browserProjectionChanged: false
source.sessionDbChanged: false
source.chromeStorageRuntimeChanged: false
```

## Live Execution Packet

Expected live execution packet:

```text
packetType: Chrome Flow Dedicated Window Threshold Execution Packet
extension.schema: dedicated-window-threshold-execution-packet-v0.1
commandEnvelope.command: projection.workspace_dedicated_window_threshold_execution
commandEnvelope.authorityClass: live_browser_action_operator_confirmed
browserResult.dedicatedWindowId: number
browserResult.movedTabCount: 4 or more
browserResult.recreatedChromeGroups: true
verification.status: verified
execution.status: completed_verified
```

## Verification Requirements

Execution verification checks:

```text
dedicated window exists
dedicated window was not present before execution
moved tab count matches resolved workspace tab count
all moved tabs exist after execution
all moved tabs are in the dedicated window
no before-action browser tabs disappeared
unaffected before-action windows are preserved
created group count matches planned group count
created groups contain only moved workspace tabs
active runtime workspace id is preserved
Session DB is not changed by execution
```

## Merge Gate

Do not merge if:

```text
execution surface fails to load
execution validation suite fails
full confirmation fixture does not become ready
phrase-only fixture becomes ready
small workspace fixture becomes ready
missing-role fixture becomes ready
missing-URL fixture becomes ready
unresolved-live-tabs fixture becomes ready
live execution packet closes tabs
live execution packet moves unrelated tabs
live execution writes Session DB
live execution replaces active workspace
post-action verification fails without clear packet evidence
```

## Next Slice

After this validates and merges, the next clean slice is:

```text
projection.workspace_dedicated_window_threshold_post_action_verification
```

This should harden post-action verification as its own reusable service before broader production generalization.
