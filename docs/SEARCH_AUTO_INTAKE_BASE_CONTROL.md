# Search Auto-Intake Base Control

## Purpose

When the Operator launches a search from Chrome Flow, the newly opened search tab should automatically enter the current workspace.

This avoids the previous flow:

```text
Open Search Tab
Scan Current Window Tabs
Select the search tab
Add Selected Scanned Tabs to Workspace
```

The new flow is:

```text
Open Search Tab
Chrome Flow opens the search tab
Chrome Flow auto-adds that launched tab to the workspace
```

## Validation Status

Status: **validated and accepted for native integration**.

The validation pass confirmed that launched search tabs are automatically added to the workspace, carry `searchLaunchAutoIntake: true`, preserve `searchQuery`, accept normal role assignment, participate in native Chrome grouping, support focus actions, and appear correctly in exported workspace packets.

## Current Runtime Placement

This is currently loaded with the restored base runtime path:

```text
diagnostics.js
sidepanel.js
workspace-session-control.js
search-workspace-intake.js
```

The advanced controls module remains unloaded while the base layer is being protected and validated.

## Behavior

The module listens to `openSearchTabButton`.

After the native sidepanel search action opens a Google search tab, the module:

- confirms the active tab is the likely launched search tab
- adds it to the active workspace if it is not already present
- marks it with `searchLaunchAutoIntake: true`
- preserves the original `searchQuery`
- records `browser_search_tab_added_to_workspace`
- records diagnostic action `search_tab_auto_added_to_workspace`
- refreshes the workspace tab view through the existing metadata refresh control

## Native Integration Plan

Do not rewrite the restored native controller in a micro-sprint.

Accepted plan:

```text
1. Keep search-workspace-intake.js loaded with the base layer for now.
2. During the next native controller rewrite pass, merge this behavior into sidepanel.js.
3. Remove search-workspace-intake.js from sidepanel.html.
4. Delete search-workspace-intake.js after native integration validates.
5. Confirm Open Search Tab still records browser_search_tab_opened and browser_search_tab_added_to_workspace.
```

Reason:

The base controller was recently restored after a regression. The search auto-intake behavior is validated, but moving it into `sidepanel.js` requires replacing the full controller file through the GitHub contents API. That should happen only during a deliberate native-controller rewrite pass.

## Validation

1. Start from a clean or known workspace.
2. Enter a search query.
3. Click Open Search Tab.
4. Confirm a browser search tab opens.
5. Confirm the search tab appears in Workspace Tabs without scanning.
6. Confirm System Journal records `browser_search_tab_opened`.
7. Confirm System Journal records `browser_search_tab_added_to_workspace`.
8. Confirm the new workspace tab has `searchLaunchAutoIntake: true` in the workspace packet.
9. Confirm Diagnostic Packet includes `search_tab_auto_added_to_workspace`.
10. Confirm the base selected scanned-tab intake still works after this test.
