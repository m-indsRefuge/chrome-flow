import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createOperationLedger } from "../../src/core/runtime-contract/ledger.js";
import { LOCK_NAMES } from "../../src/core/runtime-contract/constants.js";
import { assignRuntime } from "../../src/core/runtime-contract/assignments.js";
import { createSessionAuthority, registerContext } from "../../src/core/runtime-session-authority/contract.js";
import { createWorkspaceMembershipChromeAdapters } from "../../src/core/workspace-membership-mutation/chrome-adapter.js";
import { createWorkspaceMembershipClient } from "../../src/core/workspace-membership-mutation/client.js";
import {
  MEMBERSHIP_REQUEST_SCHEMA,
  createMembershipPendingRecord,
  createMembershipResult,
  snapshotAndValidateMembershipRequest,
  validateMembershipPendingRecord,
  validateMembershipReceipt,
  validateMembershipResult
} from "../../src/core/workspace-membership-mutation/contract.js";
import { coordinateWorkspaceMembershipMutation } from "../../src/core/workspace-membership-mutation/coordinator.js";
import { evaluateMembershipPromotionTrigger } from "../../src/core/workspace-membership-mutation/promotion-trigger.js";
import {
  classifyWorkspaceMembershipMessage,
  handleWorkspaceMembershipMessage
} from "../../src/core/workspace-membership-mutation/service-worker-handler.js";
import {
  applyWorkspaceMetadataAutosaveSnapshot,
  createWorkspaceMetadataBarrier,
  runWorkspaceMetadataWriterWithLatestSnapshot,
  saveWorkspaceDetailsAgainstLatest,
  updateWorkspaceTypeAgainstLatest
} from "../../src/sidepanel/workspace-metadata-barrier.js";
import {
  classifyExistingRecoveryMembership,
  createBrowserTabMembershipFailureEvidence,
  createWorkspaceMembershipPromotionSequencer,
  findExactBrowserMembership,
  planSelectedMembershipBatch
} from "../../src/sidepanel/workspace-membership-promotion-sequencer.js";
import { createPromotionResult } from "../../src/core/workspace-automatic-promotion-transaction/contract.js";
import {
  ALREADY_VERIFIED_TEXT,
  ATTACH_COMMITTED_TEXT,
  CREATE_COMMITTED_TEXT,
  NOT_VERIFIED_TEXT,
  createWorkspacePromotionNoticeController,
  deriveWorkspacePromotionNotice
} from "../../src/sidepanel/workspace-promotion-notice.js";
import {
  AUTOMATIC_PROMOTION_EVIDENCE_FIELDS,
  AUTOMATIC_PROMOTION_MANUAL_SCENARIOS,
  buildAutomaticPromotionValidationPacket,
  formatManualScenarioChecklist
} from "../../src/sidepanel/workspace-automatic-promotion-validation-contract.js";

test("membership request is exact canonical and rejects unknown hostile or unsupported input", () => {
  assert.equal(snapshotAndValidateMembershipRequest(request()).ok, true);
  assert.equal(snapshotAndValidateMembershipRequest(request({ extra: true })).ok, false);
  assert.equal(snapshotAndValidateMembershipRequest(request({ workspaceTabsToAdd: [tab(4), tab(4)] })).ok, false);
  assert.equal(snapshotAndValidateMembershipRequest(request({ workspaceTabsToAdd: [tab(5), tab(4)] })).ok, false);
  const cyclic = request();
  cyclic.workspaceTabsToAdd[0].cycle = cyclic;
  assert.equal(snapshotAndValidateMembershipRequest(cyclic).ok, false);
  const symbolBearing = request();
  symbolBearing[Symbol("unsafe")] = true;
  assert.equal(snapshotAndValidateMembershipRequest(symbolBearing).ok, false);
});

test("request getters are snapshotted exactly once", () => {
  const value = request();
  let reads = 0;
  Object.defineProperty(value, "operationId", { enumerable: true, get() { reads += 1; return "membership-op"; } });
  const validation = snapshotAndValidateMembershipRequest(value);
  assert.equal(validation.ok, true);
  assert.equal(reads, 1);
});

test("production membership adapter requires exact active assignment and reads live browser IDs under lock", async () => {
  const authority = assignedRuntimeAuthority();
  const adapters = createWorkspaceMembershipChromeAdapters({}, {
    requestLock: async (_name, callback) => callback(),
    readAuthority: async () => structuredClone(authority),
    getWindow: async (windowId) => ({ id: windowId }),
    queryTabs: async () => [{ id: 104 }, { id: 101 }]
  });
  assert.deepEqual(await adapters.readRuntimeAuthority({ workspaceId: "workspace-1", sourceContextId: "context-1", sourceWindowId: 10 }), { status: "present", contextVerified: true, error: "" });
  assert.equal((await adapters.readRuntimeAuthority({ workspaceId: "other-workspace", sourceContextId: "context-1", sourceWindowId: 10 })).contextVerified, false);
  assert.equal((await adapters.readRuntimeAuthority({ workspaceId: "workspace-1", sourceContextId: "stale-context", sourceWindowId: 10 })).contextVerified, false);
  assert.deepEqual(await adapters.withRuntimeStateLock(LOCK_NAMES.runtimeState, () => adapters.readBrowserProjection()), { status: "present", tabIds: [101, 104], error: "" });
  assert.equal((await adapters.readBrowserProjection()).error, "runtime_state_lock_not_held");
});

test("production membership adapter rejects missing released and malformed assignment authority", async () => {
  for (const root of [
    unassignedRuntimeAuthority(),
    releasedRuntimeAuthority(),
    { ...assignedRuntimeAuthority(), assignmentRegistry: { schema: "wrong", nextEpoch: 1, assignments: [] } }
  ]) {
    const adapters = createWorkspaceMembershipChromeAdapters({}, {
      readAuthority: async () => structuredClone(root),
      getWindow: async () => ({ id: 10 })
    });
    const result = await adapters.readRuntimeAuthority({ workspaceId: "workspace-1", sourceContextId: "context-1", sourceWindowId: 10 });
    assert.equal(result.contextVerified, false);
  }
});

test("batch membership commits once increments revision exactly and preserves unrelated fields", async () => {
  const fixture = createFixture(workspace(2));
  const input = request({ workspaceTabsToAdd: [tab(3), tab(4)] });
  const result = await coordinateWorkspaceMembershipMutation(input, fixture.adapters());
  assert.equal(result.status, "committed");
  assert.equal(result.workspaceRevisionBefore, 5);
  assert.equal(result.workspaceRevisionAfter, 6);
  assert.deepEqual(result.receipt.addedWorkspaceTabIds, ["workspace-tab-3", "workspace-tab-4"]);
  assert.deepEqual(result.receipt.addedBrowserTabIds, [103, 104]);
  assert.equal(result.receipt.previousEligibleTabCount, 2);
  assert.equal(result.receipt.currentEligibleTabCount, 4);
  assert.equal(fixture.workspace.workspaceRevision, 6);
  assert.equal(fixture.workspace.unknownFutureField.keep, true);
  assert.equal(fixture.workspace.name, "Fixture Workspace");
  assert.equal(fixture.workspace.tabs.length, 4);
  assert.equal(fixture.workspaceWrites, 1);
  assert.equal(validateMembershipResult(result, input).valid, true);
});

test("membership eligibility counts only exact currently live browser tab IDs", async () => {
  const missingStoredId = createFixture(workspace(3));
  missingStoredId.workspace.tabs[0].tabId = null;
  let result = await coordinateWorkspaceMembershipMutation(request(), missingStoredId.adapters());
  assert.equal(result.status, "committed");
  assert.equal(result.receipt.previousEligibleTabCount, 2);
  assert.equal(result.receipt.currentEligibleTabCount, 3);

  const onlyTwoLive = createFixture(workspace(3));
  onlyTwoLive.liveTabIds = onlyTwoLive.liveTabIds.filter((tabId) => tabId !== 103);
  result = await coordinateWorkspaceMembershipMutation(request(), onlyTwoLive.adapters());
  assert.equal(result.receipt.previousEligibleTabCount, 2);
  assert.equal(result.receipt.currentEligibleTabCount, 3);

  const threeToFour = createFixture(workspace(3));
  result = await coordinateWorkspaceMembershipMutation(request(), threeToFour.adapters());
  assert.deepEqual([result.receipt.previousEligibleTabCount, result.receipt.currentEligibleTabCount], [3, 4]);

  const fourToFive = createFixture(workspace(4));
  result = await coordinateWorkspaceMembershipMutation(request({ workspaceTabsToAdd: [tab(5)] }), fourToFive.adapters());
  assert.deepEqual([result.receipt.previousEligibleTabCount, result.receipt.currentEligibleTabCount], [4, 5]);
});

test("closed requested browser tabs fail closed before pending or workspace write", async () => {
  const fixture = createFixture(workspace(3));
  fixture.liveTabIds = fixture.liveTabIds.filter((tabId) => tabId !== 104);
  const result = await coordinateWorkspaceMembershipMutation(request(), fixture.adapters());
  assert.equal(result.status, "conflict");
  assert.equal(result.reason, "requested_browser_tab_not_live");
  assert.equal(fixture.ledgerWrites, 0);
  assert.equal(fixture.workspaceWrites, 0);
});

test("requested browser tab closing after pending evidence still blocks membership write", async () => {
  const fixture = createFixture(workspace(3));
  const adapters = fixture.adapters();
  let projectionReads = 0;
  adapters.readBrowserProjection = async () => {
    projectionReads += 1;
    return { status: "present", tabIds: projectionReads === 1 ? [101, 102, 103, 104] : [101, 102, 103], error: "" };
  };
  const result = await coordinateWorkspaceMembershipMutation(request(), adapters);
  assert.equal(result.status, "indeterminate");
  assert.equal(result.reason, "prewrite_browser_eligibility_changed");
  assert.equal(fixture.ledgerWrites, 1);
  assert.equal(fixture.workspaceWrites, 0);
});

test("pending membership recovery refuses changed browser eligibility", async () => {
  const fixture = createFixture(workspace(3));
  fixture.workspaceWriteFailures = 1;
  const input = request();
  assert.equal((await coordinateWorkspaceMembershipMutation(input, fixture.adapters())).status, "failed");
  fixture.liveTabIds = fixture.liveTabIds.filter((tabId) => tabId !== 101);
  const recovered = await coordinateWorkspaceMembershipMutation(input, fixture.adapters());
  assert.equal(recovered.status, "indeterminate");
  assert.equal(recovered.reason, "pending_browser_eligibility_changed");
  assert.equal(fixture.workspace.tabs.length, 3);
});

test("exact existing membership is verified no_change without a revision write", async () => {
  const fixture = createFixture(workspace(4));
  const input = request({ workspaceTabsToAdd: [structuredClone(fixture.workspace.tabs[3])] });
  const result = await coordinateWorkspaceMembershipMutation(input, fixture.adapters());
  assert.equal(result.status, "no_change");
  assert.equal(result.workspaceRevisionBefore, 5);
  assert.equal(result.workspaceRevisionAfter, 5);
  assert.equal(result.receipt.membershipWritten, false);
  assert.deepEqual(result.receipt.addedWorkspaceTabIds, []);
  assert.equal(fixture.workspaceWrites, 0);
});

test("exact operation replay returns the original verified receipt and performs no new workspace write", async () => {
  const fixture = createFixture(workspace(3));
  const input = request();
  const committed = await coordinateWorkspaceMembershipMutation(input, fixture.adapters());
  const writes = fixture.workspaceWrites;
  const replayed = await coordinateWorkspaceMembershipMutation(input, fixture.adapters());
  assert.equal(committed.status, "committed");
  assert.equal(replayed.status, "replayed");
  assert.equal(replayed.replayed, true);
  assert.deepEqual(replayed.receipt, committed.receipt);
  assert.equal(fixture.workspaceWrites, writes);
});

test("operation fingerprint conflict fails closed", async () => {
  const fixture = createFixture(workspace(3));
  const input = request();
  assert.equal((await coordinateWorkspaceMembershipMutation(input, fixture.adapters())).status, "committed");
  const conflicted = request({ promotionOperationId: "different-promotion" });
  const result = await coordinateWorkspaceMembershipMutation(conflicted, fixture.adapters());
  assert.equal(result.status, "conflict");
  assert.equal(result.reason, "operation_id_fingerprint_conflict");
});

test("revision identity peer and source-context conflicts do not mutate", async () => {
  for (const scenario of [
    { name: "revision", input: request({ expectedWorkspaceRevision: 4 }), configure() {}, reason: "workspace_revision_mismatch" },
    { name: "workspace", input: request({ workspaceId: "other-workspace" }), configure() {}, reason: "workspace_identity_mismatch" },
    { name: "peer", input: request(), configure(fixture) { fixture.peerConflict = true; }, reason: "workspace_compatibility_conflict" },
    { name: "context", input: request(), configure(fixture) { fixture.contextVerified = false; }, reason: "source_context_not_verified" }
  ]) {
    const fixture = createFixture(workspace(3));
    scenario.configure(fixture);
    const result = await coordinateWorkspaceMembershipMutation(scenario.input, fixture.adapters());
    assert.equal(result.status, "conflict", scenario.name);
    assert.equal(result.reason, scenario.reason, scenario.name);
    assert.equal(fixture.workspaceWrites, 0, scenario.name);
  }
});

test("duplicate and conflicting stored identities fail closed without overwrite", async () => {
  const byWorkspaceId = createFixture(workspace(3));
  const workspaceConflict = { ...tab(4), tabId: 999 };
  byWorkspaceId.liveTabIds.push(999);
  workspaceConflict.workspaceTabId = byWorkspaceId.workspace.tabs[0].workspaceTabId;
  let result = await coordinateWorkspaceMembershipMutation(request({ workspaceTabsToAdd: [workspaceConflict] }), byWorkspaceId.adapters());
  assert.equal(result.status, "conflict");
  assert.equal(result.reason, "existing_workspace_tab_identity_conflict");

  const byBrowserId = createFixture(workspace(3));
  const browserConflict = tab(4);
  browserConflict.tabId = byBrowserId.workspace.tabs[0].tabId;
  result = await coordinateWorkspaceMembershipMutation(request({ workspaceTabsToAdd: [browserConflict] }), byBrowserId.adapters());
  assert.equal(result.status, "conflict");
  assert.equal(result.reason, "existing_browser_tab_identity_conflict");
  assert.equal(byWorkspaceId.workspaceWrites + byBrowserId.workspaceWrites, 0);
});

test("malformed present shared ledger fails closed and is not replaced", async () => {
  const fixture = createFixture(workspace(3));
  fixture.ledger = { schema: "wrong", maxEntries: 1000, nextSequence: 1, entries: [] };
  const result = await coordinateWorkspaceMembershipMutation(request(), fixture.adapters());
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "operation_ledger_malformed");
  assert.equal(fixture.ledgerWrites, 0);
  assert.equal(fixture.workspaceWrites, 0);
});

test("pending membership recovers after a failed write without duplicate membership", async () => {
  const fixture = createFixture(workspace(3));
  fixture.workspaceWriteFailures = 1;
  const input = request();
  const failed = await coordinateWorkspaceMembershipMutation(input, fixture.adapters());
  assert.equal(failed.status, "failed");
  assert.equal(fixture.workspace.tabs.length, 3);
  const recovered = await coordinateWorkspaceMembershipMutation(input, fixture.adapters());
  assert.equal(recovered.status, "committed");
  assert.equal(recovered.receipt.currentEligibleTabCount, 4);
  assert.equal(fixture.workspace.tabs.filter((item) => item.workspaceTabId === "workspace-tab-4").length, 1);
});

test("pending membership evidence binds the exact expected and incremented workspace revisions", () => {
  const input = request();
  const pending = createMembershipPendingRecord(input, "membership:fingerprint", {
    workspaceRevisionBefore: 5,
    workspaceRevisionAfter: 6,
    previousEligibleTabCount: 3,
    currentEligibleTabCount: 4,
    addedWorkspaceTabIds: ["workspace-tab-4"],
    addedBrowserTabIds: [104],
    eligibleBrowserTabIdsBefore: [101, 102, 103],
    eligibleBrowserTabIdsAfter: [101, 102, 103, 104],
    workspaceFingerprintBefore: "before",
    workspaceFingerprintAfter: "after"
  });
  assert.equal(validateMembershipPendingRecord(pending, input).valid, true);
  for (const mutate of [
    (value) => { value.expectedWorkspaceRevision = 4; },
    (value) => { value.workspaceRevisionBefore = 4; },
    (value) => { value.workspaceRevisionAfter = 7; }
  ]) {
    const adversarial = structuredClone(pending);
    mutate(adversarial);
    assert.equal(validateMembershipPendingRecord(adversarial, input).valid, false);
  }
  assert.equal(validateMembershipPendingRecord(pending, request({ expectedWorkspaceRevision: 4 })).valid, false);
});

test("terminal-ledger uncertainty preserves verified membership and reports indeterminate", async () => {
  const fixture = createFixture(workspace(3));
  fixture.failLedgerWriteAt = 2;
  const result = await coordinateWorkspaceMembershipMutation(request(), fixture.adapters());
  assert.equal(result.status, "indeterminate");
  assert.equal(result.membershipVerified, true);
  assert.equal(result.compatiblePeersVerified, true);
  assert.equal(fixture.workspace.tabs.length, 4);
  assert.equal(fixture.workspace.workspaceRevision, 6);
});

test("membership client shares one in-flight send and retains request identity for retry", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let sends = 0;
  let seenRequest;
  const client = createWorkspaceMembershipClient({
    createId: idSequence(),
    now: () => "2026-07-16T08:00:00.000Z",
    send: async (sent) => {
      sends += 1;
      seenRequest = sent;
      await gate;
      return createMembershipResult({ ...sent, expectedWorkspaceRevision: sent.expectedWorkspaceRevision }, { status: "failed", reason: "transport_fixture_failure", retrySafe: true });
    }
  });
  const input = clientInput();
  const first = client.submit(input);
  const second = client.submit(input);
  assert.equal(first, second);
  release();
  await first;
  assert.equal(sends, 1);
  const operationId = seenRequest.operationId;
  await client.submit(input);
  assert.equal(sends, 2);
  assert.equal(seenRequest.operationId, operationId);
});

test("membership client rejects a mismatched response and retains no fabricated receipt", async () => {
  const client = createWorkspaceMembershipClient({
    createId: idSequence(),
    now: () => "2026-07-16T08:00:00.000Z",
    send: async () => ({ unsafe: true })
  });
  const result = await client.submit(clientInput());
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "malformed_or_mismatched_membership_response");
  assert.equal(client.latestVerifiedReceipt, null);
});

test("membership client supersedes a retained retry only for different operator input", async () => {
  const operationIds = [];
  const client = createWorkspaceMembershipClient({
    createId: idSequence(),
    now: () => "2026-07-16T08:00:00.000Z",
    send: async (sent) => {
      operationIds.push(sent.operationId);
      return createMembershipResult({ ...sent, expectedWorkspaceRevision: sent.expectedWorkspaceRevision }, { status: "failed", reason: "fixture_failure", retrySafe: true });
    }
  });
  const firstInput = clientInput();
  await client.submit(firstInput);
  await client.submit({ ...firstInput, workspaceTabsToAdd: [tab(5)] });
  assert.equal(operationIds.length, 2);
  assert.notEqual(operationIds[0], operationIds[1]);
});

test("promotion evaluator submits only verified increases at the exact threshold", async (context) => {
  for (const [before, after, expected] of [
    [0, 3, "no_promotion"],
    [3, 4, "submit_promotion"],
    [0, 4, "submit_promotion"],
    [1, 5, "submit_promotion"],
    [4, 5, "submit_promotion"],
    [4, 4, "no_promotion"],
    [5, 4, "invalid_receipt"]
  ]) await context.test(before + " to " + after, () => {
    const result = verifiedMembershipResult(before, after);
    const evaluated = evaluateMembershipPromotionTrigger({
      membershipResult: result,
      membershipReceipt: result.receipt,
      promotionOperationId: "promotion-op",
      nextRuntimeAssignmentId: "next-assignment",
      requestedAt: "2026-07-16T08:00:00.000Z"
    });
    assert.equal(evaluated.decision, expected);
    if (expected === "submit_promotion") {
      assert.equal(evaluated.promotionRequest.triggerOperationId, "membership-op");
      assert.equal(evaluated.promotionRequest.expectedWorkspaceRevision, 6);
      assert.equal(evaluated.promotionRequest.threshold, 4);
    }
  });
});

test("promotion evaluator rejects a mismatched or unverified receipt", () => {
  const result = verifiedMembershipResult(3, 4);
  const mismatch = structuredClone(result.receipt);
  mismatch.currentEligibleTabCount = 5;
  assert.equal(evaluateMembershipPromotionTrigger({ membershipResult: result, membershipReceipt: mismatch }).decision, "invalid_receipt");
  const unverified = structuredClone(result);
  unverified.receipt.membershipVerified = false;
  assert.equal(evaluateMembershipPromotionTrigger({ membershipResult: unverified, membershipReceipt: unverified.receipt }).decision, "invalid_receipt");
});

test("private route rejects unauthorized senders before adapter creation", () => {
  let adapterCreated = false;
  let response;
  const returned = handleWorkspaceMembershipMessage(request(), { id: "wrong", url: "sidepanel" }, (value) => { response = value; }, {
    runtimeId: "extension",
    sidePanelUrl: "sidepanel",
    createAdapters() { adapterCreated = true; return {}; },
    recordDiagnostic: async () => undefined
  });
  assert.equal(returned, false);
  assert.equal(response.status, "invalid");
  assert.equal(adapterCreated, false);
});

test("private route terminally owns malformed membership messages and leaves ordinary reconciliation unaffected", () => {
  const malformed = request();
  delete malformed.workspaceTabsToAdd;
  const classification = classifyWorkspaceMembershipMessage(malformed);
  assert.equal(classification.isMembership, true);
  let response;
  const returned = handleWorkspaceMembershipMessage(malformed, { id: "extension", url: "sidepanel" }, (value) => { response = value; }, {
    runtimeId: "extension",
    sidePanelUrl: "sidepanel",
    membershipClassification: classification,
    recordDiagnostic: async () => undefined
  });
  assert.equal(returned, false);
  assert.equal(response.status, "invalid");
  assert.equal(classifyWorkspaceMembershipMessage({ type: "constellation-reconcile-workspace-projection" }).isMembership, false);
});

test("recognized membership schema owns hostile invalid messages without reconciliation fallthrough", () => {
  const cases = [];
  const throwingGetter = request();
  Object.defineProperty(throwingGetter, "operationId", { enumerable: true, get() { throw new Error("hostile getter"); } });
  cases.push(throwingGetter);
  const cyclic = request(); cyclic.workspaceTabsToAdd[0].cycle = cyclic; cases.push(cyclic);
  const symbolBearing = request(); symbolBearing.workspaceTabsToAdd[0].unsafe = Symbol("unsafe"); cases.push(symbolBearing);
  const unsupported = request(); unsupported.workspaceTabsToAdd[0].unsafe = 1n; cases.push(unsupported);
  cases.push(new Proxy(request(), { ownKeys() { throw new Error("hostile ownKeys"); }, get(target, key) { return Reflect.get(target, key); } }));
  cases.push(request({ type: "constellation-reconcile-workspace-projection" }));
  for (const message of cases) {
    const classification = classifyWorkspaceMembershipMessage(message);
    assert.equal(classification.isMembership, true);
    let response;
    const returned = handleWorkspaceMembershipMessage(message, { id: "extension", url: "sidepanel" }, (value) => { response = value; }, {
      runtimeId: "extension",
      sidePanelUrl: "sidepanel",
      membershipClassification: classification,
      recordDiagnostic: async () => undefined
    });
    assert.equal(returned, false);
    assert.equal(response.status, "invalid");
  }
});

test("valid private route owns the asynchronous response lifetime", async () => {
  let resolveResponse;
  const response = new Promise((resolve) => { resolveResponse = resolve; });
  const returned = handleWorkspaceMembershipMessage(request(), { id: "extension", url: "sidepanel" }, resolveResponse, {
    runtimeId: "extension",
    sidePanelUrl: "sidepanel",
    createAdapters: () => createFixture(workspace(3)).adapters(),
    recordDiagnostic: async () => undefined
  });
  assert.equal(returned, true);
  assert.equal((await response).status, "committed");
});

test("metadata barrier preserves membership revision placement and unknown fields while applying queued typing", async () => {
  let state = workspace(3);
  const barrier = createWorkspaceMetadataBarrier({
    commitSnapshot: async (snapshot) => {
      state = { ...state, name: snapshot.name, aim: snapshot.aim, workspaceType: snapshot.workspaceType, updatedAt: snapshot.updatedAt };
      return { ok: true };
    }
  });
  const result = await barrier.run(async () => {
    state = { ...state, tabs: [...state.tabs, tab(4)], workspaceRevision: 6, placementMode: "dedicated_window", dedicatedWindowId: 77 };
    await barrier.submit({ name: "Typed during barrier", aim: "Queued", workspaceType: "research", updatedAt: "queued" }, "typing");
    return "membership-and-promotion-result";
  }, { name: "Before barrier", aim: "Initial", workspaceType: "research", updatedAt: "flush" });
  assert.equal(result, "membership-and-promotion-result");
  assert.equal(state.tabs.length, 4);
  assert.equal(state.workspaceRevision, 6);
  assert.equal(state.placementMode, "dedicated_window");
  assert.equal(state.dedicatedWindowId, 77);
  assert.equal(state.name, "Typed during barrier");
  assert.equal(state.unknownFutureField.keep, true);
});

test("metadata barrier failure cannot falsify the protected work result", async () => {
  let failures = 0;
  const barrier = createWorkspaceMetadataBarrier({
    commitSnapshot: async () => { throw new Error("metadata failed"); },
    recordFailure: async () => { failures += 1; }
  });
  const result = await barrier.run(async () => ({ membership: "committed", promotion: "indeterminate" }), { name: "x" });
  assert.deepEqual(result, { membership: "committed", promotion: "indeterminate" });
  assert.equal(failures, 1);
});

test("metadata barrier serializes concurrent protected membership sequences", async () => {
  const order = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const barrier = createWorkspaceMetadataBarrier({ commitSnapshot: async () => ({ ok: true }) });
  const first = barrier.run(async () => {
    order.push("first_start");
    await firstGate;
    order.push("first_end");
  }, null);
  const second = barrier.run(async () => { order.push("second"); }, null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["first_start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first_start", "first_end", "second"]);
});

test("Save requested during membership sequencing rereads latest and preserves protected fields", async () => {
  const holder = { workspace: workspace(3) };
  const barrier = createWorkspaceMetadataBarrier({ commitSnapshot: async () => ({ ok: true }) });
  let releaseMembership;
  const gate = new Promise((resolve) => { releaseMembership = resolve; });
  const membership = barrier.run(async () => {
    holder.workspace = { ...holder.workspace, tabs: [...holder.workspace.tabs, tab(4)], workspaceRevision: 6, placementMode: "dedicated_window", dedicatedWindowId: 77 };
    await gate;
  }, null);
  const save = barrier.run(() => saveWorkspaceDetailsAgainstLatest({
    name: "Saved latest",
    aim: "Preserve everything",
    workspaceType: "research",
    eventId: "save-event",
    updatedAt: "2026-07-16T09:00:00.000Z"
  }, metadataWriterAdapters(holder)), null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(holder.workspace.name, "Fixture Workspace");
  releaseMembership();
  await Promise.all([membership, save]);
  assert.equal(holder.workspace.name, "Saved latest");
  assert.equal(holder.workspace.workspaceRevision, 6);
  assert.equal(holder.workspace.tabs.length, 4);
  assert.equal(holder.workspace.placementMode, "dedicated_window");
  assert.equal(holder.workspace.unknownFutureField.keep, true);
  assert.equal(holder.workspace.journal.length, 1);
  assert.equal(holder.workspace.timeline.at(-1).type, "workspace_saved");
});

test("Type change requested during membership sequencing updates roles only on latest workspace", async () => {
  const holder = { workspace: workspace(3) };
  holder.workspace.tabs[0].role = "question";
  let releaseMembership;
  const gate = new Promise((resolve) => { releaseMembership = resolve; });
  const barrier = createWorkspaceMetadataBarrier({ commitSnapshot: async () => ({ ok: true }) });
  const membership = barrier.run(async () => {
    holder.workspace = { ...holder.workspace, tabs: [...holder.workspace.tabs, { ...tab(4), role: "future-role" }], workspaceRevision: 6, timeline: [...holder.workspace.timeline, { eventId: "membership-event", type: "membership", createdAt: "2026-07-16T08:30:00.000Z" }] };
    await gate;
  }, null);
  const typeChange = barrier.run(() => updateWorkspaceTypeAgainstLatest({
    name: "ignored",
    aim: "ignored",
    workspaceType: "writing",
    eventId: "type-event",
    updatedAt: "2026-07-16T09:00:00.000Z"
  }, metadataWriterAdapters(holder, {
    isValidWorkspaceRole: (_type, role) => ["unassigned", "source"].includes(role),
    getWorkspaceTypeLabel: (type) => type
  })), null);
  releaseMembership();
  await Promise.all([membership, typeChange]);
  assert.equal(holder.workspace.workspaceRevision, 6);
  assert.equal(holder.workspace.name, "ignored");
  assert.equal(holder.workspace.aim, "ignored");
  assert.equal(holder.workspace.tabs.length, 4);
  assert.equal(holder.workspace.tabs[0].role, "unassigned");
  assert.equal(holder.workspace.tabs[3].role, "unassigned");
  assert.equal(holder.workspace.timeline[0].type, "membership");
  assert.equal(holder.workspace.timeline[1].type, "workspace_type_updated");
  assert.equal(holder.workspace.unknownFutureField.keep, true);
});

test("production sequencer orders one membership request finalizer and at most one promotion request", async () => {
  const order = [];
  let membershipRequest;
  let promotionRequest;
  const sequencer = createWorkspaceMembershipPromotionSequencer({
    createId: idSequence(),
    now: () => "2026-07-16T08:00:00.000Z",
    activateWorkspace: async (workspace) => verifiedActivation(workspace),
    runMetadataBarrier: async (work) => work(),
    sendMembership: async (sent) => {
      order.push("membership");
      membershipRequest = sent;
      return membershipResponse(sent, 3, 4, "committed");
    },
    sendPromotion: async (sent) => {
      order.push("promotion");
      promotionRequest = sent;
      return promotionResponse(sent, "committed");
    },
    onPromotionStarting: async ({ promotionRequest: startingRequest }) => {
      order.push("promotion_notice");
      assert.equal(startingRequest.workspaceId, "workspace-1");
    }
  });
  const result = await sequencer.sequenceWorkspaceMembershipPromotion({
    mutationKind: "selected_tab_batch",
    workspaceId: "workspace-1",
    workspace: workspace(3),
    workspaceTabsToAdd: [tab(4), tab(5)],
    afterMembership: async () => { order.push("finalizer"); }
  });
  assert.equal(result.status, "promotion_verified");
  assert.deepEqual(order, ["membership", "finalizer", "promotion_notice", "promotion"]);
  assert.equal(membershipRequest.workspaceTabsToAdd.length, 2);
  assert.equal(promotionRequest.triggerOperationId, membershipRequest.operationId);
  assert.equal(promotionRequest.operationId, membershipRequest.promotionOperationId);
});

test("production sequencer does not promote below threshold or after membership failure", async () => {
  let promotions = 0;
  let finalizers = 0;
  const below = createSequencerFixture({ before: 0, after: 3, onPromotion: () => { promotions += 1; }, onFinalizer: () => { finalizers += 1; } });
  const belowResult = await below.sequencer.sequenceWorkspaceMembershipPromotion(below.input);
  assert.equal(belowResult.status, "membership_verified_below_threshold");
  assert.equal(promotions, 0);
  assert.equal(finalizers, 1);

  const failed = createSequencerFixture({ membershipStatus: "failed", onPromotion: () => { promotions += 1; }, onFinalizer: () => { finalizers += 1; } });
  const failedResult = await failed.sequencer.sequenceWorkspaceMembershipPromotion(failed.input);
  assert.equal(failedResult.status, "membership_not_verified");
  assert.equal(promotions, 0);
  assert.equal(finalizers, 1);
});

test("promotion retry reuses membership and promotion operation identities", async () => {
  const membershipIds = [];
  const promotionIds = [];
  const promotionRequests = [];
  let promotionAttempt = 0;
  const sequencer = createWorkspaceMembershipPromotionSequencer({
    createId: idSequence(),
    now: () => "2026-07-16T08:00:00.000Z",
    activateWorkspace: async (workspace) => verifiedActivation(workspace),
    runMetadataBarrier: async (work) => work(),
    sendMembership: async (sent) => {
      membershipIds.push(sent.operationId);
      return membershipResponse(sent, 3, 4, membershipIds.length === 1 ? "committed" : "replayed");
    },
    sendPromotion: async (sent) => {
      promotionIds.push(sent.operationId);
      promotionRequests.push(sent);
      promotionAttempt += 1;
      return promotionResponse(sent, promotionAttempt === 1 ? "failed" : "committed");
    }
  });
  const input = { mutationKind: "active_tab", workspaceId: "workspace-1", workspace: workspace(3), workspaceTabsToAdd: [tab(4)] };
  assert.equal((await sequencer.sequenceWorkspaceMembershipPromotion(input)).status, "promotion_verified");
  assert.deepEqual(membershipIds, [membershipIds[0]]);
  assert.deepEqual(promotionIds, [promotionIds[0], promotionIds[0]]);
  assert.equal(promotionRequests[0], promotionRequests[1]);
  assert.equal(promotionRequests[0].triggerOperationId, promotionRequests[1].triggerOperationId);
  assert.equal(promotionRequests[0].nextRuntimeAssignmentId, promotionRequests[1].nextRuntimeAssignmentId);
});

test("promotion retry is bounded to two sends and recovers transport or pending failure", async () => {
  for (const firstFailure of ["throw", "failed", "indeterminate"]) {
    let sends = 0;
    const fixture = createSequencerFixture();
    const sequencer = createWorkspaceMembershipPromotionSequencer({
      createId: idSequence(),
      now: () => "2026-07-16T08:00:00.000Z",
      activateWorkspace: async (workspace) => verifiedActivation(workspace),
      runMetadataBarrier: async (work) => work(),
      sendMembership: async (sent) => membershipResponse(sent, 3, 4, "committed"),
      sendPromotion: async (sent) => {
        sends += 1;
        if (sends === 1 && firstFailure === "throw") throw new Error("transport");
        if (sends === 1 && firstFailure === "failed") return promotionResponse(sent, "failed");
        if (sends === 1 && firstFailure === "indeterminate") {
          const result = promotionResponse(sent, "failed");
          result.status = "indeterminate";
          result.indeterminate = true;
          return result;
        }
        return promotionResponse(sent, "replayed");
      }
    });
    const result = await sequencer.sequenceWorkspaceMembershipPromotion(fixture.input);
    assert.equal(result.status, "promotion_verified");
    assert.equal(sends, 2);
  }
});

test("promotion response must match expected revision and next assignment identity", async () => {
  for (const mismatch of ["revision", "assignment"]) {
    let sends = 0;
    const fixture = createSequencerFixture();
    const sequencer = createWorkspaceMembershipPromotionSequencer({
      createId: idSequence(),
      now: () => "2026-07-16T08:00:00.000Z",
      activateWorkspace: async (workspace) => verifiedActivation(workspace),
      runMetadataBarrier: async (work) => work(),
      sendMembership: async (sent) => membershipResponse(sent, 3, 4, "committed"),
      sendPromotion: async (sent) => {
        sends += 1;
        const result = promotionResponse(sent, "committed");
        if (mismatch === "revision") result.workspaceRevisionBefore += 1;
        else result.nextRuntimeAssignmentId = "mismatched-assignment";
        return result;
      }
    });
    const result = await sequencer.sequenceWorkspaceMembershipPromotion(fixture.input);
    assert.equal(result.status, "promotion_not_verified");
    assert.equal(result.promotionResult.reason, "malformed_or_mismatched_promotion_response");
    assert.equal(sends, 2);
  }
});

test("verified committed replayed and no-change promotion results are never retried", async () => {
  for (const status of ["committed", "replayed", "no_change"]) {
    let sends = 0;
    const fixture = createSequencerFixture();
    const sequencer = createWorkspaceMembershipPromotionSequencer({
      createId: idSequence(), now: () => "2026-07-16T08:00:00.000Z", activateWorkspace: async (workspace) => verifiedActivation(workspace), runMetadataBarrier: async (work) => work(),
      sendMembership: async (sent) => membershipResponse(sent, 3, 4, "committed"),
      sendPromotion: async (sent) => { sends += 1; return promotionResponse(sent, status); }
    });
    assert.equal((await sequencer.sequenceWorkspaceMembershipPromotion(fixture.input)).status, "promotion_verified");
    assert.equal(sends, 1);
  }
});

test("source integrates exactly four authorized membership producers and no render startup trigger", async () => {
  const source = await readFile(new URL("../../src/sidepanel/sidepanel.js", import.meta.url), "utf8");
  const invocations = source.match(/workspaceMembershipPromotionSequencer\.sequenceWorkspaceMembershipPromotion\s*\(/g) || [];
  assert.equal(invocations.length, 4);
  for (const functionName of ["addSelectedTabsToWorkspace", "addActiveTabToWorkspace", "openSearchTab", "readdWorkspaceTabFromTimeline"]) {
    const body = extractFunction(source, functionName);
    assert.match(body, /sequenceWorkspaceMembershipPromotion/);
    assert.doesNotMatch(body, /await\s+saveWorkspace\s*\(/);
  }
  for (const functionName of ["renderWorkspace", "initializeSidePanel"]) {
    assert.doesNotMatch(extractFunction(source, functionName), /sequenceWorkspaceMembershipPromotion|MEMBERSHIP_REQUEST_SCHEMA|PROMOTION_REQUEST_SCHEMA/);
  }
});

test("selected batch coalescing active duplicate skip and failure recovery evidence are deterministic", () => {
  const existing = [tab(1), tab(2)];
  const available = [
    { id: 101, url: "https://example.com/1" },
    { id: 103, url: "https://example.com/2" },
    { id: 104, url: "https://example.com/2" }
  ];
  const planned = planSelectedMembershipBatch({
    workspaceTabs: existing,
    availableTabs: available,
    selectedIds: [101, 103, 104, 999],
    createWorkspaceTab: (browserTab, options) => ({ ...tab(browserTab.id - 100), tabId: browserTab.id, url: browserTab.url, sameUrlDuplicate: options.sameUrlDuplicate })
  });
  assert.equal(planned.exactSkippedCount, 1);
  assert.equal(planned.missingCount, 1);
  assert.equal(planned.added.length, 2);
  assert.equal(planned.duplicateUrlAddedCount, 2);
  assert.equal(findExactBrowserMembership(existing, 101)?.workspaceTabId, "workspace-tab-1");
  assert.equal(findExactBrowserMembership(existing, 999), null);
  const evidence = createBrowserTabMembershipFailureEvidence({ tabId: 777, reason: "membership_not_verified" });
  assert.equal(evidence.tabId, 777);
  assert.equal(evidence.reason, "membership_not_verified");
  assert.deepEqual(evidence.recoveryActions, { browserTabLeftOpen: true, canRetryWorkspaceMembership: true });
});

test("recovery group finalizer completes before promotion begins", async () => {
  const order = [];
  let releaseFinalizer;
  const finalizerGate = new Promise((resolve) => { releaseFinalizer = resolve; });
  const fixture = createSequencerFixture({
    onFinalizer: async () => undefined,
    onPromotion: () => { order.push("promotion"); }
  });
  fixture.input.mutationKind = "recovery_readd";
  fixture.input.afterMembership = async () => { order.push("group_finalizer_start"); await finalizerGate; order.push("group_finalizer_end"); };
  const pending = fixture.sequencer.sequenceWorkspaceMembershipPromotion(fixture.input);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["group_finalizer_start"]);
  releaseFinalizer();
  assert.equal((await pending).status, "promotion_verified");
  assert.deepEqual(order, ["group_finalizer_start", "group_finalizer_end", "promotion"]);
});

test("automatic promotion renders a pre-transition notice before the browser transaction begins", async () => {
  const [sidePanel, sequencer, notice] = await Promise.all([
    readFile(new URL("../../src/sidepanel/sidepanel.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/sidepanel/workspace-membership-promotion-sequencer.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/sidepanel/workspace-promotion-notice.js", import.meta.url), "utf8")
  ]);
  assert.match(sidePanel, /onPromotionStarting/);
  assert.match(sidePanel, /workspacePromotionNoticeController\.showPending/);
  assert.match(sidePanel, /waitForPromotionNoticePaint/);
  const sequencePath = sequencer.slice(sequencer.indexOf("await onPromotionStarting"), sequencer.indexOf("const promotionResult"));
  assert.match(sequencePath, /promotionRequest/);
  assert.match(notice, /PROMOTION_STARTING_TEXT/);
  assert.match(notice, /showPending/);
  assert.match(notice, /promotion_pending/);
});

test("notice mapping is derived from validated create attach replay failure and below-threshold results", () => {
  const membershipRequest = request();
  const membership = membershipResponse(membershipRequest, 3, 4, "committed");
  const promotionRequest = promotionRequestFor(membershipRequest, membership.receipt);
  const create = deriveWorkspacePromotionNotice({ status: "promotion_verified", membershipResult: membership, promotionResult: promotionResponse(promotionRequest, "committed") });
  const attach = deriveWorkspacePromotionNotice({ status: "promotion_verified", membershipResult: membership, promotionResult: promotionResponse(promotionRequest, "committed", "attach_to_existing_dedicated_window") });
  const replay = deriveWorkspacePromotionNotice({ status: "promotion_verified", membershipResult: membership, promotionResult: promotionResponse(promotionRequest, "replayed") });
  const failure = deriveWorkspacePromotionNotice({ status: "promotion_not_verified", membershipResult: membership, promotionResult: promotionResponse(promotionRequest, "failed") });
  const below = deriveWorkspacePromotionNotice({ status: "membership_verified_below_threshold", membershipResult: membershipResponse(membershipRequest, 0, 3, "committed"), promotionResult: null });
  assert.equal(create.text, CREATE_COMMITTED_TEXT);
  assert.equal(create.sourceAssignmentOwnership, "transferred");
  assert.equal(attach.text, ATTACH_COMMITTED_TEXT);
  assert.equal(replay.text, ALREADY_VERIFIED_TEXT);
  assert.equal(failure.text, NOT_VERIFIED_TEXT);
  assert.equal(below, null);
});

test("accessible live-region controller suppresses duplicate terminal replay announcements", () => {
  const element = fakeElement();
  const controller = createWorkspacePromotionNoticeController(element);
  const membershipRequest = request();
  const membership = membershipResponse(membershipRequest, 3, 4, "replayed");
  const promotionRequest = promotionRequestFor(membershipRequest, membership.receipt);
  const sequence = { status: "promotion_verified", membershipResult: membership, promotionResult: promotionResponse(promotionRequest, "replayed") };
  assert.equal(controller.showSequence(sequence).shown, true);
  assert.equal(controller.showSequence(sequence).reason, "duplicate_terminal_notice");
  assert.equal(element.attributes.role, "status");
  assert.equal(element.attributes["aria-live"], "polite");
  assert.equal(element.attributes["aria-atomic"], "true");
  assert.equal(element.textContent, ALREADY_VERIFIED_TEXT);
  assert.equal(element.hidden, false);
});

test("notice surface is non-modal and the historical packet remains schema-stable developer-gated evidence", async () => {
  const [noticeSource, panelHtml, policySource, policySurfaceSource, sidepanelSource] = await Promise.all([
    readFile(new URL("../../src/sidepanel/workspace-promotion-notice.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/sidepanel/sidepanel.html", import.meta.url), "utf8"),
    readFile(new URL("../../src/sidepanel/workspace-dedicated-window-threshold-policy.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/sidepanel/workspace-dedicated-window-threshold-policy-surface.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/sidepanel/sidepanel.js", import.meta.url), "utf8")
  ]);
  const promotionNoticeMarkup = panelHtml.match(/<div id="workspacePromotionNotice"[^>]*><\/div>/i)?.[0] || "";
  assert.match(promotionNoticeMarkup, /role="status"/);
  assert.match(promotionNoticeMarkup, /aria-live="polite"/);
  assert.doesNotMatch(noticeSource, /\bconfirm\s*\(|chrome\.notifications/i);
  assert.doesNotMatch(promotionNoticeMarkup, /<dialog\b/i);
  assert.match(policySource, /Historical Dedicated Window Threshold Validation/);
  assert.match(policySource, /Historical validation artifact\./);
  assert.match(policySource, /dedicated-window-threshold-policy-packet-v0\.1/);
  assert.match(policySurfaceSource, /registerDeveloperSurface\(section\)/);
  assert.match(policySurfaceSource, /registerValidationSurface\(section\)/);
  assert.doesNotMatch(policySource, /chrome\.runtime\.sendMessage|coordinateWorkspaceMembershipMutation|coordinateAutomaticWorkspacePromotion|sequenceWorkspaceMembershipPromotion/);
  assert.doesNotMatch(policySource, /threshold-(?:preflight|review|execution)|workspace-control-(?:preflight|review|execution)/);
  assert.doesNotMatch(panelHtml, /workspace-dedicated-window-threshold-(?:review|run)-surfaces\.js/);
  assert.match(sidepanelSource, /moveWorkspaceTabsToNewWindowButton/);
  assert.match(sidepanelSource, /workspaceManualPlacementClient\.submit/);
  assert.doesNotMatch(sidepanelSource, /moveExistingWorkspaceTabs/);
  assert.doesNotMatch(policySource, /\n\s*preparePolicyPacket\(\);/);
});

test("historical threshold policy import performs no storage read or write", async () => {
  const originalDocument = globalThis.document;
  const originalChrome = globalThis.chrome;
  let storageReads = 0;
  let storageWrites = 0;
  const elements = new Map();
  const anchor = { insertAdjacentElement(_position, element) { elements.set(element.id, element); } };
  globalThis.document = {
    getElementById(id) { return elements.get(id) || null; },
    querySelector() { return anchor; },
    createElement() { return { id: "", className: "", innerHTML: "" }; }
  };
  globalThis.chrome = { storage: { local: { async get() { storageReads += 1; return {}; }, async set() { storageWrites += 1; } } } };
  try {
    const url = new URL("../../src/sidepanel/workspace-dedicated-window-threshold-policy.js", import.meta.url);
    url.searchParams.set("noWriteLoad", String(Date.now()));
    await import(url.href);
  } finally {
    globalThis.document = originalDocument;
    globalThis.chrome = originalChrome;
  }
  assert.equal(storageReads, 0);
  assert.equal(storageWrites, 0);
});

test("live-validation substrate contains the complete manual matrix and empty evidence schema without a pass claim", () => {
  const packet = buildAutomaticPromotionValidationPacket({ createdAt: "2026-07-16T09:00:00.000Z" });
  assert.equal(packet.schema, "constellation-workspace-automatic-promotion-live-validation-v0.1");
  assert.equal(packet.developerOnly, true);
  assert.equal(packet.operatorControlled, true);
  assert.equal(packet.automatedBrowserMutation, false);
  assert.equal(packet.liveChromeRun, false);
  assert.equal(packet.liveChromePassed, false);
  assert.deepEqual(packet.evidenceFields, [...AUTOMATIC_PROMOTION_EVIDENCE_FIELDS]);
  assert.equal(packet.scenarios.length, AUTOMATIC_PROMOTION_MANUAL_SCENARIOS.length);
  assert.equal(packet.scenarios.length, 20);
  assert.ok(packet.scenarios.every((scenario) => scenario.status === "not_run"));
  assert.ok(packet.scenarios.every((scenario) => Object.keys(scenario.evidence).length === AUTOMATIC_PROMOTION_EVIDENCE_FIELDS.length));
  const checklist = formatManualScenarioChecklist();
  for (const scenario of AUTOMATIC_PROMOTION_MANUAL_SCENARIOS) assert.match(checklist, new RegExp(escapeRegex(scenario.label)));
  for (const field of AUTOMATIC_PROMOTION_EVIDENCE_FIELDS) assert.match(checklist, new RegExp(escapeRegex(field)));
});

test("live-validation surface is developer and validation gated and cannot mutate Chrome or runtime state", async () => {
  const source = await readFile(new URL("../../src/sidepanel/workspace-automatic-promotion-validation-surface.js", import.meta.url), "utf8");
  assert.match(source, /registerDeveloperSurface\(section\)/);
  assert.match(source, /registerValidationSurface\(section\)/);
  assert.match(source, /No live validation has been run/);
  assert.doesNotMatch(source, /chrome\.(?:tabs|windows|tabGroups|storage|runtime)|sendMessage\s*\(|coordinateWorkspaceMembershipMutation|coordinateAutomaticWorkspacePromotion/);
});

function request(overrides = {}) {
  return {
    schema: MEMBERSHIP_REQUEST_SCHEMA,
    operationId: "membership-op",
    mutationKind: "active_tab",
    workspaceId: "workspace-1",
    sourceContextId: "context-1",
    sourceWindowId: 10,
    expectedWorkspaceRevision: 5,
    requestedAt: "2026-07-16T08:00:00.000Z",
    workspaceTabsToAdd: [tab(4)],
    promotionOperationId: "promotion-op",
    nextRuntimeAssignmentId: "next-assignment",
    ...overrides
  };
}

function tab(index) {
  return {
    workspaceTabId: "workspace-tab-" + index,
    tabId: 100 + index,
    windowId: 10,
    groupId: -1,
    url: "https://example.com/" + index,
    displayUrl: "example.com/" + index,
    originalTitle: "Tab " + index,
    alias: "",
    role: "unassigned",
    isOpen: true,
    firstSeenAt: "2026-07-16T07:00:00.000Z",
    lastSeenAt: "2026-07-16T07:00:00.000Z"
  };
}

function workspace(count) {
  return {
    workspaceId: "workspace-1",
    workspaceRevision: 5,
    name: "Fixture Workspace",
    aim: "Test exact membership authority",
    workspaceType: "research",
    createdAt: "2026-07-16T06:00:00.000Z",
    updatedAt: "2026-07-16T07:00:00.000Z",
    tabs: Array.from({ length: count }, (_, index) => tab(index + 1)),
    journal: [{ entryId: "journal-1", text: "keep", createdAt: "2026-07-16T07:00:00.000Z" }],
    timeline: [],
    unknownFutureField: { keep: true }
  };
}

function createFixture(initialWorkspace) {
  const fixture = {
    workspace: structuredClone(initialWorkspace),
    ledger: createOperationLedger(),
    workspaceWrites: 0,
    ledgerWrites: 0,
    workspaceWriteFailures: 0,
    failLedgerWriteAt: 0,
    peerConflict: false,
    contextVerified: true,
    liveTabIds: Array.from({ length: 10 }, (_, index) => 101 + index),
    adapters() {
      return {
        withRuntimeStateLock: async (_name, callback) => callback(),
        readCompatibleWorkspace: async () => {
          const canonical = structuredClone(fixture.workspace);
          const legacy = fixture.peerConflict ? { ...structuredClone(fixture.workspace), name: "conflict" } : structuredClone(fixture.workspace);
          return {
            canonicalPresent: true,
            legacyPresent: true,
            canonicalValue: canonical,
            legacyValue: legacy,
            equivalent: !fixture.peerConflict,
            conflict: fixture.peerConflict,
            value: canonical
          };
        },
        writeCompatibleWorkspace: async (next) => {
          fixture.workspaceWrites += 1;
          if (fixture.workspaceWriteFailures > 0) {
            fixture.workspaceWriteFailures -= 1;
            throw new Error("workspace write failed");
          }
          fixture.workspace = structuredClone(next);
        },
        readOperationLedger: async () => {
          const valid = fixture.ledger?.schema === "constellation-runtime-operation-ledger-v0.1";
          return valid
            ? { status: "present", ledger: structuredClone(fixture.ledger), error: "" }
            : { status: "failed", ledger: null, error: "operation_ledger_malformed" };
        },
        writeOperationLedger: async (next) => {
          fixture.ledgerWrites += 1;
          if (fixture.failLedgerWriteAt === fixture.ledgerWrites) return { status: "failed", error: "fixture_ledger_failure" };
          fixture.ledger = structuredClone(next);
          return { status: "written", error: "" };
        },
        readRuntimeAuthority: async () => ({ status: "present", contextVerified: fixture.contextVerified, error: "" }),
        readBrowserProjection: async () => ({ status: "present", tabIds: [...fixture.liveTabIds].sort((left, right) => left - right), error: "" })
      };
    }
  };
  return fixture;
}

function unassignedRuntimeAuthority() {
  const root = createSessionAuthority("runtime-session-1");
  return registerContext(root, {
    contextId: "context-1",
    windowId: 10,
    createdAt: "2026-07-16T08:00:00.000Z",
    sourceUrl: "chrome-extension://extension/src/sidepanel/sidepanel.html"
  }, { genesis: true }).root;
}

function assignedRuntimeAuthority() {
  const root = unassignedRuntimeAuthority();
  root.assignmentRegistry = assignRuntime(root.assignmentRegistry, {
    workspaceId: "workspace-1",
    windowId: 10,
    sourceContextId: "context-1",
    now: "2026-07-16T08:00:00.000Z",
    id: () => "assignment-1"
  }).registry;
  return root;
}

function releasedRuntimeAuthority() {
  const root = assignedRuntimeAuthority();
  root.assignmentRegistry.assignments[0].state = "released";
  root.assignmentRegistry.assignments[0].updatedAt = "2026-07-16T08:01:00.000Z";
  return root;
}


test("membership sequencer retries one lost response with the exact retained request then promotes", async () => {
  const membershipRequests = [];
  let promotionRequests = 0;
  const sequencer = createWorkspaceMembershipPromotionSequencer({
    createId: idSequence(),
    now: () => "2026-07-16T08:00:00.000Z",
    activateWorkspace: async (workspace) => verifiedActivation(workspace),
    runMetadataBarrier: async (work) => work(),
    sendMembership: async (sent) => {
      membershipRequests.push(sent);
      if (membershipRequests.length === 1) throw new Error("response lost after commit");
      return membershipResponse(sent, 3, 4, "replayed");
    },
    sendPromotion: async (sent) => {
      promotionRequests += 1;
      return promotionResponse(sent, "committed");
    }
  });
  const result = await sequencer.sequenceWorkspaceMembershipPromotion({
    mutationKind: "active_tab",
    workspaceId: "workspace-1",
    workspace: workspace(3),
    workspaceTabsToAdd: [tab(4)]
  });
  assert.equal(result.status, "promotion_verified");
  assert.equal(membershipRequests.length, 2);
  assert.equal(membershipRequests[0], membershipRequests[1]);
  assert.equal(membershipRequests[0].operationId, membershipRequests[1].operationId);
  assert.equal(membershipRequests[0].promotionOperationId, membershipRequests[1].promotionOperationId);
  assert.equal(membershipRequests[0].nextRuntimeAssignmentId, membershipRequests[1].nextRuntimeAssignmentId);
  assert.equal(promotionRequests, 1);
});

test("membership sequencer does not retry verified success conflict or invalid outcomes", async () => {
  for (const status of ["committed", "conflict", "invalid"]) {
    let sends = 0;
    const sequencer = createWorkspaceMembershipPromotionSequencer({
      createId: idSequence(),
      now: () => "2026-07-16T08:00:00.000Z",
      activateWorkspace: async (workspace) => verifiedActivation(workspace),
      runMetadataBarrier: async (work) => work(),
      sendMembership: async (sent) => {
        sends += 1;
        if (status === "committed") return membershipResponse(sent, 0, 3, "committed");
        return createMembershipResult(sent, { status, reason: "fixture_" + status, retrySafe: false });
      },
      sendPromotion: async () => { throw new Error("promotion should not run"); }
    });
    await sequencer.sequenceWorkspaceMembershipPromotion({
      mutationKind: "active_tab",
      workspaceId: "workspace-1",
      workspace: workspace(3),
      workspaceTabsToAdd: [tab(4)]
    });
    assert.equal(sends, 1, status);
  }
});

test("successful membership evidence is bound to the request revision", async () => {
  const input = request();
  const result = await coordinateWorkspaceMembershipMutation(input, createFixture(workspace(3)).adapters());
  assert.equal(validateMembershipReceipt(result.receipt, input).valid, true);
  assert.equal(validateMembershipResult(result, input).valid, true);

  const corrupt = structuredClone(result);
  corrupt.workspaceRevisionBefore = input.expectedWorkspaceRevision - 1;
  corrupt.workspaceRevisionAfter = input.expectedWorkspaceRevision;
  corrupt.receipt.workspaceRevisionBefore = input.expectedWorkspaceRevision - 1;
  corrupt.receipt.workspaceRevisionAfter = input.expectedWorkspaceRevision;
  assert.equal(validateMembershipReceipt(corrupt.receipt, input).valid, false);
  assert.equal(validateMembershipResult(corrupt, input).valid, false);
});

test("latest metadata snapshot wins over an older queued writer and autosave cannot own type", async () => {
  const holder = { workspace: workspace(3) };
  const barrier = createWorkspaceMetadataBarrier({
    commitSnapshot: async (snapshot) => {
      holder.workspace = applyWorkspaceMetadataAutosaveSnapshot(holder.workspace, snapshot, "2026-07-16T09:00:00.000Z");
      return { ok: true };
    }
  });
  let releaseMembership;
  const gate = new Promise((resolve) => { releaseMembership = resolve; });
  const membership = barrier.run(async () => { await gate; }, null);
  let form = { name: "Older A", aim: "Older aim", workspaceType: "research" };
  const save = runWorkspaceMetadataWriterWithLatestSnapshot(
    barrier,
    () => structuredClone(form),
    (snapshot) => saveWorkspaceDetailsAgainstLatest({ ...snapshot, eventId: "save-latest", updatedAt: "2026-07-16T09:01:00.000Z" }, metadataWriterAdapters(holder))
  );
  await new Promise((resolve) => setImmediate(resolve));
  form = { name: "Newer B", aim: "Newer aim", workspaceType: "writing" };
  await barrier.submit({ name: form.name, aim: form.aim, workspaceType: "writing" }, "typing");
  releaseMembership();
  await Promise.all([membership, save]);
  assert.equal(holder.workspace.name, "Newer B");
  assert.equal(holder.workspace.aim, "Newer aim");
  assert.equal(holder.workspace.workspaceType, "writing");

  const autosaved = applyWorkspaceMetadataAutosaveSnapshot(
    { ...holder.workspace, workspaceType: "research" },
    { name: "Autosaved", aim: "Only metadata", workspaceType: "writing" },
    "2026-07-16T09:02:00.000Z"
  );
  assert.equal(autosaved.workspaceType, "research");
});

test("queued type writer captures newest name aim and still normalizes roles", async () => {
  const holder = { workspace: workspace(3) };
  holder.workspace.tabs[0].role = "question";
  const barrier = createWorkspaceMetadataBarrier({
    commitSnapshot: async (snapshot) => {
      holder.workspace = applyWorkspaceMetadataAutosaveSnapshot(holder.workspace, snapshot, "2026-07-16T09:00:00.000Z");
      return { ok: true };
    }
  });
  let releaseMembership;
  const gate = new Promise((resolve) => { releaseMembership = resolve; });
  const membership = barrier.run(async () => { await gate; }, null);
  let form = { name: "Old", aim: "Old", workspaceType: "writing" };
  const typeChange = runWorkspaceMetadataWriterWithLatestSnapshot(
    barrier,
    () => structuredClone(form),
    (snapshot) => updateWorkspaceTypeAgainstLatest({ ...snapshot, eventId: "type-latest", updatedAt: "2026-07-16T09:03:00.000Z" }, metadataWriterAdapters(holder, {
      isValidWorkspaceRole: (_type, role) => ["unassigned", "source"].includes(role),
      getWorkspaceTypeLabel: (type) => type
    }))
  );
  await new Promise((resolve) => setImmediate(resolve));
  form = { name: "Newest", aim: "Newest aim", workspaceType: "writing" };
  await barrier.submit({ name: form.name, aim: form.aim }, "typing");
  releaseMembership();
  await Promise.all([membership, typeChange]);
  assert.equal(holder.workspace.name, "Newest");
  assert.equal(holder.workspace.aim, "Newest aim");
  assert.equal(holder.workspace.workspaceType, "writing");
  assert.equal(holder.workspace.tabs[0].role, "unassigned");
  assert.equal(holder.workspace.timeline.at(-1).type, "workspace_type_updated");
});

test("existing recovery records fail closed when exact browser identity is missing", () => {
  const existing = { ...tab(4), url: "https://example.test/recovery" };
  assert.equal(classifyExistingRecoveryMembership(existing, [{ id: existing.tabId, url: existing.url }]).decision, "existing_exact_live");
  const replacement = classifyExistingRecoveryMembership(existing, [{ id: 999, url: existing.url }]);
  assert.equal(replacement.decision, "existing_record_requires_refresh");
  assert.equal(replacement.liveTab.id, 999);
  assert.equal(classifyExistingRecoveryMembership(existing, []).decision, "existing_record_missing");
  assert.equal(classifyExistingRecoveryMembership(existing, [{ id: 998, url: existing.url }, { id: 999, url: existing.url }]).decision, "existing_record_ambiguous");
  assert.equal(classifyExistingRecoveryMembership(null, []).decision, "absent_record");
});

function metadataWriterAdapters(holder, overrides = {}) {
  return {
    withRuntimeStateLock: async (callback) => callback(),
    readCompatibleWorkspace: async () => {
      const value = structuredClone(holder.workspace);
      return { canonicalPresent: true, legacyPresent: true, canonicalValue: structuredClone(value), legacyValue: structuredClone(value), equivalent: true, conflict: false, value };
    },
    writeCompatibleWorkspace: async (workspaceValue) => { holder.workspace = structuredClone(workspaceValue); },
    isValidWorkspaceRole: overrides.isValidWorkspaceRole || (() => true),
    getWorkspaceTypeLabel: overrides.getWorkspaceTypeLabel || ((type) => type)
  };
}

function clientInput() {
  return {
    mutationKind: "active_tab",
    workspaceId: "workspace-1",
    sourceContextId: "context-1",
    sourceWindowId: 10,
    expectedWorkspaceRevision: 5,
    workspaceTabsToAdd: [tab(4)]
  };
}

function idSequence() {
  let next = 0;
  return () => "generated-id-" + (++next);
}

function verifiedMembershipResult(before, after) {
  const receipt = {
    receiptSchema: "constellation-workspace-membership-receipt-v0.1",
    mutationOperationId: "membership-op",
    mutationKind: "active_tab",
    workspaceId: "workspace-1",
    sourceContextId: "context-1",
    sourceWindowId: 10,
    workspaceRevisionBefore: 5,
    workspaceRevisionAfter: 6,
    previousEligibleTabCount: before,
    currentEligibleTabCount: after,
    addedWorkspaceTabIds: ["workspace-tab-4"],
    addedBrowserTabIds: [104],
    membershipWritten: true,
    membershipVerified: true,
    compatiblePeersVerified: true,
    requestedAt: "2026-07-16T08:00:00.000Z"
  };
  return createMembershipResult({
    operationId: "membership-op",
    mutationKind: "active_tab",
    workspaceId: "workspace-1",
    sourceContextId: "context-1",
    sourceWindowId: 10,
    expectedWorkspaceRevision: 5
  }, {
    status: "committed",
    reason: "membership_committed",
    requestFingerprint: "membership:fingerprint",
    workspaceRevisionBefore: 5,
    workspaceRevisionAfter: 6,
    membershipWritten: true,
    membershipVerified: true,
    compatiblePeersVerified: true,
    receipt
  });
}

function verifiedActivation(workspaceValue = workspace(3)) {
  return {
    status: "active",
    reason: "",
    result: {
      status: "no_change",
      sourceContextId: "context-1",
      sourceWindowId: 10,
      targetWindowId: 10,
      activeWorkspaceId: workspaceValue.workspaceId,
      activeWorkspaceRevision: workspaceValue.workspaceRevision,
      workspaceVerified: true,
      assignmentVerified: true,
      currentRuntimeAssignmentId: "assignment-1",
      currentAssignmentEpoch: 1
    }
  };
}

function membershipResponse(sent, before, after, status) {
  if (status === "failed") {
    return createMembershipResult({ ...sent, expectedWorkspaceRevision: sent.expectedWorkspaceRevision }, { status: "failed", reason: "fixture_membership_failure", retrySafe: true });
  }
  const receipt = {
    receiptSchema: "constellation-workspace-membership-receipt-v0.1",
    mutationOperationId: sent.operationId,
    mutationKind: sent.mutationKind,
    workspaceId: sent.workspaceId,
    sourceContextId: sent.sourceContextId,
    sourceWindowId: sent.sourceWindowId,
    workspaceRevisionBefore: sent.expectedWorkspaceRevision,
    workspaceRevisionAfter: sent.expectedWorkspaceRevision + 1,
    previousEligibleTabCount: before,
    currentEligibleTabCount: after,
    addedWorkspaceTabIds: sent.workspaceTabsToAdd.map((item) => item.workspaceTabId).sort(),
    addedBrowserTabIds: sent.workspaceTabsToAdd.map((item) => item.tabId).sort((left, right) => left - right),
    membershipWritten: true,
    membershipVerified: true,
    compatiblePeersVerified: true,
    requestedAt: sent.requestedAt
  };
  return createMembershipResult({ ...sent, expectedWorkspaceRevision: sent.expectedWorkspaceRevision }, {
    status,
    reason: status === "replayed" ? "operation_replayed" : "membership_committed",
    requestFingerprint: "membership:fixture",
    workspaceRevisionBefore: sent.expectedWorkspaceRevision,
    workspaceRevisionAfter: sent.expectedWorkspaceRevision + 1,
    membershipWritten: status === "committed",
    membershipVerified: true,
    compatiblePeersVerified: true,
    replayed: status === "replayed",
    receipt
  });
}

function promotionResponse(sent, status, moveMode = "create_dedicated_window") {
  return createPromotionResult({
    operationId: sent.operationId,
    triggerOperationId: sent.triggerOperationId,
    workspaceId: sent.workspaceId,
    sourceContextId: sent.sourceContextId,
    sourceWindowId: sent.sourceWindowId,
    threshold: sent.threshold,
    previousEligibleTabCount: sent.previousEligibleTabCount,
    currentEligibleTabCount: sent.currentEligibleTabCount,
    nextRuntimeAssignmentId: sent.nextRuntimeAssignmentId
  }, status === "failed" ? {
    status: "failed",
    reason: "fixture_promotion_failure",
    decision: "retry_transaction",
    phase: "browser_move",
    retrySafe: true
  } : {
    status,
    reason: status === "replayed" ? "operation_replayed" : "automatic_promotion_committed",
    decision: "use_dedicated_window",
    phase: "complete",
    workspaceRevisionBefore: sent.expectedWorkspaceRevision,
    workspaceRevisionAfter: sent.expectedWorkspaceRevision + 1,
    moveMode,
    moveOperationId: sent.operationId + ":move",
    moveStatus: "completed_verified",
    targetWindowId: 20,
    browserMutationStarted: true,
    browserMutationVerified: true,
    runtimeSessionId: "session-1",
    authorityRevisionBefore: 1,
    authorityRevisionAfter: 2,
    previousRuntimeAssignmentId: "assignment-1",
    previousAssignmentEpoch: 1,
    nextAssignmentEpoch: 2,
    assignmentTransferred: moveMode === "create_dedicated_window",
    assignmentVerified: true,
    workspacePlacementWritten: true,
    workspacePlacementVerified: true,
    replayed: status === "replayed"
  });
}

function promotionRequestFor(membershipRequest, receipt) {
  return {
    operationId: membershipRequest.promotionOperationId,
    triggerOperationId: membershipRequest.operationId,
    workspaceId: membershipRequest.workspaceId,
    sourceContextId: membershipRequest.sourceContextId,
    sourceWindowId: membershipRequest.sourceWindowId,
    expectedWorkspaceRevision: receipt.workspaceRevisionAfter,
    threshold: 4,
    previousEligibleTabCount: receipt.previousEligibleTabCount,
    currentEligibleTabCount: receipt.currentEligibleTabCount,
    nextRuntimeAssignmentId: membershipRequest.nextRuntimeAssignmentId
  };
}

function fakeElement() {
  return {
    attributes: {},
    dataset: {},
    hidden: true,
    textContent: "",
    setAttribute(name, value) { this.attributes[name] = value; }
  };
}

function createSequencerFixture({ before = 3, after = 4, membershipStatus = "committed", onPromotion = () => undefined, onFinalizer = () => undefined } = {}) {
  const sequencer = createWorkspaceMembershipPromotionSequencer({
    createId: idSequence(),
    now: () => "2026-07-16T08:00:00.000Z",
    activateWorkspace: async (workspace) => verifiedActivation(workspace),
    runMetadataBarrier: async (work) => work(),
    sendMembership: async (sent) => membershipResponse(sent, before, after, membershipStatus),
    sendPromotion: async (sent) => { onPromotion(); return promotionResponse(sent, "committed"); }
  });
  return {
    sequencer,
    input: {
      mutationKind: "active_tab",
      workspaceId: "workspace-1",
      workspace: workspace(3),
      workspaceTabsToAdd: [tab(4)],
      afterMembership: async () => onFinalizer()
    }
  };
}

function extractFunction(source, name) {
  const start = source.indexOf("async function " + name + "(");
  assert.notEqual(start, -1, name + " must exist");
  const next = source.indexOf("\nasync function ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
