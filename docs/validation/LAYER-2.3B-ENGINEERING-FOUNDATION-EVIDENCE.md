# Layer 2.3B Engineering Foundation Evidence

## Scope

This phase adds pure repository tooling, characterization tests, inventories, architecture maps, CI, and manual experiment specifications. It makes no production runtime change and does not claim live Chrome validation.

## Automated evidence

Canonical commands:

```text
npm test
npm run test:characterization
npm run check:inventory
npm run check
```

The commands use Node built-ins only, have no package dependencies, do not load extension entry points, and do not access Chrome, IndexedDB, network services, or durable extension state.

Runtime requirement: Node 24 or newer. CI uses Node 24 and no package-install step.

Characterized current boundaries:

- whole-object lost update;
- concurrent journal and timeline append loss;
- one global `activeWorkspaceId` representational limit;
- distinct lock-name domains;
- process-local scheduler replacement;
- stale unversioned panel command;
- absent general replay identity;
- exact-ID-first and ambiguity-blocking projection matching;
- difference between browser-window existence and durable assignment.

These are test-only models anchored to named production paths. They prove modeled semantics and static representation, not live cross-window or service-worker lifecycle behavior.

The reconciler lost-update models reproduce its observed two-read sequence: baseline read, projection calculation, latest-workspace reread, an intervening journal or metadata write, then the reconciler's whole-object write from the captured latest reread. The model does not claim the reconciler writes from its original baseline.

`getWorkspace()` is inventoried as an observed read-normalize-write path: it reads the compatible active workspace, normalizes it, and calls `saveWorkspace()`, producing a full compatible storage write from an apparent read. Production save authority is `manual_or_automatic` because either the save button or the storage-change-triggered path can initiate it.

Permanent cross-context diagnostic loss remains unproven. Production diagnostics create unique canonical/legacy event shards, use a module-local queue, and reconstruct the ring by merging shards and ring state with deduplication. Those mechanisms mitigate the removed plain-array characterization; cross-context shard/ring convergence remains a future adapter and controlled-live-evidence requirement.

## Future acceptance matrix (non-executable)

Architecture review should decide whether future operation evidence includes `contextId`, `workspaceId`, `runtimeAssignmentId`, `projectionId`, `windowId`, `projectionEpoch`, `workspaceRevision`, `operationId`, `expectedRevision`, `mutationType`, `commitResult`, and `replayResult`.

Future accepted tests should cover stale expected revision, duplicate/replayed operation IDs, save during resume, archive during save, reconciliation during resume finalization, worker restart, two independent window assignments, detach/attach, window recreation, stale browser IDs, and rollback after partial browser mutation. No schema for these concepts is established here.

## Review boundary

The runtime inventory is deliberately lightweight: it validates paths, anchors, required fields, contexts, operation classes, and protected identities. It is not a formal JavaScript AST or completeness proof. Manual experiments remain Operator-controlled and unexecuted.
