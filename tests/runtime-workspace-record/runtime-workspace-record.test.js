import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_WORKSPACE_KEY_PREFIX,
  RUNTIME_WORKSPACE_LIFECYCLE_STATES,
  RUNTIME_WORKSPACE_PROVENANCE_KINDS,
  RUNTIME_WORKSPACE_SCHEMA,
  createRuntimeWorkspaceRecord,
  createRuntimeWorkspaceResult,
  deriveRuntimeWorkspaceKey,
  runtimeWorkspaceFingerprint,
  snapshotAndValidateRuntimeWorkspaceRecord
} from "../../src/core/runtime-workspace-record/contract.js";
import { createRuntimeWorkspaceRecordChromeAdapters } from "../../src/core/runtime-workspace-record/chrome-adapter.js";

const NOW = "2026-07-20T00:00:00.000Z";

test("valid scoped runtime record has the exact key schema revision and authority-free shape", () => {
  const record = fixture();
  const key = deriveRuntimeWorkspaceKey(record.workspaceId);
  const result = snapshotAndValidateRuntimeWorkspaceRecord(record, { workspaceId: "workspace-alpha", key });
  assert.equal(key, RUNTIME_WORKSPACE_KEY_PREFIX + "workspace-alpha");
  assert.equal(record.schema, RUNTIME_WORKSPACE_SCHEMA);
  assert.equal(result.valid, true);
  assert.deepEqual(result.record, record);
  assert.deepEqual(RUNTIME_WORKSPACE_LIFECYCLE_STATES, ["available", "paused"]);
  assert.deepEqual(RUNTIME_WORKSPACE_PROVENANCE_KINDS, ["explicit_create", "explicit_resume", "explicit_restore", "compatibility_seed", "transfer", "replacement", "recovery"]);
  for (const forbidden of ["windowId", "runtimeAssignmentId", "assignmentEpoch", "sourceContextId", "runtimeSessionId"]) assert.equal(Object.hasOwn(record, forbidden), false);
});

test("empty whitespace control delimiter and overlong workspace identities cannot derive keys", () => {
  for (const workspaceId of ["", " ", " leading", "trailing ", "workspace:alpha", "workspace\u0000alpha", "x".repeat(513), null, 7]) {
    assert.throws(() => deriveRuntimeWorkspaceKey(workspaceId), /workspaceId is invalid/);
  }
  assert.equal(deriveRuntimeWorkspaceKey("workspace-Å.beta_1"), RUNTIME_WORKSPACE_KEY_PREFIX + "workspace-Å.beta_1");
});

test("invalid expected key fails closed without changing input", () => {
  const record = fixture();
  const before = structuredClone(record);
  const validation = snapshotAndValidateRuntimeWorkspaceRecord(record, { key: RUNTIME_WORKSPACE_KEY_PREFIX + "workspace-beta" });
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(";"), /scoped storage key/);
  assert.deepEqual(record, before);
});

test("unknown top-level and provenance fields are rejected", () => {
  const top = { ...fixture(), futureAuthority: true };
  const provenance = fixture();
  provenance.provenance.windowId = 12;
  assert.equal(snapshotAndValidateRuntimeWorkspaceRecord(top).valid, false);
  assert.equal(snapshotAndValidateRuntimeWorkspaceRecord(provenance).valid, false);
});

test("top-level nested and expected workspace identities must agree", () => {
  const top = fixture();
  top.workspaceId = "workspace-beta";
  const nested = fixture();
  nested.workspace.workspaceId = "workspace-beta";
  const expected = snapshotAndValidateRuntimeWorkspaceRecord(fixture(), { workspaceId: "workspace-beta" });
  assert.match(snapshotAndValidateRuntimeWorkspaceRecord(top).errors.join(";"), /identity/);
  assert.match(snapshotAndValidateRuntimeWorkspaceRecord(nested).errors.join(";"), /identity/);
  assert.match(expected.errors.join(";"), /expected workspaceId/);
});

test("normalized workspace revision must exactly match the top-level revision", () => {
  const mismatch = fixture();
  mismatch.workspace.workspaceRevision = 6;
  const malformed = fixture();
  malformed.workspace.workspaceRevision = -1;
  assert.match(snapshotAndValidateRuntimeWorkspaceRecord(mismatch).errors.join(";"), /does not match/);
  assert.match(snapshotAndValidateRuntimeWorkspaceRecord(malformed).errors.join(";"), /non-negative integer/);
});

test("invalid lifecycle provenance kind source and timestamp fail closed", () => {
  const cases = [
    (record) => { record.lifecycleState = "active"; },
    (record) => { record.provenance.kind = "focus"; },
    (record) => { record.provenance.operationId = ""; },
    (record) => { record.provenance.compatibilitySource = "dual_conflicting"; },
    (record) => { record.lastVerifiedAt = "not-a-date"; }
  ];
  for (const mutate of cases) {
    const record = fixture();
    mutate(record);
    assert.equal(snapshotAndValidateRuntimeWorkspaceRecord(record).valid, false);
  }
});

test("binding-like top-level fields are forbidden by the exact-field contract", () => {
  for (const field of ["windowId", "runtimeAssignmentId", "assignmentEpoch", "sourceContextId", "runtimeSessionId", "binding"]) {
    const record = fixture();
    record[field] = field === "windowId" ? 1 : "forbidden";
    assert.equal(snapshotAndValidateRuntimeWorkspaceRecord(record).valid, false, field);
  }
});

test("non-serializable cyclic and non-plain values are rejected without throwing", () => {
  const cyclic = fixture();
  cyclic.workspace.self = cyclic.workspace;
  const symbol = fixture();
  symbol.workspace.bad = Symbol("bad");
  const date = fixture();
  date.workspace.bad = new Date(NOW);
  for (const value of [cyclic, symbol, date]) {
    const validation = snapshotAndValidateRuntimeWorkspaceRecord(value);
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.length > 0);
  }
});

test("constructor validates and snapshots caller input", () => {
  const workspace = { workspaceId: "workspace-alpha", workspaceRevision: 7, tabs: [] };
  const record = createRuntimeWorkspaceRecord({ workspace, lifecycleState: "available", provenance: provenance(), lastVerifiedAt: NOW });
  workspace.tabs.push({ workspaceTabId: "late" });
  assert.deepEqual(record.workspace.tabs, []);
  assert.throws(() => createRuntimeWorkspaceRecord({ workspace: { ...workspace, workspaceId: "" }, lifecycleState: "available", provenance: provenance(), lastVerifiedAt: NOW }), /workspaceId/);
});

test("canonical fingerprint is deterministic across key order and changes with content", () => {
  const left = fixture();
  const right = {
    lastVerifiedAt: left.lastVerifiedAt,
    provenance: { compatibilitySource: "none", operationId: "operation-1", kind: "explicit_create" },
    lifecycleState: "available",
    workspace: { tabs: [], workspaceRevision: 7, workspaceId: "workspace-alpha" },
    workspaceRevision: 7,
    workspaceId: "workspace-alpha",
    schema: RUNTIME_WORKSPACE_SCHEMA
  };
  assert.equal(runtimeWorkspaceFingerprint(left), runtimeWorkspaceFingerprint(right));
  right.workspace.tabs.push({ workspaceTabId: "tab-1" });
  assert.notEqual(runtimeWorkspaceFingerprint(left), runtimeWorkspaceFingerprint(right));
  assert.throws(() => runtimeWorkspaceFingerprint({}), /exact v0.1|schema|workspaceId/);
});

test("result helper always returns one plain serializable shape", () => {
  const success = createRuntimeWorkspaceResult({ status: "found", workspaceId: "workspace-alpha", record: fixture(), recordFingerprint: runtimeWorkspaceFingerprint(fixture()), phase: "read", verified: true });
  const failure = createRuntimeWorkspaceResult({ status: "not-real", reason: 4, warnings: ["kept", 3], errors: ["error", null] });
  assert.deepEqual(Object.keys(success).sort(), Object.keys(failure).sort());
  assert.equal(success.status, "found");
  assert.equal(failure.status, "failed");
  assert.doesNotThrow(() => JSON.stringify(success));
  assert.doesNotThrow(() => JSON.stringify(failure));
});

test("Chrome adapter reads creates compares writes pauses and deletes one exact scoped key", async () => {
  const storage = fakeLocalStorage();
  const locks = [];
  const adapters = createRuntimeWorkspaceRecordChromeAdapters({ storage: { local: storage.api } }, {
    withWorkspaceLock: async (workspaceId, callback) => { locks.push(workspaceId); return callback(); }
  });
  const original = fixture();
  assert.equal((await adapters.readRecord("workspace-alpha")).status, "absent");
  const created = await adapters.createRecord(original);
  assert.equal(created.status, "created");
  assert.equal(created.verified, true);
  assert.deepEqual([...storage.values.keys()], [deriveRuntimeWorkspaceKey("workspace-alpha")]);
  assert.equal((await adapters.createRecord(original)).status, "conflict");

  const updated = fixture();
  updated.workspace.workspaceRevision = 8;
  updated.workspaceRevision = 8;
  updated.lastVerifiedAt = "2026-07-20T00:01:00.000Z";
  assert.equal((await adapters.compareWriteRecord("workspace-alpha", "wrong", updated)).status, "conflict");
  const committed = await adapters.compareWriteRecord("workspace-alpha", created.recordFingerprint, updated);
  assert.equal(committed.status, "committed");
  const paused = await adapters.pauseRecord("workspace-alpha", committed.recordFingerprint, "2026-07-20T00:02:00.000Z");
  assert.equal(paused.status, "paused");
  assert.equal(paused.record.lifecycleState, "paused");
  const deleted = await adapters.deleteRecord("workspace-alpha", paused.recordFingerprint);
  assert.equal(deleted.status, "deleted");
  assert.equal((await adapters.readRecord("workspace-alpha")).status, "absent");
  assert.deepEqual(locks, ["workspace-alpha", "workspace-alpha", "workspace-alpha", "workspace-alpha", "workspace-alpha", "workspace-alpha"]);
});

test("Chrome adapter totalizes malformed storage and write verification failure", async () => {
  const storage = fakeLocalStorage();
  storage.values.set(deriveRuntimeWorkspaceKey("workspace-alpha"), { malformed: true });
  const unlocked = createRuntimeWorkspaceRecordChromeAdapters({ storage: { local: storage.api } });
  assert.equal((await unlocked.createRecord(fixture())).reason, "workspace_lock_unavailable");
  const adapters = createRuntimeWorkspaceRecordChromeAdapters({ storage: { local: storage.api } }, { withWorkspaceLock: async (_workspaceId, callback) => callback() });
  const malformed = await adapters.readRecord("workspace-alpha");
  assert.equal(malformed.status, "rejected");
  assert.equal(malformed.reason, "malformed_runtime_record");
  storage.values.clear();
  storage.afterSet = () => storage.values.set(deriveRuntimeWorkspaceKey("workspace-alpha"), fixture({ workspaceId: "workspace-beta" }));
  const failed = await adapters.createRecord(fixture());
  assert.equal(failed.status, "failed");
  assert.equal(failed.committed, true);
  assert.equal(failed.verified, false);
});

function fixture(overrides = {}) {
  const workspaceId = overrides.workspaceId || "workspace-alpha";
  return {
    schema: RUNTIME_WORKSPACE_SCHEMA,
    workspaceId,
    workspaceRevision: 7,
    workspace: { workspaceId, workspaceRevision: 7, tabs: [] },
    lifecycleState: "available",
    provenance: provenance(),
    lastVerifiedAt: NOW
  };
}

function provenance() { return { kind: "explicit_create", operationId: "operation-1", compatibilitySource: "none" }; }

function fakeLocalStorage() {
  const values = new Map();
  const state = {
    values,
    afterSet: null,
    api: {
      async get(key) {
        if (key === null) return Object.fromEntries([...values.entries()].map(([name, value]) => [name, structuredClone(value)]));
        const keys = Array.isArray(key) ? key : [key];
        return Object.fromEntries(keys.filter((name) => values.has(name)).map((name) => [name, structuredClone(values.get(name))]));
      },
      async set(items) {
        for (const [name, value] of Object.entries(items)) values.set(name, structuredClone(value));
        state.afterSet?.();
      },
      async remove(key) { values.delete(key); }
    }
  };
  return state;
}
