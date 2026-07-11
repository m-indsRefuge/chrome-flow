# Layer 2.1J — Multi-Workspace Runtime and Window Binding Doctrine

## Status

Committed architectural doctrine.

This phase is inserted before completion of Layer 2.1I Stage 6 because live validation proved that Chrome can contain several simultaneous workspace projections while the current Constellation runtime remains globally singular.

## Purpose

Layer 2.1J establishes a deterministic multi-workspace spine capable of representing, recalling, controlling, and presenting several live workspaces across dedicated and mixed Chrome windows without confusing runtime authority, durable memory, browser projection, side-panel context, or future algorithmic relationships.

## Core rule

> Every live workspace owns an independent runtime record. Every Chrome window may be bound to one workspace, contain several workspace memberships, or contain none. Every side panel follows its host window by default and may safely preview other live workspaces without silently transferring control.

## Required vocabulary

### Durable workspace

A workspace record stored in the Workspace Library / Session DB. It survives browser projection loss and is reconstructable.

### Live workspace

A workspace with one or more currently resolved browser-tab projections.

### Bound workspace

The workspace explicitly associated with a Chrome window for primary control and side-panel context.

### Focused workspace

The workspace associated with the currently focused Chrome window. Focus is transient browser state, not durable authority.

### Viewed workspace

The workspace summary currently displayed in a side panel navigator. Viewing does not grant mutation authority.

### Mixed window

A Chrome window containing tabs owned by more than one workspace, or workspace-owned tabs mixed with unrelated browsing tabs.

### Dedicated workspace window

A Chrome window intentionally created or promoted to contain a primary workspace projection. Unrelated browser tabs remain outside its ownership unless explicitly added.

### Constellation session

The current collection of live workspace runtimes, window bindings, memberships, relationships, side-panel contexts, and projection evidence. A Constellation session may contain linked or unrelated workspaces.

## Authority layers

### 1. Browser projection

Chrome tabs, tab IDs, window IDs, group IDs, focus, and window placement are live evidence only.

They are mutable, session-specific, and not durable authority.

### 2. Short-term runtime memory

Short-term runtime memory owns:

- one runtime record per live workspace;
- current tab/window/group projection fields;
- window–workspace bindings;
- mixed-window membership evidence;
- focused and viewed workspace context;
- in-progress action locks and reconciliation state;
- current Constellation-session membership.

Runtime state belongs primarily in `chrome.storage.local` where it must survive side-panel closure and extension service-worker suspension. Session-only browser identifiers and context hints may use `chrome.storage.session`, but must be reconstructable from live tabs and durable workspace identity.

### 3. Durable Workspace Library memory

Session DB owns:

- durable workspace identity;
- workspace name, aim, type, lifecycle, and provenance;
- saved tab records and stable workspace-tab IDs;
- user journal entries;
- system timeline and recovery history;
- saved sessions and projections;
- archive, pause, dehydration, resume, and restoration evidence;
- explicit workspace relationships and Constellation membership records;
- deterministic summary and continuation material.

Durable memory does not become live browser authority merely because it is newer or more complete.

### 4. Deterministic relationship memory

Explicit links are stored as operator-authorized durable records.

Examples:

- member of Constellation X;
- depends on workspace Y;
- derived from workspace Z;
- shares a declared research objective;
- manually related / manually unrelated.

### 5. Algorithmic evidence

The later Algorithmic & Mathematical Foundation may calculate:

- similarity scores;
- shared-domain and shared-source evidence;
- recency and priority relationships;
- cross-workspace research-journey graphs;
- likely duplicates;
- candidate Constellation membership;
- missing-question or contradiction signals.

Algorithmic evidence is advisory and versioned. It may not silently create durable links, mutate workspace identity, or redirect side-panel control.

### 6. AI interpretation

Future AI may summarize, explain patterns, suggest links, and provide workflow insight.

AI may not own runtime identity, window binding, persistence, recovery, lifecycle transitions, or permission.

## Runtime registry

The singleton `chromeFlowWorkspace` runtime becomes a compatibility projection during migration.

The target deterministic registry is conceptually:

```js
{
  schemaVersion: "multi-workspace-runtime-v0.1",
  workspaces: {
    [workspaceId]: {
      workspaceId,
      runtimeRevision,
      name,
      aim,
      workspaceType,
      lifecycleState,
      provenance,
      tabs,
      journal,
      timeline,
      primaryWindowId,
      liveWindowIds,
      updatedAt
    }
  },
  focusedWorkspaceId,
  compatibilityActiveWorkspaceId,
  updatedAt
}
```

Each workspace update is scoped by `workspaceId` and `runtimeRevision` so stale side-panel contexts cannot overwrite another workspace or a newer revision.

## Window-binding registry

Target form:

```js
{
  schemaVersion: "window-workspace-bindings-v0.1",
  bindings: {
    [windowId]: {
      windowId,
      workspaceId,
      bindingMode,
      source,
      confidence,
      boundAt,
      lastObservedAt
    }
  }
}
```

Allowed binding modes:

- `explicit_dedicated_window`
- `explicit_operator_binding`
- `starter_workspace_current_window`
- `inferred_single_workspace_window`
- `mixed_window_unbound`
- `unbound_global_navigation`

Bindings may be rebuilt after restart from stable workspace-tab IDs, live URLs, live tab IDs where still valid, and deterministic projection reconciliation.

## Window membership index

The system must independently derive which workspace-owned tabs appear in each window:

```js
{
  [windowId]: {
    workspaceIds,
    ownedTabCounts,
    unrelatedTabCount,
    classification
  }
}
```

Classifications:

- `dedicated_single_workspace`
- `starter_single_workspace_mixed_with_unrelated_tabs`
- `mixed_multiple_workspaces`
- `no_workspace_membership`

A binding and a membership index are related but not identical. Binding expresses primary control context. Membership expresses observed browser evidence.

## Side-panel context doctrine

On startup each side panel must:

1. determine its host Chrome window;
2. inspect the binding and membership index;
3. resolve a bound workspace where deterministic evidence is sufficient;
4. enter mixed-window or global-navigation mode where it is not;
5. subscribe only to the relevant workspace runtime for mutating controls;
6. retain read-only access to the live-workspace navigator.

Default behaviour:

- dedicated or single-workspace window: follow the bound workspace;
- starter workspace in a normal browsing window: follow that workspace while retaining unrelated-tab boundaries;
- mixed multi-workspace window: require explicit workspace selection for control;
- no workspace tabs: open in global/navigation mode.

## Workspace navigator / carousel doctrine

The side panel must offer a compact horizontal active-workspace navigator.

Each card may show:

- workspace name and aim;
- type and lifecycle;
- open, missing, grouped, and unassigned counts;
- role summary;
- user-journal count;
- last meaningful activity;
- live window status;
- explicit relationship labels;
- later, algorithmic relationship evidence.

Badges distinguish:

- `BOUND HERE`
- `FOCUSED`
- `VIEWING`
- `LIVE IN ANOTHER WINDOW`
- `MIXED WINDOW`
- `PAUSED / SAVED`

Cycling to another workspace is read-only by default.

Permitted read-only actions:

- view summary;
- view role and tab counts;
- view recent journal/timeline summary;
- focus the existing workspace window;
- open the workspace side panel in its bound window;
- return to the bound workspace.

Mutating another workspace requires an explicit control transition such as `Control This Workspace` or `Pin Panel to Workspace` and must clearly change the panel’s authority indicator.

## Starter-window and dedicated-window policy

Constellation must preserve the original low-friction spark of the project.

An Operator may begin a workspace inside an ordinary browsing window when an idea emerges.

The system must not force every workspace to originate in a dedicated window.

Policy:

- 1–3 owned tabs may remain a starter workspace in the current mixed window;
- at the established threshold of 4 owned tabs, Constellation may recommend or perform an Operator-confirmed promotion to a dedicated workspace window;
- unrelated tabs remain in the source window;
- explicit Operator preference may keep a larger workspace mixed or move a smaller workspace earlier;
- promotion updates binding and membership atomically;
- dedicated-window status is a runtime policy, not a durable identity requirement.

## Resume and already-live behaviour

Workspace Library actions must be state-aware:

- non-live paused/dehydrated workspace: `Resume Workspace`;
- already-live workspace in another window: `Focus Existing Workspace`;
- workspace bound to the current window: `Open Workspace Controls`;
- ambiguous or mixed live projection: `Resolve Workspace Location`;
- archived workspace: checked recovery/resume path.

The existing duplicate-resume guard remains authoritative. The product must surface the guard result as a useful navigation action rather than appearing inert.

## Provenance and recall requirements

Every runtime activation must retain:

- activation source: new, resumed, recovered, imported, archived restore, or startup reconstruction;
- durable source workspace ID;
- source session/projection IDs where applicable;
- resume operation ID;
- previous lifecycle state;
- target-window policy;
- created, reused, skipped, and ambiguous tab counts;
- binding created or changed;
- explicit relationship memberships at activation time;
- deterministic reconstruction confidence.

Archive/resume must never create a new workspace identity unless the Operator explicitly chooses `Duplicate as New Workspace`.

## Journal and recovery separation

Each workspace retains isolated:

- User Journal;
- System Journal;
- Recovery Journal;
- diagnostic events;
- action traces;
- durable snapshot history.

Cross-workspace views may aggregate summaries, but writes remain workspace-scoped.

A global Constellation event may reference several workspace IDs, but may not be copied into each User Journal.

## Transactions and concurrency

Multi-workspace actions require:

- workspace-scoped write locks;
- window-scoped movement locks;
- global resume-operation coordination where shared browser resources are involved;
- runtime revision checks before commit;
- exact durable snapshot replacement by workspace ID;
- rollback of provisional tabs, groups, windows, and bindings before runtime commit;
- post-action verification against browser evidence;
- no cross-workspace stale overwrite.

## Deterministic invariants

1. Every workspace has one stable durable workspace ID.
2. Every live runtime record is keyed by that durable ID.
3. A browser tab may belong to at most one workspace unless an explicit future shared-reference model is introduced.
4. A window may contain several workspace memberships, but may have at most one primary binding at a time.
5. Viewing a workspace never grants mutation authority.
6. Focusing a window never changes durable workspace identity.
7. Resuming an already-live workspace never creates duplicate tabs.
8. Archive/resume provenance is preserved.
9. Automatic reconciliation updates browser-derived fields only.
10. Algorithmic and AI layers cannot mutate identity, permission, lifecycle, or persistence without deterministic and Operator-approved pathways.
11. All runtime registries are reconstructable from durable records plus live browser evidence.
12. Side-panel state must always declare whether it is bound, focused, viewed, mixed, or global.

## Layer 2.1J build sequence

1. Define and validate runtime, binding, membership, and provenance schemas.
2. Introduce a multi-workspace runtime store beside the singleton runtime.
3. Add a singleton compatibility adapter and migration mirror.
4. Register the existing live workspace into the new registry without changing visible behaviour.
5. Bind transactional resume results to destination windows.
6. Reconstruct bindings from live browser evidence at startup.
7. Resolve each side panel against its host window.
8. Add mixed-window and global-navigation states.
9. Add the active-workspace carousel / navigator in read-only mode.
10. Add `Focus Existing Workspace` and `Open Workspace Panel` actions.
11. Add explicit control/pin transitions with authority indicators.
12. Validate two simultaneous workspaces.
13. Validate three simultaneous workspaces including one mixed starter window.
14. Validate introduction of an archived/recent fifth workspace into an existing multi-workspace session.
15. Resume Layer 2.1I Stage 6 and complete cross-window coherence validation.

## Relationship to later phases

Layer 2.1J creates deterministic facts and boundaries.

The Algorithmic & Mathematical Foundation Phase later consumes those facts to calculate relationships and retrieval priority.

Future AI consumes deterministic state and algorithmic evidence to provide explanation and assistance.

Neither later layer replaces this spine.
