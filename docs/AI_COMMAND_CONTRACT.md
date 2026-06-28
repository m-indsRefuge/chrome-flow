# Chrome Flow AI Command Contract

Status: Draft v0.1

This document defines how a future AI layer may understand, propose, and request Chrome Flow actions.

The current Chrome Flow product remains deterministic and user-controlled. AI providers, local models, adapters, transformers, or browser agents must attach above this control surface. They must not bypass Chrome Flow state, Chrome permission boundaries, confirmation gates, timeline records, or recovery requirements.

## Core Rule

The AI layer may suggest actions, explain workspace state, and prepare structured commands.

The deterministic Chrome Flow layer executes only approved actions through known functions.

```text
User or AI suggestion
→ command contract
→ permission / confirmation gate
→ deterministic Chrome Flow function
→ storage update
→ timeline evidence
→ recovery path where required
```

## Authority Levels

### read_only

The command reads Chrome Flow state or browser state. It does not change browser tabs, Chrome groups, workspace records, journal, or timeline unless explicitly defined as a status-refresh event.

Examples:

- Get workspace summary
- Get tab status
- Inspect role distribution

### soft_write

The command writes to Chrome Flow workspace state but does not close browser tabs or alter destructive browser state.

Examples:

- Save workspace name
- Save workspace aim
- Assign tab role
- Add journal entry
- Add selected tabs to workspace

### browser_organization

The command changes browser organization while keeping tabs open and preserving Chrome Flow workspace records.

Examples:

- Create Chrome tab groups
- Focus tab
- Focus role group
- Remove one Chrome group
- Remove all current-workspace Chrome groups

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
writes_journal
writes_timeline
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

Preconditions: Chrome tabs permission available.

Requires user confirmation: no

Requires reason: no

Writes workspace storage: no

Writes journal: no

Writes timeline: only when the user explicitly clicks Refresh Tab Status.

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

### workspace.focusTab

Purpose: Focus a specific open browser tab from its workspace record.

Authority level: browser_organization

Inputs:

```text
tabKey
```

Preconditions: The workspace tab must exist and a live browser tab match must be found.

Requires user confirmation: no

Requires reason: no

Writes workspace storage: yes, updates live tab metadata when needed.

Writes journal: no

Writes timeline: yes

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

Preconditions: At least one live workspace tab must exist for the role.

Requires user confirmation: no

Requires reason: no

Writes workspace storage: no

Writes journal: no

Writes timeline: yes

Affects browser tabs: yes, focuses window/tab.

Affects Chrome groups: no

Closes browser tabs: no

Recovery available: not required

### workspace.createChromeGroups

Purpose: Create or update native Chrome tab groups using Chrome Flow role/subgroup assignments.

Authority level: browser_organization

Inputs: none

Preconditions: Workspace tabs exist; live browser tabs can be found; tabGroups permission is available.

Requires user confirmation: no for current deterministic UI action.

Requires reason: no

Writes workspace storage: yes, refreshes tab metadata after grouping.

Writes journal: no

Writes timeline: yes

Affects browser tabs: yes, groups tabs.

Affects Chrome groups: yes

Closes browser tabs: no

Recovery available: native ungroup actions are available.

### workspace.removeChromeGroup

Purpose: Remove one native Chrome tab group for a specific Chrome Flow role/subgroup.

Authority level: browser_organization

Inputs:

```text
roleId
roleLabel
```

Preconditions: Matching live workspace tabs must exist; matching native Chrome group must exist.

Requires user confirmation: yes

Requires reason: no

Writes workspace storage: no

Writes journal: no

Writes timeline: yes

Affects browser tabs: yes, ungroups tabs while keeping them open.

Affects Chrome groups: yes

Closes browser tabs: no

Recovery available: Create Chrome Tab Groups can recreate the grouping.

### workspace.removeAllChromeGroups

Purpose: Remove all native Chrome tab groups associated with currently live tabs in the active Chrome Flow workspace.

Authority level: browser_organization

Inputs: none

Preconditions: Matching live workspace tabs and native Chrome groups must exist.

Requires user confirmation: yes

Requires reason: no

Writes workspace storage: no

Writes journal: no

Writes timeline: yes

Affects browser tabs: yes, ungroups tabs while keeping them open.

Affects Chrome groups: yes

Closes browser tabs: no

Recovery available: Create Chrome Tab Groups can recreate the grouping.

### workspace.removeTabFromWorkspace

Purpose: Remove one tab record from Chrome Flow while keeping the browser tab open.

Authority level: destructive_browser

Inputs:

```text
tabKey
reason
```

Preconditions: Workspace tab exists.

Requires user confirmation: yes

Requires reason: yes

Writes workspace storage: yes

Writes journal: yes

Writes timeline: yes, with tab snapshot and recovery actions.

Affects browser tabs: no

Affects Chrome groups: indirectly no

Closes browser tabs: no

Recovery available: yes, Re-add to Workspace from timeline.

### workspace.closeBrowserTabAndRemoveFromWorkspace

Purpose: Close one live browser tab and remove its Chrome Flow workspace record.

Authority level: destructive_browser

Inputs:

```text
tabKey
reason
```

Preconditions: Workspace tab exists; matching live browser tab exists.

Requires user confirmation: yes

Requires reason: yes

Writes workspace storage: yes

Writes journal: yes

Writes timeline: yes, with tab snapshot and recovery actions.

Affects browser tabs: yes

Affects Chrome groups: indirectly yes, because Chrome may update or remove native group membership when the tab closes.

Closes browser tabs: yes

Recovery available: yes, Reopen URL and Re-add to Workspace from timeline.

### workspace.reopenUrlFromTimeline

Purpose: Reopen a saved URL from a structured timeline event.

Authority level: browser_organization

Inputs:

```text
eventId
```

Preconditions: Timeline event must contain a tab snapshot with URL.

Requires user confirmation: no for current deterministic UI action.

Requires reason: no

Writes workspace storage: yes if a matching workspace tab already exists and metadata is refreshed.

Writes journal: no

Writes timeline: yes

Affects browser tabs: yes, opens a browser tab.

Affects Chrome groups: no

Closes browser tabs: no

Recovery available: not required

### workspace.readdTabFromTimeline

Purpose: Restore a removed workspace tab record from a timeline snapshot.

Authority level: soft_write

Inputs:

```text
eventId
```

Preconditions: Timeline event must contain a tab snapshot.

Requires user confirmation: no for current deterministic UI action.

Requires reason: no

Writes workspace storage: yes

Writes journal: no

Writes timeline: yes

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
- Bypass timeline evidence for state-changing actions.
- Treat suggestions as executed actions.

The future AI layer may:

- Summarize workspace state.
- Suggest tab roles.
- Suggest grouping or cleanup actions.
- Identify missing or ungrouped tabs.
- Draft a plan for browser organization.
- Prepare command objects for user approval.

## Command Object Shape Draft

```json
{
  "command": "workspace.focusGroup",
  "authority_level": "browser_organization",
  "inputs": {
    "roleId": "source",
    "roleLabel": "Source"
  },
  "requires_user_confirmation": false,
  "user_facing_explanation": "Focus the first open tab in the Source group."
}
```

Destructive commands must include a proposed reason and must still require the user to confirm or revise it.

```json
{
  "command": "workspace.closeBrowserTabAndRemoveFromWorkspace",
  "authority_level": "destructive_browser",
  "inputs": {
    "tabKey": "example-tab-key",
    "reason": "No longer relevant to the current research path."
  },
  "requires_user_confirmation": true,
  "requires_reason": true,
  "user_facing_explanation": "Close this browser tab and remove it from the workspace, while preserving timeline recovery."
}
```

## Current Policy Decision

AI integration is not part of V0.2.

During V0.2, Chrome Flow should keep building deterministic control surfaces and document them in this contract.

The future AI layer will attach only after the command surface is stable enough to be described, tested, and permission-gated.
