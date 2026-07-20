# Layer 2.3D Concurrent Multi-Stella Window Binding Contract

## Status and scope

This is the implementation architecture for Layer 2.3D. It is a Byte-Nolan review proposal and is not evidence of live Chrome validation or release acceptance.

Layer 2.3D replaces one globally writable active-workspace object with independently addressable workspace runtime records bound to verified Chrome windows. Product-facing language calls one durable cognitive workspace a Stella; internal source, persistence, schema, and compatibility language remains `workspace`.

This layer does not add Constellation composition, inference, network access, telemetry, content scripts, host permissions, dependencies, or a UI redesign.

## Approved product semantics

- One window owns zero or one active writable workspace assignment.
- One workspace owns zero or one active writable window assignment.
- Different workspaces may be writable concurrently in different windows.
- Focus never creates, transfers, replaces, or releases authority.
- An unbound panel remains unbound and may explicitly create or resume a workspace.
- An occupied target window is never silently replaced.
- A workspace active elsewhere returns deterministic conflict evidence.
- Transfer releases the source window and does not make it globally read-only.
- Archive, close, rollback, and failure affect only the exact workspace and assignment named by the operation.
- `workspaceId` remains the durable workspace identity and remains suitable for future Constellation composition.

## Current-state diagnosis

The accepted Layer 2.3C foundation already supplies runtime-session identity, context registration, one active assignment per window, one active assignment per workspace, monotonic assignment epochs, create/transfer/replace/release reducers, stale-context validation, operation ledgers, and verified writes.

The blocking singleton is the protected compatibility pair `constellationActiveWorkspace` / `chromeFlowWorkspace`. Current production startup and several mutation paths still read or replace that pair as writable authority. `activeWorkspaceId` is a durable compatibility pointer and cannot express per-window ownership. Every one of the 45 module scripts declared directly at `src/sidepanel/sidepanel.html` lines 144-188 is a production-loaded root regardless of product, developer, diagnostic, preview, or validation purpose. Several roots access active-workspace state without assignment validation. Inventory v0.4 records exact root lines, static and transitive imports, startup behavior, access/mutation classes, and migration disposition.

The compatibility pair and `activeWorkspaceId` remain protected, but after Layer 2.3D they are compatibility projection or controlled bootstrap input only. They cannot authorize a mutation.

## Authority-domain matrix

Authority is domain-specific rather than a strict hierarchy.

| Domain | Sole authority | Storage/lifetime | Owns | Cannot authorize |
|---|---|---|---|---|
| Durable workspace memory | Session DB / IndexedDB records | Persistent | Durable workspace identity, saved content, journal/timeline records, snapshots, recovery relationships | Current window ownership or browser identity |
| Scoped active runtime content | `constellationRuntimeWorkspace:<workspaceId>` | `chrome.storage.local`, cross-session | Current mutable runtime content and its revision | Window binding, context validity, or durable replacement |
| Current-session window assignment | `constellationRuntimeSessionAuthority` | `chrome.storage.session`, current extension session only | Context registry, one active assignment per window, one active assignment per workspace, assignment ID and epoch | Workspace content, durable memory, or browser projection truth |
| Browser projection | Revalidated Chrome windows/tabs/groups | Browser lifetime | Current live browser placement evidence | Durable identity, runtime content, or writable ownership |
| Compatibility projection | Canonical/legacy peers serialized by `constellation-runtime-compatibility-projection-v0.1` | `chrome.storage.local`, advisory | Atomic advisory peer write/clear/repair after verified primary business | Assignment, workspace content, durable identity, browser truth, or mutation authority |
| Derived UI state | Current side-panel document | Context lifetime | Rendering, progress, and command presentation | Any persistence or mutation authority |

`constellationRuntimeSessionAuthority` is the sole current window-binding authority. A scoped runtime record, compatibility value, durable record, browser object, focus state, or UI cache can never grant writable ownership.

## Identity model

Identity evidence is operation-specific. No universal envelope fabricates identities that do not yet exist. Resolution and unbound create/resume commands establish context and preconditions; existing assigned-workspace mutations prove the complete current assignment; trusted coordinators alone generate new assignment IDs and epochs.

`workspaceId` is durable. Runtime session, context, assignment, epoch, window, browser projection, and operation identities are scoped evidence. An assigned-workspace mutation is writable only when its complete current evidence matches verified session authority and the scoped runtime record. Empty strings, sentinel assignment IDs, zero epochs, and client-generated assignment authority are invalid.

The command's `sourceContextId` must match the currently registered active context for `sourceWindowId`. An assignment's stored `sourceContextId` is creation/transfer provenance only. Panel recreation replaces the registered context for that window without invalidating its otherwise valid assignment. Subsequent commands use the new current context plus the unchanged assignment ID and epoch.

The trusted service-worker window-close lifecycle has no panel context. It uses an internal-only service-worker envelope and the exact assignment resolved by the removed window ID. It is never exposed as a public runtime-message route.

## Workspace-scoped runtime record

### Key

```text
constellationRuntimeWorkspace:<workspaceId>
```

The key is derived only from a validated, non-empty `workspaceId`. There is no global registry object containing all active workspaces.

### Schema

```text
constellation-runtime-workspace-v0.1
```

The exact v0.1 record is:

```json
{
  "schema": "constellation-runtime-workspace-v0.1",
  "workspaceId": "workspace-alpha",
  "workspaceRevision": 7,
  "workspace": {},
  "lifecycleState": "available",
  "provenance": {
    "kind": "explicit_create",
    "operationId": "operation-id",
    "compatibilitySource": "none"
  },
  "lastVerifiedAt": "2026-07-20T00:00:00.000Z"
}
```

Contract rules:

- `workspace.workspaceId` equals top-level `workspaceId`.
- `workspaceRevision` equals the normalized revision of `workspace`.
- `lifecycleState` is `available` or `paused`. It describes runtime-content readiness, not ownership.
- The record contains no authoritative window, assignment, epoch, context, or runtime-session binding.
- Historical binding evidence is omitted from v0.1. If a future schema retains it, the field must be named and documented as non-authoritative provenance and must never be required for writable authority.
- `lastVerifiedAt` is evidence, never ordering authority.
- `provenance.kind` is one of `explicit_create`, `explicit_resume`, `explicit_restore`, `compatibility_seed`, `transfer`, `replacement`, or `recovery`.
- `compatibilitySource` is one of `none`, `legacy_only`, `canonical_only`, or `dual_equivalent`.
- The complete record must be plain JSON-serializable data.
- Unknown or malformed v0.1 fields fail closed. Structural changes require a new schema identifier.

Lifecycle rules:

- A record is writable only while a current verified assignment in `constellationRuntimeSessionAuthority` binds its workspace to the command's window, irrespective of `lifecycleState` alone.
- An unbound window selects and reads no scoped runtime record as writable state.
- Explicit release or service-worker window close changes the exact record to `paused` after assignment release is verified. A failed pause write leaves a non-writable orphan because no assignment exists; recovery retries the exact pause.
- Transfer retains `available`; ownership changes only in session authority.
- A new extension session grants no authority to any surviving local record. An explicit create/resume/recovery command must establish a new verified assignment before mutation.
- Archive deletes the scoped runtime record after durable archive verification and exact assignment release. Layer 2.3D creates no runtime tombstone and retains no full archived runtime payload. Durable archive data plus terminal operation evidence are the archive record. If deletion cannot be verified, the operation is indeterminate and retry performs deletion only; the stale local record remains non-writable because the assignment was released.

## Command and result schemas

Layer 2.3D adds, rather than edits in place, these exact identifiers:

| Operation | Command schema | Result schema |
|---|---|---|
| Resolve window binding | `constellation-runtime-window-binding-resolve-command-v0.1` | `constellation-runtime-window-binding-resolve-result-v0.1` |
| Create and bind | `constellation-runtime-workspace-create-bind-command-v0.1` | `constellation-runtime-workspace-create-bind-result-v0.1` |
| Resume and bind | `constellation-runtime-workspace-resume-bind-command-v0.1` | `constellation-runtime-workspace-resume-bind-result-v0.1` |
| Transfer | `constellation-runtime-workspace-transfer-command-v0.1` | `constellation-runtime-workspace-transfer-result-v0.1` |
| Release | `constellation-runtime-workspace-release-command-v0.1` | `constellation-runtime-workspace-release-result-v0.1` |
| Archive and release | `constellation-runtime-workspace-archive-release-command-v0.1` | `constellation-runtime-workspace-archive-release-result-v0.1` |
| Explicit replacement | `constellation-runtime-workspace-replace-command-v0.1` | `constellation-runtime-workspace-replace-result-v0.1` |
| Service-worker window close | `constellation-runtime-window-close-lifecycle-command-v0.1` | `constellation-runtime-window-close-lifecycle-result-v0.1` |

Required identity categories are exact:

| Operation category | Required command evidence | Explicitly absent or internally generated |
|---|---|---|
| Resolve window binding | `operationId`, current `runtimeSessionId`, current `sourceContextId`, exact `sourceWindowId`, `requestedAt` | No workspace, revision, assignment ID, or epoch is required before resolution |
| Create and bind | Resolve identities; `expectedUnboundWindow: true`; candidate `workspaceId`; candidate revision and canonical digest; `requestedAt` | No current assignment exists; trusted coordinator adapters generate the new assignment ID and epoch |
| Resume and bind | Resolve identities; `expectedUnboundWindow: true`; exact durable workspace identity; expected durable revision and canonical snapshot digest; `requestedAt` | No current assignment identity exists; trusted coordinator adapters generate it and the result returns it |
| Existing assigned-workspace mutation | `operationId`, current session/context/window, `workspaceId`, expected workspace revision, exact current `runtimeAssignmentId` and positive `assignmentEpoch`, `requestedAt` | Nothing is synthesized by the client |
| Transfer or release | Full exact current assignment evidence; transfer also requires target window, its current context when panel-originated, and `expectedTargetUnbound: true` | Transfer's destination assignment identity/epoch is generated internally |
| Archive and release | Full exact current assignment, workspace identity, expected scoped revision, durable archive precondition/digest, `requestedAt` | No replacement authority is implied |
| Explicit replacement | Exact prior assignment/workspace/revision evidence; exact candidate workspace/revision/digest; target window; candidate active-elsewhere preflight; `requestedAt` | Candidate assignment ID/epoch is generated internally and returned after verification |
| Trusted window close | Internal `operationId`, current `runtimeSessionId`, exact `windowId`, `observedAt`, `trustedSource: "service_worker_window_removed"` | No panel context; assignment is resolved and verified internally |

Every result is total and JSON-serializable and contains its schema, status, reason, operation ID, identities known for that operation, phase, mutation/verification flags, retry/indeterminate flags, warnings, and errors. Successful create, resume, transfer, or replacement returns the newly generated verified assignment identity and epoch. Published Layer 2.3C schemas remain unchanged.

## Command envelope

Every meaningful runtime mutation uses its operation-specific versioned command, named mutation kind, plain JSON payload, and `requestedAt`. Validation requires only identities that can exist at that operation boundary. It rejects stale supplied evidence before adapters run and rejects any client-supplied assignment identity for create/resume or candidate replacement.

Duplicate operation IDs with an identical canonical fingerprint replay verified terminal evidence or recover a documented pending operation. Reuse with a different fingerprint conflicts. A terminal replay performs no duplicate workspace, assignment, durable-memory, or browser mutation.

## Workspace-scoped operation evidence

Layer 2.3D recovery and replay evidence uses one local ledger per workspace:

```text
key: constellationRuntimeWorkspaceOperationLedger:<workspaceId>
schema: constellation-runtime-workspace-operation-ledger-v0.1
storage: chrome.storage.local
terminal retention limit: 256
```

The ledger is recovery evidence, not workspace content, current-session assignment authority, or browser truth. Its exact record shape is:

```json
{
  "schema": "constellation-runtime-workspace-operation-ledger-v0.1",
  "workspaceId": "workspace-alpha",
  "terminalRetentionLimit": 256,
  "nextSequence": 2,
  "entries": [{
    "operationId": "operation-id",
    "requestFingerprint": "canonical-request-fingerprint",
    "commandSchema": "versioned-command-schema",
    "workspaceId": "workspace-alpha",
    "affectedWorkspaceIds": ["workspace-alpha"],
    "runtimeSessionId": "runtime-session-id-or-null",
    "operationIntent": {
      "operationKind": "create_and_bind",
      "commandSchema": "versioned-command-schema",
      "primaryWorkspaceId": "workspace-alpha",
      "affectedWorkspaceIds": ["workspace-alpha"],
      "sourceWindowId": null,
      "targetWindowId": 101,
      "expectedRuntimeSessionId": "runtime-session-id",
      "expectedAssignmentId": null,
      "expectedAssignmentEpoch": null,
      "expectedWorkspaceRevisions": {"workspace-alpha": 0},
      "durableSourceIdentity": null,
      "durableSnapshotDigest": null,
      "browserPlanDigest": null,
      "projectionBaselineDigest": null,
      "compatibilityPreflightFingerprints": {"canonical": null, "legacy": null},
      "completedPhasesAtIntentWrite": [],
      "nextRecoverablePhaseAtIntentWrite": "runtime_record_mutation",
      "plannedArtifactIds": ["constellationRuntimeWorkspace:workspace-alpha"]
    },
    "state": "pending",
    "phase": "pending_evidence",
    "requestedAt": "2026-07-20T00:00:00.000Z",
    "updatedAt": "2026-07-20T00:00:00.000Z",
    "createdArtifacts": [],
    "compensationEvidence": {"status": "not_required", "actions": []},
    "result": null,
    "recoveryEvidence": {"completedPhases": ["pending_evidence"], "nextRecoverablePhase": "runtime_record_mutation", "createdArtifactIds": []},
    "sequence": 1
  }]
}
```

Validation requires an exact schema; matching top-level and entry `workspaceId`; `terminalRetentionLimit === 256`; positive safe `nextSequence`; unique positive sequences below `nextSequence`; unique non-empty operation IDs; canonical non-empty fingerprints; a published Layer 2.3D command schema; sorted unique `affectedWorkspaceIds` containing the primary workspace; valid timestamps; plain JSON artifacts/evidence; and `state` in `pending`, `indeterminate`, or `terminal`. `runtimeSessionId` is a non-empty string for session-sensitive operations and `null` otherwise. Pending and indeterminate entries require recovery evidence. Terminal entries require a total result. Unknown fields fail closed.

`operationIntent` is written once before business effects and is byte-immutable thereafter. It validates the operation kind/schema, primary and affected workspaces, nullable source/target windows, expected session, nullable exact prior assignment ID/positive epoch, per-workspace expected revisions, optional durable identity/snapshot digest, optional browser-plan/projection-baseline digests, compatibility preflight fingerprints, initial completed/next phase, and deterministic planned artifact identities. It stores identities and canonical digests, never duplicate workspace content. Later progress is append-only evidence in `completedPhases`, `nextRecoverablePhase`, `createdArtifacts`/`createdArtifactIds`, and compensation/result evidence; it cannot rewrite intent.

Pending and indeterminate entries are never evicted automatically. Only the oldest terminal entries by sequence are pruned when terminal entries exceed 256; unresolved entries may make the total ledger longer than 256. A reused operation ID with a different fingerprint returns `operation_id_conflict`. An exact fingerprint replay returns terminal evidence or resumes the recorded phase without repeating completed business effects. A recorded old `runtimeSessionId` is evidence only and never grants current assignment authority.

Resolve-window-binding is read-only and creates no ledger entry. Create, resume, transfer, release, archive, replacement, and trusted window close use the primary workspace ledger. Replacement owns evidence under `candidateWorkspaceId` and lists the prior workspace in `affectedWorkspaceIds`. A trusted close with no assignment is a read-only no-op and creates no ledger. Archive ledger evidence survives deletion of the scoped runtime-content record.

Ledger reads and writes occur under `constellation-runtime-workspace:<workspaceId>` after any earlier window/binding/root locks required by the operation. Alpha and Beta therefore use different local keys and workspace locks. No global Layer 2.3D ledger object exists. The protected session key `constellationRecentOperationLedger` and schema `constellation-runtime-operation-ledger-v0.1` remain unchanged for existing Layer 2.3C routes; their global runtime-state/exclusive lock behavior is preserved until those routes migrate through separately versioned commands.

### Read-only recovery discovery

After startup or service-worker restart, discovery reads local-storage keys whose names match exactly `constellationRuntimeWorkspaceOperationLedger:` plus one validated non-empty workspace ID. It validates each suffix against top-level ledger `workspaceId`, validates every pending/indeterminate entry and immutable intent, and indexes relevance from both primary `workspaceId` and `affectedWorkspaceIds` in process-local read-only results. Discovery performs no storage, assignment, scoped-record, durable, browser, or compatibility mutation; creates no global writable registry; and treats every cache as non-authoritative.

Malformed keys, ledgers, entries, or intents fail closed and are reported without repair. No new mutation for any affected workspace begins until prior unresolved work is classified. One relevant unresolved operation may be passed, unchanged, to its versioned recovery coordinator only after fresh present-state and lock acquisition. Multiple unresolved operations with overlapping affected workspace IDs return `recovery_operation_conflict` and enter none. Candidate-owned replacement evidence is discoverable from the prior workspace through `affectedWorkspaceIds`; released, archived, paused, and unbound workspaces remain discoverable because ledger keys outlive assignment and scoped content. Old `runtimeSessionId` or expected assignment evidence never authorizes recovery: current session, assignment, revisions, durable state, and browser effects are freshly verified. Completed phases and exact effects are not repeated, and unrelated ledgers are never rewritten.

## Side-panel bootstrap

The required order is:

1. Register the current panel context.
2. Validate the newly current context, then resolve the assignment for that exact window from `constellationRuntimeSessionAuthority`.
3. If no assignment exists, enter `unbound`; do not read the compatibility pair as writable state.
4. If assigned, derive the scoped key from the assignment workspace ID.
5. Read and strictly validate that scoped runtime record.
6. Verify the current session assignment itself against runtime session ID, current context/window, workspace ID, assignment ID, and epoch; do not look for duplicated binding evidence in the record.
7. Verify scoped workspace identity and revision independently.
8. Enter `assigned` only after complete verification.
9. Enter `active_elsewhere` or `stale_assignment` with explicit evidence when applicable. `blocked_compatibility_conflict` applies only while an unbound Operator-authorized seed/recovery flow is selecting compatibility input.

Rendering and mutation helpers receive the verified assigned workspace explicitly or through one panel-local authority object. They do not fall back to focus or the global pair.

## Operation contracts

### Resolve window binding

Returns `assigned`, `unbound`, `stale_context`, `stale_assignment`, `active_elsewhere`, `malformed_runtime_record`, or `failed`, with a total serializable result. It performs no mutation. `assigned` requires the current context and current session assignment; assignment provenance context is not compared.

### Create and bind

Requires an unbound verified window. It creates one scoped record, creates one assignment, verifies both, and records terminal evidence. Failure removes only a scoped record created by the same operation and only when no verified assignment references it.

### Resume and bind

Loads one exact durable workspace through the existing resume contract, rejects an occupied window or workspace active elsewhere, establishes the scoped record, creates the assignment, and verifies both. Browser rollback and durable-memory behavior remain the existing resume contract's responsibility.

### Transfer or promote

Requires the exact source assignment ID and epoch and an unoccupied destination. It uses existing placement policy and recovery evidence, transfers only that workspace, retains its scoped record at `lifecycleState: "available"`, verifies browser placement and session assignment authority, and leaves the source window unbound. It writes no ownership field into the scoped record.

### Release

Explicit pause/release requires the exact current assignment, releases only it, marks the exact scoped record paused, and performs no implicit transfer.

### Release on window close

Releases only the assignment whose `windowId`, assignment ID, and epoch match the closing window. After release verification, it saves/reconciles as required and marks only that workspace's scoped record `paused`. Other records are untouched.

### Archive and release

Archives and verifies the exact durable workspace, releases and verifies the exact assignment, then deletes and verifies absence of the exact scoped runtime-content record. Durable archive and workspace-ledger evidence remain; other workspaces and projections are preserved.

### Explicit replacement

Requires exact prior workspace, window, assignment ID, epoch, and revision evidence. Selection alone is insufficient. Occupied, stale, or active-elsewhere candidates fail before mutation.

## Cross-domain transaction phase tables

The tables define business-effect order. Lock acquisition order is defined separately and is not inferred from these phases.

### Resolve window binding phases

| Required phase | Exact behavior |
|---|---|
| Precondition reads | `operationId`, current session/context/window, and `requestedAt`; no workspace or assignment identity required; coordinator resolves assignment by exact window, then reads the scoped record when assigned |
| Lock acquisition | Window lock then workspace-binding lock when an assignment exists; read-only, no global root write lock |
| Pending evidence | None; resolve is read-only and uses no operation ledger |
| Runtime-record mutation | None |
| Assignment mutation | None |
| Browser effect | None |
| Verification | Reread current context/assignment; validate record identity/revision |
| Terminal evidence | Versioned result only; no operation ledger entry |
| Compensation | None |
| Lock release | Workspace-binding then window lock unwind |

### Create and bind phases

| Required phase | Exact behavior |
|---|---|
| Precondition reads | Current session/context/target window; `expectedUnboundWindow: true`; candidate workspace ID/revision/digest; workspace unassigned; scoped key absent; no client assignment identity |
| Lock acquisition | Scoped exclusive, target window, workspace binding, runtime-state for pending/root writes, workspace-state as required |
| Pending evidence | Write exact create intent to `constellationRuntimeWorkspaceOperationLedger:<workspaceId>` before business writes |
| Runtime-record mutation | Create `available` scoped record and verify |
| Assignment mutation | Create one exact assignment in session authority and verify |
| Browser effect | None; tab intake is a later named command |
| Verification | Reread record, current context, assignment, session ID, ID/epoch, and revisions |
| Terminal evidence | Record primary result, release all primary locks, then attempt the separate compatibility phase under `constellation-runtime-compatibility-projection-v0.1`; persist its verified/pending-repair result in `constellationRuntimeWorkspaceOperationLedger:<workspaceId>` |
| Compensation | If assignment is absent and operation alone created the record, delete and verify only that record; otherwise indeterminate |
| Lock release | Reverse acquisition order after terminal/compensation evidence |

### Resume and bind phases

| Required phase | Exact behavior |
|---|---|
| Precondition reads | Current session/context/target window; `expectedUnboundWindow: true`; exact durable workspace identity/revision/snapshot digest; assignment absence; scoped state; browser preflight; no client assignment identity |
| Lock acquisition | Scoped exclusive, target/source window locks, workspace binding, then lower domains according to lock plan |
| Pending evidence | Persist durable/scoped/browser/assignment intent in `constellationRuntimeWorkspaceOperationLedger:<workspaceId>` before browser creation |
| Runtime-record mutation | Establish candidate `available` record after browser result is known; verify before assignment write |
| Assignment mutation | Bind exact workspace to target and verify |
| Browser effect | Existing resume business order opens/stabilizes tabs/groups before final runtime replacement |
| Verification | Exact browser stabilization, record revision, current context, and assignment identity |
| Terminal evidence | Record primary result, release all primary locks, then attempt the separate compatibility phase under `constellation-runtime-compatibility-projection-v0.1`; persist its verified/pending-repair result in `constellationRuntimeWorkspaceOperationLedger:<workspaceId>` |
| Compensation | Before assignment commit, remove only created browser/scoped artifacts; after verified assignment, preserve business state and recover forward |
| Lock release | Reverse order only after evidence/compensation |

### Transfer phases

| Required phase | Exact behavior |
|---|---|
| Precondition reads | Full current session/context/window/workspace/revision/assignment ID/epoch evidence; target window/context; `expectedTargetUnbound: true`; browser plan |
| Lock acquisition | Scoped exclusive; source/destination windows sorted; workspace binding; runtime-state and projection domains as needed |
| Pending evidence | Persist exact source, target, projection baseline, and next assignment identity in `constellationRuntimeWorkspaceOperationLedger:<workspaceId>` before movement |
| Runtime-record mutation | After transfer, write only verified placement/content fields; ownership is not written into the record |
| Assignment mutation | Atomically release source assignment and create destination assignment |
| Browser effect | Recovery-oriented order may move/verify browser projection before assignment transfer, as current placement/promotion kernels do |
| Verification | Destination projection, source unbound, destination exact assignment, record revision |
| Terminal evidence | Persist final transfer evidence in `constellationRuntimeWorkspaceOperationLedger:<workspaceId>`; compatibility projection is unchanged |
| Compensation | Before browser mutation retry safely; after partial browser effect recover forward; never create a second destination |
| Lock release | Reverse acquisition order after terminal/indeterminate evidence |

### Release phases

| Required phase | Exact behavior |
|---|---|
| Precondition reads | Full current session/context/window/workspace/revision/assignment ID/epoch evidence and save/pause policy |
| Lock acquisition | Scoped exclusive when save is required, window, workspace binding, runtime-state/workspace-state |
| Pending evidence | Persist exact release and pause intent in `constellationRuntimeWorkspaceOperationLedger:<workspaceId>` |
| Runtime-record mutation | Mark exact record `paused` after assignment release |
| Assignment mutation | Release exact ID and epoch only |
| Browser effect | None unless a separately named close operation is invoked |
| Verification | Assignment absent and exact record paused |
| Terminal evidence | Persist release result in `constellationRuntimeWorkspaceOperationLedger:<workspaceId>`; compatibility projection unchanged |
| Compensation | Failed pause after verified release recovers forward; record is non-writable without assignment |
| Lock release | Reverse acquisition order |

### Archive and release phases

| Required phase | Exact behavior |
|---|---|
| Precondition reads | Full current session/context/window/workspace/revision/assignment ID/epoch evidence, durable archive identity/digest, verified browser close plan, and advisory compatibility peer presence/fingerprints |
| Lock acquisition | Scoped exclusive, owner window, workspace binding, runtime-state/workspace/projection domains |
| Pending evidence | Persist archive, release, scoped deletion, close-plan, and compatibility preflight evidence in `constellationRuntimeWorkspaceOperationLedger:<workspaceId>` before durable mutation |
| Runtime-record mutation | Delete exact scoped record after durable archive and assignment release verify |
| Assignment mutation | Release exact assignment after durable archive verification |
| Browser effect | Execute only the prevalidated close plan after scoped deletion verification |
| Verification | Durable archive, assignment absence, scoped-key absence, and exact browser close evidence |
| Terminal evidence | Persist primary archive result, release all primary locks, then attempt CAS clear under `constellation-runtime-compatibility-projection-v0.1`; record verified/pending-repair outcome in the surviving workspace ledger |
| Compensation | Before release, preserve assignment/record; after release recover forward through deletion/close retry; never restore authority implicitly |
| Lock release | Reverse acquisition order |

### Explicit replacement phases

| Required phase | Exact behavior |
|---|---|
| Precondition reads | Exact prior session/context/window/workspace/revision/assignment evidence; candidate workspace/revision/digest; target window; candidate active-elsewhere check; no client candidate assignment identity |
| Lock acquisition | Scoped exclusive; target window; prior/candidate binding locks in code-unit order; runtime-state; scoped records in code-unit order |
| Pending evidence | Persist exact prior and candidate identities plus next assignment identity in `constellationRuntimeWorkspaceOperationLedger:<candidateWorkspaceId>`; include the prior ID in `affectedWorkspaceIds` |
| Runtime-record mutation | Candidate becomes `available`; prior becomes `paused` after assignment replacement |
| Assignment mutation | One atomic root transition releases prior and binds candidate using a new internally generated assignment ID/epoch |
| Browser effect | None unless delegated to an already evidenced resume/placement subtransaction |
| Verification | Prior unassigned, candidate exact assignment, both lifecycle writes and revisions |
| Terminal evidence | Persist primary replacement result, release all primary locks, then attempt the separate compatibility phase under `constellation-runtime-compatibility-projection-v0.1`; record verified/pending-repair outcome in the candidate ledger |
| Compensation | Before assignment, remove operation-created candidate record; after assignment, recover lifecycle/projection forward |
| Lock release | Reverse acquisition order |

### Service-worker window-close phases

| Required phase | Exact behavior |
|---|---|
| Precondition reads | Trusted removed window ID, current session root, exact assignment if any, exact scoped record |
| Lock acquisition | Window lock, workspace binding when assigned, runtime-state, workspace-state |
| Pending evidence | When an assignment exists, persist internal close lifecycle intent in `constellationRuntimeWorkspaceOperationLedger:<workspaceId>` before assignment release; an unassigned close creates no ledger entry |
| Runtime-record mutation | Mark exact record `paused` after release verification |
| Assignment mutation | Release only assignment owned by removed window; remove only that window's contexts |
| Browser effect | Already occurred externally; coordinator performs no browser mutation or transfer |
| Verification | Window has no context/assignment; other assignments byte-equivalent; exact record paused |
| Terminal evidence | Persist the internal result in `constellationRuntimeWorkspaceOperationLedger:<workspaceId>`, then schedule scoped reconciliation evidence |
| Compensation | Failed pause recovers forward; failed/uncertain assignment write is resolved by reread before retry |
| Lock release | Reverse acquisition order |

## Lock acquisition order and current-source trace

### Target Layer 2.3D lock domains

- `constellation-runtime-exclusive-operation:<workspaceId>`: scoped admission for recovery-heavy cross-domain work. The existing global `LOCK_NAMES.exclusiveOperation` remains protected for old paths but is not the Layer 2.3D ordinary-content lock.
- `constellation-runtime-window:<windowId>`: current context and window occupancy; multiple windows use ascending numeric order.
- `constellation-runtime-workspace-binding:<workspaceId>`: assignment stability for one workspace; multiple workspaces use code-unit order.
- existing `LOCK_NAMES.runtimeState`: single session-root and shared-ledger writes only.
- `constellation-runtime-workspace:<workspaceId>`: one scoped runtime-content record.
- `constellation-runtime-projection:<workspaceId>`: one workspace's browser projection mutation.
- `constellation-runtime-compatibility-projection-v0.1`: the sole advisory compatibility peer write/clear/repair lock. It grants no assignment, workspace, durable, or browser authority.

Nested acquisition order is scoped exclusive → window locks → workspace-binding locks → existing runtime-state when a root/ledger write is required → workspace-state locks → projection locks. Release is reverse order. A function may instead acquire lower domains sequentially while retaining only the scoped exclusive admission lock; it must never acquire an earlier domain while holding a later one.

The compatibility-projection lock is not part of that nested order. Primary business releases every window, binding, runtime-state, workspace-content, and browser-projection lock before the separate advisory projection phase acquires it. While holding it, code acquires no other lock. Ordinary workspace-content mutation never takes it, so it cannot invert or globally serialize Alpha/Beta primary work.

Ordinary Alpha content mutation takes Alpha's window, binding, and workspace locks but not the global runtime-state lock. Relevant context/assignment mutations must take the same window/binding locks, so the assignment remains stable while the command validates and commits. Alpha and Beta ordinary mutations therefore interleave independently.

### Concrete current-source trace

| Current source | Observed order | Layer 2.3D conclusion |
|---|---|---|
| `runtime-contract/constants.js` | `LOCK_ORDER` is global exclusive then global runtime-state | Insufficient for window/binding/workspace/projection domains; preserve existing constants and add scoped helpers/order tests |
| `runtime-workspace-activation/chrome-adapter.js` | Outer exclusive; ledger, compatible workspace, and authority writes each separately acquire global runtime-state | Correct recovery admission, but global workspace write must migrate to scoped record and scoped locks |
| `runtime-workspace-activation/coordinator.js` | Read workspace/authority/browser; pending for replacement; write workspace; mutate assignment; final verify; terminal ledger | Business order is explicit and may be adapted; it is not the lock order |
| `runtime-session-authority/coordinator.js` | Context/release/window close use runtime-state; assignment create/transfer use global exclusive then runtime-state | Session root remains sole binding authority; add window/binding locks and trusted close envelope |
| `workspace-creation-assignment-transaction/coordinator.js` | Outer exclusive; create/verify workspace first; then write/verify assignment; final verify | Preserve scoped-record-first compensation semantics under new domains |
| `workspace-resume-transaction-engine.js` | Distinct `chrome-flow-workspace-resume-transaction` lock; browser restore/stabilize before runtime replacement | Existing lock does not exclude runtime locks; resume must enter the Layer 2.3D scoped lock plan while preserving browser-first recovery evidence |
| `workspace-manual-placement-transaction/coordinator.js` | Pending; browser move; record move evidence; assignment transfer; placement write; verify/terminalize | Preserve business order and forward recovery; migrate lower-domain locks and scoped placement writer |
| `workspace-automatic-promotion-transaction/coordinator.js` | Pending; browser move; assignment transfer; placement write; final verify | Same migration as manual placement; no second destination on replay |
| `workspace-archive-close-ownership-controller.js` | Panel-local in-progress flag; durable/archive writes; optional replacement; browser close | Panel-local flag is not cross-context authority; replace with a versioned service-worker transaction and scoped locks |
| `service-worker.js` plus session coordinator | Window event directly releases session assignment, then schedules global reconciliation | Extend to trusted versioned close lifecycle with scoped pause and per-workspace reconciliation |

The current implementation does conflict with the target lock coverage; this is a documented implementation obligation, not an unresolved architecture choice. Production work must not start until the scoped lock helpers and deterministic pure order tests exist.

## Compatibility transition policy

The pair remains protected compatibility evidence and never satisfies assignment validation.

| Transition | Preconditions | Exact outcome |
|---|---|---|
| Verified same-session Layer 2.3C continuation | Current context verified; current-session assignment already exists for exact workspace; scoped record absent; compatibility candidate valid | Seed exact scoped content, verify it, retain existing assignment; compatibility did not create authority |
| Fresh-session Operator recovery | Current context verified; target window unbound; explicit Operator create/resume/recover action; exact candidate selected | Candidate is input only; transaction creates/verifies scoped record and new assignment under the versioned command |
| Old-only | Legacy peer present, canonical absent | If valid, eligible for either transition above; if malformed, return `blocked_malformed_compatibility`; do not silently create canonical during read/seed |
| Canonical-only | Canonical present, legacy absent | If valid, eligible for either transition above; if malformed, return `blocked_malformed_compatibility`; do not silently create legacy during read/seed |
| Dual-equivalent | Both peers valid and byte-semantically equivalent | Eligible for either transition above |
| Dual-conflicting candidate input | Both present and either peer is malformed or they are not byte-semantically equivalent | Block only compatibility seed/recovery selection with `blocked_compatibility_conflict`; zero seed transaction mutation |
| Independently authorized core operation | Explicit create, durable resume, transfer, release, archive, or replacement has valid non-compatibility authority | Compatibility ambiguity cannot veto the business transaction; capture peer evidence for optional CAS projection and continue |

If a scoped record already exists, compatibility input cannot overwrite it. In a new session, compatibility content remains non-writable until an explicit Operator command establishes current-session assignment authority.

Compatibility projection writes are non-authoritative, compare-and-set protected, and non-blocking after independent business authorization:

- Every write, clear, or repair runs only under `constellation-runtime-compatibility-projection-v0.1` as a separate post-primary-business phase. The lock grants no authority and is never held with any primary lock.
- Preflight records each peer's presence and canonical fingerprint. Under the lock, immediately reread both peers and compare expected presence and fingerprints. Write, clear, or repair both peers only after an exact match; then reread and verify both peers equal the intended projection or are both absent, as applicable, before releasing the lock.
- Verified create, resume, restore, fresh-session recovery, and explicit replacement attempt one atomic two-peer write of the exact newly verified scoped workspace after the preflight match, then reread and require both present, equivalent, and equal to the intended projection.
- Verified same-session continuation seeds the absent scoped record but does not rewrite either compatibility peer; the original peer state remains evidence until a named projection-writing operation succeeds.
- Transfer, release, window close, journal, timeline, metadata, membership, and reconciliation do not write the pair.
- Archive attempts an atomic two-peer clear only when preflight and immediate reread are unchanged, both peers are valid dual-equivalent, and both exactly represent the archived workspace; it requires a post-clear reread proving both absent before lock release. A conflicting, malformed, drifted, absent, or unrelated pair remains untouched and cannot block durable archive, assignment release, scoped deletion, or browser-close effects.
- Drift, conflict, malformed state, write failure, or verification failure produces a committed core result with `primaryBusinessCommitted: true`, a specific warning, and `compatibilityProjection.status: "pending_repair"` recorded in the workspace ledger. Where no write occurred the pair is unchanged; after an uncertain write, no blind rollback is attempted. Replay retries only CAS preflight/projection repair and never repeats business effects.
- Compatibility failure never grants authority, revokes verified core authority, rolls back any primary scoped, durable, assignment, or browser effect, rolls back another Stella, or changes an unrelated peer. Destructive compatibility-conflict resolution is outside Layer 2.3D and requires explicit Operator authorization.

All confirmed production readers/writers whose inventory disposition requires migration must move to exact verified assigned scoped state before implementation readiness. A runtime workspace reader that cannot prove current assignment must be gated from reading while unbound. Validation-only purpose may remain, but it never changes production reachability for a declared root. No production-loaded global workspace reader or writer may be classified historical.

### Production-root reader/writer closure

- Inventory v0.4 accounts for all 45 direct side-panel module roots and uses exact `HEAD` line metadata. Each root record covers its direct and transitive imports, module startup, active-workspace key and compatibility API access, workspace-store and workspace-runtime-store access, storage listeners, runtime messages, browser/durable/diagnostic mutation, and migration disposition.
- `layer2-persistence-validation.js` is production-loaded at `sidepanel.html` line 170. Its module-startup chain is `installLayer2PersistenceValidation()` at line 32 → `refreshLayer2ValidationSummary()` at line 37 → `getWorkspace()` at line 147. `workspace-store.js` `getWorkspace()` lines 10-15 reads compatible state and calls `saveWorkspace()`; lines 38-42 write through both protected peers. Its validation purpose does not make this historical or read-only behavior.
- `workspace-runtime-store.js` active APIs at lines 40-56 and runtime summary at lines 88-115 delegate to `workspace-store.js`. Inventory v0.4 represents every static consumer and distinguishes active reader/writer migration from diagnostic-only non-authoritative use.
- The directly loaded lifecycle, memory, post-resume, production-save, resume-transaction, completion, readiness, projection preview/confirmation, and projection-resume modules retain their validation or advisory purpose while remaining production roots. Readers migrate to verified assigned scoped state or are gated while unbound.

### Protected identities preserved

Layer 2.3D does not rename, delete, consolidate, retire, or rewrite:

- physical IndexedDB name `chrome-flow-session-db`;
- logical identity `constellation-session-db`;
- stores `workspaces`, `workspaceTabs`, `sessions`, `projections`, `workspaceLinks`, `constellations`, `journalEntries`, `timelineEvents`, `summaryCards`, and `settings`;
- setting keys `activeWorkspaceId` and `dedicatedWindowThreshold`;
- `constellationActiveWorkspace` and `chromeFlowWorkspace`;
- `constellationDiagnostics`, `chromeFlowDiagnostics`, and their event-shard prefixes;
- `constellationWorkspaceArchive` and `chromeFlowWorkspaceArchive`;
- `constellationWorkspaceLibrarySaveCoordinator` and `chromeFlowWorkspaceLibrarySaveCoordinator`;
- `constellationRuntimeSessionAuthority` and its published schema;
- canonical and legacy event identities;
- canonical and legacy packet envelopes;
- any published versioned schema, migration marker, import/export format, recovery evidence, rollback evidence, or historical validation artifact.

The new scoped key and schema are additive. Existing schema identifiers are not edited in place.

## Restart semantics

Within one Chrome extension session, assignments survive service-worker restart in `chrome.storage.session` and scoped records/ledgers survive in `chrome.storage.local`. Read-only discovery validates every unresolved intent, finds relevance through primary and affected workspaces, then permits at most one non-overlapping operation to enter its versioned recovery coordinator. Fresh present-state verification decides which recorded phases remain complete; replay never repeats them.

Across a new extension session, prior assignments disappear. Surviving scoped records contain no binding and are non-writable because no current assignment exists, while local ledgers remain discoverable for released, archived, paused, unbound, prior, and candidate workspaces. Recorded old session/assignment evidence is historical recovery input only. Rebinding or recovery mutation requires fresh present-state verification and the verified Operator transition; compatibility, projection resemblance, or stale intent is insufficient.

## Failure-mode matrix

| Failure | Required result | Allowed mutation |
|---|---|---|
| Unbound window bootstrap | `unbound` | none |
| Compatibility peers conflict during seed | `blocked_compatibility_conflict` | none |
| Scoped record malformed | `malformed_runtime_record` | none |
| Context or window stale | `stale_context` | none |
| Assignment ID or epoch stale | `stale_assignment` | none |
| Workspace revision stale | `workspace_revision_conflict` | none |
| Workspace active elsewhere | `active_elsewhere` with owner-window evidence | none |
| Target window occupied | `target_window_occupied` | none |
| Duplicate operation, same fingerprint | verified replay/recovery | no duplicate business effect |
| Duplicate operation, different fingerprint | `operation_id_conflict` | none |
| Malformed ledger key, record, entry, or immutable intent | `malformed_recovery_evidence` with exact report | none |
| Multiple unresolved operations overlap one affected workspace | `recovery_operation_conflict` | none; enter no recovery coordinator |
| Old-session intent lacks fresh current verification | `stale_recovery_authority` | none |
| Scoped write fails before assignment | retryable failure | no assignment |
| Assignment fails after operation-created scoped write | scoped rollback or indeterminate evidence | only operation-created record may be removed |
| Browser effect partial | `indeterminate` with pending evidence | no widening to other workspaces |
| Verification read fails after a write | `indeterminate` unless exact reread later proves convergence | no blind retry effect |
| Window close | exact trusted release/pause | only closing window's workspace |
| Archive | exact durable archive/release/scoped deletion | only named workspace |
| Compatibility ambiguity during independently authorized operation | committed core result, `primaryBusinessCommitted: true`, warning/pending repair | no compatibility mutation unless CAS preflight matches |
| Compatibility projection write/verify failure after business commit | committed core result, `primaryBusinessCommitted: true`, `compatibilityProjection.status: "pending_repair"` | projection repair only; no core rollback |
| Compatibility projection lock unavailable | committed core result, `primaryBusinessCommitted: true`, `compatibilityProjection.status: "pending_repair"` | no peer mutation and no primary rollback |

## Rollback and downgrade gates

### Pre-live uncommitted source rollback

Before any corrected build is loaded into Chrome or any scoped record is written, Operator-authorized source rollback may remove the uncommitted Layer 2.3D diff. No runtime migration or data conversion is needed. Protected identities and durable Session DB state remain unchanged.

### Post-live downgrade state-preservation gate

After any scoped-only mutation occurs, source reversion alone is unsafe. Downgrade requires a separately approved gate that:

1. inventories every `constellationRuntimeWorkspace:*` record and current session assignment;
2. performs read-only ledger discovery, blocks overlapping/new affected-workspace mutation, and resolves pending/indeterminate operations only through versioned recovery coordinators;
3. exports or durably saves every scoped workspace revision;
4. selects the one compatibility projection older code can safely expose, with explicit Operator confirmation;
5. verifies canonical/legacy equivalence and durable recovery for all other workspaces;
6. releases or pauses current assignments without losing scoped content;
7. records downgrade evidence and a restoration plan; and
8. only then authorizes loading pre-Layer-2.3D code.

Operation-local compensation remains scoped to artifacts recorded as created by that operation. It never deletes durable workspace memory and never scans or rewrites unrelated records.

## Forward compatibility with Constellation composition

Runtime assignment remains keyed only by stable `workspaceId`. Future Constellation relationship records may refer to several workspace IDs, but they do not become window assignments and cannot grant writable authority. Resuming a future Constellation set must be a separately approved coordinator that binds each constituent workspace independently.

## Prohibited shortcuts

- No global mutable registry of all active workspace values.
- No focus-derived ownership.
- No compatibility value, durable record, or browser projection authorizing mutation without assignment verification.
- No last-writer-wins whole-object mutation.
- No service-worker process-local authority.
- No sleep-based coordination.
- No silent replacement.
- No broad workspace-to-Stella rename.
- No compatibility, schema, database, store, event, migration, recovery, or rollback retirement.
- No new dependency, network surface, permission, telemetry, content script, or live migration.

## Known limitations

- Pure adapters cannot prove Chrome service-worker suspension, real panel lifecycle timing, or browser identifier reuse.
- The compatibility projection represents at most one last explicitly activated workspace and is intentionally not current writable authority.
- Cross-domain browser transactions cannot be atomic with Chrome storage; persisted pending evidence and scoped compensation are required.
- Current direct legacy readers and writers remain an implementation migration obligation until the inventory dispositions are completed.

## Required live validation

Live validation is Operator-controlled and is not authorized in this implementation phase. A later procedure must validate: Alpha creation in Window A; Alpha promotion to B; A becoming unbound; Beta creation in A; independent Alpha/Beta mutation; Gamma resume in C; duplicate Alpha conflict from D; scoped close and archive; same-session service-worker restart; and new-session stale-binding rejection.
