# Chrome Flow Build Path

## V0.1 Manual Cognitive Workspace

Done when:

- Extension loads in Chrome Developer Mode
- Side panel opens
- Current window tabs can be loaded
- User can create or edit workspace name
- User can create or edit workspace aim
- User can assign custom aliases to tabs
- User can assign manual tab roles
- User can add journal entries
- Timeline records key events
- Workspace persists locally

## V0.2A Selective Tab Intake

Done when:

- User can scan the current Chrome window without automatically adding every tab to the workspace
- Scanned tabs appear in a separate Workspace Intake list
- User can select one or more scanned tabs with checkboxes
- User can add only selected tabs to the workspace
- Existing workspace tabs are detected and skipped
- Selected-tab intake actions are recorded in the timeline

## V0.2B Workspace Classification and Dynamic Tab Roles

Done when:

- User can assign a workspace type/classification
- Supported workspace types are Research, Design, Build, Decision, and Learning
- Workspace type is stored with the workspace
- Workspace type changes are recorded in the timeline
- Tab role dropdowns update based on the selected workspace type
- Existing roles that no longer match the selected workspace type are preserved as legacy roles until changed

## V0.2C Role-Based Workspace Tab Subgroups

Done when:

- Workspace tabs are visually grouped under their assigned role
- Group headings use the active workspace type role labels
- Group headings show tab counts
- Changing a tab role moves the tab to the matching subgroup
- Role changes are recorded in the timeline with the target subgroup
- Legacy roles are grouped safely until changed

## V0.2D Workspace Tab Management

Done when:

- User can remove an individual tab from the workspace without closing the browser tab
- User can refresh workspace tab metadata from open browser tabs
- Refresh preserves custom aliases, tab roles, and first-seen timestamps
- Refresh updates current title, URL, display URL, window ID, group ID, tab ID, and last-seen timestamp when a match is found
- Refresh reports tabs that are no longer found in the browser
- Remove and refresh actions are recorded in the timeline

## V0.2E Browser Action Controls

Done when:

- User can open a new search tab from the workspace
- User can focus an open browser tab from its workspace tab card
- User can close an actual browser tab from its workspace tab card with confirmation
- Closing a browser tab keeps the saved workspace record
- Browser action state is reflected with open/not-open status
- Browser actions are recorded in the timeline

## V0.2F Structured Timeline Recovery

Done when:

- Reopen URL is removed from normal workspace tab cards
- Closing a browser tab asks for a reason before completing
- Removing a tab from the workspace asks for a reason before completing
- Close and remove actions write a journal entry with the reason and URL
- Close and remove actions create structured timeline events with a saved tab snapshot
- Timeline cards show reason, tab snapshot, and recovery controls when available
- Closed-tab timeline records can reopen the saved URL
- Removed-tab timeline records can re-add the tab snapshot to the workspace
- Timeline recovery actions are also recorded in the timeline

## V0.2G Native Chrome Tab Grouping

Planned:

- Add tabGroups permission
- Create a native Chrome tab group from workspace tabs
- Keep native tab grouping as an explicit user action

## V0.3 Deterministic Helpers and Export

Planned:

- Duplicate URL detection
- Same-domain grouping
- Markdown export button
- Improved timeline events
- Search query detection

## V1 Local AI Reference Integration

Planned:

- Local model provider
- Suggest tab aliases
- Summarize workspace
- Reflect on search journey
- Identify missing questions
