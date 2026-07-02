# Projection Resume Validation Suite Runner

## Purpose

This slice adds a programmatic validation suite runner for the resume/rehydrate control path.

It corresponds to:

```text
projection.resume_validation_suite_runner
```

This slice does not perform live browser actions.

## Why This Exists

Manual validation became too complex for reliable Operator execution.

The validation suite moves the resume checks from manual packet-by-packet inspection toward a deterministic internal validation substrate.

## Sources Used

This slice is validated against:

```text
project memory: local-first, deterministic, Operator-approved, evidence-first workspace control
documentation map: docs/PROJECTION_RESUME_RUN_IMPLEMENTATION_MAP.md
fresh-fixture selector: docs/PROJECTION_RESUME_FRESH_FIXTURE_VALIDATION.md
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

The side panel now adds:

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
projection-resume-validation-suite-packet-v0.1
```

## Suite Scenarios

The runner validates:

```text
selector_populates_from_session_db
known_candidate_available
known_candidate_positive_simulated
known_candidate_phrase_only_blocks
known_candidate_checkbox_only_blocks
blocked_candidate_available
blocked_candidate_stays_blocked
fresh_fixture_classification
boundary_preserved
```

The simulated operator cases allow the suite to test phrase and acknowledgement gates without requiring repeated manual input.

## Required Boundary

```text
source.readOnly: true
source.validationOnly: true
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

## Next Decision

The suite emits:

```text
nextDecision.recommendation
nextDecision.reason
```

Decision values include:

```text
hold
pass_with_note
eligible_for_next_review
```

## Storage-Layer Checkpoint

Chrome Flow currently has two state layers:

```text
chrome.storage.local: active runtime workspace / short-term browser-side state
Session DB: durable workspace, tab, session, projection, summary, timeline records
```

Before live browser resume actions are implemented, the project should explicitly define the durable storage contract.

The intended long-term direction is:

```text
chrome.storage.local remains the active runtime state surface.
Session DB becomes the durable workspace/session/projection memory layer.
Runtime ids remain evidence, not durable authority.
The deterministic engine should validate against the durable DB layer before invoking browser APIs.
No action should silently promote Session DB to runtime authority.
No action should silently overwrite chrome.storage.local active workspace from a saved projection.
```

This storage checkpoint should be resolved before broad browser-control expansion.

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
```
