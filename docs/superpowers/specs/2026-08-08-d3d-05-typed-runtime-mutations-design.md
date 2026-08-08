# D3D-05 Typed Ordinary Runtime Mutations — Design

## Status

Approved design specification for Layer 2.3D slice D3D-05.

This document refines the already accepted Layer 2.3D architecture and implementation map into an implementation-ready design for ordinary runtime content mutation. It does not reopen the architecture and does not authorize live Chrome operation, merge, release, or compatibility-surface retirement.

## Objective

Move ordinary active-Stella reads and writes away from the global `activeWorkspace` compatibility model and onto the exact scoped runtime record owned by the current verified window assignment.

D3D-05 covers ordinary runtime content mutation only: workspace metadata, journal, timeline, and direct side-panel content mutations already mapped to this slice. Membership/projection, create/resume/bind, transfer, release, archive/replacement, compatibility projection, recovery closure, and production-root closure remain in their later accepted slices.

## Non-negotiable invariants

1. One ordinary mutation targets exactly one assigned workspace/Stella.
2. Mutation authority comes only from the current Layer 2.3D session/context/window/workspace assignment evidence established by D3D-04.
3. No Layer 2.3D ordinary mutation may derive authority from `chromeFlowWorkspace`, `constellationActiveWorkspace`, `activeWorkspaceId`, UI state, focus, or a compatibility read.
4. The command must carry the complete current assignment tuple: runtime session, source context, source window, workspace ID, expected workspace revision, runtime assignment ID, and positive assignment epoch.
5. The service worker must freshly revalidate authority before mutation.
6. Ordinary content mutation must use the workspace-content lock for the exact workspace and must not require the global runtime-state lock.
7. Different workspaces must be able to make ordinary progress concurrently.
8. Same-workspace mutations must serialize.
9. Mutation is semantic and typed. There is no generic whole-workspace replacement operation in the new route.
10. Revision conflicts fail closed.
11. Replay/conflict evidence is workspace-local and uses the Layer 2.3D workspace operation ledger.
12. The new route performs no compatibility projection write. Compatibility projection remains a later, separate post-primary concern.
13. Existing published Layer 2.3C routes, schemas, compatibility APIs, and old global ledger behavior remain available and unchanged for old callers.
14. D3D-05 must not silently become a legacy migration engine.

## Chosen architecture

### One versioned mutation family

Create one additive Layer 2.3D mutation family:

- `src/core/runtime-workspace-mutation/contract.js`
- `src/core/runtime-workspace-mutation/coordinator.js`
- `src/core/runtime-workspace-mutation/chrome-adapter.js`
- `src/core/runtime-workspace-mutation/client.js`
- `src/core/runtime-workspace-mutation/service-worker-handler.js`
- `tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js`

The family exposes one versioned command/result contract with a closed registry of accepted semantic mutation kinds. It reuses existing pure runtime mutation/revision helpers where their semantics already match the accepted architecture.

The design deliberately rejects two alternatives:

- Editing the Layer 2.3C mutation/journal contract in place, because its authority and global-storage assumptions are protected compatibility behavior.
- Creating one service-worker transaction family per ordinary mutation kind, because those operations share the same authority, lock, record, revision, verification, and replay boundaries and would duplicate critical infrastructure.

## Command authority envelope

Every new ordinary mutation command must include, at minimum:

- operation ID
- runtime session ID
- source context ID
- source window ID
- workspace ID
- expected workspace revision
- runtime assignment ID
- assignment epoch
- semantic mutation kind
- kind-specific payload
- requested-at timestamp

The client may generate an operation ID and request timestamp. It must not generate, infer, repair, or substitute assignment identity. Assignment evidence must come from the verified D3D-04 panel authority object.

Unknown fields and unknown mutation kinds fail closed.

## Mutation-kind policy

The command uses explicit semantic kinds rather than generic object patches. The exact initial registry must be source-grounded during implementation and limited to ordinary D3D-05 behavior already present in the mapped writers.

Expected classes include:

- journal append
- timeline append
- metadata update
- direct ordinary workspace content updates already owned by D3D-05

The implementation must reuse existing typed runtime mutation kinds where they are already semantically exact. New kinds may be added only when the existing engine cannot represent an already-authorized D3D-05 operation without weakening invariants.

Membership, projection reconciliation, create/resume/bind, transfer, release, archive/replacement, compatibility projection, and recovery are explicitly excluded even if they also mutate workspace-adjacent state.

## Metadata semantics

Metadata mutation must preserve the current metadata barrier's latest-write behavior without returning to the global compatibility workspace.

The new flow must:

1. capture the latest pending metadata snapshot through the existing barrier semantics;
2. obtain current assigned D3D-04 authority;
3. submit one typed metadata mutation using the exact expected scoped revision;
4. let the service-worker coordinator perform the authoritative read/evaluate/write/verify cycle;
5. refresh panel authority/state only from the verified result or a fresh binding resolve.

A metadata write must be atomic at the semantic mutation boundary. The design must not decompose one logical save into loosely ordered global-style whole-object writes that can interleave with another mutation.

Diagnostics remain non-authoritative and must not be promoted into workspace authority.

## Journal and timeline semantics

Existing journal/timeline entry identity and append semantics are preserved.

The old Layer 2.3C journal route remains published and terminally available for old callers. D3D-05 adds a separate versioned full-assignment path. The new path must use:

- exact assigned scoped record;
- workspace-local revision;
- workspace-local operation ledger;
- workspace-content locking;
- fresh assignment verification.

Journal/timeline duplicate replay must be deterministic and must not append a second logical entry.

## Legacy workspace-store boundary

`src/core/workspace-store.js` remains an old-route compatibility module.

New Layer 2.3D mutation code must not import it. New service-worker routes must not import raw compatibility writers.

`src/core/workspace-runtime-store.js` gains assigned/scoped variants for D3D-05 consumers while its explicitly legacy/archive/diagnostic APIs remain separately classified for their later slices.

This slice does not delete old APIs merely because new scoped APIs exist.

## Legacy identity migration boundary

Current side-panel startup contains a legacy `workspaceTabId` repair path that reads and writes through the global workspace store.

D3D-05 must not teach the new scoped mutation route to perform silent whole-object identity repair. For the new assigned/scoped path, malformed or missing immutable tab identity must fail closed as migration-required evidence unless the accepted source contract already defines a typed, identity-safe operation.

Old migration/compatibility behavior may remain available only through explicitly old routes until its mapped retirement/closure slice.

## Coordinator data flow

For an ordinary mutation against workspace Alpha:

1. Validate the complete command envelope and semantic payload.
2. Acquire the required scoped locks in accepted deterministic order. Ordinary content mutation must not take the global runtime-state lock or compatibility-projection lock.
3. Re-read current session authority and verify exact runtime session, source context, source window, workspace assignment ID, assignment epoch, and workspace identity.
4. Read the exact scoped runtime record key for Alpha.
5. Validate record schema, key/workspace agreement, lifecycle, workspace revision, and expected revision.
6. Read/inspect Alpha's workspace operation ledger for replay/conflict evidence.
7. Evaluate the typed semantic mutation using existing pure runtime mutation logic where semantically exact.
8. If the result is a true commit, write only Alpha's scoped runtime record.
9. Re-read and verify the committed scoped record/fingerprint/revision.
10. Record terminal operation evidence in Alpha's workspace-local ledger according to the accepted ledger contract.
11. Return a total versioned result containing authoritative status, previous/committed revision, verification state, and replay/conflict evidence as appropriate.
12. Release locks.

If any step establishes stale or conflicting authority, the mutation fails closed and does not fall back to compatibility state.

## Locking and concurrency

The ordinary mutation lock plan is workspace-scoped.

A normal mutation uses only the lock domains required to prove and serialize that exact assignment/content operation. It must not include a global runtime-state lock merely because older code did so.

The critical concurrency property is:

- Alpha mutation and Beta mutation may overlap.
- Two Alpha mutations serialize.
- Alpha mutation cannot mutate Beta's scoped key or ledger.
- Compatibility projection is never nested inside the primary mutation locks.

Tests must record fake lock acquisition/release order and prove that callbacks for two different workspaces can overlap.

## Replay, failure, and recovery behavior

The coordinator must return total deterministic results for:

- invalid command
- stale session/context/window
- stale assignment ID/epoch
- workspace/key mismatch
- malformed scoped record
- revision conflict
- unknown semantic kind or field
- exact replay
- same operation ID with conflicting fingerprint
- scoped record read failure
- scoped record write failure
- post-write verification failure
- operation-ledger read/write/verification failure
- internal coordination failure

No failure may authorize a compatibility fallback.

A post-write verification or ledger failure must preserve enough workspace-local evidence for later accepted recovery semantics. D3D-05 must not invent a broad rollback that could overwrite a newer scoped mutation.

## Production attachment points

D3D-05 may modify only the mapped production surfaces unless source evidence forces a stop and Byte-Nolan review:

- `src/sidepanel/sidepanel.js`
- `src/sidepanel/search-workspace-intake.js`
- `src/sidepanel/workspace-metadata-autosave.js`
- `src/core/workspace-runtime-store.js`
- `src/core/journal-append-coordination/contract.js`
- `src/core/journal-append-coordination/coordinator.js`
- `src/core/journal-append-coordination/client.js`
- `src/core/journal-append-coordination/chrome-adapter.js`
- `src/core/journal-append-coordination/readonly-workspace.js`
- `src/background/service-worker.js`

`src/core/workspace-store.js` is protected as old-route compatibility code for this slice.

The three frozen Layer 2.3D authority artifacts, `manifest.json`, `src/sidepanel/sidepanel.html`, dependencies, IndexedDB identities, and published old schemas are not modified.

## Side-panel behavior

The panel must mutate only while it has verified assigned authority from D3D-04.

A mutation-sensitive action must:

- obtain current assigned authority;
- build a full-assignment command from that authority;
- submit the typed mutation;
- treat stale/unbound/read-only/blocked outcomes as non-mutating;
- refresh displayed workspace state only from a verified scoped result or a fresh binding resolve.

UI focus and rendered values never grant authority.

The existing product behavior for read-only/unbound states remains intact.

## Testing strategy

### Focused unit coverage

The new `runtime-workspace-mutation` suite must cover at least:

- valid exact-assignment commit
- malformed/unknown fields
- missing authority identity
- stale runtime session
- stale source context/window
- stale assignment ID
- stale assignment epoch
- scoped key/workspace mismatch
- malformed scoped record
- lifecycle denial where applicable
- revision conflict
- journal duplicate replay
- timeline duplicate replay
- metadata latest-write conflict behavior
- unknown mutation kind
- invalid mutation field/payload
- exact replay
- operation fingerprint conflict
- scoped write failure
- post-write verification failure
- ledger failure after verified state
- Alpha/Beta disjoint concurrent progress
- same-workspace serialization
- no global runtime-state lock
- no compatibility write

### Existing regression coverage

The following established suites remain passing in meaning:

- runtime contract
- journal append coordination
- runtime workspace activation
- runtime session authority where touched indirectly
- current concurrency characterization
- D3D-01 scoped record
- D3D-02 workspace operation ledger
- D3D-03 scoped locks
- D3D-04 window binding
- full authorized `npm run check`

Characterization tests that intentionally document unsafe legacy behavior remain source-faithful; D3D-05 does not rewrite their historical expectation simply to make them appear green.

### Static checks

Static validation must prove:

- new D3D-05 routes do not import `workspace-store.js`;
- new D3D-05 routes do not import raw compatibility writers;
- pure contract/coordinator boundaries remain within the repository's accepted import conventions;
- ordinary mutation lock plans omit the global runtime-state and compatibility locks;
- old route classifiers remain terminally available and distinguishable from the new versioned route.

## Acceptance evidence

D3D-05 is accepted only with a reviewable evidence packet containing:

- exact repository/branch/HEAD gate;
- exact changed/new path list;
- reader/writer before/after trace for every named D3D-05 writer;
- mutation-kind registry table;
- authority-envelope validation matrix;
- revision/replay/failure matrix;
- fake lock trace showing Alpha/Beta independence;
- proof of no new global active-workspace write;
- proof old journal/compatibility route remains available;
- focused test output;
- D3D-01 through D3D-04 regression output;
- established affected-suite output;
- inventory and purity checks;
- full authorized regression output;
- `git diff --check`;
- final clean/dirty state report and explicit statement that live Chrome was not operated.

## Stop conditions

Stop D3D-05 and return to Byte-Nolan review if any of the following becomes necessary:

- a writer cannot receive complete current assignment evidence;
- an ordinary mutation requires the global runtime-state lock;
- the new route would need a compatibility read/write to authorize or complete primary business;
- implementation requires changing durable Session DB semantics;
- a protected Layer 2.3C schema must be edited in place;
- a generic whole-workspace replacement is required;
- partial migration would leave an enabled global writer for the same D3D-05 product action;
- a missing immutable identity can only be repaired by silently rewriting the whole scoped workspace;
- browser/live Chrome state is required to prove unit correctness;
- an unexpected production writer falls inside D3D-05 but is not classified by the accepted map;
- source evidence contradicts the accepted architecture.

## Rollback and live-load boundary

Before any live Chrome use, D3D-05 remains source-rollback safe as a complete slice.

Once any scoped-only mutation has been exercised against real extension storage, architecture downgrade rules apply: do not partially revert scoped writers back to global authority without a recovery review.

Even after automated acceptance, D3D-05 is review-branch only. It is not safe to live-load, merge, or release until later integration/reader-closure slices satisfy their accepted gates.

## Completion definition

D3D-05 is complete when every mapped ordinary mutation path either:

- uses exact assigned scoped authority and the new typed mutation family; or
- is explicitly preserved as old-route-only compatibility behavior;

and there is no new global active-workspace write introduced by Layer 2.3D.

The result must demonstrate that two different assigned Stellas can perform ordinary runtime content mutations independently without sharing global mutation authority, while same-Stella mutations remain serialized and revision-safe.
