# Layer 2.3D Implementation Map

## Status and boundary

This document translates the accepted Layer 2.3D concurrent multi-Stella architecture into bounded, dependency-ordered implementation slices. It contains no implementation code and does not authorize production implementation, live Chrome operation, migration, merge, or release.

The accepted architecture is frozen. If source evidence encountered during a future slice conflicts with it, that slice stops for Byte–Nolan review; it does not reinterpret the architecture.

## Repository identity gate

| Check | Required | Observed before analysis | Result |
|---|---|---|---|
| Repository | `C:/Users/nolan/AIProjects/constellation` | `C:/Users/nolan/AIProjects/constellation` | Pass |
| Branch | `layer2-3d-concurrent-multi-stella-window-binding` | exact match | Pass |
| `HEAD` | `9acf296bf0fad793da7af62ad464b1a605fffc0f` | exact match | Pass |
| Upstream | `origin/layer2-3d-concurrent-multi-stella-window-binding` | exact ref | Pass |
| Upstream `HEAD` | `9acf296bf0fad793da7af62ad464b1a605fffc0f` | exact match | Pass |
| Starting tree | clean | no staged, unstaged, or untracked paths | Pass |
| Accepted artifacts | all three committed at `HEAD` | all three resolve to committed blobs | Pass |

Frozen authority:

- `docs/architecture/LAYER-2.3D-CONCURRENT-MULTI-STELLA-WINDOW-BINDING-CONTRACT.md`
- `docs/architecture/layer-2.3d-active-runtime-reader-writer-inventory.json`
- `docs/validation/LAYER-2.3D-CONCURRENT-MULTI-STELLA-EVIDENCE.md`

These files are protected from modification in every slice below.

## Source-grounded implementation topology

### Existing kernels reused unchanged

| Existing source | Reused responsibility | Constraint |
|---|---|---|
| `src/core/runtime-contract/value-utils.js` | plain-object checks, serializability, cloning, stable canonical serialization, identity/time helpers | Do not weaken fail-closed behavior. |
| `src/core/runtime-contract/revision.js` | normalized workspace revision and increment behavior | Scoped record validation must require exact agreement with this normalization. |
| `src/core/runtime-contract/ledger.js` | small pure inspect/record primitives | Reuse as primitives only; do not reuse the protected global ledger schema as the Layer 2.3D ledger. |
| `src/core/runtime-contract/mutation-engine.js` and `reducers.js` | typed semantic workspace mutation and revision conflict evaluation | Do not introduce generic whole-object replacement. |
| `src/core/runtime-contract/assignments.js` and `context.js` | assignment/context reducers and exact identity checks | Session authority remains the sole binding authority. |
| `src/core/workspace-resolution/resolver.js` and `workspace-resolution-coordination/*` | deterministic candidate resolution | Resolution cannot grant assignment authority. |
| `src/core/workspace-existing-tab-move-engine/*` | evidenced browser move planning/execution | Browser IDs remain revalidated evidence. |
| `src/core/workspace-archive-close-engine.js` | verified browser-close plan and execution | Invoke only after the new archive transaction reaches the authorized phase. |
| `src/core/session-db.js`, `session-repository.js`, `workspace-memory-store.js`, and `workspace-snapshot-repository.js` | durable workspace memory and existing save/resume/archive contracts | Physical DB, logical identity, stores, and `activeWorkspaceId` remain unchanged. |

### Existing kernels requiring versioned extension

| Family | Existing symbols | Required extension |
|---|---|---|
| Runtime session authority | `coordinateContextRegistration`, `resolveAssignmentForWindow`, `coordinateAssignmentCreate`, `coordinateAssignmentTransfer`, `coordinateAssignmentRelease`, `coordinateWindowCloseCleanup` | Integrate window/workspace-binding locks while retaining the v0.1 root and old routes. |
| Journal append | `validateJournalAppendRequest`, `coordinateJournalAppend`, `createChromeJournalAdapters` | Add a new full-assignment command path and scoped record adapter; retain the published v0.1 route. |
| Membership mutation | `snapshotAndValidateMembershipRequest`, `coordinateWorkspaceMembershipMutation`, `createWorkspaceMembershipChromeAdapters` | Add a new full-assignment schema/route and scoped workspace ledger/record access. |
| Projection reconciliation | `validateReconciliationRequest`, `coordinateWorkspaceProjectionReconciliation`, `createChromeReconciliationAdapters` | Target an exact verified assignment/scoped record; preserve unledgered observation semantics where applicable. |
| Manual placement | `coordinateWorkspaceManualPlacement`, `createWorkspaceManualPlacementChromeAdapters` | Enter scoped lock order and the versioned transfer command while preserving browser-first recovery. |
| Automatic promotion | `coordinateAutomaticWorkspacePromotion`, `createAutomaticPromotionChromeAdapters` | Enter scoped lock order and the versioned transfer command without creating a second destination on replay. |
| Resume | `resumeWorkspaceMemoryRecordSafely`, `prepareResumeWorkspaceForActivation`, `stabilizeOpenedTabProjection` | Preserve browser-first restore/rollback while wrapping it in resume-and-bind evidence and scoped locks. |

Published Layer 2.3C constants, schemas, clients, handlers, ledgers, and global lock behavior remain available for old routes. New schemas are additive and route only to new Layer 2.3D coordinators.

### Confirmed module and test conventions

- Core families use a directory containing `contract.js`, `coordinator.js`, and, where side effects exist, `chrome-adapter.js`; message families add `client.js` and `service-worker-handler.js`.
- Pure contracts import only pure core helpers. Coordinators depend on contracts and injected adapters. Chrome APIs and Web Locks remain in adapters or trusted entry points.
- Service-worker routes are terminally registered in `src/background/service-worker.js`; handlers validate sender and schema before coordination.
- Tests mirror the source family, as demonstrated by `tests/runtime-workspace-activation/runtime-workspace-activation.test.js`; they use Node 24's built-in runner with `--test-isolation=none` and deterministic fakes rather than live Chrome.
- Static purity coverage is centralized in `scripts/check-runtime-contract-purity.mjs`; inventory/path assertions are centralized in `scripts/check-runtime-inventory.mjs`.

### New production families

Every proposed parent directory (`src/core`, `tests`, `docs/validation`) exists at `HEAD`.

| Family | Exact files to create | Import direction |
|---|---|---|
| Scoped runtime record | `src/core/runtime-workspace-record/contract.js`; `src/core/runtime-workspace-record/chrome-adapter.js` | Contract → pure runtime helpers; adapter → contract and Chrome storage only. |
| Workspace operation ledger | `src/core/runtime-workspace-operation-ledger/contract.js`; `ledger.js`; `recovery-discovery.js`; `chrome-adapter.js` in that directory | Contract/ledger/discovery are pure; adapter owns local-storage enumeration and CAS verification. |
| Scoped locks | `src/core/runtime-scoped-locks/contract.js`; `ordering.js`; `chrome-adapter.js` | Contract/ordering are pure; adapter alone uses Web Locks. |
| Window binding | `src/core/runtime-window-binding/contract.js`; `coordinator.js`; `chrome-adapter.js`; `client.js`; `service-worker-handler.js`; `side-panel-authority.js` | New versioned route; consumes session authority, scoped record, and scoped locks without compatibility fallback. |
| Typed scoped mutation | `src/core/runtime-workspace-mutation/contract.js`; `coordinator.js`; `chrome-adapter.js`; `client.js`; `service-worker-handler.js` | Reuses typed mutation engine; adapter targets one scoped key and one workspace ledger. |
| Create and bind | `src/core/runtime-workspace-create-bind/contract.js`; `coordinator.js`; `chrome-adapter.js`; `client.js`; `service-worker-handler.js` | Additive command family; trusted coordinator generates assignment identity. |
| Resume and bind | `src/core/runtime-workspace-resume-bind/contract.js`; `coordinator.js`; `chrome-adapter.js`; `client.js`; `service-worker-handler.js` | Wraps existing resume engine and its browser-first recovery boundary. |
| Transfer | `src/core/runtime-workspace-transfer/contract.js`; `coordinator.js`; `chrome-adapter.js`; `client.js`; `service-worker-handler.js` | Shared by explicit transfer, manual placement, and automatic promotion. |
| Release/window close | `src/core/runtime-workspace-release/contract.js`; `coordinator.js`; `chrome-adapter.js`; `client.js`; `service-worker-handler.js` | Public explicit release plus internal-only trusted close path. |
| Archive/release | `src/core/runtime-workspace-archive-release/contract.js`; `coordinator.js`; `chrome-adapter.js`; `client.js`; `service-worker-handler.js` | Coordinates durable archive, assignment release, scoped deletion, then browser close. |
| Replacement | `src/core/runtime-workspace-replacement/contract.js`; `coordinator.js`; `chrome-adapter.js`; `client.js`; `service-worker-handler.js` | Candidate-owned ledger; prior/candidate bindings and records ordered deterministically. |
| Compatibility projection | `src/core/runtime-compatibility-projection/contract.js`; `coordinator.js`; `chrome-adapter.js` | Separate post-primary phase under the one exact advisory lock. |
| Recovery startup | `src/core/runtime-workspace-recovery/coordinator.js`; `service-worker-handler.js` | Consumes read-only discovery; dispatches only to the matching versioned recovery coordinator after fresh verification. |

### Attachment points

| Required attachment | Current source point | Future attachment |
|---|---|---|
| Panel assignment evidence | `runtime-session-authority/client.js`, `runtime-workspace-activation/side-panel-runtime.js`, `sidepanel.js` | `runtime-window-binding/client.js` and `side-panel-authority.js`; render/mutation helpers receive the verified object explicitly. |
| Service-worker routes | `service-worker.js` runtime message listener | Add exact schema classifiers/handlers after existing classifiers; old handlers remain. |
| Trusted close | `service-worker.js` `chrome.windows.onRemoved` → `coordinateWindowCloseCleanup` | Internal release coordinator command; never a public runtime-message route. |
| Ordinary mutation evidence | Existing journal/membership/reconciliation envelopes | New full session/context/window/workspace/revision/assignment ID/epoch evidence before adapters run. |
| Compatibility projection | Current direct `writeCompatibleStorageValue`/`clearCompatibleStorageValue` callers | Post-primary coordinator after all primary locks release; old routes use the same serialized projection boundary without changing old schemas. |
| Recovery discovery | Service-worker startup and new-operation admission | Read-only local ledger discovery before affected-workspace mutation; exact recovery coordinator dispatch only. |
| Scoped reconciliation | `automatic-workspace-projection-reconciler.js` global scheduling | Schedule by verified workspace assignment and acquire only that workspace's projection lock. |

## Inventory closure model

Inventory v0.4 contains 28 entries, 111 primary/related occurrences, 84 unique paths, 45 direct side-panel roots, and 22 static `workspace-runtime-store.js` consumers. A repeated path receives one final disposition in this map even when it appears under several inventory entries.

### Entry-to-slice coverage

| Inventory entry | Occurrences | Primary path | Slices |
|---|---:|---|---|
| `active-workspace-identities` | 1 | `src/core/constellation-identity-contract.js` | D3D-13 |
| `compatibility-api` | 1 | `src/core/constellation-storage-compatibility.js` | D3D-13 |
| `durable-active-pointer` | 1 | `src/core/session-repository.js` | D3D-12 |
| `runtime-session-authority-family` | 4 | `src/core/runtime-session-authority/contract.js` | D3D-03, D3D-04, D3D-11 |
| `runtime-activation-family` | 5 | `src/core/runtime-workspace-activation/side-panel-runtime.js` | D3D-04, D3D-14 |
| `side-panel-entry` | 1 | `src/sidepanel/sidepanel.js` | D3D-04, D3D-05 |
| `workspace-store` | 2 | `src/core/workspace-store.js` | D3D-05 |
| `journal-family` | 4 | `src/core/journal-append-coordination/coordinator.js` | D3D-05 |
| `metadata-autosave` | 1 | `src/sidepanel/workspace-metadata-autosave.js` | D3D-05 |
| `membership-family` | 4 | `src/core/workspace-membership-mutation/coordinator.js` | D3D-06 |
| `projection-reconciliation-family` | 3 | `src/core/workspace-projection-reconciliation/coordinator.js` | D3D-06, D3D-14 |
| `workspace-library-save` | 1 | `src/sidepanel/workspace-library-save-bridge.js` | D3D-07 |
| `resume-family` | 4 | `src/core/workspace-resume-transaction-engine.js` | D3D-09 |
| `manual-placement-family` | 3 | `src/core/workspace-manual-placement-transaction/coordinator.js` | D3D-10 |
| `automatic-promotion-family` | 3 | `src/core/workspace-automatic-promotion-transaction/coordinator.js` | D3D-10 |
| `creation-assignment-family` | 1 | `src/core/workspace-creation-assignment-transaction/coordinator.js` | D3D-08 |
| `archive-family` | 3 | `src/sidepanel/workspace-archive-close-ownership-controller.js` | D3D-12 |
| `window-close-lifecycle` | 1 | `src/background/service-worker.js` | D3D-11, D3D-14 |
| `compatibility-bootstrap-listener` | 1 | `src/sidepanel/constellation-compatibility-bootstrap.js` | D3D-13 |
| `confirmed-direct-legacy-listeners` | 3 | `src/sidepanel/workspace-tab-action-contract-cleanup.js` | D3D-07, D3D-13 |
| `operation-ledger-authority-family` | 13 | `src/core/journal-append-coordination/chrome-adapter.js` | D3D-02 and operation slices |
| `standalone-legacy-runtime-files` | 5 | `src/sidepanel/advanced-tab-controls.js` | preserve; D3D-15 validation |
| `legacy-projection-reconciler-files` | 3 | `src/core/workspace-projection-reconciler.js` | preserve; D3D-15 validation |
| `durable-session-db` | 1 | `src/core/session-db.js` | preserve; D3D-12 validation |
| `runtime-tests` | 3 | `tests/runtime-workspace-activation/runtime-workspace-activation.test.js` | D3D-04, D3D-11, D3D-15 |
| `runtime-validation` | 2 | `scripts/check-runtime-inventory.mjs` | D3D-15 |
| `workspace-runtime-store-active-apis` | 23 | `src/core/workspace-runtime-store.js` | D3D-05, D3D-07, D3D-09 |
| `production-loaded-validation-surfaces` | 14 | `src/sidepanel/layer2-persistence-validation.js` | D3D-07 |

The occurrence counts sum to 111. The final path dispositions below are normative for implementation slicing.

### Structured related-path cross-reference

This cross-reference preserves inventory membership for all 111 occurrences. `P` marks the primary path and `R` marks structured related paths; the disposition itself is defined once in the unique-path ledger.

- `active-workspace-identities`: P `src/core/constellation-identity-contract.js`.
- `compatibility-api`: P `src/core/constellation-storage-compatibility.js`.
- `durable-active-pointer`: P `src/core/session-repository.js`.
- `runtime-session-authority-family`: P `src/core/runtime-session-authority/contract.js`; R `src/core/runtime-session-authority/coordinator.js`, `src/core/runtime-session-authority/chrome-adapter.js`, `src/core/runtime-session-authority/client.js`.
- `runtime-activation-family`: P `src/core/runtime-workspace-activation/side-panel-runtime.js`; R `src/core/runtime-workspace-activation/contract.js`, `src/core/runtime-workspace-activation/coordinator.js`, `src/core/runtime-workspace-activation/chrome-adapter.js`, `src/core/runtime-workspace-activation/service-worker-handler.js`.
- `side-panel-entry`: P `src/sidepanel/sidepanel.js`.
- `workspace-store`: P `src/core/workspace-store.js`; R `src/core/journal-append-coordination/readonly-workspace.js`.
- `journal-family`: P `src/core/journal-append-coordination/coordinator.js`; R `src/core/journal-append-coordination/contract.js`, `src/core/journal-append-coordination/client.js`, `src/core/journal-append-coordination/chrome-adapter.js`.
- `metadata-autosave`: P `src/sidepanel/workspace-metadata-autosave.js`.
- `membership-family`: P `src/core/workspace-membership-mutation/coordinator.js`; R `src/core/workspace-membership-mutation/contract.js`, `src/core/workspace-membership-mutation/chrome-adapter.js`, `src/core/workspace-membership-mutation/service-worker-handler.js`.
- `projection-reconciliation-family`: P `src/core/workspace-projection-reconciliation/coordinator.js`; R `src/core/automatic-workspace-projection-reconciler.js`, `src/core/workspace-projection-reconciliation/chrome-adapter.js`.
- `workspace-library-save`: P `src/sidepanel/workspace-library-save-bridge.js`.
- `resume-family`: P `src/core/workspace-resume-transaction-engine.js`; R `src/sidepanel/workspace-library-resume-gate.js`, `src/sidepanel/workspace-library-resume-transaction-controller.js`, `src/sidepanel/workspace-archive-restore-control.js`.
- `manual-placement-family`: P `src/core/workspace-manual-placement-transaction/coordinator.js`; R `src/core/workspace-manual-placement-transaction/chrome-adapter.js`, `src/core/workspace-manual-placement-transaction/service-worker-handler.js`.
- `automatic-promotion-family`: P `src/core/workspace-automatic-promotion-transaction/coordinator.js`; R `src/core/workspace-automatic-promotion-integration/chrome-adapter.js`, `src/core/workspace-automatic-promotion-integration/service-worker-handler.js`.
- `creation-assignment-family`: P `src/core/workspace-creation-assignment-transaction/coordinator.js`.
- `archive-family`: P `src/sidepanel/workspace-archive-close-ownership-controller.js`; R `src/core/workspace-runtime-store.js`, `src/core/workspace-archive-close-engine.js`.
- `window-close-lifecycle`: P `src/background/service-worker.js`.
- `compatibility-bootstrap-listener`: P `src/sidepanel/constellation-compatibility-bootstrap.js`.
- `confirmed-direct-legacy-listeners`: P `src/sidepanel/workspace-tab-action-contract-cleanup.js`; R `src/sidepanel/user-journal-action-observability.js`, `src/sidepanel/legacy-archive-projection-cleanup.js`.
- `operation-ledger-authority-family`: P `src/core/journal-append-coordination/chrome-adapter.js`; R `src/core/runtime-contract/ledger.js`, `src/core/journal-append-coordination/ledger-validation.js`, `src/core/journal-append-coordination/coordinator.js`, `src/core/runtime-workspace-activation/chrome-adapter.js`, `src/core/runtime-workspace-activation/coordinator.js`, `src/core/workspace-membership-mutation/chrome-adapter.js`, `src/core/workspace-membership-mutation/coordinator.js`, `src/core/workspace-automatic-promotion-integration/chrome-adapter.js`, `src/core/workspace-automatic-promotion-transaction/coordinator.js`, `src/core/workspace-manual-placement-transaction/coordinator.js`, `src/core/workspace-creation-assignment-transaction/coordinator.js`, `src/core/workspace-creation-assignment-transaction/state-machine.js`.
- `standalone-legacy-runtime-files`: P `src/sidepanel/advanced-tab-controls.js`; R `src/sidepanel/advanced-new-window-stability.js`, `src/sidepanel/advanced-new-window-stability-v2.js`, `src/sidepanel/remove-workspace-tab-cleanup.js`, `src/sidepanel/recovery-group-restore.js`.
- `legacy-projection-reconciler-files`: P `src/core/workspace-projection-reconciler.js`; R `src/core/workspace-projection-reconciler-v2.js`, `src/core/workspace-projection-reconciler-v3.js`.
- `durable-session-db`: P `src/core/session-db.js`.
- `runtime-tests`: P `tests/runtime-workspace-activation/runtime-workspace-activation.test.js`; R `tests/characterization/current-concurrency.test.js`, `tests/runtime-session-authority/session-authority-coordinator.test.js`.
- `runtime-validation`: P `scripts/check-runtime-inventory.mjs`; R `scripts/check-runtime-contract-purity.mjs`.
- `workspace-runtime-store-active-apis`: P `src/core/workspace-runtime-store.js`; R `src/sidepanel/layer2-legacy-archive-projection-validation.js`, `src/sidepanel/layer2-hardening-regression-harness.js`, `src/sidepanel/layer2-hardening-correlation-completeness.js`, `src/sidepanel/layer2-completion-checkpoint-packet.js`, `src/sidepanel/layer2-archive-close-ownership-validation.js`, `src/sidepanel/layer2-post-resume-verification-packet.js`, `src/sidepanel/legacy-archive-projection-cleanup.js`, `src/sidepanel/layer2-memory-contract-validation-packet.js`, `src/sidepanel/layer2-production-save-validation-packet.js`, `src/sidepanel/layer2-resume-transaction-validation.js`, `src/sidepanel/user-journal-action-observability.js`, `src/sidepanel/workspace-archive-close-ownership-controller.js`, `src/core/workspace-hydration-engine.js`, `src/core/workspace-projection-reconciler.js`, `src/core/workspace-projection-reconciler-v2.js`, `src/core/workspace-projection-reconciler-v3.js`, `src/sidepanel/workspace-library-auto-refresh.js`, `src/core/workspace-projection-reconciliation/chrome-adapter.js`, `src/sidepanel/workspace-library-save-bridge.js`, `src/sidepanel/workspace-metadata-autosave.js`, `src/core/workspace-resume-transaction-engine.js`, `src/sidepanel/workspace-tab-action-contract-cleanup.js`.
- `production-loaded-validation-surfaces`: P `src/sidepanel/layer2-persistence-validation.js`; R `src/sidepanel/layer2-lifecycle-validation-packet.js`, `src/sidepanel/layer2-memory-contract-validation-packet.js`, `src/sidepanel/layer2-post-resume-verification-packet.js`, `src/sidepanel/layer2-production-save-validation-packet.js`, `src/sidepanel/layer2-resume-transaction-validation.js`, `src/sidepanel/layer2-completion-checkpoint-packet.js`, `src/sidepanel/runtime-projection-readiness.js`, `src/sidepanel/projection-plan-preview.js`, `src/sidepanel/projection-confirmation-packet.js`, `src/sidepanel/projection-resume-preflight.js`, `src/sidepanel/projection-resume-review.js`, `src/sidepanel/projection-resume-run.js`, `src/sidepanel/projection-resume-validation-suite.js`.

### Final disposition ledger for all 84 unique inventoried paths

Only the following disposition vocabulary is used: `create`, `modify`, `extend_versioned`, `migrate_reader`, `migrate_writer`, `gate_while_unbound`, `preserve_unchanged`, `preserve_legacy_route`, `test_only`, `validation_only`, and `historical_unreferenced`.

| Existing path | Final disposition | Slice(s) | Exact intent |
|---|---|---|---|
| `src/core/constellation-identity-contract.js` | `preserve_unchanged` | D3D-13 | Keep protected compatibility and event identities. |
| `src/core/constellation-storage-compatibility.js` | `modify` | D3D-13 | Add exact snapshot/fingerprint primitives used only by serialized projection; retain identity APIs. |
| `src/core/session-repository.js` | `preserve_unchanged` | D3D-12 | Keep `activeWorkspaceId` as last-saved compatibility pointer only. |
| `src/core/runtime-session-authority/contract.js` | `preserve_legacy_route` | D3D-04 | Keep v0.1 key/schema; new command schemas live in new families. |
| `src/core/runtime-session-authority/coordinator.js` | `modify` | D3D-03, D3D-04, D3D-11 | Add injected scoped lock participation and exact trusted close helpers without changing v0.1 results. |
| `src/core/runtime-session-authority/chrome-adapter.js` | `modify` | D3D-03, D3D-04, D3D-11 | Add window/binding lock adapters; retain compare-write-verify root behavior. |
| `src/core/runtime-session-authority/client.js` | `modify` | D3D-04 | Supply current registered context to the new window-binding client. |
| `src/core/runtime-workspace-activation/side-panel-runtime.js` | `modify` | D3D-04 | Remove compatibility fallback from panel authority and delegate to verified window binding. |
| `src/core/runtime-workspace-activation/contract.js` | `preserve_legacy_route` | D3D-14 | Keep every published v0.1 identifier and validator. |
| `src/core/runtime-workspace-activation/coordinator.js` | `preserve_legacy_route` | D3D-14 | Retain old business route; no new Layer 2.3D caller uses its global workspace authority. |
| `src/core/runtime-workspace-activation/chrome-adapter.js` | `preserve_legacy_route` | D3D-14 | Retain old adapter for old schema only; static checks forbid new routes importing it. |
| `src/core/runtime-workspace-activation/service-worker-handler.js` | `preserve_legacy_route` | D3D-14 | Keep existing classifier and handler terminally available. |
| `src/sidepanel/sidepanel.js` | `modify` | D3D-04, D3D-05 | Resolve binding before render; pass verified authority to reads and typed mutations. |
| `src/core/workspace-store.js` | `preserve_legacy_route` | D3D-05 | Keep compatibility exports for old routes; all Layer 2.3D consumers migrate away. |
| `src/core/journal-append-coordination/readonly-workspace.js` | `migrate_reader` | D3D-05 | Read an explicitly supplied verified scoped record. |
| `src/core/journal-append-coordination/coordinator.js` | `extend_versioned` | D3D-05 | Retain v0.1; add full-assignment scoped command path. |
| `src/core/journal-append-coordination/contract.js` | `extend_versioned` | D3D-05 | Add new schema constants/validators/results without editing v0.1. |
| `src/core/journal-append-coordination/client.js` | `extend_versioned` | D3D-05 | Send the new full authority envelope when panel authority is assigned. |
| `src/core/journal-append-coordination/chrome-adapter.js` | `migrate_writer` | D3D-02, D3D-05 | Retain protected old ledger path; add separate scoped record/ledger adapter for new route. |
| `src/sidepanel/workspace-metadata-autosave.js` | `migrate_writer` | D3D-05 | Require current assigned authority and expected workspace revision. |
| `src/core/workspace-membership-mutation/coordinator.js` | `extend_versioned` | D3D-06 | Add new full-assignment path and workspace-local evidence while retaining old route. |
| `src/core/workspace-membership-mutation/contract.js` | `extend_versioned` | D3D-06 | Add a new schema/version; old published fields remain exact. |
| `src/core/workspace-membership-mutation/chrome-adapter.js` | `migrate_writer` | D3D-02, D3D-06 | Add scoped record/ledger operations for new route; retain old compatibility adapter. |
| `src/core/workspace-membership-mutation/service-worker-handler.js` | `extend_versioned` | D3D-06 | Classify old and new schemas into separate terminal coordinators. |
| `src/core/workspace-projection-reconciliation/coordinator.js` | `extend_versioned` | D3D-06 | Add exact assigned-workspace reconciliation without changing old result schema. |
| `src/core/automatic-workspace-projection-reconciler.js` | `modify` | D3D-06, D3D-14 | Schedule by verified workspace ID/assignment and restart recovery state. |
| `src/core/workspace-projection-reconciliation/chrome-adapter.js` | `migrate_writer` | D3D-06 | New route reads/writes one scoped record and takes one projection lock. |
| `src/sidepanel/workspace-library-save-bridge.js` | `migrate_reader` | D3D-07 | Save only the current verified assigned scoped workspace. |
| `src/core/workspace-resume-transaction-engine.js` | `modify` | D3D-09 | Expose evidenced browser-first subtransaction to resume-and-bind coordinator. |
| `src/sidepanel/workspace-library-resume-gate.js` | `modify` | D3D-09 | Add unbound, occupied, stale, and active-elsewhere decisions. |
| `src/sidepanel/workspace-library-resume-transaction-controller.js` | `modify` | D3D-09 | Send only the new resume-and-bind command. |
| `src/sidepanel/workspace-archive-restore-control.js` | `modify` | D3D-09 | Route restore through resume-and-bind; no direct active workspace replacement. |
| `src/core/workspace-manual-placement-transaction/coordinator.js` | `modify` | D3D-10 | Call versioned transfer under scoped locks and preserve forward recovery. |
| `src/core/workspace-manual-placement-transaction/chrome-adapter.js` | `migrate_writer` | D3D-10 | Use scoped placement/record evidence and lock helpers. |
| `src/core/workspace-manual-placement-transaction/service-worker-handler.js` | `extend_versioned` | D3D-10 | Retain v0.1 handler and add the new terminal route. |
| `src/core/workspace-automatic-promotion-transaction/coordinator.js` | `modify` | D3D-10 | Call transfer coordinator and prevent duplicate destination on replay. |
| `src/core/workspace-automatic-promotion-integration/chrome-adapter.js` | `migrate_writer` | D3D-02, D3D-10 | Add scoped record/ledger operations while retaining old route adapters. |
| `src/core/workspace-automatic-promotion-integration/service-worker-handler.js` | `extend_versioned` | D3D-10 | Add exact new route; retain old schema classifier. |
| `src/core/workspace-creation-assignment-transaction/coordinator.js` | `preserve_legacy_route` | D3D-08 | Keep old schema/coordinator available; new create-bind family owns scoped behavior. |
| `src/sidepanel/workspace-archive-close-ownership-controller.js` | `modify` | D3D-12 | Replace panel-local authority with service-worker archive/replacement commands. |
| `src/core/workspace-runtime-store.js` | `migrate_writer` | D3D-05, D3D-07, D3D-09 | Active APIs require assigned scoped authority; archive/diagnostic APIs stay separate. |
| `src/core/workspace-archive-close-engine.js` | `preserve_unchanged` | D3D-12 | Reuse verified close plan/execution only at the authorized phase. |
| `src/background/service-worker.js` | `modify` | D3D-04, D3D-08–D3D-14 | Register additive terminal routes, trusted close, and startup recovery. |
| `src/sidepanel/constellation-compatibility-bootstrap.js` | `modify` | D3D-13 | Retain reconciliation listener but remove runtime-selection authority. |
| `src/sidepanel/workspace-tab-action-contract-cleanup.js` | `gate_while_unbound` | D3D-07 | Observe only the assigned scoped key; do nothing while unbound. |
| `src/sidepanel/user-journal-action-observability.js` | `gate_while_unbound` | D3D-07 | Observe current assigned scoped record only. |
| `src/sidepanel/legacy-archive-projection-cleanup.js` | `migrate_writer` | D3D-13 | Route peer cleanup through compatibility projection; never touch scoped authority. |
| `src/core/runtime-contract/ledger.js` | `preserve_unchanged` | D3D-02 | Reuse pure inspect/record primitives; protected schema remains separate. |
| `src/core/journal-append-coordination/ledger-validation.js` | `preserve_unchanged` | D3D-02 | Preserve old validator and add the new validator in the new ledger family. |
| `src/core/workspace-creation-assignment-transaction/state-machine.js` | `extend_versioned` | D3D-08 | Add pure classification helpers that accept validated workspace-ledger evidence. |
| `src/sidepanel/advanced-tab-controls.js` | `historical_unreferenced` | D3D-15 | Preserve byte-for-byte; static closure must remain zero incoming production edges. |
| `src/sidepanel/advanced-new-window-stability.js` | `historical_unreferenced` | D3D-15 | Preserve byte-for-byte. |
| `src/sidepanel/advanced-new-window-stability-v2.js` | `historical_unreferenced` | D3D-15 | Preserve byte-for-byte. |
| `src/sidepanel/remove-workspace-tab-cleanup.js` | `historical_unreferenced` | D3D-15 | Preserve byte-for-byte. |
| `src/sidepanel/recovery-group-restore.js` | `historical_unreferenced` | D3D-15 | Preserve byte-for-byte. |
| `src/core/workspace-projection-reconciler.js` | `historical_unreferenced` | D3D-15 | Preserve byte-for-byte. |
| `src/core/workspace-projection-reconciler-v2.js` | `historical_unreferenced` | D3D-15 | Preserve byte-for-byte. |
| `src/core/workspace-projection-reconciler-v3.js` | `historical_unreferenced` | D3D-15 | Preserve byte-for-byte. |
| `src/core/session-db.js` | `preserve_unchanged` | D3D-12 | Preserve physical DB/version/store identities. |
| `tests/runtime-workspace-activation/runtime-workspace-activation.test.js` | `test_only` | D3D-04, D3D-15 | Preserve old route coverage and add no contradictory new expectations. |
| `tests/characterization/current-concurrency.test.js` | `test_only` | D3D-15 | Preserve the historical singleton characterization. |
| `tests/runtime-session-authority/session-authority-coordinator.test.js` | `test_only` | D3D-03, D3D-11 | Extend context recreation, scoped lock, and close isolation coverage. |
| `scripts/check-runtime-inventory.mjs` | `validation_only` | D3D-15 | Assert all accepted inventory/root/consumer/lock dispositions. |
| `scripts/check-runtime-contract-purity.mjs` | `validation_only` | D3D-15 | Include all new pure contract, ordering, ledger, and discovery modules. |
| `src/sidepanel/layer2-legacy-archive-projection-validation.js` | `preserve_unchanged` | D3D-07 | Diagnostic-only consumer remains non-authoritative. |
| `src/sidepanel/layer2-hardening-regression-harness.js` | `gate_while_unbound` | D3D-07 | Active reader uses verified assigned state or emits an unbound result. |
| `src/sidepanel/layer2-hardening-correlation-completeness.js` | `preserve_unchanged` | D3D-07 | Diagnostic-only APIs remain allowed. |
| `src/sidepanel/layer2-completion-checkpoint-packet.js` | `gate_while_unbound` | D3D-07 | Runtime summary requires assigned scoped state. |
| `src/sidepanel/layer2-archive-close-ownership-validation.js` | `preserve_unchanged` | D3D-07 | Diagnostic-only APIs remain allowed. |
| `src/sidepanel/layer2-post-resume-verification-packet.js` | `gate_while_unbound` | D3D-07 | Active reader uses verified resume assignment. |
| `src/sidepanel/layer2-memory-contract-validation-packet.js` | `gate_while_unbound` | D3D-07 | Active runtime summary is scoped and assigned. |
| `src/sidepanel/layer2-production-save-validation-packet.js` | `gate_while_unbound` | D3D-07 | Production-save comparison uses assigned scoped state. |
| `src/sidepanel/layer2-resume-transaction-validation.js` | `gate_while_unbound` | D3D-07 | Resume validation reads only assigned scoped state. |
| `src/core/workspace-hydration-engine.js` | `migrate_writer` | D3D-09 | Hydration writes the exact candidate scoped record under resume evidence. |
| `src/sidepanel/workspace-library-auto-refresh.js` | `gate_while_unbound` | D3D-07 | Diagnostic calls remain, but the active-key listener filters by verified assigned scoped key and does nothing while unbound. |
| `src/sidepanel/layer2-persistence-validation.js` | `gate_while_unbound` | D3D-07 | Remove startup `getWorkspace()` write-through; emit an explicit unbound packet instead. |
| `src/sidepanel/layer2-lifecycle-validation-packet.js` | `gate_while_unbound` | D3D-07 | Active workspace checks require assigned scoped state. |
| `src/sidepanel/runtime-projection-readiness.js` | `gate_while_unbound` | D3D-07 | Readiness is scoped to verified assignment. |
| `src/sidepanel/projection-plan-preview.js` | `gate_while_unbound` | D3D-07 | Preview reads assigned scoped state only. |
| `src/sidepanel/projection-confirmation-packet.js` | `gate_while_unbound` | D3D-07 | Confirmation reads assigned scoped state only. |
| `src/sidepanel/projection-resume-preflight.js` | `gate_while_unbound` | D3D-07 | Preflight uses assigned state or explicit durable candidate input. |
| `src/sidepanel/projection-resume-review.js` | `preserve_unchanged` | D3D-07 | No active-runtime access exists at `HEAD`. |
| `src/sidepanel/projection-resume-run.js` | `gate_while_unbound` | D3D-07, D3D-09 | Browser execution requires resume-and-bind authority. |
| `src/sidepanel/projection-resume-validation-suite.js` | `gate_while_unbound` | D3D-07 | Validation suite reads assigned scoped state only. |

### Direct side-panel root closure

Every root below remains production-loaded. `preserve_unchanged` means the root has no active-workspace access at `HEAD`; it does not mean historical or unloaded.

| HTML line | Root | Final disposition | Slice |
|---:|---|---|---|
| 144 | `src/sidepanel/constellation-compatibility-bootstrap.js` | `modify` | D3D-13 |
| 145 | `src/sidepanel/diagnostics.js` | `gate_while_unbound` | D3D-07 |
| 146 | `src/sidepanel/developer-mode.js` | `preserve_unchanged` | D3D-15 |
| 147 | `src/sidepanel/sidepanel.js` | `modify` | D3D-04, D3D-05 |
| 148 | `src/sidepanel/user-journal-action-observability.js` | `gate_while_unbound` | D3D-07 |
| 149 | `src/sidepanel/workspace-metadata-autosave.js` | `migrate_writer` | D3D-05 |
| 150 | `src/sidepanel/workspace-tab-remove-only-control.js` | `migrate_writer` | D3D-06 |
| 151 | `src/sidepanel/workspace-tab-action-contract-cleanup.js` | `gate_while_unbound` | D3D-07 |
| 152 | `src/sidepanel/workspace-library-save-bridge.js` | `migrate_reader` | D3D-07 |
| 153 | `src/sidepanel/workspace-session-control.js` | `migrate_writer` | D3D-04, D3D-11 |
| 154 | `src/sidepanel/workspace-archive-close-ownership-controller.js` | `modify` | D3D-12 |
| 155 | `src/sidepanel/workspace-session-product-surface.js` | `preserve_unchanged` | D3D-15 |
| 156 | `src/sidepanel/workspace-archive-restore-control.js` | `modify` | D3D-09 |
| 157 | `src/sidepanel/session-db-diagnostics.js` | `gate_while_unbound` | D3D-07 |
| 158 | `src/sidepanel/session-db-diagnostics-developer-surface.js` | `preserve_unchanged` | D3D-15 |
| 159 | `src/sidepanel/saved-workspace-registry.js` | `preserve_unchanged` | D3D-15 |
| 160 | `src/sidepanel/saved-workspace-cleanup-controls.js` | `preserve_unchanged` | D3D-15 |
| 161 | `src/sidepanel/workspace-library-product-surface.js` | `preserve_unchanged` | D3D-15 |
| 162 | `src/sidepanel/workspace-library-auto-refresh.js` | `gate_while_unbound` | D3D-07 |
| 163 | `src/sidepanel/workspace-library-resume-transaction-controller.js` | `modify` | D3D-09 |
| 164 | `src/sidepanel/layer2-lifecycle-validation-packet.js` | `gate_while_unbound` | D3D-07 |
| 165 | `src/sidepanel/layer2-memory-contract-validation-packet.js` | `gate_while_unbound` | D3D-07 |
| 166 | `src/sidepanel/layer2-post-resume-verification-packet.js` | `gate_while_unbound` | D3D-07 |
| 167 | `src/sidepanel/layer2-production-save-validation-packet.js` | `gate_while_unbound` | D3D-07 |
| 168 | `src/sidepanel/layer2-resume-transaction-validation.js` | `gate_while_unbound` | D3D-07 |
| 169 | `src/sidepanel/layer2-completion-checkpoint-packet.js` | `gate_while_unbound` | D3D-07 |
| 170 | `src/sidepanel/layer2-persistence-validation.js` | `gate_while_unbound` | D3D-07 |
| 171 | `src/sidepanel/layer2-persistence-validation-surface.js` | `preserve_unchanged` | D3D-15 |
| 172 | `src/sidepanel/runtime-projection-readiness.js` | `gate_while_unbound` | D3D-07 |
| 173 | `src/sidepanel/runtime-projection-readiness-surface.js` | `preserve_unchanged` | D3D-15 |
| 174 | `src/sidepanel/projection-plan-preview.js` | `gate_while_unbound` | D3D-07 |
| 175 | `src/sidepanel/projection-plan-preview-surface.js` | `preserve_unchanged` | D3D-15 |
| 176 | `src/sidepanel/projection-confirmation-packet.js` | `gate_while_unbound` | D3D-07 |
| 177 | `src/sidepanel/projection-confirmation-packet-surface.js` | `preserve_unchanged` | D3D-15 |
| 178 | `src/sidepanel/projection-resume-preflight.js` | `gate_while_unbound` | D3D-07 |
| 179 | `src/sidepanel/projection-resume-preflight-validation-surface.js` | `preserve_unchanged` | D3D-15 |
| 180 | `src/sidepanel/projection-resume-review.js` | `preserve_unchanged` | D3D-15 |
| 181 | `src/sidepanel/projection-resume-review-surface.js` | `preserve_unchanged` | D3D-15 |
| 182 | `src/sidepanel/projection-resume-run.js` | `gate_while_unbound` | D3D-07, D3D-09 |
| 183 | `src/sidepanel/projection-resume-run-surface.js` | `preserve_unchanged` | D3D-15 |
| 184 | `src/sidepanel/projection-resume-validation-suite.js` | `gate_while_unbound` | D3D-07 |
| 185 | `src/sidepanel/projection-resume-validation-suite-validation-surface.js` | `preserve_unchanged` | D3D-15 |
| 186 | `src/sidepanel/workspace-dedicated-window-threshold-policy.js` | `preserve_unchanged` | D3D-10 |
| 187 | `src/sidepanel/workspace-dedicated-window-threshold-policy-surface.js` | `preserve_unchanged` | D3D-15 |
| 188 | `src/sidepanel/workspace-automatic-promotion-validation-surface.js` | `preserve_unchanged` | D3D-15 |

### Additional production-reachable transitive active paths

These paths are not additional inventory occurrences; they are source-grounded transitive callers reached from the declared roots and therefore receive explicit implementation dispositions.

| Path | Current role | Final disposition | Slice |
|---|---|---|---|
| `src/sidepanel/search-workspace-intake.js` | Calls global workspace save/timeline after browser search intake | `migrate_writer` | D3D-05 |
| `src/sidepanel/workspace-dedicated-window-threshold-execution.js` | Writes placement/timeline after browser movement | `migrate_writer` | D3D-10 |
| `src/sidepanel/workspace-dedicated-window-threshold-preflight.js` | Reads current workspace for placement preflight | `gate_while_unbound` | D3D-10 |
| `src/sidepanel/workspace-dedicated-window-threshold-preflight-validation-suite.js` | Production-loaded transitive validation reader | `gate_while_unbound` | D3D-07 |
| `src/sidepanel/workspace-dedicated-window-threshold-review.js` | Reads current workspace for review | `gate_while_unbound` | D3D-10 |
| `src/sidepanel/workspace-dedicated-window-threshold-validation-suite.js` | Production-loaded transitive validation reader | `gate_while_unbound` | D3D-07 |
| `src/sidepanel/workspace-session-control.js` | Direct global key/session lifecycle mutation | `migrate_writer` | D3D-04, D3D-11 |
| `src/sidepanel/workspace-tab-remove-only-control.js` | Global workspace remove/timeline write | `migrate_writer` | D3D-06 |

The D3D-05, D3D-06, D3D-07, D3D-10, and D3D-11 modify lists include these paths where executable changes are required.

### `workspace-runtime-store.js` consumer closure

| Consumer class | Paths | Final handling |
|---|---|---|
| Active readers | `src/sidepanel/layer2-hardening-regression-harness.js`; `src/sidepanel/layer2-completion-checkpoint-packet.js`; `src/sidepanel/layer2-post-resume-verification-packet.js`; `src/sidepanel/layer2-memory-contract-validation-packet.js`; `src/sidepanel/layer2-production-save-validation-packet.js`; `src/sidepanel/layer2-resume-transaction-validation.js`; `src/core/workspace-resume-transaction-engine.js` | `gate_while_unbound` or migrate to assigned scoped input in D3D-07/D3D-09. |
| Active writer | `src/core/workspace-hydration-engine.js` | `migrate_writer` in D3D-09. |
| Diagnostic-only production consumers | `src/sidepanel/layer2-legacy-archive-projection-validation.js`; `src/sidepanel/layer2-hardening-correlation-completeness.js`; `src/sidepanel/layer2-archive-close-ownership-validation.js`; `src/sidepanel/legacy-archive-projection-cleanup.js`; `src/sidepanel/user-journal-action-observability.js`; `src/sidepanel/workspace-archive-close-ownership-controller.js`; `src/sidepanel/workspace-library-auto-refresh.js`; `src/sidepanel/workspace-library-save-bridge.js`; `src/sidepanel/workspace-metadata-autosave.js`; `src/sidepanel/workspace-tab-action-contract-cleanup.js`; `src/core/workspace-projection-reconciliation/chrome-adapter.js` | Preserve diagnostic calls as non-authoritative; migrate any separate active access according to the path ledger. |
| Historical consumers | `src/core/workspace-projection-reconciler.js`; `src/core/workspace-projection-reconciler-v2.js`; `src/core/workspace-projection-reconciler-v3.js` | `historical_unreferenced`; preserve byte-for-byte. |

All 22 consumers are named exactly once in this closure table.

## Dependency-ordered implementation slices

### Common guard for every slice

Every slice must begin at its contract-specified commit with a clean tree. It must not modify the three frozen Layer 2.3D authority artifacts, `manifest.json`, `src/sidepanel/sidepanel.html`, dependency versions, IndexedDB identity/version/stores, protected legacy/canonical storage or event identities, or any published schema in place. No slice may operate live Chrome or real extension storage. Each slice stops on an unexpected path, architecture conflict, new dependency, inability to isolate pre-existing changes, or a test requiring live state. Evidence is the exact diff, focused command output, full authorized regression output, final Git status, and SHA-256 for any new durable evidence document.

### D3D-01 — Pure scoped-runtime record foundation

| Contract field | Exact slice contract |
|---|---|
| Objective | Implement key derivation, exact v0.1 record validation/construction, revision agreement, canonical digest, lifecycle/provenance enums, and total result helpers without side effects. |
| Architecture requirements | Runtime key/schema lines 57–111; unknown-field rejection; no binding fields; plain serializable data; scoped record never grants authority. |
| Dependencies | Accepted Layer 2.3C pure helpers only. |
| Create | `src/core/runtime-workspace-record/contract.js`; `src/core/runtime-workspace-record/chrome-adapter.js`; `tests/runtime-workspace-record/runtime-workspace-record.test.js`. |
| Modify | None. Adapter creation may be deferred to D3D-02 if a pure-only first commit is preferred. |
| Symbols | `RUNTIME_WORKSPACE_KEY_PREFIX`, `RUNTIME_WORKSPACE_SCHEMA`, `RUNTIME_WORKSPACE_LIFECYCLE_STATES`, `RUNTIME_WORKSPACE_PROVENANCE_KINDS`, `deriveRuntimeWorkspaceKey`, `snapshotAndValidateRuntimeWorkspaceRecord`, `createRuntimeWorkspaceRecord`, `createRuntimeWorkspaceResult`, `runtimeWorkspaceFingerprint`, `createRuntimeWorkspaceRecordChromeAdapters`. |
| Protected | Common guard; especially `chromeFlowWorkspace`, `constellationActiveWorkspace`, `activeWorkspaceId`, and every Layer 2.3C schema. |
| Preserve | `normalizeWorkspaceRevision`, canonical serialization behavior, durable/browser authority separation. |
| Unit tests | Valid record; empty/unsafe key; unknown field; workspace/key mismatch; nested workspace mismatch; revision mismatch; malformed lifecycle/provenance; forbidden binding field; non-serializable value; total result shape. |
| Characterization | Preserve `tests/runtime-contract/runtime-contract.test.js` unchanged and passing. |
| Integration tests | None in this pure slice. |
| Static validation | Add the pure contract path to purity checking only if the adapter is committed separately; adapter itself is excluded from pure paths. |
| Commands | `node --test --test-isolation=none tests/runtime-workspace-record/runtime-workspace-record.test.js`; `npm run test:runtime-contract`; `npm run check:runtime-contract-purity`. |
| Evidence | Test counts; schema/key fixture matrix; diff proving no storage import in `contract.js`. |
| Rollback boundary | Source-only: remove the new family before any later slice imports it. |
| Stop conditions | Existing revision normalization cannot represent the contract; validator would need to accept unknown fields; a protected schema would need alteration. |
| Completion | Strict total validator and deterministic key/digest behavior pass; no consumer migrated yet. |
| Reasoning/budget | Codex-Sol high; maximum 3%. |
| Independent commit | Yes; safe to push to the feature branch for review before live validation, never to merge/release alone. |

### D3D-02 — Workspace operation-ledger and recovery-discovery foundation

| Contract field | Exact slice contract |
|---|---|
| Objective | Implement one validated local ledger per workspace, immutable intent/progress/terminal transitions, terminal-only retention, replay/conflict classification, and read-only prefix discovery. |
| Architecture requirements | Lines 149–222; 256 terminal limit; unresolved retention; candidate/prior relevance; overlap conflict; old-session evidence never authorizes. |
| Dependencies | D3D-01. Reuse pure `inspectOperation`/`recordOperation` behavior without reusing the protected global schema. |
| Create | `src/core/runtime-workspace-operation-ledger/contract.js`; `src/core/runtime-workspace-operation-ledger/ledger.js`; `src/core/runtime-workspace-operation-ledger/recovery-discovery.js`; `src/core/runtime-workspace-operation-ledger/chrome-adapter.js`; `tests/runtime-workspace-operation-ledger/runtime-workspace-operation-ledger.test.js`. |
| Modify | None in production; `scripts/check-runtime-contract-purity.mjs` may be extended in this slice or D3D-15. |
| Symbols | `WORKSPACE_OPERATION_LEDGER_KEY_PREFIX`, `WORKSPACE_OPERATION_LEDGER_SCHEMA`, `WORKSPACE_OPERATION_TERMINAL_LIMIT`, `deriveWorkspaceOperationLedgerKey`, `snapshotAndValidateWorkspaceOperationLedger`, `createWorkspaceOperationLedger`, `recordImmutableOperationIntent`, `appendOperationProgress`, `recordWorkspaceOperationTerminal`, `inspectWorkspaceOperation`, `pruneWorkspaceOperationTerminals`, `discoverWorkspaceRecoveryEvidence`, `classifyRecoveryOverlap`, `createWorkspaceOperationLedgerChromeAdapters`. |
| Protected | Common guard; `constellationRecentOperationLedger` and `constellation-runtime-operation-ledger-v0.1` remain unchanged and available. |
| Preserve | Existing Layer 2.3C global ledger readers/writers/locks; no global Layer 2.3D ledger. |
| Unit tests | Exact schema/fields; key mismatch; immutable intent mutation rejection; duplicate ID same/different fingerprint; progress append; pending/indeterminate retention; terminal prune order; malformed ledger/key/intent; affected-workspace lookup; replacement prior/candidate discovery; overlap conflict; old-session rejection; no mutation during discovery. |
| Characterization | Existing journal, activation, creation, placement, membership, and promotion replay suites remain passing. |
| Integration tests | Adapter fake verifies one local key and compare-write-verify under the supplied workspace lock. |
| Static validation | Pure checker covers contract/ledger/discovery; source scan forbids global registry and Chrome APIs in pure modules. |
| Commands | `node --test --test-isolation=none tests/runtime-workspace-operation-ledger/runtime-workspace-operation-ledger.test.js`; existing journal/activation/creation/membership/promotion/placement suites; purity check. |
| Evidence | Malformed/replay/pruning fixture table; proof discovery performs zero writes; exact old-ledger preservation diff. |
| Rollback boundary | New local ledger code is unused; removal is source-only. |
| Stop conditions | Intent cannot remain immutable; discovery needs process-local authority; pending evidence would be pruned; old global ledger would require schema change. |
| Completion | All ledger/recovery classifications are total and deterministic; no business coordinator imports the family yet. |
| Reasoning/budget | Codex-Sol extra-high; maximum 4%. |
| Independent commit | Yes; safe to push for review before live validation. |

### D3D-03 — Scoped lock foundation

| Contract field | Exact slice contract |
|---|---|
| Objective | Implement exact lock-name derivation, deterministic multi-lock ordering, inversion rejection, scoped acquisition, and the separate advisory compatibility lock. |
| Architecture requirements | Lines 398–414; window numeric order; workspace code-unit order; ordinary Alpha/Beta content independence; compatibility lock non-nesting. |
| Dependencies | D3D-01 and D3D-02 key validators. |
| Create | `src/core/runtime-scoped-locks/contract.js`; `src/core/runtime-scoped-locks/ordering.js`; `src/core/runtime-scoped-locks/chrome-adapter.js`; `tests/runtime-scoped-locks/runtime-scoped-locks.test.js`. |
| Modify | `src/core/runtime-session-authority/coordinator.js`; `src/core/runtime-session-authority/chrome-adapter.js`; `tests/runtime-session-authority/session-authority-coordinator.test.js` only for injected lock seams and exact order. |
| Symbols | `SCOPED_LOCK_DOMAINS`, `COMPATIBILITY_PROJECTION_LOCK`, `deriveExclusiveOperationLock`, `deriveWindowLock`, `deriveWorkspaceBindingLock`, `deriveWorkspaceContentLock`, `deriveBrowserProjectionLock`, `buildScopedLockPlan`, `validateScopedLockPlan`, `compareScopedLocks`, `runWithScopedLocks`, `runWithCompatibilityProjectionLock`. |
| Protected | Common guard; existing `LOCK_NAMES`, `LOCK_ORDER`, and global Layer 2.3C behavior remain unchanged. |
| Preserve | Root/session writes still take existing runtime-state lock; old routes retain old global exclusive behavior. |
| Unit tests | Every name; invalid identity; numeric/code-unit ordering; duplicate removal; reverse release; inversion; compatibility lock excluded from nested plans; no ordinary content compatibility/global root lock; Alpha/Beta simultaneous gate progress. |
| Characterization | Existing session-authority lock-order tests remain passing. |
| Integration tests | Deterministic fake Web Lock adapter records acquire/release order and proves unrelated workspace content callbacks overlap. |
| Static validation | Purity checker covers contract/ordering; adapter-only Web Locks token rule. |
| Commands | Focused scoped-lock test; `npm run test:runtime-session-authority`; `npm run test:characterization`; purity check. |
| Evidence | Recorded lock sequences for one- and two-workspace operations; explicit inversion failure matrix. |
| Rollback boundary | Remove injected scoped-lock seam while no Layer 2.3D coordinator depends on it. |
| Stop conditions | Browser effects require acquiring an earlier lock while a later one is held; ordinary content requires global runtime-state; Web Locks absence has no explicit failure result. |
| Completion | Exact order/inversion tests pass and old session tests remain unchanged in meaning. |
| Reasoning/budget | Codex-Sol extra-high; maximum 4%. |
| Independent commit | Yes; safe to push for review before live validation. |

### D3D-04 — Window-binding resolution and panel authority

| Contract field | Exact slice contract |
|---|---|
| Objective | Add the read-only resolve command, register/validate current context, return assigned/unbound/stale states, and expose a verified panel-local authority object with no compatibility fallback. |
| Architecture requirements | Identity model lines 47–55; exact resolve schemas; bootstrap order lines 224–238; occupied/active-elsewhere/stale results. |
| Dependencies | D3D-01 and D3D-03. |
| Create | `src/core/runtime-window-binding/contract.js`; `src/core/runtime-window-binding/coordinator.js`; `src/core/runtime-window-binding/chrome-adapter.js`; `src/core/runtime-window-binding/client.js`; `src/core/runtime-window-binding/service-worker-handler.js`; `src/core/runtime-window-binding/side-panel-authority.js`; `tests/runtime-window-binding/runtime-window-binding.test.js`. |
| Modify | `src/core/runtime-session-authority/client.js`; `src/core/runtime-session-authority/coordinator.js`; `src/core/runtime-session-authority/chrome-adapter.js`; `src/core/runtime-workspace-activation/side-panel-runtime.js`; `src/sidepanel/sidepanel.js`; `src/background/service-worker.js`; `tests/runtime-workspace-activation/runtime-workspace-activation.test.js`; `tests/runtime-session-authority/session-authority-coordinator.test.js`. |
| Symbols | Exact resolve command/result constants; `snapshotAndValidateWindowBindingResolveCommand`, `createWindowBindingResolveResult`, `coordinateRuntimeWindowBindingResolve`, `createRuntimeWindowBindingChromeAdapters`, `createRuntimeWindowBindingClient`, `handleRuntimeWindowBindingMessage`, `createSidePanelAssignedWorkspaceAuthority`, `getSidePanelAssignedWorkspaceAuthority`. |
| Protected | Common guard; `constellationRuntimeSessionAuthority` v0.1 key/schema; old activation route and `RUNTIME_WORKSPACE_COMMIT_EVENT`. |
| Preserve | Context replacement semantics; assignment provenance context not compared; focus never grants authority. |
| Unit tests | Resolve identity omissions; stale context; no assignment → unbound/no scoped read; stale ID/epoch; malformed record; active elsewhere; assigned exact result; current panel recreation; total failure. |
| Characterization | Existing activation and session-authority suites remain passing. |
| Integration tests | Handler authorization and route separation with fake sender/storage; panel helper renders unbound without compatibility read. |
| Static validation | Service-worker route classifier exactness; scan panel authority imports for no compatibility/workspace-store fallback. |
| Commands | New focused test; activation and session-authority suites; characterization; purity check. |
| Evidence | State/result matrix; import trace showing old route preserved and new route terminal; zero-write resolve proof. |
| Rollback boundary | New resolve/panel authority can be removed before any scoped mutation route is enabled. |
| Stop conditions | Unbound UI needs a global workspace read; current context cannot be proven; old route must be edited in place; sender validation weakens. |
| Completion | Panel reaches assigned only after exact assignment/record verification and all unbound/stale outcomes are total. |
| Reasoning/budget | Codex-Sol extra-high; maximum 5%. |
| Independent commit | Yes; safe to push for review, but do not load as live extension before later integration acceptance. |

### D3D-05 — Typed ordinary runtime mutations

| Contract field | Exact slice contract |
|---|---|
| Objective | Move workspace read/write, journal, timeline, metadata, and direct side-panel mutations to one exact assigned scoped record and workspace-local revision/ledger. |
| Architecture requirements | Assigned-mutation identity row; revision conflict; typed semantic operations; no global whole-object write; ordinary Alpha/Beta independence. |
| Dependencies | D3D-01 through D3D-04. |
| Create | `src/core/runtime-workspace-mutation/contract.js`; `src/core/runtime-workspace-mutation/coordinator.js`; `src/core/runtime-workspace-mutation/chrome-adapter.js`; `src/core/runtime-workspace-mutation/client.js`; `src/core/runtime-workspace-mutation/service-worker-handler.js`; `tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js`. |
| Modify | `src/sidepanel/sidepanel.js`; `src/sidepanel/search-workspace-intake.js`; `src/sidepanel/workspace-metadata-autosave.js`; `src/core/workspace-runtime-store.js`; `src/core/journal-append-coordination/contract.js`; `src/core/journal-append-coordination/coordinator.js`; `src/core/journal-append-coordination/client.js`; `src/core/journal-append-coordination/chrome-adapter.js`; `src/core/journal-append-coordination/readonly-workspace.js`; `src/background/service-worker.js`. `src/core/workspace-store.js` remains an old-route compatibility module. |
| Symbols | `RUNTIME_WORKSPACE_MUTATION_COMMAND_SCHEMA`, result schema, exact semantic kinds; validator/result/fingerprint; `coordinateRuntimeWorkspaceMutation`; scoped adapters/client/handler; versioned journal validators; assigned variants of active runtime APIs. |
| Protected | Common guard; old journal schemas, compatibility APIs, and global ledger route remain available. |
| Preserve | Journal/timeline entry identity and append semantics; metadata barrier latest-write semantics; diagnostics separate from workspace authority. |
| Unit tests | Exact assignment; stale context/ID/epoch; key/workspace mismatch; revision conflict; journal/timeline duplicate replay; metadata conflict; unknown mutation kind/field; partial write/verify failure; Alpha/Beta disjoint progress. |
| Characterization | Runtime-contract, journal, activation, and current-concurrency tests remain passing. |
| Integration tests | Fake service-worker route → scoped adapter → local ledger; two workspaces mutate concurrently without global lock. |
| Static validation | New routes cannot import `workspace-store.js` or raw compatibility writers; ordinary mutation lock-plan assertion. |
| Commands | New focused test; runtime-contract, journal, activation, characterization suites; purity and inventory checks. |
| Evidence | Reader/writer before/after trace; revision/replay matrix; lock trace proving Alpha/Beta independence. |
| Rollback boundary | Source rollback remains safe before live load; after any scoped-only mutation the architecture downgrade gate applies. |
| Stop conditions | A writer cannot receive full assignment evidence; migration requires changing durable semantics; partial migration leaves an enabled global writer. |
| Completion | All named ordinary paths use scoped authority or are explicitly old-route-only; zero new global active-workspace write exists. |
| Reasoning/budget | Codex-Sol extra-high; maximum 5%. |
| Independent commit | Yes after all focused/full authorized tests pass; push for review only, no live load/merge. |

### D3D-06 — Membership and scoped projection reconciliation

| Contract field | Exact slice contract |
|---|---|
| Objective | Version membership and reconciliation routes so each command proves exact assignment, mutates one scoped record, and serializes only that workspace's projection. |
| Architecture requirements | Membership/reconciliation inventory dispositions; browser revalidation; projection lock; typed tab/projection operations; no unrelated workspace mutation. |
| Dependencies | D3D-01 through D3D-05. |
| Create | `tests/runtime-workspace-membership/runtime-workspace-membership.test.js`; `tests/runtime-workspace-projection/runtime-workspace-projection.test.js`. |
| Modify | `src/core/workspace-membership-mutation/contract.js`; `src/core/workspace-membership-mutation/coordinator.js`; `src/core/workspace-membership-mutation/chrome-adapter.js`; `src/core/workspace-membership-mutation/service-worker-handler.js`; `src/core/workspace-projection-reconciliation/contract.js`; `src/core/workspace-projection-reconciliation/coordinator.js`; `src/core/workspace-projection-reconciliation/chrome-adapter.js`; `src/core/automatic-workspace-projection-reconciler.js`; `src/sidepanel/workspace-tab-remove-only-control.js`; `src/background/service-worker.js`. |
| Symbols | Additive membership/reconciliation command/result constants and validators; new coordinator branches; scoped adapter methods; `scheduleWorkspaceProjectionReconciliationForAssignment`; assigned tab-remove command creation. |
| Protected | Common guard; old membership/reconciliation schemas/events and both canonical/legacy event names. |
| Preserve | Conservative one-to-one browser matching; missing browser tab does not delete durable membership; existing unledgered observation result semantics remain available. |
| Unit tests | Exact assignment/stale variants; invalid browser IDs; revision conflict; tab add/remove replay; reconciliation no-change; same URL different windows; projection lock isolation; no compatibility write. |
| Characterization | Existing membership and reconciliation suites remain passing. |
| Integration tests | Fake service worker with two assigned workspaces; simultaneous membership/reconciliation produces isolated keys and ledgers. |
| Static validation | Old/new handler separation; new adapters cannot import raw compatibility write; scoped projection lock asserted. |
| Commands | New focused tests; existing membership and reconciliation suites; runtime mutation suite; inventory/purity checks. |
| Evidence | Tab/projection mutation matrix; adapter call trace; unchanged event identity scan. |
| Rollback boundary | Revert new schema branches and callers before live load; preserve old handlers throughout. |
| Stop conditions | Reconciliation requires global runtime-state for ordinary content; browser ambiguity is silently resolved; old event contract would be retired. |
| Completion | New routes are fully scoped and old routes remain terminally available with unchanged schemas. |
| Reasoning/budget | Codex-Sol extra-high; maximum 5%. |
| Independent commit | Yes; review-branch push only before live validation. |

### D3D-07 — Production-root reader and unbound-gate closure

| Contract field | Exact slice contract |
|---|---|
| Objective | Close every production-loaded side-panel reader, Workspace Library save reader, validation packet, and runtime-store consumer by assigned scoped input or an explicit unbound result. |
| Architecture requirements | Production-root closure lines 460–467; all 45 roots; all 22 runtime-store consumers; no production-loaded global reader/writer classified historical. |
| Dependencies | D3D-04 through D3D-06. |
| Create | `tests/sidepanel-runtime-root-closure/sidepanel-runtime-root-closure.test.js`. |
| Modify | `src/core/workspace-runtime-store.js`; `src/sidepanel/diagnostics.js`; `src/sidepanel/user-journal-action-observability.js`; `src/sidepanel/workspace-tab-action-contract-cleanup.js`; `src/sidepanel/workspace-library-save-bridge.js`; `src/sidepanel/session-db-diagnostics.js`; `src/sidepanel/workspace-library-auto-refresh.js`; `src/sidepanel/layer2-hardening-regression-harness.js`; `src/sidepanel/layer2-completion-checkpoint-packet.js`; `src/sidepanel/layer2-post-resume-verification-packet.js`; `src/sidepanel/layer2-memory-contract-validation-packet.js`; `src/sidepanel/layer2-production-save-validation-packet.js`; `src/sidepanel/layer2-resume-transaction-validation.js`; `src/sidepanel/layer2-persistence-validation.js`; `src/sidepanel/layer2-lifecycle-validation-packet.js`; `src/sidepanel/runtime-projection-readiness.js`; `src/sidepanel/projection-plan-preview.js`; `src/sidepanel/projection-confirmation-packet.js`; `src/sidepanel/projection-resume-preflight.js`; `src/sidepanel/projection-resume-run.js`; `src/sidepanel/projection-resume-validation-suite.js`; `src/sidepanel/workspace-dedicated-window-threshold-preflight-validation-suite.js`; `src/sidepanel/workspace-dedicated-window-threshold-validation-suite.js`. |
| Symbols | Assigned-input variants of validation packet builders; `createUnboundValidationResult`; `getAssignedRuntimeMemorySummary`; `saveVerifiedAssignedWorkspaceToLibrary`; listener filters derived from `constellationRuntimeWorkspace:<workspaceId>`. |
| Protected | Common guard; validation purpose and packet schemas remain unless a new version is required; diagnostic/archive identities remain. |
| Preserve | Developer surfaces remain production-loaded; diagnostic-only APIs remain non-authoritative; surface wrappers with no active access remain unchanged. |
| Unit tests | Static 45-root mapping; 22-consumer mapping; every active reader assigned/unbound; persistence startup performs no global write-through; library save denies unbound; listener ignores unrelated keys. |
| Characterization | Existing activation lifecycle/UI composition and resume validation expectations remain source-faithful. |
| Integration tests | Import-safe pure builders only; do not import listener-heavy roots into Node. Static source audit verifies startup and access routes. |
| Static validation | Exact HTML root lines; source import/access scan; no active root imports legacy `getWorkspace`/active runtime APIs without assigned gate. |
| Commands | Root-closure test; activation tests; `npm run check:inventory`; purity check; no live surface execution. |
| Evidence | 45-row root result, 22-consumer result, explicit persistence startup trace, list of preserved wrappers. |
| Rollback boundary | Revert the complete reader-closure diff before live load; do not roll back only some readers after scoped writers exist. |
| Stop conditions | Any root's access cannot be classified; an unbound gate changes product semantics; validation requires a live Chrome read; one global production reader remains enabled. |
| Completion | 45/45 roots and 22/22 consumers are assigned, gated, diagnostic-only, preserved, or historical exactly as mapped. |
| Reasoning/budget | Codex-Sol extra-high; maximum 5%. |
| Independent commit | Prefer two reviewable commits (product readers, then validation readers), each test-passing; neither is safe to live-load alone. |

### D3D-08 — Create and bind

| Contract field | Exact slice contract |
|---|---|
| Objective | Add unbound create-and-bind with scoped-record-first mutation, internally generated assignment identity, verification, ledger evidence, and operation-local compensation. |
| Architecture requirements | Exact create schemas/evidence; phase table lines 293–306; occupied target denial; no client assignment identity. |
| Dependencies | D3D-01 through D3D-05. |
| Create | `src/core/runtime-workspace-create-bind/contract.js`; `src/core/runtime-workspace-create-bind/coordinator.js`; `src/core/runtime-workspace-create-bind/chrome-adapter.js`; `src/core/runtime-workspace-create-bind/client.js`; `src/core/runtime-workspace-create-bind/service-worker-handler.js`; `tests/runtime-workspace-create-bind/runtime-workspace-create-bind.test.js`. |
| Modify | `src/core/workspace-creation-assignment-transaction/state-machine.js` for reusable pure classification only; `src/sidepanel/sidepanel.js`; `src/background/service-worker.js`. `src/core/workspace-creation-assignment-transaction/coordinator.js` remains available. |
| Symbols | Exact accepted command/result constants; validator/result/fingerprint; `coordinateRuntimeWorkspaceCreateBind`; adapter/client/handler; `classifyScopedCreateState`; `classifyCreateCompensation`. |
| Protected | Common guard; old creation-assignment request/result schemas and coordinator. |
| Preserve | Resolution authorization semantics; assignment ID/epoch generated only inside trusted adapters/coordinator; no browser effect. |
| Unit tests | Unbound success; occupied target; active elsewhere; preexisting scoped key; invalid candidate digest/revision; client assignment rejection; workspace write failure; assignment failure compensation; verify failure indeterminate; replay/conflict. |
| Characterization | Existing creation-assignment and activation suites remain passing. |
| Integration tests | Fake route proves pending intent precedes scoped write, which precedes assignment; terminal replay creates neither again. |
| Static validation | New handler exact; no old adapter/global workspace import; compatibility projection not yet executed inside primary lock. |
| Commands | Focused create-bind test; existing creation/activation/session tests; ledger/locks/runtime-record tests; static checks. |
| Evidence | Ten-phase call trace; compensation artifact proof; assignment identity provenance proof. |
| Rollback boundary | Before live load, revert new route; after scoped-only write, downgrade gate applies. |
| Stop conditions | Assignment identity must come from client; compensation could delete a preexisting record; occupied window would be replaced; pending intent cannot precede write. |
| Completion | Create result is total, verified, replay-safe, and affects only candidate workspace/target window. |
| Reasoning/budget | Codex-Sol extra-high; maximum 5%. |
| Independent commit | Yes after full focused regressions; push for review only, no live load. |

### D3D-09 — Resume and bind

| Contract field | Exact slice contract |
|---|---|
| Objective | Wrap the existing browser-first resume transaction in exact durable/scoped/assignment evidence and bind only an unbound target after verified restoration. |
| Architecture requirements | Exact resume schemas/evidence; phase table lines 308–321; browser rollback stays in resume engine; active-elsewhere/occupied denial. |
| Dependencies | D3D-01 through D3D-05, D3D-07, D3D-08 patterns. |
| Create | `src/core/runtime-workspace-resume-bind/contract.js`; `src/core/runtime-workspace-resume-bind/coordinator.js`; `src/core/runtime-workspace-resume-bind/chrome-adapter.js`; `src/core/runtime-workspace-resume-bind/client.js`; `src/core/runtime-workspace-resume-bind/service-worker-handler.js`; `tests/runtime-workspace-resume-bind/runtime-workspace-resume-bind.test.js`. |
| Modify | `src/core/workspace-resume-transaction-engine.js`; `src/core/workspace-hydration-engine.js`; `src/sidepanel/workspace-library-resume-gate.js`; `src/sidepanel/workspace-library-resume-transaction-controller.js`; `src/sidepanel/workspace-archive-restore-control.js`; `src/sidepanel/projection-resume-run.js`; `src/background/service-worker.js`. |
| Symbols | Exact accepted resume command/result; validator/result/fingerprint; `coordinateRuntimeWorkspaceResumeBind`; `executeEvidencedResumeBrowserSubtransaction`; scoped hydration adapter; client/handler. |
| Protected | Common guard; durable Session DB/save/snapshot identities; existing resume lock remains for old route; no durable overwrite. |
| Preserve | Browser-first restore/stabilize ordering, projection hold, created-tab tracking, group reconstruction, and existing rollback semantics. |
| Unit tests | Durable identity/revision/digest; unbound/occupied/active-elsewhere; stale context; browser partial failure; scoped write failure; assignment failure; forward recovery after assignment; exact replay; new session with stale intent. |
| Characterization | Existing workspace-library resume gate and activation/resume tests remain passing. |
| Integration tests | Deterministic fake browser/storage phase trace; no second tabs/groups on replay; candidate record only after browser result. |
| Static validation | New route import direction; live APIs isolated in existing resume engine/adapters; no compatibility fallback. |
| Commands | Focused resume-bind; existing resume-gate/activation; record/ledger/locks; static checks. |
| Evidence | Browser/scoped/assignment phase trace; created-artifact/rollback matrix; durable record unchanged proof. |
| Rollback boundary | Revert before live load; after scoped/browser effects, use operation evidence and downgrade gate, never source-only rollback. |
| Stop conditions | Durable/browser revision cannot be freshly verified; replay would reopen tabs; rollback would remove preexisting browser objects; live Chrome is needed for unit proof. |
| Completion | Resume-and-bind is deterministic in fakes, preserves browser recovery doctrine, and returns verified new assignment identity. |
| Reasoning/budget | Codex-Sol extra-high; maximum 5%. |
| Independent commit | Yes for feature-branch review; not safe to live-load/merge before integration and Operator validation. |

### D3D-10 — Transfer, manual placement, and automatic promotion

| Contract field | Exact slice contract |
|---|---|
| Objective | Add the versioned transfer kernel and route explicit/manual/automatic placement through exact source release and destination binding without duplicate destinations. |
| Architecture requirements | Transfer schema/evidence; phase table lines 323–336; source unbound; record remains available; browser-first recovery retained. |
| Dependencies | D3D-01 through D3D-06 and D3D-08 assignment pattern. |
| Create | `src/core/runtime-workspace-transfer/contract.js`; `src/core/runtime-workspace-transfer/coordinator.js`; `src/core/runtime-workspace-transfer/chrome-adapter.js`; `src/core/runtime-workspace-transfer/client.js`; `src/core/runtime-workspace-transfer/service-worker-handler.js`; `tests/runtime-workspace-transfer/runtime-workspace-transfer.test.js`. |
| Modify | `src/core/workspace-manual-placement-transaction/coordinator.js`; `src/core/workspace-manual-placement-transaction/chrome-adapter.js`; `src/core/workspace-manual-placement-transaction/service-worker-handler.js`; `src/core/workspace-automatic-promotion-transaction/coordinator.js`; `src/core/workspace-automatic-promotion-integration/chrome-adapter.js`; `src/core/workspace-automatic-promotion-integration/service-worker-handler.js`; `src/sidepanel/workspace-dedicated-window-threshold-execution.js`; `src/sidepanel/workspace-dedicated-window-threshold-preflight.js`; `src/sidepanel/workspace-dedicated-window-threshold-review.js`; `src/background/service-worker.js`. |
| Symbols | Exact accepted transfer command/result; validator/result/fingerprint; `coordinateRuntimeWorkspaceTransfer`; adapters/client/handler; existing placement coordinators call transfer with recorded browser evidence. |
| Protected | Common guard; old manual placement/promotion schemas, threshold `4`, and current business recovery evidence. |
| Preserve | Browser-first movement where current kernels require it; no ownership field in scoped record; source window becomes unbound. |
| Unit tests | Exact/stale source assignment; target occupied; candidate active elsewhere; deterministic two-window locks; browser partial; assignment transfer failure; source unbound; lifecycle available; replay no second destination. |
| Characterization | Existing manual placement, promotion transaction, and promotion integration suites remain passing. |
| Integration tests | Fake placement/promotion invokes one transfer and records browser evidence before assignment; simultaneous Alpha/Beta transfers do not share workspace locks. |
| Static validation | Handler schema separation; exact lock plan; no compatibility write; no second assignment creation path. |
| Commands | Focused transfer; existing manual/promotion suites; session/locks/ledger tests; static checks. |
| Evidence | Source/destination/record/browser phase trace; replay destination count; lock-order trace. |
| Rollback boundary | Revert additive route before live load; after browser effect, recover forward from recorded evidence. |
| Stop conditions | Existing placement order conflicts with accepted phase contract; transfer requires silent target replacement; replay can create a second destination. |
| Completion | All transfer sources share one verified kernel and preserve old routes/tests. |
| Reasoning/budget | Codex-Sol extra-high; maximum 5%. |
| Independent commit | Yes; push for review only, no live load/merge before integration. |

### D3D-11 — Explicit release and trusted window-close lifecycle

| Contract field | Exact slice contract |
|---|---|
| Objective | Release one exact assignment, pause its scoped record, and replace direct window-close cleanup with an internal-only evidenced lifecycle command. |
| Architecture requirements | Exact release/close schemas; release and close phase tables; failed pause recovers forward; other Stella state byte-equivalent. |
| Dependencies | D3D-01 through D3D-05 and D3D-08. |
| Create | `src/core/runtime-workspace-release/contract.js`; `src/core/runtime-workspace-release/coordinator.js`; `src/core/runtime-workspace-release/chrome-adapter.js`; `src/core/runtime-workspace-release/client.js`; `src/core/runtime-workspace-release/service-worker-handler.js`; `tests/runtime-workspace-release/runtime-workspace-release.test.js`. |
| Modify | `src/core/runtime-session-authority/coordinator.js`; `src/core/runtime-session-authority/chrome-adapter.js`; `src/sidepanel/workspace-session-control.js`; `src/background/service-worker.js`; `tests/runtime-session-authority/session-authority-coordinator.test.js`. |
| Symbols | Exact release and trusted-close command/result constants; validators/results/fingerprints; `coordinateRuntimeWorkspaceRelease`; `coordinateTrustedWindowCloseLifecycle`; adapter/client/handler; internal `handleTrustedWindowRemoved`. |
| Protected | Common guard; trusted close is never public; session key/schema unchanged. |
| Preserve | Explicit release performs no browser close; external window removal is observation, not authorization for transfer; unassigned close creates no ledger. |
| Unit tests | Exact/stale assignment; release then pause; failed pause forward recovery; unassigned close no-op; close one workspace only; remove exact contexts; concurrent other assignment unchanged; replay/conflict. |
| Characterization | Existing session-authority and lifecycle characterization suites remain passing. |
| Integration tests | Fake `windows.onRemoved` dispatches internal command; public handler rejects close schema; restart resumes pending pause only. |
| Static validation | No runtime-message classifier accepts trusted-close command; exact lock order; scoped reconciliation scheduling. |
| Commands | Focused release; session-authority; activation lifecycle; locks/ledger; static checks. |
| Evidence | Before/after session-root byte comparison for unrelated workspaces; pause-recovery trace; public-route rejection. |
| Rollback boundary | Revert before live load; after assignment release, recover pause forward rather than restoring authority. |
| Stop conditions | Close path needs panel context; unrelated assignment changes; failed pause would trigger implicit rebind; internal schema becomes public. |
| Completion | Release/close are replay-safe, exact-workspace only, and leave no duplicate authority. |
| Reasoning/budget | Codex-Sol extra-high; maximum 5%. |
| Independent commit | Yes for review; not safe for live load until recovery/integration closure. |

### D3D-12 — Archive/release and explicit replacement

| Contract field | Exact slice contract |
|---|---|
| Objective | Implement two separately versioned transactions: durable archive → release → scoped delete → browser close, and exact prior-to-candidate replacement with candidate-owned evidence. |
| Architecture requirements | Archive/replacement schemas; phase tables lines 353–381; archive ledger survival; candidate/prior discovery; no implicit replacement. |
| Dependencies | D3D-01 through D3D-05, D3D-08, D3D-09, D3D-11. |
| Create | `src/core/runtime-workspace-archive-release/contract.js`; `src/core/runtime-workspace-archive-release/coordinator.js`; `src/core/runtime-workspace-archive-release/chrome-adapter.js`; `src/core/runtime-workspace-archive-release/client.js`; `src/core/runtime-workspace-archive-release/service-worker-handler.js`; `src/core/runtime-workspace-replacement/contract.js`; `src/core/runtime-workspace-replacement/coordinator.js`; `src/core/runtime-workspace-replacement/chrome-adapter.js`; `src/core/runtime-workspace-replacement/client.js`; `src/core/runtime-workspace-replacement/service-worker-handler.js`; `tests/runtime-workspace-archive-release/runtime-workspace-archive-release.test.js`; `tests/runtime-workspace-replacement/runtime-workspace-replacement.test.js`. |
| Modify | `src/sidepanel/workspace-archive-close-ownership-controller.js`; `src/core/workspace-runtime-store.js` for archive/active API separation; `src/background/service-worker.js`. `src/core/session-repository.js`, `src/core/session-db.js`, and `src/core/workspace-archive-close-engine.js` remain unchanged. |
| Symbols | Exact accepted archive/replacement constants; validators/results/fingerprints; `coordinateRuntimeWorkspaceArchiveRelease`; `coordinateRuntimeWorkspaceReplacement`; adapters/clients/handlers; `createArchiveCompatibilityPreflight`; `classifyReplacementPriorCandidateState`. |
| Protected | Common guard; physical/logical DB/store names, `activeWorkspaceId`, archive compatibility identities, and durable records. |
| Preserve | Existing verified close plan; durable archive precedes release; replacement selection alone grants nothing; no full runtime tombstone. |
| Unit tests | Durable archive failure; stale assignment/revision; delete verification failure; archive ledger survives; browser close partial; candidate active elsewhere; prior/candidate lock order; assignment replacement atomicity; lifecycle states; candidate-owned replay/discovery. |
| Characterization | Existing archive/restore/resume/activation and Session DB diagnostics remain passing. |
| Integration tests | Deterministic durable/session/local/browser adapters prove exact phase order and unrelated workspace preservation. |
| Static validation | No DB/store/schema change; close engine invoked only after deletion verification; replacement ledger key is candidate. |
| Commands | Two focused tests; resume/activation/session; ledger/locks; static identity/inventory checks. |
| Evidence | Archive and replacement ten-phase traces; durable/ledger survival proof; protected identity scan. |
| Rollback boundary | Prefer two independent commits. After durable/scoped/live effects, recovery/downgrade evidence is mandatory; never source-only rollback. |
| Stop conditions | Archive would delete its ledger; replacement needs silent target replacement; durable identity differs; close plan cannot be verified without live Chrome in tests. |
| Completion | Both operations have separate schemas/coordinators/tests and exact recovery boundaries. |
| Reasoning/budget | Codex-Sol extra-high; maximum 5% per subtransaction. |
| Independent commit | Archive and replacement should be separate commits, each test-passing; review push only before live validation. |

### D3D-13 — Serialized compatibility projection

| Contract field | Exact slice contract |
|---|---|
| Objective | Route every compatibility peer write/clear/repair through the exact advisory lock as a separate post-primary phase with CAS and pending-repair evidence. |
| Architecture requirements | Lines 433–458; `constellation-runtime-compatibility-projection-v0.1`; no authority; no primary rollback; no primary lock overlap. |
| Dependencies | D3D-02, D3D-03, and primary coordinators D3D-08 through D3D-12. |
| Create | `src/core/runtime-compatibility-projection/contract.js`; `src/core/runtime-compatibility-projection/coordinator.js`; `src/core/runtime-compatibility-projection/chrome-adapter.js`; `tests/runtime-compatibility-projection/runtime-compatibility-projection.test.js`. |
| Modify | `src/core/constellation-storage-compatibility.js`; `src/core/constellation-storage-migration-engine.js`; `src/core/journal-append-coordination/chrome-adapter.js`; `src/core/journal-append-coordination/coordinator.js`; `src/core/runtime-workspace-activation/chrome-adapter.js`; `src/core/workspace-automatic-promotion-integration/chrome-adapter.js`; `src/core/workspace-membership-mutation/chrome-adapter.js`; `src/core/workspace-projection-reconciliation/chrome-adapter.js`; `src/core/workspace-projection-reconciliation/coordinator.js`; `src/core/workspace-store.js`; `src/sidepanel/sidepanel.js`; `src/sidepanel/workspace-metadata-autosave.js`; `src/sidepanel/constellation-compatibility-bootstrap.js`; `src/sidepanel/legacy-archive-projection-cleanup.js`; `src/core/runtime-workspace-create-bind/coordinator.js`; `src/core/runtime-workspace-resume-bind/coordinator.js`; `src/core/runtime-workspace-archive-release/coordinator.js`; `src/core/runtime-workspace-replacement/coordinator.js`. |
| Symbols | `COMPATIBILITY_PROJECTION_LOCK`; snapshot/fingerprint/result schemas; `snapshotCompatibilityPeers`, `compareCompatibilityPreflight`, `coordinateCompatibilityProjectionWrite`, `coordinateCompatibilityProjectionClear`, `coordinateCompatibilityProjectionRepair`, `createCompatibilityProjectionChromeAdapters`. |
| Protected | Common guard; canonical/legacy keys remain both present as identities; old-only/canonical-only/dual fixtures; no retirement. |
| Preserve | Compatibility is advisory input/projection only; transfer/release/close/journal/timeline/metadata/membership/reconciliation do not project. |
| Unit tests | Lock serialization; no nested primary lock; presence/fingerprint drift; conflict/malformed; atomic two-peer write/clear; verify failure; lock unavailable; `primaryBusinessCommitted:true`; pending repair; replay repairs only projection. |
| Characterization | Existing compatibility/bootstrap/migration and all old-route tests remain passing. |
| Integration tests | Two simultaneous projections serialize; primary Alpha/Beta business commits remain independent; injected write failure changes no primary state. |
| Static validation | One exact lock identity; all peer write/clear call sites traced; ordinary mutation imports no projection coordinator. |
| Commands | Focused compatibility test; all primary operation tests; old compatibility/activation tests; inventory/purity checks. |
| Evidence | Complete peer-writer call graph; lock trace; before/after primary-state equivalence on every projection failure. |
| Rollback boundary | Before live load, revert as one complete writer-routing change; never restore only some direct writers. After scoped-only effects, downgrade gate applies. |
| Stop conditions | One writer bypasses the lock; projection must run under primary locks; failure can roll back scoped/durable/assignment/browser state; peer verification is incomplete. |
| Completion | Every production peer mutation is serialized and every failure is explicit pending repair without primary rollback. |
| Reasoning/budget | Codex-Sol extra-high; maximum 5%. |
| Independent commit | Yes only as a complete all-writer closure; push for review, no live load/merge. |

### D3D-14 — Recovery startup and route integration

| Contract field | Exact slice contract |
|---|---|
| Objective | Attach read-only discovery to startup/admission, dispatch one non-overlapping intent to the exact versioned coordinator after fresh verification, and register all additive routes while preserving old routes. |
| Architecture requirements | Restart semantics lines 488–492; recovery discovery lines 218–222; route preservation; service-worker process memory never authority. |
| Dependencies | D3D-01 through D3D-13. |
| Create | `src/core/runtime-workspace-recovery/coordinator.js`; `src/core/runtime-workspace-recovery/service-worker-handler.js`; `tests/runtime-workspace-recovery/runtime-workspace-recovery.test.js`; `tests/layer2-3d-route-integration/layer2-3d-route-integration.test.js`. |
| Modify | `src/background/service-worker.js`; `src/core/automatic-workspace-projection-reconciler.js`; the new coordinator/handler files created by D3D-08 through D3D-12 only where their exact recovery entry is required. `src/core/runtime-workspace-activation/service-worker-handler.js` remains unchanged. |
| Symbols | `coordinateRuntimeWorkspaceRecoveryDiscovery`, `classifyRecoverableWorkspaceOperation`, `dispatchVersionedWorkspaceRecovery`, `scheduleRuntimeWorkspaceRecoveryDiscovery`, exact internal startup handler. |
| Protected | Common guard; old handlers/classifiers remain terminal; no public generic recovery command; old session evidence cannot authorize. |
| Preserve | Service-worker restart can rebuild only read-only indexes; current session authority remains in storage.session; unrelated ledgers untouched. |
| Unit tests | Restart discovery; new extension session; malformed evidence; overlap; stale old session; released/archived/unbound discovery; prior/candidate replacement lookup; completed phases skipped. |
| Characterization | Existing service-worker route families and activation restart tests remain passing. |
| Integration tests | Import-safe handler registry harness proves each schema routes exactly once; fake restart resumes one phase and performs no duplicate effect. |
| Static validation | Complete route table; no dynamic/generic dispatch; new route imports cannot reach old global adapter; startup discovery write count zero. |
| Commands | Recovery and route-integration tests; every focused operation suite; existing activation/session tests; inventory/purity checks. |
| Evidence | Route matrix; restart/replay call traces; old/new session comparison; zero-write discovery evidence. |
| Rollback boundary | Revert startup/route registration before live load; leave committed business families dormant rather than partially registered. |
| Stop conditions | Schema classifier overlap; recovery needs stale authority; overlap can enter two coordinators; discovery mutates or repairs evidence. |
| Completion | All new routes are exact, old routes remain, restart recovery is deterministic, and no process-local authority exists. |
| Reasoning/budget | Codex-Sol extra-high; maximum 5%. |
| Independent commit | Yes as integration wiring after all dependencies; push for review only, no live load. |

### D3D-15 — Automated closure and live-validation packet preparation

| Contract field | Exact slice contract |
|---|---|
| Objective | Close static inventory/purity, full automated tests, root/consumer coverage, protected legacy routes, implementation evidence, and an Operator-only live-validation packet. |
| Architecture requirements | Integration closure stage K; all 28 entries/111 occurrences/45 roots/22 consumers; full failure matrix; required live scenarios. |
| Dependencies | D3D-01 through D3D-14. |
| Create | `tests/layer2-3d-integration/layer2-3d-integration.test.js`; `docs/validation/LAYER-2.3D-IMPLEMENTATION-EVIDENCE.md`; `docs/validation/LAYER-2.3D-LIVE-VALIDATION-PACKET.md`. |
| Modify | `scripts/check-runtime-inventory.mjs`; `scripts/check-runtime-contract-purity.mjs`; `package.json` test scripts only; `tests/README.md`. No dependency or lockfile change. |
| Symbols | New npm script names for each family plus aggregate `test:layer2-3d`; inventory assertions; purity path list; integration scenario builders. |
| Protected | Common guard; frozen architecture artifacts; all eight historical targets; all Layer 2.3C route/schema tests. |
| Preserve | Baseline characterization remains explicitly historical; no live packet step runs automatically. |
| Unit tests | Every focused suite from prior slices. |
| Characterization | Entire existing 617-test baseline remains passing without weakened assertions. |
| Integration tests | Alpha/Beta independent mutations; Gamma resume; duplicate conflict; close/archive isolation; restart/new-session; compatibility failure; placement replay; all route/root closures. |
| Static validation | Inventory 28/111/45/22; unique route schemas; protected identity scan; no raw peer writers; no forbidden imports; pure contract closure. |
| Commands | All focused scripts; `npm test`; `npm run check:inventory`; `npm run check:runtime-contract-purity`; `npm run check`; `git diff --check`. |
| Evidence | Exact commands/counts; final source graph; changed-file inventory; implementation evidence report; non-executed Operator live packet with rollback/stop conditions. |
| Rollback boundary | Automated/source changes are revertible before live load. Packet must describe post-live downgrade gate; it must not execute it. |
| Stop conditions | Any test is weakened/skipped without authority; historical target gains a production edge; a new dependency/permission appears; live validation is needed to claim automated success. |
| Completion | Full automated matrix passes, only authorized implementation paths differ, evidence is honest, and Byte–Nolan review can decide whether to authorize live validation. |
| Reasoning/budget | Codex-Sol extra-high; maximum 5%. |
| Independent commit | Yes; final closure commit. Safe to push for review after checks, never safe to merge/release/load without Byte–Nolan and Operator gates. |

## Implementation test architecture

All tests are Class B pure tests with deterministic adapters unless marked static. They do not import listener-heavy extension roots or use live Chrome/storage/IndexedDB.

| Test category | Proposed test file | Level | Source symbols | Architecture requirement | Failure prevented |
|---|---|---|---|---|---|
| Strict runtime-record validation | `tests/runtime-workspace-record/runtime-workspace-record.test.js` | unit | `snapshotAndValidateRuntimeWorkspaceRecord` | exact v0.1 record | malformed runtime state accepted |
| Unknown-field rejection | same | unit | record validator | fail closed | schema widening/in-place mutation |
| Key/workspace identity mismatch | same | unit | `deriveRuntimeWorkspaceKey`, validator | key/top-level/nested identity equality | cross-workspace read/write |
| Workspace revision conflict | `tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js` | unit | mutation coordinator, record adapter | exact expected revision | last-writer-wins overwrite |
| Exact assignment validation | `tests/runtime-window-binding/runtime-window-binding.test.js` | unit | resolve coordinator | full session/context/window/workspace/ID/epoch | non-owner mutation |
| Stale context | same | unit | resolve/command validators | current registered context | destroyed panel authority |
| Stale assignment ID | same | unit | assignment verification | exact assignment ID | replay under replaced assignment |
| Stale assignment epoch | same | unit | assignment verification | positive exact epoch | stale ownership reuse |
| Unbound window behavior | same | unit/integration | side-panel authority | no compatibility fallback/read | implicit global selection |
| Occupied target behavior | create/resume/transfer focused tests | unit | operation preflight coordinators | no silent replacement | target workspace loss |
| Active-elsewhere behavior | same | unit | assignment preflight | one workspace → zero/one window | duplicate writable assignment |
| Alpha/Beta independent ordinary mutations | `tests/layer2-3d-integration/layer2-3d-integration.test.js` | integration | mutation coordinator/adapters | independent scoped keys/locks | cross-Stella serialization/loss |
| Deterministic multi-lock ordering | `tests/runtime-scoped-locks/runtime-scoped-locks.test.js` | unit | `buildScopedLockPlan`, `compareScopedLocks` | numeric/code-unit order | lock inversion/deadlock |
| No cross-workspace content serialization | same | deterministic concurrency | `runWithScopedLocks` | ordinary content avoids global root lock | Alpha blocks Beta |
| Compatibility projection serialization | `tests/runtime-compatibility-projection/runtime-compatibility-projection.test.js` | deterministic concurrency | projection coordinator/lock | one exact advisory lock | peer lost update |
| Compatibility drift | same | unit | preflight comparison | reread presence/fingerprints | overwrite changed peers |
| Compatibility write failure | same | unit | projection adapter/result | pending repair, no rollback | primary business rollback |
| `primaryBusinessCommitted:true` | same | unit/integration | projection result and primary operation hooks | post-primary failure contract | false operation failure/retry |
| Operation replay | `tests/runtime-workspace-operation-ledger/runtime-workspace-operation-ledger.test.js` plus operation tests | unit | ledger inspect/recovery | completed effects not repeated | duplicate mutation |
| Operation-ID conflict | same | unit | fingerprint classifier | different fingerprint conflicts | operation aliasing |
| Pending evidence retention | same | unit | ledger prune | unresolved never evicted | unrecoverable partial operation |
| Terminal pruning | same | unit | `pruneWorkspaceOperationTerminals` | oldest terminal only, limit 256 | pending eviction/unbounded terminal growth |
| Malformed recovery evidence | `tests/runtime-workspace-recovery/runtime-workspace-recovery.test.js` | unit | discovery/validator | fail closed/report only | unsafe repair or execution |
| Recovery overlap conflict | same | unit | `classifyRecoveryOverlap` | one affected workspace at a time | overlapping recovery effects |
| Old-session evidence rejection | same | unit | recovery coordinator | fresh current verification | stale session authority |
| Service-worker restart | same | integration fake | startup scheduling/dispatch | storage-backed evidence, no process authority | lost or duplicated operation |
| New extension session | same | integration fake | discovery + session adapter | surviving records non-writable | old assignment resurrection |
| Replacement discovery from prior/candidate | ledger/recovery and replacement tests | unit | affected-workspace index | candidate-owned ledger relevance | stranded prior recovery |
| Archive ledger survival | `tests/runtime-workspace-archive-release/runtime-workspace-archive-release.test.js` | integration fake | archive coordinator/ledger adapter | ledger outlives scoped deletion | lost archive recovery evidence |
| Trusted close only one workspace | `tests/runtime-workspace-release/runtime-workspace-release.test.js` | integration fake | trusted close coordinator | exact removed-window assignment | other Stella paused/released |
| No second placement destination on replay | transfer/manual/promotion tests | integration fake | transfer and placement coordinators | forward recovery/replay | duplicate tabs/window binding |
| All 45 roots assigned/gated | `tests/sidepanel-runtime-root-closure/sidepanel-runtime-root-closure.test.js` | static | HTML/root source scan | production-root closure | hidden global reader/writer |
| All 22 runtime-store consumers classified | same | static | import graph scan | complete consumer migration | validation reader bypass |
| Protected Layer 2.3C behavior available | `tests/layer2-3d-route-integration/layer2-3d-route-integration.test.js` plus existing suites | static/integration | old/new handler registry | additive schemas/routes | old client breakage |
| Archive/replacement phase ordering | archive/replacement focused tests | integration fake | coordinators | exact ten-phase tables | durable/authority divergence |
| Browser identifier revalidation | resume/transfer/archive tests | unit/integration fake | browser adapters/close engine | browser evidence not authority | stale ID mutation |

## Architecture traceability matrix

The evidence column names the artifact or deterministic output future implementation must return; it does not claim that evidence exists now.

| Architecture requirement | Inventory entry/path | Slice | Production symbol | Test/static proof | Expected evidence |
|---|---|---|---|---|---|
| Stable scoped key and strict v0.1 record | `workspace-store`; new record family | D3D-01 | `deriveRuntimeWorkspaceKey`, record validator | runtime-record test | schema fixture matrix |
| No binding fields in scoped record | runtime-session/activation families | D3D-01, D3D-04 | record validator, panel authority | unknown/forbidden-field tests | strict-field report |
| Session authority sole binding owner | `runtime-session-authority-family` | D3D-03, D3D-04 | existing assignment reducers + resolve coordinator | window-binding/session tests | exact identity trace |
| Resolve is read-only and total | `runtime-activation-family` | D3D-04 | resolve coordinator/result | window-binding tests | zero-write adapter log |
| Unbound panel has no compatibility fallback | `side-panel-entry`; 45 roots | D3D-04, D3D-07 | side-panel authority | root closure + unbound tests | import/access scan |
| Full assigned mutation evidence | journal/membership/reconciliation/store entries | D3D-05, D3D-06 | versioned validators/coordinators | stale identity/revision tests | command/result matrix |
| Semantic operations, no whole-object LWW | `workspace-store`, journal, membership | D3D-05, D3D-06 | typed mutation coordinator/reducers | conflict/replay tests | mutation-kind coverage |
| Workspace-local operation ledger | `operation-ledger-authority-family` | D3D-02 | ledger contract/adapter | ledger tests | key/lock trace |
| Immutable intent and progress | same | D3D-02 | intent/progress functions | mutation-rejection tests | byte-equivalence proof |
| Pending retention/terminal pruning | same | D3D-02 | prune function | retention tests | >256 fixture result |
| Read-only recovery discovery | same | D3D-02, D3D-14 | discovery/recovery coordinators | recovery tests | zero-write discovery log |
| Overlap conflict and affected relevance | same | D3D-02, D3D-14 | overlap/index functions | replacement/overlap tests | relevance index fixture |
| Scoped lock order | session/ledger/mutation entries | D3D-03 | lock contract/ordering | lock tests | acquire/release trace |
| Alpha/Beta ordinary independence | store/journal/membership/reconciliation | D3D-03, D3D-05, D3D-06 | scoped lock adapter | concurrency integration | overlapping callback trace |
| Additive create-and-bind | `creation-assignment-family` | D3D-08 | create-bind family | focused create test | ten-phase trace |
| Additive resume-and-bind | `resume-family` | D3D-09 | resume-bind family | focused resume test | browser/scoped/assignment trace |
| Browser-first resume recovery | resume paths/hydration engine | D3D-09 | resume engine subtransaction | partial failure/replay tests | created-artifact log |
| Transfer leaves source unbound | placement/promotion families | D3D-10 | transfer coordinator | transfer tests | source/destination result |
| No duplicate destination | placement/promotion families | D3D-10 | transfer recovery classifier | replay tests | destination-count proof |
| Explicit release pauses exact record | session/window-close entries | D3D-11 | release coordinator | release tests | assignment/pause trace |
| Trusted close internal only | `window-close-lifecycle` | D3D-11 | trusted close coordinator | public rejection/close isolation | route and state diff |
| Archive durable → release → delete → close | `archive-family`, durable DB | D3D-12 | archive-release coordinator | archive phase tests | durable/ledger survival proof |
| Replacement candidate-owned evidence | archive/activation/ledger entries | D3D-12 | replacement coordinator | prior/candidate tests | ledger ownership proof |
| One serialized compatibility projection | `compatibility-api` | D3D-03, D3D-13 | projection coordinator | serialization test/static call graph | lock/call trace |
| Projection drift/failure never rolls back primary | compatibility and operation entries | D3D-13 | projection result/hooks | failure integration | primary byte-equivalence |
| No ordinary mutation takes compatibility lock | store/journal/membership/reconciliation | D3D-05, D3D-06, D3D-13 | lock-plan builders | static + lock tests | forbidden-import report |
| Protected compatibility routes remain | identities/bootstrap/old handlers | D3D-13, D3D-14 | old and new route classifiers | route integration | route matrix |
| All production roots/consumers close | validation/runtime-store entries | D3D-07 | assigned packet builders/gates | 45/22 static tests | complete closure table |
| Eight historical targets stay unreferenced | historical inventory entries | D3D-15 | none | inventory static graph | zero-edge report |
| DB/stores/settings preserved | durable pointer/session DB entries | D3D-12, D3D-15 | existing repositories | protected identity scan | identity diff |
| Restart/new-session semantics | ledger/window-close/activation entries | D3D-14 | recovery startup | recovery integration | restart matrix |
| Future Constellation composition remains workspace-ID based | record/assignment contracts | D3D-01, D3D-04 | validators/results | identity tests/static schema | no composite authority field |
| Operator-controlled live validation only | all entries | D3D-15 | live packet, no executable symbol | packet static review | non-executed procedure |

## Incremental commit strategy

No commit is authorized by this map. The sequence below is a recommendation for future explicitly authorized runs. Every commit must begin clean, contain only its named slice/sub-slice, pass focused tests plus affected existing suites, and leave old routes usable.

| Order | Recommended commit | Review boundary | Safe to push before live validation? |
|---:|---|---|---|
| 1 | `layer2.3d: add strict scoped runtime record contract` | D3D-01 pure contract/test; adapter may be separate | Yes, feature branch review only. |
| 2 | `layer2.3d: add workspace operation ledger and discovery` | D3D-02 pure kernels/adapters/tests | Yes. |
| 3 | `layer2.3d: add scoped lock domains and ordering` | D3D-03 plus session lock seams | Yes. |
| 4 | `layer2.3d: add read-only window binding resolution` | D3D-04 route/panel authority | Yes, but do not live-load. |
| 5 | `layer2.3d: migrate typed ordinary runtime mutations` | D3D-05 complete reader/writer route | Yes for review; not safe to live-load alone. |
| 6 | `layer2.3d: scope membership mutation` | D3D-06 membership sub-slice | Yes for review. |
| 7 | `layer2.3d: scope projection reconciliation` | D3D-06 reconciliation sub-slice | Yes for review. |
| 8 | `layer2.3d: close product runtime readers` | D3D-07 product/library/runtime-store consumers | Yes for review; keep validation readers for next passing commit. |
| 9 | `layer2.3d: gate production-loaded validation readers` | D3D-07 validation/root closure | Yes for review. |
| 10 | `layer2.3d: add create and bind transaction` | D3D-08 | Yes for review, no live load. |
| 11 | `layer2.3d: add resume and bind transaction` | D3D-09 | Yes for review, no live load. |
| 12 | `layer2.3d: add transfer transaction` | D3D-10 transfer kernel | Yes for review. |
| 13 | `layer2.3d: route placement and promotion through transfer` | D3D-10 callers | Yes for review. |
| 14 | `layer2.3d: add release and trusted window close` | D3D-11 | Yes for review, no live load. |
| 15 | `layer2.3d: add archive and release transaction` | D3D-12 archive sub-slice | Yes for review. |
| 16 | `layer2.3d: add explicit replacement transaction` | D3D-12 replacement sub-slice | Yes for review. |
| 17 | `layer2.3d: serialize compatibility projection` | D3D-13 complete writer closure | Yes only when every peer writer is included. |
| 18 | `layer2.3d: attach restart recovery and routes` | D3D-14 | Yes for review, no live load. |
| 19 | `layer2.3d: close automated validation and evidence` | D3D-15 | Yes for Byte–Nolan review; merge/release/live load still prohibited. |

Foundation and production migration must not be combined merely to reduce commit count. Conversely, a writer-migration commit must not leave a newly enabled route half global and half scoped.

## Source-grounded risk register

| Risk | Affected current/future source | Prevention mechanism | Test or evidence | Stop condition |
|---|---|---|---|---|
| Global compatibility state reused as authority | `workspace-store.js`, activation adapter, side-panel/runtime-store readers | New panel authority; new routes cannot import old global store; static call graph | unbound/root closure tests | Any new route derives ownership from compatibility. |
| Partial writer migration | journal, metadata, membership, reconciliation, runtime store, compatibility callers | Complete writer ledger per slice; old route explicit; no mixed enabled route | inventory/static writer scan | One enabled Layer 2.3D writer still targets global pair. |
| Production-loaded validation reader writes on startup | `layer2-persistence-validation.js` lines 32→37→147 and other roots | Assigned input or explicit unbound packet; remove global startup call | 45-root static test and startup call trace | Any unbound root reads/writes global active workspace. |
| Lock inversion | session, transfer, replacement, archive, compatibility | Pure ordered plans and fail-closed adapter | scoped-lock order/inversion tests | Runtime requires earlier-domain acquisition while later held. |
| Global runtime-state serializes Alpha/Beta | old `LOCK_ORDER`, existing coordinators/adapters | New ordinary routes take only scoped locks; root lock only for session root/shared old ledger | deterministic Alpha/Beta overlap test | Ordinary content plan includes global runtime-state. |
| Replay duplicates effects | every new coordinator and ledger | Immutable intent/progress; exact phase dispatch; artifact IDs | replay/restart tests | A completed phase can execute twice. |
| Assignment/scoped-record divergence | create/resume/transfer/release/replacement | Phase evidence, reread verification, operation-local compensation/forward recovery | operation phase tests | Success can return without both authoritative rereads. |
| Stale service-worker recovery | discovery/recovery/service worker | Storage-backed intent plus fresh session/context/assignment/revision/browser verification | restart/new-session tests | Old session evidence is sufficient to mutate. |
| Compatibility failure rolls back primary | compatibility coordinator and operation terminal hooks | Separate post-primary phase after lock release; pending repair | injected drift/write/verify failure | Projection path can mutate primary state or rerun business. |
| Archive deletes recovery evidence | archive coordinator and local ledger adapter | Ledger key separate from scoped record; verify ledger after deletion | archive survival test | Scoped deletion removes or loses ledger evidence. |
| Old route accepts new envelope | every service-worker handler/classifier | Exact schemas and terminal dispatch; no generic type fallback | route integration matrix | Any envelope matches two routes or old coordinator. |
| New route mutates protected identifiers | contracts, compatibility, session DB, package | Additive schemas; protected identity static scan | schema/identity diff | Existing identifier/value/store/version changes. |
| Live downgrade after scoped-only mutation | every production slice after D3D-05 | Architecture downgrade gate and live packet | packet review; scoped/durable inventory plan | Source rollback is proposed after live scoped effects. |
| Browser evidence treated as durable/assignment authority | resume/transfer/archive adapters | revalidate IDs immediately before mutation; ambiguity blocks | stale-ID/ambiguous-match tests | Browser match alone enables binding or deletion. |
| Candidate replacement strands prior recovery | replacement and discovery | candidate-owned ledger with sorted affected IDs | prior/candidate discovery test | Prior workspace cannot find unresolved replacement. |
| Diagnostic mutation gains workspace authority | runtime-store diagnostic consumers | keep diagnostic API/storage separate; no assigned result generated | consumer static scan | Diagnostic event or packet becomes a writable workspace source. |

## Per-slice evidence report template

Every implementation run returns:

1. expected and observed repository/branch/`HEAD`/upstream/tree;
2. slice ID and frozen architecture requirements;
3. exact created/modified/deleted paths;
4. exact symbols added or changed;
5. protected identities inspected and whether read/written/versioned;
6. focused commands, expected side effects, exact results/counts;
7. affected existing suites and aggregate check results;
8. tests not run and why;
9. phase/lock/replay evidence appropriate to the slice;
10. complete diff self-review and scope-deviation statement;
11. rollback boundary and whether the post-live downgrade gate has become relevant;
12. final branch, `HEAD`, status, diff check/stat/name-status;
13. explicit statement that no commit/push/PR/live action occurred unless separately authorized.

## Map completion checks

This map is complete only when static validation confirms:

- 28/28 inventory entries represented in the entry table;
- 111/111 inventory occurrences represented by those entries and 84/84 unique paths assigned exactly one allowed final disposition;
- 45/45 direct side-panel roots represented;
- 22/22 `workspace-runtime-store.js` consumers represented;
- every `migrationRequired:true` entry maps to one or more slices;
- all eight `historical_unreferenced` files remain preserved;
- every proposed production/test/evidence path has an existing nearest parent (`src/core`, `tests`, or `docs/validation`) and follows an observed family convention;
- every slice specifies tests, stop conditions, completion, rollback, reasoning, budget, and independent-commit policy;
- every accepted architecture domain maps to a slice and automated/static evidence;
- no executable source, test, script, package, HTML, manifest, accepted architecture, or evidence file changed during this planning run;
- the only working-tree change is this untracked implementation map.

The 617-test suite is deliberately not part of this map-authoring run because no executable source is authorized to change. Future production slices must run their focused tests and the affected/full automated checks specified above.
