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
