# Chrome Flow AI Command Contract

Status: Draft v0.2

This document defines how a future AI layer may understand, propose, and request Chrome Flow actions.

The current Chrome Flow product remains deterministic and user-controlled. AI providers, local models, adapters, transformers, or browser agents must attach above this control surface. They must not bypass Chrome Flow state, Chrome permission boundaries, confirmation gates, timeline records, recovery requirements, or user-authored journal boundaries.

## Core Rule

The AI layer may suggest actions, explain workspace state, and prepare structured commands.

The deterministic Chrome Flow layer executes only approved actions through known functions.

```text
User or AI suggestion
→ command contract
→ permission / confirmation gate
→ deterministic Chrome Flow function
→ storage update
→ system timeline evidence
→ recovery path where required
```

## Record Surfaces

### User Journal

The User Journal is for human-authored notes, reminders, research thoughts, and organizational notes.

The AI layer may later help summarize or filter the User Journal, but it must not mix system-generated operational events into the User Journal.

User Journal entries may include:

```text
text
tag
relatedRoleId
relatedRoleLabel
createdAt
```

### System Timeline

The System Timeline is the operational audit trail. It records what Chrome Flow did, including browser actions, workspace actions, status refreshes, role changes, destructive actions, and recovery actions.

### Recovery View

Recovery View is a filtered view derived from System Timeline events that include `recoveryActions`.

The future AI layer may answer questions such as:

```text
Show me all recoverable tab closures.
Show me all removed workspace tabs.
Show me all Chrome group removals that can be recreated.
```

## Authority Levels

### read_only

The command reads Chrome Flow state or browser state. It does not change browser tabs, Chrome groups, workspace records, User Journal, or System Timeline unless explicitly defined as a status-refresh event.

Examples:

- Get workspace summary
- Get tab status
- Inspect role distribution
- List recoverable events

### soft_write

The command writes to Chrome Flow workspace state or the User Journal but does not close browser tabs or alter destructive browser state.

Examples:

- Save workspace name
- Save workspace aim
- Assign tab role
- Add user journal entry
- Add selected tabs to workspace

### browser_organization

The command changes browser organization while keeping tabs open and preserving Chrome Flow workspace records.

Examples:

- Create Chrome tab groups
- Focus tab
- Focus role group
- Remove one Chrome group
- Remove all current-workspace Chrome groups
- Recreate Chrome groups from Recovery View

### destructive_browser

The command closes browser tabs or removes active workspace records in a way that requires recovery support.

Examples:

- Close browser tab and remove from workspace
- Remove tab from workspace
- Future group-level close/remove actions

## Required Command Fields

Each future AI-callable command should define:

```text
name
purpose
authority_level
inputs
preconditions
requires_user_confirmation
requires_reason
writes_workspace_storage
writes_user_journal
writes_system_timeline
affects_browser_tabs
affects_chrome_groups
closes_browser_tabs
recovery_available
failure_modes
user_facing_explanation
```

## Current Command Surface

### workspace.getTabStatus

Purpose: Report the relationship between Chrome Flow workspace records and currently open browser tabs.

Authority level: read_only

Inputs: none

Requires user confirmation: no

Requires reason: no

Writes workspace storage: no

Writes user journal: no

Writes system timeline: only when the user explicitly clicks Refresh Tab Status.

Affects browser tabs: no

Affects Chrome groups: no

Closes browser tabs: no

Recovery available: not required

Expected result:

```text
Total workspace tabs
Open browser tabs
Missing / closed tabs
Grouped tabs
Ungrouped tabs
Unassigned tabs
```

### workspace.addUserJournalEntry

Purpose: Add a human-authored note to the User Journal.

Authority level: soft_write

Inputs:

```text
text
tag
relatedRoleId
relatedRoleLabel
```

Requires user confirmation: no for current deterministic UI action.

Requires reason: no

Writes workspace storage: yes

Writes user journal: yes

Writes system timeline: yes, as a simple user_journal_added event.

Affects browser tabs: no

Affects Chrome groups: no

Closes browser tabs: no

Recovery available: not required

### workspace.listRecoverableEvents

Purpose: Show System Timeline events that expose recovery actions.

Authority level: read_only

Inputs: optional filters such as event type or recovery action type.

Requires user confirmation: no

Requires reason: no

Writes workspace storage: no

Writes user journal: no

Writes system timeline: no

Affects browser tabs: no

Affects Chrome groups: no

Closes browser tabs: no

Recovery available: not required

### workspace.focusTab

Purpose: Focus a specific open browser tab from its workspace record.

Authority level: browser_organization

Inputs:

```text
tabKey
```

Requires user confirmation: no

Requires reason: no

Writes workspace storage: yes, updates live tab metadata when needed.

Writes user journal: no

Writes system timeline: yes

Affects browser tabs: yes, focuses window/tab.

Affects Chrome groups: no

Closes browser tabs: no

Recovery available: not required

### workspace.focusGroup

Purpose: Focus the first open tab belonging to a Chrome Flow role/subgroup.

Authority level: browser_organization

Inputs:

```text
roleId
roleLabel
```

Requires user confirmation: no

Requires reason: no

Writes workspace storage: no

Writes user journal: no

Writes system timeline: yes

Affects browser tabs: yes, focuses window/tab.

Affects Chrome groups: no

Closes browser tabs: no

Recovery available: not required

### workspace.createChromeGroups

Purpose: Create or update native Chrome tab groups using Chrome Flow role/subgroup assignments.

Authority level: browser_organization

Inputs: none

Requires user confirmation: no for current deterministic UI action.

Requires reason: no

Writes workspace storage: yes, refreshes tab metadata after grouping.

Writes user journal: no

Writes system timeline: yes

Affects browser tabs: yes, groups tabs.

Affects Chrome groups: yes

Closes browser tabs: no

Recovery available: native ungroup actions are available; group-removal events can expose Recreate Chrome Groups.

### workspace.removeChromeGroup

Purpose: Remove one native Chrome tab group for a specific Chrome Flow role/subgroup.

Authority level: browser_organization

Inputs:

```text
roleId
roleLabel
```

Requires user confirmation: yes

Requires reason: no

Writes workspace storage: no

Writes user journal: no

Writes system timeline: yes, with recoveryActions.canRecreateChromeGroups.

Affects browser tabs: yes, ungroups tabs while keeping them open.

Affects Chrome groups: yes

Closes browser tabs: no

Recovery available: yes, Recreate Chrome Groups.

### workspace.removeAllChromeGroups

Purpose: Remove all native Chrome tab groups associated with currently live tabs in the active Chrome Flow workspace.

Authority level: browser_organization

Inputs: none

Requires user confirmation: yes

Requires reason: no

Writes workspace storage: no

Writes user journal: no

Writes system timeline: yes, with recoveryActions.canRecreateChromeGroups.

Affects browser tabs: yes, ungroups tabs while keeping them open.

Affects Chrome groups: yes

Closes browser tabs: no

Recovery available: yes, Recreate Chrome Groups.

### workspace.removeTabFromWorkspace

Purpose: Remove one tab record from Chrome Flow while keeping the browser tab open.

Authority level: destructive_browser

Inputs:

```text
tabKey
reason
```

Requires user confirmation: yes

Requires reason: yes

Writes workspace storage: yes

Writes user journal: no

Writes system timeline: yes, with tab snapshot and recovery actions.

Affects browser tabs: no

Affects Chrome groups: indirectly no

Closes browser tabs: no

Recovery available: yes, Re-add to Workspace and Reopen URL from Recovery View.

### workspace.closeBrowserTabAndRemoveFromWorkspace

Purpose: Close one live browser tab and remove its Chrome Flow workspace record.

Authority level: destructive_browser

Inputs:

```text
tabKey
reason
```

Requires user confirmation: yes

Requires reason: yes

Writes workspace storage: yes

Writes user journal: no

Writes system timeline: yes, with tab snapshot and recovery actions.

Affects browser tabs: yes

Affects Chrome groups: indirectly yes, because Chrome may update or remove native group membership when the tab closes.

Closes browser tabs: yes

Recovery available: yes, Reopen URL and Re-add to Workspace from Recovery View.

### workspace.reopenUrlFromRecovery

Purpose: Reopen a saved URL from a recoverable System Timeline event.

Authority level: browser_organization

Inputs:

```text
eventId
```

Requires user confirmation: no for current deterministic UI action.

Requires reason: no

Writes workspace storage: yes if a matching workspace tab already exists and metadata is refreshed.

Writes user journal: no

Writes system timeline: yes

Affects browser tabs: yes, opens a browser tab.

Affects Chrome groups: no

Closes browser tabs: no

Recovery available: not required

### workspace.readdTabFromRecovery

Purpose: Restore a removed workspace tab record from a recoverable System Timeline event.

Authority level: soft_write

Inputs:

```text
eventId
```

Requires user confirmation: no for current deterministic UI action.

Requires reason: no

Writes workspace storage: yes

Writes user journal: no

Writes system timeline: yes

Affects browser tabs: no

Affects Chrome groups: no

Closes browser tabs: no

Recovery available: not required

## AI Layer Constraints

The future AI layer must not:

- Call Chrome APIs directly.
- Edit DOM state as a substitute for Chrome Flow commands.
- Close tabs without explicit user confirmation.
- Remove workspace records without explicit user confirmation.
- Bypass reason capture for destructive actions.
- Write system-generated events into the User Journal.
- Bypass System Timeline evidence for state-changing actions.
- Treat suggestions as executed actions.

The future AI layer may:

- Summarize workspace state.
- Suggest tab roles.
- Suggest grouping or cleanup actions.
- Identify missing or ungrouped tabs.
- Summarize the User Journal separately from the System Timeline.
- List recoverable events.
- Draft a plan for browser organization.
- Prepare command objects for user approval.

## Current Policy Decision

AI integration is not part of V0.2.

During V0.2, Chrome Flow should keep building deterministic control surfaces and document them in this contract.

The future AI layer will attach only after the command surface is stable enough to be described, tested, and permission-gated.
