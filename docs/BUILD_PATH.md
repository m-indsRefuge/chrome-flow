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
- Closing a browser tab also removes it from the active workspace
- Browser actions are recorded in the timeline

## V0.2F Structured Timeline Recovery

Done when:

- Reopen URL is removed from normal workspace tab cards
- Closing a browser tab asks for a reason before completing
- Closing a browser tab removes it from the active workspace after capturing a recovery snapshot
- Removing a tab from the workspace asks for a reason before completing
- Close and remove actions write a journal entry with the reason and URL
- Close and remove actions create structured timeline events with a saved tab snapshot
- Timeline cards show reason, tab snapshot, and recovery controls when available
- Closed-and-removed timeline records can reopen the saved URL and re-add the tab snapshot to the workspace
- Removed-tab timeline records can re-add the tab snapshot to the workspace
- Timeline recovery actions are also recorded in the timeline

## V0.2G Native Chrome Tab Grouping

Done when:

- Extension requests the tabGroups permission
- User can explicitly create native Chrome tab groups from the workspace
- Open workspace tabs are grouped by Chrome Flow role/subgroup label
- Tabs from different browser windows are grouped separately
- Closed or missing workspace tabs are skipped safely
- Workspace tab metadata is refreshed after grouping
- Native grouping results are recorded in the timeline

## V0.2G Patch — Workspace-Named Chrome Groups and Ungroup Control

Done when:

- Native Chrome group labels use the current workspace name as the prefix
- Native Chrome group labels follow the pattern Workspace Name: Role
- Empty workspace names fall back to Chrome Flow as the group prefix
- Long workspace names and role labels are safely shortened
- User can explicitly remove native Chrome tab groups for the current workspace
- Removing Chrome tab groups ungroups tabs but keeps browser tabs open
- Removing Chrome tab groups keeps Chrome Flow workspace records unchanged
- Only groups matching the current workspace group prefix are removed
- Ungroup results are recorded in the timeline

## V0.2G Patch 2 — Role-First Group Names and Per-Group Ungroup

Done when:

- Native Chrome group labels prioritize role/subgroup name first
- Native Chrome group labels follow the pattern Role · WorkspaceInitials
- Workspace initials are generated from the saved workspace name
- Empty workspace names fall back to CF as the group token
- Existing workspace-name-prefixed legacy groups remain removable
- Each Chrome Flow role subgroup has a Remove Chrome Group action
- Per-group removal ungroups only the matching native Chrome role group
- Global removal is clearly labeled Remove All Chrome Tab Groups
- Global removal is scoped to groups containing current workspace tabs
- Browser tabs remain open and workspace records remain unchanged after ungrouping
- Per-group and global ungroup results are recorded in the timeline

## V0.2H Workspace Tab Status and Group Focus Controls

Done when:

- Workspace Tabs includes a compact tab-status panel
- Status panel shows total workspace tabs
- Status panel shows open browser tabs
- Status panel shows missing or closed workspace tabs
- Status panel shows grouped and ungrouped open tabs
- Status panel shows unassigned workspace tabs
- User can explicitly refresh tab status
- Explicit status refresh writes a timeline event
- Each Chrome Flow role subgroup has a Focus Group action
- Focus Group activates the first open tab in that role subgroup
- Focus Group prefers a tab already inside a native Chrome group when available
- Focus Group records success, skipped, or failed outcomes in the timeline

## AI Command Contract

Current draft:

- `docs/AI_COMMAND_CONTRACT.md`

Purpose:

- Define the future AI/adapter command surface before wiring in any model
- Keep AI above the deterministic Chrome Flow control layer
- Classify actions by authority level
- Preserve confirmation, reason capture, timeline evidence, and recovery rules

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
