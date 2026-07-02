# Projection Resume Run Implementation Map

## Purpose

This document maps the first live Chrome Flow resume prototype before implementation.

It is a planning document only.

No code in this slice changes browser state.

## Target Command

```text
projection.resume_workspace
```

## Target Branch for This Map

```text
layer2-resume-run-map
```

## Current Gate Stack

The future run path must be reached only after these gates:

```text
readiness packet
preview packet
confirmation packet
preflight packet
review packet
```

The current review packet must show:

```text
review.readyForNextSlice: true
operatorReview.operatorConfirmed: true
source.reviewOnly: true
source.noStateChange: true
```

The future run slice must still rebuild its own checks. It must not trust a pasted or stale packet alone.

## Fixed Scope for First Prototype

The first prototype is limited to:

```text
workspace: Layer 2 Rehydration Candidate Test
targetMode: new_window
savedTabCount: 3
plannedGroupCreates: 3
new browser window count: 1
existing tabs/windows changed: 0
Session DB runtime authority switch: no
chrome.storage.local active workspace replacement: no
```

## Module Shape

Recommended file:

```text
src/sidepanel/projection-resume-run.js
```

Recommended sidepanel load order:

```text
projection-resume-preflight.js
projection-resume-review.js
projection-resume-run.js
```

Recommended section:

```text
Projection Resume Run Prototype
```

Recommended controls:

```text
Refresh Run Candidate
Prepare Run Review
Run Projection Prototype
Copy Run Packet
```

The run button must be disabled unless all checks pass and the operator has completed the run confirmation.

## Required User Confirmation

The run surface must require a stronger confirmation than the review surface.

Recommended typed phrase:

```text
OPEN NEW WINDOW FOR SAVED WORKSPACE
```

Recommended checkbox:

```text
I understand this will create one new Chrome window from the saved workspace records.
```

Both must be true.

## Data Reads

Before any browser call, the implementation must read:

```text
getWorkspace()
getActiveWorkspaceId()
getWorkspaceRecord(workspaceId)
getWorkspaceTabs(workspaceId)
getWorkspaceSessions(workspaceId)
getWorkspaceProjections(workspaceId)
```

Required derived values:

```text
workspace exists
workspace lifecycle is not archived
saved tab records exist
all saved tab records have URLs
projection state is dehydrated
role/group evidence exists
planned groups are backed by creatable tabs
current runtime workspace id is known for evidence only
```

## Pre-Run Checks

The run slice must block before browser calls if any of these fail:

```text
workspace id is not c22b5a00-c68d-4b64-8bba-01172a0dd818
workspace does not exist
workspace is archived
saved tab count is not 3 for initial validation
any saved tab URL is missing
no role/group evidence exists
projection is not dehydrated
operator typed phrase is wrong
operator checkbox is not checked
review packet state is not ready_for_next_slice when used
```

Runtime selection mismatch remains review evidence only. It must not block this first new-window prototype.

## Browser API Sequence

Use a simple strict order.

```text
1. Capture a before snapshot of window ids and tab ids.
2. Create one new Chrome window.
3. Capture created window id.
4. Create saved tabs inside that created window.
5. Capture created tab ids mapped to saved workspaceTabId values.
6. Create Chrome groups from saved tab roles.
7. Capture created group ids mapped to role names.
8. Set group titles from saved roles.
9. Focus the created window if focusAfterResume is true.
10. Capture an after snapshot of window ids and tab ids.
11. Run verification.
12. Build packet.
```

## Recommended Chrome API Calls

Window creation:

```text
chrome.windows.create({ focused: false })
```

Tab creation:

```text
chrome.tabs.create({ windowId: createdWindowId, url, active: firstTabOnly })
```

Grouping:

```text
chrome.tabs.group({ tabIds: createdTabIdsForRole, createProperties: { windowId: createdWindowId } })
```

Group title:

```text
chrome.tabGroups.update(groupId, { title: roleLabel })
```

Focus:

```text
chrome.windows.update(createdWindowId, { focused: true })
```

The implementation must not call APIs that close existing tabs, close existing windows, move unrelated tabs, or replace the active runtime workspace.

## Tab Creation Details

The run should create tabs from saved records in saved order.

Each created tab evidence item should include:

```text
workspaceTabId
saved order
saved role
saved url
createdTabId
createdWindowId
status
error if any
```

If any tab creation fails:

```text
stop before grouping
report partial result
verificationStatus: failed
no automatic cleanup
```

## Group Creation Details

Group creation is mandatory when saved role evidence exists.

Group plan:

```text
group saved records by role
exclude unassigned role
create one Chrome group per role
only include tab ids created by this command
set group title to role label
```

Each created group evidence item should include:

```text
role
roleLabel
workspaceTabIds
createdTabIds
createdGroupId
status
error if any
```

If expected group creation fails:

```text
verificationStatus: failed or warn
result cannot be clean success
no automatic cleanup
```

## Before and After Snapshot

Before snapshot should include:

```text
existingWindowIds
existingTabIds
activeRuntimeWorkspaceId
activeDbWorkspaceId
```

After snapshot should include:

```text
allWindowIdsAfter
allTabIdsAfter
createdWindowId
createdTabIds
createdGroupIds
```

Verification compares these snapshots to prove existing tabs and windows were not removed.

## Verification Checks

Required checks:

```text
createdWindowId exists
createdWindowId was not present before run
createdTabIds length equals savedTabCount
all createdTabIds belong to createdWindowId
created tab URL set matches saved URL set
created group count equals planned group count
created groups contain only createdTabIds
no before-window id disappeared
no before-tab id disappeared
chrome.storage.local active workspace id unchanged
Session DB runtime authority remains false
run packet was produced
```

Verification result rules:

```text
passed: all required checks pass
warn: browser projection mostly exists but non-critical evidence is incomplete
failed: required browser or safety check failed
```

No successful result may be reported before verification.

## Packet Shape

Packet type:

```text
Chrome Flow Projection Resume Run Packet
```

Schema:

```text
projection-resume-run-packet-v0.1
```

Required packet sections:

```text
source
workspace
operatorConfirmation
preRunChecks
browserPlan
browserResult
snapshotBefore
snapshotAfter
verification
commandEnvelope
notes
```

Required source flags:

```text
runtimeActionExecuted: true only after the first browser API succeeds
browserProjectionChanged: true only if a new window or tab was created
sessionDbChanged: false unless safe evidence-write support is added
chromeStorageRuntimeChanged: false
```

## Command Envelope

Command envelope must use:

```text
commandName: projection.resume_workspace
authorityClass: runtime_projection_action
requestedBy: operator
requiresConfirmation: true
confirmationState: approved
execution.status: success | warn | failed | cancelled | blocked_before_run
verification.required: true
```

## Failure Handling

Before any browser call:

```text
return blocked_before_run
runtimeActionExecuted: false
browserProjectionChanged: false
```

After a window is created:

```text
record createdWindowId
record partial state honestly
run verification
never pretend the result is clean if verification fails
```

Automatic cleanup is out of scope for the first prototype.

## Diagnostics

Recommended diagnostics:

```text
projection_resume_run_reviewed
projection_resume_run_blocked
projection_resume_run_started
projection_resume_run_window_created
projection_resume_run_tabs_created
projection_resume_run_groups_created
projection_resume_run_verified
projection_resume_run_failed
projection_resume_run_packet_copied
```

Each diagnostic should include:

```text
commandId
workspaceId
workspaceName
status
createdWindowId when available
createdTabCount when available
createdGroupCount when available
error when available
```

## Manual Validation Plan

Positive validation:

```text
select Layer 2 Rehydration Candidate Test
pass pre-run checks
type required run phrase
check acknowledgement
run prototype
expect one new Chrome window
expect three created tabs
expect three required groups
expect verification passed
expect no existing tabs or windows removed
expect chrome.storage.local runtime unchanged
```

Negative validation:

```text
wrong phrase blocks before browser call
unchecked acknowledgement blocks before browser call
zero-tab workspace blocks before browser call
workspace with missing URL blocks before browser call
no saved group evidence blocks clean run for this prototype
```

## Implementation Order

Recommended next coding order:

```text
1. Add review-only run panel with disabled run button.
2. Add pre-run check packet.
3. Add typed phrase and checkbox gate.
4. Add before snapshot helper.
5. Add window creation only behind gate.
6. Add tab creation.
7. Add group creation.
8. Add verification.
9. Add run packet copy.
10. Run positive and negative validation.
```

If risk feels high, stop after step 4 and validate the packet before adding live browser calls.
