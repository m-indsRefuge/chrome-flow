# Projection Resume Run Precheck Panel

## Purpose

This slice adds the precheck panel for the first mapped resume run path.

It corresponds to:

```text
projection.resume_run_precheck_panel
```

This slice does not perform live browser actions.

## Sources Used

This slice is validated against:

```text
project memory: local-first, deterministic, Operator-approved, evidence-first workspace control
documentation map: docs/PROJECTION_RESUME_RUN_IMPLEMENTATION_MAP.md
```

## Added Files

```text
src/sidepanel/projection-resume-run.js
docs/PROJECTION_RESUME_RUN_PRECHECK_PANEL.md
```

Updated file:

```text
src/sidepanel/sidepanel.html
```

## Surface

```text
Projection Resume Run Prototype
```

Controls:

```text
Refresh Run Candidate
Prepare Run Precheck
Run Projection Prototype Disabled
Copy Run Packet
```

## Required Phrase

```text
OPEN NEW WINDOW FOR SAVED WORKSPACE
```

## Fixed Target

```text
workspaceId: c22b5a00-c68d-4b64-8bba-01172a0dd818
workspaceName: Layer 2 Rehydration Candidate Test
targetMode: new_window
expectedTabCount: 3
expectedGroupCount: 3
```

## Packet Schema

```text
projection-resume-run-precheck-packet-v0.1
```

## Required Boundary

```text
source.readOnly: true
source.precheckOnly: true
source.runtimeActionExecuted: false
source.browserProjectionChanged: false
source.sessionDbChanged: false
source.chromeStorageRuntimeChanged: false
source.runButtonDisabled: true
preRun.availableInThisSlice: false
```

## Expected Positive Case

With the fixed target workspace valid, typed phrase correct, and acknowledgement checked:

```text
preRun.status: precheck_passed_run_still_disabled
operatorConfirmation.phraseMatches: true
operatorConfirmation.acknowledgementChecked: true
operatorConfirmation.operatorConfirmed: true
browserPlan.savedTabCount: 3
browserPlan.plannedGroupCount: 3
source.runButtonDisabled: true
```

## Expected Negative Cases

Wrong phrase:

```text
preRun.status: blocked_before_run
operatorConfirmation.phraseMatches: false
```

Unchecked acknowledgement:

```text
preRun.status: blocked_before_run
operatorConfirmation.acknowledgementChecked: false
```

Invalid saved workspace state:

```text
preRun.status: blocked_before_run
preRun.failedChecks is not empty
```

## Merge Gate

Do not merge if:

```text
the panel fails to load
the run button is enabled
a live browser API is called
the positive case does not keep availableInThisSlice false
the fixed target workspace is not enforced
the required group count is not checked
the packet omits runtime/session/browser state-change flags
```
