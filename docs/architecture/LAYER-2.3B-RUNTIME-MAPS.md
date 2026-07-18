# Layer 2.3B Runtime Evidence Maps

## Status and evidence boundary

This document maps the accepted single-window implementation for concurrency review. It does not authorize or define multi-window runtime behavior. Paths and symbols are direct repository observations unless a row is marked **Inference**. Live Chrome lifecycle behavior remains unproven by this map.

The machine-readable companion is `runtime-authority-inventory.json`.

## Runtime context and lifecycle map

| Context | Entry and principal modules | Initialization | Process-local state | Persisted state | Teardown/concurrency implication |
|---|---|---|---|---|---|
| MV3 service worker | `manifest.json`; `src/background/service-worker.js`; `automatic-workspace-projection-reconciler.js` | Module evaluation registers Chrome and message listeners | debounce timer, pending trigger set, promise queue | active workspace/diagnostics in local storage | Worker replacement loses scheduler memory. Startup can request reconciliation, but durable pending-work semantics are not present. |
| Side-panel document | `sidepanel.html` and its module script entries | Every panel document loads independent ES module instances | DOM, listener guards, timers, cached reads, in-flight commands | shared runtime storage and IndexedDB | Multiple panels share durable/runtime resources but not context-local freshness or ownership. |
| Migration/options page | `migration.html`, `migration.js`, controlled validation UI | Independent extension page load | selected file, inspection packet, confirmation UI | validated import may create DB/storage data | Dedicated import lock protects import executions with the same lock name; other operation domains are not excluded. |
| Developer/validation surfaces | modules registered through `developer-mode.js` and loaded from side-panel HTML | Loaded with panel; surfaces are gated in UI | panel-local packet state and listeners | some controlled actions write validation evidence | Hidden UI is not equivalent to unloaded code. State-mutating validation remains Operator-controlled. |
| Browser projection | Chrome tabs, windows, groups | Browser-owned | browser-owned live identifiers | identifiers may be mirrored into runtime/durable records | IDs are ephemeral evidence and require revalidation. Browser projection is not durable authority. |

No manifest content-script or host-permission context exists.

## State-authority and writer map

| State/resource | Authority | Active representation | Durable representation | Important readers | Important writers | Mutation form | Concurrency concern |
|---|---|---|---|---|---|---|---|
| Active workspace | `chrome.storage.local` runtime authority | one compatibility-paired workspace object | saved snapshots in Session DB | UI, save, reconciliation, archive/resume | workspace store, UI controls, reconciliation, resume | whole-object read/modify/write | disjoint changes can be overwritten by a later writer |
| Active workspace normalization | same active runtime authority | `getWorkspace()` reads, normalizes, then calls `saveWorkspace()` | none directly | callers across side-panel modules | `getWorkspace()` through `saveWorkspace()` | apparent read followed by full compatible write | a read-like call can join whole-object write races and emit storage changes |
| Active selection | current `settings.activeWorkspaceId` contract | selected ID exposed to extension pages | one IndexedDB settings row | library, projection and resume surfaces | session repository save/selection/import paths | `put` of one global key | cannot express independent assignments per window |
| Workspace metadata | active workspace object | name, aim, type and related fields | workspace snapshot | side panel and snapshot builders | metadata autosave and controls | whole-object replacement | stale panel can restore older unrelated fields |
| Workspace tabs | active workspace `tabs` | record identity plus browser projection fields | `workspaceTabs` and projection records | UI, reconciler, archive/resume | intake/controls/reconciler/resume | array/object replacement and projection patch merged into whole object | runtime writers are not in one common transaction domain |
| Journal/timeline | active arrays | arrays inside active workspace | per-record `journalEntries`/`timelineEvents` on save | UI and snapshot repository | workspace store, reconciler and controls | append followed by whole-object write | concurrent append can be lost |
| Diagnostics | compatibility-paired ring and unique event shards | local storage evidence plus module-local queue | local storage only | diagnostic and validation surfaces | diagnostic event store and runtime modules | shard creation plus ring/shard merge, deduplication, and reconciliation | unique shards mitigate plain-array loss; permanent cross-context loss remains unproven and requires adapter/live convergence evidence |
| Archive | compatibility-paired local archive | archive records in local storage | legacy runtime archive contract | restore/session controls | archive controls/runtime store | whole archive replacement | no observed common lock with other mutations |
| Workspace Library | durable memory | UI-derived list | multi-store IndexedDB snapshot | library and resume | snapshot/session repositories and import | multi-store `put` or create-only `add` | DB atomicity does not serialize the source runtime read |
| Save coordinator | compatibility-paired session-preferred identity | latest signature/revision evidence | session storage, local fallback | side-panel save/refresh modules | save bridge | coordinator replacement | coordinates duplicate saves, not all runtime mutations |
| Migration state | protected migration marker | compatibility evidence | local storage | bootstrap and migration validation | migration engine/import | create/mirror under migration contracts | separate from runtime mutation coordination |

## Lock and operation-domain map

| Lock name | Protected operation | Resources touched | Operations not excluded by the name | Evidence |
|---|---|---|---|---|
| `chrome-flow-workspace-library-save` | Workspace Library production save | runtime snapshot read, IndexedDB snapshot, coordinator, diagnostics | resume, import, archive, reconciliation, metadata/journal edits | Observed |
| `chrome-flow-workspace-resume-transaction` | resume/hydration transaction | browser tabs/windows/groups, active runtime, diagnostics/evidence | save, import, archive, reconciliation | Observed |
| `constellation-data-import-execution-v0.1` | create-or-identical import | multiple IndexedDB stores and storage keys | save, resume, archive, reconciliation | Observed |
| none observed | automatic reconciliation | all browser tabs, active workspace, timeline, diagnostics | all lock-protected operations | Observed |
| none observed | archive close/runtime archive write | browser tabs, archive/runtime evidence | all lock-protected operations | Observed |

**Inference:** distinct Web Lock names do not mutually exclude by default. This is lock-domain evidence, not proof that every listed production overlap occurs live. Lock ordering and a future common coordination model remain architectural questions.

## Event and listener map

| Identity/trigger | Status | Producer | Consumer/context | Payload/correlation | Duplicate/replay and lifecycle |
|---|---|---|---|---|---|
| Chrome tab/window/group listeners | Chrome contract | Chrome | service worker | event-specific browser IDs | events are coalesced in a process-local trigger set; scheduled memory can disappear with worker replacement |
| `constellation-reconcile-workspace-projection` / `chrome-flow-reconcile-workspace-projection` | canonical/legacy protected pair | extension pages | service-worker `runtime.onMessage` | trigger and sender tab/window when supplied; no durable operation ID | accepted request is not persisted for replay |
| `chrome-flow-workspace-projection-reconciled` | current producer identity | reconciler | open extension contexts | reconciliation summary | send failure when no panel is open is intentionally tolerated |
| `constellation-workspace-library-save-completed` / `chrome-flow-workspace-library-save-completed` | canonical/legacy protected pair | save/compatibility surfaces | library refresh listeners | save result/coordinator evidence | compatibility policy emits/accepts both; each panel may refresh independently |
| manual save click / automatic storage-change save | mixed save triggers | Operator button or storage listener | save bridge | content signature and shared coordinator | `manual_or_automatic` authority classification; both paths use the same production save lock and this classification is not itself a safety defect |
| `chrome.storage.onChanged` | Chrome contract | storage writes | compatibility, diagnostics and refresh modules | key/area changes | listeners are registered per document; module-local guards are not cross-document ownership |
| DOM click/change/custom events | page-local | Operator/UI modules | same side-panel or migration page | generally operation-specific; some resume/import paths carry operation evidence | stale document state is not uniformly paired with expected runtime revision |

## Projection ownership and identity-gap map

| Identity | Current nature | Durable? | Revalidation | Gap or constraint |
|---|---|---|---|---|
| `workspaceId` | deterministic workspace identity | yes | validate before attachment/mutation | remains the primary workspace identity |
| session/projection IDs | durable memory record identities | yes | validate record relationships | a saved projection is evidence, not a live browser assignment |
| `workspaceTabId` | stable workspace membership record | yes | validate before binding a live tab | correctly separates membership from Chrome tab ID |
| Chrome `tabId` | browser-derived projection evidence | no | required | can be stale/reused across lifecycle |
| Chrome `windowId` | browser-derived projection evidence | no | required | several windows can exist without independent durable assignment |
| Chrome `groupId` | browser-derived projection evidence | no | required | group ownership is window-scoped and ephemeral |
| active `workspaceId` selection | one global settings pointer | yes | current readers use one key | cannot express per-window selection |
| future `contextId`, `runtimeAssignmentId`, `projectionEpoch`, `workspaceRevision`, `expectedRevision` | proposed review vocabulary only | undesigned | undesigned | must not be treated as an implemented contract |

The existing projection matcher intentionally prefers exact tab ID, then a unique URL fallback, and leaves ambiguous same-URL matches unresolved. Window-aware ownership should preserve that refusal-to-guess property.

## Known inventory limitations

- Static inventory does not prove dynamic reachability or live listener ordering.
- Some validation-only modules can mutate controlled fixtures and were not executed.
- The inventory checker verifies schema, paths, anchors, required contexts, operation classes, and protected identity representation. It is not a JavaScript parser.
- Test-only models characterize semantics and representational gaps; they do not prove Chrome service-worker suspension or simultaneous real-panel behavior.
