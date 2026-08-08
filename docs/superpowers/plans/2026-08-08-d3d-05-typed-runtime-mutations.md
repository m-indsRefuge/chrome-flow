# D3D-05 Typed Ordinary Runtime Mutations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Layer 2.3D ordinary active-Stella mutation authority with exact assigned scoped runtime records, workspace-local revision/ledger evidence, and workspace-scoped locks while preserving all published Layer 2.3C routes unchanged.

**Architecture:** Add one versioned `runtime-workspace-mutation` family. Every new mutation command carries the complete D3D-04 assignment tuple, is freshly revalidated in the service worker, acquires only the exact window/binding/content locks, reads and writes one `constellationRuntimeWorkspace:<workspaceId>` record, and records replay/recovery evidence in that workspace's local ledger. Existing compatibility/global routes remain available but cannot authorize the new path.

**Tech Stack:** Manifest V3 Chrome extension, ES modules, Node.js >=24, Node built-in test runner, `chrome.storage.local`, `chrome.storage.session`, Web Locks, existing deterministic runtime contracts/reducers.

## Global Constraints

- Repository: `C:\Users\nolan\AIProjects\constellation`.
- Branch: `layer2-3d-concurrent-multi-stella-window-binding`.
- Begin only when local `HEAD` equals `@{u}` and the working tree is clean.
- The branch must contain `docs/superpowers/specs/2026-08-08-d3d-05-typed-runtime-mutations-design.md`.
- Do not modify the three frozen Layer 2.3D authority artifacts, `manifest.json`, `src/sidepanel/sidepanel.html`, dependencies, IndexedDB identities/stores, or protected compatibility identities.
- `src/core/workspace-store.js` remains an old-route compatibility module and is not modified.
- Published Layer 2.3C schemas remain semantically unchanged; D3D-05 adds new schemas/routes rather than repurposing old ones.
- No new dependency.
- No live Chrome load/reload, no real extension-storage mutation, no merge, no release.
- No compatibility read/write may authorize or complete a D3D-05 primary mutation.
- Ordinary D3D-05 mutation must not acquire `constellation-runtime-state-v0.1` or the compatibility-projection lock.
- Different workspaces must be able to progress concurrently; same-workspace mutations serialize.
- A D3D-05 mutation requires `lifecycleState === "available"`. An assigned `paused` record is inconsistent evidence and fails closed without mutation.
- Missing immutable `workspaceTabId` fails closed on the new assigned path; D3D-05 does not silently repair whole workspace objects.
- `package.json` aggregate scripts remain unchanged in this slice; D3D-15 owns aggregate D3D closure.
- Implementation workers do not stage, commit, push, open PRs, merge, or operate Chrome during the tasks below. Each task ends at a test/diff checkpoint. One slice commit is considered only after Byte-Nolan source review and full validation.

## File Structure

### Create

- `src/core/runtime-workspace-mutation/contract.js` — exact command/result schemas, closed mutation-kind registry, payload validation, deterministic fingerprint.
- `src/core/runtime-workspace-mutation/coordinator.js` — authority verification, semantic evaluation, scoped record transaction, replay/recovery state machine.
- `src/core/runtime-workspace-mutation/chrome-adapter.js` — exact session/local storage I/O and Web-Lock integration; no compatibility storage.
- `src/core/runtime-workspace-mutation/client.js` — command construction only from verified D3D-04 assigned authority.
- `src/core/runtime-workspace-mutation/service-worker-handler.js` — exact classifier, side-panel sender validation, adapter creation, terminal handling.
- `tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js` — focused D3D-05 contract/coordinator/adapter/client/route/concurrency coverage.
- `docs/validation/LAYER-2.3D-D3D-05-TYPED-RUNTIME-MUTATION-EVIDENCE.md` — final automated acceptance evidence.

### Modify

- `src/core/runtime-workspace-operation-ledger/contract.js` — additive `ordinary_mutation` registry entry authorized by the accepted D3D-SR-R3 extension policy.
- `src/core/journal-append-coordination/contract.js` — preserve v0.1 exports; add assigned v0.2 request/response contract.
- `src/core/journal-append-coordination/coordinator.js` — preserve v0.1 coordinator; add v0.2 translation into the new mutation coordinator.
- `src/core/journal-append-coordination/client.js` — preserve legacy construction; add assigned construction from verified authority.
- `src/core/journal-append-coordination/chrome-adapter.js` — preserve legacy adapter; add a scoped adapter factory/re-export used only by the v0.2 path without compatibility I/O.
- `src/core/journal-append-coordination/readonly-workspace.js` — preserve compatibility read; add a pure explicit-assigned snapshot helper.
- `src/core/workspace-runtime-store.js` — preserve archive/diagnostic/legacy APIs; add explicit assigned/scoped active-runtime helpers only.
- `src/sidepanel/workspace-metadata-autosave.js` — retain metadata-barrier ordering; replace global compatibility persistence with assigned typed mutation.
- `src/sidepanel/search-workspace-intake.js` — replace direct global workspace get/save/timeline writer with one assigned `search.intake.add` mutation.
- `src/sidepanel/sidepanel.js` — route D3D-05 journal/timeline/metadata/alias/role writers through exact assigned mutation authority; remove silent ID repair from the assigned startup path.
- `src/background/service-worker.js` — register the new mutation route and assigned journal route while retaining every old classifier.

### Preserve unchanged in this slice

- `src/core/workspace-store.js`.
- `src/sidepanel/workspace-metadata-barrier.js`; its current save/type semantics are re-expressed by the new coordinator and its existing tests remain regression evidence.
- `tests/journal-append-coordination/journal-coordination.test.js`; it remains the v0.1 characterization/regression suite.
- `tests/workspace-membership-mutation/workspace-membership-mutation.test.js`; its metadata-barrier tests remain passing without editing.
- `package.json` and `.github/workflows/pure-checks.yml`.

---

### Task 1: Freeze the D3D-05 command/result contract and additive ledger schema registration

**Files:**
- Create: `src/core/runtime-workspace-mutation/contract.js`
- Create: `tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js`
- Modify: `src/core/runtime-workspace-operation-ledger/contract.js`
- Regression: `tests/runtime-workspace-operation-ledger/runtime-workspace-operation-ledger.test.js`

**Interfaces:**

Produces:

```js
RUNTIME_WORKSPACE_MUTATION_TYPE = "constellation-runtime-workspace-mutation"
RUNTIME_WORKSPACE_MUTATION_COMMAND_SCHEMA = "constellation-runtime-workspace-mutation-command-v0.1"
RUNTIME_WORKSPACE_MUTATION_RESULT_SCHEMA = "constellation-runtime-workspace-mutation-result-v0.1"
RUNTIME_WORKSPACE_MUTATION_KINDS
snapshotAndValidateRuntimeWorkspaceMutationCommand(value)
createRuntimeWorkspaceMutationResult(command, fields)
validateRuntimeWorkspaceMutationResult(value, expected)
runtimeWorkspaceMutationFingerprint(command)
isRuntimeWorkspaceMutationMessage(message)
```

Add exactly one workspace-ledger registry mapping:

```js
ordinary_mutation: "constellation-runtime-workspace-mutation-command-v0.1"
```

The initial mutation-kind registry is exactly:

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
[
  "type", "schema", "operationId", "runtimeSessionId", "sourceContextId",
  "sourceWindowId", "workspaceId", "expectedWorkspaceRevision",
  "runtimeAssignmentId", "assignmentEpoch", "mutationKind", "payload",
  "requestedAt"
]
```

The exact result fields are:

```js
[
  "schema", "status", "reason", "operationId", "runtimeSessionId",
  "sourceContextId", "sourceWindowId", "workspaceId", "runtimeAssignmentId",
  "assignmentEpoch", "previousRevision", "committedRevision",
  "recordFingerprint", "phase", "mutationCommitted", "authorityVerified",
  "workspaceVerified", "ledgerRecorded", "retrySafe", "indeterminate",
  "warnings", "errors"
]
```

Exact payload contracts:

```js
// journal.append
{ record: { entryId, text, tag, relatedRoleId, relatedRoleLabel, createdAt } }

// timeline.append
{ record }
// payload has exactly `record`; record is plain serializable data with required
// non-empty `eventId`, `type`, `message`, and valid `createdAt`; additional
// serializable event-detail fields are preserved because existing timeline
// event shapes are intentionally heterogeneous.

// workspace.metadata.autosave
{ name, aim }

// workspace.metadata.commit
{ mode, name, aim, workspaceType, eventId }
// mode is exactly "save" or "type_change".

// workspace.tab.metadata.commit
{ workspaceTabId, field, value, eventId }
// field is exactly "alias" or "role".

// search.intake.add
{ tab, query, eventId, sameUrlDuplicate }
// `tab` is one serializable tab record with non-empty workspaceTabId and a
// non-negative integer browser tabId/windowId; `sameUrlDuplicate` is boolean.
```

`runtimeWorkspaceMutationFingerprint()` canonicalizes the complete semantic command excluding only `requestedAt`. This follows the existing runtime mutation fingerprint convention: retry time is evidence, while authority identities, expected revision, mutation kind and payload are fingerprinted.

- [ ] **Step 1: Write the RED exact-contract tests**

```js
test("D3D-05 command requires complete assigned authority", () => {
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

test("D3D-05 payloads are closed at the operation boundary", () => {
  assert.equal(snapshotAndValidateRuntimeWorkspaceMutationCommand(
    mutationCommandFixture({ mutationKind: "workspace.metadata.autosave", payload: { name: "A", aim: "B", extra: true } })
  ).valid, false);
});
```

Add tests for zero/negative assignment epoch, negative expected revision, malformed timestamp, unknown top-level field, unknown kind, cyclic payload, invalid journal fields, invalid metadata mode, invalid tab metadata field, and malformed search tab identity.

Add an additive registry assertion that all seven existing mappings retain their exact values and `ordinary_mutation` is the only new key.

- [ ] **Step 2: Run RED**

```powershell
node --test --test-isolation=none tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js
```

Expected: fail because the new module does not exist.

- [ ] **Step 3: Implement the strict contract and registry extension**

Use existing pure helpers `isPlainObject`, `nonEmptyString`, `serializableErrors`, `stableStringify`, `validDateTime`, and `isValidRuntimeWorkspaceId`. Unknown v0.1 command/result fields fail closed.

The ledger intent generated later by the coordinator is exactly:

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

- [ ] **Step 4: Run GREEN plus D3D-02 regression**

```powershell
node --test --test-isolation=none tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js
node --test --test-isolation=none tests/runtime-workspace-operation-ledger/runtime-workspace-operation-ledger.test.js
```

- [ ] **Step 5: Checkpoint without staging or commit**

```powershell
git diff --check
git status --short
```

---

### Task 2: Implement the pure coordinator, semantic operations, and recovery-safe ordering

**Files:**
- Create: `src/core/runtime-workspace-mutation/coordinator.js`
- Modify: `tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js`

**Interfaces:**

Consumes Task 1 contract/fingerprint plus existing session-authority validation, assignment lookup, scoped lock-plan builder, runtime-record contract, workspace-ledger functions, `applyDomainMutation`, `isValidWorkspaceRole`, and workspace type/role-label helpers.

Produces:

```js
coordinateRuntimeWorkspaceMutation(command, adapters)
```

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

Adapter writes do not reacquire the workspace-content lock. The coordinator holds the exact primary lock plan across ledger and runtime-record compare/write/verify operations.

- [ ] **Step 1: Write RED authority/revision/lock tests**

```js
test("ordinary mutation holds only exact window binding and content locks", async () => {
  const fake = mutationAdaptersFixture();
  const result = await coordinateRuntimeWorkspaceMutation(mutationCommandFixture(), fake.adapters);
  assert.equal(result.status, "committed");
  assert.deepEqual(fake.lockPlan, [
    "constellation-runtime-window:10",
    "constellation-runtime-workspace-binding:workspace-alpha",
    "constellation-runtime-workspace:workspace-alpha"
  ]);
  assert.equal(fake.lockPlan.includes("constellation-runtime-state-v0.1"), false);
});
```

Add exact cases for stale runtime session, stale current context, source-window assignment mismatch, workspace assignment mismatch, assignment ID drift, epoch drift, key/workspace mismatch, malformed runtime record, `lifecycleState: "paused"`, and expected revision conflict. Every case must record zero runtime-record writes.

- [ ] **Step 2: Run RED**

```powershell
node --test --test-isolation=none tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js
```

- [ ] **Step 3: Implement fresh authority verification under one scoped lock plan**

Build exactly:

```js
buildScopedLockPlan({
  windowIds: [command.sourceWindowId],
  workspaceBindingIds: [command.workspaceId],
  workspaceContentIds: [command.workspaceId]
});
```

Inside the held plan: validate the current session root; require exact runtime session; validate the active current panel context for the exact source window; resolve assignment by both window and workspace; require exact workspace/assignment ID/positive epoch; then read and validate the exact scoped runtime record and require `lifecycleState === "available"` and exact expected revision.

- [ ] **Step 4: Write RED semantic-operation tests**

The six operations have these exact semantics:

```text
journal.append
  Use existing journal reducer. Preserve immutable entry ID semantics.

timeline.append
  Use existing timeline reducer. Operation-ledger replay prevents duplicate replay.

workspace.metadata.autosave
  Apply name + aim only; set updatedAt=requestedAt; append no timeline event.

workspace.metadata.commit mode=save
  Apply name + aim + workspaceType; if workspaceType changed, normalize any tab role
  invalid for the new type to "unassigned"; append exactly one workspace_saved event
  using payload.eventId and requestedAt. A save remains a semantic write because the
  current product behavior records workspace_saved even when metadata text is unchanged.

workspace.metadata.commit mode=type_change
  If type/name/aim are all unchanged, return no_change. Otherwise apply metadata;
  normalize invalid roles only when type changes; append exactly one
  workspace_type_updated event only when type changes. The event records previousType,
  nextType and uses the existing workspace type labels.

workspace.tab.metadata.commit field=alias
  Require target workspaceTabId; trim value; apply alias; set updatedAt=requestedAt;
  append exactly one tab_alias_updated event using payload.eventId.

workspace.tab.metadata.commit field=role
  Require target workspaceTabId; value defaults to "unassigned" only when explicitly
  passed as empty string; reject a non-empty role invalid for current workspaceType;
  apply role; set updatedAt=requestedAt; append exactly one tab_role_updated event with
  previousRole and new role using payload.eventId.

search.intake.add
  Require one exact tab record. If current workspace already contains the same browser
  tabId, return no_change and append no duplicate record. Otherwise use existing
  workspace.tab.add semantics, set updatedAt=requestedAt, and append exactly one
  browser_search_tab_added_to_workspace event with query, tabId, URL, workspaceTabId,
  sameUrlDuplicate and searchLaunchAutoIntake=true using payload.eventId.
```

Every changed high-level semantic operation increments `workspaceRevision` exactly once, regardless of how many in-memory field/timeline changes it contains.

- [ ] **Step 5: Implement semantic evaluation**

Reuse `applyDomainMutation()` for low-level operations. For high-level operations, compose changes in memory, validate the final candidate, then apply one revision increment. Do not add the high-level D3D-05 kinds to protected Layer 2.3C `MUTATION_TYPES`.

- [ ] **Step 6: Write RED pending-intent/replay/recovery tests**

Before any runtime-record business write, persist immutable operation intent and then progress evidence containing only the candidate identity:

```js
{
  kind: "runtime_record_candidate",
  key: "constellationRuntimeWorkspace:workspace-alpha",
  recordFingerprint: "fnv1a32:...",
  previousRevision: 7,
  committedRevision: 8
}
```

Cover:
- exact terminal replay;
- same operation ID/different fingerprint conflict;
- ledger absent -> deterministic in-memory ledger creation then persisted pending intent;
- ledger malformed -> fail closed;
- pending-intent write/verification failure -> no runtime-record write;
- runtime-record write failure;
- runtime-record verification read/fingerprint failure after possible write -> `indeterminate: true`;
- terminal-ledger write/verification failure after verified record -> `indeterminate: true`, without rolling the record back.

- [ ] **Step 7: Implement exact fresh/retry ordering**

Fresh operation:

```text
validate command
acquire window -> workspace-binding -> workspace-content locks
verify current session/context/assignment
read+validate scoped record
read+validate or create workspace-local ledger in memory
inspect operation fingerprint
verify expected revision
compute candidate and candidate fingerprint
persist+verify immutable pending intent
persist+verify candidate progress evidence
write scoped record only for a changed semantic operation
read+verify exact candidate record/fingerprint/revision
persist+verify terminal ledger result
return total result
```

For `no_change`, terminalize the persisted intent without writing the runtime record.

Exact retry with unresolved evidence:
- if the current record remains at the original expected revision, recompute the exact candidate and resume from the recorded next phase;
- if the current record is already at the recorded committed revision and exact candidate fingerprint, do not write it again; complete terminal evidence;
- any other record/revision/fingerprint combination returns deterministic indeterminate/conflict evidence and does not overwrite state.

- [ ] **Step 8: Run coordinator regressions GREEN**

```powershell
node --test --test-isolation=none tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js
node --test --test-isolation=none tests/runtime-workspace-operation-ledger/runtime-workspace-operation-ledger.test.js
node --test --test-isolation=none tests/runtime-scoped-locks/runtime-scoped-locks.test.js
npm run test:runtime-contract
```

- [ ] **Step 9: Checkpoint without staging or commit**

```powershell
git diff --check
git status --short
```

---

### Task 3: Add direct Chrome storage/Web-Lock adapters and prove workspace concurrency

**Files:**
- Create: `src/core/runtime-workspace-mutation/chrome-adapter.js`
- Modify: `tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js`

**Interfaces:**

Produces:

```js
createRuntimeWorkspaceMutationChromeAdapters(chromeApi, options = {})
```

- [ ] **Step 1: Write RED exact-storage tests**

Use fake `chrome.storage.session`, `chrome.storage.local`, and injected `requestLock`. Assert the adapter can touch only:

```text
constellationRuntimeSessionAuthority
constellationRuntimeWorkspace:<workspaceId>
constellationRuntimeWorkspaceOperationLedger:<workspaceId>
```

Assert zero access to:

```text
constellationActiveWorkspace
chromeFlowWorkspace
activeWorkspaceId
constellationRecentOperationLedger
```

- [ ] **Step 2: Implement the adapter**

Use `runWithScopedLocks(plan, callback, { requestLock })`. `readAuthority()` reads exactly the session-authority key. Runtime-record and ledger reads/writes derive one exact local key. The coordinator owns record/ledger validation and read-back comparison. Do not call existing record/ledger adapter methods that would reacquire the already-held workspace-content lock.

- [ ] **Step 3: Prove Alpha/Beta overlap and same-Stella serialization**

```js
test("Alpha and Beta content callbacks overlap without sharing a content lock", async () => {
  const fake = concurrentChromeFixture();
  const [alpha, beta] = await Promise.all([
    coordinateRuntimeWorkspaceMutation(alphaCommand(), fake.alphaAdapters),
    coordinateRuntimeWorkspaceMutation(betaCommand(), fake.betaAdapters)
  ]);
  assert.equal(alpha.status, "committed");
  assert.equal(beta.status, "committed");
  assert.equal(fake.maxDifferentWorkspaceContentCallbacks >= 2, true);
});
```

Add a same-workspace pair and assert maximum simultaneous callbacks for the same content-lock name is exactly 1.

- [ ] **Step 4: Run GREEN**

```powershell
node --test --test-isolation=none tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js
node --test --test-isolation=none tests/runtime-scoped-locks/runtime-scoped-locks.test.js
```

- [ ] **Step 5: Checkpoint without staging or commit**

```powershell
git diff --check
git status --short
```

---

### Task 4: Add the assigned mutation client, authorized handler, and service-worker route

**Files:**
- Create: `src/core/runtime-workspace-mutation/client.js`
- Create: `src/core/runtime-workspace-mutation/service-worker-handler.js`
- Modify: `src/background/service-worker.js`
- Modify: `tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js`

**Interfaces:**

```js
createRuntimeWorkspaceMutationClient({ createId, now, send })
client.submit({ authority, mutationKind, payload, operationId })
handleRuntimeWorkspaceMutationMessage(message, sender, sendResponse, options)
```

`operationId` is optional input; when omitted the client generates it. The client never generates or repairs assignment identity.

- [ ] **Step 1: Write RED client tests**

Accept only authority with schema `constellation-side-panel-assigned-workspace-authority-v0.1`. Copy exact runtime session, source context/window, workspace ID/revision, assignment ID/epoch. Reject stale/incomplete authority before `send()`.

```js
await client.submit({
  authority: assignedAuthorityFixture(),
  mutationKind: "timeline.append",
  payload: { record: timelineFixture() }
});
assert.equal(sent[0].runtimeAssignmentId, "assignment-alpha");
assert.equal(sent[0].assignmentEpoch, 1);
```

- [ ] **Step 2: Write RED sender/route tests**

Use `validateSidePanelSender(sender, runtimeId, sidePanelUrl)`. Wrong sender or malformed command returns one total D3D-05 result and records zero business adapter calls. `isRuntimeWorkspaceMutationMessage()` must not classify old activation, context, journal v0.1, membership, promotion, placement, or reconciliation messages.

- [ ] **Step 3: Implement client and handler**

Handler constructs `createRuntimeWorkspaceMutationChromeAdapters(options.chromeApi)` unless an injected factory is supplied, then calls `coordinateRuntimeWorkspaceMutation()`.

- [ ] **Step 4: Register the new route in `service-worker.js`**

Add the exact D3D-05 branch before the legacy journal/reconciliation fallthrough. Do not alter existing branches.

- [ ] **Step 5: Run GREEN and static forbidden-import scan**

```powershell
node --test --test-isolation=none tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js
npm run test:runtime-session-authority
npm run test:runtime-workspace-activation
Select-String -Path src/core/runtime-workspace-mutation/*.js -Pattern 'workspace-store|constellation-storage-compatibility|writeCompatibleStorageValue|readCompatibleStorageValue'
```

Expected: tests pass and the static scan returns no match.

---

### Task 5: Add assigned journal v0.2 without changing v0.1 semantics

**Files:**
- Modify: `src/core/journal-append-coordination/contract.js`
- Modify: `src/core/journal-append-coordination/coordinator.js`
- Modify: `src/core/journal-append-coordination/client.js`
- Modify: `src/core/journal-append-coordination/chrome-adapter.js`
- Modify: `src/core/journal-append-coordination/readonly-workspace.js`
- Modify: `src/background/service-worker.js`
- Modify: `tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js`
- Regression unchanged: `tests/journal-append-coordination/journal-coordination.test.js`

**Interfaces:**

```js
JOURNAL_APPEND_ASSIGNED_REQUEST_SCHEMA = "constellation-journal-append-request-v0.2"
JOURNAL_APPEND_ASSIGNED_RESPONSE_SCHEMA = "constellation-journal-append-response-v0.2"
validateAssignedJournalAppendRequest(request)
validateAssignedJournalAppendResponse(result, expected)
coordinateAssignedJournalAppend(request, adapters)
readAssignedWorkspaceReadonly(authority)
```

The existing v0.1 constants/functions remain available with their current fields and behavior.

- [ ] **Step 1: Run the unchanged v0.1 suite as the before-gate**

```powershell
npm run test:journal-coordination
```

Capture the pass count. Do not edit that test file.

- [ ] **Step 2: Write RED v0.2 tests in the D3D-05 suite**

Exact v0.2 request fields:

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

The entry keeps the exact existing six fields: `entryId`, `text`, `tag`, `relatedRoleId`, `relatedRoleLabel`, `createdAt`.

- [ ] **Step 3: Implement deterministic v0.2 translation**

`coordinateAssignedJournalAppend()` validates v0.2, creates one D3D-05 command with `mutationKind: "journal.append"` and `payload: { record: request.entry }`, calls `coordinateRuntimeWorkspaceMutation()`, then maps the total mutation result into v0.2 response fields. It never calls `coordinateJournalAppend()`.

- [ ] **Step 4: Extend client construction without replacing legacy mode**

When `submit()` receives verified assigned authority, construct v0.2 and retain pending/in-flight identity behavior. Existing v0.1 call construction remains available for old callers/tests.

- [ ] **Step 5: Route v0.2 and preserve v0.1**

The service worker sends v0.2 through the scoped adapter/coordinator. The existing exact `message?.schema === JOURNAL_APPEND_REQUEST_SCHEMA` branch remains and still uses `createChromeJournalAdapters(chrome)` plus the global legacy route.

`readAssignedWorkspaceReadonly(authority)` returns a cloned workspace only from verified passed authority; it performs no storage access. Preserve `readActiveWorkspaceReadonly()` unchanged for old callers.

- [ ] **Step 6: Run GREEN**

```powershell
node --test --test-isolation=none tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js
npm run test:journal-coordination
npm run test:runtime-contract
```

The v0.1 suite must retain its captured pass count and semantics.

---

### Task 6: Migrate metadata autosave/save/type while preserving the metadata barrier

**Files:**
- Modify: `src/core/workspace-runtime-store.js`
- Modify: `src/sidepanel/workspace-metadata-autosave.js`
- Modify: `src/sidepanel/sidepanel.js`
- Modify: `tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js`
- Regression unchanged: `tests/workspace-membership-mutation/workspace-membership-mutation.test.js`
- Preserve: `src/sidepanel/workspace-metadata-barrier.js`

**Interfaces:**

- Add one explicit assigned runtime read helper in `workspace-runtime-store.js` that accepts verified D3D-04 authority rather than reading the global active workspace. Archive/diagnostic APIs stay separate and unchanged.
- Autosave submits `workspace.metadata.autosave`.
- Save/type submits `workspace.metadata.commit` with mode `save` or `type_change`.

- [ ] **Step 1: Run existing metadata-barrier regression before editing**

The baseline repository has no dedicated metadata-barrier test file; its current behavior is covered inside `tests/workspace-membership-mutation/workspace-membership-mutation.test.js`. Run:

```powershell
npm run test:workspace-membership-mutation
```

Capture the pass count.

- [ ] **Step 2: Write RED D3D-05 barrier-integration tests**

Use the existing `createWorkspaceMetadataBarrier()` through `workspace-metadata-autosave.js` seams. Prove rapid snapshots still execute in latest-write order while each authoritative commit is a D3D-05 mutation command and no callback takes `LOCK_NAMES.runtimeState` or reads/writes compatibility peers.

- [ ] **Step 3: Implement assigned autosave**

Before each autosave commit, force fresh D3D-04 authority resolution. Require assigned/active state. Submit exactly:

```js
{
  mutationKind: "workspace.metadata.autosave",
  payload: { name: snapshot.name, aim: snapshot.aim }
}
```

After `committed`, `no_change`, or `replayed`, force another binding resolve before subsequent mutation so panel revision/workspace evidence is fresh.

- [ ] **Step 4: Replace assigned save/type adapters**

Keep the metadata barrier sequencing. On explicit Save, submit one `workspace.metadata.commit` with mode `save`; on workspace-type change, submit mode `type_change`. Include `name`, `aim`, `workspaceType`, and generated `eventId`. Do not call `saveWorkspaceDetailsAgainstLatest()` or `updateWorkspaceTypeAgainstLatest()` on the D3D-05 assigned path; keep those functions unchanged for legacy/regression coverage.

- [ ] **Step 5: Run GREEN plus existing metadata regression**

```powershell
node --test --test-isolation=none tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js
npm run test:workspace-membership-mutation
npm run test:runtime-workspace-activation
npm run test:characterization
```

The workspace-membership suite must retain its captured pass count.

- [ ] **Step 6: Static metadata authority scan**

```powershell
Select-String -Path src/sidepanel/workspace-metadata-autosave.js -Pattern 'LOCK_NAMES.runtimeState|readCompatibleStorageValue\("activeWorkspace"\)|writeCompatibleStorageValue\("activeWorkspace"\)'
```

Expected: no match in the migrated autosave module.

---

### Task 7: Migrate mapped direct side-panel writers and fail closed on legacy ID repair

**Files:**
- Modify: `src/sidepanel/sidepanel.js`
- Modify: `src/sidepanel/search-workspace-intake.js`
- Modify: `src/core/workspace-runtime-store.js`
- Modify: `tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js`

**Interfaces:**

Add one panel helper with this exact sequence:

```text
fresh D3D-04 resolve
require assigned authority
submit D3D-05 command
on verified success, fresh D3D-04 resolve
render only from refreshed assigned workspace
```

- [ ] **Step 1: Pin the exact D3D-05 writer migration list**

The D3D-05 task changes these ordinary paths:

```text
user journal submission               -> assigned journal v0.2
generic ordinary timeline append      -> timeline.append
workspace metadata autosave/save/type -> Task 6 mutations
tab alias update                      -> workspace.tab.metadata.commit
tab role update                       -> workspace.tab.metadata.commit
search-workspace-intake auto-add      -> search.intake.add
assigned startup missing tab ID       -> fail closed, zero write
```

Business transactions mapped to D3D-06 or later (membership/remove/projection, transfer/placement, browser lifecycle, resume/archive/recovery) retain their old-route transaction semantics in D3D-05 even when they emit legacy timeline evidence. Do not partially migrate those transactions here.

- [ ] **Step 2: Implement the assigned ordinary timeline helper**

Create each generic D3D-05 timeline record client-side with:

```js
{
  eventId: crypto.randomUUID(),
  type,
  message,
  createdAt: new Date().toISOString(),
  ...details
}
```

Submit as `{ mutationKind: "timeline.append", payload: { record } }`. Only replace timeline writes belonging to D3D-05 ordinary actions; later-slice transaction evidence stays with its existing route.

- [ ] **Step 3: Migrate alias and role atomically**

Replace `getWorkspace() -> edit -> saveWorkspace() -> addTimelineEvent()` with one `workspace.tab.metadata.commit` command. Alias uses trimmed value. Role sends the selected role value plus generated event ID. The coordinator performs tab update and timeline append under one revision.

- [ ] **Step 4: Migrate `search-workspace-intake.js`**

Resolve exact assigned authority and inspect only its assigned workspace snapshot for duplicate preflight. Submit one `search.intake.add` containing the created tab record, query, event ID and `sameUrlDuplicate`. Remove imports/calls to `workspace-store.js`, `getWorkspace`, `saveWorkspace`, and `addTimelineEvent` from this root.

- [ ] **Step 5: Replace assigned startup silent ID repair**

`migrateWorkspaceTabIds()` must not generate missing IDs then perform a whole-object global save for an assigned D3D-05 workspace. On assigned bootstrap, validate every tab has a non-empty `workspaceTabId`. On failure:

```text
state/status reason: runtime_workspace_identity_migration_required
mutation-sensitive controls: disabled
workspace writes: 0
compatibility writes: 0
scoped writes: 0
```

The old migration behavior may remain only behind explicitly old/legacy routes that D3D-05 does not invoke.

- [ ] **Step 6: Run GREEN and static source closure for the dedicated search writer**

```powershell
node --test --test-isolation=none tests/runtime-workspace-mutation/runtime-workspace-mutation.test.js
npm run test:journal-coordination
npm run test:runtime-workspace-activation
npm run test:workspace-membership-mutation
npm run test:characterization
Select-String -Path src/sidepanel/search-workspace-intake.js -Pattern 'workspace-store|saveWorkspace|getWorkspace|addTimelineEvent'
```

Expected search-intake scan: no match.

- [ ] **Step 7: Checkpoint without staging or commit**

```powershell
git diff --check
git status --short
```

---

### Task 8: Automated closure and D3D-05 evidence packet

**Files:**
- Create: `docs/validation/LAYER-2.3D-D3D-05-TYPED-RUNTIME-MUTATION-EVIDENCE.md`
- Production changes are allowed in this task only to correct a defect exposed by an already-authorized D3D-05 check; any scope expansion triggers the stop conditions below.

**Interfaces:**

The evidence document records exact observed commands/counts/hashes. It must state that no live Chrome validation occurred.

- [ ] **Step 1: Syntax-check every changed/new JS/MJS file**

```powershell
$changedJs = @(
    git diff --name-only --diff-filter=ACMRT HEAD -- '*.js' '*.mjs'
)
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
npm run test:workspace-membership-mutation
npm run test:runtime-workspace-activation
npm run test:characterization
npm run check:inventory
npm run check:runtime-contract-purity
```

- [ ] **Step 4: Run the full established aggregate**

```powershell
npm run check
```

The aggregate remains the established pre-D3D focused matrix until D3D-15. Record its observed count rather than assuming a count from the command label. The D3D-05 focused suite is run separately and must not be represented as part of `npm run check`.

- [ ] **Step 5: Run static architecture scans**

```powershell
Select-String -Path src/core/runtime-workspace-mutation/*.js -Pattern 'workspace-store|constellation-storage-compatibility|constellationActiveWorkspace|chromeFlowWorkspace|activeWorkspaceId|constellationRecentOperationLedger'
Select-String -Path src/core/runtime-workspace-mutation/*.js -Pattern 'constellation-runtime-state-v0.1|COMPATIBILITY_PROJECTION_LOCK'
git diff --check
```

Expected: no forbidden authority/import match in the new family and `git diff --check` exit 0.

- [ ] **Step 6: Write the evidence packet with observed facts**

Record:

```text
repository / branch / starting HEAD / upstream
exact changed + new path list
mutation-kind registry
command authority matrix
revision/replay/failure matrix
Alpha/Beta and same-Stella lock traces
pending-intent-before-business-write trace
terminal replay trace
v0.1 journal route preservation evidence
no new global/compatibility authority evidence
D3D-01..05 focused observed test counts
existing affected-suite observed test counts
inventory / purity / full-check / diff-check results
final git status
Push: not performed
Chrome: not operated
```

Do not pre-fill pass counts; write only what the executed commands observed.

- [ ] **Step 7: Return for Byte-Nolan source review without staging**

```powershell
git status --short
git diff --stat
git diff --name-status
git diff --check
```

Terminal execution state:

```text
READY FOR BYTE-NOLAN D3D-05 SOURCE REVIEW
```

Do not stage, commit, push, open a PR, merge, or operate Chrome.

## Implementation Stop Conditions

Stop immediately rather than widening scope when any of the following is observed:

1. A mapped writer cannot receive the complete current D3D-04 assignment tuple.
2. An ordinary mutation requires the global runtime-state lock.
3. The new route needs compatibility state to authorize or complete primary business.
4. A protected v0.1 schema or `src/core/workspace-store.js` would need semantic replacement.
5. A generic whole-workspace replacement becomes necessary.
6. A missing immutable tab identity can only be repaired by silent whole-object mutation.
7. Runtime-record and ledger operations cannot remain serialized under one exact workspace-content lock without lock re-entry.
8. Recovery cannot distinguish "record not written" from "record verified but terminal evidence missing" without risking overwrite of newer state.
9. A production writer that must migrate in D3D-05 is absent from the accepted map/design.
10. Any required correctness proof depends on live Chrome or real extension storage.
11. Any frozen architecture artifact, manifest/dependency/IndexedDB identity, or later-slice concern would need modification.

## Completion Boundary

D3D-05 is implementation-complete only after Byte-Nolan source review accepts the full diff and automated evidence. Even then, the branch remains **not safe to live-load or merge**. D3D-06 and later reader/integration closure must migrate the remaining multi-window surfaces before Operator/live validation is authorized.
