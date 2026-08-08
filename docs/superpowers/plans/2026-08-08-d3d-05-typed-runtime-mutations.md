# D3D-05 Typed Ordinary Runtime Mutations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Layer 2.3D ordinary active-Stella mutation authority with exact assigned scoped runtime records, workspace-local revision/ledger evidence, and workspace-scoped locks while preserving all published Layer 2.3C routes unchanged.

**Architecture:** Add one versioned `runtime-workspace-mutation` family. Every new mutation command carries the complete D3D-04 assignment tuple, is freshly revalidated in the service worker, acquires only the exact window/binding/content locks, reads and writes one `constellationRuntimeWorkspace:<workspaceId>` record, and records replay/recovery evidence in that workspace's local ledger. Existing compatibility/global routes remain available but cannot authorize the new path.

**Tech Stack:** Manifest V3 Chrome extension, ES modules, Node.js >=24, Node built-in test runner, `chrome.storage.local`, `chrome.storage.session`, Web Locks, existing deterministic runtime contract/reducer helpers.

## Global Constraints

- Repository: `C:\Users\nolan\AIProjects\constellation`.
- Branch: `layer2-3d-concurrent-multi-stella-window-binding`.
- Begin only when local `HEAD` equals `@{u}` and the working tree is clean.
- The branch must contain approved design `docs/superpowers/specs/2026-08-08-d3d-05-typed-runtime-mutations-design.md`.
- Do not modify the three frozen Layer 2.3D authority artifacts, `manifest.json`, `src/sidepanel/sidepanel.html`, dependencies, IndexedDB identities/stores, or protected compatibility identities.
- `src/core/workspace-store.js` remains an old-route compatibility module and is not modified.
- Published Layer 2.3C schemas remain byte-compatible; new behavior is additive/versioned.
- No new dependency.
- No live Chrome load/reload, no real extension-storage mutation, no merge, no release.
- No compatibility read/write may authorize or complete a D3D-05 primary mutation.
- Ordinary D3D-05 mutation must not acquire `constellation-runtime-state-v0.1` or the compatibility-projection lock.
- Different workspaces must be able to progress concurrently; same-workspace mutations serialize.
- Missing immutable `workspaceTabId` fails closed on the new path; D3D-05 does not silently repair whole workspace objects.
- `package.json` aggregate scripts remain unchanged in this slice; D3D-15 owns aggregate D3D closure.
- **Constellation workflow override:** implementation workers do not commit, push, open PRs, or merge during tasks below. Each task ends at a test/diff checkpoint. One slice commit is authorized only after Byte-Nolan source review and full validation.

## File Structure

### Create

- `src/core/runtime-workspace-mutation/contract.js` — exact command/result schemas, mutation-kind registry, payload validation, deterministic command fingerprint.
- `src/core/runtime-workspace-mutation/coordinator.js` — pure coordination, authority verification, semantic evaluation, revision/replay/recovery state machine.
- `src/core/runtime-workspace-mutation/chrome-adapter.js` — Web Locks plus direct session/local storage I/O for the scoped record and workspace ledger.
- `src/core/runtime-workspace-mutation/client.js` — build commands only from verified D3D-04 assigned authority.
- `src/core/runtime-workspace-mutation/service-worker-handler.js` — exact route classifier, sender validation, adapter creation, terminal coordination.
- `tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js` — complete focused D3D-05 contract/coordinator/adapter/client/route/concurrency coverage.
- `docs/validation/LAYER-2.3D-D3D-05-TYPED-RUNTIME-MUTATION-EVIDENCE.md` — final acceptance evidence after implementation validation.

### Modify

- `src/core/runtime-workspace-operation-ledger/contract.js` — additive `ordinary_mutation` command-schema registry entry only.
- `src/core/journal-append-coordination/contract.js` — preserve v0.1; add full-assignment v0.2 request/response validation.
- `src/core/journal-append-coordination/coordinator.js` — preserve v0.1 coordinator; add assigned journal adapter into the new mutation coordinator.
- `src/core/journal-append-coordination/client.js` — preserve legacy construction mode; use v0.2 when verified assigned authority is supplied.
- `src/core/journal-append-coordination/chrome-adapter.js` — preserve legacy adapter; expose the generic scoped mutation adapter for v0.2.
- `src/core/journal-append-coordination/readonly-workspace.js` — preserve compatibility read; add explicit verified-assigned read helper.
- `src/core/workspace-runtime-store.js` — preserve archive/diagnostic/legacy APIs; add explicitly assigned/scoped active-runtime helpers.
- `src/sidepanel/workspace-metadata-autosave.js` — retain barrier sequencing; replace compatibility/global persistence with assigned typed mutation.
- `src/sidepanel/search-workspace-intake.js` — replace direct global get/save/timeline writer with assigned scoped search-intake mutation.
- `src/sidepanel/sidepanel.js` — route D3D-05 metadata, timeline, alias/role and direct ordinary writes through assigned mutation authority; remove silent `workspaceTabId` repair from the new assigned path.
- `src/background/service-worker.js` — register the new mutation route and the assigned journal route without changing old classifiers.

---

### Task 1: Freeze the D3D-05 command/result contract and extend the workspace-ledger registry

**Files:**
- Create: `src/core/runtime-workspace-mutation/contract.js`
- Modify: `src/core/runtime-workspace-operation-ledger/contract.js`
- Test: `tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js`
- Test: `tests/runtime-workspace-operation-ledger/runtime-workspace-operation-ledger.test.js`

**Interfaces:**
- Produces:
  - `RUNTIME_WORKSPACE_MUTATION_TYPE = "constellation-runtime-workspace-mutation"`
  - `RUNTIME_WORKSPACE_MUTATION_COMMAND_SCHEMA = "constellation-runtime-workspace-mutation-command-v0.1"`
  - `RUNTIME_WORKSPACE_MUTATION_RESULT_SCHEMA = "constellation-runtime-workspace-mutation-result-v0.1"`
  - `RUNTIME_WORKSPACE_MUTATION_KINDS`
  - `snapshotAndValidateRuntimeWorkspaceMutationCommand(value)`
  - `createRuntimeWorkspaceMutationResult(command, fields)`
  - `validateRuntimeWorkspaceMutationResult(value, expected)`
  - `runtimeWorkspaceMutationFingerprint(command)`
  - `isRuntimeWorkspaceMutationMessage(message)`
- Ledger registry gains exactly:
  - `ordinary_mutation: "constellation-runtime-workspace-mutation-command-v0.1"`

The initial mutation-kind registry is closed and source-grounded:

```js
export const RUNTIME_WORKSPACE_MUTATION_KINDS = Object.freeze([
  "journal.append",
  "timeline.append",
  "workspace.metadata.autosave",
  "workspace.metadata.commit",
  "workspace.tab.metadata.commit",
  "search.intake.add"
]);
```

The exact command fields are:

```js
const COMMAND_FIELDS = Object.freeze([
  "type",
  "schema",
  "operationId",
  "runtimeSessionId",
  "sourceContextId",
  "sourceWindowId",
  "workspaceId",
  "expectedWorkspaceRevision",
  "runtimeAssignmentId",
  "assignmentEpoch",
  "mutationKind",
  "payload",
  "requestedAt"
]);
```

The exact result fields are:

```js
const RESULT_FIELDS = Object.freeze([
  "schema", "status", "reason", "operationId",
  "runtimeSessionId", "sourceContextId", "sourceWindowId",
  "workspaceId", "runtimeAssignmentId", "assignmentEpoch",
  "previousRevision", "committedRevision", "recordFingerprint",
  "phase", "mutationCommitted", "authorityVerified", "workspaceVerified",
  "ledgerRecorded", "retrySafe", "indeterminate", "warnings", "errors"
]);
```

- [ ] **Step 1: Write failing exact-contract tests**

Add tests that accept one complete command and reject every missing identity, zero/negative epoch, malformed timestamp, unknown top-level field, unknown mutation kind, cyclic payload, and kind-specific unknown field.

```js
test("D3D-05 command requires the complete assigned mutation tuple", () => {
  const command = mutationCommandFixture();
  assert.equal(snapshotAndValidateRuntimeWorkspaceMutationCommand(command).valid, true);
  for (const field of [
    "runtimeSessionId", "sourceContextId", "sourceWindowId", "workspaceId",
    "expectedWorkspaceRevision", "runtimeAssignmentId", "assignmentEpoch"
  ]) {
    const broken = structuredClone(command);
    delete broken[field];
    assert.equal(snapshotAndValidateRuntimeWorkspaceMutationCommand(broken).valid, false, field);
  }
});
```

Add a registry-preservation assertion:

```js
assert.deepEqual(WORKSPACE_OPERATION_COMMAND_SCHEMAS, {
  create_and_bind: "constellation-runtime-workspace-create-bind-command-v0.1",
  resume_and_bind: "constellation-runtime-workspace-resume-bind-command-v0.1",
  transfer: "constellation-runtime-workspace-transfer-command-v0.1",
  release: "constellation-runtime-workspace-release-command-v0.1",
  archive_and_release: "constellation-runtime-workspace-archive-release-command-v0.1",
  replacement: "constellation-runtime-workspace-replace-command-v0.1",
  trusted_window_close: "constellation-runtime-window-close-lifecycle-command-v0.1",
  ordinary_mutation: "constellation-runtime-workspace-mutation-command-v0.1"
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

```powershell
node --test --test-isolation=none tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js
node --test --test-isolation=none tests/runtime-workspace-operation-ledger/runtime-workspace-operation-ledger.test.js
```

Expected: the new suite fails because the contract module does not exist and/or the ledger registry lacks `ordinary_mutation`; existing ledger behavior must otherwise remain source-faithful.

- [ ] **Step 3: Implement the strict contract and additive ledger registry entry**

Use `isPlainObject`, `nonEmptyString`, `serializableErrors`, `stableStringify`, `validDateTime`, and `isValidRuntimeWorkspaceId`. Validate payloads by kind. `runtimeWorkspaceMutationFingerprint()` canonicalizes all semantic command fields except `requestedAt`, so an exact retry can reproduce the same fingerprint while a changed identity/kind/payload conflicts.

For ledger intent, D3D-05 will use:

```js
{
  operationKind: "ordinary_mutation",
  commandSchema: RUNTIME_WORKSPACE_MUTATION_COMMAND_SCHEMA,
  primaryWorkspaceId: command.workspaceId,
  affectedWorkspaceIds: [command.workspaceId],
  sourceWindowId: command.sourceWindowId,
  targetWindowId: null,
  expectedRuntimeSessionId: command.runtimeSessionId,
  expectedAssignmentId: command.runtimeAssignmentId,
  expectedAssignmentEpoch: command.assignmentEpoch,
  expectedWorkspaceRevisions: { [command.workspaceId]: command.expectedWorkspaceRevision },
  durableSourceIdentity: null,
  durableSnapshotDigest: null,
  browserPlanDigest: null,
  projectionBaselineDigest: null,
  compatibilityPreflightFingerprints: { canonical: null, legacy: null },
  completedPhasesAtIntentWrite: [],
  nextRecoverablePhaseAtIntentWrite: "runtime_record_mutation",
  plannedArtifactIds: [deriveRuntimeWorkspaceKey(command.workspaceId)]
}
```

- [ ] **Step 4: Run focused contract/ledger tests GREEN**

```powershell
node --test --test-isolation=none tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js
node --test --test-isolation=none tests/runtime-workspace-operation-ledger/runtime-workspace-operation-ledger.test.js
```

- [ ] **Step 5: Checkpoint without commit**

```powershell
git diff --check
git status --short
```

Expected changed paths at this checkpoint: the new contract/test plus the additive ledger-contract edit only.

---

### Task 2: Implement the pure mutation coordinator and recovery-safe semantic evaluation

**Files:**
- Create: `src/core/runtime-workspace-mutation/coordinator.js`
- Modify: `tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js`

**Interfaces:**
- Consumes: Task 1 contract/fingerprint; session-authority validation; assignment resolution; scoped lock plan builder; runtime-record contract; workspace-ledger contract/ledger functions; existing `applyDomainMutation`; workspace role helpers.
- Produces:
  - `coordinateRuntimeWorkspaceMutation(command, adapters)`

Required adapter interface:

```js
{
  withScopedLocks(plan, callback),
  readAuthority(),
  readRuntimeWorkspaceRecord(workspaceId),
  writeRuntimeWorkspaceRecord(workspaceId, record),
  readWorkspaceOperationLedger(workspaceId),
  writeWorkspaceOperationLedger(workspaceId, ledger),
  now()
}
```

The coordinator itself owns validation, fingerprints, read-back verification, and ledger transitions. Adapter write methods do not reacquire the workspace-content lock; the coordinator already holds it across the entire transaction.

- [ ] **Step 1: Write failing authority/revision/lock tests**

```js
test("ordinary mutation uses exact window binding and workspace content locks only", async () => {
  const fake = mutationAdaptersFixture();
  const result = await coordinateRuntimeWorkspaceMutation(mutationCommandFixture(), fake.adapters);
  assert.equal(result.status, "committed");
  assert.deepEqual(fake.lockPlan, [
    "constellation-runtime-window:10",
    "constellation-runtime-workspace-binding:workspace-alpha",
    "constellation-runtime-workspace:workspace-alpha"
  ]);
  assert.equal(fake.lockPlan.includes("constellation-runtime-state-v0.1"), false);
  assert.equal(fake.events.some((item) => item.includes("compatibility")), false);
});
```

Add cases for stale runtime session, current context mismatch, source-window assignment mismatch, assignment ID mismatch, epoch mismatch, workspace/key mismatch, malformed record, paused/writable policy if applicable, and expected revision conflict. All must fail before a runtime-record write.

- [ ] **Step 2: Run focused suite RED**

```powershell
node --test --test-isolation=none tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js
```

- [ ] **Step 3: Implement exact authority verification under scoped locks**

Build the lock plan with:

```js
buildScopedLockPlan({
  windowIds: [command.sourceWindowId],
  workspaceBindingIds: [command.workspaceId],
  workspaceContentIds: [command.workspaceId]
});
```

After locks are held, read and validate the current session authority, require exact `runtimeSessionId`, validate the active current context for `sourceWindowId`, resolve the active assignment by both window and workspace, and require exact workspace/assignment ID/epoch agreement.

- [ ] **Step 4: Write failing semantic mutation tests**

Cover the six initial kinds. High-level kinds are atomic at one scoped-record revision:

```text
journal.append                existing reducer once
timeline.append               existing reducer once
workspace.metadata.autosave   metadata patch + updatedAt, no timeline
workspace.metadata.commit     metadata patch + role normalization + one semantic timeline record
workspace.tab.metadata.commit one alias/role patch + one semantic timeline record
search.intake.add             one tab add + one semantic timeline record
```

For `workspace.metadata.commit`, `mode` is exactly `save` or `type_change`; role values invalid for the new workspace type become `unassigned` inside the same in-memory candidate. For `workspace.tab.metadata.commit`, `field` is exactly `alias` or `role`; role is validated against the current workspace type. For `search.intake.add`, an exact existing browser `tabId` returns deterministic `no_change`; same-URL distinct browser tabs remain allowed.

- [ ] **Step 5: Implement semantic evaluation with one revision increment**

Reuse `applyDomainMutation()` for low-level semantic operations, but apply any multi-step high-level operation to an in-memory candidate and increment `workspaceRevision` exactly once when the logical operation changes state. Set `updatedAt` from `command.requestedAt` for changed ordinary content.

Do not add `workspace.metadata.commit` or other high-level kinds to the protected Layer 2.3C `MUTATION_TYPES`; they belong only to the new D3D-05 command family.

- [ ] **Step 6: Write failing pending-intent/replay/recovery tests**

Prove immutable pending evidence precedes a runtime-record write. Before the business write, persist a candidate progress artifact containing only recovery evidence, not duplicate workspace content:

```js
{
  kind: "runtime_record_candidate",
  key: "constellationRuntimeWorkspace:workspace-alpha",
  recordFingerprint: "fnv1a32:...",
  previousRevision: 7,
  committedRevision: 8
}
```

Test exact terminal replay, same operation ID/different fingerprint conflict, write failure before commit, verification-read failure after a possible write, and terminal-ledger write failure after a verified record.

- [ ] **Step 7: Implement ledger order and recovery classification**

Required fresh-operation order:

```text
validate command
acquire window -> binding -> content locks
verify current authority
read/validate scoped record
read/create in-memory workspace ledger
inspect operation fingerprint
check expected revision
compute candidate
write+verify immutable pending intent
write+verify candidate progress evidence
write scoped record (committed mutations only)
read+verify scoped record fingerprint/revision
write+verify terminal ledger result
return total result
```

For `no_change`, terminalize after pending intent without writing the runtime record.

For exact retry with unresolved evidence:
- if current record is still at the expected revision, recompute the candidate and resume the recorded next phase;
- if current record fingerprint equals the recorded candidate fingerprint at the committed revision, do not write it again; complete terminal evidence;
- otherwise return an indeterminate/conflict result and do not overwrite newer state.

- [ ] **Step 8: Run coordinator tests GREEN**

```powershell
node --test --test-isolation=none tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js
node --test --test-isolation=none tests/runtime-workspace-operation-ledger/runtime-workspace-operation-ledger.test.js
node --test --test-isolation=none tests/runtime-scoped-locks/runtime-scoped-locks.test.js
```

- [ ] **Step 9: Checkpoint without commit**

```powershell
git diff --check
git status --short
```

---

### Task 3: Add Chrome storage/Web-Lock adapters and prove Alpha/Beta independence

**Files:**
- Create: `src/core/runtime-workspace-mutation/chrome-adapter.js`
- Modify: `tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js`

**Interfaces:**
- Produces: `createRuntimeWorkspaceMutationChromeAdapters(chromeApi, options = {})`

- [ ] **Step 1: Write failing adapter-isolation tests**

Use deterministic fake `chrome.storage.session`, `chrome.storage.local`, and injected `requestLock`. Assert reads/writes touch only:

```text
constellationRuntimeSessionAuthority
constellationRuntimeWorkspace:<workspaceId>
constellationRuntimeWorkspaceOperationLedger:<workspaceId>
```

and never `constellationActiveWorkspace`, `chromeFlowWorkspace`, `activeWorkspaceId`, or `constellationRecentOperationLedger`.

- [ ] **Step 2: Implement direct lock-aware storage adapters**

The adapter uses `runWithScopedLocks(plan, callback, { requestLock })`; it does not call the existing record/ledger adapters in a way that reacquires `workspaceContent` while already holding it. Storage writes are direct exact-key writes; the coordinator performs read-back verification.

- [ ] **Step 3: Write and run the concurrency proof**

```js
test("Alpha and Beta ordinary mutations overlap while same-workspace calls serialize", async () => {
  const fake = concurrentChromeFixture();
  const [alpha, beta] = await Promise.all([
    coordinateRuntimeWorkspaceMutation(mutationCommandFixture({ workspaceId: "workspace-alpha", sourceWindowId: 10 }), fake.adapters),
    coordinateRuntimeWorkspaceMutation(mutationCommandFixture({ workspaceId: "workspace-beta", sourceWindowId: 20 }), fake.adapters)
  ]);
  assert.equal(alpha.status, "committed");
  assert.equal(beta.status, "committed");
  assert.equal(fake.maxDifferentWorkspaceContentCallbacks >= 2, true);
});
```

Then run:

```powershell
node --test --test-isolation=none tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js
node --test --test-isolation=none tests/runtime-scoped-locks/runtime-scoped-locks.test.js
```

- [ ] **Step 4: Checkpoint without commit**

```powershell
git diff --check
git status --short
```

---

### Task 4: Add client, authorized service-worker handler, and terminal route

**Files:**
- Create: `src/core/runtime-workspace-mutation/client.js`
- Create: `src/core/runtime-workspace-mutation/service-worker-handler.js`
- Modify: `src/background/service-worker.js`
- Modify: `tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js`

**Interfaces:**
- Produces: `createRuntimeWorkspaceMutationClient({ createId, now, send })`
- Client method: `submit({ authority, mutationKind, payload, operationId })`
- Produces: `handleRuntimeWorkspaceMutationMessage(message, sender, sendResponse, options)`

- [ ] **Step 1: Write failing client tests**

The client accepts only `constellation-side-panel-assigned-workspace-authority-v0.1` evidence and copies these exact fields into the command: runtime session, source context/window, workspace ID/revision, assignment ID/epoch. It may generate only `operationId` and `requestedAt`.

```js
const result = await client.submit({
  authority: assignedAuthorityFixture(),
  mutationKind: "timeline.append",
  payload: { record: timelineFixture() }
});
assert.equal(sent[0].runtimeAssignmentId, "assignment-alpha");
assert.equal(sent[0].assignmentEpoch, 1);
```

- [ ] **Step 2: Write failing route authorization tests**

Require `validateSidePanelSender(sender, runtimeId, sidePanelUrl)`. Malformed command or wrong sender returns one total failed/rejected D3D-05 result and performs zero adapter business calls.

- [ ] **Step 3: Implement client and handler**

The handler constructs `createRuntimeWorkspaceMutationChromeAdapters(options.chromeApi)` and calls `coordinateRuntimeWorkspaceMutation`. `isRuntimeWorkspaceMutationMessage` matches only the new type/schema family and does not absorb old routes.

- [ ] **Step 4: Register the route before legacy journal/reconciliation fallthrough**

In `src/background/service-worker.js`, add the exact new handler branch while preserving all existing classifiers. Do not alter window-close, membership, activation, promotion, context-register, old journal, or reconciliation semantics.

- [ ] **Step 5: Run focused + route regressions**

```powershell
node --test --test-isolation=none tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js
npm run test:runtime-session-authority
npm run test:runtime-workspace-activation
```

- [ ] **Step 6: Static import check**

```powershell
Select-String -Path src/core/runtime-workspace-mutation/*.js -Pattern 'workspace-store|constellation-storage-compatibility|writeCompatibleStorageValue|readCompatibleStorageValue'
```

Expected: no match.

---

### Task 5: Add a full-assignment journal v0.2 route while preserving v0.1 byte-semantics

**Files:**
- Modify: `src/core/journal-append-coordination/contract.js`
- Modify: `src/core/journal-append-coordination/coordinator.js`
- Modify: `src/core/journal-append-coordination/client.js`
- Modify: `src/core/journal-append-coordination/chrome-adapter.js`
- Modify: `src/core/journal-append-coordination/readonly-workspace.js`
- Modify: `src/background/service-worker.js`
- Modify: `tests/journal-append-coordination/journal-coordination.test.js`
- Modify: `tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js`

**Interfaces:**
- Add:
  - `JOURNAL_APPEND_ASSIGNED_REQUEST_SCHEMA = "constellation-journal-append-request-v0.2"`
  - `JOURNAL_APPEND_ASSIGNED_RESPONSE_SCHEMA = "constellation-journal-append-response-v0.2"`
  - `validateAssignedJournalAppendRequest`
  - `validateAssignedJournalAppendResponse`
  - `coordinateAssignedJournalAppend`
  - `readAssignedWorkspaceReadonly(authority)`
- Preserve the existing v0.1 exports and behavior.

- [ ] **Step 1: Pin the old route with regression assertions**

Record the existing v0.1 request fields, response fields, global lock identity, compatibility adapter behavior, and retry tests as unchanged assertions before adding v0.2.

- [ ] **Step 2: Write failing v0.2 tests**

The v0.2 request contains the old journal entry plus complete assignment identity:

```js
{
  schema: JOURNAL_APPEND_ASSIGNED_REQUEST_SCHEMA,
  operationId,
  runtimeSessionId,
  sourceContextId,
  sourceWindowId,
  workspaceId,
  expectedWorkspaceRevision,
  runtimeAssignmentId,
  assignmentEpoch,
  requestedAt,
  entry
}
```

- [ ] **Step 3: Implement the assigned journal translation**

`coordinateAssignedJournalAppend()` validates v0.2, translates it deterministically into one `journal.append` D3D-05 mutation command, calls `coordinateRuntimeWorkspaceMutation()`, and maps the total D3D-05 result back to the v0.2 journal response. It does not call the v0.1 global coordinator.

- [ ] **Step 4: Update the journal client in additive mode**

When the caller supplies verified assigned authority, construct v0.2 and retain the existing pending/in-flight identity behavior. Legacy construction remains available for existing tests/callers that do not supply assigned authority.

- [ ] **Step 5: Add the assigned journal service-worker branch**

Route v0.2 to `coordinateAssignedJournalAppend` with the scoped mutation adapter. Route v0.1 to the existing `coordinateJournalAppend` and `createChromeJournalAdapters` unchanged.

- [ ] **Step 6: Run journal + mutation regressions**

```powershell
npm run test:journal-coordination
node --test --test-isolation=none tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js
npm run test:runtime-contract
```

Expected: all pre-existing journal tests remain green in meaning; new v0.2 tests prove scoped authority and no global lock.

---

### Task 6: Migrate metadata autosave/save/type and assigned active-runtime helpers

**Files:**
- Modify: `src/core/workspace-runtime-store.js`
- Modify: `src/sidepanel/workspace-metadata-autosave.js`
- Modify: `src/sidepanel/sidepanel.js`
- Modify: `tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js`
- Existing metadata barrier tests, if present, remain passing.

**Interfaces:**
- Add explicit assigned runtime helper(s) that require a verified D3D-04 authority object; do not change legacy archive/diagnostic APIs.
- Metadata autosave submits `workspace.metadata.autosave`.
- Save/type UI submits `workspace.metadata.commit` with exact mode `save` or `type_change`.

- [ ] **Step 1: Write failing metadata barrier integration tests**

Prove rapid metadata submissions retain latest-write sequencing, but the commit callback now sends one scoped mutation command rather than taking `LOCK_NAMES.runtimeState` or reading/writing compatibility peers.

- [ ] **Step 2: Implement assigned metadata autosave**

Before each autosave commit, force a fresh D3D-04 authority resolve. If state is not assigned/active, fail without mutation. Submit:

```js
{
  mutationKind: "workspace.metadata.autosave",
  payload: { name: snapshot.name, aim: snapshot.aim }
}
```

After `committed`/`no_change`/`replayed`, force a fresh binding resolve so the cached panel revision/workspace cannot remain stale.

- [ ] **Step 3: Replace side-panel save/type global writer adapters**

Stop calling `saveWorkspaceDetailsAgainstLatest` / `updateWorkspaceTypeAgainstLatest` with compatibility adapters from the D3D-05 assigned path. Keep the metadata barrier for ordering, but submit one `workspace.metadata.commit` command containing `mode`, `name`, `aim`, `workspaceType`, and `eventId`.

- [ ] **Step 4: Run focused + activation characterization**

```powershell
node --test --test-isolation=none tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js
npm run test:runtime-workspace-activation
npm run test:characterization
```

- [ ] **Step 5: Checkpoint static absence of global metadata authority**

```powershell
Select-String -Path src/sidepanel/workspace-metadata-autosave.js -Pattern 'LOCK_NAMES.runtimeState|readCompatibleStorageValue\("activeWorkspace"\)|writeCompatibleStorageValue\("activeWorkspace"\)'
```

Expected: no match in the new metadata persistence path.

---

### Task 7: Migrate side-panel ordinary timeline/tab metadata/search-intake writers and fail closed on legacy identity repair

**Files:**
- Modify: `src/sidepanel/sidepanel.js`
- Modify: `src/sidepanel/search-workspace-intake.js`
- Modify: `src/core/journal-append-coordination/readonly-workspace.js`
- Modify: `src/core/workspace-runtime-store.js`
- Modify: `tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js`

**Interfaces:**
- Side panel gets one local helper that performs: fresh authority resolve -> `mutationClient.submit()` -> fresh authority resolve on verified success.
- Timeline helper emits `timeline.append` with an explicit `eventId` and `createdAt`.
- Alias/role helpers emit one `workspace.tab.metadata.commit` each.
- Search auto-intake emits one `search.intake.add` operation.

- [ ] **Step 1: Write static/fake tests that identify the D3D-05 global writers**

Pin at least these migrations:
- user journal -> assigned journal v0.2;
- ordinary timeline append -> `timeline.append`;
- alias -> `workspace.tab.metadata.commit`;
- role -> `workspace.tab.metadata.commit`;
- metadata autosave/save/type -> Task 6 route;
- search auto-intake global get/save/timeline -> `search.intake.add`;
- `migrateWorkspaceTabIds()` no longer performs a global whole-object write on the assigned D3D-05 path.

- [ ] **Step 2: Implement assigned timeline helper and replace D3D-05 timeline calls**

A timeline record is created client-side with immutable event identity:

```js
{
  eventId: crypto.randomUUID(),
  type,
  message,
  createdAt: new Date().toISOString(),
  ...details
}
```

The helper sends it as `{ mutationKind: "timeline.append", payload: { record } }` using fresh assigned authority. Product actions that belong to later D3D slices remain explicitly old-route-only until their mapped slice; do not opportunistically rewrite their business transaction here.

- [ ] **Step 3: Migrate alias and role as atomic semantic mutations**

Do not `getWorkspace()` -> edit -> `saveWorkspace()` -> append a second event. Submit one `workspace.tab.metadata.commit` containing the target `workspaceTabId`, exact field/value, and event ID; coordinator applies the tab metadata and semantic timeline record in one revision.

- [ ] **Step 4: Migrate `search-workspace-intake.js`**

Resolve assigned authority, use the assigned workspace snapshot only for duplicate preflight, and submit one `search.intake.add` command containing the new tab record, query, event ID, and `sameUrlDuplicate`. Do not import `workspace-store.js` from this root after migration.

- [ ] **Step 5: Replace silent `workspaceTabId` repair with fail-closed evidence**

The assigned startup path must not generate IDs and save a whole workspace. If any assigned tab lacks a valid immutable `workspaceTabId`, keep mutation-sensitive controls blocked and emit a deterministic status such as `runtime_workspace_identity_migration_required`; do not write compatibility or scoped workspace state.

- [ ] **Step 6: Run source scans and focused tests**

```powershell
node --test --test-isolation=none tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js
npm run test:journal-coordination
npm run test:runtime-workspace-activation
npm run test:characterization
Select-String -Path src/sidepanel/search-workspace-intake.js -Pattern 'workspace-store|saveWorkspace|getWorkspace|addTimelineEvent'
```

Expected for `search-workspace-intake.js`: no old global workspace writer imports/calls.

- [ ] **Step 7: Checkpoint without commit**

```powershell
git diff --check
git status --short
```

---

### Task 8: Complete D3D-05 automated closure and write the evidence packet

**Files:**
- Create: `docs/validation/LAYER-2.3D-D3D-05-TYPED-RUNTIME-MUTATION-EVIDENCE.md`
- Modify production only if a failing authorized check exposes a D3D-05 defect; otherwise no additional production changes.

**Interfaces:**
- Evidence document records exact commands/results; it does not claim live Chrome validation.

- [ ] **Step 1: Run syntax checks for every changed/new JS file**

```powershell
$changedJs = git diff --name-only --diff-filter=ACMRT HEAD -- '*.js' '*.mjs'
foreach ($file in $changedJs) {
    node --check $file
    if ($LASTEXITCODE -ne 0) { throw "node --check failed: $file" }
}
```

- [ ] **Step 2: Run D3D-01 through D3D-05 focused suites**

```powershell
node --test --test-isolation=none tests/runtime-workspace-record/runtime-workspace-record.test.js
node --test --test-isolation=none tests/runtime-workspace-operation-ledger/runtime-workspace-operation-ledger.test.js
node --test --test-isolation=none tests/runtime-scoped-locks/runtime-scoped-locks.test.js
node --test --test-isolation=none tests/runtime-window-binding/runtime-window-binding.test.js
node --test --test-isolation=none tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js
```

- [ ] **Step 3: Run affected established suites**

```powershell
npm run test:runtime-contract
npm run test:runtime-session-authority
npm run test:journal-coordination
npm run test:runtime-workspace-activation
npm run test:characterization
npm run check:inventory
npm run check:runtime-contract-purity
```

- [ ] **Step 4: Run the full established aggregate**

```powershell
npm run check
```

The existing aggregate is expected to remain the established 617-test matrix until D3D-15; the D3D-05 suite is run separately above and must not be silently counted as part of `npm run check`.

- [ ] **Step 5: Run static architecture scans**

```powershell
Select-String -Path src/core/runtime-workspace-mutation/*.js -Pattern 'workspace-store|constellation-storage-compatibility|constellationActiveWorkspace|chromeFlowWorkspace|activeWorkspaceId|constellationRecentOperationLedger'
Select-String -Path src/core/runtime-workspace-mutation/*.js -Pattern 'constellation-runtime-state-v0.1|COMPATIBILITY_PROJECTION_LOCK'
git diff --check
```

Expected: no forbidden authority/import match in the new family; `git diff --check` exit 0.

- [ ] **Step 6: Record the evidence packet**

The document must contain:
- repository, branch, starting HEAD/upstream and final working-tree state;
- exact changed/new paths;
- mutation-kind registry;
- authority-envelope matrix;
- revision/replay/failure matrix;
- exact lock traces for Alpha, Beta, and same-workspace serialization;
- proof immutable pending intent precedes business write;
- proof terminal replay does not duplicate a mutation;
- proof v0.1 journal/compatibility route remains available;
- proof new route performs no compatibility/global mutation;
- focused test counts and established-suite counts;
- inventory/purity/diff results;
- explicit `Push: not performed` and `Chrome: not operated`.

- [ ] **Step 7: Final source-review gate; do not commit yet**

```powershell
git status --short
git diff --stat
git diff --name-status
git diff --check
```

Return the complete diff/evidence to Byte-Nolan. Stop at:

```text
READY FOR BYTE-NOLAN D3D-05 SOURCE REVIEW
```

Do not stage, commit, push, open a PR, merge, or operate Chrome.

## Implementation Stop Conditions

Stop immediately rather than widening scope if any of these occurs:

1. A mapped writer cannot receive the complete current D3D-04 assignment tuple.
2. An ordinary mutation needs the global runtime-state lock.
3. The new route needs compatibility state to authorize or complete its primary mutation.
4. A protected v0.1 schema or `src/core/workspace-store.js` would need in-place semantic change.
5. A generic whole-workspace replacement becomes necessary.
6. A missing immutable tab identity can only be repaired by silent whole-object mutation.
7. Runtime record and ledger cannot remain serialized under one exact workspace-content lock without lock re-entry.
8. Recovery cannot distinguish "record not written" from "record verified but terminal evidence missing" without overwriting newer state.
9. An unexpected production writer falls into D3D-05 but is absent from the accepted map/design.
10. Any required proof depends on live Chrome or real extension storage.
11. Any frozen architecture artifact, manifest/dependency/IndexedDB identity, or later-slice concern would need modification.

## Completion Boundary

D3D-05 is implementation-complete only after Byte-Nolan source review accepts the full diff and automated evidence. Even then, the branch remains **not safe to live-load or merge**. D3D-06 and later reader/integration closure still have to migrate the remaining multi-window surfaces before Operator/live validation is authorized.
