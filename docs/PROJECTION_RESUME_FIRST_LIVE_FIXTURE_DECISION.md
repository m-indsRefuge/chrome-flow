# Projection Resume First Live Fixture Decision

## Purpose

This document records the decision for the first live resume/rehydrate prototype.

It corresponds to:

```text
projection.resume_first_live_fixture_decision
```

## Decision

The first live resume prototype will use the known minimal technical fixture:

```text
workspace: Layer 2 Rehydration Candidate Test
workspaceId: c22b5a00-c68d-4b64-8bba-01172a0dd818
savedTabCount: 3
plannedGroupCreates: 3
targetMode: new_window
```

## Rationale

The known 3-tab / 3-group fixture provides the smallest controlled surface for validating the live browser-action substrate.

This decision does not redefine the product policy.

The 3-tab fixture is a technical validation fixture, not a production workspace limit.

## Product Policy Preserved

The broader Workspace Control Layer policy remains:

```text
0-3 tabs: current-window workspace may remain acceptable
4+ tabs: dedicated/new-window projection should be recommended or required, with Operator review
```

After the minimal live resume path is proven, the 4+ tab dedicated-window threshold path must be validated as a product-policy path.

## First Live Resume Scope

Allowed in the first live prototype:

```text
rebuild checks immediately before action
require typed Operator phrase
require Operator acknowledgement
capture before browser snapshot
create one new Chrome window
create saved tabs in that new window
create Chrome tab groups from saved roles
set group titles
capture after browser snapshot
verify created window/tabs/groups
produce execution packet
```

Forbidden in the first live prototype:

```text
close existing tabs
close existing windows
move unrelated tabs
replace chrome.storage.local active workspace
promote Session DB to runtime authority
execute from a pasted packet alone
execute without rebuilt checks
execute without Operator confirmation
perform cleanup automatically after partial failure
```

## Validation Requirement

The first live resume implementation must preserve:

```text
Session DB runtime authority switch: no
chrome.storage.local active workspace replacement: no
existing tabs/windows changed: 0
created groups only contain tabs created by this command
runtime ids are evidence only
```

## Next Product Path

After the minimal live resume prototype is validated:

```text
1. build 4+ tab dedicated-window threshold validation
2. validate a fresh product-policy fixture
3. generalize resume beyond the 3-tab fixture
4. expand the Workspace Control Layer to dehydrate/switch/archive/restore using the same command substrate
```
