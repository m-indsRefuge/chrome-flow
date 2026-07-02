# Projection Resume Live Known Fixture

## Purpose

This slice implements the first controlled live resume/rehydrate prototype.

It corresponds to:

```text
projection.resume_live_known_fixture
```

## Fixture

The first live resume prototype is limited to the known minimal technical fixture:

```text
workspace: Layer 2 Rehydration Candidate Test
workspaceId: c22b5a00-c68d-4b64-8bba-01172a0dd818
savedTabCount: 3
plannedGroupCreates: 3
targetMode: new_window
```

This is not a product limit.

It is a controlled first live browser-action target.

## Implemented Surface

Updated file:

```text
src/sidepanel/projection-resume-run.js
```

The run surface now supports:

```text
Refresh Run Candidates
Prepare Run Precheck
Run Known Fixture Resume
Copy Latest Run Packet
```

The run button remains disabled until all rebuilt pre-run checks pass.

## Required Operator Gate

The live action requires:

```text
selectedWorkspaceId: c22b5a00-c68d-4b64-8bba-01172a0dd818
required phrase: OPEN NEW WINDOW FOR SAVED WORKSPACE
acknowledgement checked: true
savedTabCount: 3
plannedGroupCount: 3
projectionState: dehydrated
```

## Allowed Live Browser Effects

Allowed:

```text
create one new Chrome window
create saved tabs inside that new window
create Chrome tab groups from saved roles
set Chrome group titles
focus the created window
```

## Forbidden Effects

Forbidden:

```text
close existing tabs
close existing windows
move unrelated tabs
replace chrome.storage.local active workspace
promote Session DB to runtime authority
write Session DB records
automatic cleanup after partial failure
```

## Execution Packet

The live action produces:

```text
Chrome Flow Projection Resume Execution Packet
projection-resume-execution-packet-v0.1-known-fixture
```

The packet includes:

```text
commandEnvelope
source
preRun
workspace
operatorConfirmation
browserPlan
browserResult
snapshotBefore
snapshotAfter
runtimeReview
verification
execution
```

## Expected Successful Result

```text
execution.status: completed_verified
source.runtimeActionExecuted: true
source.browserProjectionChanged: true
source.sessionDbChanged: false
source.chromeStorageRuntimeChanged: false
browserResult.createdWindowId: <new window id>
browserResult.createdTabIds.length: 3
browserResult.createdGroupIds.length: 3
verification.status: verified
verification.failedChecks: []
runtimeReview.chromeStorageRuntimeAuthorityPreserved: true
```

## Verification Checks

The implementation verifies:

```text
created_window_exists
created_window_not_present_before
created_tab_count_matches_saved
created_tabs_exist_after
created_tabs_in_created_window
created_group_count_matches_plan
created_groups_only_contain_created_tabs
before_windows_preserved
before_tabs_preserved
chrome_storage_runtime_workspace_unchanged
session_db_active_workspace_unchanged
```

## Failure Handling

If the run fails:

```text
produce execution failure packet
record whether runtime action started
record whether browser projection changed
capture after-failure browser snapshot when possible
do not perform automatic cleanup
```

Automatic cleanup is out of scope for this first live prototype.

## Merge Gate

Do not merge if:

```text
run button enables without the required phrase
run button enables without acknowledgement
run button enables for a non-fixture candidate
run button enables when saved tab count is not 3
run button enables when planned group count is not 3
execution closes existing tabs/windows
execution moves unrelated tabs
execution writes Session DB records
execution replaces chrome.storage.local active workspace
execution omits before/after snapshots
execution omits verification checks
execution creates groups containing tabs not created by this command
```
