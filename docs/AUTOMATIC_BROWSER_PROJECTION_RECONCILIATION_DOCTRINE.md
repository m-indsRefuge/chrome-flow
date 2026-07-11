# Automatic Browser Projection Reconciliation Doctrine

## Status

Committed for Layer 2.1I-A.

## Core Rule

Constellation automatically maintains the live browser projection of every active workspace. End users are never responsible for refreshing metadata or status counters.

The Operator manages workspace membership and meaning. The engine observes browser projection state and reconciles existing workspace records automatically.

## Authority Model

Browser events are evidence about the live projection. They are not authority to add or remove workspace membership.

The automatic reconciler may:

- update browser-derived fields on an existing workspace tab record;
- mark an existing record missing when its live tab disappears;
- reconnect an existing missing record when a safe deterministic match exists;
- update title, URL, tab ID, window ID, group ID, index, open state, and last-seen metadata;
- update derived counters, badges, and product surfaces;
- emit compact diagnostics and meaningful lifecycle events;
- allow the existing Workspace Library bridge to persist the resulting runtime state downstream.

The automatic reconciler must not:

- silently add unrelated browser tabs to a workspace;
- silently remove workspace records;
- guess between ambiguous same-URL browser tabs;
- change aliases, roles, workspace metadata, journal content, or Operator directives;
- make Session DB the active runtime authority;
- bypass explicit Operator confirmation for browser-control actions.

## Matching Policy

Matching remains deterministic and instance-aware:

1. exact live tab ID;
2. safe unique URL fallback among unconsumed live tabs;
3. ambiguous URL matches remain unresolved;
4. no safe match marks the workspace record missing.

Same-URL workspace records remain valid. The reconciler must preserve one-to-one matching and never bind two workspace records to one live browser tab.

## Event-Driven Coverage

Automatic reconciliation should be scheduled after relevant browser changes, including:

- tab creation;
- tab removal;
- tab update, navigation, or title change;
- tab movement;
- tab attachment to or detachment from a window;
- tab replacement;
- tab grouping or ungrouping;
- Chrome group update or removal;
- window removal;
- extension startup or installation;
- side-panel startup as a repair check.

Browser event bursts must be debounced and coalesced into one reconciliation pass.

## Concurrency and Merge Boundary

The reconciler must not replace the active workspace from a stale read.

Required flow:

1. read the active runtime workspace;
2. read current browser tabs;
3. calculate browser-projection patches by `workspaceTabId`;
4. reread the latest runtime workspace;
5. merge only browser-derived projection fields into records that still exist;
6. append only meaningful transition events;
7. save once to `chrome.storage.local`;
8. notify product surfaces;
9. allow the existing Workspace Library bridge to persist the updated runtime snapshot.

This protects concurrent changes to aliases, roles, journal entries, name, aim, type, lifecycle state, and other Operator-owned fields.

## Product Surface Rule

The end-user product surface must not expose maintenance controls named:

- Refresh Workspace Tab Metadata
- Refresh Tab Status

Those controls are internal implementation mechanisms and should be removed from the normal product UI.

Counters, cards, missing-state badges, group state, and open-state indicators must update automatically.

## Journaling and Diagnostics

Routine no-change reconciliation should remain silent in the System Journal.

Meaningful transitions may emit events such as:

- `workspace_tab_became_missing`;
- `workspace_tab_reconnected`;
- `workspace_tab_window_changed`;
- `workspace_tab_group_changed`;
- `workspace_tab_url_changed`.

Developer Diagnostics should record compact reconciliation summaries containing trigger sources, records examined, records changed, open count, missing count, ambiguous count, and duration.

## Persistence Boundary

`chrome.storage.local` remains the active runtime authority.

Session DB remains durable workspace memory downstream of active runtime state. Automatic reconciliation must use the existing Workspace Library save bridge rather than creating a second persistence path.

## Validation Requirement

Layer 2.1I-A is complete only after live validation proves:

- closing a workspace tab directly in Chrome updates counters and cards without manual refresh;
- reopening a unique missing tab reconnects automatically;
- moving and grouping workspace tabs updates projection metadata automatically;
- unrelated tabs remain outside the workspace;
- ambiguous same-URL cases are not guessed;
- multiple side panels converge without duplicate durable saves;
- no manual refresh controls remain on the end-user surface;
- no stale write erases Operator-owned workspace data.

## Approved Sequence

1. Layer 2.1I-A Automatic Browser Projection Reconciliation
2. focused live reconciliation validation
3. resume Layer 2.1I comprehensive validation
4. final Codex review
5. Layer 2.2 naming migration
6. Algorithmic & Mathematical Foundation Phase
