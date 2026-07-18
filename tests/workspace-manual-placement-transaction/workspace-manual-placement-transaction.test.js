import assert from "node:assert/strict";
import test from "node:test";

import { createOperationLedger, recordOperation } from "../../src/core/runtime-contract/ledger.js";
import { createActivationResult, normalizeActivationIdentities } from "../../src/core/runtime-workspace-activation/contract.js";
import { createActivationRequestFingerprint } from "../../src/core/runtime-workspace-activation/fingerprint.js";
import {
  MANUAL_PLACEMENT_REQUEST_FIELDS,
  MANUAL_PLACEMENT_RESULT_FIELDS,
  MANUAL_PLACEMENT_REQUEST_SCHEMA,
  MANUAL_PLACEMENT_TYPE,
  createManualPlacementResult,
  normalizeManualPlacementIdentities,
  snapshotAndValidateManualPlacementRequest,
  validateManualPlacementMoveEvidence,
  validateManualPlacementResult
} from "../../src/core/workspace-manual-placement-transaction/contract.js";
import { createWorkspaceManualPlacementClient } from "../../src/core/workspace-manual-placement-transaction/client.js";
import { createWorkspaceManualPlacementChromeAdapters } from "../../src/core/workspace-manual-placement-transaction/chrome-adapter.js";
import { coordinateWorkspaceManualPlacement } from "../../src/core/workspace-manual-placement-transaction/coordinator.js";
import { createManualPlacementFingerprint } from "../../src/core/workspace-manual-placement-transaction/fingerprint.js";

const NOW = "2026-07-17T11:00:00.000Z";

test("manual placement request and result contracts are exact and hostile-input safe", async () => {
  const request = manualRequest();
  const validation = snapshotAndValidateManualPlacementRequest(request);
  assert.equal(validation.ok, true, validation.errors?.join("; "));
  assert.deepEqual(Object.keys(validation.value).sort(), [...MANUAL_PLACEMENT_REQUEST_FIELDS].sort());
  assert.equal(snapshotAndValidateManualPlacementRequest({ ...request, unknown: true }).ok, false);
  const cyclic = manualRequest(); cyclic.moveRequest.cycle = cyclic;
  assert.equal(snapshotAndValidateManualPlacementRequest(cyclic).ok, false);
  const result = await coordinateWorkspaceManualPlacement({ ...request, unknown: true }, {});
  assert.deepEqual(Object.keys(result).sort(), [...MANUAL_PLACEMENT_RESULT_FIELDS].sort());
  assert.equal(validateManualPlacementResult(result), true);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("manual placement orders pending evidence before move then transfer then placement", async () => {
  const fixture = manualFixture();
  const result = await coordinateWorkspaceManualPlacement(manualRequest(), fixture.adapters);
  assert.equal(result.status, "committed");
  assert.equal(result.assignmentVerified, true);
  assert.equal(result.workspacePlacementVerified, true);
  assert.equal(result.timelineEvidenceVerified, true);
  assert.equal(result.timelineEvidenceWritten, true);
  assert.deepEqual(fixture.state.order, ["ledger", "ledger", "move", "ledger", "transfer", "ledger", "placement", "ledger"]);
  assert.equal(fixture.state.moveCalls, 1);
  assert.equal(fixture.state.transferCalls, 1);
  assert.equal(fixture.state.placementCalls, 1);
  assert.equal(fixture.state.placementState.workspaceRevision, 3);
  assert.equal(fixture.state.placementState.dedicatedWindowId, 20);
  assert.equal(fixture.state.timeline.length, 1);
  assert.equal(fixture.state.timeline[0].eventId, result.timelineEventId);
  assert.equal(fixture.state.timeline[0].evidenceOwner, "service_worker_manual_placement_transaction");
});

test("manual Chrome adapter rereads exact timeline evidence through compatible workspace peers", async () => {
  const fixture = manualFixture();
  const result = await coordinateWorkspaceManualPlacement(manualRequest(), fixture.adapters);
  const timelineEvent = structuredClone(fixture.state.timeline[0]);
  const workspace = { workspaceId: "workspace-1", timeline: [timelineEvent] };
  const adapters = createWorkspaceManualPlacementChromeAdapters({}, {
    readCompatibleWorkspace: async () => ({
      canonicalPresent: true,
      legacyPresent: true,
      equivalent: true,
      conflict: false,
      canonicalValue: structuredClone(workspace),
      legacyValue: structuredClone(workspace),
      value: structuredClone(workspace)
    })
  });
  const verified = await adapters.readManualPlacementEvidence({ workspaceId: "workspace-1", timelineEvent });
  assert.deepEqual(verified, { status: "verified", count: 1, error: "" });
  const conflict = await adapters.readManualPlacementEvidence({ workspaceId: "workspace-1", timelineEvent: { ...timelineEvent, message: "forged" } });
  assert.deepEqual(conflict, { status: "conflict", count: 1, error: "manual_placement_timeline_evidence_conflict" });
  assert.equal(result.timelineEvidenceVerified, true);
});

test("manual committed results require exact nested move and activation evidence", async () => {
  const request = manualRequest();
  const fixture = manualFixture();
  const result = await coordinateWorkspaceManualPlacement(request, fixture.adapters);
  assert.equal(validateManualPlacementResult(result, request), true);
  for (const malformed of [
    { ...result, moveResult: {} },
    { ...result, moveResult: { ...result.moveResult, createdGroups: [{}] } },
    { ...result, moveResult: { ...result.moveResult, verification: {} } },
    { ...result, moveResult: { ...result.moveResult, verification: result.moveResult.verification.map((check, index) => index === 0 ? { ...check, passed: false } : check) } },
    { ...result, activationResult: {} },
    { ...result, warnings: {} },
    { ...result, errors: "forged" },
    { ...result, currentRuntimeAssignmentId: "wrong-assignment" }
  ]) assert.equal(validateManualPlacementResult(malformed, request), false);

  const client = createWorkspaceManualPlacementClient({
    createId: clientIdSequence(),
    now: () => NOW,
    send: async (clientRequest) => createManualPlacementResult(normalizeManualPlacementIdentities(clientRequest), {
      status: "committed", reason: "forged_success", decision: "use_dedicated_window", phase: "complete",
      requestFingerprint: createManualPlacementFingerprint(clientRequest), targetWindowId: 20,
      workspaceRevisionAfter: clientRequest.expectedWorkspaceRevision + 1,
      browserMutationStarted: true, browserMutationVerified: true, assignmentTransferred: true, assignmentVerified: true,
      workspacePlacementWritten: true, workspacePlacementVerified: true,
      currentRuntimeAssignmentId: clientRequest.nextRuntimeAssignmentId, currentAssignmentEpoch: clientRequest.expectedAssignmentEpoch + 1,
      moveResult: {}, activationResult: {}
    })
  });
  const rejected = await client.submit(manualClientInput());
  assert.equal(rejected.status, "failed");
  assert.equal(rejected.reason, "malformed_or_mismatched_manual_placement_response");
  assert.notEqual(client.pendingRequest, null);
});

test("manual move evidence requires exact passed checks and exact created-group bindings", () => {
  const request = manualRequest();
  const roleLabel = "Workspace · Research";
  request.moveRequest.tabs = request.moveRequest.tabs.map((tab) => ({ ...tab, role: "research", roleLabel }));
  request.moveRequest.groups = [{ role: "research", roleLabel, workspaceTabIds: ["tab-a", "tab-b"], collapsed: false }];
  assert.equal(snapshotAndValidateManualPlacementRequest(request).ok, true);
  const evidence = moveResult(request.moveRequest);
  evidence.unassignedTabIds = [];
  evidence.createdGroups = [{
    groupId: 501,
    windowId: 20,
    role: "research",
    roleLabel,
    workspaceTabIds: ["tab-a", "tab-b"],
    tabIds: [101, 102],
    title: roleLabel,
    colour: "blue",
    collapsed: false
  }];
  assert.equal(validateManualPlacementMoveEvidence(evidence, request), true);
  assert.equal(validateManualPlacementMoveEvidence({ ...evidence, createdGroups: [{ ...evidence.createdGroups[0], tabIds: [101] }] }, request), false);
  assert.equal(validateManualPlacementMoveEvidence({ ...evidence, createdGroups: [{ ...evidence.createdGroups[0], unknown: true }] }, request), false);
  assert.equal(validateManualPlacementMoveEvidence({ ...evidence, verification: evidence.verification.slice(0, -1) }, request), false);
});

test("manual placement browser failure leaves assignment and placement untouched", async () => {
  const fixture = manualFixture({ moveMode: "failed" });
  const result = await coordinateWorkspaceManualPlacement(manualRequest(), fixture.adapters);
  assert.equal(result.status, "failed");
  assert.equal(result.browserMutationVerified, false);
  assert.equal(fixture.state.transferCalls, 0);
  assert.equal(fixture.state.placementCalls, 0);
  assert.equal(fixture.state.placementState.workspaceRevision, 2);
});

test("manual placement requires exact source-assignment evidence before browser mutation", async () => {
  const fixture = manualFixture();
  const result = await coordinateWorkspaceManualPlacement(manualRequest({ expectedRuntimeAssignmentId: null, expectedAssignmentEpoch: null }), fixture.adapters);
  assert.equal(result.status, "invalid");
  assert.equal(fixture.state.moveCalls, 0);
  assert.equal(fixture.state.transferCalls, 0);
  assert.equal(fixture.state.placementCalls, 0);
});

test("lost move-result recording remains indeterminate and suppresses a second destination", async () => {
  const fixture = manualFixture({ failLedgerWriteAt: 3 });
  const request = manualRequest();
  const first = await coordinateWorkspaceManualPlacement(request, fixture.adapters);
  assert.equal(first.status, "indeterminate");
  assert.equal(first.browserMutationVerified, true);
  assert.equal(fixture.state.moveCalls, 1);
  fixture.state.failLedgerWriteAt = 0;
  const second = await coordinateWorkspaceManualPlacement(request, fixture.adapters);
  assert.equal(second.status, "indeterminate");
  assert.equal(second.reason, "pending_browser_move_unresolved");
  assert.equal(second.browserMutationVerified, false);
  assert.equal(second.warnings.includes("second_destination_suppressed"), true);
  assert.equal(fixture.state.moveCalls, 1);
  assert.equal(fixture.state.transferCalls, 0);
  assert.equal(fixture.state.placementCalls, 0);
});

test("an unresolved partial browser move suppresses every later destination creation", async () => {
  const fixture = manualFixture({ moveMode: "partial" });
  const request = manualRequest();
  const first = await coordinateWorkspaceManualPlacement(request, fixture.adapters);
  assert.equal(first.status, "indeterminate");
  assert.equal(first.browserMutationStarted, true);
  assert.equal(fixture.state.moveCalls, 1);
  const second = await coordinateWorkspaceManualPlacement(request, fixture.adapters);
  assert.equal(second.status, "indeterminate");
  assert.equal(second.reason, "pending_browser_move_unresolved");
  assert.equal(second.warnings.includes("second_destination_suppressed"), true);
  assert.equal(fixture.state.moveCalls, 1);
  assert.equal(fixture.state.transferCalls, 0);
});

test("transfer conflict after browser move preserves unresolved evidence and blocks placement", async () => {
  const fixture = manualFixture({ transferMode: "conflict" });
  const result = await coordinateWorkspaceManualPlacement(manualRequest(), fixture.adapters);
  assert.equal(result.status, "indeterminate");
  assert.equal(result.browserMutationVerified, true);
  assert.equal(result.assignmentVerified, false);
  assert.equal(result.targetWindowId, 20);
  assert.equal(fixture.state.placementCalls, 0);
});

test("lost post-transfer pending write recovers shared transfer evidence without retransfer", async () => {
  const fixture = manualFixture({ failLedgerWriteAt: 4, transferRecordsLedger: true });
  const request = manualRequest();
  const first = await coordinateWorkspaceManualPlacement(request, fixture.adapters);
  assert.equal(first.status, "indeterminate");
  assert.equal(first.assignmentVerified, true);
  assert.equal(fixture.state.transferCalls, 1);
  fixture.state.failLedgerWriteAt = 0;
  const second = await coordinateWorkspaceManualPlacement(request, fixture.adapters);
  assert.equal(second.status, "committed");
  assert.equal(fixture.state.transferCalls, 1);
  assert.equal(fixture.state.moveCalls, 1);
  assert.equal(second.warnings.includes("verified_transfer_recovered_from_shared_ledger"), true);
});

test("shared transfer recovery requires the exact activation ledger fingerprint", async () => {
  const fixture = manualFixture({ failLedgerWriteAt: 4, transferRecordsLedger: true, transferLedgerFingerprintMismatch: true, transferConflictAfterFirst: true });
  const request = manualRequest();
  const first = await coordinateWorkspaceManualPlacement(request, fixture.adapters);
  assert.equal(first.status, "indeterminate");
  fixture.state.failLedgerWriteAt = 0;
  const retry = await coordinateWorkspaceManualPlacement(request, fixture.adapters);
  assert.equal(retry.status, "indeterminate");
  assert.equal(retry.reason, "assignment_transfer_not_verified");
  assert.equal(retry.warnings.includes("verified_transfer_recovered_from_shared_ledger"), false);
  assert.equal(fixture.state.transferCalls, 2);
  assert.equal(fixture.state.placementCalls, 0);
});

test("placement write uncertainty proved by reread rolls forward", async () => {
  const fixture = manualFixture({ placementMode: "write_then_fail" });
  const result = await coordinateWorkspaceManualPlacement(manualRequest(), fixture.adapters);
  assert.equal(result.status, "committed");
  assert.equal(result.workspacePlacementWritten, false);
  assert.equal(result.workspacePlacementVerified, true);
  assert.equal(result.timelineEvidenceWritten, false);
  assert.equal(result.timelineEvidenceVerified, true);
  assert.equal(fixture.state.timeline.length, 1);
  assert.equal(result.warnings.includes("placement_write_outcome_verified_by_reread"), true);
});

test("post-transfer placement retry does not move again or retransfer", async () => {
  const fixture = manualFixture({ placementMode: "disagree" });
  const request = manualRequest();
  const first = await coordinateWorkspaceManualPlacement(request, fixture.adapters);
  assert.equal(first.status, "indeterminate");
  assert.equal(first.assignmentVerified, true);
  assert.equal(fixture.state.moveCalls, 1);
  assert.equal(fixture.state.transferCalls, 1);
  fixture.adapters.writeWorkspacePlacement = async ({ nextWorkspaceRevision, dedicatedWindowId, timelineEvent }) => {
    fixture.state.placementCalls += 1;
    fixture.state.order.push("placement");
    fixture.state.placementState.workspaceRevision = nextWorkspaceRevision;
    fixture.state.placementState.placementMode = "dedicated_window";
    fixture.state.placementState.dedicatedWindowId = dedicatedWindowId;
    appendTimelineEvidence(fixture.state, timelineEvent);
    return { status: "written", workspaceRevision: nextWorkspaceRevision, error: "" };
  };
  const retry = await coordinateWorkspaceManualPlacement(request, fixture.adapters);
  assert.equal(retry.status, "committed");
  assert.equal(fixture.state.moveCalls, 1);
  assert.equal(fixture.state.transferCalls, 1);
  assert.equal(fixture.state.placementCalls, 2);
  assert.equal(fixture.state.timeline.length, 1);
  assert.equal(retry.timelineEvidenceVerified, true);
});

test("post-transfer terminalization retry reuses one verified timeline record without another placement write", async () => {
  const fixture = manualFixture({ failLedgerWriteAt: 5 });
  const request = manualRequest();
  const first = await coordinateWorkspaceManualPlacement(request, fixture.adapters);
  assert.equal(first.status, "indeterminate");
  assert.equal(first.workspacePlacementVerified, true);
  assert.equal(first.timelineEvidenceVerified, true);
  assert.equal(fixture.state.placementCalls, 1);
  assert.equal(fixture.state.timeline.length, 1);
  fixture.state.failLedgerWriteAt = 0;
  const retry = await coordinateWorkspaceManualPlacement(request, fixture.adapters);
  assert.equal(retry.status, "committed");
  assert.equal(retry.timelineEvidenceVerified, true);
  assert.equal(fixture.state.moveCalls, 1);
  assert.equal(fixture.state.transferCalls, 1);
  assert.equal(fixture.state.placementCalls, 1);
  assert.equal(fixture.state.timeline.length, 1);
});

test("manual transaction leaves unrelated browser evidence untouched and emits no promotion action", async () => {
  const fixture = manualFixture();
  const unrelatedBefore = structuredClone(fixture.state.unrelatedTab);
  const result = await coordinateWorkspaceManualPlacement(manualRequest(), fixture.adapters);
  assert.equal(result.status, "committed");
  assert.deepEqual(fixture.state.unrelatedTab, unrelatedBefore);
  assert.equal(fixture.state.order.includes("promotion"), false);
});

test("terminal replay invokes neither browser move transfer nor placement write", async () => {
  const fixture = manualFixture();
  const request = manualRequest();
  assert.equal((await coordinateWorkspaceManualPlacement(request, fixture.adapters)).status, "committed");
  const replay = await coordinateWorkspaceManualPlacement(request, fixture.adapters);
  assert.equal(replay.status, "replayed");
  assert.equal(replay.replayed, true);
  assert.equal(fixture.state.moveCalls, 1);
  assert.equal(fixture.state.transferCalls, 1);
  assert.equal(fixture.state.placementCalls, 1);
  assert.equal(fixture.state.timeline.length, 1);
});

test("manual placement operation fingerprint conflict fails closed", async () => {
  const fixture = manualFixture();
  assert.equal((await coordinateWorkspaceManualPlacement(manualRequest(), fixture.adapters)).status, "committed");
  const conflict = await coordinateWorkspaceManualPlacement(manualRequest({ expectedWorkspaceRevision: 3 }), fixture.adapters);
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.reason, "operation_id_conflict");
});

test("corrupted pending move evidence conflicts before move transfer or placement", async () => {
  const fixture = manualFixture({ failLedgerWriteAt: 3 });
  const request = manualRequest();
  assert.equal((await coordinateWorkspaceManualPlacement(request, fixture.adapters)).status, "indeterminate");
  const pending = fixture.state.ledger.entries.find((entry) => entry.operationId === request.operationId).result;
  pending.moveResult = { status: "completed_verified", targetWindowId: 20 };
  pending.targetWindowId = 20;
  fixture.state.failLedgerWriteAt = 0;
  const result = await coordinateWorkspaceManualPlacement(request, fixture.adapters);
  assert.equal(result.status, "conflict");
  assert.equal(result.reason, "pending_move_evidence_invalid");
  assert.equal(fixture.state.moveCalls, 1);
  assert.equal(fixture.state.transferCalls, 0);
  assert.equal(fixture.state.placementCalls, 0);
});

test("detached manual exclusive callback cannot record pending evidence or start a browser move", async () => {
  const fixture = manualFixture();
  let detached;
  fixture.adapters.runExclusiveOperation = (callback) => {
    detached = callback();
    return undefined;
  };
  const result = await coordinateWorkspaceManualPlacement(manualRequest(), fixture.adapters);
  assert.equal(result.status, "failed");
  await detached;
  assert.equal(fixture.state.ledgerWriteAttempts, 0);
  assert.equal(fixture.state.moveCalls, 0);
  assert.equal(fixture.state.transferCalls, 0);
});

test("manual client preserves its pending request and rejects mismatched later input", async () => {
  let sends = 0;
  let responseReasonReads = 0;
  const observed = [];
  const client = createWorkspaceManualPlacementClient({
    createId: clientIdSequence(),
    now: () => NOW,
    send: async (request) => {
      const original = structuredClone(request);
      observed.push(original);
      sends += 1;
      request.workspaceId = "mutated-by-send";
      const response = createManualPlacementResult(normalizeManualPlacementIdentities(original), { status: "failed", reason: "retry_manual", decision: "retry_transaction", phase: "state_reread", requestFingerprint: createManualPlacementFingerprint(original), retrySafe: true });
      Object.defineProperty(response, "reason", { enumerable: true, get() { responseReasonReads += 1; return responseReasonReads === 1 ? "retry_manual" : "changed_after_snapshot"; } });
      return response;
    }
  });
  const input = manualClientInput();
  const first = await client.submit(input);
  assert.equal(first.reason, "retry_manual");
  assert.equal(responseReasonReads, 1);
  await client.submit(input);
  assert.deepEqual(observed[1], observed[0]);
  const mismatch = await client.submit({ ...input, expectedWorkspaceRevision: 3 });
  assert.equal(mismatch.status, "conflict");
  assert.equal(mismatch.reason, "manual_placement_pending_input_mismatch");
  assert.equal(sends, 2);
  assert.equal(client.pendingRequest.expectedWorkspaceRevision, 2);
});

test("final browser-placement disagreement can never report success", async () => {
  const fixture = manualFixture({ placementMode: "disagree" });
  const result = await coordinateWorkspaceManualPlacement(manualRequest(), fixture.adapters);
  assert.equal(result.status, "indeterminate");
  assert.equal(result.workspacePlacementVerified, false);
});

function manualRequest(overrides = {}) {
  return {
    type: MANUAL_PLACEMENT_TYPE,
    schema: MANUAL_PLACEMENT_REQUEST_SCHEMA,
    operationId: "manual-op",
    workspaceId: "workspace-1",
    sourceContextId: "context-1",
    sourceWindowId: 10,
    expectedWorkspaceRevision: 2,
    expectedRuntimeAssignmentId: "assignment-old",
    expectedAssignmentEpoch: 1,
    transferOperationId: "manual-transfer-op",
    nextRuntimeAssignmentId: "assignment-new",
    requestedAt: NOW,
    moveRequest: {
      schema: "constellation-workspace-existing-tab-move-request-v0.1",
      operationId: "manual-move-op",
      workspaceId: "workspace-1",
      mode: "create_dedicated_window",
      sourceWindowIds: [10],
      targetWindowId: null,
      requestedAt: NOW,
      tabs: [
        { workspaceTabId: "tab-a", tabId: 101, sourceWindowId: 10, sourceGroupId: -1, role: "unassigned", roleLabel: "Unassigned", order: 0 },
        { workspaceTabId: "tab-b", tabId: 102, sourceWindowId: 10, sourceGroupId: -1, role: "unassigned", roleLabel: "Unassigned", order: 1 }
      ],
      groups: []
    },
    ...overrides
  };
}

function manualFixture(options = {}) {
  const state = {
    ledger: createOperationLedger(),
    ledgerWriteAttempts: 0,
    failLedgerWriteAt: options.failLedgerWriteAt || 0,
    moveCalls: 0,
    transferCalls: 0,
    placementCalls: 0,
    order: [],
    timeline: [],
    unrelatedTab: { tabId: 999, windowId: 30, workspaceId: "unrelated-workspace" },
    placementState: placementState()
  };
  const adapters = {
    runExclusiveOperation: async (callback) => callback(),
    readOperationLedger: async () => ({ status: "present", ledger: structuredClone(state.ledger), error: "" }),
    writeOperationLedger: async (ledger) => {
      state.ledgerWriteAttempts += 1;
      if (state.failLedgerWriteAt === state.ledgerWriteAttempts) return { status: "failed", error: "injected" };
      state.ledger = structuredClone(ledger);
      state.order.push("ledger");
      return { status: "written", error: "" };
    },
    readPlacementState: async () => structuredClone(state.placementState),
    readManualPlacementEvidence: async ({ timelineEvent }) => {
      const matches = state.timeline.filter((event) => event.eventId === timelineEvent.eventId);
      if (matches.length === 0) return { status: "missing", count: 0, error: "manual_placement_timeline_evidence_missing" };
      if (matches.length !== 1 || JSON.stringify(matches[0]) !== JSON.stringify(timelineEvent)) return { status: "conflict", count: matches.length, error: "manual_placement_timeline_evidence_conflict" };
      return { status: "verified", count: 1, error: "" };
    },
    executeExistingTabMove: async (request) => {
      state.moveCalls += 1;
      state.order.push("move");
      if (options.moveMode === "failed") return { ...moveResult(request), status: "failed", reason: "injected", browserMutationStarted: false, browserMutationVerified: false };
      if (options.moveMode === "partial") {
        state.placementState.sourceWindowIds = [10, 20];
        state.placementState.tabs = state.placementState.tabs.map((tab, index) => ({ ...tab, sourceWindowId: index === 0 ? 20 : 10 }));
        return { ...moveResult(request), status: "indeterminate", reason: "partial_move", browserMutationStarted: true, browserMutationVerified: false, movedTabIds: [101] };
      }
      state.placementState.sourceWindowIds = [20];
      state.placementState.tabs = state.placementState.tabs.map((tab) => ({ ...tab, sourceWindowId: 20 }));
      return moveResult(request);
    },
    transferActive: async (request) => {
      state.transferCalls += 1;
      state.order.push("transfer");
      const mode = options.transferConflictAfterFirst && state.transferCalls > 1 ? "conflict" : options.transferMode || "committed";
      const result = activationResult(request, mode);
      if (options.transferRecordsLedger && result.status === "committed") {
        const recorded = recordOperation(state.ledger, { operationId: request.operationId, requestFingerprint: options.transferLedgerFingerprintMismatch ? "mismatched-transfer-fingerprint" : createActivationRequestFingerprint(request), result, recordedAt: request.requestedAt });
        if (recorded.status === "recorded") state.ledger = recorded.ledger;
      }
      return result;
    },
    writeWorkspacePlacement: async ({ nextWorkspaceRevision, dedicatedWindowId, timelineEvent }) => {
      state.placementCalls += 1;
      state.order.push("placement");
      if (options.placementMode !== "disagree") {
        state.placementState.workspaceRevision = nextWorkspaceRevision;
        state.placementState.placementMode = "dedicated_window";
        state.placementState.dedicatedWindowId = dedicatedWindowId;
        appendTimelineEvidence(state, timelineEvent);
      }
      return options.placementMode === "write_then_fail"
        ? { status: "failed", workspaceRevision: 2, error: "injected" }
        : { status: "written", workspaceRevision: nextWorkspaceRevision, error: "" };
    }
  };
  return { state, adapters };
}

function appendTimelineEvidence(state, timelineEvent) {
  const matches = state.timeline.filter((event) => event.eventId === timelineEvent.eventId);
  if (matches.length === 0) state.timeline.push(structuredClone(timelineEvent));
}

function placementState() {
  return {
    schema: "constellation-workspace-automatic-promotion-state-v0.1",
    status: "present",
    workspaceId: "workspace-1",
    workspaceRevision: 2,
    eligibleTabCount: 2,
    placementMode: "current_window",
    dedicatedWindowId: null,
    sourceWindowIds: [10],
    tabs: [
      { workspaceTabId: "tab-a", tabId: 101, sourceWindowId: 10, sourceGroupId: -1, role: "unassigned", roleLabel: "Unassigned", order: 0 },
      { workspaceTabId: "tab-b", tabId: 102, sourceWindowId: 10, sourceGroupId: -1, role: "unassigned", roleLabel: "Unassigned", order: 1 }
    ],
    groups: [],
    error: ""
  };
}

function moveResult(request) {
  return {
    schema: "constellation-workspace-existing-tab-move-result-v0.1",
    status: "completed_verified",
    reason: "move_completed_verified",
    operationId: request.operationId,
    workspaceId: request.workspaceId,
    mode: request.mode,
    targetWindowId: 20,
    createdWindow: true,
    browserMutationStarted: true,
    browserMutationVerified: true,
    movedTabIds: [101, 102],
    alreadyInTargetTabIds: [],
    unassignedTabIds: [101, 102],
    createdGroups: [],
    verification: successfulMoveVerification(),
    retrySafe: false,
    warnings: [],
    errors: []
  };
}

function successfulMoveVerification() {
  return [
    "target_window_exists", "created_window_was_not_present_before", "exactly_one_destination_window_created",
    "no_additional_window_created", "all_planned_tabs_exist", "all_planned_tabs_are_in_target",
    "no_unrelated_tab_moved", "no_planned_tab_duplicated", "assigned_group_count_matches_plan",
    "assigned_group_membership_matches_plan", "unassigned_tabs_are_ungrouped", "group_titles_match_semantic_plan",
    "represented_group_colour_matches", "represented_group_collapsed_state_matches", "target_window_focused",
    "final_projection_is_serializable"
  ].map((id) => ({ id, passed: true }));
}

function activationResult(request, status) {
  if (status === "conflict") return createActivationResult(normalizeActivationIdentities(request), { status: "conflict", reason: "target_window_occupied", decision: "manual_resolution_required", phase: "assignment_transition", requestFingerprint: createActivationRequestFingerprint(request), targetWindowId: request.targetWindowId, activeWorkspaceId: request.expectedWorkspaceId, activeWorkspaceRevision: request.expectedWorkspaceRevision });
  return createActivationResult(normalizeActivationIdentities(request), { status: "committed", reason: "activation_committed", decision: "use_active_workspace", phase: "complete", requestFingerprint: createActivationRequestFingerprint(request), targetWindowId: request.targetWindowId, activeWorkspaceId: request.expectedWorkspaceId, activeWorkspaceRevision: request.expectedWorkspaceRevision, workspaceVerified: true, assignmentWritten: true, assignmentVerified: true, runtimeSessionId: "session-1", authorityRevisionBefore: 0, authorityRevisionAfter: 1, previousRuntimeAssignmentId: request.expectedRuntimeAssignmentId, previousAssignmentEpoch: request.expectedAssignmentEpoch, currentRuntimeAssignmentId: request.nextRuntimeAssignmentId, currentAssignmentEpoch: 2 });
}

function manualClientInput() {
  const request = manualRequest();
  return {
    workspaceId: request.workspaceId,
    sourceContextId: request.sourceContextId,
    sourceWindowId: request.sourceWindowId,
    expectedWorkspaceRevision: request.expectedWorkspaceRevision,
    expectedRuntimeAssignmentId: request.expectedRuntimeAssignmentId,
    expectedAssignmentEpoch: request.expectedAssignmentEpoch,
    moveRequest: request.moveRequest
  };
}

function clientIdSequence() {
  let next = 0;
  return () => `client-id-${++next}`;
}
