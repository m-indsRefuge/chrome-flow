# Rehydratable Workspace Validation

## Purpose

This slice validates that Chrome Flow can produce a saved Session DB workspace with enough durable tab evidence to become a future rehydration candidate.

The previous Runtime Projection Readiness slice correctly returned `WARN` because the only saved workspace had zero saved tab records. This slice resolves that evidence gap by creating a small real workspace with actual tab records, importing it into Session DB, and rerunning readiness validation.

## Branch

```text
layer2-rehydratable-workspace-validation
```

## Scope

This is primarily a validation slice using existing Layer 2 tooling:

```text
Workspace Intake
Session DB Diagnostics
Saved Workspace Registry
Layer 2 Persistence Validation
Runtime Projection Readiness
```

No new runtime projection action is implemented in this slice.

## Test Workspace Shape

Use a small, safe, low-risk workspace:

```text
Workspace name: Layer 2 Rehydration Candidate Test
Workspace type: research
Aim: Validate saved workspace tab records for future rehydration readiness
Suggested tab count: 2 or 3
```

Suggested tab sources:

```text
- one stable documentation page
- one stable search/reference page
- one simple local or public page if available
```

Avoid private accounts, sensitive documents, banking, email, medical, legal, or personal pages.

## Validation Procedure

1. Pull this branch and reload the extension.
2. Create the test workspace in the normal Chrome Flow workspace controls.
3. Open or select 2-3 safe tabs.
4. Use Workspace Intake to scan the current window.
5. Select only the intended tabs.
6. Add selected scanned tabs to the workspace.
7. Save the workspace.
8. In Session DB Diagnostics, click `Import Active Workspace to Session DB`.
9. Refresh Saved Workspace Registry.
10. Inspect the imported test workspace.
11. Copy a Saved Workspace Inspection Packet.
12. Run Layer 2 Persistence Validation and copy its packet.
13. Run Runtime Projection Readiness and copy its packet.

## Expected Readiness Result

After importing the test workspace, Runtime Projection Readiness should identify at least one future rehydration candidate:

```text
readiness.status: PASS or WARN
savedWorkspaceSummary.workspaceCount: 2 or more
savedWorkspaceSummary.rehydrateCandidateCount: 1 or more
savedWorkspaceSummary.rehydrateCandidateIds includes the new test workspace id
savedWorkspaceDetails[].canBeRehydratedLater: true for the test workspace
savedWorkspaceDetails[].tabCount: 2 or more
savedWorkspaceDetails[].missingUrlCount: 0
```

A `WARN` can still be acceptable if the active runtime workspace has no current tab records to dehydrate, but the saved workspace candidate itself should be valid.

## Pass Criteria

The slice passes when:

```text
- Session DB remains ready.
- No missing Session DB stores are reported.
- The test workspace appears in Saved Workspace Registry.
- The test workspace inspection packet shows saved tab records.
- Runtime Projection Readiness reports at least one rehydrate candidate.
- No live runtime projection action is executed.
- Active runtime source remains chrome.storage.local.
```

## Failure Conditions

Block the next implementation step if:

```text
- The imported test workspace has zero saved tab records.
- Saved tab records lack URLs.
- The readiness packet does not identify the test workspace as a rehydrate candidate.
- Session DB reports missing stores.
- Runtime authority changes unexpectedly.
- Any action outside normal workspace intake/import/inspection occurs.
```

## Why This Slice Matters

Before Chrome Flow implements pause/dehydrate or resume/rehydrate actions, it must prove that saved workspace state contains enough durable evidence to reconstruct a browser projection later.

This slice gives us the first positive candidate case, moving from:

```text
Readiness correctly warns because no rehydration candidate exists.
```

to:

```text
Readiness correctly detects a saved workspace that can be rehydrated in the future.
```

That distinction is required before runtime-control implementation.
