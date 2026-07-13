import test from "node:test";
import assert from "node:assert/strict";
import * as contract from "../../src/core/runtime-contract/index.js";
import { inspectRuntimeContractSource } from "../../scripts/check-runtime-contract-purity.mjs";
const NOW = "2026-07-12T10:00:00.000Z";
const later = "2026-07-12T11:00:00.000Z";
const envelope = (overrides = {}) => ({ schema: contract.SCHEMAS.mutation, operationId: "op-1", contextId: "ctx-1", contextType: "side_panel", runtimeAssignmentId: "", assignmentEpoch: null, workspaceId: "ws-1", expectedRevision: 0, mutationType: "journal.append", payload: { record: { entryId: "e-1", text: "note" } }, requestedAt: NOW, authorization: { mode: "operator" }, ...overrides });
const json = (value) => JSON.parse(JSON.stringify(value));
test("context identity is deterministic, distinct, validated, and serializable", () => {
  const one = contract.createRuntimeContext("side_panel", { id: () => "ctx-a", clock: () => NOW });
  assert.deepEqual(one, { schema: contract.SCHEMAS.context, contextId: "ctx-a", contextType: "side_panel", createdAt: NOW });
  assert.equal(contract.validateRuntimeContext(one).valid, true); assert.equal(contract.validateRuntimeContext({ ...one, contextType: "bad" }).valid, false); assert.deepEqual(json(one), one);
  let n = 0; assert.notEqual(contract.createRuntimeContext("side_panel", { id: () => "id-" + ++n }).contextId, contract.createRuntimeContext("side_panel", { id: () => "id-" + ++n }).contextId);
});
test("revision normalization rejects invalid values without mutation", () => {
  assert.deepEqual(contract.normalizeWorkspaceRevision({}), { valid: true, revision: 0 });
  for (const value of [0, 2]) assert.equal(contract.normalizeWorkspaceRevision({ workspaceRevision: value }).valid, true);
  for (const value of ["0", -1, 1.5, NaN, Infinity]) assert.equal(contract.normalizeWorkspaceRevision({ workspaceRevision: value }).valid, false);
  const source = { workspaceRevision: 2, extra: true }; const incremented = contract.incrementWorkspaceRevision(source); assert.equal(incremented.workspace.workspaceRevision, 3); assert.deepEqual(source, { workspaceRevision: 2, extra: true });
});
test("envelope validation covers assigned, transitional, malformed, and deterministic errors", () => {
  assert.equal(contract.validateMutationEnvelope(envelope()).valid, true);
  assert.equal(contract.validateMutationEnvelope(envelope({ runtimeAssignmentId: "a-1", assignmentEpoch: 1 })).valid, true);
  for (const changed of [{ schema: "bad" }, { operationId: "" }, { contextType: "bad" }, { mutationType: "bad" }, { expectedRevision: -1 }, { runtimeAssignmentId: "a" }, { assignmentEpoch: 1 }, { requestedAt: "bad" }]) assert.equal(contract.validateMutationEnvelope(envelope(changed)).valid, false);
  const cyclic = {}; cyclic.self = cyclic; assert.equal(contract.validateMutationEnvelope(envelope({ payload: cyclic })).valid, false); assert.equal(contract.validateMutationEnvelope(envelope({ payload: { fn() {} } })).valid, false);
  const cyclicAuthorization = { mode: "operator" }; cyclicAuthorization.self = cyclicAuthorization;
  assert.equal(contract.validateMutationEnvelope(envelope({ authorization: cyclicAuthorization })).valid, false);
  assert.equal(contract.validateMutationEnvelope(envelope({ authorization: { mode: "operator", fn() {} } })).valid, false);
  const validated = envelope({ authorization: { mode: "operator", evidence: { safe: true } } }); assert.equal(contract.validateMutationEnvelope(validated).valid, true); assert.doesNotThrow(() => contract.createRequestFingerprint(validated));
  assert.deepEqual(contract.validateMutationEnvelope(envelope({ schema: "bad", operationId: "" })).errors, contract.validateMutationEnvelope(envelope({ schema: "bad", operationId: "" })).errors);
});
test("fingerprints are canonical and exclude requestedAt", () => {
  const a = envelope({ payload: { z: 1, a: 2 } }); const b = envelope({ payload: { a: 2, z: 1 }, requestedAt: later });
  assert.equal(contract.createRequestFingerprint(a), contract.createRequestFingerprint(b));
  for (const changed of [{ payload: { a: 3 } }, { expectedRevision: 2 }, { contextId: "other" }, { runtimeAssignmentId: "a", assignmentEpoch: 1 }]) assert.notEqual(contract.createRequestFingerprint(a), contract.createRequestFingerprint(envelope(changed)));
});
test("bounded ledger preserves original records and deterministically evicts", () => {
  let ledger = contract.createOperationLedger(2); assert.equal(contract.inspectOperation(ledger, "x", "f").status, "missing");
  ledger = contract.recordOperation(ledger, { operationId: "a", requestFingerprint: "f1", result: { status: "committed" }, recordedAt: NOW }).ledger;
  assert.equal(contract.inspectOperation(ledger, "a", "f1").status, "replay"); assert.equal(contract.inspectOperation(ledger, "a", "f2").status, "conflict");
  const preserved = contract.recordOperation(ledger, { operationId: "a", requestFingerprint: "f2", result: {}, recordedAt: later }); assert.deepEqual(preserved.ledger, ledger);
  ledger = contract.recordOperation(ledger, { operationId: "b", requestFingerprint: "f", result: {}, recordedAt: NOW }).ledger; ledger = contract.recordOperation(ledger, { operationId: "c", requestFingerprint: "f", result: {}, recordedAt: NOW }).ledger;
  assert.deepEqual(ledger.entries.map((entry) => entry.operationId), ["b", "c"]); assert.deepEqual(json(ledger), ledger);
});
test("assignment registry enforces uniqueness, explicit transfer, release, and epochs", () => {
  let registry = contract.createAssignmentRegistry(); const base = { workspaceId: "w1", windowId: 1, sourceContextId: "c", now: NOW, id: () => "a1" }; const baseBefore = { ...base };
  const first = contract.assignRuntime(registry, base); registry = first.registry; assert.equal(first.assignment.assignmentEpoch, 1); assert.equal(contract.assignRuntime(registry, base).status, "no_change");
  assert.equal(contract.assignRuntime(registry, { ...base, windowId: 2 }).status, "workspace_conflict"); assert.equal(contract.assignRuntime(registry, { ...base, workspaceId: "w2" }).status, "assignment_conflict");
  assert.equal(contract.transferRuntime(registry, { ...base, windowId: 2, expectedRuntimeAssignmentId: "bad", expectedAssignmentEpoch: 1 }).status, "assignment_conflict");
  const moved = contract.transferRuntime(registry, { ...base, windowId: 2, expectedRuntimeAssignmentId: "a1", expectedAssignmentEpoch: 1, id: () => "a2", now: later }); registry = moved.registry; assert.equal(moved.assignment.assignmentEpoch, 2);
  assert.equal(contract.transferRuntime(registry, { ...base, windowId: 3, expectedRuntimeAssignmentId: "a2", expectedAssignmentEpoch: 1, id: () => "a3", now: later }).status, "assignment_conflict");
  const occupied = contract.assignRuntime(registry, { workspaceId: "w2", windowId: 3, sourceContextId: "c", now: NOW, id: () => "occupied" }).registry;
  assert.equal(contract.transferRuntime(occupied, { ...base, windowId: 3, expectedRuntimeAssignmentId: "a2", expectedAssignmentEpoch: 2, id: () => "a3", now: later }).status, "assignment_conflict");
  assert.equal(contract.assignRuntime(registry, { workspaceId: "w2", windowId: 3, sourceContextId: "c", now: NOW, id: () => "a2" }).status, "assignment_conflict");
  for (const invalid of [{ ...base, workspaceId: "" }, { ...base, windowId: 1.5 }, { ...base, sourceContextId: "" }, { ...base, now: "bad" }, { ...base, id: () => "" }]) assert.equal(contract.assignRuntime(contract.createAssignmentRegistry(), invalid).status, "rejected");
  assert.equal(contract.resolveAssignmentByWindow(registry, 2).workspaceId, "w1"); assert.equal(contract.resolveAssignmentByWorkspace(registry, "w1").runtimeAssignmentId, "a2");
  assert.equal(contract.releaseRuntime(registry, { runtimeAssignmentId: "a2", assignmentEpoch: 1, now: later }).status, "assignment_conflict"); registry = contract.releaseRuntime(registry, { runtimeAssignmentId: "a2", assignmentEpoch: 2, now: later }).registry;
  const again = contract.assignRuntime(registry, { ...base, id: () => "a3", now: later }); assert.equal(again.assignment.assignmentEpoch, 3); assert.deepEqual(contract.createAssignmentRegistry(), contract.createAssignmentRegistry()); assert.deepEqual(base, baseBefore);
});
test("failed transfers are atomic across generated identity validation", () => {
  const base = { workspaceId: "w", windowId: 1, sourceContextId: "c", now: NOW, id: () => "a1" };
  let registry = contract.assignRuntime(contract.createAssignmentRegistry(), base).registry;
  registry = contract.transferRuntime(registry, { ...base, windowId: 2, now: later, expectedRuntimeAssignmentId: "a1", expectedAssignmentEpoch: 1, id: () => "a2" }).registry;
  for (const generated of ["", "a2", "a1"]) {
    const before = json(registry);
    const failed = contract.transferRuntime(registry, { ...base, windowId: 3, now: later, expectedRuntimeAssignmentId: "a2", expectedAssignmentEpoch: 2, id: () => generated });
    assert.ok(["rejected", "assignment_conflict"].includes(failed.status)); assert.deepEqual(failed.registry, before); assert.equal(failed.registry.nextEpoch, 3); assert.equal(contract.resolveAssignmentByWorkspace(failed.registry, "w").runtimeAssignmentId, "a2"); assert.deepEqual(registry, before);
  }
  const success = contract.transferRuntime(registry, { ...base, windowId: 3, now: later, expectedRuntimeAssignmentId: "a2", expectedAssignmentEpoch: 2, id: () => "a3" });
  assert.equal(success.assignment.assignmentEpoch, 3); assert.equal(success.registry.nextEpoch, 4); assert.equal(success.registry.assignments.filter((item) => item.state === "active").length, 1); assert.equal(success.registry.assignments.find((item) => item.runtimeAssignmentId === "a2").state, "released");
});
test("assignment fallback accepts only truly unassigned workspaces", () => {
  const empty = contract.createAssignmentRegistry(); assert.equal(contract.validateEnvelopeAssignment(empty, envelope()).valid, true);
  const assigned = contract.assignRuntime(empty, { workspaceId: "ws-1", windowId: 1, sourceContextId: "ctx", now: NOW, id: () => "a1" }).registry;
  assert.equal(contract.validateEnvelopeAssignment(assigned, envelope()).valid, false);
  assert.equal(contract.validateEnvelopeAssignment(assigned, envelope({ runtimeAssignmentId: "a1", assignmentEpoch: 1 })).valid, true);
  assert.equal(contract.validateEnvelopeAssignment(assigned, envelope({ runtimeAssignmentId: "a1", assignmentEpoch: 2 })).valid, false);
});
test("dirty registry coalesces, retains failure, and clears only its target", () => {
  let registry = contract.createDirtyRegistry(); const d = { workspaceId: "w", runtimeAssignmentId: "a", assignmentEpoch: 1, trigger: "save", now: NOW }; const beforeDetails = json(d); const originalRegistry = json(registry);
  registry = contract.markDirty(registry, d).registry; registry = contract.markDirty(registry, { ...d, trigger: "save", now: later }).registry; registry = contract.markDirty(registry, { ...d, trigger: "projection", now: later }).registry;
  assert.deepEqual(registry.records[0].triggers, ["save", "projection"]); assert.equal(registry.records[0].firstRequestedAt, NOW); assert.equal(registry.records[0].lastRequestedAt, later); assert.equal(contract.markDirty(registry, { ...d, assignmentEpoch: 2 }).status, "assignment_conflict");
  registry = contract.startDirtyAttempt(registry, "w", "a").registry; registry = contract.failDirtyAttempt(registry, { workspaceId: "w", runtimeAssignmentId: "a", failure: { message: "x" } }).registry; assert.equal(registry.records[0].failureCount, 1); assert.equal(registry.records[0].status, "pending");
  registry = contract.markDirty(registry, { workspaceId: "other", runtimeAssignmentId: "", assignmentEpoch: null, trigger: "x", now: NOW }).registry; registry = contract.completeDirtyTarget(registry, "w", "a").registry; assert.deepEqual(contract.listPendingDirty(registry).map((r) => r.workspaceId), ["other"]); assert.deepEqual(json(registry), registry);
  for (const invalid of [{ ...d, trigger: "" }, { ...d, assignmentEpoch: null }, { ...d, runtimeAssignmentId: "", assignmentEpoch: 1 }, { ...d, now: "bad" }]) assert.equal(contract.markDirty(registry, invalid).status, "rejected");
  assert.equal(contract.failDirtyAttempt(registry, { workspaceId: "other", runtimeAssignmentId: "", failure: { fn() {} } }).status, "rejected"); assert.deepEqual(d, beforeDetails); assert.deepEqual(originalRegistry, contract.createDirtyRegistry());
});
test("reducers are immutable, bounded, class-separated, and preserve unknown fields", () => {
  const source = { workspaceId: "ws-1", workspaceRevision: 0, name: "Old", unknown: { keep: true }, tabs: [{ workspaceTabId: "t1", alias: "", role: "x", tabId: 1, extra: 9 }], journal: [], timeline: [] }; const before = json(source);
  assert.equal(contract.applyDomainMutation(source, "journal.append", { record: { entryId: "j1", text: "x" } }).workspace.journal.length, 1); assert.equal(contract.applyDomainMutation(source, "timeline.append", { record: { type: "x" } }).workspace.timeline.length, 1);
  assert.equal(contract.applyDomainMutation(source, "workspace.metadata.patch", { patch: { name: "New" } }).workspace.unknown.keep, true); assert.equal(contract.applyDomainMutation(source, "workspace.metadata.patch", { patch: { bad: true } }).outcome, "rejected");
  assert.equal(contract.applyDomainMutation(source, "workspace.tab.add", { tab: { workspaceTabId: "t2" } }).outcome, "changed"); assert.equal(contract.applyDomainMutation(source, "workspace.tab.add", { tab: { workspaceTabId: "t1" } }).outcome, "rejected");
  assert.equal(contract.applyDomainMutation(source, "workspace.tab.add", { tab: {}, workspaceTabId: "t2" }).outcome, "rejected"); assert.equal(contract.applyDomainMutation(source, "workspace.tab.add", { tab: { workspaceTabId: "t2" }, workspaceTabId: "different" }).outcome, "rejected"); assert.equal(contract.applyDomainMutation(source, "workspace.tab.add", { tab: { workspaceTabId: "t1" }, workspaceTabId: "bypass" }).outcome, "rejected");
  assert.equal(contract.applyDomainMutation(source, "workspace.tab.remove", { workspaceTabId: "missing" }).outcome, "no_change"); assert.equal(contract.applyDomainMutation(source, "workspace.tab.remove", { workspaceTabId: "t1" }).outcome, "changed");
  assert.equal(contract.applyDomainMutation(source, "workspace.tab.metadata.patch", { workspaceTabId: "t1", patch: { alias: "A" } }).workspace.tabs[0].extra, 9); assert.equal(contract.applyDomainMutation(source, "workspace.tab.projection.patch", { workspaceTabId: "t1", patch: { tabId: 2 } }).outcome, "changed");
  assert.equal(contract.applyDomainMutation(source, "workspace.tab.projection.patch", { workspaceTabId: "t1", patch: { lastMatchStatus: "exact" } }).outcome, "changed"); assert.equal(contract.applyDomainMutation(source, "unknown.mutation", {}).reason, "unsupported_mutation_type");
  for (const input of [{ type: "workspace.tab.metadata.patch", patch: { tabId: 2 } }, { type: "workspace.tab.projection.patch", patch: { alias: "A" } }, { type: "workspace.tab.metadata.patch", patch: { workspaceTabId: "x" } }]) assert.equal(contract.applyDomainMutation(source, input.type, { workspaceTabId: "t1", patch: input.patch }).outcome, "rejected");
  assert.equal(contract.applyDomainMutation(source, "workspace.tab.metadata.patch", { workspaceTabId: "t1", patch: { alias: "" } }).outcome, "no_change"); assert.deepEqual(source, before);
});
test("mutation engine commits, conflicts, replays, and never mutates inputs", () => {
  const workspace = { workspaceId: "ws-1", tabs: [], journal: [], timeline: [], unknown: true }; let ledger = contract.createOperationLedger(); const registry = contract.createAssignmentRegistry(); const originals = json({ workspace, ledger, registry });
  let evaluated = contract.evaluateRuntimeMutation({ workspace, envelope: envelope(), operationLedger: ledger, assignmentRegistry: registry, now: NOW }); assert.equal(evaluated.result.status, "committed"); assert.equal(evaluated.workspace.workspaceRevision, 1); ledger = evaluated.operationLedger;
  const replay = contract.evaluateRuntimeMutation({ workspace: evaluated.workspace, envelope: envelope({ requestedAt: later }), operationLedger: ledger, assignmentRegistry: registry, now: later }); assert.equal(replay.result.status, "replayed"); assert.equal(replay.workspace.journal.length, 1);
  assert.equal(contract.evaluateRuntimeMutation({ workspace, envelope: envelope({ payload: { record: { text: "changed" } } }), operationLedger: ledger, assignmentRegistry: registry, now: later }).result.status, "operation_id_conflict");
  evaluated = contract.evaluateRuntimeMutation({ workspace: evaluated.workspace, envelope: envelope({ operationId: "op-2", expectedRevision: 1, mutationType: "workspace.metadata.patch", payload: { patch: { name: "N" } } }), operationLedger: ledger, assignmentRegistry: registry, now: later }); assert.equal(evaluated.workspace.workspaceRevision, 2);
  assert.equal(contract.evaluateRuntimeMutation({ workspace: evaluated.workspace, envelope: envelope({ operationId: "op-3", expectedRevision: 0 }), operationLedger: evaluated.operationLedger, assignmentRegistry: registry, now: later }).result.status, "revision_conflict");
  const conflictEnvelope = envelope({ operationId: "op-r", expectedRevision: 9 }); const conflict = contract.evaluateRuntimeMutation({ workspace, envelope: conflictEnvelope, operationLedger: contract.createOperationLedger(), assignmentRegistry: registry, now: NOW }); const replayedConflict = contract.evaluateRuntimeMutation({ workspace, envelope: { ...conflictEnvelope, requestedAt: later }, operationLedger: conflict.operationLedger, assignmentRegistry: registry, now: later }); assert.equal(replayedConflict.result.status, "replayed"); assert.equal(replayedConflict.result.originalStatus, "revision_conflict");
  assert.equal(contract.evaluateRuntimeMutation({ workspace, envelope: envelope({ operationId: "op-x", workspaceId: "other" }), operationLedger: contract.createOperationLedger(), assignmentRegistry: registry, now: NOW }).result.status, "workspace_conflict");
  assert.equal(contract.evaluateRuntimeMutation({ workspace, envelope: envelope({ operationId: "op-a", runtimeAssignmentId: "bad", assignmentEpoch: 1 }), operationLedger: contract.createOperationLedger(), assignmentRegistry: registry, now: NOW }).result.status, "assignment_conflict");
  const noChange = contract.evaluateRuntimeMutation({ workspace: { ...workspace, workspaceRevision: 0, name: "" }, envelope: envelope({ operationId: "op-n", mutationType: "workspace.metadata.patch", payload: { patch: { name: "" } } }), operationLedger: contract.createOperationLedger(), assignmentRegistry: registry, now: NOW }); assert.equal(noChange.result.status, "no_change"); assert.equal(noChange.workspace.workspaceRevision ?? 0, 0);
  const malformedLedger = contract.createOperationLedger(); assert.deepEqual(contract.evaluateRuntimeMutation({ workspace, envelope: { operationId: "" }, operationLedger: malformedLedger, assignmentRegistry: registry, now: NOW }).operationLedger, malformedLedger);
  assert.deepEqual({ workspace, ledger: originals.ledger, registry }, originals); assert.deepEqual(json(evaluated), evaluated);
});
test("malformed envelope results normalize unsafe identities and remain serializable", () => {
  const cases = [
    { field: "operationId", value: 1n, output: "operationId" },
    { field: "workspaceId", value: { unsafe: true }, output: "workspaceId" },
    { field: "runtimeAssignmentId", value: Symbol("assignment"), output: "runtimeAssignmentId" },
    { field: "contextId", value() {}, output: "writerContextId" }
  ];
  for (const item of cases) {
    const malformed = envelope({ [item.field]: item.value }); const ledger = contract.createOperationLedger(); let evaluated;
    assert.doesNotThrow(() => { evaluated = contract.evaluateRuntimeMutation({ workspace: { workspaceId: "ws-1" }, envelope: malformed, operationLedger: ledger, assignmentRegistry: contract.createAssignmentRegistry(), now: NOW }); });
    assert.equal(evaluated.result.status, "rejected"); assert.equal(evaluated.result.reason, "invalid_envelope"); assert.equal(evaluated.result[item.output], ""); assert.deepEqual(evaluated.operationLedger, ledger); assert.doesNotThrow(() => JSON.stringify(evaluated));
  }
});
test("purity checker rejects adversarial source fixtures without writing artifacts", () => {
  const cases = [
    ["dynamic.js", "export async function x(){ return import('../outside.js'); }"],
    ["static-traversal.js", "import x from './sub/../../outside.js';"],
    ["dynamic-traversal.js", "export async function x(){ return import('./sub/../../outside.js'); }"],
    ["static-parent.js", "export { x } from '../outside.js';"],
    ["template.js", "export async function x(){ return import(`../outside.js`); }"],
    ["backslash.js", "import x from '.\\\\sub\\\\..\\\\..\\\\outside.js';"],
    ["computed.js", "export const x = globalThis[\"chrome\"];"],
    ["global.js", "globalThis.value = 1; export const x = 1;"],
    ["console.js", "console.log('side effect'); export const x = 1;"],
    ["console-declaration.js", "const result = console.log('side effect'); export { result };"]
  ];
  for (const [name, source] of cases) assert.ok(inspectRuntimeContractSource(name, source).length, name);
  assert.deepEqual(inspectRuntimeContractSource("safe.js", "import { x } from './constants.js'; export function safe(){ return 'chrome in a string'; }"), []);
});
test("all production modules import without browser globals", async () => {
  for (const name of ["constants", "value-utils", "context", "revision", "envelope", "ledger", "assignments", "reducers", "dirty-registry", "mutation-engine", "index"]) await import("../../src/core/runtime-contract/" + name + ".js");
  assert.equal(typeof globalThis.chrome, "undefined"); assert.equal(contract.LOCK_ORDER[0], contract.LOCK_NAMES.exclusiveOperation);
});
