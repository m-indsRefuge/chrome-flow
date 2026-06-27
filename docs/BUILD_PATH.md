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

## V0.2B Workspace Tab Management

Planned:

- Remove tab from workspace
- Refresh workspace tab metadata
- Preserve aliases and roles during refresh
- Prevent duplicate workspace tabs more robustly

## V0.2C Native Chrome Tab Grouping

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
