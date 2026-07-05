# Workspace Dedicated Window Threshold Review

## Purpose

This slice adds the Operator review layer for the dedicated/new-window threshold path.

It corresponds to:

```text
projection.workspace_dedicated_window_threshold_review
```

This slice does not execute browser actions.

## Relationship To Earlier Layers

The policy packet answers:

```text
Should this workspace move toward dedicated/new-window projection?
```

The preflight packet answers:

```text
Is the active runtime workspace ready to safely prepare that projection?
```

The review packet answers:

```text
Has the Operator explicitly reviewed and confirmed this future threshold action path?
```

## Product Rule

```text
0-3 tabs = current-window workspace can remain valid
4+ tabs = dedicated/new-window workspace policy activates
```

## Updated Files

```text
src/sidepanel/workspace-dedicated-window-threshold-review.js
src/sidepanel/workspace-dedicated-window-threshold-review-validation-suite.js
src/sidepanel/workspace-dedicated-window-threshold-policy.js
```

The review and review validation suite are loaded by the threshold policy module.

## Surface

The sidepanel adds:

```text
Dedicated Window Threshold Review
Dedicated Window Threshold Review Validation Suite
```

Controls:

```text
Prepare Threshold Review Packet
Copy Threshold Review Packet
Run Threshold Review Validation Suite
Copy Threshold Review Validation Suite Packet
```

## Required Review Phrase

```text
PREPARE DEDICATED WINDOW PROJECTION
```

## Packet Schema

```text
dedicated-window-threshold-review-packet-v0.1
dedicated-window-threshold-review-validation-suite-packet-v0.1
```

## Review Readiness Requirements

For this first threshold review, readiness requires:

```text
active/runtime or fixture workspace exists
4+ tabs
dedicated-window policy active
workspace tabs have URLs
workspace tabs have assigned roles
planned groups are available
target mode is new_window
Operator typed required review phrase
Operator checked acknowledgement
no runtime action executed
no browser projection changed
no Session DB write
no chrome.storage.local runtime replacement
```

## Expected Ready Review Packet

For a 4+ tab workspace with roles, URLs, phrase, and acknowledgement:

```text
packetType: Chrome Flow Dedicated Window Threshold Review Packet
extension.schema: dedicated-window-threshold-review-packet-v0.1
review.status: ready_for_threshold_execution_slice
review.readyForNextSlice: true
review.availableInThisSlice: false
operatorReview.operatorConfirmed: true
operatorReview.phraseMatches: true
operatorReview.acknowledgementChecked: true
thresholdPolicy.dedicatedWindowPolicyActive: true
browserPlan.targetMode: new_window
source.runtimeActionExecuted: false
source.browserProjectionChanged: false
source.sessionDbChanged: false
source.chromeStorageRuntimeChanged: false
```

## Programmatic Review Validation Suite

The suite validates:

```text
no confirmation blocks
phrase only blocks
acknowledgement only blocks
full confirmation passes
small workspace confirmed still blocks
missing role confirmed blocks
missing URL confirmed blocks
boundary flags remain false
```

Expected suite result:

```text
packetType: Chrome Flow Dedicated Window Threshold Review Validation Suite Packet
extension.schema: dedicated-window-threshold-review-validation-suite-packet-v0.1
suite.overallStatus: pass
suite.failedScenarioCount: 0
source.validationOnly: true
source.reviewValidation: true
source.operatorManualFixtureRequired: false
source.runtimeActionExecuted: false
source.browserProjectionChanged: false
source.sessionDbChanged: false
source.chromeStorageRuntimeChanged: false
```

## Boundary

The review packet is not a live action.

```text
source.readOnly: true
source.reviewOnly: true
source.runtimeActionExecuted: false
source.browserProjectionChanged: false
source.sessionDbChanged: false
source.chromeStorageRuntimeChanged: false
review.availableInThisSlice: false
```

## Next Slice

After this validates, the next slice should be:

```text
projection.workspace_dedicated_window_threshold_execution
```

The execution slice must still:

```text
rebuild its own preflight
require Operator confirmation
create only one dedicated/new window path
avoid Session DB writes unless explicitly scoped
avoid chrome.storage.local runtime replacement unless explicitly scoped
produce execution packet
produce post-action verification packet
```

## Merge Gate

Do not merge if:

```text
review surface fails to load
review validation suite fails
full confirmation does not pass in fixture suite
phrase-only case passes
acknowledgement-only case passes
small workspace confirmation passes
missing role confirmation passes
missing URL confirmation passes
review packet executes browser action
review packet writes Session DB
review packet replaces chrome.storage.local active workspace
```
