import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { LOCK_NAMES, LOCK_ORDER } from "../../src/core/runtime-contract/constants.js";
import {
  COMPATIBILITY_PROJECTION_LOCK,
  SCOPED_LOCK_DOMAINS,
  deriveBrowserProjectionLock,
  deriveExclusiveOperationLock,
  deriveWindowLock,
  deriveWorkspaceBindingLock,
  deriveWorkspaceContentLock
} from "../../src/core/runtime-scoped-locks/contract.js";
import {
  buildScopedLockPlan,
  compareScopedLocks,
  validateScopedLockPlan
} from "../../src/core/runtime-scoped-locks/ordering.js";
import {
  runWithCompatibilityProjectionLock,
  runWithScopedLocks
} from "../../src/core/runtime-scoped-locks/chrome-adapter.js";

test("exact scoped and compatibility lock identities are stable", () => {
  assert.equal(deriveExclusiveOperationLock("workspace-alpha"), "constellation-runtime-exclusive-operation:workspace-alpha");
  assert.equal(deriveWindowLock(12), "constellation-runtime-window:12");
  assert.equal(deriveWorkspaceBindingLock("workspace-alpha"), "constellation-runtime-workspace-binding:workspace-alpha");
  assert.equal(deriveWorkspaceContentLock("workspace-alpha"), "constellation-runtime-workspace:workspace-alpha");
  assert.equal(deriveBrowserProjectionLock("workspace-alpha"), "constellation-runtime-projection:workspace-alpha");
  assert.equal(COMPATIBILITY_PROJECTION_LOCK, "constellation-runtime-compatibility-projection-v0.1");
  assert.deepEqual(Object.fromEntries(Object.entries(SCOPED_LOCK_DOMAINS).map(([domain, definition]) => [domain, definition.rank])), {
    scopedExclusive: 0,
    window: 1,
    workspaceBinding: 2,
    runtimeState: 3,
    workspaceContent: 4,
    browserProjection: 5
  });
});

test("invalid workspace and window identities fail before acquisition", async () => {
  for (const workspaceId of ["", " ", "workspace:alpha", null]) {
    assert.throws(() => deriveExclusiveOperationLock(workspaceId), /workspaceId is invalid/);
    assert.throws(() => deriveWorkspaceBindingLock(workspaceId), /workspaceId is invalid/);
    assert.throws(() => deriveWorkspaceContentLock(workspaceId), /workspaceId is invalid/);
    assert.throws(() => deriveBrowserProjectionLock(workspaceId), /workspaceId is invalid/);
  }
  for (const windowId of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"]) assert.throws(() => deriveWindowLock(windowId), /windowId is invalid/);
  let acquisitions = 0;
  await assert.rejects(() => runWithScopedLocks(["constellation-runtime-window:01"], () => undefined, { requestLock: async () => { acquisitions += 1; } }), (error) => error.reason === "scoped_lock_plan_invalid");
  assert.equal(acquisitions, 0);
});

test("numeric windows order numerically and workspace identities order by code units", () => {
  const plan = buildScopedLockPlan({
    windowIds: [20, 3, 11],
    workspaceBindingIds: ["workspace-ä", "workspace-Z", "workspace-a"],
    workspaceContentIds: ["workspace-β", "workspace-Alpha"]
  });
  assert.deepEqual(plan, [
    "constellation-runtime-window:3",
    "constellation-runtime-window:11",
    "constellation-runtime-window:20",
    "constellation-runtime-workspace-binding:workspace-Z",
    "constellation-runtime-workspace-binding:workspace-a",
    "constellation-runtime-workspace-binding:workspace-ä",
    "constellation-runtime-workspace:workspace-Alpha",
    "constellation-runtime-workspace:workspace-β"
  ]);
  assert.ok(compareScopedLocks(deriveWindowLock(9), deriveWindowLock(10)) < 0);
  assert.ok(compareScopedLocks(deriveWorkspaceBindingLock("Z"), deriveWorkspaceBindingLock("a")) < 0);
});

test("duplicate requests collapse deterministically across every domain", () => {
  const plan = buildScopedLockPlan({
    exclusiveWorkspaceIds: ["workspace-alpha", "workspace-alpha"],
    windowIds: [5, 5],
    workspaceBindingIds: ["workspace-alpha", "workspace-alpha"],
    includeRuntimeState: true,
    runtimeStateReason: "session_root_write",
    workspaceContentIds: ["workspace-alpha", "workspace-alpha"],
    browserProjectionIds: ["workspace-alpha", "workspace-alpha"]
  });
  assert.equal(plan.length, 6);
  assert.equal(new Set(plan).size, 6);
  assert.equal(validateScopedLockPlan(plan).valid, true);
});

test("runtime-state requires an exact root/shared-ledger reason and ordinary content omits it", () => {
  assert.throws(() => buildScopedLockPlan({ includeRuntimeState: true }), /runtimeStateReason/);
  assert.throws(() => buildScopedLockPlan({ includeRuntimeState: true, runtimeStateReason: "ordinary_content" }), /runtimeStateReason/);
  const ordinary = buildScopedLockPlan({ windowIds: [1], workspaceBindingIds: ["workspace-alpha"], workspaceContentIds: ["workspace-alpha"] });
  assert.equal(ordinary.includes(LOCK_NAMES.runtimeState), false);
  assert.equal(ordinary.includes(COMPATIBILITY_PROJECTION_LOCK), false);
});

test("inverted duplicate and compatibility-contaminated plans are rejected", () => {
  const windowLock = deriveWindowLock(1);
  const bindingLock = deriveWorkspaceBindingLock("workspace-alpha");
  assert.equal(validateScopedLockPlan([bindingLock, windowLock]).valid, false);
  assert.equal(validateScopedLockPlan([windowLock, windowLock]).valid, false);
  assert.equal(validateScopedLockPlan([windowLock, COMPATIBILITY_PROJECTION_LOCK]).valid, false);
  assert.equal(validateScopedLockPlan([deriveWorkspaceContentLock("workspace-alpha")], { heldLocks: [bindingLock] }).valid, true);
  assert.equal(validateScopedLockPlan([windowLock], { heldLocks: [bindingLock] }).valid, false);
});

test("nested Web Lock acquisition releases in exact reverse order", async () => {
  const plan = buildScopedLockPlan({
    exclusiveWorkspaceIds: ["workspace-alpha"],
    windowIds: [9],
    workspaceBindingIds: ["workspace-alpha"],
    includeRuntimeState: true,
    runtimeStateReason: "session_root_write",
    workspaceContentIds: ["workspace-alpha"],
    browserProjectionIds: ["workspace-alpha"]
  });
  const trace = [];
  const requestLock = async (name, callback) => {
    trace.push("acquire:" + name);
    const output = await callback();
    trace.push("release:" + name);
    return output;
  };
  const value = await runWithScopedLocks(plan, () => { trace.push("business"); return "done"; }, { requestLock });
  assert.equal(value, "done");
  assert.deepEqual(trace, [
    ...plan.map((name) => "acquire:" + name),
    "business",
    ...[...plan].reverse().map((name) => "release:" + name)
  ]);
});

test("zero or repeated lock callbacks fail closed before duplicate business execution", async () => {
  const plan = buildScopedLockPlan({ windowIds: [1] });
  let business = 0;
  await assert.rejects(() => runWithScopedLocks(plan, () => { business += 1; }, { requestLock: async () => undefined }), (error) => error.reason === "lock_callback_not_invoked");
  assert.equal(business, 0);
  await assert.rejects(() => runWithScopedLocks(plan, () => { business += 1; }, { requestLock: async (_name, callback) => { await callback(); return callback(); } }), (error) => error.reason === "lock_callback_reused");
  assert.equal(business, 1);
});

test("compatibility projection takes one exact advisory lock and no nested primary lock", async () => {
  const names = [];
  const result = await runWithCompatibilityProjectionLock(() => "projected", { requestLock: async (name, callback) => { names.push(name); return callback(); } });
  assert.equal(result, "projected");
  assert.deepEqual(names, [COMPATIBILITY_PROJECTION_LOCK]);
  await assert.rejects(() => runWithCompatibilityProjectionLock(() => undefined, { heldLocks: [deriveWindowLock(1)], requestLock: async () => undefined }), (error) => error.reason === "compatibility_lock_must_not_nest");
  await assert.rejects(() => runWithScopedLocks([deriveWindowLock(1)], () => undefined, { heldLocks: [COMPATIBILITY_PROJECTION_LOCK], requestLock: async () => undefined }), (error) => error.reason === "scoped_lock_plan_invalid");
});

test("Web Locks absence has one explicit fail-closed reason", async () => {
  await assert.rejects(() => runWithScopedLocks([deriveWindowLock(1)], () => "not-run", { requestLock: null }), (error) => error.reason === "web_locks_unavailable");
});

test("Alpha and Beta ordinary workspace callbacks can overlap without a global lock", async () => {
  const alphaEntered = deferred();
  const betaEntered = deferred();
  const release = deferred();
  const trace = [];
  const requestLock = async (name, callback) => {
    trace.push("acquire:" + name);
    const output = await callback();
    trace.push("release:" + name);
    return output;
  };
  const alphaPlan = buildScopedLockPlan({ workspaceContentIds: ["workspace-alpha"] });
  const betaPlan = buildScopedLockPlan({ workspaceContentIds: ["workspace-beta"] });
  const alpha = runWithScopedLocks(alphaPlan, async () => { alphaEntered.resolve(); await betaEntered.promise; await release.promise; return "alpha"; }, { requestLock });
  const beta = runWithScopedLocks(betaPlan, async () => { betaEntered.resolve(); await alphaEntered.promise; await release.promise; return "beta"; }, { requestLock });
  await Promise.all([alphaEntered.promise, betaEntered.promise]);
  release.resolve();
  assert.deepEqual(await Promise.all([alpha, beta]), ["alpha", "beta"]);
  assert.equal(trace.some((item) => item.includes(LOCK_NAMES.runtimeState)), false);
  assert.equal(trace.some((item) => item.includes(COMPATIBILITY_PROJECTION_LOCK)), false);
});

test("protected Layer 2.3C global lock identities and old-route nesting remain present", async () => {
  assert.deepEqual(LOCK_ORDER, ["constellation-runtime-exclusive-operation-v0.1", "constellation-runtime-state-v0.1"]);
  assert.equal(LOCK_NAMES.exclusiveOperation, "constellation-runtime-exclusive-operation-v0.1");
  assert.equal(LOCK_NAMES.runtimeState, "constellation-runtime-state-v0.1");
  const source = await readFile(new URL("../../src/core/runtime-session-authority/coordinator.js", import.meta.url), "utf8");
  const createPath = source.slice(source.indexOf("export async function coordinateAssignmentCreate"), source.indexOf("export async function coordinateAssignmentTransfer"));
  assert.ok(createPath.indexOf("withExclusiveOperationLock") < createPath.indexOf("withOptionalSessionMutationLocks"));
  assert.ok(createPath.indexOf("withOptionalSessionMutationLocks") < createPath.indexOf("withRuntimeStateLock"));
});

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}
