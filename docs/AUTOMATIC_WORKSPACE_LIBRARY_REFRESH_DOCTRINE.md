# Automatic Workspace Library Refresh Doctrine

## Status

Committed as a Layer 2.1I-A product-surface extension.

## Core Rule

The Workspace Library is a live derived view of durable workspace memory. End users are never responsible for refreshing it manually.

## Trigger Boundary

The library surface refreshes only after a durable Workspace Library transaction completes successfully.

An active-runtime edit alone is not sufficient evidence that durable memory is current. The required sequence is:

1. active runtime changes in `chrome.storage.local`;
2. the existing Workspace Library bridge performs its checked Session DB snapshot transaction;
3. the shared save coordinator publishes the completed durable revision;
4. every open side-panel context refreshes its Workspace Library view;
5. current view filters and valid selection are preserved.

## Cross-Context Rule

A save performed by one side panel must update the Workspace Library displayed in every other open side panel.

The shared durable-save coordinator is the cross-context notification boundary. The UI must not depend on a window-local custom event alone.

## Product Surface Rule

`Refresh Library` is an internal maintenance hook, not an end-user action.

The normal product surface must:

- hide the manual refresh control;
- update library counts, options, active-workspace markers, and filters automatically;
- preserve a valid selected workspace where possible;
- show a concise automatic-update status;
- keep explicit errors visible rather than replacing them with a success message.

## Efficiency Rule

Automatic refresh must be event-driven and debounced. Polling Session DB continuously is not permitted.

The side panel that performed the save may use its existing local refresh path. Other contexts refresh from the shared durable revision and must not create another durable write.

## Authority Boundary

Automatic library refresh changes only the visible derived view. It does not:

- change workspace membership;
- resume or archive a workspace;
- reopen browser tabs;
- change active runtime authority;
- create a second persistence path.

## Validation Requirement

This extension is complete only after live validation proves:

- the manual Refresh Library control is absent from the end-user surface;
- a durable change made in one side panel updates another open side panel automatically;
- workspace count and active saved-workspace identity update without manual interaction;
- the current All, Recent, or Archived view remains coherent;
- no duplicate durable snapshot is created by the surface refresh;
- failures remain visible and no extension errors occur.
