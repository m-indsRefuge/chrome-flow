import assert from "node:assert/strict";
import test from "node:test";

import {
  assignRuntime,
  createAssignmentRegistry,
  releaseRuntime,
  replaceRuntimeAssignment,
  resolveAssignmentByWorkspace,
  validateAssignmentRegistry
} from "../../src/core/runtime-contract/assignments.js";
import { createOperationLedger, recordOperation } from "../../src/core/runtime-contract/ledger.js";
import {
  ACTIVATION_REQUEST_FIELDS,
  ACTIVATION_RESULT_FIELDS,
  RUNTIME_WORKSPACE_ACTIVATION_PENDING_SCHEMA,
  RUNTIME_WORKSPACE_ACTIVATION_REQUEST_SCHEMA,
  RUNTIME_WORKSPACE_ACTIVATION_TYPE,
  createActivationPending,
  createActivationResult,
  normalizeActivationIdentities,
  snapshotAndValidateActivationRequest,
  validateActivationPending,
  validateActivationResult
} from "../../src/core/runtime-workspace-activation/contract.js";
import { coordinateRuntimeWorkspaceActivation } from "../../src/core/runtime-workspace-activation/coordinator.js";
import { createActivationRequestFingerprint } from "../../src/core/runtime-workspace-activation/fingerprint.js";
import { createRuntimeWorkspaceActivationClient } from "../../src/core/runtime-workspace-activation/client.js";
import { createRuntimeWorkspaceActivationChromeAdapters } from "../../src/core/runtime-workspace-activation/chrome-adapter.js";
import { handleRuntimeWorkspaceActivationMessage } from "../../src/core/runtime-workspace-activation/service-worker-handler.js";

const NOW = "2026-07-17T10:00:00.000Z";
const PANEL_URL = "chrome-extension://extension-id/src/sidepanel/sidepanel.html";

test("activation contract snapshots exact fields and separates all three operations", () => {
  for (const value of [bootstrapRequest(), replaceRequest(), transferRequest()]) {
    const validation = snapshotAndValidateActivationRequest(value);
    assert.equal(validation.ok, true, validation.errors?.join("; "));
    assert.deepEqual(Object.keys(validation.value).sort(), [...ACTIVATION_REQUEST_FIELDS].sort());
    assert.notEqual(createActivationRequestFingerprint(value), "");
  }
  assert.notEqual(createActivationRequestFingerprint(bootstrapRequest()), createActivationRequestFingerprint(transferRequest()));
  assert.equal(snapshotAndValidateActivationRequest({ ...bootstrapRequest(), extra: true }).ok, false);
  assert.equal(snapshotAndValidateActivationRequest(1).ok, false);
  assert.equal(snapshotAndValidateActivationRequest(Object.create({})).ok, false);
});

test("activation contract rejects hostile snapshots and reads getters once", () => {
  for (const hostile of hostileRequests()) assert.equal(snapshotAndValidateActivationRequest(hostile).ok, false);
  const value = bootstrapRequest();
  let reads = 0;
  Object.defineProperty(value, "operationId", { enumerable: true, get() { reads += 1; return "activation-op"; } });
  assert.equal(snapshotAndValidateActivationRequest(value).ok, true);
  assert.equal(reads, 1);
});

test("activation results are exact total serializable shapes", () => {
  const request = bootstrapRequest();
  const identities = normalizeActivationIdentities(request);
  const result = createActivationResult(identities, { status: "failed", reason: "test_failure", decision: "retry_activation", phase: "workspace_reread", retrySafe: true });
  assert.deepEqual(Object.keys(result).sort(), [...ACTIVATION_RESULT_FIELDS].sort());
  assert.equal(validateActivationResult(result, request), true);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.equal(validateActivationResult({ ...result, unknown: true }, request), false);
  assert.equal(validateActivationResult({ ...result, previousRuntimeAssignmentId: {} }, request), false);
});

test("atomic replacement releases exact prior assignment and issues one epoch", () => {
  const registry = assignedRegistry("workspace-old", 10, "assignment-old");
  const transition = replaceRuntimeAssignment(registry, {
    expectedWorkspaceId: "workspace-old",
    candidateWorkspaceId: "workspace-new",
    windowId: 10,
    sourceContextId: "context-1",
    expectedWindowId: 10,
    expectedRuntimeAssignmentId: "assignment-old",
    expectedAssignmentEpoch: 1,
    now: NOW,
    id: () => "assignment-new"
  });
  assert.equal(transition.status, "assigned");
  assert.equal(transition.registry.nextEpoch, 3);
  assert.equal(transition.registry.assignments.length, 2);
  assert.equal(transition.registry.assignments[0].state, "released");
  assert.equal(transition.assignment.assignmentEpoch, 2);
  assert.equal(validateAssignmentRegistry(transition.registry).valid, true);
  assert.equal(registry.assignments[0].state, "active");
  const replay = replaceRuntimeAssignment(transition.registry, {
    expectedWorkspaceId: "workspace-old",
    candidateWorkspaceId: "workspace-new",
    windowId: 10,
    sourceContextId: "context-1",
    expectedWindowId: 10,
    expectedRuntimeAssignmentId: "assignment-old",
    expectedAssignmentEpoch: 1,
    now: NOW,
    id: () => "assignment-new"
  });
  assert.equal(replay.status, "no_change");
  assert.equal(replay.releasedAssignment.runtimeAssignmentId, "assignment-old");
});

test("atomic replacement rejects stale evidence and occupied targets without mutation", () => {
  const registry = assignedRegistry("workspace-old", 10, "assignment-old");
  const stale = replaceRuntimeAssignment(registry, replacementDetails({ expectedAssignmentEpoch: 2 }));
  assert.equal(stale.status, "assignment_conflict");
  assert.deepEqual(stale.registry, registry);
  const occupied = assignedRegistry("other-workspace", 20, "assignment-other");
  const blocked = replaceRuntimeAssignment(occupied, replacementDetails({ expectedRuntimeAssignmentId: null, expectedAssignmentEpoch: null, windowId: 20 }));
  assert.equal(blocked.status, "assignment_conflict");
  assert.deepEqual(blocked.registry, occupied);
});

test("bootstrap assigns a zero-tab workspace to the verified source window", async () => {
  const fixture = activationFixture();
  const result = await coordinateRuntimeWorkspaceActivation(bootstrapRequest(), fixture.adapters);
  assertSuccess(result, "committed", 10);
  assert.equal(result.workspaceWritten, false);
  assert.equal(result.assignmentWritten, true);
  assert.equal(resolveAssignmentByWorkspace(fixture.state.authority.assignmentRegistry, "workspace-old").windowId, 10);
  assert.equal(fixture.state.workspaceWrites, 0);
  assert.equal(fixture.state.authorityWrites, 1);
});

test("bootstrap uses one corroborated live workspace window without stealing requester window", async () => {
  const fixture = activationFixture({ liveWorkspaceTabIds: [101], liveWorkspaceWindowIds: [20] });
  const result = await coordinateRuntimeWorkspaceActivation(bootstrapRequest(), fixture.adapters);
  assertSuccess(result, "committed", 20);
  assert.equal(resolveAssignmentByWorkspace(fixture.state.authority.assignmentRegistry, "workspace-old").windowId, 20);
  assert.equal(result.sourceWindowId, 10);
});

test("bootstrap conflicts read-only when workspace is already active elsewhere", async () => {
  const fixture = activationFixture({ registry: assignedRegistry("workspace-old", 20, "assignment-old"), liveWorkspaceWindowIds: [10] });
  const result = await coordinateRuntimeWorkspaceActivation(bootstrapRequest(), fixture.adapters);
  assert.equal(result.status, "conflict");
  assert.equal(result.reason, "workspace_assigned_to_another_window");
  assert.equal(result.readOnly, true);
  assert.equal(fixture.state.authorityWrites, 0);
});

test("bootstrap replays an exact assignment in its owning source window", async () => {
  const fixture = activationFixture({ registry: assignedRegistry("workspace-old", 10, "assignment-old") });
  const result = await coordinateRuntimeWorkspaceActivation(bootstrapRequest(), fixture.adapters);
  assertSuccess(result, "no_change", 10);
  assert.equal(result.currentRuntimeAssignmentId, "assignment-old");
  assert.equal(fixture.state.authorityWrites, 0);
});

test("a post-promotion destination panel replays the destination assignment", async () => {
  const fixture = activationFixture({ registry: assignedRegistry("workspace-old", 20, "assignment-promoted"), liveWorkspaceTabIds: [101], liveWorkspaceWindowIds: [20] });
  const request = bootstrapRequest({ sourceContextId: "destination-context", sourceWindowId: 20, nextRuntimeAssignmentId: "unused-bootstrap-id" });
  const result = await coordinateRuntimeWorkspaceActivation(request, fixture.adapters);
  assertSuccess(result, "no_change", 20);
  assert.equal(result.currentRuntimeAssignmentId, "assignment-promoted");
  assert.equal(fixture.state.authorityWrites, 0);
});

test("bootstrap refuses a source window occupied by another workspace", async () => {
  const fixture = activationFixture({ registry: assignedRegistry("workspace-other", 10, "assignment-other") });
  const result = await coordinateRuntimeWorkspaceActivation(bootstrapRequest(), fixture.adapters);
  assert.equal(result.status, "conflict");
  assert.equal(result.reason, "target_window_occupied");
  assert.equal(fixture.state.authorityWrites, 0);
});

test("bootstrap does not replay an existing assignment owned by another live source window", async () => {
  const fixture = activationFixture({ registry: assignedRegistry("workspace-old", 20, "assignment-old"), liveWorkspaceTabIds: [101], liveWorkspaceWindowIds: [20] });
  const result = await coordinateRuntimeWorkspaceActivation(bootstrapRequest(), fixture.adapters);
  assert.equal(result.status, "conflict");
  assert.equal(result.reason, "workspace_assigned_to_another_window");
  assert.equal(result.readOnly, true);
  assert.equal(fixture.state.authorityWrites, 0);
});

test("bootstrap fails closed for ambiguous live workspace windows", async () => {
  const fixture = activationFixture({ liveWorkspaceTabIds: [101, 102], liveWorkspaceWindowIds: [10, 20] });
  const result = await coordinateRuntimeWorkspaceActivation(bootstrapRequest(), fixture.adapters);
  assert.equal(result.status, "conflict");
  assert.equal(result.reason, "workspace_tabs_span_multiple_windows");
  assert.equal(fixture.state.authorityWrites, 0);
});

test("activation mismatch matrix fails closed without authority mutation", async () => {
  const cases = [
    { options: { sourceContextVerified: false }, request: bootstrapRequest(), reason: "source_context_not_verified" },
    { options: { sourceWindowVerified: false }, request: bootstrapRequest(), reason: "source_window_not_verified" },
    { options: {}, request: bootstrapRequest({ expectedWorkspaceId: "workspace-mismatch" }), reason: "active_workspace_changed" },
    { options: { registry: assignedRegistry("workspace-old", 10, "assignment-old"), targetWindowVerified: false }, request: transferRequest(), reason: "target_window_not_verified" }
  ];
  for (const item of cases) {
    const fixture = activationFixture(item.options);
    const result = await coordinateRuntimeWorkspaceActivation(item.request, fixture.adapters);
    assert.equal(result.reason, item.reason);
    assert.equal(fixture.state.authorityWrites, 0);
  }
});

test("replace writes compatible workspace before one atomic authority transition", async () => {
  const fixture = activationFixture({ registry: assignedRegistry("workspace-old", 10, "assignment-old") });
  const result = await coordinateRuntimeWorkspaceActivation(replaceRequest(), fixture.adapters);
  assertSuccess(result, "committed", 10);
  assert.deepEqual(fixture.state.order, ["ledger_write", "workspace_write", "authority_write", "ledger_write"]);
  assert.equal(fixture.state.workspace.workspaceId, "workspace-new");
  assert.equal(fixture.state.authority.authorityRevision, 1);
  assert.equal(fixture.state.authority.assignmentRegistry.assignments[0].state, "released");
  assert.equal(resolveAssignmentByWorkspace(fixture.state.authority.assignmentRegistry, "workspace-new").runtimeAssignmentId, "assignment-next");
});

test("replace after session genesis creates candidate assignment", async () => {
  const fixture = activationFixture();
  const result = await coordinateRuntimeWorkspaceActivation(replaceRequest({ expectedRuntimeAssignmentId: null, expectedAssignmentEpoch: null }), fixture.adapters);
  assertSuccess(result, "committed", 10);
  assert.equal(fixture.state.authority.assignmentRegistry.assignments.length, 1);
});

test("replace atomically releases source authority into an explicit different target window", async () => {
  const fixture = activationFixture({ registry: assignedRegistry("workspace-old", 10, "assignment-old"), targetWindowVerified: true });
  const result = await coordinateRuntimeWorkspaceActivation(replaceRequest({ targetWindowId: 20 }), fixture.adapters);
  assertSuccess(result, "committed", 20);
  assert.equal(result.previousRuntimeAssignmentId, "assignment-old");
  assert.equal(resolveAssignmentByWorkspace(fixture.state.authority.assignmentRegistry, "workspace-new").windowId, 20);
  assert.equal(fixture.state.authority.assignmentRegistry.assignments.find((assignment) => assignment.runtimeAssignmentId === "assignment-old").state, "released");
  assert.equal(fixture.state.authorityWrites, 1);
});

test("replace exact retry completes a workspace-only partial without duplicate workspace write", async () => {
  const fixture = activationFixture({ authorityWriteMode: "unverified_once", registry: assignedRegistry("workspace-old", 10, "assignment-old") });
  const request = replaceRequest();
  const first = await coordinateRuntimeWorkspaceActivation(request, fixture.adapters);
  assert.equal(first.status, "indeterminate");
  assert.equal(first.workspaceVerified, true);
  assert.equal(fixture.state.ledger.entries[0].result.schema, RUNTIME_WORKSPACE_ACTIVATION_PENDING_SCHEMA);
  assert.equal(validateActivationPending(fixture.state.ledger.entries[0].result), true);
  assert.equal(fixture.state.workspaceWrites, 1);
  const second = await coordinateRuntimeWorkspaceActivation(request, fixture.adapters);
  assertSuccess(second, "committed", 10);
  assert.equal(fixture.state.workspaceWrites, 1);
  assert.equal(fixture.state.authorityWrites, 1);
});

test("fresh bootstrap recovers a durable workspace-only replacement after panel identity restart", async () => {
  const fixture = activationFixture({ authorityWriteMode: "unverified_once", registry: assignedRegistry("workspace-old", 10, "assignment-old") });
  const replacement = replaceRequest();
  const first = await coordinateRuntimeWorkspaceActivation(replacement, fixture.adapters);
  assert.equal(first.status, "indeterminate");
  assert.equal(fixture.state.workspace.workspaceId, "workspace-new");
  assert.equal(resolveAssignmentByWorkspace(fixture.state.authority.assignmentRegistry, "workspace-old").runtimeAssignmentId, "assignment-old");
  assert.equal(validateActivationPending(fixture.state.ledger.entries[0].result), true);

  const restartedBootstrap = bootstrapRequest({
    operationId: "restart-bootstrap-op",
    sourceContextId: "context-after-restart",
    expectedWorkspaceId: "workspace-new",
    expectedWorkspaceRevision: 0,
    nextRuntimeAssignmentId: "restart-bootstrap-assignment"
  });
  const recovered = await coordinateRuntimeWorkspaceActivation(restartedBootstrap, fixture.adapters);
  assertSuccess(recovered, "committed", 10);
  assert.equal(recovered.currentRuntimeAssignmentId, "assignment-next");
  assert.equal(recovered.warnings.includes("pending_workspace_replacement_recovered_from_operation_ledger"), true);
  assert.equal(resolveAssignmentByWorkspace(fixture.state.authority.assignmentRegistry, "workspace-new").runtimeAssignmentId, "assignment-next");
  assert.equal(fixture.state.ledger.entries.length, 2);
  assert.equal(fixture.state.ledger.entries.every((entry) => entry.result.schema === "constellation-runtime-workspace-activation-result-v0.1"), true);
});

test("fresh bootstrap recovers a genesis replacement partial with its original assignment identity", async () => {
  const fixture = activationFixture({ authorityWriteMode: "unverified_once" });
  const replacement = replaceRequest({ operationId: "genesis-replace-op", expectedRuntimeAssignmentId: null, expectedAssignmentEpoch: null });
  assert.equal((await coordinateRuntimeWorkspaceActivation(replacement, fixture.adapters)).status, "indeterminate");
  const recovered = await coordinateRuntimeWorkspaceActivation(bootstrapRequest({ operationId: "genesis-restart-bootstrap", sourceContextId: "new-context", expectedWorkspaceId: "workspace-new", expectedWorkspaceRevision: 0 }), fixture.adapters);
  assertSuccess(recovered, "committed", 10);
  assert.equal(recovered.currentRuntimeAssignmentId, replacement.nextRuntimeAssignmentId);
  assert.equal(fixture.state.authority.assignmentRegistry.assignments.length, 1);
});

test("replace preflight conflicts do not overwrite active workspace", async () => {
  const registry = assignedRegistry("workspace-new", 20, "candidate-assignment");
  const fixture = activationFixture({ registry });
  const result = await coordinateRuntimeWorkspaceActivation(replaceRequest({ expectedRuntimeAssignmentId: null, expectedAssignmentEpoch: null }), fixture.adapters);
  assert.equal(result.status, "conflict");
  assert.equal(result.reason, "candidate_active_elsewhere");
  assert.equal(fixture.state.workspace.workspaceId, "workspace-old");
  assert.equal(fixture.state.workspaceWrites, 0);
});

test("transfer accepts an explicit target without a destination panel context", async () => {
  const fixture = activationFixture({ registry: assignedRegistry("workspace-old", 10, "assignment-old"), targetWindowVerified: true });
  const result = await coordinateRuntimeWorkspaceActivation(transferRequest(), fixture.adapters);
  assertSuccess(result, "committed", 20);
  assert.equal(result.workspaceWritten, false);
  assert.equal(fixture.state.workspaceWrites, 0);
  assert.equal(fixture.state.authorityWrites, 1);
  assert.equal(resolveAssignmentByWorkspace(fixture.state.authority.assignmentRegistry, "workspace-old").windowId, 20);
});

test("transfer rejects stale assignment evidence and occupied targets", async () => {
  const staleFixture = activationFixture({ registry: assignedRegistry("workspace-old", 10, "assignment-old") });
  const stale = await coordinateRuntimeWorkspaceActivation(transferRequest({ expectedAssignmentEpoch: 2 }), staleFixture.adapters);
  assert.equal(stale.status, "conflict");
  const occupiedRegistry = assignedRegistry("workspace-old", 10, "assignment-old");
  const occupied = assignRuntime(occupiedRegistry, { workspaceId: "other", windowId: 20, sourceContextId: "other-context", now: NOW, id: () => "other-assignment" }).registry;
  const occupiedFixture = activationFixture({ registry: occupied });
  const conflict = await coordinateRuntimeWorkspaceActivation(transferRequest(), occupiedFixture.adapters);
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.reason, "target_window_occupied");
});

test("transfer rejects a same-window target instead of churning assignment identity", async () => {
  const request = transferRequest({ targetWindowId: 10 });
  assert.equal(snapshotAndValidateActivationRequest(request).ok, false);
  const fixture = activationFixture({ registry: assignedRegistry("workspace-old", 10, "assignment-old") });
  const result = await coordinateRuntimeWorkspaceActivation(request, fixture.adapters);
  assert.equal(result.status, "invalid");
  assert.equal(fixture.state.authorityWrites, 0);
});

test("replace and transfer exact retries recover verified state after terminal ledger loss", async () => {
  for (const request of [replaceRequest(), transferRequest()]) {
    const fixture = activationFixture({ registry: assignedRegistry("workspace-old", 10, "assignment-old"), failLedgerWriteAt: request.operation === "replace_active" ? 2 : 1 });
    const first = await coordinateRuntimeWorkspaceActivation(request, fixture.adapters);
    assert.equal(first.status, "indeterminate");
    assert.equal(first.workspaceVerified, true);
    assert.equal(first.assignmentVerified, true);
    fixture.state.failLedgerWriteAt = 0;
    const retry = await coordinateRuntimeWorkspaceActivation(request, fixture.adapters);
    assertSuccess(retry, "no_change", request.targetWindowId);
    assert.equal(retry.previousRuntimeAssignmentId, "assignment-old");
    assert.equal(retry.currentRuntimeAssignmentId, "assignment-next");
    assert.equal(fixture.state.authorityWrites, 1);
    assert.equal(fixture.state.workspaceWrites, request.operation === "replace_active" ? 1 : 0);
  }
});

test("replace and transfer recover a committed authority write whose first verification read is lost", async () => {
  for (const request of [replaceRequest(), transferRequest()]) {
    const fixture = activationFixture({ registry: assignedRegistry("workspace-old", 10, "assignment-old"), authorityReadFailAfterWriteOnce: true });
    const first = await coordinateRuntimeWorkspaceActivation(request, fixture.adapters);
    assert.equal(first.status, "indeterminate");
    assert.equal(fixture.state.authorityWrites, 1);
    const retry = await coordinateRuntimeWorkspaceActivation(request, fixture.adapters);
    assertSuccess(retry, "no_change", request.targetWindowId);
    assert.equal(retry.currentRuntimeAssignmentId, "assignment-next");
    assert.equal(fixture.state.authorityWrites, 1);
  }
});

test("fresh bootstrap terminalizes a committed replacement pending before later release and rebootstrap", async () => {
  const fixture = activationFixture({
    registry: assignedRegistry("workspace-old", 10, "assignment-old"),
    authorityReadFailAfterWriteOnce: true
  });
  const replacement = replaceRequest();
  const first = await coordinateRuntimeWorkspaceActivation(replacement, fixture.adapters);
  assert.equal(first.status, "indeterminate");
  assert.equal(fixture.state.authorityWrites, 1);
  assert.equal(validateActivationPending(fixture.state.ledger.entries[0].result), true);

  const recoveryRequest = bootstrapRequest({
    operationId: "fresh-bootstrap-after-committed-replacement",
    sourceContextId: "context-after-replacement",
    expectedWorkspaceId: "workspace-new",
    expectedWorkspaceRevision: 0,
    nextRuntimeAssignmentId: "unused-recovery-assignment"
  });
  const recovered = await coordinateRuntimeWorkspaceActivation(recoveryRequest, fixture.adapters);
  assertSuccess(recovered, "no_change", 10);
  assert.equal(recovered.currentRuntimeAssignmentId, replacement.nextRuntimeAssignmentId);
  assert.equal(fixture.state.authorityWrites, 1);
  assert.equal(fixture.state.ledger.entries.length, 2);
  assert.equal(fixture.state.ledger.entries.every((entry) => entry.result.schema === "constellation-runtime-workspace-activation-result-v0.1"), true);

  const released = releaseRuntime(fixture.state.authority.assignmentRegistry, {
    runtimeAssignmentId: recovered.currentRuntimeAssignmentId,
    assignmentEpoch: recovered.currentAssignmentEpoch,
    now: "2026-07-17T10:01:00.000Z"
  });
  assert.equal(released.status, "released");
  fixture.state.authority.assignmentRegistry = released.registry;
  fixture.state.authority.authorityRevision += 1;

  const rebootstrap = await coordinateRuntimeWorkspaceActivation(bootstrapRequest({
    operationId: "bootstrap-after-release",
    sourceContextId: "context-after-release",
    expectedWorkspaceId: "workspace-new",
    expectedWorkspaceRevision: 0,
    nextRuntimeAssignmentId: "assignment-after-release",
    requestedAt: "2026-07-17T10:02:00.000Z"
  }), fixture.adapters);
  assertSuccess(rebootstrap, "committed", 10);
  assert.equal(rebootstrap.currentRuntimeAssignmentId, "assignment-after-release");
  assert.equal(fixture.state.authorityWrites, 2);
});

test("fresh bootstrap conflicts on multiple exact pending replacements without another business write", async () => {
  const first = replaceRequest();
  const second = replaceRequest({ operationId: "second-replacement-op", nextRuntimeAssignmentId: "second-assignment-next" });
  const fixture = activationFixture({ registry: assignedRegistry("workspace-old", 10, "assignment-old") });
  fixture.state.workspace = structuredClone(first.candidateWorkspace);
  fixture.state.ledger = ledgerWithPendingReplacements(first, second);
  const result = await coordinateRuntimeWorkspaceActivation(bootstrapRequest({
    operationId: "ambiguous-recovery-bootstrap",
    expectedWorkspaceId: "workspace-new",
    expectedWorkspaceRevision: 0
  }), fixture.adapters);
  assert.equal(result.status, "conflict");
  assert.equal(result.reason, "multiple_pending_workspace_replacements");
  assert.equal(fixture.state.workspaceWrites, 0);
  assert.equal(fixture.state.authorityWrites, 0);
  assert.equal(fixture.state.ledger.entries.every((entry) => validateActivationPending(entry.result)), true);
});

test("fresh bootstrap never consumes pending replacement evidence with a hostile fingerprint binding", async () => {
  const replacement = replaceRequest();
  const fixture = activationFixture();
  fixture.state.workspace = structuredClone(replacement.candidateWorkspace);
  fixture.state.ledger = ledgerWithPendingReplacements(replacement);
  fixture.state.ledger.entries[0].requestFingerprint = "hostile-entry-fingerprint";
  const result = await coordinateRuntimeWorkspaceActivation(bootstrapRequest({
    operationId: "hostile-binding-bootstrap",
    expectedWorkspaceId: "workspace-new",
    expectedWorkspaceRevision: 0
  }), fixture.adapters);
  assert.equal(result.status, "conflict");
  assert.equal(result.reason, "pending_workspace_replacement_evidence_invalid");
  assert.equal(fixture.state.workspaceWrites, 0);
  assert.equal(fixture.state.authorityWrites, 0);
  assert.equal(fixture.state.ledgerWrites, 0);
  assert.equal(validateActivationPending(fixture.state.ledger.entries[0].result), true);
});

test("fresh bootstrap rejects an exact candidate pending replacement bound to another target", async () => {
  const replacement = replaceRequest({ targetWindowId: 20 });
  const fixture = activationFixture();
  fixture.state.workspace = structuredClone(replacement.candidateWorkspace);
  fixture.state.ledger = ledgerWithPendingReplacements(replacement);
  const result = await coordinateRuntimeWorkspaceActivation(bootstrapRequest({
    operationId: "wrong-target-binding-bootstrap",
    expectedWorkspaceId: "workspace-new",
    expectedWorkspaceRevision: 0
  }), fixture.adapters);
  assert.equal(result.status, "conflict");
  assert.equal(result.reason, "pending_workspace_replacement_target_mismatch");
  assert.equal(fixture.state.workspaceWrites, 0);
  assert.equal(fixture.state.authorityWrites, 0);
  assert.equal(fixture.state.ledgerWrites, 0);
});

test("terminal ledger replay performs no duplicate authority or workspace writes", async () => {
  const fixture = activationFixture();
  const request = bootstrapRequest();
  assert.equal((await coordinateRuntimeWorkspaceActivation(request, fixture.adapters)).status, "committed");
  const replay = await coordinateRuntimeWorkspaceActivation(request, fixture.adapters);
  assertSuccess(replay, "replayed", 10);
  assert.equal(replay.replayed, true);
  assert.equal(fixture.state.authorityWrites, 1);
  assert.equal(fixture.state.ledgerWrites, 1);
});

test("operation ID fingerprint conflicts fail closed across semantic operations", async () => {
  const fixture = activationFixture();
  assert.equal((await coordinateRuntimeWorkspaceActivation(bootstrapRequest(), fixture.adapters)).status, "committed");
  const conflict = await coordinateRuntimeWorkspaceActivation(transferRequest({ operationId: "activation-op", expectedRuntimeAssignmentId: "assignment-next", expectedAssignmentEpoch: 1 }), fixture.adapters);
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.reason, "operation_id_conflict");
});

test("diagnostic ledger failure preserves verified business state as indeterminate", async () => {
  const fixture = activationFixture({ ledgerWriteMode: "failed" });
  const result = await coordinateRuntimeWorkspaceActivation(bootstrapRequest(), fixture.adapters);
  assert.equal(result.status, "indeterminate");
  assert.equal(result.workspaceVerified, true);
  assert.equal(result.assignmentVerified, true);
  assert.equal(result.retrySafe, true);
  assert.equal(resolveAssignmentByWorkspace(fixture.state.authority.assignmentRegistry, "workspace-old").windowId, 10);
});

test("exclusive adapter callback zero or multiple times returns a complete failure", async () => {
  for (const mode of ["zero", "twice"]) {
    const fixture = activationFixture({ exclusiveMode: mode });
    const result = await coordinateRuntimeWorkspaceActivation(bootstrapRequest(), fixture.adapters);
    assert.equal(result.status, "failed");
    assert.equal(validateActivationResult(result, bootstrapRequest()), true);
    assert.doesNotThrow(() => JSON.stringify(result));
  }
});

test("hostile thrown adapter errors are total and serializable", async () => {
  const fixture = activationFixture();
  const hostile = new Proxy({}, { get() { throw new Error("hostile error accessor"); } });
  fixture.adapters.runExclusiveOperation = async () => { throw hostile; };
  const result = await coordinateRuntimeWorkspaceActivation(bootstrapRequest(), fixture.adapters);
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "exclusive_operation_failed");
  assert.deepEqual(result.errors, ["unknown_error"]);
  assert.equal(validateActivationResult(result, bootstrapRequest()), true);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("throwing and malformed dependency results return total failures", async () => {
  for (const mode of ["throwing", "malformed"]) {
    const fixture = activationFixture();
    fixture.adapters.readCompatibleWorkspace = mode === "throwing" ? async () => { throw new Error("injected"); } : async () => ({ status: "present" });
    const result = await coordinateRuntimeWorkspaceActivation(bootstrapRequest({ operationId: "adapter-" + mode }), fixture.adapters);
    assert.equal(result.status, "failed");
    assert.equal(result.reason, "workspace_read_failed");
    assert.equal(validateActivationResult(result), true);
    assert.doesNotThrow(() => JSON.stringify(result));
  }
});

test("detached exclusive callback is stopped before any authority or ledger mutation", async () => {
  const fixture = activationFixture();
  let detached;
  fixture.adapters.runExclusiveOperation = (callback) => {
    detached = callback();
    return undefined;
  };
  const result = await coordinateRuntimeWorkspaceActivation(bootstrapRequest(), fixture.adapters);
  assert.equal(result.status, "failed");
  await detached;
  assert.equal(fixture.state.workspaceWrites, 0);
  assert.equal(fixture.state.authorityWrites, 0);
  assert.equal(fixture.state.ledgerWrites, 0);
});

test("browser evidence rejects stale numeric identity and malformed container ownership", async () => {
  let windows = [{ id: 10, tabs: [{ id: 101, windowId: 10, url: "https://other.example/", title: "Other" }] }];
  const adapters = createRuntimeWorkspaceActivationChromeAdapters({}, {
    getWindow: async () => ({ id: 10 }),
    getAllWindows: async () => structuredClone(windows)
  });
  const workspaceValue = workspace("workspace-old", 2);
  workspaceValue.tabs = [{ workspaceTabId: "tab-a", tabId: 101, url: "https://expected.example/", title: "Expected" }];
  const stale = await adapters.readBrowserEvidence({ workspace: workspaceValue, sourceWindowId: 10, targetWindowId: null });
  assert.equal(stale.status, "failed");
  assert.equal(stale.error, "workspace_tab_identity_ambiguous");
  windows = [{ id: 10, tabs: [{ id: 101, windowId: 20, url: "https://expected.example/", title: "Expected" }] }];
  const mismatchedContainer = await adapters.readBrowserEvidence({ workspace: workspaceValue, sourceWindowId: 10, targetWindowId: null });
  assert.equal(mismatchedContainer.status, "failed");
  assert.equal(mismatchedContainer.error, "browser_projection_malformed");
  windows = [
    { id: 10, tabs: [{ id: 101, windowId: 10, url: "https://expected.example/", title: "Expected" }] },
    { id: 20, tabs: [{ id: 101, windowId: 20, url: "https://expected.example/", title: "Expected" }] }
  ];
  const duplicate = await adapters.readBrowserEvidence({ workspace: workspaceValue, sourceWindowId: 10, targetWindowId: null });
  assert.equal(duplicate.status, "failed");
  assert.equal(duplicate.error, "workspace_tab_identity_ambiguous");
});

test("private route rejects unauthorized sender before adapter construction", async () => {
  let adaptersCreated = 0;
  const response = await dispatch(bootstrapRequest(), { id: "wrong", url: PANEL_URL }, { createAdapters: () => { adaptersCreated += 1; return {}; } });
  assert.equal(response.async, false);
  assert.equal(response.result.status, "invalid");
  assert.equal(response.result.reason, "sender_not_authorized");
  assert.equal(adaptersCreated, 0);
});

test("private route terminally owns hostile activation messages", async () => {
  const hostile = { ...bootstrapRequest(), unknown: true };
  const response = await dispatch(hostile, { id: "extension-id", url: PANEL_URL });
  assert.equal(response.async, false);
  assert.equal(response.result.reason, "invalid_activation_request");
});

test("private route sends authorized requests to one coordinator", async () => {
  let calls = 0;
  const request = bootstrapRequest();
  const response = await dispatch(request, { id: "extension-id", url: PANEL_URL }, {
    createAdapters: () => ({}),
    coordinate: async () => {
      calls += 1;
      return createActivationResult(normalizeActivationIdentities(request), { status: "failed", reason: "stubbed", decision: "retry_activation", phase: "workspace_reread", requestFingerprint: createActivationRequestFingerprint(request), retrySafe: true });
    },
    recordDiagnostic: async () => undefined
  });
  assert.equal(response.async, true);
  assert.equal(response.result.reason, "stubbed");
  assert.equal(calls, 1);
});

test("client shares in-flight work and bounded retry retains exact request identity", async () => {
  const sent = [];
  let release;
  const client = createRuntimeWorkspaceActivationClient({
    createId: idSequence(),
    now: () => NOW,
    send: async (request) => {
      sent.push(structuredClone(request));
      if (sent.length === 1) await new Promise((resolve) => { release = resolve; });
      return createActivationResult(normalizeActivationIdentities(request), { status: sent.length === 1 ? "failed" : "committed", reason: sent.length === 1 ? "retry" : "activation_committed", decision: sent.length === 1 ? "retry_activation" : "use_active_workspace", phase: sent.length === 1 ? "workspace_reread" : "complete", requestFingerprint: createActivationRequestFingerprint(request), activeWorkspaceId: "workspace-old", activeWorkspaceRevision: 2, workspaceVerified: sent.length > 1, assignmentWritten: sent.length > 1, assignmentVerified: sent.length > 1, runtimeSessionId: sent.length > 1 ? "session-1" : "", authorityRevisionBefore: sent.length > 1 ? 0 : null, authorityRevisionAfter: sent.length > 1 ? 1 : null, targetWindowId: 10, currentRuntimeAssignmentId: "assignment-next", currentAssignmentEpoch: 1, retrySafe: sent.length === 1 });
    }
  });
  const input = bootstrapInput();
  const first = client.bootstrapExisting(input);
  const shared = client.bootstrapExisting(input);
  release();
  const [left, right] = await Promise.all([first, shared]);
  assert.equal(left.status, "committed");
  assert.deepEqual(right, left);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], sent[1]);
});

test("client snapshots responses and protects its retained retry request from send-side mutation", async () => {
  const observed = [];
  let attempts = 0;
  let activeWorkspaceReads = 0;
  const client = createRuntimeWorkspaceActivationClient({
    createId: idSequence(),
    now: () => NOW,
    send: async (request) => {
      const original = structuredClone(request);
      observed.push(original);
      request.expectedWorkspaceId = "mutated-by-send";
      attempts += 1;
      if (attempts === 1) return createActivationResult(normalizeActivationIdentities(original), { status: "failed", reason: "retry", decision: "retry_activation", phase: "workspace_reread", requestFingerprint: createActivationRequestFingerprint(original), retrySafe: true });
      const response = successfulActivationResult(original);
      const activeWorkspaceId = response.activeWorkspaceId;
      Object.defineProperty(response, "activeWorkspaceId", { enumerable: true, get() { activeWorkspaceReads += 1; return activeWorkspaceReads === 1 ? activeWorkspaceId : "changed-after-snapshot"; } });
      return response;
    }
  });
  const result = await client.bootstrapExisting(bootstrapInput());
  assert.equal(result.status, "committed");
  assert.equal(result.activeWorkspaceId, "workspace-old");
  assert.equal(activeWorkspaceReads, 1);
  assert.equal(observed.length, 2);
  assert.deepEqual(observed[1], observed[0]);
});


test("same-workspace replacement requires the next revision and exact prior assignment", () => {
  const accepted = replaceRequest({
    candidateWorkspace: workspace("workspace-old", 3),
    targetWindowId: 20
  });
  assert.equal(snapshotAndValidateActivationRequest(accepted).ok, true);

  for (const candidateRevision of [2, 4]) {
    const rejected = snapshotAndValidateActivationRequest({
      ...accepted,
      candidateWorkspace: workspace("workspace-old", candidateRevision)
    });
    assert.equal(rejected.ok, false);
    assert.ok(rejected.errors.includes("candidate_workspace_revision_not_next"));
  }

  const missingAssignment = snapshotAndValidateActivationRequest({
    ...accepted,
    expectedRuntimeAssignmentId: null,
    expectedAssignmentEpoch: null
  });
  assert.equal(missingAssignment.ok, false);
  assert.ok(missingAssignment.errors.includes("same_workspace_replacement_assignment_invalid"));
});

test("activation client submits a same-workspace rehydrate request instead of rejecting it locally", async () => {
  const sent = [];
  const client = createRuntimeWorkspaceActivationClient({
    createId: idSequence(),
    now: () => NOW,
    send: async (request) => {
      sent.push(structuredClone(request));
      return successfulActivationResult(request);
    }
  });
  const result = await client.replaceActive({
    sourceContextId: "context-1",
    sourceWindowId: 10,
    expectedWorkspaceId: "workspace-old",
    expectedWorkspaceRevision: 2,
    candidateWorkspace: workspace("workspace-old", 3),
    targetWindowId: 20,
    expectedRuntimeAssignmentId: "assignment-old",
    expectedAssignmentEpoch: 1
  });
  assert.equal(result.status, "committed");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].candidateWorkspace.workspaceId, sent[0].expectedWorkspaceId);
  assert.equal(sent[0].candidateWorkspace.workspaceRevision, sent[0].expectedWorkspaceRevision + 1);
});

test("same-workspace replacement writes one revision and transfers exact authority", async () => {
  const request = replaceRequest({
    candidateWorkspace: workspace("workspace-old", 3),
    targetWindowId: 20,
    nextRuntimeAssignmentId: "assignment-rehydrated"
  });
  const fixture = activationFixture({
    registry: assignedRegistry("workspace-old", 10, "assignment-old"),
    liveWorkspaceWindowIds: [20]
  });

  const result = await coordinateRuntimeWorkspaceActivation(request, fixture.adapters);
  assertSuccess(result, "committed", 20);
  assert.equal(validateActivationResult(result, request), true);
  assert.equal(fixture.state.workspace.workspaceId, "workspace-old");
  assert.equal(fixture.state.workspace.workspaceRevision, 3);
  const active = resolveAssignmentByWorkspace(fixture.state.authority.assignmentRegistry, "workspace-old");
  assert.equal(active.runtimeAssignmentId, "assignment-rehydrated");
  assert.equal(active.windowId, 20);
  assert.equal(active.assignmentEpoch, 2);
  const released = fixture.state.authority.assignmentRegistry.assignments.find((item) => item.runtimeAssignmentId === "assignment-old");
  assert.equal(released.state, "released");

  const replayed = await coordinateRuntimeWorkspaceActivation(request, fixture.adapters);
  assertSuccess(replayed, "replayed", 20);
  assert.equal(fixture.state.workspaceWrites, 1);
  assert.equal(fixture.state.authorityWrites, 1);
});

test("same-workspace replacement rebinds authority even when target remains the source window", async () => {
  const request = replaceRequest({
    candidateWorkspace: workspace("workspace-old", 3),
    targetWindowId: 10,
    nextRuntimeAssignmentId: "assignment-refreshed"
  });
  const fixture = activationFixture({ registry: assignedRegistry("workspace-old", 10, "assignment-old") });
  const result = await coordinateRuntimeWorkspaceActivation(request, fixture.adapters);
  assertSuccess(result, "committed", 10);
  const active = resolveAssignmentByWorkspace(fixture.state.authority.assignmentRegistry, "workspace-old");
  assert.equal(active.runtimeAssignmentId, "assignment-refreshed");
  assert.equal(active.windowId, 10);
});

test("same-workspace replacement rejects stale source authority before workspace mutation", async () => {
  const request = replaceRequest({
    candidateWorkspace: workspace("workspace-old", 3),
    targetWindowId: 20,
    expectedRuntimeAssignmentId: "assignment-stale",
    nextRuntimeAssignmentId: "assignment-rehydrated"
  });
  const fixture = activationFixture({
    registry: assignedRegistry("workspace-old", 10, "assignment-old"),
    liveWorkspaceWindowIds: [20]
  });
  const result = await coordinateRuntimeWorkspaceActivation(request, fixture.adapters);
  assert.equal(result.status, "conflict");
  assert.equal(result.reason, "stale_or_missing_prior_assignment");
  assert.equal(fixture.state.workspaceWrites, 0);
  assert.equal(fixture.state.authorityWrites, 0);
});

test("same-workspace replacement rejects an unrelated target assignment before workspace mutation", async () => {
  let registry = assignedRegistry("workspace-old", 10, "assignment-old");
  registry = assignRuntime(registry, {
    workspaceId: "workspace-other",
    windowId: 20,
    sourceContextId: "context-other",
    now: NOW,
    id: () => "assignment-other"
  }).registry;
  const request = replaceRequest({
    candidateWorkspace: workspace("workspace-old", 3),
    targetWindowId: 20,
    nextRuntimeAssignmentId: "assignment-rehydrated"
  });
  const fixture = activationFixture({ registry, liveWorkspaceWindowIds: [20] });
  const result = await coordinateRuntimeWorkspaceActivation(request, fixture.adapters);
  assert.equal(result.status, "conflict");
  assert.equal(result.reason, "target_window_occupied");
  assert.equal(fixture.state.workspaceWrites, 0);
  assert.equal(fixture.state.authorityWrites, 0);
});

test("browser evidence accepts exact pending URL while preserving strict tab and window identity", async () => {
  const adapters = createRuntimeWorkspaceActivationChromeAdapters({}, {
    getWindow: async () => ({ id: 10 }),
    getAllWindows: async () => [{
      id: 10,
      tabs: [{ id: 101, windowId: 10, url: "chrome://newtab/", pendingUrl: "https://expected.example/", title: "" }]
    }]
  });
  const workspaceValue = workspace("workspace-old", 2);
  workspaceValue.tabs = [{ workspaceTabId: "tab-a", tabId: 101, url: "https://expected.example/", title: "Expected" }];
  const evidence = await adapters.readBrowserEvidence({ workspace: workspaceValue, sourceWindowId: 10, targetWindowId: 10 });
  assert.equal(evidence.status, "present");
  assert.deepEqual(evidence.liveWorkspaceTabIds, [101]);
  assert.deepEqual(evidence.liveWorkspaceWindowIds, [10]);

  const wrongAdapters = createRuntimeWorkspaceActivationChromeAdapters({}, {
    getWindow: async () => ({ id: 10 }),
    getAllWindows: async () => [{
      id: 10,
      tabs: [{ id: 101, windowId: 10, url: "chrome://newtab/", pendingUrl: "https://wrong.example/", title: "" }]
    }]
  });
  const rejected = await wrongAdapters.readBrowserEvidence({ workspace: workspaceValue, sourceWindowId: 10, targetWindowId: 10 });
  assert.equal(rejected.status, "failed");
  assert.equal(rejected.error, "workspace_tab_identity_ambiguous");
});

function bootstrapRequest(overrides = {}) {
  return {
    type: RUNTIME_WORKSPACE_ACTIVATION_TYPE,
    schema: RUNTIME_WORKSPACE_ACTIVATION_REQUEST_SCHEMA,
    operationId: "activation-op",
    operation: "bootstrap_existing",
    sourceContextId: "context-1",
    sourceWindowId: 10,
    expectedWorkspaceId: "workspace-old",
    expectedWorkspaceRevision: 2,
    candidateWorkspace: null,
    targetWindowId: null,
    expectedRuntimeAssignmentId: null,
    expectedAssignmentEpoch: null,
    nextRuntimeAssignmentId: "assignment-next",
    requestedAt: NOW,
    ...overrides
  };
}

function replaceRequest(overrides = {}) {
  return {
    ...bootstrapRequest(),
    operationId: "replace-op",
    operation: "replace_active",
    candidateWorkspace: workspace("workspace-new", 0),
    targetWindowId: 10,
    expectedRuntimeAssignmentId: "assignment-old",
    expectedAssignmentEpoch: 1,
    ...overrides
  };
}

function transferRequest(overrides = {}) {
  return {
    ...bootstrapRequest(),
    operationId: "transfer-op",
    operation: "transfer_active",
    targetWindowId: 20,
    expectedRuntimeAssignmentId: "assignment-old",
    expectedAssignmentEpoch: 1,
    ...overrides
  };
}

function bootstrapInput() {
  const value = bootstrapRequest();
  return { sourceContextId: value.sourceContextId, sourceWindowId: value.sourceWindowId, expectedWorkspaceId: value.expectedWorkspaceId, expectedWorkspaceRevision: value.expectedWorkspaceRevision };
}

function workspace(workspaceId, workspaceRevision = 2) { return { workspaceId, workspaceRevision, name: workspaceId, tabs: [], journal: [], timeline: [] }; }

function successfulActivationResult(request) {
  const activeWorkspace = request.operation === "replace_active" ? request.candidateWorkspace : { workspaceId: request.expectedWorkspaceId, workspaceRevision: request.expectedWorkspaceRevision };
  return createActivationResult(normalizeActivationIdentities(request), {
    status: "committed",
    reason: "activation_committed",
    decision: "use_active_workspace",
    phase: "complete",
    requestFingerprint: createActivationRequestFingerprint(request),
    targetWindowId: request.targetWindowId ?? request.sourceWindowId,
    activeWorkspaceId: activeWorkspace.workspaceId,
    activeWorkspaceRevision: activeWorkspace.workspaceRevision,
    workspaceVerified: true,
    assignmentWritten: true,
    assignmentVerified: true,
    runtimeSessionId: "session-1",
    authorityRevisionBefore: 0,
    authorityRevisionAfter: 1,
    previousRuntimeAssignmentId: request.expectedRuntimeAssignmentId || "",
    previousAssignmentEpoch: request.expectedAssignmentEpoch,
    currentRuntimeAssignmentId: request.nextRuntimeAssignmentId,
    currentAssignmentEpoch: (request.expectedAssignmentEpoch || 0) + 1
  });
}

function assignedRegistry(workspaceId, windowId, assignmentId) {
  return assignRuntime(createAssignmentRegistry(), { workspaceId, windowId, sourceContextId: "context-1", now: NOW, id: () => assignmentId }).registry;
}

function replacementDetails(overrides = {}) {
  return { expectedWorkspaceId: "workspace-old", candidateWorkspaceId: "workspace-new", windowId: 10, sourceContextId: "context-1", expectedWindowId: 10, expectedRuntimeAssignmentId: "assignment-old", expectedAssignmentEpoch: 1, now: NOW, id: () => "assignment-new", ...overrides };
}

function activationFixture(options = {}) {
  const state = {
    ledger: createOperationLedger(),
    workspace: structuredClone(options.workspace || workspace("workspace-old", 2)),
    authority: { runtimeSessionId: "session-1", authorityRevision: 0, assignmentRegistry: structuredClone(options.registry || createAssignmentRegistry()) },
    workspaceWrites: 0,
    authorityWrites: 0,
    ledgerWrites: 0,
    ledgerWriteAttempts: 0,
    order: [],
    authorityWriteAttempts: 0,
    authorityReadFailures: 0,
    ledgerWriteMode: options.ledgerWriteMode || "",
    failLedgerWriteAt: options.failLedgerWriteAt || 0
  };
  const adapters = {
    runExclusiveOperation: async (callback) => {
      if (options.exclusiveMode === "zero") return undefined;
      if (options.exclusiveMode === "twice") { await callback(); return callback(); }
      return callback();
    },
    readOperationLedger: async () => ({ status: "present", ledger: structuredClone(state.ledger), error: "" }),
    writeOperationLedger: async (ledger) => {
      state.ledgerWriteAttempts += 1;
      state.ledgerWrites += 1;
      if (state.ledgerWriteMode === "failed" || state.failLedgerWriteAt === state.ledgerWriteAttempts) return { status: "failed", error: "injected" };
      state.ledger = structuredClone(ledger);
      state.order.push("ledger_write");
      return { status: "written", error: "" };
    },
    readCompatibleWorkspace: async () => ({ status: "present", workspace: structuredClone(state.workspace), revision: state.workspace.workspaceRevision ?? 0, error: "" }),
    writeCompatibleWorkspace: async ({ workspace: candidate }) => {
      state.workspaceWrites += 1;
      state.workspace = structuredClone(candidate);
      state.order.push("workspace_write");
      return { status: "written", workspaceId: candidate.workspaceId, workspaceRevision: candidate.workspaceRevision ?? 0, error: "" };
    },
    readRuntimeAuthority: async () => {
      if (options.authorityReadFailAfterWriteOnce && state.authorityWrites > 0 && state.authorityReadFailures === 0) {
        state.authorityReadFailures += 1;
        return { status: "failed", runtimeSessionId: "", authorityRevision: null, sourceContextVerified: false, assignmentRegistry: null, error: "injected" };
      }
      return { status: "present", runtimeSessionId: state.authority.runtimeSessionId, authorityRevision: state.authority.authorityRevision, sourceContextVerified: options.sourceContextVerified !== false, assignmentRegistry: structuredClone(state.authority.assignmentRegistry), error: "" };
    },
    writeRuntimeAuthority: async ({ nextAssignmentRegistry }) => {
      state.authorityWriteAttempts += 1;
      if (options.authorityWriteMode === "unverified_once" && state.authorityWriteAttempts === 1) return { status: "failed", runtimeSessionId: state.authority.runtimeSessionId, authorityRevision: state.authority.authorityRevision, error: "injected" };
      state.authorityWrites += 1;
      state.authority.assignmentRegistry = structuredClone(nextAssignmentRegistry);
      state.authority.authorityRevision += 1;
      state.order.push("authority_write");
      return { status: "written", runtimeSessionId: state.authority.runtimeSessionId, authorityRevision: state.authority.authorityRevision, error: "" };
    },
    readBrowserEvidence: async () => ({ status: "present", sourceWindowVerified: options.sourceWindowVerified !== false, targetWindowVerified: options.targetWindowVerified !== false, liveWorkspaceTabIds: structuredClone(options.liveWorkspaceTabIds || []), liveWorkspaceWindowIds: structuredClone(options.liveWorkspaceWindowIds || []), error: "" })
  };
  return { state, adapters };
}

function hostileRequests() {
  const cyclic = bootstrapRequest(); cyclic.candidateWorkspace = cyclic;
  const symbol = bootstrapRequest(); symbol[Symbol("unsafe")] = true;
  const sparse = bootstrapRequest(); sparse.candidateWorkspace = []; sparse.candidateWorkspace.length = 2;
  const throwing = bootstrapRequest(); Object.defineProperty(throwing, "operationId", { enumerable: true, get() { throw new Error("boom"); } });
  const proxy = new Proxy(bootstrapRequest(), { ownKeys() { throw new Error("boom"); } });
  return [cyclic, symbol, sparse, throwing, proxy, { ...bootstrapRequest(), candidateWorkspace: 1n }];
}

function ledgerWithPendingReplacements(...requests) {
  let ledger = createOperationLedger();
  for (const request of requests) {
    const fingerprint = createActivationRequestFingerprint(request);
    const recorded = recordOperation(ledger, {
      operationId: request.operationId,
      requestFingerprint: fingerprint,
      result: createActivationPending(request, fingerprint),
      recordedAt: request.requestedAt
    });
    assert.equal(recorded.status, "recorded");
    ledger = recorded.ledger;
  }
  return ledger;
}

function assertSuccess(result, status, targetWindowId) {
  assert.equal(result.status, status);
  assert.equal(result.targetWindowId, targetWindowId);
  assert.equal(result.workspaceVerified, true);
  assert.equal(result.assignmentVerified, true);
  assert.equal(validateActivationResult(result), true);
}

function dispatch(message, sender, options = {}) {
  return new Promise((resolve) => {
    let returned = false;
    returned = handleRuntimeWorkspaceActivationMessage(message, sender, (result) => {
      Promise.resolve().then(() => resolve({ async: returned === true, result }));
    }, { runtimeId: "extension-id", sidePanelUrl: PANEL_URL, chromeApi: {}, recordDiagnostic: async () => undefined, ...options });
  });
}

function idSequence() {
  let value = 0;
  return () => `id-${++value}`;
}
