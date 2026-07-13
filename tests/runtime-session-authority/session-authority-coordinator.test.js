import test from "node:test";
import assert from "node:assert/strict";
import { coordinateAssignmentCreate, coordinateAssignmentRelease, coordinateAssignmentTransfer, coordinateContextRegistration, coordinateWindowCloseCleanup, resolveAssignmentForWindow, resolveAssignmentForWorkspace } from "../../src/core/runtime-session-authority/coordinator.js";
import { CONTEXT_REGISTER_REQUEST_SCHEMA, CONTEXT_REGISTER_TYPE, createSessionAuthority, registerContext, validateContextRegisterResult } from "../../src/core/runtime-session-authority/contract.js";
import { assignRuntime } from "../../src/core/runtime-contract/assignments.js";
import { LOCK_NAMES } from "../../src/core/runtime-contract/constants.js";

const NOW = "2026-07-13T10:00:00.000Z", LATER = "2026-07-13T10:01:00.000Z";
const copy = (value) => value === undefined ? undefined : structuredClone(value);
const request = (overrides = {}) => ({ type: CONTEXT_REGISTER_TYPE, schema: CONTEXT_REGISTER_REQUEST_SCHEMA, operationId: "op-1", contextId: "context-1", contextType: "side_panel", windowId: 1, requestedAt: NOW, ...overrides });
const sender = { sourceUrl: "chrome-extension://id/src/sidepanel/sidepanel.html" };
function deferred() { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; }

function fake(options = {}) {
  let authority = copy(options.authority), id = 0, writes = 0, reads = 0, tamper = false, malformed = false;
  const events = [], windows = new Set(options.windows || [1, 2, 3]);
  const lockTails = new Map(), lockRequests = new Map(), lockEntries = new Map();
  function withLock(name, callback) {
    const requestCount = (lockRequests.get(name) || 0) + 1; lockRequests.set(name, requestCount); options.onLockRequested?.(name, requestCount);
    const predecessor = lockTails.get(name) || Promise.resolve();
    let release; const held = new Promise((yes) => { release = yes; }); const tail = predecessor.then(() => held); lockTails.set(name, tail);
    return predecessor.then(async () => {
      const entryCount = (lockEntries.get(name) || 0) + 1; lockEntries.set(name, entryCount); events.push("enter:" + name);
      try {
        if (options.failLockName === name) throw new Error("lock failed");
        await options.onLockEnter?.(name, entryCount);
        return await callback();
      } finally { events.push("exit:" + name); release(); if (lockTails.get(name) === tail) lockTails.delete(name); }
    });
  }
  const adapters = {
    async readAuthority() { reads += 1; if ((options.failReads || []).includes(reads)) throw new Error("read failed"); if (malformed) return { schema: "malformed" }; const value = copy(authority); if (tamper && value) value.verificationTamper = true; return value; },
    async writeAuthority(value) { writes += 1; if (options.writeFailure) throw new Error("write failed"); authority = copy(value); tamper = Boolean(options.tamperAfterWrite); malformed = Boolean(options.malformedAfterWrite); },
    async getWindow(windowId) { events.push("window:" + windowId); if (!windows.has(windowId)) throw new Error("window missing"); return { id: windowId }; },
    createId: () => (options.idPrefix || "generated") + "-" + (++id), now: () => options.now || NOW,
    withRuntimeStateLock: withLock,
    withExclusiveOperationLock: withLock,
    async recordDiagnostic(action) { events.push("diagnostic:" + action); if (options.diagnosticFailure) throw new Error("diagnostic failed"); }
  };
  return { adapters, events, get authority() { return copy(authority); }, get writes() { return writes; }, get reads() { return reads; } };
}

async function register(fixture, overrides = {}) { return coordinateContextRegistration(request(overrides), sender, fixture.adapters); }

test("absent root plus first registration performs one revision-zero write", async () => {
  const f = fake(); const result = await register(f);
  assert.equal(result.status, "registered"); assert.equal(result.authorityRevision, 0); assert.equal(result.authorityVerified, true); assert.equal(f.writes, 1);
  assert.equal(f.authority.contexts.length, 1); assert.equal(f.authority.assignmentRegistry.assignments.length, 0);
  assert.equal(f.authority.contexts[0].createdAt, NOW); assert.equal(f.authority.contexts[0].sourceUrl, sender.sourceUrl);
});

test("valid root survives simulated worker restart and absent root creates a new session", async () => {
  const first = fake(); await register(first); const saved = first.authority;
  const restarted = fake({ authority: saved }); const again = await register(restarted);
  assert.equal(again.status, "no_change"); assert.equal(restarted.authority.runtimeSessionId, saved.runtimeSessionId); assert.equal(restarted.writes, 0);
  const browserRestart = fake({ idPrefix: "new-session" }); await register(browserRestart); assert.notEqual(browserRestart.authority.runtimeSessionId, saved.runtimeSessionId);
});

test("malformed present root fails closed with zero writes", async () => {
  const f = fake({ authority: { schema: "bad" } }); const result = await register(f);
  assert.equal(result.reason, "malformed_authority"); assert.equal(f.writes, 0);
});

test("reserved present authority fails closed with zero writes", async () => {
  const root = createSessionAuthority("session-1"); root.workspaceStates = [];
  const f = fake({ authority: root }); const result = await register(f);
  assert.equal(result.reason, "malformed_authority"); assert.equal(f.writes, 0);
});

test("context registration verifies the window and rejects missing or negative windows", async () => {
  const missing = fake({ windows: [] }); assert.equal((await register(missing)).reason, "window_not_verified"); assert.equal(missing.writes, 0);
  const negative = fake(); assert.equal((await register(negative, { windowId: -1 })).reason, "invalid_request"); assert.equal(negative.events.some((item) => item.startsWith("window:")), false);
});

test("same context is no_change and context conflicts and replacement are deterministic", async () => {
  const f = fake(); await register(f); const writes = f.writes;
  const same = await register(f); assert.equal(same.status, "no_change"); assert.equal(f.writes, writes);
  const conflict = await register(f, { windowId: 2 }); assert.equal(conflict.status, "context_conflict"); assert.equal(f.writes, writes);
  const replaced = await register(f, { operationId: "op-2", contextId: "context-2" }); assert.equal(replaced.status, "replaced"); assert.deepEqual(f.authority.contexts.map((item) => item.contextId), ["context-2"]);
});

test("simultaneous_context_registrations_preserve_both_windows", async () => {
  const firstEntered = deferred(), releaseFirst = deferred(), secondRequested = deferred();
  const f = fake({
    onLockEnter: async (name, count) => { if (name === LOCK_NAMES.runtimeState && count === 1) { firstEntered.resolve(); await releaseFirst.promise; } },
    onLockRequested: (name, count) => { if (name === LOCK_NAMES.runtimeState && count === 2) secondRequested.resolve(); }
  });
  const first = register(f); await firstEntered.promise;
  const second = register(f, { operationId: "op-2", contextId: "context-2", windowId: 2 }); await secondRequested.promise;
  assert.equal(f.events.filter((item) => item === "enter:" + LOCK_NAMES.runtimeState).length, 1);
  releaseFirst.resolve(); const results = await Promise.all([first, second]);
  assert.deepEqual(results.map((item) => item.authorityRevision), [0, 1]);
  assert.deepEqual(f.authority.contexts.map((item) => [item.contextId, item.windowId]), [["context-1", 1], ["context-2", 2]]);
  assert.equal(f.writes, 2);
});

test("panel reopen preserves assignment and old context becomes stale", async () => {
  const f = fake(); await register(f);
  await coordinateAssignmentCreate({ operationId: "assign-1", workspaceId: "workspace-1", windowId: 1, sourceContextId: "context-1" }, f.adapters);
  const before = copy(f.authority.assignmentRegistry.assignments[0]);
  await register(f, { operationId: "op-2", contextId: "context-2" });
  assert.deepEqual(f.authority.assignmentRegistry.assignments[0], before);
  const stale = await coordinateAssignmentCreate({ operationId: "assign-2", workspaceId: "workspace-2", windowId: 1, sourceContextId: "context-1" }, f.adapters);
  assert.equal(stale.reason, "stale_context");
});

test("two independent assignments coexist and conflicting targets do not write", async () => {
  const f = fake(); await register(f); await register(f, { operationId: "op-2", contextId: "context-2", windowId: 2 });
  const a = await coordinateAssignmentCreate({ operationId: "assign-a", workspaceId: "workspace-a", windowId: 1, sourceContextId: "context-1" }, f.adapters);
  const b = await coordinateAssignmentCreate({ operationId: "assign-b", workspaceId: "workspace-b", windowId: 2, sourceContextId: "context-2" }, f.adapters);
  assert.equal(a.status, "assigned"); assert.equal(b.status, "assigned"); assert.equal(f.authority.assignmentRegistry.assignments.filter((item) => item.state === "active").length, 2);
  assert.equal((await resolveAssignmentForWindow(1, f.adapters)).assignment.workspaceId, "workspace-a");
  assert.equal((await resolveAssignmentForWorkspace("workspace-b", f.adapters)).assignment.windowId, 2);
  const writes = f.writes;
  assert.equal((await coordinateAssignmentCreate({ operationId: "x", workspaceId: "workspace-a", windowId: 2, sourceContextId: "context-2" }, f.adapters)).status, "workspace_conflict");
  assert.equal((await coordinateAssignmentCreate({ operationId: "y", workspaceId: "workspace-c", windowId: 1, sourceContextId: "context-1" }, f.adapters)).status, "assignment_conflict");
  assert.equal(f.writes, writes);
});

test("simultaneous_assignment_creates_preserve_both_assignments", async () => {
  const firstRuntimeEntered = deferred(), releaseFirst = deferred(), secondExclusiveRequested = deferred(); let barrierEnabled = false, paused = false;
  const f = fake({
    onLockEnter: async (name) => { if (barrierEnabled && !paused && name === LOCK_NAMES.runtimeState) { paused = true; firstRuntimeEntered.resolve(); await releaseFirst.promise; } },
    onLockRequested: (name, count) => { if (barrierEnabled && name === LOCK_NAMES.exclusiveOperation && count === 2) secondExclusiveRequested.resolve(); }
  });
  await register(f); await register(f, { operationId: "op-2", contextId: "context-2", windowId: 2 });
  const startingRevision = f.authority.authorityRevision, startingWrites = f.writes; barrierEnabled = true;
  const first = coordinateAssignmentCreate({ operationId: "assign-a", workspaceId: "workspace-a", windowId: 1, sourceContextId: "context-1" }, f.adapters); await firstRuntimeEntered.promise;
  const second = coordinateAssignmentCreate({ operationId: "assign-b", workspaceId: "workspace-b", windowId: 2, sourceContextId: "context-2" }, f.adapters); await secondExclusiveRequested.promise;
  releaseFirst.resolve(); const results = await Promise.all([first, second]);
  assert.deepEqual(results.map((item) => item.status), ["assigned", "assigned"]);
  const active = f.authority.assignmentRegistry.assignments.filter((item) => item.state === "active");
  assert.deepEqual(active.map((item) => item.assignmentEpoch), [1, 2]);
  assert.deepEqual(active.map((item) => item.workspaceId), ["workspace-a", "workspace-b"]);
  assert.equal(f.authority.assignmentRegistry.nextEpoch, 3);
  assert.equal(f.authority.authorityRevision, startingRevision + 2);
  assert.equal(f.writes, startingWrites + 2);
});

test("failed transfer and stale release preserve assignment and nextEpoch", async () => {
  const f = fake(); await register(f); await register(f, { operationId: "op-2", contextId: "context-2", windowId: 2 });
  await coordinateAssignmentCreate({ operationId: "a", workspaceId: "workspace-a", windowId: 1, sourceContextId: "context-1" }, f.adapters);
  await coordinateAssignmentCreate({ operationId: "b", workspaceId: "workspace-b", windowId: 2, sourceContextId: "context-2" }, f.adapters);
  const before = copy(f.authority.assignmentRegistry), current = before.assignments.find((item) => item.workspaceId === "workspace-a");
  const failed = await coordinateAssignmentTransfer({ operationId: "t", workspaceId: "workspace-a", windowId: 2, sourceContextId: "context-2", expectedRuntimeAssignmentId: current.runtimeAssignmentId, expectedAssignmentEpoch: current.assignmentEpoch }, f.adapters);
  assert.equal(failed.status, "assignment_conflict"); assert.deepEqual(f.authority.assignmentRegistry, before);
  const stale = await coordinateAssignmentRelease({ operationId: "r", runtimeAssignmentId: current.runtimeAssignmentId, assignmentEpoch: current.assignmentEpoch + 1 }, f.adapters);
  assert.equal(stale.status, "assignment_conflict"); assert.deepEqual(f.authority.assignmentRegistry, before);
});

test("window close releases and removes only exact window authority", async () => {
  const f = fake(); await register(f); await register(f, { operationId: "op-2", contextId: "context-2", windowId: 2 });
  await coordinateAssignmentCreate({ operationId: "a", workspaceId: "workspace-a", windowId: 1, sourceContextId: "context-1" }, f.adapters);
  await coordinateAssignmentCreate({ operationId: "b", workspaceId: "workspace-b", windowId: 2, sourceContextId: "context-2" }, f.adapters);
  const beforeB = copy({ context: f.authority.contexts.find((item) => item.windowId === 2), assignment: f.authority.assignmentRegistry.assignments.find((item) => item.workspaceId === "workspace-b") });
  const result = await coordinateWindowCloseCleanup(1, f.adapters);
  assert.equal(result.status, "released"); assert.equal(f.authority.contexts.some((item) => item.windowId === 1), false);
  assert.equal(f.authority.assignmentRegistry.assignments.find((item) => item.workspaceId === "workspace-a").state, "released");
  assert.deepEqual({ context: f.authority.contexts.find((item) => item.windowId === 2), assignment: f.authority.assignmentRegistry.assignments.find((item) => item.workspaceId === "workspace-b") }, beforeB);
});

test("context-only window cleanup reports context_removed and commits once", async () => {
  const f = fake(); await register(f); const writes = f.writes, revision = f.authority.authorityRevision;
  const result = await coordinateWindowCloseCleanup(1, f.adapters);
  assert.equal(result.status, "context_removed"); assert.equal(result.authorityCommitted, true); assert.equal(result.authorityVerified, true);
  assert.equal(f.authority.authorityRevision, revision + 1); assert.equal(f.writes, writes + 1); assert.deepEqual(f.authority.contexts, []);
});

test("absent and unrelated window cleanup write nothing", async () => {
  const absent = fake(); assert.equal((await coordinateWindowCloseCleanup(1, absent.adapters)).reason, "authority_absent"); assert.equal(absent.writes, 0);
  const existing = fake(); await register(existing); const writes = existing.writes; assert.equal((await coordinateWindowCloseCleanup(2, existing.adapters)).reason, "window_authority_absent"); assert.equal(existing.writes, writes);
});

test("write and verification failures report their exact phase without rollback", async () => {
  const write = await register(fake({ writeFailure: true }));
  assert.deepEqual({ status: write.status, reason: write.reason, committed: write.authorityCommitted, verified: write.authorityVerified, retrySafe: write.retrySafe }, { status: "failed", reason: "authority_write_failed", committed: false, verified: false, retrySafe: true });
  const read = await register(fake({ failReads: [2] }));
  assert.deepEqual({ status: read.status, reason: read.reason, committed: read.authorityCommitted, verified: read.authorityVerified, retrySafe: read.retrySafe }, { status: "failed", reason: "authority_verification_read_failed", committed: true, verified: false, retrySafe: false });
  const malformed = await register(fake({ malformedAfterWrite: true }));
  assert.deepEqual({ status: malformed.status, reason: malformed.reason, committed: malformed.authorityCommitted, verified: malformed.authorityVerified, retrySafe: malformed.retrySafe }, { status: "failed", reason: "authority_verification_failed", committed: true, verified: false, retrySafe: false });
  const f = fake({ tamperAfterWrite: true }); const result = await register(f);
  assert.equal(result.status, "failed"); assert.equal(result.reason, "authority_verification_failed"); assert.equal(result.authorityCommitted, true); assert.equal(result.authorityVerified, false); assert.equal(result.retrySafe, false);
});

test("no_change verification read failure is retry-safe and writes nothing", async () => {
  const f = fake({ failReads: [4] }); await register(f); const writes = f.writes;
  const result = await register(f);
  assert.deepEqual({ status: result.status, reason: result.reason, committed: result.authorityCommitted, verified: result.authorityVerified, retrySafe: result.retrySafe }, { status: "failed", reason: "authority_verification_read_failed", committed: false, verified: false, retrySafe: true });
  assert.equal(f.writes, writes);
});

test("unexpected context coordination failure retains the exact response contract", async () => {
  const f = fake({ failLockName: LOCK_NAMES.runtimeState }); const expected = request();
  const result = await coordinateContextRegistration(expected, sender, f.adapters);
  assert.equal(result.reason, "coordination_failure"); assert.equal(validateContextRegisterResult(result, expected).valid, true);
});

test("assignment create acquires exclusive before runtime-state and diagnostics follow locks", async () => {
  const f = fake(); await register(f); f.events.length = 0;
  await coordinateAssignmentCreate({ operationId: "a", workspaceId: "workspace-a", windowId: 1, sourceContextId: "context-1" }, f.adapters);
  assert.deepEqual(f.events.slice(0, 2), ["enter:" + LOCK_NAMES.exclusiveOperation, "enter:" + LOCK_NAMES.runtimeState]);
  assert.ok(f.events.indexOf("exit:" + LOCK_NAMES.exclusiveOperation) < f.events.findIndex((item) => item.startsWith("diagnostic:")));
});

test("diagnostic failure cannot change a verified authority result", async () => {
  const f = fake({ diagnosticFailure: true }); const result = await register(f);
  assert.equal(result.status, "registered"); assert.equal(result.authorityVerified, true); assert.deepEqual(result.warnings, ["diagnostic_failed"]);
});
