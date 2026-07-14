import assert from "node:assert/strict";
import { assignRuntime, createAssignmentRegistry } from "../src/core/runtime-contract/assignments.js";
import { createOperationLedger } from "../src/core/runtime-contract/ledger.js";
import { WORKSPACE_RESOLUTION_COORDINATION_RESULT_SCHEMA } from "../src/core/workspace-resolution-coordination/contract.js";
import { WORKSPACE_CREATION_ASSIGNMENT_REQUEST_SCHEMA } from "../src/core/workspace-creation-assignment-transaction/contract.js";
import { coordinateWorkspaceCreationAssignment } from "../src/core/workspace-creation-assignment-transaction/coordinator.js";

const request = {
  schema: WORKSPACE_CREATION_ASSIGNMENT_REQUEST_SCHEMA,
  operationId: "validation-transaction",
  contextId: "validation-context",
  windowId: 41,
  workspaceId: "validation-workspace",
  runtimeAssignmentId: "validation-assignment",
  requestedAt: "2026-07-14T12:00:00.000Z",
  workspaceRecord: { workspaceId: "validation-workspace", name: "Validation workspace", tabs: [] },
  authorization: { resolutionOperationId: "validation-resolution", resolutionResultSchema: WORKSPACE_RESOLUTION_COORDINATION_RESULT_SCHEMA, status: "creation_required", decision: "create_workspace_and_assign", contextId: "validation-context", windowId: 41, operatorAuthorized: true }
};

const freshFixture = createFixture();
const fresh = await coordinateWorkspaceCreationAssignment(request, freshFixture.adapters);
assert.equal(fresh.status, "committed");
assert.equal(freshFixture.workspaceCount(), 1);
assert.equal(freshFixture.assignmentCount(), 1);

const replay = await coordinateWorkspaceCreationAssignment(request, freshFixture.adapters);
assert.equal(replay.status, "replayed");
assert.equal(freshFixture.workspaceCount(), 1);
assert.equal(freshFixture.assignmentCount(), 1);

const recoveryFixture = createFixture({ workspace: request.workspaceRecord });
const recovery = await coordinateWorkspaceCreationAssignment({ ...request, operationId: "recovery-transaction", runtimeAssignmentId: "recovery-assignment" }, recoveryFixture.adapters);
assert.equal(recovery.status, "committed");
assert.equal(recovery.workspaceCreated, false);
assert.equal(recovery.assignmentCreated, true);
assert.equal(recoveryFixture.workspaceCount(), 1);
assert.equal(recoveryFixture.assignmentCount(), 1);

const concurrentFixture = createFixture();
const concurrentRequest = { ...request, operationId: "concurrent-transaction", runtimeAssignmentId: "concurrent-assignment" };
const concurrent = await Promise.all([coordinateWorkspaceCreationAssignment(concurrentRequest, concurrentFixture.adapters), coordinateWorkspaceCreationAssignment(concurrentRequest, concurrentFixture.adapters)]);
assert.deepEqual(concurrent.map((item) => item.status).sort(), ["committed", "replayed"]);
assert.equal(concurrentFixture.workspaceCount(), 1);
assert.equal(concurrentFixture.assignmentCount(), 1);

const conflictAssignment = { ...request, workspaceId: "occupied-workspace", runtimeAssignmentId: "occupied-assignment" };
const conflictFixture = createFixture({ assignment: conflictAssignment });
const conflict = await coordinateWorkspaceCreationAssignment({ ...request, operationId: "conflict-transaction", runtimeAssignmentId: "conflict-assignment" }, conflictFixture.adapters);
assert.equal(conflict.status, "conflict");
assert.equal(conflict.decision, "manual_resolution_required");
assert.equal(conflictFixture.workspaceCount(), 0);
assert.equal(conflictFixture.assignmentCount(), 1);
assert.equal(conflictFixture.activeAssignment().runtimeAssignmentId, "occupied-assignment");

console.log(JSON.stringify({
  schema: "constellation-workspace-creation-assignment-validation-v0.1",
  fresh: { status: fresh.status, workspaceCount: freshFixture.workspaceCount(), assignmentCount: freshFixture.assignmentCount() },
  replay: { status: replay.status, workspaceCount: freshFixture.workspaceCount(), assignmentCount: freshFixture.assignmentCount() },
  workspaceOnlyRecovery: { status: recovery.status, workspaceCreated: recovery.workspaceCreated, assignmentCreated: recovery.assignmentCreated },
  concurrent: { statuses: concurrent.map((item) => item.status).sort(), workspaceCount: concurrentFixture.workspaceCount(), assignmentCount: concurrentFixture.assignmentCount() },
  conflict: { status: conflict.status, decision: conflict.decision, workspaceCount: conflictFixture.workspaceCount(), preservedAssignmentId: conflictFixture.activeAssignment().runtimeAssignmentId }
}));

function createFixture(options = {}) {
  const state = { ledger: createOperationLedger(), workspace: options.workspace ? structuredClone(options.workspace) : null, authority: { runtimeSessionId: "validation-session", authorityRevision: 0, assignmentRegistry: createAssignmentRegistry() } };
  if (options.assignment) state.authority.assignmentRegistry = assignRuntime(state.authority.assignmentRegistry, { workspaceId: options.assignment.workspaceId, windowId: options.assignment.windowId, sourceContextId: options.assignment.contextId, now: options.assignment.requestedAt, id: () => options.assignment.runtimeAssignmentId }).registry;
  let tail = Promise.resolve();
  const adapters = {
    runExclusiveOperation(callback) { const run = tail.then(callback); tail = run.catch(() => {}); return run; },
    async readOperationLedger() { return { status: "present", ledger: structuredClone(state.ledger), error: "" }; },
    async writeOperationLedger(ledger) { state.ledger = structuredClone(ledger); return { status: "written", error: "" }; },
    async reconfirmWorkspaceResolution() { return { schema: WORKSPACE_RESOLUTION_COORDINATION_RESULT_SCHEMA, status: "creation_required", reason: "no_eligible_workspace_evidence", decision: "create_workspace_and_assign", operationId: request.authorization.resolutionOperationId, contextId: request.contextId, windowId: request.windowId, resolvedWorkspaceId: null, expectedAssignmentEpoch: null, collection: [], resolution: null, retrySafe: false, warnings: [], errors: [] }; },
    async readWorkspace() { return state.workspace ? { status: "present", workspace: structuredClone(state.workspace), error: "" } : { status: "absent", workspace: null, error: "" }; },
    async writeWorkspace({ workspace, expectedAbsent }) { if (!expectedAbsent || state.workspace) return { status: "conflict", error: "conflict" }; state.workspace = structuredClone(workspace); return { status: "written", error: "" }; },
    async readRuntimeAuthority() { return { status: "present", runtimeSessionId: state.authority.runtimeSessionId, authorityRevision: state.authority.authorityRevision, contextVerified: true, assignmentRegistry: structuredClone(state.authority.assignmentRegistry), error: "" }; },
    async writeRuntimeAuthority(input) { if (input.expectedRuntimeSessionId !== state.authority.runtimeSessionId || input.expectedAuthorityRevision !== state.authority.authorityRevision) return { status: "conflict", runtimeSessionId: state.authority.runtimeSessionId, authorityRevision: state.authority.authorityRevision, error: "conflict" }; state.authority.assignmentRegistry = structuredClone(input.nextAssignmentRegistry); state.authority.authorityRevision += 1; return { status: "written", runtimeSessionId: state.authority.runtimeSessionId, authorityRevision: state.authority.authorityRevision, error: "" }; }
  };
  return { adapters, workspaceCount: () => state.workspace ? 1 : 0, assignmentCount: () => state.authority.assignmentRegistry.assignments.filter((item) => item.state === "active").length, activeAssignment: () => state.authority.assignmentRegistry.assignments.find((item) => item.state === "active") || null };
}
