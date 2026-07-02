# Projection Resume Fresh Fixture Validation

## Purpose

This slice adds a read-only Session DB candidate selector to the resume run precheck panel.

It corresponds to:

```text
projection.resume_run_fresh_fixture_validation
```

This slice is intended to validate the chain:

```text
workspace control surface
→ captured workspace tab metadata
→ Session DB workspace records
→ Session DB tab/session/projection records
→ selected resume candidate
→ run precheck packet
```

No live browser action is performed in this slice.

## Sources Used

This slice is validated against:

```text
project memory: local-first, deterministic, Operator-approved, evidence-first workspace control
documentation map: docs/PROJECTION_RESUME_RUN_IMPLEMENTATION_MAP.md
```

## Updated File

```text
src/sidepanel/projection-resume-run.js
```

## Selector Behavior

The panel now provides:

```text
Resume candidate selector
Refresh Run Candidates
Prepare Run Precheck
Run Projection Prototype Disabled
Copy Run Packet
```

The selector is populated from Session DB workspace records.

Each candidate summary is derived from:

```text
listWorkspaceRecords()
getWorkspaceTabs(workspaceId)
getWorkspaceSessions(workspaceId)
getWorkspaceProjections(workspaceId)
```

## Candidate Eligibility

A selected candidate is expected to satisfy:

```text
workspace exists
workspace is not archived
saved tab count is exactly 3
missing URL count is 0
saved role/group evidence exists
planned group count is exactly 3
at least one Session DB session record exists
at least one projection record exists
latest projection is dehydrated
```

The selector may show blocked candidates, but the precheck packet must keep them blocked.

## Required Boundary

```text
source.readOnly: true
source.precheckOnly: true
source.candidateSelectorEnabled: true
source.runtimeActionExecuted: false
source.browserProjectionChanged: false
source.sessionDbChanged: false
source.chromeStorageRuntimeChanged: false
source.runButtonDisabled: true
preRun.availableInThisSlice: false
```

## Packet Schema

```text
projection-resume-run-precheck-packet-v0.2
```

## Added Packet Sections

```text
candidateSelector
sessionDbEvidence
```

The selected candidate is recorded as:

```text
candidateSelector.selectedWorkspaceId
candidateSelector.selectedCandidate
```

Session DB evidence is recorded as:

```text
sessionDbEvidence.workspaceRecordRead
sessionDbEvidence.workspaceTabRecordsRead
sessionDbEvidence.sessionRecordsRead
sessionDbEvidence.projectionRecordsRead
sessionDbEvidence.latestProjectionState
```

## Expected Fresh Fixture Positive Case

After creating a real workspace through the normal workspace/tab controls, importing or persisting it to Session DB, and selecting it in the candidate selector:

```text
preRun.status: precheck_passed_run_still_disabled
candidateSelector.selectedWorkspaceId: <fresh fixture workspace id>
sessionDbEvidence.workspaceRecordRead: true
sessionDbEvidence.workspaceTabRecordsRead: 3
sessionDbEvidence.sessionRecordsRead > 0
sessionDbEvidence.projectionRecordsRead > 0
sessionDbEvidence.latestProjectionState: dehydrated
browserPlan.savedTabCount: 3
browserPlan.missingUrlCount: 0
browserPlan.plannedGroupCount: 3
source.runButtonDisabled: true
source.runtimeActionExecuted: false
source.browserProjectionChanged: false
source.sessionDbChanged: false
source.chromeStorageRuntimeChanged: false
```

## Expected Blocked Candidate Case

A blank or incomplete workspace selected from the candidate selector must produce:

```text
preRun.status: blocked_before_run
preRun.failedChecks is not empty
source.runButtonDisabled: true
source.runtimeActionExecuted: false
source.browserProjectionChanged: false
```

## Merge Gate

Do not merge if:

```text
the selector fails to populate from Session DB
changing the selected candidate does not change the packet target
blank/incomplete candidates can pass precheck
the run button is enabled
a live browser API is called
Session DB records are mutated by the selector
chrome.storage.local active workspace is replaced
the packet omits candidateSelector or sessionDbEvidence
```
