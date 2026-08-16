# D3D-06 Membership and Scoped Projection Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Layer 2.3D assigned/scoped membership mutation and projection reconciliation while preserving all published Layer 2.3C v0.1 behavior and avoiding global active-workspace authority for new D3D-06 primary business.

**Architecture:** D3D-06 adds strict v0.2 routes inside the existing membership and reconciliation families. New routes copy the complete D3D-04 assigned tuple, revalidate it in the service worker, operate on one `constellationRuntimeWorkspace:<workspaceId>` record and its workspace-local operation ledger, and use only the accepted per-Stella lock domains. Old membership and reconciliation routes remain terminally available and unchanged in meaning.

**Tech Stack:** JavaScript ES modules, Node.js 24 test runner, Chrome Manifest V3 APIs, Web Locks API, `chrome.storage.session`, `chrome.storage.local`, existing Layer 2.3D runtime contracts.

## Global Constraints

- Repository: `C:\Users\nolan\AIProjects\constellation`.
- Branch: `layer2-3d-concurrent-multi-stella-window-binding`.
- Design baseline before the D3D-06 documentation commits: `ff550e5a3b5bcbbe195ebe4922e9fc6d623c3594`.
- Approved design: `docs/superpowers/specs/2026-08-16-d3d-06-membership-scoped-projection-design.md`.
- New D3D-06 primary business must not use `constellation-runtime-state-v0.1`.
- New D3D-06 primary business must not use compatibility active-workspace peers for authority or completion.
- D3D-04 session authority remains the sole writable-window assignment authority.
- D3D-06 business state is one scoped runtime workspace record plus its workspace-local operation ledger.
- Different Stellas must be able to progress concurrently; same-Stella content/projection work must serialize.
- Browser IDs are evidence, never authority.
- Missing/ambiguous browser evidence must not delete durable membership.
- Existing membership v0.1 schemas, reconciliation v0.1 schemas, and canonical/legacy reconciliation event identities must retain their current meaning.
- D3D-06 must not implement D3D-10 transfer semantics.
- The remove-only product behavior must keep the live browser tab open.
- Do not modify package.json, CI, frozen Layer 2.3D architecture artifacts, or D3D-05 evidence unless an authorized validation check proves one is stale; stop for Byte-Nolan review instead.
- Do not operate Chrome during D3D-06 implementation or automated closure.
- Do not stage, commit, push, open a PR, or merge during individual tasks. The reviewed D3D-06 slice is committed only after Byte-Nolan source review and Nolan-local validation.
- Every task uses RED -> GREEN -> focused regression -> static/diff gate. A task is not accepted from self-report alone.

---

## File Structure and Responsibility Map

### Membership family

- `src/core/workspace-membership-mutation/contract.js` — preserve v0.1; add exact v0.2 command/result/receipt/pending schemas and validators.
- `src/core/workspace-membership-mutation/fingerprint.js` — preserve v0.1 fingerprint; add v0.2 assigned fingerprint excluding only retry-time evidence.
- `src/core/workspace-membership-mutation/coordinator.js` — preserve v0.1 coordinator; add scoped v0.2 coordinator and recovery state machine.
- `src/core/workspace-membership-mutation/chrome-adapter.js` — preserve v0.1 adapters; add scoped record/local-ledger/authority/browser adapters.
- `src/core/workspace-membership-mutation/client.js` — preserve v0.1 client; add assigned v0.2 client.
- `src/core/workspace-membership-mutation/service-worker-handler.js` — exact old/new route separation and authorized sender validation.
- `src/core/workspace-membership-mutation/promotion-trigger.js` — accept the new verified v0.2 add receipt without weakening v0.1 validation.
- `src/core/runtime-workspace-operation-ledger/contract.js` — add D3D-06 membership and projection command identities to the local-ledger registry.
- `src/sidepanel/workspace-membership-promotion-sequencer.js` — preserve old sequencer; add assigned sequencer that resolves fresh D3D-04 authority and releases membership locks before promotion.
- `src/sidepanel/sidepanel.js` — wire selected/active/search/recovery membership producers to assigned v0.2 and D3D-05 timeline append.
- `src/sidepanel/workspace-tab-remove-only-control.js` — replace whole-object global remove with fresh assigned v0.2 membership remove and scoped timeline append; browser tab remains open.
- `src/background/service-worker.js` — route v0.2 membership before v0.1 without malformed fallthrough.
- `tests/runtime-workspace-membership/runtime-workspace-membership.test.js` — new focused D3D-06 membership suite.

### Projection reconciliation family

- `src/core/workspace-projection-reconciliation/contract.js` — preserve v0.1; add exact assigned v0.2 command/result/pending validation.
- `src/core/workspace-projection-reconciliation/coordinator.js` — preserve v0.1; add scoped v0.2 coordinator, local-ledger recovery, and projection-lock semantics.
- `src/core/workspace-projection-reconciliation/chrome-adapter.js` — preserve v0.1; add scoped authority/record/ledger/browser adapters.
- `src/core/automatic-workspace-projection-reconciler.js` — retain old callable behavior where required; add assignment-keyed reconciliation execution.
- `src/core/workspace-projection-reconciliation/scheduler.js` — change scheduler API only if necessary to support independent per-workspace queues; otherwise wrap one scheduler instance per workspace in the automatic reconciler.
- `src/background/service-worker.js` — schedule reconciliation by active assignment and add terminal assigned v0.2 route.
- `tests/runtime-workspace-projection/runtime-workspace-projection.test.js` — new focused D3D-06 projection suite.

### Closure/evidence

- `docs/architecture/runtime-authority-inventory.json` — update only entries proven stale by D3D-06 migration.
- `docs/validation/LAYER-2.3D-D3D-06-MEMBERSHIP-SCOPED-PROJECTION-EVIDENCE.md` — automated/source evidence packet created only after implementation is stable.

---

## Task 1: Freeze the D3D-06 Local-Ledger and Membership v0.2 Contracts

**Files:**
- Modify: `src/core/runtime-workspace-operation-ledger/contract.js`
- Modify: `src/core/workspace-membership-mutation/contract.js`
- Modify: `src/core/workspace-membership-mutation/fingerprint.js`
- Create: `tests/runtime-workspace-membership/runtime-workspace-membership.test.js`

**Interfaces:**
- Consumes: existing `snapshotSerializable`, `stableStringify`, D3D-04 assigned tuple semantics, workspace-local ledger validation.
- Produces:
  - `WORKSPACE_OPERATION_COMMAND_SCHEMAS.membership_mutation = "constellation-runtime-workspace-membership-command-v0.1"`
  - `WORKSPACE_OPERATION_COMMAND_SCHEMAS.projection_reconciliation = "constellation-runtime-workspace-projection-command-v0.1"`
  - `MEMBERSHIP_ASSIGNED_REQUEST_SCHEMA = "constellation-workspace-membership-request-v0.2"`
  - `MEMBERSHIP_ASSIGNED_RESULT_SCHEMA = "constellation-workspace-membership-result-v0.2"`
  - `MEMBERSHIP_ASSIGNED_RECEIPT_SCHEMA = "constellation-workspace-membership-receipt-v0.2"`
  - `MEMBERSHIP_ASSIGNED_PENDING_SCHEMA = "constellation-workspace-membership-pending-v0.2"`
  - `snapshotAndValidateAssignedMembershipRequest(value)`
  - `createAssignedMembershipResult(identity, fields)`
  - `validateAssignedMembershipResult(value, expectedRequest?)`
  - `createAssignedMembershipReceipt(request, fields)`
  - `validateAssignedMembershipReceipt(value, expectedRequest?)`
  - `createAssignedMembershipPendingRecord(request, fingerprint, fields)`
  - `validateAssignedMembershipPendingRecord(value, expectedRequest?)`
  - `createAssignedMembershipRequestFingerprint(request)`

- [ ] **Step 1: Add RED tests for exact additive schemas and local-ledger registry**

Add tests proving v0.1 exports remain unchanged and the new registry is additive:

```js
assert.equal(MEMBERSHIP_REQUEST_SCHEMA, "constellation-workspace-membership-add-request-v0.1");
assert.equal(MEMBERSHIP_ASSIGNED_REQUEST_SCHEMA, "constellation-workspace-membership-request-v0.2");
assert.equal(
  WORKSPACE_OPERATION_COMMAND_SCHEMAS.membership_mutation,
  "constellation-runtime-workspace-membership-command-v0.1"
);
assert.equal(
  WORKSPACE_OPERATION_COMMAND_SCHEMAS.projection_reconciliation,
  "constellation-runtime-workspace-projection-command-v0.1"
);
```

Run:

```powershell
node --test --test-isolation=none tests/runtime-workspace-membership/runtime-workspace-membership.test.js
```

Expected: FAIL because the D3D-06 exports do not exist.

- [ ] **Step 2: Add RED exact-command validation tests**

Use this canonical add command shape:

```js
function assignedMembershipAdd(overrides = {}) {
  return {
    schema: MEMBERSHIP_ASSIGNED_REQUEST_SCHEMA,
    operationId: "membership-v2-op",
    runtimeSessionId: "runtime-session-1",
    sourceContextId: "context-1",
    sourceWindowId: 10,
    workspaceId: "workspace-1",
    expectedWorkspaceRevision: 5,
    runtimeAssignmentId: "assignment-1",
    assignmentEpoch: 2,
    mutationKind: "selected_tab_batch",
    requestedAt: "2026-08-16T07:00:00.000Z",
    payload: {
      operation: "add",
      workspaceTabs: [tab(4)],
      promotionOperationId: "promotion-1",
      nextRuntimeAssignmentId: "assignment-next-1"
    },
    ...overrides
  };
}
```

Use this canonical remove command shape:

```js
function assignedMembershipRemove(overrides = {}) {
  return assignedMembershipAdd({
    mutationKind: "remove_only",
    payload: {
      operation: "remove",
      workspaceTabId: "workspace-tab-2",
      reason: "No longer relevant."
    },
    ...overrides
  });
}
```

Tests must reject every missing assigned-authority field, unknown top-level field, cyclic payload, non-positive assignment epoch, invalid window/revision, invalid add payload, invalid remove payload, add payload without promotion identities, and remove payload that contains promotion identities.

Expected RED: validator/export absent.

- [ ] **Step 3: Implement the exact additive command and result contracts**

Top-level v0.2 request fields are exactly:

```js
[
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
  "requestedAt",
  "payload"
]
```

Allowed provenance kinds are the existing four add origins plus `remove_only`:

```js
[
  "selected_tab_batch",
  "active_tab",
  "search_tab",
  "recovery_readd",
  "remove_only"
]
```

Add payload fields are exactly:

```js
["operation", "workspaceTabs", "promotionOperationId", "nextRuntimeAssignmentId"]
```

Remove payload fields are exactly:

```js
["operation", "workspaceTabId", "reason"]
```

Do not change the existing v0.1 request/result/receipt/pending constants or validators.

- [ ] **Step 4: Implement the assigned receipt/result/pending contracts**

The assigned receipt must carry exact assignment identity plus mutation evidence:

```js
{
  receiptSchema,
  operationId,
  operation,
  mutationKind,
  runtimeSessionId,
  sourceContextId,
  sourceWindowId,
  workspaceId,
  runtimeAssignmentId,
  assignmentEpoch,
  workspaceRevisionBefore,
  workspaceRevisionAfter,
  previousEligibleTabCount,
  currentEligibleTabCount,
  addedWorkspaceTabIds,
  addedBrowserTabIds,
  removedWorkspaceTabIds,
  removedBrowserTabIds,
  membershipWritten,
  workspaceVerified,
  requestedAt
}
```

The result must contain:

```js
{
  schema,
  status,
  reason,
  operationId,
  requestFingerprint,
  operation,
  mutationKind,
  runtimeSessionId,
  sourceContextId,
  sourceWindowId,
  workspaceId,
  expectedWorkspaceRevision,
  runtimeAssignmentId,
  assignmentEpoch,
  workspaceRevisionBefore,
  workspaceRevisionAfter,
  membershipWritten,
  workspaceVerified,
  ledgerRecorded,
  replayed,
  retrySafe,
  indeterminate,
  receipt,
  warnings,
  errors
}
```

Success is only `committed`, `replayed`, or `no_change`, and success requires `workspaceVerified === true` plus a valid matching receipt.

- [ ] **Step 5: Implement the fingerprint rule**

The v0.2 fingerprint includes schema, operation ID-independent business authority, assignment tuple, provenance kind, and payload, but excludes `requestedAt` only:

```js
export function createAssignedMembershipRequestFingerprint(request) {
  return "membership-v2:" + fingerprintValue({
    schema: request.schema,
    runtimeSessionId: request.runtimeSessionId,
    sourceContextId: request.sourceContextId,
    sourceWindowId: request.sourceWindowId,
    workspaceId: request.workspaceId,
    expectedWorkspaceRevision: request.expectedWorkspaceRevision,
    runtimeAssignmentId: request.runtimeAssignmentId,
    assignmentEpoch: request.assignmentEpoch,
    mutationKind: request.mutationKind,
    payload: request.payload
  });
}
```

Keep the existing v0.1 fingerprint untouched.

- [ ] **Step 6: Run GREEN and existing contract regressions**

```powershell
node --test --test-isolation=none tests/runtime-workspace-membership/runtime-workspace-membership.test.js
npm run test:workspace-membership-mutation
node --test --test-isolation=none tests/runtime-workspace-operation-ledger/*.test.js
node --check src/core/workspace-membership-mutation/contract.js
node --check src/core/workspace-membership-mutation/fingerprint.js
git diff --check
```

Expected: all PASS; v0.1 suite unchanged.

**Checkpoint:** stop for Byte source review if any v0.1 schema/result meaning changes or the local-ledger registry cannot be extended additively.

---

## Task 2: Implement Scoped Membership v0.2 Coordinator and Chrome Adapters

**Files:**
- Modify: `src/core/workspace-membership-mutation/coordinator.js`
- Modify: `src/core/workspace-membership-mutation/chrome-adapter.js`
- Test: `tests/runtime-workspace-membership/runtime-workspace-membership.test.js`

**Interfaces:**
- Consumes: Task 1 v0.2 contract/fingerprint; D3D-03 `buildScopedLockPlan`; D3D-04 session authority; D3D-01 scoped runtime record; D3D-02 local ledger.
- Produces:
  - `coordinateAssignedWorkspaceMembershipMutation(request, adapters)`
  - `createAssignedWorkspaceMembershipChromeAdapters(chromeApi, input = {})`

The assigned adapter interface is exactly:

```js
{
  withScopedLocks(plan, callback),
  readAuthority(),
  readRuntimeWorkspaceRecord(workspaceId),
  writeRuntimeWorkspaceRecord(workspaceId, record),
  readWorkspaceOperationLedger(workspaceId),
  writeWorkspaceOperationLedger(workspaceId, ledger),
  queryBrowserTabs(),
  getWindow(windowId),
  now()
}
```

- [ ] **Step 1: RED lock-plan and authority tests**

Assert add and remove use only:

```js
buildScopedLockPlan({
  windowIds: [request.sourceWindowId],
  workspaceBindingIds: [request.workspaceId],
  workspaceContentIds: [request.workspaceId]
});
```

Assert no lock name equals `LOCK_NAMES.runtimeState` and no compatibility projection lock appears.

Add authority cases for wrong runtime session, context, window, workspace, assignment ID, epoch, released assignment, and stale scoped revision. All must perform zero record writes.

- [ ] **Step 2: RED add/no-change/remove semantic tests**

Cover:

```js
assert.equal((await coordinateAssignedWorkspaceMembershipMutation(add, adapters)).status, "committed");
assert.equal(record.workspaceRevision, 6);
assert.equal(record.tabs.length, 4);

assert.equal((await coordinateAssignedWorkspaceMembershipMutation(exactExisting, adapters)).status, "no_change");
assert.equal(recordWrites, 0);

assert.equal((await coordinateAssignedWorkspaceMembershipMutation(remove, adapters)).status, "committed");
assert.equal(record.tabs.some((tab) => tab.workspaceTabId === "workspace-tab-2"), false);
assert.equal(browserCloseCalls, 0);
```

Remove must not require a browser-projection lock and must not call a browser close/remove API.

- [ ] **Step 3: RED browser-liveness and prewrite drift tests for add**

The requested add tab must be present in a fresh `queryBrowserTabs()` observation. Query once for planning and again immediately before the scoped write. If the requested browser tab disappears between those reads, return `indeterminate` or a conflict according to whether immutable pending evidence has already been written; in either case perform zero scoped workspace writes.

- [ ] **Step 4: RED immutable-intent, replay, and recovery tests**

Prove:

- immutable local-ledger intent is written and verified before workspace mutation;
- exact terminal retry returns `replayed` with no second workspace write;
- same operation ID with changed fingerprint returns conflict;
- failed workspace write leaves recoverable pending evidence;
- retry can complete from the exact original state;
- verified workspace commit plus terminal-ledger failure returns `indeterminate` and does not roll back;
- mismatched recovery evidence fails closed.

The local-ledger operation intent uses:

```js
{
  operationKind: "membership_mutation",
  commandSchema: WORKSPACE_OPERATION_COMMAND_SCHEMAS.membership_mutation,
  primaryWorkspaceId: request.workspaceId,
  affectedWorkspaceIds: [request.workspaceId],
  sourceWindowId: request.sourceWindowId,
  targetWindowId: null,
  expectedRuntimeSessionId: request.runtimeSessionId,
  expectedAssignmentId: request.runtimeAssignmentId,
  expectedAssignmentEpoch: request.assignmentEpoch,
  expectedWorkspaceRevisions: { [request.workspaceId]: request.expectedWorkspaceRevision },
  durableSourceIdentity: null,
  durableSnapshotDigest: null,
  browserPlanDigest: addBrowserDigestOrNull,
  projectionBaselineDigest: null,
  compatibilityPreflightFingerprints: { canonical: null, legacy: null },
  completedPhasesAtIntentWrite: [],
  nextRecoverablePhaseAtIntentWrite: "workspace_mutation",
  plannedArtifactIds: []
}
```

- [ ] **Step 5: Implement the scoped coordinator minimally to satisfy the tests**

Reuse established D3D-05 patterns for:

- exact assignment revalidation under scoped locks;
- scoped runtime-record validation/fingerprinting;
- local-ledger inspection;
- immutable intent write/readback;
- semantic reducer use;
- candidate-progress evidence;
- verified record write;
- terminal replay/recovery.

Do not call v0.1 `readCompatibleWorkspace`, `writeCompatibleWorkspace`, shared `OPERATION_LEDGER_KEY`, or `withRuntimeStateLock` from the new coordinator branch.

- [ ] **Step 6: Implement scoped Chrome adapters**

Use the same key derivations as D3D-05:

```js
deriveRuntimeWorkspaceKey(workspaceId)
deriveWorkspaceOperationLedgerKey(workspaceId)
```

The adapter must validate the complete D3D-04 assignment from `RUNTIME_SESSION_AUTHORITY_KEY`, corroborate `sourceWindowId` with `chrome.windows.get`, and expose raw browser tabs only as observation evidence.

- [ ] **Step 7: GREEN, concurrency, and regressions**

Add two fixtures proving Alpha and Beta membership critical sections overlap under disjoint lock names, while two same-workspace operations serialize and the stale revision loses without a second write.

Run:

```powershell
node --test --test-isolation=none tests/runtime-workspace-membership/runtime-workspace-membership.test.js
npm run test:workspace-membership-mutation
node --test --test-isolation=none tests/runtime-workspace-mutation/*.test.js
node --test --test-isolation=none tests/runtime-scoped-locks/*.test.js
node --test --test-isolation=none tests/runtime-workspace-operation-ledger/*.test.js
node --check src/core/workspace-membership-mutation/coordinator.js
node --check src/core/workspace-membership-mutation/chrome-adapter.js
git diff --check
```

**Checkpoint:** membership v0.2 service core accepted before any side-panel producer migration.

---

## Task 3: Add Assigned Membership Client and Exact Service-Worker Routing

**Files:**
- Modify: `src/core/workspace-membership-mutation/client.js`
- Modify: `src/core/workspace-membership-mutation/service-worker-handler.js`
- Modify: `src/background/service-worker.js`
- Test: `tests/runtime-workspace-membership/runtime-workspace-membership.test.js`

**Interfaces:**
- Produces:
  - `createAssignedWorkspaceMembershipClient({ createId, now, send })`
  - `classifyAssignedWorkspaceMembershipMessage(message)`
  - `isAssignedWorkspaceMembershipMessage(message)`
  - `handleAssignedWorkspaceMembershipMessage(message, sender, sendResponse, options = {})`

- [ ] **Step 1: RED assigned-client tests**

The client input is:

```js
{
  authority,
  mutationKind,
  payload,
  operationId: optionalStableRetryId
}
```

It copies, never fabricates, these authority fields:

```js
runtimeSessionId
sourceContextId
sourceWindowId
workspaceId
workspaceRevision -> expectedWorkspaceRevision
runtimeAssignmentId
assignmentEpoch
```

It may generate `operationId` only when the caller did not provide one, and it generates `requestedAt` from `now()`.

Reject malformed/non-writable authority before transport.

- [ ] **Step 2: Implement assigned client while preserving v0.1 client**

Keep `createWorkspaceMembershipClient` unchanged in external behavior. Add the assigned client as a separate export.

- [ ] **Step 3: RED handler classification tests**

Prove:

- malformed v0.2 with the v0.2 schema is terminally classified as assigned membership and cannot fall through;
- v0.1 still classifies through the old handler;
- unrelated messages classify as neither;
- unauthorized sender causes zero adapter/coordinator calls;
- malformed command causes zero business adapter calls;
- valid command creates assigned adapters and calls `coordinateAssignedWorkspaceMembershipMutation` exactly once.

- [ ] **Step 4: Implement exact additive handler and route order**

In `service-worker.js`, route order around membership becomes:

```js
const assignedMembershipClassification = classifyAssignedWorkspaceMembershipMessage(message);
if (assignedMembershipClassification.isMembership) {
  return handleAssignedWorkspaceMembershipMessage(...);
}
const membershipClassification = classifyWorkspaceMembershipMessage(message);
if (membershipClassification.isMembership) {
  return handleWorkspaceMembershipMessage(...);
}
```

The new route must precede v0.1. Existing D3D-05 ordinary mutation and journal routes remain intact.

- [ ] **Step 5: GREEN and routing regressions**

```powershell
node --test --test-isolation=none tests/runtime-workspace-membership/runtime-workspace-membership.test.js
npm run test:workspace-membership-mutation
node --test --test-isolation=none tests/runtime-workspace-mutation/*.test.js
npm run test:journal-coordination
node --check src/core/workspace-membership-mutation/client.js
node --check src/core/workspace-membership-mutation/service-worker-handler.js
node --check src/background/service-worker.js
git diff --check
```

**Checkpoint:** assigned membership route is available but production side-panel callers are not yet migrated.

---

## Task 4: Migrate Production Membership Producers and Remove-Only Control

**Files:**
- Modify: `src/core/workspace-membership-mutation/promotion-trigger.js`
- Modify: `src/sidepanel/workspace-membership-promotion-sequencer.js`
- Modify: `src/sidepanel/sidepanel.js`
- Modify: `src/sidepanel/workspace-tab-remove-only-control.js`
- Test: `tests/runtime-workspace-membership/runtime-workspace-membership.test.js`
- Characterization: `tests/workspace-membership-mutation/*.test.js`

**Interfaces:**
- Produces:
  - `createAssignedWorkspaceMembershipPromotionSequencer(...)`
  - assigned remove-only request production using the existing D3D-04 authority singleton and D3D-05 `appendTimeline` gateway.

- [ ] **Step 1: RED sequencer tests for fresh assigned authority**

The new sequencer constructor is:

```js
createAssignedWorkspaceMembershipPromotionSequencer({
  createId,
  now,
  resolveAssignedAuthority,
  sendMembership,
  sendPromotion,
  appendTimeline,
  onPromotionStarting
})
```

For each sequence:

1. call `resolveAssignedAuthority()` immediately before membership;
2. submit assigned v0.2 membership with that exact authority;
3. require verified v0.2 success;
4. run any post-membership timeline append through `appendTimeline(...)`, which itself refreshes assigned authority;
5. evaluate promotion only for verified add receipts;
6. call promotion only after membership coordination has returned.

No `bootstrapExisting()` call is authority for the new membership route.

- [ ] **Step 2: Update promotion trigger additively**

Keep v0.1 receipt/result validation. Add a v0.2 branch that requires:

```js
["committed", "replayed", "no_change"].includes(result.status)
result.workspaceVerified === true
receipt.workspaceVerified === true
receipt.operation === "add"
receipt.currentEligibleTabCount > receipt.previousEligibleTabCount
```

Create the existing promotion request from the verified v0.2 receipt plus the add payload's retained `promotionOperationId` and `nextRuntimeAssignmentId`.

Remove receipts must always return `no_promotion`.

- [ ] **Step 3: RED sidepanel production-route static/behavior tests**

Prove selected-tab, active-tab, search-tab, and recovery re-add use the assigned sequencer. Their post-membership event writers must call `assignedOrdinaryMutationGateway.appendTimeline(...)`, not `addTimelineEvent(...)`.

Do not migrate later membership/projection/browser lifecycle operations outside the D3D-06 map.

- [ ] **Step 4: Wire sidepanel membership producers**

Instantiate the assigned sequencer with:

```js
resolveAssignedAuthority: () => assignedWorkspaceAuthority.resolve(),
sendMembership: (request) => chrome.runtime.sendMessage(request),
sendPromotion: (request) => chrome.runtime.sendMessage(request),
appendTimeline: (type, message, details) =>
  assignedOrdinaryMutationGateway.appendTimeline(type, message, details)
```

Preserve existing user-facing status text unless authority semantics require a precise correction.

- [ ] **Step 5: RED remove-only behavior test**

The remove-only control must prove this sequence:

```js
const authorityState = await assignedWorkspaceAuthority.resolve();
// locate tab only in authorityState.authority.workspace
// confirm + prompt
const result = await assignedMembershipClient.submit({
  authority: authorityState.authority,
  mutationKind: "remove_only",
  payload: { operation: "remove", workspaceTabId, reason }
});
// verified success only
await assignedOrdinaryMutationGateway.appendTimeline(...);
```

Static assertions must prove no imports or calls to `getWorkspace`, `saveWorkspace`, or legacy `addTimelineEvent` remain in `workspace-tab-remove-only-control.js`.

- [ ] **Step 6: Implement remove-only migration**

Keep confirmation/prompt semantics and `browserTabClosed: false`, `browserTabKeptOpen: true` event evidence. Do not call `chrome.tabs.remove` or any browser placement mutation.

- [ ] **Step 7: GREEN and membership sub-slice gate**

```powershell
node --test --test-isolation=none tests/runtime-workspace-membership/runtime-workspace-membership.test.js
npm run test:workspace-membership-mutation
npm run test:workspace-automatic-promotion-transaction
npm run test:workspace-automatic-promotion-integration
node --test --test-isolation=none tests/runtime-workspace-mutation/*.test.js
node --check src/core/workspace-membership-mutation/promotion-trigger.js
node --check src/sidepanel/workspace-membership-promotion-sequencer.js
node --check src/sidepanel/sidepanel.js
node --check src/sidepanel/workspace-tab-remove-only-control.js
git diff --check
```

Static scans:

```powershell
Select-String -Path src/core/workspace-membership-mutation/*.js -Pattern 'constellation-runtime-state-v0\.1|readCompatibleWorkspace|writeCompatibleWorkspace|OPERATION_LEDGER_KEY' | Format-Table
Select-String -Path src/sidepanel/workspace-tab-remove-only-control.js -Pattern 'getWorkspace|saveWorkspace|addTimelineEvent|chrome\.tabs\.remove' | Format-Table
```

Interpretation: v0.1 files may still contain compatibility/global references; the review must verify no v0.2 function path uses them. Remove-only scan must return zero business-route matches.

**Checkpoint:** Byte source review of the complete membership sub-slice before projection work.

---

## Task 5: Freeze Projection Reconciliation v0.2 Contract and Result Semantics

**Files:**
- Modify: `src/core/workspace-projection-reconciliation/contract.js`
- Create: `tests/runtime-workspace-projection/runtime-workspace-projection.test.js`

**Interfaces:**
- Produces:
  - `RECONCILIATION_ASSIGNED_REQUEST_SCHEMA = "constellation-workspace-projection-reconcile-v0.2"`
  - `RECONCILIATION_ASSIGNED_RESULT_SCHEMA = "constellation-workspace-projection-reconcile-result-v0.2"`
  - `RECONCILIATION_ASSIGNED_PENDING_SCHEMA = "constellation-workspace-projection-reconciliation-pending-v0.2"`
  - `snapshotAndValidateAssignedReconciliationRequest(value)`
  - `createAssignedReconciliationResult(identity, fields)`
  - `validateAssignedReconciliationResult(value, expectedRequest?)`
  - `createAssignedReconciliationPendingRecord(request, fingerprint, fields)`
  - `validateAssignedReconciliationPendingRecord(value, expectedRequest?)`
  - `assignedReconciliationFingerprint(request)`

- [ ] **Step 1: RED exact assigned reconciliation command tests**

Canonical command:

```js
{
  schema: RECONCILIATION_ASSIGNED_REQUEST_SCHEMA,
  operationId: "reconcile-v2-op",
  runtimeSessionId: "runtime-session-1",
  sourceContextId: "context-1",
  sourceWindowId: 10,
  workspaceId: "workspace-1",
  expectedWorkspaceRevision: 5,
  runtimeAssignmentId: "assignment-1",
  assignmentEpoch: 2,
  requestedAt: "2026-08-16T07:00:00.000Z",
  triggers: ["tab_updated"],
  payload: {
    schema: "constellation-workspace-projection-reconcile-v0.1",
    operationId: "reconcile-v2-op",
    snapshot: {
      workspaceId: "workspace-1",
      observedWorkspaceRevision: 5,
      capturedAt: "2026-08-16T07:00:00.100Z",
      workspaceTabIds: ["workspace-tab-1"]
    },
    patches: [/* existing planner patch */],
    triggers: ["tab_updated"],
    reconciledAt: "2026-08-16T07:00:00.200Z"
  }
}
```

The outer command adds D3D-04 authority; the inner semantic payload deliberately retains the existing v0.1 reducer payload schema because that payload is domain data, not the service-worker command schema.

Reject unknown outer fields, missing authority identity, mismatched workspace/revision/triggers, cyclic payload, and non-canonical trigger order.

- [ ] **Step 2: RED result and fingerprint tests**

The assigned result must include assignment identity, revision before/after, workspace commit/verification, ledger recording, replay/retry/indeterminate, projection counts/transitions, warnings/errors.

Fingerprint excludes only `requestedAt`; it includes the exact authority tuple, triggers, and payload.

- [ ] **Step 3: Implement additive contract only**

Do not change `RECONCILIATION_REQUEST_SCHEMA`, `RECONCILIATION_RESULT_SCHEMA`, v0.1 result statuses, hold schema, or canonical/legacy event identities.

- [ ] **Step 4: GREEN and v0.1 characterization**

```powershell
node --test --test-isolation=none tests/runtime-workspace-projection/runtime-workspace-projection.test.js
npm run test:reconciliation-coordination
node --check src/core/workspace-projection-reconciliation/contract.js
git diff --check
```

**Checkpoint:** contract-only projection surface accepted before coordinator work.

---

## Task 6: Implement Scoped Projection Coordinator and Chrome Adapters

**Files:**
- Modify: `src/core/workspace-projection-reconciliation/coordinator.js`
- Modify: `src/core/workspace-projection-reconciliation/chrome-adapter.js`
- Test: `tests/runtime-workspace-projection/runtime-workspace-projection.test.js`

**Interfaces:**
- Produces:
  - `coordinateAssignedWorkspaceProjectionReconciliation(request, adapters)`
  - `createAssignedChromeReconciliationAdapters(chromeApi, input = {})`

Assigned adapters:

```js
{
  withScopedLocks(plan, callback),
  readAuthority(),
  readRuntimeWorkspaceRecord(workspaceId),
  writeRuntimeWorkspaceRecord(workspaceId, record),
  readWorkspaceOperationLedger(workspaceId),
  writeWorkspaceOperationLedger(workspaceId, ledger),
  queryTabs(),
  getWindow(windowId),
  now(),
  appendDiagnostic(diagnostic),
  sendNotification(summary)
}
```

- [ ] **Step 1: RED exact projection lock-plan tests**

Assert the new coordinator acquires exactly:

```js
buildScopedLockPlan({
  windowIds: [request.sourceWindowId],
  workspaceBindingIds: [request.workspaceId],
  workspaceContentIds: [request.workspaceId],
  browserProjectionIds: [request.workspaceId]
});
```

The plan order must be window -> binding -> content -> projection. No runtime-state lock and no compatibility projection lock.

- [ ] **Step 2: RED fresh-assignment and revision tests**

Every authority mismatch or scoped revision mismatch returns explicit conflict/retry evidence with zero workspace writes.

- [ ] **Step 3: RED conservative browser-revalidation tests**

Use existing planner semantics to cover:

- exact tab-ID match;
- single URL fallback;
- same URL in two browser windows => ambiguous, no guessed identity;
- no candidate => mark projection missing but retain durable workspace tab;
- tab movement between captured plan and protected revalidation => reject/replan instead of applying stale plan;
- membership set changed since captured snapshot => conflict;
- assignment changed during reconciliation => conflict.

The coordinator must rebuild or verify browser evidence under the projection lock before the scoped record write. It must never remove a workspace-tab record because Chrome evidence is missing.

- [ ] **Step 4: RED immutable intent/replay/recovery tests**

Local-ledger intent uses:

```js
{
  operationKind: "projection_reconciliation",
  commandSchema: WORKSPACE_OPERATION_COMMAND_SCHEMAS.projection_reconciliation,
  primaryWorkspaceId: request.workspaceId,
  affectedWorkspaceIds: [request.workspaceId],
  sourceWindowId: request.sourceWindowId,
  targetWindowId: null,
  expectedRuntimeSessionId: request.runtimeSessionId,
  expectedAssignmentId: request.runtimeAssignmentId,
  expectedAssignmentEpoch: request.assignmentEpoch,
  expectedWorkspaceRevisions: { [request.workspaceId]: request.expectedWorkspaceRevision },
  durableSourceIdentity: null,
  durableSnapshotDigest: null,
  browserPlanDigest: assignedReconciliationFingerprintOrPlanDigest,
  projectionBaselineDigest: scopedRecordFingerprintBefore,
  compatibilityPreflightFingerprints: { canonical: null, legacy: null },
  completedPhasesAtIntentWrite: [],
  nextRecoverablePhaseAtIntentWrite: "projection_mutation",
  plannedArtifactIds: []
}
```

Prove terminal replay, fingerprint conflict, recoverable failed write, post-commit terminal-ledger indeterminate, and mismatched recovery evidence refusal.

- [ ] **Step 5: Implement coordinator using existing semantic reducer**

The business reduction remains:

```js
applyDomainMutation(record, "workspace.projection.reconcile", request.payload)
```

or the existing mutation-engine equivalent, but assignment/revision checks and local-ledger ownership belong to the new D3D-06 coordinator.

Do not route reconciliation through D3D-05 ordinary mutation kinds.

- [ ] **Step 6: Implement scoped Chrome adapters**

The v0.2 adapter reads only session authority, exact scoped record/local ledger, and Chrome browser evidence for primary business. Compatibility writes remain solely in the v0.1 adapter.

- [ ] **Step 7: RED/GREEN concurrency tests**

Prove Alpha/Beta reconciliations can overlap while holding distinct content/projection locks. Prove same-Stella reconciliation serializes, and membership vs reconciliation for the same Stella cannot interleave across the content lock.

Run:

```powershell
node --test --test-isolation=none tests/runtime-workspace-projection/runtime-workspace-projection.test.js
npm run test:reconciliation-coordination
node --test --test-isolation=none tests/runtime-workspace-membership/runtime-workspace-membership.test.js
node --test --test-isolation=none tests/runtime-scoped-locks/*.test.js
node --test --test-isolation=none tests/runtime-workspace-operation-ledger/*.test.js
node --check src/core/workspace-projection-reconciliation/coordinator.js
node --check src/core/workspace-projection-reconciliation/chrome-adapter.js
git diff --check
```

**Checkpoint:** scoped reconciliation core accepted before scheduler migration.

---

## Task 7: Make Automatic Reconciliation Assignment-Keyed and Per-Stella

**Files:**
- Modify: `src/core/automatic-workspace-projection-reconciler.js`
- Modify only if required by the chosen wrapper shape: `src/core/workspace-projection-reconciliation/scheduler.js`
- Modify: `src/background/service-worker.js`
- Test: `tests/runtime-workspace-projection/runtime-workspace-projection.test.js`
- Characterization: `tests/workspace-projection-reconciliation/*.test.js`

**Interfaces:**
- Produces:
  - `scheduleWorkspaceProjectionReconciliationForAssignment(assignment, trigger = "unspecified", details = {})`
  - `scheduleWorkspaceProjectionReconciliationForActiveAssignments(trigger = "unspecified", details = {})`
  - assignment-keyed debouncing keyed by `workspaceId`.

- [ ] **Step 1: RED scheduler isolation tests**

Prove:

- two triggers for Alpha coalesce into one Alpha execution;
- two triggers for Beta coalesce into one Beta execution;
- Alpha and Beta can execute concurrently;
- new Alpha trigger while Alpha is executing queues one follow-up Alpha execution;
- process-local scheduler disposal/restart loses debounce state but cannot fabricate authority.

Prefer a map of existing scheduler instances:

```js
const schedulersByWorkspaceId = new Map();
```

rather than rewriting the generic scheduler unless tests prove the generic scheduler must change.

- [ ] **Step 2: RED assigned execution tests**

`executeScheduledReconciliation({ assignmentHint, triggers })` must freshly resolve D3D-04 authority at execution time. A stale assignment hint causes a no-op/conflict outcome, never mutation.

Build the reconciliation plan from the freshly assigned scoped workspace plus fresh browser tabs, then submit one v0.2 reconciliation command.

- [ ] **Step 3: Implement assignment-keyed scheduler wrapper**

Keep scheduler memory advisory. Do not store it as authority. Do not write runtime state from scheduling code.

- [ ] **Step 4: Migrate Chrome event scheduling**

For global events (`onInstalled`, `onStartup`, non-window-specific group events), enumerate current active assignments from runtime session authority and schedule each assignment.

For events with a trustworthy `windowId`, resolve the assignment for that window and schedule only that workspace. If resolution is uncertain, fail closed or fall back to enumerating current active assignments; never guess by compatibility active workspace.

Window-close order remains:

1. coordinate trusted window authority cleanup;
2. re-read current assignments;
3. schedule remaining affected assignments.

- [ ] **Step 5: Preserve canonical/legacy event trigger compatibility**

The existing `EVENT_IDENTITIES.reconcileWorkspaceProjection` canonical and legacy message types still return the same accepted acknowledgement shape. Their scheduling target changes from one global workspace to current active assignments only.

- [ ] **Step 6: GREEN and static scans**

```powershell
node --test --test-isolation=none tests/runtime-workspace-projection/runtime-workspace-projection.test.js
npm run test:reconciliation-coordination
npm run test:runtime-session-authority
node --check src/core/automatic-workspace-projection-reconciler.js
node --check src/background/service-worker.js
git diff --check
```

Static review must prove the new assigned scheduling path does not call `readCompatibleStorageValue("activeWorkspace")`.

**Checkpoint:** scheduler migration accepted before final route/effect integration.

---

## Task 8: Add Terminal Assigned Reconciliation Routing and Effect Policy Integration

**Files:**
- Modify: `src/background/service-worker.js`
- Modify: `src/core/workspace-projection-reconciliation/coordinator.js`
- Modify: `src/core/workspace-projection-reconciliation/contract.js`
- Test: `tests/runtime-workspace-projection/runtime-workspace-projection.test.js`

**Interfaces:**
- Produces an exact assigned reconciliation classifier/handler, either as named exports in the existing family or a minimal new handler module only if source review proves mixing route code into existing files would make the boundary unclear. A new production path outside the approved design surface requires Byte-Nolan stop/approval before creation.

- [ ] **Step 1: RED exact old/new routing tests**

Prove message order:

1. D3D-04 window binding;
2. placement/activation routes;
3. membership v0.2 then membership v0.1;
4. existing promotion/context routes;
5. D3D-05 ordinary mutation;
6. assigned journal v0.2 then journal v0.1;
7. assigned reconciliation v0.2 terminal route;
8. canonical/legacy reconciliation trigger messages.

A malformed message that declares `RECONCILIATION_ASSIGNED_REQUEST_SCHEMA` must return an assigned reconciliation invalid/rejected result and must not fall through to canonical/legacy trigger handling.

- [ ] **Step 2: RED effect-policy tests**

Diagnostics and notifications remain post-primary and non-authoritative. Failure to append a diagnostic or send a notification must not change a verified reconciliation result.

- [ ] **Step 3: Implement exact route and post-primary effects**

The handler validates same-extension exact side-panel sender only where the request is side-panel-originated. Browser-event scheduled reconciliation is invoked internally, not by pretending a browser event is a side-panel sender.

- [ ] **Step 4: GREEN full D3D-06 focused suites**

```powershell
node --test --test-isolation=none tests/runtime-workspace-membership/runtime-workspace-membership.test.js
node --test --test-isolation=none tests/runtime-workspace-projection/runtime-workspace-projection.test.js
npm run test:workspace-membership-mutation
npm run test:reconciliation-coordination
npm run test:runtime-workspace-activation
npm run test:workspace-automatic-promotion-transaction
npm run test:workspace-automatic-promotion-integration
npm run test:journal-coordination
node --check src/background/service-worker.js
git diff --check
```

**Checkpoint:** complete D3D-06 production route exists; no evidence packet yet.

---

## Task 9: D3D-06 Automated Closure, Inventory Synchronization, and Evidence Packet

**Files:**
- Modify only if stale evidence is proven: `docs/architecture/runtime-authority-inventory.json`
- Create: `docs/validation/LAYER-2.3D-D3D-06-MEMBERSHIP-SCOPED-PROJECTION-EVIDENCE.md`
- No production source changes unless a closure check exposes an exact defect; if so, stop and open a numbered repair task before modifying source.

**Interfaces:**
- Produces the source/automated acceptance packet required for Byte-Nolan final review.

- [ ] **Step 1: Authenticate repository and changed surface**

Record:

```powershell
git branch --show-current
git rev-parse HEAD
git rev-parse '@{u}'
git status --short
git diff --name-only
git diff --stat
```

Stop on unexpected branch, staged paths, unrelated dirty files, or source outside the approved D3D-06 surface.

- [ ] **Step 2: Run syntax over every changed/new JS file**

Use the exact changed/new JS list from Git, not a hand-maintained subset:

```powershell
$js = @(
  git status --porcelain | ForEach-Object {
    $path = $_.Substring(3)
    if ($path -match '\.js$') { $path }
  }
)
foreach ($path in $js) {
  node --check $path
  if ($LASTEXITCODE -ne 0) { throw "Syntax failed: $path" }
}
```

- [ ] **Step 3: Run focused D3D-01 through D3D-06 suites**

Run all focused Layer 2.3D suites that exist in the checkout, including:

```powershell
node --test --test-isolation=none tests/runtime-workspace-record/*.test.js
node --test --test-isolation=none tests/runtime-workspace-operation-ledger/*.test.js
node --test --test-isolation=none tests/runtime-scoped-locks/*.test.js
node --test --test-isolation=none tests/runtime-window-binding/*.test.js
node --test --test-isolation=none tests/runtime-workspace-mutation/*.test.js
node --test --test-isolation=none tests/runtime-workspace-membership/*.test.js
node --test --test-isolation=none tests/runtime-workspace-projection/*.test.js
```

If a listed directory is named differently in the repository, use the exact existing D3D focused path discovered from Git rather than skipping the coverage class.

- [ ] **Step 4: Run established affected regressions**

```powershell
npm run test:workspace-membership-mutation
npm run test:reconciliation-coordination
npm run test:runtime-contract
npm run test:runtime-session-authority
npm run test:journal-coordination
npm run test:workspace-automatic-promotion-transaction
npm run test:workspace-automatic-promotion-integration
npm run test:runtime-workspace-activation
npm run test:workspace-manual-placement-transaction
npm run test:characterization
```

- [ ] **Step 5: Run inventory/purity/aggregate checks**

```powershell
npm run check:inventory
npm run check:runtime-contract-purity
npm run check
```

If inventory fails because an accepted D3D-06 path is truthfully stale, update only the exact inventory entry and explain the synchronization in the evidence packet. Do not change the checker to make the migration pass.

- [ ] **Step 6: Run forbidden-authority scans**

The evidence packet must distinguish expected v0.1 legacy references from forbidden v0.2 references. Search at minimum for:

```powershell
Select-String -Path src/core/workspace-membership-mutation/*.js -Pattern 'constellation-runtime-state-v0\.1|activeWorkspace|readCompatibleWorkspace|writeCompatibleWorkspace|OPERATION_LEDGER_KEY'
Select-String -Path src/core/workspace-projection-reconciliation/*.js -Pattern 'constellation-runtime-state-v0\.1|activeWorkspace|readLatestActiveWorkspace|writeCompatibleActiveWorkspace'
Select-String -Path src/core/automatic-workspace-projection-reconciler.js -Pattern 'readLatestActiveWorkspace|activeWorkspace|writeCompatible'
Select-String -Path src/sidepanel/workspace-tab-remove-only-control.js -Pattern 'getWorkspace|saveWorkspace|addTimelineEvent|chrome\.tabs\.remove'
```

Every remaining match must be classified as old v0.1 compatibility behavior or non-business diagnostic/comment text. Any match reachable from a new v0.2 primary path is a stop condition.

- [ ] **Step 7: Run diff integrity**

```powershell
git diff --check
```

Warnings about line-ending conversion are informational only if exit code is zero; trailing whitespace or other diff errors are failures.

- [ ] **Step 8: Write the evidence packet**

The packet must record:

- branch and starting implementation HEAD;
- exact changed/new path inventory;
- v0.1 preservation evidence;
- v0.2 membership command/result schemas;
- v0.2 reconciliation command/result schemas;
- complete assignment tuple proof;
- scoped record/local-ledger keys;
- membership lock trace;
- projection lock trace;
- Alpha/Beta concurrency evidence;
- same-Stella serialization evidence;
- add/remove/no-change/revision/replay/recovery matrix;
- conservative browser-matching matrix;
- scheduler isolation evidence;
- remove-only browser-kept-open evidence;
- route-order evidence;
- inventory/purity/npm aggregate results;
- static forbidden-authority scan classification;
- `git diff --check` result;
- explicit statement that live/operator Chrome acceptance was not performed.

- [ ] **Step 9: Final no-write boundary**

Before returning for Byte-Nolan review:

```powershell
git status --short
git diff --check
```

Do not stage, commit, push, open a PR, merge, or operate Chrome.

End the implementation report exactly:

```text
READY FOR BYTE-NOLAN D3D-06 SOURCE REVIEW
```

---

## Plan Self-Review

### Spec coverage

- Additive membership v0.2: Tasks 1-4.
- Complete D3D-04 authority tuple: Tasks 1-4.
- Scoped record/local ledger: Tasks 1-2.
- Add/remove/no-change semantics: Tasks 1-2 and 4.
- Remove-only browser kept open: Task 4.
- Promotion boundary / no D3D-10 transfer: Task 4.
- Additive reconciliation v0.2: Tasks 5-8.
- Projection lock order: Task 6.
- Conservative browser matching: Task 6.
- Replay/recovery/indeterminate: Tasks 2 and 6.
- Per-Stella scheduler: Task 7.
- Old/new route preservation: Tasks 3, 5, 7, and 8.
- Compatibility/global-authority exclusion: Tasks 2, 4, 6, 7, and 9.
- Alpha/Beta concurrency and same-Stella serialization: Tasks 2, 6, and 9.
- Automated closure/evidence: Task 9.
- Live Chrome remains deferred: Global Constraints and Task 9.

### Placeholder scan

No `TBD`, `TODO`, `implement later`, or unresolved interface placeholders are permitted. If execution discovers that the assigned reconciliation handler cannot fit inside the already approved files without creating a new path, that is explicitly a Byte-Nolan stop condition rather than a hidden placeholder.

### Type/interface consistency

- Assigned membership uses `authority.workspaceRevision` as `expectedWorkspaceRevision` everywhere.
- Assigned membership and reconciliation both carry `runtimeSessionId`, `sourceContextId`, `sourceWindowId`, `workspaceId`, `runtimeAssignmentId`, and `assignmentEpoch`.
- Workspace-local ledger operation kinds are `membership_mutation` and `projection_reconciliation` and map to the two exact D3D-06 command-schema identities.
- Membership add retains promotion continuation IDs only inside its typed add payload; remove has no promotion continuation IDs.
- Reconciliation keeps the existing v0.1 semantic payload schema inside a new v0.2 assigned outer command.
- New primary lock plans never include runtime-state or compatibility-projection locks.

## Execution Boundary

Implementation is not authorized to skip ahead between tasks. After each task, Byte reviews the source/diff and Nolan runs the requested local validation gate before the next task is accepted.

No individual task stages, commits, or pushes. After Task 9 and Byte-Nolan final source/automated review, one reviewed D3D-06 slice commit may be authorized. Live Chrome remains deferred to the later operator-controlled Layer 2.3D gate.
