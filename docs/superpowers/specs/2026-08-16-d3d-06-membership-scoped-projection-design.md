# D3D-06 Membership and Scoped Projection Reconciliation Design

**Status:** Approved for Byte_Coding design freeze; implementation not yet started
**Date:** 2026-08-16
**Repository:** `m-indsRefuge/constellation`
**Branch:** `layer2-3d-concurrent-multi-stella-window-binding`
**Design baseline:** `ff550e5a3b5bcbbe195ebe4922e9fc6d623c3594`

## 1. Purpose

D3D-06 migrates workspace membership mutation and automatic browser-projection reconciliation from the Layer 2.3C global active-workspace authority model to the accepted Layer 2.3D per-window/per-Stella authority model.

The slice must preserve existing published Layer 2.3C routes while adding versioned Layer 2.3D routes that prove an exact current assignment, operate on one scoped runtime workspace record, use the workspace-local operation ledger, and acquire only the locks needed for the affected Stella.

This design also closes the production `Remove from Workspace` path, which currently mutates the global workspace object directly.

## 2. Accepted architectural constraints

D3D-06 is constrained by the already accepted D3D-01 through D3D-05 foundations:

- one Chrome window owns zero or one active Stella;
- one Stella has zero or one writable owner window;
- the runtime-session authority is the sole window-binding authority;
- scoped runtime state lives at `constellationRuntimeWorkspace:<workspaceId>`;
- operation recovery evidence lives in the workspace-local ledger;
- operation intent is immutable and written before business mutation;
- exact retries replay or resume; changed fingerprints conflict;
- ordinary per-Stella work must not require `constellation-runtime-state-v0.1`;
- compatibility storage cannot authorize new D3D-06 primary business;
- different Stellas must be able to progress concurrently;
- same-Stella mutations must serialize;
- browser IDs are evidence and must be freshly revalidated where correctness depends on them;
- published v0.1 membership and reconciliation routes remain available unchanged in meaning.

## 3. Source-grounded current state

### 3.1 Membership

The current membership family is Layer 2.3C-shaped:

- `workspace-membership-mutation/coordinator.js` acquires `constellation-runtime-state-v0.1`;
- it reads and writes the compatible active workspace;
- it uses the shared session operation ledger;
- it validates only context/window/workspace identity, not the complete D3D-04 assignment tuple;
- `workspace-membership-mutation/client.js` cannot carry `runtimeSessionId`, `runtimeAssignmentId`, or `assignmentEpoch`;
- `workspace-membership-promotion-sequencer.js` still obtains authority through the old activation path before submitting membership;
- successful membership may then feed the existing automatic-promotion flow.

### 3.2 Remove-only control

`workspace-tab-remove-only-control.js` currently:

1. reads the global workspace through `workspace-store.js`;
2. removes a tab record from the in-memory whole object;
3. saves the whole workspace;
4. writes a separate timeline event;
5. deliberately keeps the live browser tab open.

The browser-tab-kept-open behavior is product semantics and must remain unchanged.

### 3.3 Projection reconciliation

The current reconciliation path also uses the global model:

- `workspace-projection-reconciliation/coordinator.js` acquires the global runtime-state lock;
- it reads/writes compatibility active-workspace peers;
- `automatic-workspace-projection-reconciler.js` begins from one global active workspace;
- the scheduler is process-global rather than keyed by workspace;
- reconciliation itself already uses the semantic `workspace.projection.reconcile` reducer and conservative browser matching.

### 3.4 Existing reusable Layer 2.3D foundations

The codebase already contains the pieces D3D-06 should reuse rather than duplicate:

- D3D-03 scoped lock domains: window, workspace binding, workspace content, browser projection;
- D3D-04 exact assigned authority including runtime session, context, window, workspace, assignment ID, assignment epoch, revision, and scoped workspace snapshot;
- D3D-05 scoped record access, fresh authority verification, immutable operation intent, workspace-local ledger use, replay/recovery, and scoped mutation sequencing;
- existing semantic reducers for `workspace.tab.add`, `workspace.tab.remove`, and `workspace.projection.reconcile`.

## 4. Chosen implementation approach

### 4.1 Decision

Use additive versioned v0.2 paths inside the existing membership and reconciliation families.

The old v0.1 paths remain intact and terminally routable. New v0.2 paths use Layer 2.3D authority and storage.

### 4.2 Rejected alternatives

#### Route all D3D-06 work through the D3D-05 ordinary mutation family

Rejected because D3D-05 intentionally has a closed six-kind registry. Reopening it would blur the accepted slice boundary and couple browser-evidence/projection semantics to a family that was deliberately scoped to ordinary content mutations.

#### Create entirely separate D3D-06 production families

Rejected because it adds unnecessary file and routing surface. The existing membership and reconciliation families are the correct semantic homes as long as new schemas and coordinator branches are additive.

## 5. Authorized source surface

The accepted implementation-map candidates remain authorized:

- `src/core/workspace-membership-mutation/contract.js`
- `src/core/workspace-membership-mutation/coordinator.js`
- `src/core/workspace-membership-mutation/chrome-adapter.js`
- `src/core/workspace-membership-mutation/service-worker-handler.js`
- `src/core/workspace-projection-reconciliation/contract.js`
- `src/core/workspace-projection-reconciliation/coordinator.js`
- `src/core/workspace-projection-reconciliation/chrome-adapter.js`
- `src/core/automatic-workspace-projection-reconciler.js`
- `src/sidepanel/workspace-tab-remove-only-control.js`
- `src/background/service-worker.js`
- new focused tests under `tests/runtime-workspace-membership/` and `tests/runtime-workspace-projection/`.

Byte-Nolan additionally authorize these source-proven attachment points:

- `src/core/runtime-workspace-operation-ledger/contract.js`
- `src/core/workspace-membership-mutation/client.js`
- `src/core/workspace-membership-mutation/fingerprint.js`
- `src/core/workspace-membership-mutation/promotion-trigger.js`
- `src/sidepanel/workspace-membership-promotion-sequencer.js`
- `src/sidepanel/sidepanel.js`

Any further production path required for coherence is a stop condition for Byte-Nolan review.

## 6. Membership v0.2 command design

The new membership command is additive and strict. It carries full assigned authority:

- `schema`
- `operationId`
- `runtimeSessionId`
- `sourceContextId`
- `sourceWindowId`
- `workspaceId`
- `expectedWorkspaceRevision`
- `runtimeAssignmentId`
- `assignmentEpoch`
- `mutationKind`
- `requestedAt`
- operation payload
- promotion continuation identities only where the current product sequence requires them.

The exact payload is typed rather than generic:

- add membership: one or more exact workspace-tab records;
- remove membership: one exact `workspaceTabId` plus non-authoritative user reason/evidence needed for the later timeline record.

The command does not contain a caller-authored replacement workspace.

## 7. Membership result design

The v0.2 result is total and assignment-bound. It includes:

- command identity and assignment identity;
- status and reason;
- revision before/after;
- whether scoped state was written and verified;
- whether local ledger intent/terminal evidence was recorded;
- replay/retry/indeterminate flags;
- membership receipt containing exact added or removed workspace-tab IDs and eligible browser-tab counts where relevant;
- warnings/errors.

Success statuses remain `committed`, `replayed`, and `no_change`. Conflicts, failures, and indeterminate outcomes remain explicit.

## 8. Membership fingerprint and ledger semantics

The fingerprint includes every business/authority field except retry-time-only evidence such as `requestedAt` where the established D3D-05 rule permits exclusion.

The workspace-local operation ledger receives additive command kinds for D3D-06 membership and projection reconciliation. These are not recorded as `ordinary_mutation`.

Before any scoped membership write:

1. the current assignment is freshly revalidated;
2. the current scoped record and local ledger are read;
3. operation ID/fingerprint state is classified;
4. immutable intent is recorded and verified;
5. browser evidence needed for the operation is freshly validated;
6. the semantic mutation is prepared;
7. the scoped record is written and reread verified;
8. terminal ledger evidence is written.

A verified business write followed by uncertain terminal evidence returns `indeterminate`; the business write is never rolled back merely to simplify ledger state.

## 9. Membership semantics

### 9.1 Add

Membership add uses the existing `workspace.tab.add` semantic reducer or an equivalent exact typed reduction. It rejects:

- stale assignment;
- stale revision;
- duplicate workspace-tab identity conflict;
- duplicate browser-tab identity conflict;
- requested browser tab that is no longer live;
- malformed scoped record or ledger.

Exact existing membership returns `no_change` without a revision increment.

### 9.2 Remove

Membership remove uses `workspace.tab.remove` against exactly one `workspaceTabId`.

Removal:

- never closes the browser tab;
- never changes browser placement;
- never infers removal from browser disappearance;
- returns `no_change` when the record is already absent;
- writes the user-facing removal timeline event only after verified membership success and a refreshed assigned snapshot/revision through the D3D-05 typed timeline route.

### 9.3 Revision behavior

Changed membership increments the scoped workspace revision exactly once. No-change preserves the revision.

## 10. Membership locking

The primary membership lock plan is:

1. source window lock;
2. workspace-binding lock;
3. workspace-content lock.

No ordinary membership operation takes the global runtime-state lock or compatibility projection lock.

Membership add performs browser liveness evidence reads through the adapter while the command is protected by the primary scoped lock plan and revalidates before the business write when needed to prevent stale browser evidence from authorizing membership.

Membership remove does not need a browser-projection lock because it intentionally leaves browser state unchanged.

Different workspaces use disjoint lock names and can overlap. Same-workspace membership serializes behind the workspace-content lock.

## 11. Membership and automatic-promotion boundary

D3D-06 does not implement D3D-10 transfer semantics.

The sequence remains:

1. resolve fresh D3D-04 assigned authority;
2. submit and verify D3D-06 membership;
3. perform any post-membership D3D-05 timeline write using refreshed assigned authority/revision;
4. evaluate the existing promotion threshold from the verified membership receipt;
5. release all D3D-06 primary locks before any existing promotion/placement transaction is submitted.

Membership never grants destination assignment authority and never creates a new destination window.

## 12. Side-panel membership producer migration

`workspace-membership-promotion-sequencer.js` no longer relies on `bootstrapExisting()` as the authority source for the new route. The producer receives or resolves fresh D3D-04 assigned authority and copies the complete tuple into the v0.2 membership command.

The old v0.1 client path remains available for old callers.

`sidepanel.js` wires the new assigned authority into selected-tab, active-tab, search-tab, and recovery re-add membership flows. Existing later-slice placement behavior remains untouched.

## 13. Reconciliation v0.2 command design

The additive reconciliation command carries:

- `schema`
- `operationId`
- `runtimeSessionId`
- `sourceContextId`
- `sourceWindowId`
- `workspaceId`
- `expectedWorkspaceRevision`
- `runtimeAssignmentId`
- `assignmentEpoch`
- `requestedAt`
- normalized trigger set
- captured projection baseline / plan evidence generated from the scoped assigned workspace and browser observation.

The service worker freshly verifies the assignment before using the command. The captured plan is evidence, not authority.

## 14. Reconciliation semantic engine

D3D-06 keeps the existing `workspace.projection.reconcile` semantic reducer rather than translating reconciliation into D3D-05 ordinary mutation kinds.

Reasons:

- the reducer already has the correct conservative projection semantics;
- it produces reconciliation-specific timeline transitions and summary evidence;
- reconciliation needs a browser-projection lock and browser-evidence revalidation that ordinary D3D-05 mutations do not require;
- keeping a reconciliation-specific coordinator makes recovery and concurrency evidence explicit.

## 15. Projection lock design

The reconciliation primary lock plan is:

1. source window lock;
2. workspace-binding lock;
3. workspace-content lock;
4. browser-projection lock.

This follows the accepted D3D-03 rank order. Reconciliation does not acquire the global runtime-state lock and never nests the compatibility-projection lock.

The content and projection locks are held together for the mutation-critical phase so that the projection baseline cannot be applied to a concurrently modified scoped workspace and same-Stella reconciliation cannot interleave.

Different Stellas have disjoint content and projection lock names and can reconcile concurrently.

## 16. Browser projection evidence model

The existing conservative matching algorithm is preserved:

1. exact live tab ID match first;
2. otherwise one unique URL fallback only when exactly one unresolved workspace record demands that URL and one unconsumed live tab matches;
3. multiple URL candidates remain ambiguous;
4. missing candidates remain `not_found`;
5. ambiguous or missing browser evidence never deletes durable membership.

Reconciliation may update projection fields such as live tab ID, window, group, index, URL/title projection, `isOpen`, and match status, but it does not add or remove workspace membership.

Browser observation is captured before mutation and revalidated at the protected service-worker boundary. Assignment or scoped revision drift causes conflict/retry, not guessed reconciliation.

## 17. Reconciliation replay and recovery

Reconciliation uses the workspace-local ledger with immutable intent before scoped mutation.

Exact retry:

- replays a terminal result; or
- resumes an unresolved operation only when current scoped state and recorded candidate evidence match the saved intent.

Changed operation fingerprint conflicts.

If the scoped record is verified committed but terminal ledger evidence fails, return `indeterminate` with committed-state evidence. Never rewrite or roll back the scoped record simply to reconstruct a clean terminal entry.

Process-local scheduler state is not recovery authority.

## 18. Automatic reconciler scheduling

The scheduler moves from one global active-workspace queue to workspace-keyed scheduling.

Each scheduled unit is identified by the target workspace plus current assignment evidence sufficient to request fresh verification at execution time.

Rules:

- triggers for different workspaces may debounce and execute independently;
- repeated triggers for the same workspace coalesce;
- a stale scheduled assignment is harmless because fresh D3D-04 authority is revalidated before mutation;
- worker restart may lose debounce state but not correctness, because scheduler memory is advisory only;
- startup/global browser events enumerate currently active assignments and schedule each affected workspace;
- window-specific events narrow scheduling when the owning assignment can be resolved safely;
- the scheduler never writes authority or runtime workspace state.

## 19. Service-worker routing

New classifiers are exact and terminal.

Routing preserves:

- membership v0.1;
- membership v0.2;
- reconciliation v0.1/canonical-legacy event trigger behavior;
- reconciliation v0.2;
- D3D-05 ordinary mutation;
- journal v0.1 and assigned v0.2.

A message declaring a new D3D-06 schema but failing validation is handled by the new route and cannot fall through to an old handler.

## 20. Compatibility exclusion

New D3D-06 primary business must not:

- read `constellationActiveWorkspace` or `chromeFlowWorkspace` for authority;
- write compatible active-workspace peers;
- use the shared Layer 2.3C session operation ledger;
- acquire `constellation-runtime-state-v0.1` for ordinary membership/reconciliation;
- acquire the compatibility projection lock inside the primary transaction.

Old routes may continue doing so until their mapped retirement slice.

## 21. Failure and indeterminate model

D3D-06 explicitly distinguishes:

- invalid command/sender;
- stale or missing assignment;
- stale workspace revision;
- operation ID fingerprint conflict;
- malformed scoped record;
- malformed local ledger;
- browser evidence unavailable;
- browser evidence changed before write;
- semantic conflict/rejection;
- scoped write failure with previous state verified;
- post-write verification mismatch;
- terminal ledger failure after verified business commit;
- recovery evidence mismatch.

Only cases proven safe to retry are marked retry-safe.

## 22. Testing strategy

Create focused suites:

- `tests/runtime-workspace-membership/runtime-workspace-membership.test.js`
- `tests/runtime-workspace-projection/runtime-workspace-projection.test.js`

Membership coverage must include:

- strict v0.2 schema and full authority tuple;
- v0.1 unchanged characterization;
- assigned authority mismatch cases;
- add/no-change/remove;
- remove keeps browser tab open;
- revision conflict;
- browser liveness prewrite drift;
- immutable intent before write;
- replay/fingerprint conflict;
- failed/indeterminate recovery;
- Alpha/Beta overlap;
- same-Stella serialization;
- promotion sequence occurs after membership locks release;
- migrated side-panel producer does not fall back to global workspace authority.

Projection coverage must include:

- strict v0.2 schema and old route preservation;
- exact/URL fallback/ambiguous/missing matching;
- same URL in different windows;
- assignment and revision drift;
- browser-projection lock ordering;
- no global runtime-state or compatibility write;
- no durable membership deletion from missing browser state;
- exact replay and unresolved recovery;
- Alpha/Beta concurrent reconciliation;
- same-Stella serialization;
- workspace-keyed scheduler coalescing and stale-schedule revalidation;
- service-worker old/new route separation.

Existing membership, reconciliation, activation, D3D-05 mutation, session-authority, scoped-lock, ledger, characterization, inventory, purity, and aggregate checks remain required regressions.

## 23. Static validation

D3D-06 closure must prove:

- new paths do not import compatibility active-workspace read/write helpers;
- new coordinators do not reference `constellation-runtime-state-v0.1`;
- new membership/reconciliation routes use workspace-local record and ledger keys;
- no new ordinary membership/reconciliation path imports the global shared operation ledger;
- service-worker classifiers preserve old/new separation;
- runtime inventory is updated only where source truth has actually migrated.

## 24. Explicit exclusions

D3D-06 does not implement:

- create-and-bind (D3D-08);
- resume-and-bind (D3D-09);
- transfer/manual placement/automatic-promotion transfer migration (D3D-10);
- trusted window-close release (D3D-11);
- archive/replacement (D3D-12);
- general compatibility projection migration (D3D-13);
- restart recovery dispatcher (D3D-14);
- final production-root/inventory/live closure (D3D-15).

No live Chrome operation is part of D3D-06 acceptance.

## 25. Stop conditions

Stop for Byte-Nolan review if implementation proves any of the following necessary:

1. compatibility active-workspace state must authorize new primary business;
2. ordinary membership or reconciliation requires the global runtime-state lock;
3. a required writer cannot receive the complete D3D-04 assignment tuple;
4. remove-only requires whole-workspace replacement;
5. browser ambiguity must be guessed;
6. an old published membership/reconciliation schema must change meaning;
7. canonical/legacy reconciliation event identity must be retired;
8. reconciliation cannot remain scoped to one workspace;
9. required lock acquisition violates D3D-03 order;
10. D3D-10 transfer semantics must be implemented early;
11. a production path outside the authorized surface must be modified;
12. recovery correctness depends on process-local scheduler state;
13. a correctness claim requires live Chrome;
14. a frozen Layer 2.3D architecture artifact must change;
15. an accepted D3D-01 through D3D-05 invariant proves invalid.

## 26. Completion boundary

D3D-06 is complete only when:

- both new assigned routes are fully scoped;
- old routes remain terminally available unchanged in meaning;
- remove-only no longer performs an enabled global workspace write on the assigned path;
- automatic reconciliation schedules and serializes per Stella;
- Alpha/Beta concurrency is proven;
- same-Stella serialization is proven;
- replay/recovery evidence is deterministic;
- focused and established regressions pass;
- static authority scans pass;
- Byte source review and Nolan-local validation pass;
- one reviewed D3D-06 slice commit is authorized.

Live Chrome remains deferred to the later operator-controlled Layer 2.3D gate.
