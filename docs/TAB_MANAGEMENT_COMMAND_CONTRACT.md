# Chrome Flow V0 Tab Management Command Contract

## 1. Purpose

This document defines the command contract for the completed Chrome Flow V0 Tab Management and Organisation Layer.

The purpose of this contract is to describe the deterministic tab-management surface as a future AI-callable tool surface without implementing the AI runtime yet.

This is not an AI implementation document. It is a boundary, interface, and evidence contract. The future AI layer must treat this document as the source of truth for what tab-management actions exist, what authority they require, what inputs they accept, what outputs they must produce, and what safety conditions must be preserved.

## 2. Layer Status

```text
Layer: Tab Management and Organisation
Runtime owner: src/sidepanel/sidepanel.js
Status: V0 complete, validated, consolidated, merged
AI runtime: deferred
AI contract: active
```

The native side panel controller currently owns the validated tab-management behavior. Diagnostics and workspace session control remain separate by design.

## 3. Relationship to Future AI Layer

The future AI layer may eventually suggest, request, or prepare calls into this tab-management command surface. It must not freely manipulate Chrome tabs outside this contract.

The command contract exists so that later systems can map natural-language requests into explicit, reviewable commands such as:

```text
inspect.tab_status
workspace.add_selected_tabs
browser.create_role_groups
browser.move_workspace_to_new_window
recovery.readd_to_workspace
```

Until the AI runtime exists, all commands are still invoked by the Operator through the UI.

## 4. Core Design Principles

### 4.1 Deterministic First

The tab-management layer must behave deterministically. It should not infer user intent beyond the explicit command being invoked.

### 4.2 Operator Authority

The Operator remains the final authority for browser actions. Future AI may recommend actions, explain risks, prepare a plan, or surface a command packet, but it must not silently execute meaningful browser changes.

### 4.3 Browser State and Workspace State Are Separate

Chrome Flow tracks both:

```text
workspace record state
live browser tab/window/group state
```

Commands must be explicit about which state they affect.

### 4.4 Evidence Must Be Captured

Every meaningful command must produce inspectable evidence through workspace timeline events, updated workspace state, or diagnostics/build tooling.

### 4.5 Recovery Must Be Preserved

Commands that remove, close, ungroup, or reopen tabs must preserve enough state for recovery where practical.

## 5. Authority Classes

### 5.1 Read-Only Commands

Read-only commands inspect state and do not mutate workspace or browser state.

Examples:

```text
inspect.workspace_tabs
inspect.tab_status
inspect.duplicate_urls
inspect.recovery_history
```

Confirmation required: no.

### 5.2 Soft Workspace Write Commands

Soft workspace writes modify Chrome Flow records but do not close tabs or destroy browser state.

Examples:

```text
workspace.save_details
workspace.assign_tab_role
workspace.update_tab_alias
workspace.add_active_tab
workspace.add_selected_tabs
workspace.clear_scanned_tabs
```

Confirmation required: usually no, except where the change could cause loss of operator organisation context.

### 5.3 Browser Organisation Commands

Browser organisation commands change Chrome tab/window/group state without intentionally destroying browser tabs.

Examples:

```text
browser.create_role_groups
browser.remove_role_group
browser.remove_all_workspace_groups
browser.collapse_workspace_groups
browser.expand_workspace_groups
browser.arrange_tabs_by_role
browser.move_workspace_to_new_window
browser.focus_tab
browser.focus_group
```

Confirmation required: recommended for multi-tab movement or broad organisation changes; not required for focus actions.

### 5.4 Recovery Commands

Recovery commands use saved timeline snapshots to reopen URLs, re-add tabs to workspace, or restore grouping.

Examples:

```text
recovery.reopen_url
recovery.readd_to_workspace
recovery.restore_role_group
recovery.recreate_groups
workspace.reopen_missing_tabs
```

Confirmation required: contextual. Reopening one URL may not require confirmation; restoring multiple tabs should require confirmation.

### 5.5 Destructive or High-Impact Commands

Destructive commands close browser tabs, remove workspace records, or clear many records.

Examples:

```text
browser.close_tab_and_remove_record
workspace.remove_and_close_tab
workspace.clear_workspace_tabs
```

Confirmation required: yes.

## 6. Shared Command Envelope

Future AI/tool-registry commands should use a consistent envelope.

```json
{
  "commandId": "uuid",
  "commandName": "browser.create_role_groups",
  "authorityClass": "browser_organisation",
  "requestedBy": "operator|ai_suggestion|system",
  "requiresConfirmation": true,
  "confirmationState": "not_required|pending|approved|denied",
  "workspaceId": "uuid",
  "inputs": {},
  "preconditions": [],
  "expectedEffects": [],
  "riskSummary": "",
  "result": {
    "status": "pending|success|skipped|failed|cancelled",
    "timelineEventTypes": [],
    "evidence": {},
    "error": null
  }
}
```

## 7. Result Status Values

Commands should resolve to one of the following statuses:

```text
success     The command completed as intended.
skipped     The command safely did nothing because preconditions were not met.
failed      The command attempted to run but encountered an error.
cancelled   The Operator declined or cancelled the command.
pending     The command has been prepared but not executed.
```

## 8. Required Evidence Fields

Every command result should include enough evidence for the Operator and diagnostics layer to understand what happened.

Common evidence fields:

```text
workspaceId
tabId
workspaceTabId
windowId
groupId
roleId
roleLabel
url
displayUrl
matchStatus
candidateCount
resolutionMode
timelineEventType
recoverySourceEventId
error
```

## 9. Browser Tab Resolution Contract

Many commands depend on resolving a workspace tab record to a live Chrome tab.

Resolution modes:

```text
exact_tab_id
single_url_fallback
exact_tab_id_consumed_single_url_repair
exact_tab_id_consumed
ambiguous_url_matches
not_found
reopened_missing_tab
```

Future AI must not ignore ambiguous resolution. If a tab cannot be resolved safely, the AI should ask the Operator to clarify or recommend a manual refresh rather than guessing.

## 10. Command Groups

## 10.1 Inspect Commands

### inspect.workspace_tabs

Purpose: Return workspace tab records grouped by role.

Authority class: read_only.

Inputs:

```json
{
  "workspaceId": "uuid"
}
```

Expected output:

```json
{
  "tabs": [],
  "groups": [],
  "workspaceType": "decision|research|general"
}
```

Required behavior:

- Must not change browser state.
- Must not change workspace state.
- Should include aliases, roles, URLs, open/missing status, and group state.

### inspect.tab_status

Purpose: Return total, open, missing, grouped, ungrouped, and unassigned counts.

Authority class: read_only.

Expected output:

```json
{
  "totalTabs": 0,
  "openTabs": 0,
  "missingTabs": 0,
  "groupedTabs": 0,
  "ungroupedTabs": 0,
  "unassignedTabs": 0
}
```

### inspect.duplicate_urls

Purpose: Return same-URL workspace records for review.

Authority class: read_only.

Required behavior:

- Must distinguish exact same live tab already in workspace from same URL represented by another tab instance.
- Must not collapse different ChatGPT thread URLs merely because they are from the same domain.

### inspect.recovery_history

Purpose: Return recoverable timeline events.

Authority class: read_only.

Required behavior:

- Must identify actions available from each recovery event.
- Must preserve recovery source event ids.

## 10.2 Workspace Intake Commands

### workspace.scan_current_window

Purpose: Scan current Chrome window tabs into the intake surface.

Authority class: read_only to soft_workspace_write.

Current UI action:

```text
Scan Current Window Tabs
```

Expected timeline event:

```text
tabs_scanned
```

Required behavior:

- Should list scanned tabs without adding them automatically.
- Should mark exact already-in-workspace tabs as unavailable.

### workspace.select_all_scanned_tabs

Purpose: Select all scanned tabs that are not exact existing workspace records.

Authority class: soft_workspace_write.

Required behavior:

- Must not select disabled exact matches.
- Must not add tabs by itself.

### workspace.deselect_all_scanned_tabs

Purpose: Clear selected scanned tabs.

Authority class: soft_workspace_write.

### workspace.add_selected_tabs

Purpose: Add selected scanned tabs as workspace tab records.

Authority class: soft_workspace_write.

Expected timeline event:

```text
selected_tabs_added
```

Required evidence:

```text
addedCount
exactSkippedCount
duplicateUrlAddedCount
missingCount
intakeMatchingMode: instance_aware
```

Required behavior:

- Must block exact same tab id already present in workspace.
- May allow same-URL duplicate records when they are distinct live tab instances.
- Must assign new workspaceTabId values.
- Must preserve tabId, windowId, groupId, URL, display URL, title, firstSeenAt, and lastSeenAt.

### workspace.add_active_tab

Purpose: Add the current active Chrome tab as a workspace record.

Authority class: soft_workspace_write.

Expected timeline events:

```text
active_tab_added
active_tab_add_skipped
```

Required behavior:

- Must skip exact active tab already in workspace.
- May record sameUrlDuplicate when URL is already present under a different live tab.

### workspace.clear_scanned_tabs

Purpose: Clear the scanned intake list.

Authority class: soft_workspace_write.

Required behavior:

- Must not remove workspace records.
- Must not close browser tabs.

### workspace.open_search_tab

Purpose: Open a browser search tab and auto-add it to the workspace.

Authority class: browser_organisation plus soft_workspace_write.

Expected timeline events:

```text
browser_search_tab_opened
browser_search_tab_added_to_workspace
```

Required evidence:

```text
query
url
tabId
workspaceTabId
searchLaunchAutoIntake: true
searchQuery
sameUrlDuplicate
```

Required behavior:

- Must open the search URL.
- Must add the resulting browser tab to the workspace.
- Must not require helper-module behavior outside native sidepanel controller.

## 10.3 Workspace Metadata Commands

### workspace.save_details

Purpose: Save workspace name, aim, and type.

Authority class: soft_workspace_write.

Expected timeline event:

```text
workspace_saved
```

### workspace.update_type

Purpose: Change workspace type and reset invalid roles to unassigned.

Authority class: soft_workspace_write.

Expected timeline event:

```text
workspace_type_updated
```

Required behavior:

- Must preserve valid role assignments.
- Must reset roles that are not valid for the new workspace type.

### workspace.assign_tab_role

Purpose: Assign a workspace tab to a role group.

Authority class: soft_workspace_write.

Expected timeline event:

```text
tab_role_updated
```

Required behavior:

- Must update workspace metadata.
- Must not automatically move the live tab between Chrome groups in V0.
- Future AI may suggest recreating Chrome groups after several role changes.

### workspace.update_tab_alias

Purpose: Assign or update a human-readable alias for a workspace tab.

Authority class: soft_workspace_write.

Expected timeline event:

```text
tab_alias_updated
```

## 10.4 Chrome Group Commands

### browser.create_role_groups

Purpose: Create native Chrome tab groups based on workspace roles.

Authority class: browser_organisation.

Current UI action:

```text
Create Chrome Tab Groups
```

Expected timeline event:

```text
chrome_tab_groups_created
```

Required evidence:

```text
groups
groupedTabCount
skippedCount
skippedResolutionResults
resolutionMode: stable_one_to_one
resolutionResults
```

Required behavior:

- Must group only safely resolved live workspace tabs.
- Must skip missing or ambiguous tabs.
- Must title groups using role/workspace title convention.
- Must update workspace tab groupId and windowId.

### browser.remove_all_workspace_groups

Purpose: Remove all native Chrome groups for resolved workspace tabs while keeping browser tabs open.

Authority class: browser_organisation.

Expected timeline event:

```text
chrome_tab_groups_removed
```

Required behavior:

- Must not close browser tabs.
- Must preserve workspace records.
- Must provide recovery action to recreate groups.

### browser.remove_role_group

Purpose: Remove native Chrome grouping for one role group while keeping browser tabs open.

Authority class: browser_organisation.

Expected timeline event:

```text
chrome_tab_group_removed
```

Required behavior:

- Must only ungroup tabs for the requested role.
- Must not remove workspace records.
- Must not close browser tabs.

### browser.collapse_workspace_groups

Purpose: Collapse all native Chrome groups belonging to the workspace.

Authority class: browser_organisation.

Expected timeline event:

```text
chrome_tab_groups_collapsed
```

### browser.expand_workspace_groups

Purpose: Expand all native Chrome groups belonging to the workspace.

Authority class: browser_organisation.

Expected timeline event:

```text
chrome_tab_groups_expanded
```

## 10.5 Browser Navigation and Arrangement Commands

### browser.focus_tab

Purpose: Focus a specific resolved workspace tab.

Authority class: browser_organisation.

Expected timeline event:

```text
workspace_tab_focused
```

Required behavior:

- Must use safe tab resolution.
- Must not focus ambiguous tabs.
- Must not change workspace records except timeline evidence.

### browser.focus_group

Purpose: Focus a tab within a specific role group.

Authority class: browser_organisation.

Expected timeline event:

```text
workspace_group_focused
```

Required behavior:

- Must focus a live tab in that role group.
- Must prefer a grouped live tab when available.

### browser.arrange_tabs_by_role

Purpose: Reorder open workspace tabs by workspace role order.

Authority class: browser_organisation.

Expected timeline event:

```text
workspace_tabs_arranged_by_role
```

Required behavior:

- Must operate per window.
- Must preserve all workspace tab records.
- Must not close tabs.

### browser.move_workspace_to_new_window

Purpose: Move all open workspace tabs into a new Chrome window and recreate role groups there.

Authority class: browser_organisation, high impact.

Expected timeline event:

```text
workspace_tabs_moved_to_new_window
```

Required evidence:

```text
newWindowId
primaryTabId
tabIds
workspaceTabIds
resolutionMode: stable_one_to_one
newWindowCreationMode: primary_tab_new_window_focus_recovery_v2
finalWindow
recreatedChromeGroups: true
recreatedGroupCount
groupedTabCount
groups
```

Required behavior:

- Must use the primary-tab new-window focus recovery strategy.
- Must not use a temporary blank-tab strategy.
- Must recreate role groups in the new window.
- Must leave the new window open and normal/focused where possible.

## 10.6 Recovery Commands

### recovery.reopen_url

Purpose: Reopen a URL from a recovery timeline event.

Authority class: recovery.

Expected timeline event:

```text
timeline_url_reopened
```

Required behavior:

- Must only reopen the URL.
- Must not automatically add the tab back to the workspace.
- Must not automatically restore grouping.

### recovery.readd_to_workspace

Purpose: Re-add a recovered tab snapshot to the workspace and restore grouping when appropriate.

Authority class: recovery plus browser_organisation.

Expected timeline events:

```text
workspace_tab_readded
recovered_tab_group_restored
```

Required behavior:

- If Reopen URL was used first, must reuse the already reopened browser tab when safely resolved.
- If the tab is not open, may reopen it using the saved URL.
- Must restore the workspace tab record from snapshot.
- Must restore the tab into its matching role group when possible.
- Must title newly created recovery groups.

Known wording polish:

- Some trace messages may currently say a tab was already in workspace/open when the record is being restored. This is non-blocking behaviorally but should be cleaned up later.

### recovery.restore_role_group

Purpose: Restore a recovered tab into its role-based Chrome group.

Authority class: recovery plus browser_organisation.

Expected timeline event:

```text
recovered_tab_group_restored
```

Required evidence:

```text
recoverySourceEventId
workspaceTabId
tabId
roleId
roleLabel
groupTitle
windowId
groupId
restoreMode
```

### workspace.reopen_missing_tabs

Purpose: Reopen workspace tab records that still exist but whose live browser tabs are missing.

Authority class: recovery.

Expected timeline events:

```text
missing_workspace_tabs_reopened
missing_workspace_tabs_reopen_skipped
```

Required behavior:

- Must only reopen safely missing tabs.
- Must not reopen ambiguous URL matches.
- Must update workspace tab records with new live tab ids.
- Does not automatically create role groups; grouping can be restored by browser.create_role_groups.

## 10.7 Destructive Commands

### browser.close_tab_and_remove_record

Purpose: Close a browser tab and remove its workspace record.

Authority class: destructive.

Current UI action:

```text
Close Browser Tab
```

Expected timeline event:

```text
browser_tab_closed_and_removed
```

Required behavior:

- Must require Operator confirmation.
- Must prompt for reason where current UI requires it.
- Must close the live browser tab.
- Must remove the workspace record.
- Must preserve recovery snapshot.

### workspace.remove_and_close_tab

Purpose: Remove workspace record and close the corresponding live browser tab.

Authority class: destructive.

Current UI action:

```text
Remove + Close Tab
```

Expected timeline event:

```text
workspace_tab_removed
```

Required evidence:

```text
browserTabClosed
browserTabFound
liveTabId
liveWindowId
liveGroupId
closeError
removeMode: remove_workspace_and_close_browser_tab
recoveryActions.canReopenUrl: true
recoveryActions.canReaddToWorkspace: true
```

Required behavior:

- Must require Operator confirmation.
- Must remove the workspace record.
- Must close the browser tab when safely resolved.
- Must preserve recovery snapshot.

### workspace.clear_workspace_tabs

Purpose: Clear all workspace tab records while keeping browser tabs open.

Authority class: destructive workspace-record action.

Expected timeline event:

```text
workspace_tabs_cleared
```

Required behavior:

- Must require Operator confirmation.
- Must not close browser tabs.
- Must clearly state that only workspace records are being cleared.

## 11. AI Suggestion Contract

Future AI may suggest tab-management actions using a proposal shape like:

```json
{
  "proposalId": "uuid",
  "summary": "Create Chrome groups for the current workspace roles.",
  "recommendedCommands": [
    {
      "commandName": "browser.create_role_groups",
      "authorityClass": "browser_organisation",
      "requiresConfirmation": true,
      "reason": "All workspace tabs are role-assigned but currently ungrouped.",
      "expectedEffects": [
        "Create native Chrome tab groups by role",
        "Keep all browser tabs open",
        "Update workspace tab group IDs"
      ]
    }
  ],
  "risks": [
    "Chrome group layout will change"
  ],
  "operatorDecision": "pending"
}
```

The AI must not execute this proposal directly in V0.

## 12. Preconditions for Future Tool Registry

Before any AI tool registry is allowed to call these commands directly, the system must have:

```text
- explicit command schema validation
- permission gate
- Operator approval UI
- rollback/recovery visibility
- command result packet
- diagnostic result packet
- action trace timeout/failure handling
- policy classification per command
```

## 13. Deferred Features

The following are intentionally deferred and should not be added to the tab-management layer during this contract sprint:

```text
auto-regroup on role change
AI role classification
AI natural-language tab execution
close all workspace tabs
full layout save/restore
AI planner/runtime
tool registry runtime
```

## 14. Acceptance Criteria for This Contract

This command contract is accepted when:

```text
- every current tab-management action is represented;
- authority class is clear for each action;
- confirmation expectations are clear;
- browser state vs workspace state effects are clear;
- recovery obligations are clear;
- future AI permission boundaries are explicit;
- implementation remains deferred.
```
