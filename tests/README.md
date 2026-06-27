# Tests

## V0.1 Initial manual test checklist

1. Load extension in Chrome Developer Mode.
2. Open side panel.
3. Confirm the base Chrome Flow layout appears.
4. Add workspace name.
5. Add workspace aim.
6. Add journal entry.
7. Confirm timeline records the journal action.
8. Close and reopen side panel.
9. Confirm workspace state persists.

## V0.2A Selective tab intake checklist

1. Open several normal browser tabs in the same Chrome window.
2. Open the Chrome Flow side panel.
3. Click Scan Current Window Tabs.
4. Confirm scanned tabs appear in the Workspace Intake section.
5. Select only some scanned tabs with the checkboxes.
6. Click Add Selected Tabs to Workspace.
7. Confirm only selected tabs appear under Workspace Tabs.
8. Confirm unselected tabs were not added.
9. Confirm selected tabs can receive aliases.
10. Confirm selected tabs can receive roles.
11. Click Scan Current Window Tabs again.
12. Confirm tabs already in the workspace are marked as already added and cannot be selected again.
13. Confirm the timeline records scan and selected-tab add events.

## V0.2B Workspace classification checklist

1. Open the Chrome Flow side panel.
2. Confirm the Workspace Type dropdown appears in the workspace section.
3. Confirm Research Workspace is available.
4. Confirm Design Workspace is available.
5. Confirm Build Workspace is available.
6. Confirm Decision Workspace is available.
7. Confirm Learning Workspace is available.
8. Select Research Workspace and confirm tab role dropdowns show research-oriented roles.
9. Select Design Workspace and confirm tab role dropdowns show design-oriented roles.
10. Select Build Workspace and confirm tab role dropdowns show implementation-oriented roles.
11. Select Decision Workspace and confirm tab role dropdowns show decision-oriented roles.
12. Select Learning Workspace and confirm tab role dropdowns show learning-oriented roles.
13. Confirm changing Workspace Type creates a timeline event.
14. Close and reopen the side panel.
15. Confirm the selected Workspace Type persists.

## V0.2C Role-based workspace subgroup checklist

1. Open the Chrome Flow side panel.
2. Confirm workspace tabs are shown under role subgroup headings.
3. Confirm each subgroup heading shows a tab count.
4. Assign one tab to a non-default role.
5. Confirm that tab moves into the matching role subgroup.
6. Assign a second tab to the same role.
7. Confirm both tabs appear under the same subgroup.
8. Change Workspace Type.
9. Confirm the subgroup headings update to the new workspace type role set.
10. Confirm any role that does not belong to the new workspace type appears as a legacy subgroup.
11. Change a legacy role to a valid role from the current workspace type.
12. Confirm the tab moves out of the legacy subgroup and into the new valid subgroup.
13. Confirm role changes are recorded in the timeline with the target subgroup name.

## V0.2D Workspace tab management checklist

1. Open the Chrome Flow side panel.
2. Confirm Refresh Workspace Tab Metadata appears above the Workspace Tabs list.
3. Confirm each workspace tab has a Remove from Workspace button.
4. Click Remove from Workspace on one tab.
5. Confirm the browser tab itself remains open.
6. Confirm only that tab is removed from the workspace.
7. Confirm the removal is recorded in the timeline.
8. Add at least one tab back into the workspace.
9. Change that tab's alias and role.
10. Click Refresh Workspace Tab Metadata.
11. Confirm alias and role are preserved.
12. Confirm title, URL/display URL, tab ID, window ID, group ID, and last-seen metadata can refresh when the tab is still present.
13. Confirm the refresh action records how many workspace tabs were found and how many were not found.
14. Close or move a workspace tab out of the current Chrome window.
15. Click Refresh Workspace Tab Metadata again.
16. Confirm Chrome Flow reports the missing tab count without deleting the missing tab from the workspace.

## V0.2E Browser action controls checklist

1. Open the Chrome Flow side panel.
2. Confirm Open Search Tab appears above the Workspace Tabs list.
3. Enter a search query and click Open Search Tab.
4. Confirm Chrome opens a new search tab.
5. Confirm the timeline records the search-tab action.
6. Confirm each workspace tab has Focus Tab, Reopen URL, Close Browser Tab, and Remove from Workspace controls.
7. Click Focus Tab on an open workspace tab.
8. Confirm Chrome switches to that browser tab/window.
9. Confirm the timeline records the focus action.
10. Click Reopen URL on a workspace tab.
11. Confirm Chrome opens the saved URL in a new browser tab.
12. Confirm the workspace record updates to the reopened browser tab.
13. Click Close Browser Tab on a workspace tab.
14. Confirm Chrome asks for confirmation before closing the actual browser tab.
15. Confirm the browser tab closes after confirmation.
16. Confirm the workspace record remains visible and is marked as not currently open.
17. Confirm the timeline records the close action.
18. Click Reopen URL on the closed workspace record.
19. Confirm the saved URL opens again and the workspace record updates to open state.
