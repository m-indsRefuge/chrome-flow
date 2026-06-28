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
6. Confirm each workspace tab has Focus Tab, Close Browser Tab, and Remove from Workspace controls.
7. Click Focus Tab on an open workspace tab.
8. Confirm Chrome switches to that browser tab/window.
9. Confirm the timeline records the focus action.
10. Click Close Browser Tab on a workspace tab.
11. Confirm Chrome asks for confirmation before closing the actual browser tab and removing it from the workspace.
12. Confirm the browser tab closes after confirmation.
13. Confirm the workspace record is removed from the active workspace.
14. Confirm the timeline records the close-and-remove action.

## V0.2F Structured timeline recovery checklist

1. Open the Chrome Flow side panel.
2. Confirm Reopen URL is not shown on normal workspace tab cards.
3. Click Close Browser Tab on one workspace tab.
4. Confirm Chrome asks for close-and-remove confirmation.
5. Confirm Chrome Flow asks for a reason.
6. Enter a reason and complete the close.
7. Confirm the browser tab closes.
8. Confirm the workspace record is removed from the active workspace.
9. Confirm the journal contains an entry with the close reason and URL.
10. Confirm the timeline close-and-remove event shows the reason, tab snapshot, Reopen URL, and Re-add to Workspace buttons.
11. Click Reopen URL from that timeline event.
12. Confirm the saved URL opens in a new browser tab.
13. Confirm the timeline records the recovery action.
14. Click Re-add to Workspace from that timeline event.
15. Confirm the tab snapshot is restored to the workspace.
16. Click Remove from Workspace on one workspace tab.
17. Confirm Chrome Flow asks for confirmation and a reason.
18. Enter a reason and complete the removal.
19. Confirm the browser tab itself remains open.
20. Confirm the workspace record is removed.
21. Confirm the journal contains an entry with the removal reason and URL.
22. Confirm the timeline removal event shows the reason, tab snapshot, Reopen URL, and Re-add to Workspace buttons.
23. Click Re-add to Workspace from that timeline event.
24. Confirm the tab snapshot is restored to the workspace.
25. Click Reopen URL from that same timeline event.
26. Confirm the saved URL opens in a browser tab.

## V0.2G Native Chrome tab grouping checklist

1. Pull the latest repo and reload the extension in chrome://extensions.
2. Accept the new tabGroups permission if Chrome prompts for it.
3. Open several tabs and add them to the workspace.
4. Assign at least two different roles to workspace tabs.
5. Click Create Chrome Tab Groups.
6. Confirm Chrome creates native tab groups using Chrome Flow role labels.
7. Confirm tabs assigned to the same role are grouped together.
8. Confirm tabs assigned to different roles are grouped separately.
9. Confirm closed or missing workspace tabs are skipped safely.
10. Confirm the status message reports created groups, grouped tabs, and skipped tabs.
11. Confirm the timeline records the native grouping action.
12. Click Refresh Workspace Tab Metadata.
13. Confirm workspace metadata still refreshes after native grouping.

## V0.2G patch workspace-named grouping and ungroup checklist

1. Open Chrome Flow.
2. Save a clear Workspace Name.
3. Add several open tabs to the workspace.
4. Assign tabs to at least two different roles.
5. Click Create Chrome Tab Groups.
6. Confirm native Chrome tab group names follow Workspace Name: Role.
7. Change one tab's role in Chrome Flow.
8. Click Create Chrome Tab Groups again.
9. Confirm the changed tab moves into the new native role group.
10. Click Remove Chrome Tab Groups.
11. Confirm Chrome asks before removing native grouping.
12. Confirm browser tabs stay open.
13. Confirm Chrome Flow workspace records stay unchanged.
14. Confirm native Chrome groups for the current workspace name are removed.
15. Confirm the timeline records the ungroup action.
16. Click Create Chrome Tab Groups again.
17. Confirm workspace-named groups can be recreated.

## V0.2G patch 2 role-first grouping and per-group ungroup checklist

1. Open Chrome Flow.
2. Save a Workspace Name with multiple words, such as Chrome Workflow Test.
3. Add several open tabs to the workspace.
4. Assign tabs to at least two different roles.
5. Click Create Chrome Tab Groups.
6. Confirm native group labels show role first, such as Source · CWT or Video · CWT.
7. Confirm the role/subgroup name remains visible in the Chrome tab strip.
8. Confirm each role subgroup in Chrome Flow has a Remove Chrome Group button.
9. Click Remove Chrome Group for one role only.
10. Confirm Chrome asks for confirmation.
11. Confirm browser tabs stay open.
12. Confirm Chrome Flow workspace records stay unchanged.
13. Confirm only that role's native Chrome group is removed.
14. Confirm other native Chrome groups remain intact.
15. Confirm the timeline records the per-group ungroup action.
16. Click Remove All Chrome Tab Groups.
17. Confirm only current-workspace native groups are removed.
18. Confirm browser tabs stay open and workspace records remain unchanged.

## V0.2H Workspace tab status and group focus checklist

1. Open Chrome Flow.
2. Confirm Workspace Tab Status appears above the search controls.
3. Confirm status shows Total, Open, Missing, Grouped, Ungrouped, and Unassigned counters.
4. Add several tabs to the workspace.
5. Confirm Total and Open counters update.
6. Assign roles to some tabs and leave at least one tab unassigned.
7. Confirm the Unassigned counter reflects unassigned workspace tabs.
8. Click Create Chrome Tab Groups.
9. Confirm Grouped increases and Ungrouped decreases.
10. Close one browser tab outside Chrome Flow or remove it from the browser.
11. Click Refresh Tab Status.
12. Confirm Missing increases.
13. Confirm the timeline records the explicit status refresh.
14. Confirm each role subgroup has a Focus Group button.
15. Click Focus Group for a role with open tabs.
16. Confirm Chrome activates a tab from that role subgroup.
17. Confirm the timeline records the group focus action.
18. Click Focus Group for a role whose tabs are missing or closed.
19. Confirm Chrome Flow reports that no open tabs were found for that role.
20. Confirm the timeline records the skipped focus attempt.

## V0.2I Journal / System Timeline separation and Recovery View checklist

1. Open Chrome Flow.
2. Confirm the old Journal section is now User Journal.
3. Confirm User Journal has a note tag field.
4. Confirm User Journal has a related group dropdown.
5. Add a user journal note with a tag and related group.
6. Confirm the note appears in User Journal with metadata badges.
7. Confirm the system records only a simple user_journal_added event in System Timeline.
8. Confirm System Timeline appears as its own section.
9. Confirm Recovery View appears as its own section.
10. Remove a tab from workspace and provide a reason.
11. Confirm the reason appears in System Timeline.
12. Confirm the removed tab appears in Recovery View.
13. Confirm Re-add to Workspace appears in Recovery View.
14. Confirm Reopen URL appears in Recovery View.
15. Confirm no system-generated removal note is added to User Journal.
16. Close a browser tab from Chrome Flow and provide a reason.
17. Confirm the closed tab appears in Recovery View with Reopen URL and Re-add to Workspace.
18. Remove one Chrome group.
19. Confirm Recovery View shows Recreate Chrome Groups for the group-removal event.
20. Click a Recovery View restore action and confirm the system timeline records the recovery.

## V0.2I patch journal tabbed views checklist

1. Open Chrome Flow.
2. Confirm there is one top-level Journal section.
3. Confirm the Journal section has User Journal, Recovery Journal, and System Journal view tabs.
4. Confirm User Journal is selected by default.
5. Add a user note with a tag and related group.
6. Confirm the note appears in User Journal.
7. Click Recovery Journal.
8. Confirm recovery cards are shown without user notes or normal system events mixed in.
9. Click System Journal.
10. Confirm system events are shown without user notes mixed in.
11. Switch back to User Journal.
12. Confirm the user note remains visible and the tab switch did not alter stored data.
13. Remove a workspace tab and provide a reason.
14. Click Recovery Journal and confirm the restore actions appear.
15. Click System Journal and confirm the system event appears in the audit trail.

## V0.2J Developer diagnostics checklist

1. Open Chrome Flow.
2. Confirm Developer Diagnostics appears below the Journal section.
3. Confirm the diagnostics summary shows workspace, type, tab, open, grouped, and diagnostics counts.
4. Click several Chrome Flow buttons.
5. Click Refresh Diagnostics.
6. Confirm recent button clicks appear as diagnostic events.
7. Click Copy Diagnostic Packet.
8. Paste the clipboard contents into a temporary text editor and confirm it is JSON.
9. Confirm the packet includes workspace metadata, tab status, recent diagnostics, recent system events, and recent recoverable events.
10. Confirm the packet notes that workspace names, tab titles, and URLs may be included.
11. Click Clear Diagnostics.
12. Confirm diagnostics clear without clearing workspace tabs, User Journal, System Journal, or Recovery Journal.
13. Reproduce any button issue, then copy the diagnostic packet for debugging.

## V0.2J patch action result diagnostics checklist

1. Open Chrome Flow.
2. Add at least two tabs to the workspace.
3. Assign roles to those tabs.
4. Click Create Chrome Tab Groups.
5. Wait a few seconds, then click Refresh Diagnostics.
6. Confirm diagnostics include action_started and action_success for Create Chrome Tab Groups.
7. Click Remove All Chrome Tab Groups.
8. Wait a few seconds, then click Refresh Diagnostics.
9. Confirm diagnostics include action_started and action_success for Remove All Chrome Tab Groups.
10. Click Remove All Chrome Tab Groups again when no groups remain.
11. Wait a few seconds, then click Refresh Diagnostics.
12. Confirm diagnostics include action_skipped for Remove All Chrome Tab Groups.
13. Click Copy Diagnostic Packet.
14. Confirm the packet schema is diagnostic-packet-v0.2.
15. Confirm the packet includes recentActionResultDiagnostics.
16. Confirm the packet includes pendingActionTraces when an action is still being watched.
17. Cancel a confirmation prompt on a mapped action if practical.
18. Wait at least 30 seconds and confirm action_no_result_observed appears, indicating no matching System Journal event was produced.

## V0.2J patch 2 multi-step action diagnostics checklist

1. Open Chrome Flow.
2. Add at least two tabs to the workspace.
3. Assign roles to those tabs.
4. Click Create Chrome Tab Groups if no groups currently exist.
5. Remove one Chrome group so Recovery Journal exposes Recreate Chrome Groups.
6. Click Recreate Chrome Groups from Recovery Journal.
7. Wait a few seconds, then click Refresh Diagnostics.
8. Confirm diagnostics include action_started for Recreate Chrome Groups.
9. Confirm diagnostics include action_intermediate for timeline_chrome_groups_recreate_requested.
10. Confirm diagnostics include action_success only after chrome_tab_groups_created.
11. Click Copy Diagnostic Packet.
12. Confirm the packet schema is diagnostic-packet-v0.3.
13. Confirm pendingActionTraces include intermediateEventTypes and terminalEventTypes when an action is still being watched.
14. Confirm action_no_result_observed refers to no terminal System Journal event when a multi-step action does not complete.

## AI command contract checklist

1. Confirm docs/AI_COMMAND_CONTRACT.md exists.
2. Confirm the document defines authority levels.
3. Confirm the document lists current Chrome Flow command surfaces.
4. Confirm destructive browser actions require confirmation and reason capture.
5. Confirm browser organization actions are separated from destructive actions.
6. Confirm the AI layer is documented as future-only and not wired into V0.2.
