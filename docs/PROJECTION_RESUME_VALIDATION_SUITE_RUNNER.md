# Projection Resume Validation Suite Runner

## Purpose

This slice provides a programmatic validation suite runner for the resume/rehydrate control path.

It corresponds to:

```text
projection.resume_validation_suite_runner
```

In the first live known-fixture branch, the suite also validates the live-action gate for:

```text
projection.resume_live_known_fixture
```

The suite does not execute live browser actions.

## Why This Exists

Manual validation became too complex for reliable Operator execution.

The validation suite moves resume checks from manual packet-by-packet inspection toward a deterministic internal validation substrate.

Before the Operator runs the first live browser action, the suite should validate that the live run button can only become available under the correct conditions.

## Sources Used

This slice is validated against:

```text
project memory: local-first, deterministic, Operator-approved, evidence-first workspace control
documentation map: docs/PROJECTION_RESUME_RUN_IMPLEMENTATION_MAP.md
fresh-fixture selector: docs/PROJECTION_RESUME_FRESH_FIXTURE_VALIDATION.md
live known fixture: docs/PROJECTION_RESUME_LIVE_KNOWN_FIXTURE.md
storage/memory contract: docs/WORKSPACE_CONTROL_STORAGE_MEMORY_CONTRACT.md
```

## Added File

```text
src/sidepanel/projection-resume-validation-suite.js
```

Updated file:

```text
src/sidepanel/sidepanel.html
```

## Surface

The side panel adds:

```text
Projection Resume Validation Suite
```

Controls:

```text
Run Resume Validation Suite
Copy Validation Suite Packet
```

## Packet Schema

```text
projection-resume-validation-suite-packet-v0.2-live-known-fixture-gate
```

## Suite Scenarios

The live-gate suite validates:

```text
selector_populates_from_session_db
known_fixture_candidate_available
known_fixture_live_ready_simulated
known_fixture_phrase_only_blocks
known_fixture_checkbox_only_blocks
known_fixture_no_confirmation_blocks
blocked_candidate_available
blocked_candidate_cannot_become_live_ready
non_fixture_candidate_available
non_fixture_candidate_cannot_enable_first_live_run
fresh_fixture_classification
validation_suite_does_not_execute_live_action
live_gate_contract_preserved
```

The simulated operator cases allow the suite to test phrase and acknowledgement gates without requiring repeated manual input.

## Live Gate Rules Validated

The suite validates that the first live known-fixture action becomes available only when:

```text
selectedWorkspaceId: c22b5a00-c68d-4b64-8bba-01172a0dd818
known fixture exists
known fixture has exactly 3 saved tabs
known fixture has exactly 3 planned groups
known fixture projection is dehydrated
operator phrase is simulated true
operator acknowledgement is simulated true
```

The suite validates that the live gate blocks when:

```text
phrase is missing
acknowledgement is missing
candidate is incomplete
candidate is not the known first-live fixture
```

## Required Boundary

```text
source.readOnly: true
source.validationOnly: true
source.liveGateValidation: true
source.runtimeActionExecuted: false
source.browserProjectionChanged: false
source.sessionDbChanged: false
source.chromeStorageRuntimeChanged: false
```

## Candidate Matrix

The suite packet includes:

```text
candidateMatrix.candidateCount
candidateMatrix.eligibleCandidateCount
candidateMatrix.blockedCandidateCount
candidateMatrix.freshCandidateCount
candidateMatrix.candidates
```

## Live Gate Decision

The suite emits:

```text
liveGateDecision.recommendation
liveGateDecision.reason
```

Decision values include:

```text
hold
live_button_may_be_operator_tested
```

## Next Decision

The suite emits:

```text
nextDecision.recommendation
nextDecision.reason
```

Decision values include:

```text
hold
ready_for_single_operator_live_run
eligible_for_next_review
pass_with_note
```

## Validation Instruction

Before pressing the live run button, the Operator should run:

```text
Run Resume Validation Suite
Copy Validation Suite Packet
```

The expected pass condition is:

```text
suite.overallStatus: pass
source.validationOnly: true
source.liveGateValidation: true
source.runtimeActionExecuted: false
source.browserProjectionChanged: false
source.sessionDbChanged: false
source.chromeStorageRuntimeChanged: false
liveGateDecision.recommendation: live_button_may_be_operator_tested
nextDecision.recommendation: ready_for_single_operator_live_run
```

Only after that should the separate live run button be tested.

## Storage-Layer Checkpoint

Chrome Flow currently has two state layers:

```text
chrome.storage.local: active runtime workspace / short-term browser-side state
Session DB: durable workspace, tab, session, projection, summary, timeline records
```

The intended long-term direction is:

```text
chrome.storage.local remains the active runtime state surface.
Session DB becomes the durable workspace/session/projection memory layer.
Runtime ids remain evidence, not durable authority.
The deterministic engine should validate against the durable DB layer before invoking browser APIs.
No action should silently promote Session DB to runtime authority.
No action should silently overwrite chrome.storage.local active workspace from a saved projection.
```

## Merge Gate

Do not merge if:

```text
the suite panel fails to load
the suite packet cannot be copied
the suite calls live browser-action APIs
the suite mutates Session DB
the suite replaces chrome.storage.local runtime workspace
the suite omits candidateMatrix
the suite omits scenario results
the suite omits boundary flags
the suite omits liveGateDecision
live gate passes for a non-fixture candidate
live gate passes without phrase and acknowledgement
```
