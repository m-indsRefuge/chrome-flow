import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assignRuntime, createAssignmentRegistry } from "../../src/core/runtime-contract/assignments.js";
import { createOperationLedger } from "../../src/core/runtime-contract/ledger.js";
import { WORKSPACE_RESOLUTION_COORDINATION_RESULT_SCHEMA } from "../../src/core/workspace-resolution-coordination/contract.js";
import { WORKSPACE_CREATION_ASSIGNMENT_REQUEST_SCHEMA, RESULT_FIELDS } from "../../src/core/workspace-creation-assignment-transaction/contract.js";
import { createTransactionRequestFingerprint } from "../../src/core/workspace-creation-assignment-transaction/fingerprint.js";
import { coordinateWorkspaceCreationAssignment } from "../../src/core/workspace-creation-assignment-transaction/coordinator.js";
import { checkWorkspaceCreationAssignmentTransactionPurity, validWorkspaceCreationAssignmentTransactionSpecifier } from "../../scripts/check-runtime-contract-purity.mjs";

const request = Object.freeze({
  schema: WORKSPACE_CREATION_ASSIGNMENT_REQUEST_SCHEMA,
  operationId: "transaction-1",
  contextId: "context-1",
  windowId: 7,
  workspaceId: "workspace-1",
  runtimeAssignmentId: "assignment-1",
  requestedAt: "2026-07-14T10:00:00.000Z",
  workspaceRecord: Object.freeze({ workspaceId: "workspace-1", name: "Verified workspace", tabs: [] }),
  authorization: Object.freeze({ resolutionOperationId: "resolution-1", resolutionResultSchema: WORKSPACE_RESOLUTION_COORDINATION_RESULT_SCHEMA, status: "creation_required", decision: "create_workspace_and_assign", contextId: "context-1", windowId: 7, operatorAuthorized: true })
});

test("clean create-and-assign commits with workspace-first ordering", async () => {
  const fixture = createFixture();
  const result = await coordinateWorkspaceCreationAssignment(request, fixture.adapters);
  assert.equal(result.status, "committed"); assert.equal(result.decision, "use_created_workspace"); assert.equal(result.workspaceCreated, true); assert.equal(result.assignmentCreated, true); assert.equal(result.workspaceVerified, true); assert.equal(result.assignmentVerified, true);
  assert.ok(fixture.events.indexOf("writeWorkspace") < fixture.events.indexOf("writeRuntimeAuthority")); assertComplete(result);
});

test("exact operation-ledger replay avoids lock and writes", async () => {
  const fixture = createFixture(); await coordinateWorkspaceCreationAssignment(request, fixture.adapters); resetCounts(fixture);
  const result = await coordinateWorkspaceCreationAssignment(request, fixture.adapters);
  assert.equal(result.status, "replayed"); assert.equal(result.replayed, true); assert.equal(fixture.counts.runExclusiveOperation, 0); assert.equal(fixture.counts.writeWorkspace, 0); assert.equal(fixture.counts.writeRuntimeAuthority, 0);
});

test("operation ID fingerprint conflict fails closed", async () => {
  const fixture = createFixture(); await coordinateWorkspaceCreationAssignment(request, fixture.adapters);
  const changed = { ...request, workspaceRecord: { ...request.workspaceRecord, name: "Different" } };
  const result = await coordinateWorkspaceCreationAssignment(changed, fixture.adapters);
  assert.equal(result.status, "conflict"); assert.equal(result.reason, "operation_id_fingerprint_conflict");
});

test("matching workspace partial recovery creates only assignment", async () => {
  const fixture = createFixture({ workspace: request.workspaceRecord });
  const result = await coordinateWorkspaceCreationAssignment(request, fixture.adapters);
  assert.equal(result.status, "committed"); assert.equal(result.workspaceCreated, false); assert.equal(result.assignmentCreated, true); assert.equal(fixture.counts.writeWorkspace, 0);
});

test("matching workspace and exact assignment replays", async () => {
  const fixture = createFixture({ workspace: request.workspaceRecord, assignment: request });
  const result = await coordinateWorkspaceCreationAssignment(request, fixture.adapters);
  assert.equal(result.status, "replayed"); assert.equal(result.assignmentCreated, false); assert.equal(fixture.counts.writeRuntimeAuthority, 0);
});

test("mismatched workspace conflicts without overwrite", async () => {
  const fixture = createFixture({ workspace: { workspaceId: request.workspaceId, name: "Other", tabs: [] } });
  const result = await coordinateWorkspaceCreationAssignment(request, fixture.adapters);
  assert.equal(result.status, "conflict"); assert.equal(fixture.counts.writeWorkspace, 0);
});

for (const [name, assignment] of [
  ["destination-window assignment", { ...request, workspaceId: "other-workspace", runtimeAssignmentId: "other-assignment" }],
  ["workspace active elsewhere", { ...request, windowId: 8, runtimeAssignmentId: "other-assignment" }]
]) test(name + " conflicts without transfer", async () => {
  const fixture = createFixture({ workspace: request.workspaceRecord, assignment });
  const result = await coordinateWorkspaceCreationAssignment(request, fixture.adapters);
  assert.equal(result.status, "conflict"); assert.equal(result.decision, "manual_resolution_required"); assert.equal(fixture.counts.writeRuntimeAuthority, 0);
});

test("fresh resolution redirects without writes", async () => {
  const fixture = createFixture({ resolution: resolutionResult("resolved", "use_resolved_workspace", "existing-workspace") });
  const result = await coordinateWorkspaceCreationAssignment(request, fixture.adapters);
  assert.equal(result.status, "redirected"); assert.equal(result.resolvedWorkspaceId, "existing-workspace"); assert.equal(fixture.counts.writeWorkspace, 0); assert.equal(fixture.counts.writeRuntimeAuthority, 0);
});

for (const [status, decision, expectedStatus] of [["ambiguous", "manual_resolution_required", "conflict"], ["invalid", "reject_request", "invalid"], ["failed", "retry_collection", "failed"]]) test("fresh resolution " + status + " maps explicitly", async () => {
  const fixture = createFixture({ resolution: resolutionResult(status, decision) });
  const result = await coordinateWorkspaceCreationAssignment(request, fixture.adapters);
  assert.equal(result.status, expectedStatus); assert.equal(fixture.counts.writeWorkspace, 0);
});

for (const [name, behavior] of [["rejection", "conflict"], ["failure", "failed"]]) test("workspace write " + name + " preserves absence", async () => {
  const fixture = createFixture(); fixture.adapters.writeWorkspace = async () => ({ status: behavior, error: behavior });
  const result = await coordinateWorkspaceCreationAssignment(request, fixture.adapters);
  assert.equal(result.phase, "workspace_write"); assert.equal(result.workspaceCreated, false); assert.equal(fixture.state.workspace, null);
});

test("workspace write throw becomes retryable failure", async () => {
  const fixture = createFixture(); fixture.adapters.writeWorkspace = async () => { throw new Error("write"); };
  const result = await coordinateWorkspaceCreationAssignment(request, fixture.adapters);
  assert.equal(result.status, "failed"); assert.equal(result.phase, "workspace_write");
});

test("workspace verification mismatch fails with no rollback", async () => {
  const fixture = createFixture(); const original = fixture.adapters.readWorkspace; let reads = 0;
  fixture.adapters.readWorkspace = async (input) => { const value = await original(input); reads += 1; return reads === 2 ? { status: "present", workspace: { ...request.workspaceRecord, name: "mismatch" }, error: "" } : value; };
  const result = await coordinateWorkspaceCreationAssignment(request, fixture.adapters);
  assert.equal(result.phase, "workspace_verification"); assert.equal(result.workspaceCreated, true); assert.notEqual(fixture.state.workspace, null);
});

test("assignment transition conflict is rejected", async () => {
  const fixture = createFixture({ workspace: request.workspaceRecord, assignment: { ...request, workspaceId: "other", runtimeAssignmentId: "other" } });
  const result = await coordinateWorkspaceCreationAssignment(request, fixture.adapters); assert.equal(result.status, "conflict");
});

test("authority write conflict without proof fails", async () => {
  const fixture = createFixture({ workspace: request.workspaceRecord }); fixture.adapters.writeRuntimeAuthority = async () => ({ status: "conflict", runtimeSessionId: fixture.state.authority.runtimeSessionId, authorityRevision: fixture.state.authority.authorityRevision, error: "conflict" });
  const result = await coordinateWorkspaceCreationAssignment(request, fixture.adapters); assert.equal(result.status, "failed"); assert.equal(result.assignmentVerified, false);
});

test("authority write throw without proof fails closed", async () => {
  const fixture = createFixture({ workspace: request.workspaceRecord }); fixture.adapters.writeRuntimeAuthority = async () => { throw new Error("write"); };
  const result = await coordinateWorkspaceCreationAssignment(request, fixture.adapters); assert.equal(result.status, "failed");
});

for (const writeStatus of ["failed", "conflict"]) test("authority write " + writeStatus + " followed by exact reread converges", async () => {
  const fixture = createFixture({ workspace: request.workspaceRecord });
  fixture.adapters.writeRuntimeAuthority = async (input) => { fixture.state.authority.assignmentRegistry = structuredClone(input.nextAssignmentRegistry); fixture.state.authority.authorityRevision += 1; return { status: writeStatus, runtimeSessionId: fixture.state.authority.runtimeSessionId, authorityRevision: fixture.state.authority.authorityRevision, error: writeStatus }; };
  const result = await coordinateWorkspaceCreationAssignment(request, fixture.adapters);
  assert.equal(result.assignmentVerified, true); assert.equal(result.status, writeStatus === "conflict" ? "replayed" : "committed");
});

test("assignment verification mismatch fails", async () => {
  const fixture = createFixture({ workspace: request.workspaceRecord }); const original = fixture.adapters.writeRuntimeAuthority;
  fixture.adapters.writeRuntimeAuthority = async (input) => { const value = await original(input); fixture.state.authority.assignmentRegistry.assignments[0].runtimeAssignmentId = "wrong"; return value; };
  const result = await coordinateWorkspaceCreationAssignment(request, fixture.adapters); assert.equal(result.assignmentVerified, false);
});

for (const [name, mutate] of [["runtime session", (authority) => { authority.runtimeSessionId = "session-2"; }], ["authority revision", (authority) => { authority.authorityRevision += 1; }]]) test(name + " change between reads fails closed", async () => {
  const fixture = createFixture({ workspace: request.workspaceRecord }); const original = fixture.adapters.readRuntimeAuthority; let reads = 0;
  fixture.adapters.readRuntimeAuthority = async (input) => { reads += 1; if (reads === 2) mutate(fixture.state.authority); return original(input); };
  const result = await coordinateWorkspaceCreationAssignment(request, fixture.adapters); assert.equal(result.status, "conflict");
});

test("workspace-only partial state is never rolled back", async () => {
  const fixture = createFixture(); fixture.adapters.writeRuntimeAuthority = async () => { throw new Error("assignment failed"); };
  const result = await coordinateWorkspaceCreationAssignment(request, fixture.adapters); assert.equal(result.workspaceCreated, true); assert.deepEqual(fixture.state.workspace, request.workspaceRecord);
});

test("matching assignment with missing workspace requires manual resolution", async () => {
  const fixture = createFixture({ assignment: request }); const result = await coordinateWorkspaceCreationAssignment(request, fixture.adapters);
  assert.equal(result.status, "conflict"); assert.equal(result.reason, "assignment_exists_without_workspace"); assert.equal(fixture.counts.writeWorkspace, 0);
});

test("operation recording failure preserves verified authorities", async () => {
  const fixture = createFixture(); fixture.adapters.writeOperationLedger = async () => ({ status: "failed", error: "unavailable" });
  const result = await coordinateWorkspaceCreationAssignment(request, fixture.adapters); assert.equal(result.status, "indeterminate"); assert.equal(result.workspaceVerified, true); assert.equal(result.assignmentVerified, true);
});

test("concurrent identical calls converge beneath injected exclusivity", async () => {
  const fixture = createFixture(); const [left, right] = await Promise.all([coordinateWorkspaceCreationAssignment(request, fixture.adapters), coordinateWorkspaceCreationAssignment(request, fixture.adapters)]);
  assert.deepEqual([left.status, right.status].sort(), ["committed", "replayed"]); assert.equal(fixture.state.authority.assignmentRegistry.assignments.length, 1); assert.equal(fixture.counts.writeWorkspace, 1); assert.equal(fixture.counts.writeRuntimeAuthority, 1);
});

test("adapter timing does not change semantic result", async () => {
  const slow = createFixture({ delayReads: true }), fast = createFixture();
  const [a, b] = await Promise.all([coordinateWorkspaceCreationAssignment(request, slow.adapters), coordinateWorkspaceCreationAssignment(request, fast.adapters)]);
  assert.equal(a.status, b.status); assert.equal(a.workspaceId, b.workspaceId); assert.equal(a.assignmentEpoch, b.assignmentEpoch);
});

test("clean commit calls each adapter the expected number of times", async () => {
  const fixture = createFixture(); await coordinateWorkspaceCreationAssignment(request, fixture.adapters);
  assert.deepEqual(fixture.counts, { runExclusiveOperation: 1, readOperationLedger: 2, writeOperationLedger: 1, reconfirmWorkspaceResolution: 1, readWorkspace: 3, writeWorkspace: 1, readRuntimeAuthority: 4, writeRuntimeAuthority: 1 });
});

test("malformed request rejects before adapters", async () => {
  const fixture = createFixture(); const result = await coordinateWorkspaceCreationAssignment({ ...request, extra: true }, fixture.adapters);
  assert.equal(result.status, "invalid"); assert.equal(fixture.counts.readOperationLedger, 0); assertComplete(result);
});

test("invalid requestedAt rejects before adapters", async () => {
  const fixture = createFixture(); const result = await coordinateWorkspaceCreationAssignment({ ...request, requestedAt: "not-a-date" }, fixture.adapters);
  assert.equal(result.status, "invalid"); assert.equal(fixture.counts.readOperationLedger, 0);
});

test("workspace record identity mismatch rejects", async () => {
  const result = await coordinateWorkspaceCreationAssignment({ ...request, workspaceRecord: { ...request.workspaceRecord, workspaceId: "other" } }, createFixture().adapters);
  assert.equal(result.status, "invalid"); assert.ok(result.errors.includes("workspace_record_identity_mismatch"));
});

test("authorization identity and operator consent are mandatory", async () => {
  const authorization = { ...request.authorization, contextId: "other", operatorAuthorized: false };
  const result = await coordinateWorkspaceCreationAssignment({ ...request, authorization }, createFixture().adapters);
  assert.equal(result.status, "invalid"); assert.ok(result.errors.includes("authorization_identity_mismatch")); assert.ok(result.errors.includes("operator_authorization_required"));
});

test("throwing request getter and prototype trap return complete invalid results", async () => {
  const getter = { ...request }; Object.defineProperty(getter, "workspaceId", { enumerable: true, get() { throw new Error("getter"); } });
  const proxy = new Proxy({}, { getPrototypeOf() { throw new Error("prototype"); }, get() { throw new Error("get"); } });
  for (const value of [getter, proxy]) { const result = await coordinateWorkspaceCreationAssignment(value, createFixture().adapters); assert.equal(result.status, "invalid"); assertComplete(result); }
});

test("invalid adapter object and throwing adapter property getter reject", async () => {
  const getter = {}; Object.defineProperty(getter, "runExclusiveOperation", { enumerable: true, get() { throw new Error("getter"); } });
  for (const value of [null, getter]) { const result = await coordinateWorkspaceCreationAssignment(request, value); assert.equal(result.status, "invalid"); assertComplete(result); }
});

test("throwing malformed and cyclic adapter results cannot escape", async () => {
  const variants = [() => { const value = {}; Object.defineProperty(value, "status", { enumerable: true, get() { throw new Error("getter"); } }); return value; }, () => ({ nope: true }), () => { const value = {}; value.self = value; return value; }];
  for (const make of variants) { const fixture = createFixture(); fixture.adapters.readOperationLedger = async () => make(); const result = await coordinateWorkspaceCreationAssignment(request, fixture.adapters); assert.equal(result.status, "failed"); assertComplete(result); }
});

test("all required statuses share one exact serializable shape", async () => {
  const committedFixture = createFixture(); const committed = await coordinateWorkspaceCreationAssignment(request, committedFixture.adapters);
  const replayed = await coordinateWorkspaceCreationAssignment(request, committedFixture.adapters);
  const redirected = await coordinateWorkspaceCreationAssignment({ ...request, operationId: "redirect" }, createFixture({ resolution: resolutionResult("resolved", "use_resolved_workspace", "existing") }).adapters);
  const conflict = await coordinateWorkspaceCreationAssignment(request, createFixture({ workspace: { ...request.workspaceRecord, name: "other" } }).adapters);
  const invalid = await coordinateWorkspaceCreationAssignment({ ...request, extra: true }, createFixture().adapters);
  const failedFixture = createFixture(); failedFixture.adapters.readOperationLedger = async () => ({ status: "failed", ledger: null, error: "unavailable" }); const failed = await coordinateWorkspaceCreationAssignment(request, failedFixture.adapters);
  const indeterminateFixture = createFixture(); indeterminateFixture.adapters.writeOperationLedger = async () => ({ status: "failed", error: "unavailable" }); const indeterminateResult = await coordinateWorkspaceCreationAssignment(request, indeterminateFixture.adapters);
  const values = [committed, replayed, redirected, conflict, invalid, failed, indeterminateResult];
  assert.deepEqual(values.map((value) => value.status), ["committed", "replayed", "redirected", "conflict", "invalid", "failed", "indeterminate"]);
  for (const value of values) assertComplete(value);
});

test("request and shared adapter return values remain unmodified", async () => {
  const requestCopy = structuredClone(request), fixture = createFixture({ workspace: request.workspaceRecord });
  const shared = { status: "present", workspace: structuredClone(request.workspaceRecord), error: "" }, before = structuredClone(shared);
  fixture.adapters.readWorkspace = async () => shared;
  await coordinateWorkspaceCreationAssignment(requestCopy, fixture.adapters);
  assert.deepEqual(requestCopy, request); assert.deepEqual(shared, before);
});

test("fingerprint excludes operation ID and does not mutate input", () => {
  const copy = structuredClone(request); const changed = { ...copy, operationId: "other" };
  assert.equal(createTransactionRequestFingerprint(copy), createTransactionRequestFingerprint(changed)); assert.deepEqual(copy, request);
});

test("fingerprint changes when authority-relevant content changes", () => {
  const original = createTransactionRequestFingerprint(request);
  assert.notEqual(original, createTransactionRequestFingerprint({ ...request, runtimeAssignmentId: "other-assignment" }));
  assert.notEqual(original, createTransactionRequestFingerprint({ ...request, authorization: { ...request.authorization, resolutionOperationId: "other-resolution" } }));
});

test("coordinator contains no prohibited dependencies", async () => {
  const sources = await Promise.all(["contract.js", "fingerprint.js", "state-machine.js", "coordinator.js"].map((name) => readFile(new URL("../../src/core/workspace-creation-assignment-transaction/" + name, import.meta.url), "utf8")));
  assert.doesNotMatch(sources.join("\n"), /\b(Date\.now|new Date|Math\.random|crypto|chrome|indexedDB|fetch|localStorage|sessionStorage|setTimeout|setInterval|localeCompare)\b/);
});

test("purity checker accepts canonical imports", async () => {
  for (const specifier of ["./contract.js", "../runtime-contract/value-utils.js", "../runtime-contract/assignments.js", "../runtime-contract/ledger.js", "../workspace-resolution-coordination/contract.js"]) assert.equal(validWorkspaceCreationAssignmentTransactionSpecifier(specifier), true);
  assert.equal(await checkWorkspaceCreationAssignmentTransactionPurity(), 4);
});

test("purity checker rejects traversal dependencies and prohibited capabilities", async () => {
  for (const specifier of ["../escape.js", "./nested/file.js", "node:fs", "pkg", "../runtime-contract/constants.js"]) assert.equal(validWorkspaceCreationAssignmentTransactionSpecifier(specifier), false);
  const root = await mkdtemp(join(tmpdir(), "creation-assignment-purity-"));
  for (const name of ["contract.js", "fingerprint.js", "state-machine.js"]) await writeFile(join(root, name), "export const ok = true;\n");
  const adversaries = ["import('../x.js');", "export const x = `bad`;", "chrome.tabs;", "localStorage.getItem('x');", "fetch('x');", "Date.now();", "Math.random();"];
  for (const source of adversaries) { await writeFile(join(root, "coordinator.js"), source); await assert.rejects(checkWorkspaceCreationAssignmentTransactionPurity(pathUrl(root))); }
});


test("stateful authorization getter is snapshotted once before validation and fingerprinting", async () => {
  let reads = 0;
  const authorization = { ...request.authorization };
  Object.defineProperty(authorization, "operatorAuthorized", { enumerable: true, get() { reads += 1; return reads === 1; } });
  const statefulRequest = { ...request, operationId: "stateful-authorization", authorization };
  const fixture = createFixture();
  const result = await coordinateWorkspaceCreationAssignment(statefulRequest, fixture.adapters);
  assert.equal(result.status, "committed");
  assert.equal(reads, 1);
  assert.match(result.requestFingerprint, /"operatorAuthorized":true/);
});

test("known assignment conflict prevents workspace creation when requested workspace is absent", async () => {
  const assignment = { ...request, workspaceId: "occupied-workspace", runtimeAssignmentId: "occupied-assignment" };
  const fixture = createFixture({ assignment });
  const result = await coordinateWorkspaceCreationAssignment(request, fixture.adapters);
  assert.equal(result.status, "conflict");
  assert.equal(result.reason, "destination_conflict");
  assert.equal(fixture.counts.writeWorkspace, 0);
  assert.equal(fixture.state.workspace, null);
});

test("uncertain workspace write that is proved by reread rolls forward", async () => {
  const fixture = createFixture();
  fixture.adapters.writeWorkspace = async ({ workspace }) => {
    fixture.counts.writeWorkspace += 1;
    fixture.state.workspace = structuredClone(workspace);
    return { status: "failed", error: "uncertain" };
  };
  const result = await coordinateWorkspaceCreationAssignment(request, fixture.adapters);
  assert.equal(result.status, "committed");
  assert.equal(result.workspaceCreated, false);
  assert.equal(result.workspaceVerified, true);
  assert.ok(result.warnings.includes("workspace_write_outcome_verified_by_reread"));
  assert.deepEqual(fixture.state.workspace, request.workspaceRecord);
});

test("exclusive adapter cannot report success without invoking the callback", async () => {
  const source = createFixture();
  const validSuccess = await coordinateWorkspaceCreationAssignment(request, source.adapters);
  const fixture = createFixture();
  fixture.adapters.runExclusiveOperation = async () => validSuccess;
  const result = await coordinateWorkspaceCreationAssignment(request, fixture.adapters);
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "exclusive_operation_callback_not_invoked");
  assert.equal(fixture.state.workspace, null);
  assert.equal(fixture.state.authority.assignmentRegistry.assignments.length, 0);
});

test("exclusive adapter callback reuse is detected after one semantic execution", async () => {
  const fixture = createFixture();
  fixture.adapters.runExclusiveOperation = async (callback) => {
    await callback();
    return callback();
  };
  const result = await coordinateWorkspaceCreationAssignment(request, fixture.adapters);
  assert.equal(result.status, "indeterminate");
  assert.equal(result.reason, "exclusive_operation_callback_count_invalid");
  assert.equal(fixture.state.authority.assignmentRegistry.assignments.length, 1);
});

test("malformed exact-shape fresh resolution cannot redirect without a workspace identity", async () => {
  const malformed = { ...resolutionResult("resolved", "use_resolved_workspace", "existing-workspace"), resolvedWorkspaceId: 7 };
  const fixture = createFixture({ resolution: malformed });
  const result = await coordinateWorkspaceCreationAssignment(request, fixture.adapters);
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "resolution_reconfirmation_failed");
  assert.equal(fixture.counts.writeWorkspace, 0);
});

test("adapter results are snapshotted once before validation", async () => {
  const fixture = createFixture();
  let reads = 0;
  fixture.adapters.readOperationLedger = async () => {
    let localReads = 0;
    const value = { ledger: structuredClone(fixture.state.ledger), error: "" };
    Object.defineProperty(value, "status", { enumerable: true, get() { reads += 1; localReads += 1; return localReads === 1 ? "present" : "failed"; } });
    return value;
  };
  const result = await coordinateWorkspaceCreationAssignment(request, fixture.adapters);
  assert.equal(result.status, "committed");
  assert.equal(reads, 2);
});

test("operation replay rejects a stored result with the wrong schema", async () => {
  const fixture = createFixture();
  const fingerprint = createTransactionRequestFingerprint(request);
  const valid = await coordinateWorkspaceCreationAssignment(request, fixture.adapters);
  const wrongSchema = { ...valid, schema: "wrong-schema" };
  fixture.state.ledger = createOperationLedger();
  fixture.state.ledger.entries.push({ operationId: request.operationId, requestFingerprint: fingerprint, result: wrongSchema, recordedAt: request.requestedAt, sequence: 1 });
  fixture.state.ledger.nextSequence = 2;
  const result = await coordinateWorkspaceCreationAssignment(request, fixture.adapters);
  assert.equal(result.status, "conflict");
  assert.equal(result.reason, "operation_replay_result_invalid");
  assert.equal(result.schema, "constellation-workspace-creation-assignment-result-v0.1");
});

test("operation replay rejects a stored result with mismatched transaction identities", async () => {
  const fixture = createFixture();
  const fingerprint = createTransactionRequestFingerprint(request);
  const valid = await coordinateWorkspaceCreationAssignment(request, fixture.adapters);
  const mismatched = { ...valid, workspaceId: "other-workspace" };
  fixture.state.ledger = createOperationLedger();
  fixture.state.ledger.entries.push({ operationId: request.operationId, requestFingerprint: fingerprint, result: mismatched, recordedAt: request.requestedAt, sequence: 1 });
  fixture.state.ledger.nextSequence = 2;
  const result = await coordinateWorkspaceCreationAssignment(request, fixture.adapters);
  assert.equal(result.status, "conflict");
  assert.equal(result.reason, "operation_replay_result_invalid");
});

function createFixture(options = {}) {
  const state = { ledger: createOperationLedger(), workspace: options.workspace ? structuredClone(options.workspace) : null, authority: { runtimeSessionId: "session-1", authorityRevision: 0, assignmentRegistry: createAssignmentRegistry() } };
  if (options.assignment) state.authority.assignmentRegistry = assignRuntime(state.authority.assignmentRegistry, { workspaceId: options.assignment.workspaceId, windowId: options.assignment.windowId, sourceContextId: options.assignment.contextId, now: options.assignment.requestedAt, id: () => options.assignment.runtimeAssignmentId }).registry;
  const counts = Object.fromEntries(["runExclusiveOperation", "readOperationLedger", "writeOperationLedger", "reconfirmWorkspaceResolution", "readWorkspace", "writeWorkspace", "readRuntimeAuthority", "writeRuntimeAuthority"].map((name) => [name, 0]));
  const events = []; let tail = Promise.resolve(); const count = (name) => { counts[name] += 1; events.push(name); };
  const maybeDelay = async () => { if (options.delayReads) await Promise.resolve(); };
  const adapters = {
    runExclusiveOperation(callback) { count("runExclusiveOperation"); const run = tail.then(callback); tail = run.catch(() => {}); return run; },
    async readOperationLedger() { count("readOperationLedger"); await maybeDelay(); return { status: "present", ledger: structuredClone(state.ledger), error: "" }; },
    async writeOperationLedger(ledger) { count("writeOperationLedger"); state.ledger = structuredClone(ledger); return { status: "written", error: "" }; },
    async reconfirmWorkspaceResolution() { count("reconfirmWorkspaceResolution"); return structuredClone(options.resolution || resolutionResult("creation_required", "create_workspace_and_assign")); },
    async readWorkspace() { count("readWorkspace"); await maybeDelay(); return state.workspace ? { status: "present", workspace: structuredClone(state.workspace), error: "" } : { status: "absent", workspace: null, error: "" }; },
    async writeWorkspace({ workspace, expectedAbsent }) { count("writeWorkspace"); if (!expectedAbsent || state.workspace) return { status: "conflict", error: "conflict" }; state.workspace = structuredClone(workspace); return { status: "written", error: "" }; },
    async readRuntimeAuthority() { count("readRuntimeAuthority"); await maybeDelay(); return { status: "present", runtimeSessionId: state.authority.runtimeSessionId, authorityRevision: state.authority.authorityRevision, contextVerified: true, assignmentRegistry: structuredClone(state.authority.assignmentRegistry), error: "" }; },
    async writeRuntimeAuthority(input) { count("writeRuntimeAuthority"); if (input.expectedRuntimeSessionId !== state.authority.runtimeSessionId || input.expectedAuthorityRevision !== state.authority.authorityRevision) return { status: "conflict", runtimeSessionId: state.authority.runtimeSessionId, authorityRevision: state.authority.authorityRevision, error: "conflict" }; state.authority.assignmentRegistry = structuredClone(input.nextAssignmentRegistry); state.authority.authorityRevision += 1; return { status: "written", runtimeSessionId: state.authority.runtimeSessionId, authorityRevision: state.authority.authorityRevision, error: "" }; }
  };
  return { state, adapters, counts, events, stateSnapshot: () => structuredClone(state) };
}

function resolutionResult(status, decision, resolvedWorkspaceId = null) { return { schema: WORKSPACE_RESOLUTION_COORDINATION_RESULT_SCHEMA, status, reason: status, decision, operationId: request.authorization.resolutionOperationId, contextId: request.contextId, windowId: request.windowId, resolvedWorkspaceId, expectedAssignmentEpoch: null, collection: [], resolution: null, retrySafe: status === "failed", warnings: [], errors: [] }; }
function resetCounts(fixture) { for (const key of Object.keys(fixture.counts)) fixture.counts[key] = 0; fixture.events.length = 0; }
function assertComplete(value) { assert.deepEqual(Object.keys(value), RESULT_FIELDS); assert.doesNotThrow(() => structuredClone(value)); assert.doesNotThrow(() => JSON.stringify(value)); }
function pathUrl(path) { return new URL("file:///" + path.replaceAll("\\", "/") + "/"); }
