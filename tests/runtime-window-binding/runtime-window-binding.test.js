import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assignRuntime, transferRuntime } from "../../src/core/runtime-contract/assignments.js";
import {
  createContextResultFromRequest,
  createSessionAuthority,
  registerContext
} from "../../src/core/runtime-session-authority/contract.js";
import { isRuntimeWorkspaceActivationMessage } from "../../src/core/runtime-workspace-activation/service-worker-handler.js";
import {
  RUNTIME_WORKSPACE_SCHEMA,
  deriveRuntimeWorkspaceKey
} from "../../src/core/runtime-workspace-record/contract.js";
import { createRuntimeWindowBindingChromeAdapters } from "../../src/core/runtime-window-binding/chrome-adapter.js";
import { createRuntimeWindowBindingClient } from "../../src/core/runtime-window-binding/client.js";
import {
  WINDOW_BINDING_RESOLVE_COMMAND_SCHEMA,
  WINDOW_BINDING_RESOLVE_RESULT_SCHEMA,
  WINDOW_BINDING_RESOLVE_TYPE,
  createWindowBindingResolveResult,
  isRuntimeWindowBindingResolveMessage,
  snapshotAndValidateWindowBindingResolveCommand,
  validateWindowBindingResolveResult
} from "../../src/core/runtime-window-binding/contract.js";
import { coordinateRuntimeWindowBindingResolve } from "../../src/core/runtime-window-binding/coordinator.js";
import { handleRuntimeWindowBindingMessage } from "../../src/core/runtime-window-binding/service-worker-handler.js";
import {
  SIDE_PANEL_ASSIGNED_WORKSPACE_AUTHORITY_SCHEMA,
  createSidePanelAssignedWorkspaceAuthority
} from "../../src/core/runtime-window-binding/side-panel-authority.js";

const NOW = "2026-07-20T00:00:00.000Z";
const SIDE_PANEL_URL = "chrome-extension://extension-id/src/sidepanel/sidepanel.html";

test("resolve command has one exact schema and no fabricated workspace or assignment identities", () => {
  const command = commandFixture();
  assert.equal(snapshotAndValidateWindowBindingResolveCommand(command).valid, true);
  assert.deepEqual(Object.keys(command).sort(), ["operationId", "requestedAt", "runtimeSessionId", "schema", "sourceContextId", "sourceWindowId", "type"].sort());
  for (const forbidden of ["workspaceId", "workspaceRevision", "runtimeAssignmentId", "assignmentEpoch"]) {
    const value = { ...command, [forbidden]: forbidden.includes("Epoch") || forbidden.includes("Revision") ? 1 : "fabricated" };
    assert.equal(snapshotAndValidateWindowBindingResolveCommand(value).valid, false, forbidden);
  }
});

test("malformed resolve identities and hostile values fail closed", () => {
  const cases = [
    { ...commandFixture(), operationId: "" },
    { ...commandFixture(), runtimeSessionId: "" },
    { ...commandFixture(), sourceContextId: "" },
    { ...commandFixture(), sourceWindowId: -1 },
    { ...commandFixture(), requestedAt: "bad" },
    { ...commandFixture(), extra: true }
  ];
  for (const value of cases) assert.equal(snapshotAndValidateWindowBindingResolveCommand(value).valid, false);
  const cyclic = commandFixture();
  cyclic.self = cyclic;
  assert.doesNotThrow(() => snapshotAndValidateWindowBindingResolveCommand(cyclic));
  assert.equal(snapshotAndValidateWindowBindingResolveCommand(cyclic).valid, false);
});

test("stale current context blocks before scoped record access", async () => {
  const root = authorityFixture({ contextId: "context-current" });
  const fake = adaptersFixture({ authorities: [root] });
  const result = await coordinateRuntimeWindowBindingResolve(commandFixture({ sourceContextId: "context-old" }), fake.adapters);
  assert.equal(result.status, "stale_context");
  assert.equal(result.reason, "stale_context");
  assert.equal(fake.recordReads, 0);
  assert.equal(result.mutationCommitted, false);
});

test("panel context recreation replaces current context without invalidating assignment provenance", async () => {
  const root = authorityFixture({ contextId: "context-old", assignmentContextId: "context-old" });
  const replaced = registerContext(root, { contextId: "context-new", windowId: 10, createdAt: "2026-07-20T00:02:00.000Z", sourceUrl: SIDE_PANEL_URL }).root;
  const fake = adaptersFixture({ authorities: [replaced, replaced, replaced], records: [recordFixture(), recordFixture()] });
  const result = await coordinateRuntimeWindowBindingResolve(commandFixture({ sourceContextId: "context-new" }), fake.adapters);
  assert.equal(result.status, "assigned");
  assert.equal(result.sourceContextId, "context-new");
  assert.equal(replaced.assignmentRegistry.assignments.find((item) => item.state === "active").sourceContextId, "context-old");
});

test("unbound resolution reads no scoped or compatibility state and performs no writes", async () => {
  const root = authorityFixture({ assigned: false });
  const fake = adaptersFixture({ authorities: [root, root] });
  const result = await coordinateRuntimeWindowBindingResolve(commandFixture(), fake.adapters);
  assert.equal(result.status, "unbound");
  assert.equal(result.authorityVerified, true);
  assert.equal(result.workspace, null);
  assert.equal(fake.recordReads, 0);
  assert.deepEqual(fake.lockTrace, ["window:10"]);
  assert.equal(Object.keys(fake.adapters).some((name) => /write|compat/i.test(name)), false);
});

test("assignment resolves by the exact source window when multiple workspaces coexist", async () => {
  const root = authorityFixture({ secondAssignment: true });
  const fake = adaptersFixture({ authorities: [root, root, root], records: [recordFixture(), recordFixture()] });
  const result = await coordinateRuntimeWindowBindingResolve(commandFixture(), fake.adapters);
  assert.equal(result.status, "assigned");
  assert.equal(result.workspaceId, "workspace-alpha");
  assert.equal(result.sourceWindowId, 10);
  assert.deepEqual(fake.lockTrace, ["window:10", "binding:workspace-alpha"]);
});

test("assignment ID drift fails closed before scoped record access", async () => {
  const first = authorityFixture();
  const changed = structuredClone(first);
  changed.assignmentRegistry.assignments.find((item) => item.state === "active").runtimeAssignmentId = "assignment-replaced";
  changed.authorityRevision += 1;
  const fake = adaptersFixture({ authorities: [first, changed] });
  const result = await coordinateRuntimeWindowBindingResolve(commandFixture(), fake.adapters);
  assert.equal(result.status, "stale_assignment");
  assert.equal(result.reason, "window_assignment_changed");
  assert.equal(fake.recordReads, 0);
});

test("assignment epoch drift fails closed before scoped record access", async () => {
  const first = authorityFixture();
  const changed = structuredClone(first);
  changed.assignmentRegistry.assignments.find((item) => item.state === "active").assignmentEpoch += 1;
  changed.assignmentRegistry.nextEpoch += 1;
  changed.authorityRevision += 1;
  const fake = adaptersFixture({ authorities: [first, changed] });
  const result = await coordinateRuntimeWindowBindingResolve(commandFixture(), fake.adapters);
  assert.equal(result.status, "stale_assignment");
  assert.equal(fake.recordReads, 0);
});

test("workspace moved to another exact window returns active_elsewhere owner evidence", async () => {
  const first = authorityFixture({ secondContext: true });
  const current = first.assignmentRegistry.assignments.find((item) => item.state === "active" && item.workspaceId === "workspace-alpha");
  const transferred = transferRuntime(first.assignmentRegistry, {
    workspaceId: "workspace-alpha",
    windowId: 20,
    sourceContextId: "context-20",
    expectedRuntimeAssignmentId: current.runtimeAssignmentId,
    expectedAssignmentEpoch: current.assignmentEpoch,
    id: () => "assignment-alpha-window-20",
    now: "2026-07-20T00:03:00.000Z"
  });
  const second = { ...structuredClone(first), authorityRevision: first.authorityRevision + 1, assignmentRegistry: transferred.registry };
  const fake = adaptersFixture({ authorities: [first, second] });
  const result = await coordinateRuntimeWindowBindingResolve(commandFixture(), fake.adapters);
  assert.equal(result.status, "active_elsewhere");
  assert.equal(result.workspaceId, "workspace-alpha");
  assert.equal(result.ownerWindowId, 20);
  assert.equal(result.authorityVerified, true);
  assert.equal(result.workspaceVerified, false);
  assert.equal(fake.recordReads, 0);
});

test("absent malformed and cross-workspace scoped records are explicit malformed_runtime_record outcomes", async () => {
  const root = authorityFixture();
  for (const record of [undefined, { malformed: true }, recordFixture({ workspaceId: "workspace-beta" })]) {
    const fake = adaptersFixture({ authorities: [root, root], records: [record] });
    const result = await coordinateRuntimeWindowBindingResolve(commandFixture(), fake.adapters);
    assert.equal(result.status, "malformed_runtime_record");
    assert.equal(result.workspaceId, "workspace-alpha");
    assert.equal(result.workspaceVerified, false);
  }
});

test("assigned succeeds only after complete session context assignment record and revision verification", async () => {
  const root = authorityFixture();
  const record = recordFixture();
  const fake = adaptersFixture({ authorities: [root, root, root], records: [record, record] });
  const result = await coordinateRuntimeWindowBindingResolve(commandFixture(), fake.adapters);
  assert.equal(result.status, "assigned");
  assert.equal(result.schema, WINDOW_BINDING_RESOLVE_RESULT_SCHEMA);
  assert.equal(result.runtimeSessionId, "runtime-session-1");
  assert.equal(result.sourceContextId, "context-10");
  assert.equal(result.sourceWindowId, 10);
  assert.equal(result.workspaceId, "workspace-alpha");
  assert.equal(result.workspaceRevision, 7);
  assert.equal(result.runtimeAssignmentId, "assignment-alpha");
  assert.equal(result.assignmentEpoch, 1);
  assert.equal(result.authorityVerified, true);
  assert.equal(result.workspaceVerified, true);
  assert.equal(result.mutationCommitted, false);
  assert.deepEqual(result.workspace, record.workspace);
  assert.equal(validateWindowBindingResolveResult(result, commandFixture()).valid, true);
  assert.equal(fake.authorityReads, 3);
  assert.equal(fake.recordReads, 2);
});

test("record revision or content drift during final verification cannot report assigned", async () => {
  const root = authorityFixture();
  const first = recordFixture();
  const changed = recordFixture();
  changed.workspaceRevision = 8;
  changed.workspace.workspaceRevision = 8;
  const fake = adaptersFixture({ authorities: [root, root, root], records: [first, changed] });
  const result = await coordinateRuntimeWindowBindingResolve(commandFixture(), fake.adapters);
  assert.equal(result.status, "stale_assignment");
  assert.equal(result.reason, "runtime_record_changed_during_resolution");
  assert.equal(result.workspaceVerified, false);
});

test("adapter and lock failures return one total serializable failed result", async () => {
  const fake = adaptersFixture({ lockFailure: new Error("lock unavailable") });
  const result = await coordinateRuntimeWindowBindingResolve(commandFixture(), fake.adapters);
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "binding_resolution_failed");
  assert.equal(result.retrySafe, true);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.equal(validateWindowBindingResolveResult(result, commandFixture()).valid, true);
});

test("every resolve status uses one exact total result shape and zero mutation", () => {
  const command = commandFixture();
  const fixtures = [
    createWindowBindingResolveResult(command, assignedFields()),
    createWindowBindingResolveResult(command, { status: "unbound", phase: "complete", authorityRevision: 1, authorityVerified: true }),
    createWindowBindingResolveResult(command, { status: "stale_context", reason: "stale_context", phase: "verification" }),
    createWindowBindingResolveResult(command, assignmentFields({ status: "stale_assignment", reason: "stale", phase: "verification" })),
    createWindowBindingResolveResult(command, assignmentFields({ status: "active_elsewhere", reason: "elsewhere", phase: "verification", ownerWindowId: 20 })),
    createWindowBindingResolveResult(command, assignmentFields({ status: "malformed_runtime_record", reason: "malformed", phase: "record", authorityVerified: true })),
    createWindowBindingResolveResult(command, { status: "failed", reason: "failed", phase: "read", retrySafe: true })
  ];
  const keys = Object.keys(fixtures[0]).sort();
  for (const result of fixtures) {
    assert.deepEqual(Object.keys(result).sort(), keys);
    assert.equal(result.mutationCommitted, false);
    assert.doesNotThrow(() => JSON.stringify(result));
    assert.equal(validateWindowBindingResolveResult(result, command).valid, true, result.status);
  }
});

test("client registers current context first shares in-flight work and sends no fabricated identity", async () => {
  const contextRequest = contextRequestFixture();
  const contextResult = contextResultFixture(contextRequest);
  const release = deferred();
  const sent = [];
  let registrations = 0;
  const contextClient = {
    pendingRequest: contextRequest,
    async register() { registrations += 1; return contextResult; }
  };
  const client = createRuntimeWindowBindingClient({
    contextClient,
    createId: () => "resolve-operation",
    now: () => NOW,
    send: async (command) => { sent.push(structuredClone(command)); await release.promise; return createWindowBindingResolveResult(command, assignedFields()); }
  });
  const first = client.resolve();
  const shared = client.resolve();
  release.resolve();
  const [left, right] = await Promise.all([first, shared]);
  assert.deepEqual(left, right);
  assert.equal(registrations, 1);
  assert.equal(sent.length, 1);
  assert.deepEqual(Object.keys(sent[0]).sort(), Object.keys(commandFixture()).sort());
  for (const field of ["workspaceId", "workspaceRevision", "runtimeAssignmentId", "assignmentEpoch"]) assert.equal(Object.hasOwn(sent[0], field), false);
});

test("handler rejects unauthorized senders before adapter construction and terminally owns malformed new messages", async () => {
  let adapterCreations = 0;
  let response;
  const returned = handleRuntimeWindowBindingMessage(commandFixture(), { id: "other", url: SIDE_PANEL_URL }, (value) => { response = value; }, {
    chromeApi: {}, runtimeId: "extension-id", sidePanelUrl: SIDE_PANEL_URL, createAdapters: () => { adapterCreations += 1; }
  });
  assert.equal(returned, false);
  assert.equal(response.reason, "sender_not_authorized");
  assert.equal(adapterCreations, 0);
  const malformed = { type: WINDOW_BINDING_RESOLVE_TYPE, schema: WINDOW_BINDING_RESOLVE_COMMAND_SCHEMA };
  assert.equal(isRuntimeWindowBindingResolveMessage(malformed), true);
  assert.equal(isRuntimeWorkspaceActivationMessage(malformed), false);
});

test("authorized handler routes exactly once to read-only coordination", async () => {
  const root = authorityFixture();
  const fake = adaptersFixture({ authorities: [root, root, root], records: [recordFixture(), recordFixture()] });
  let adapterCreations = 0;
  const response = await new Promise((resolve) => {
    const returned = handleRuntimeWindowBindingMessage(commandFixture(), { id: "extension-id", url: SIDE_PANEL_URL }, resolve, {
      chromeApi: {}, runtimeId: "extension-id", sidePanelUrl: SIDE_PANEL_URL,
      createAdapters: () => { adapterCreations += 1; return fake.adapters; }
    });
    assert.equal(returned, true);
  });
  assert.equal(adapterCreations, 1);
  assert.equal(response.status, "assigned");
  assert.equal(fake.recordReads, 2);
});

test("Chrome adapter reads exact session and scoped keys and exposes no write method", async () => {
  const root = authorityFixture();
  const record = recordFixture();
  const keys = [];
  const lockNames = [];
  const chromeApi = {
    storage: {
      session: { async get(key) { keys.push("session:" + key); return { [key]: root }; } },
      local: { async get(key) { keys.push("local:" + key); return { [key]: record }; } }
    }
  };
  const adapters = createRuntimeWindowBindingChromeAdapters(chromeApi, { requestLock: async (name, callback) => { lockNames.push(name); return callback(); } });
  assert.deepEqual(await adapters.readAuthority(), root);
  assert.deepEqual(await adapters.readRuntimeWorkspaceRecord("workspace-alpha"), record);
  await adapters.withWindowLock(10, async () => adapters.withWorkspaceBindingLock("workspace-alpha", () => undefined));
  assert.deepEqual(keys, ["session:constellationRuntimeSessionAuthority", "local:" + deriveRuntimeWorkspaceKey("workspace-alpha")]);
  assert.deepEqual(lockNames, ["constellation-runtime-window:10", "constellation-runtime-workspace-binding:workspace-alpha"]);
  assert.equal(Object.keys(adapters).some((name) => /write|set|remove|compat/i.test(name)), false);
});

test("panel authority exposes one immutable assigned object and clears it for unbound state", async () => {
  const assigned = createWindowBindingResolveResult(commandFixture(), assignedFields());
  const unbound = createWindowBindingResolveResult(commandFixture({ operationId: "resolve-2" }), { status: "unbound", phase: "complete", authorityRevision: 2, authorityVerified: true });
  let calls = 0;
  const authority = createSidePanelAssignedWorkspaceAuthority({ bindingClient: { async resolve() { calls += 1; return calls === 1 ? assigned : unbound; } } });
  const first = await authority.resolve();
  assert.equal(first.status, "assigned");
  assert.equal(authority.assignedAuthority.schema, SIDE_PANEL_ASSIGNED_WORKSPACE_AUTHORITY_SCHEMA);
  assert.equal(Object.isFrozen(authority.assignedAuthority), true);
  assert.equal(Object.isFrozen(authority.assignedAuthority.workspace), true);
  assert.throws(() => { authority.assignedAuthority.workspace.workspaceId = "changed"; }, TypeError);
  const second = await authority.resolve();
  assert.equal(second.status, "unbound");
  assert.equal(authority.assignedAuthority, null);
});

test("panel authority and production integration contain no compatibility or workspace-store fallback", async () => {
  const authoritySource = await readFile(new URL("../../src/core/runtime-window-binding/side-panel-authority.js", import.meta.url), "utf8");
  assert.doesNotMatch(authoritySource, /constellation-storage-compatibility|workspace-store|readCompatible|writeCompatible/);
  const runtimeSource = await readFile(new URL("../../src/core/runtime-workspace-activation/side-panel-runtime.js", import.meta.url), "utf8");
  const bindingPath = runtimeSource.slice(runtimeSource.indexOf("async function executeBootstrap"), runtimeSource.indexOf("async function replaceActive"));
  assert.ok(bindingPath.indexOf("bindingAuthority.resolve") < bindingPath.indexOf("readCompatibleWorkspace"));
  const sidePanelSource = await readFile(new URL("../../src/sidepanel/sidepanel.js", import.meta.url), "utf8");
  const initialization = sidePanelSource.slice(sidePanelSource.indexOf("async function initializeSidePanel"), sidePanelSource.indexOf("async function requireRuntimeWorkspaceAuthority"));
  assert.ok(initialization.indexOf("bootstrapExisting") < initialization.indexOf("renderWorkspace"));
  const render = sidePanelSource.slice(sidePanelSource.indexOf("async function renderWorkspace"), sidePanelSource.indexOf("function populateJournalRoleSelect"));
  assert.doesNotMatch(render, /\breadActiveWorkspaceReadonly\s*\(|\breadCompatibleStorageValue\s*\(|\bgetWorkspace\s*\(/);
});

test("service worker gives the exact new schema one terminal route without redirecting old routes", async () => {
  const source = await readFile(new URL("../../src/background/service-worker.js", import.meta.url), "utf8");
  assert.equal((source.match(/isRuntimeWindowBindingResolveMessage\(message\)/g) || []).length, 1);
  assert.equal((source.match(/handleRuntimeWindowBindingMessage\(message/g) || []).length, 1);
  const newRoute = source.indexOf("if (isRuntimeWindowBindingResolveMessage(message))");
  const oldActivation = source.indexOf("if (isRuntimeWorkspaceActivationMessage(message))");
  const oldContext = source.indexOf("if (isContextRegisterMessage(message))");
  assert.ok(newRoute > 0 && newRoute < oldActivation && newRoute < oldContext);
  assert.equal(source.includes(WINDOW_BINDING_RESOLVE_COMMAND_SCHEMA), false, "schema identity remains owned by the imported contract");
});

function commandFixture(overrides = {}) {
  return {
    type: WINDOW_BINDING_RESOLVE_TYPE,
    schema: WINDOW_BINDING_RESOLVE_COMMAND_SCHEMA,
    operationId: overrides.operationId || "resolve-operation",
    runtimeSessionId: overrides.runtimeSessionId || "runtime-session-1",
    sourceContextId: overrides.sourceContextId || "context-10",
    sourceWindowId: overrides.sourceWindowId ?? 10,
    requestedAt: overrides.requestedAt || NOW
  };
}

function authorityFixture(options = {}) {
  let root = createSessionAuthority("runtime-session-1");
  root = registerContext(root, { contextId: options.contextId || "context-10", windowId: 10, createdAt: NOW, sourceUrl: SIDE_PANEL_URL }, { genesis: true }).root;
  if (options.secondContext) root = registerContext(root, { contextId: "context-20", windowId: 20, createdAt: NOW, sourceUrl: SIDE_PANEL_URL }).root;
  if (options.assigned !== false) {
    const assigned = assignRuntime(root.assignmentRegistry, { workspaceId: "workspace-alpha", windowId: 10, sourceContextId: options.assignmentContextId || options.contextId || "context-10", id: () => "assignment-alpha", now: NOW });
    root.assignmentRegistry = assigned.registry;
    root.authorityRevision += 1;
  }
  if (options.secondAssignment) {
    root = registerContext(root, { contextId: "context-20", windowId: 20, createdAt: NOW, sourceUrl: SIDE_PANEL_URL }).root;
    const assigned = assignRuntime(root.assignmentRegistry, { workspaceId: "workspace-beta", windowId: 20, sourceContextId: "context-20", id: () => "assignment-beta", now: NOW });
    root.assignmentRegistry = assigned.registry;
    root.authorityRevision += 1;
  }
  return root;
}

function recordFixture(overrides = {}) {
  const workspaceId = overrides.workspaceId || "workspace-alpha";
  return {
    schema: RUNTIME_WORKSPACE_SCHEMA,
    workspaceId,
    workspaceRevision: 7,
    workspace: { workspaceId, workspaceRevision: 7, tabs: [], name: "Alpha" },
    lifecycleState: "available",
    provenance: { kind: "explicit_create", operationId: "create-operation", compatibilitySource: "none" },
    lastVerifiedAt: NOW
  };
}

function adaptersFixture(options = {}) {
  const authorities = [...(options.authorities || [])];
  const records = [...(options.records || [])];
  const state = { authorityReads: 0, recordReads: 0, lockTrace: [] };
  state.adapters = {
    async readAuthority() { state.authorityReads += 1; return structuredClone(authorities.length > 1 ? authorities.shift() : authorities[0]); },
    async readRuntimeWorkspaceRecord() {
      state.recordReads += 1;
      const value = records.length > 1 ? records.shift() : records[0];
      return value === undefined ? undefined : structuredClone(value);
    },
    deriveRuntimeWorkspaceKey,
    async withWindowLock(windowId, callback) { state.lockTrace.push("window:" + windowId); if (options.lockFailure) throw options.lockFailure; return callback(); },
    async withWorkspaceBindingLock(workspaceId, callback) { state.lockTrace.push("binding:" + workspaceId); return callback(); }
  };
  return state;
}

function assignedFields() {
  return {
    status: "assigned",
    phase: "complete",
    workspaceId: "workspace-alpha",
    workspaceRevision: 7,
    runtimeAssignmentId: "assignment-alpha",
    assignmentEpoch: 1,
    authorityRevision: 1,
    workspace: recordFixture().workspace,
    lifecycleState: "available",
    authorityVerified: true,
    workspaceVerified: true
  };
}

function assignmentFields(fields) {
  return { workspaceId: "workspace-alpha", runtimeAssignmentId: "assignment-alpha", assignmentEpoch: 1, authorityRevision: 1, ...fields };
}

function contextRequestFixture() {
  return { type: "constellation-runtime-context-register", schema: "constellation-runtime-context-register-request-v0.1", operationId: "context-operation", contextId: "context-10", contextType: "side_panel", windowId: 10, requestedAt: NOW };
}

function contextResultFixture(request) {
  return createContextResultFromRequest(request, {
    status: "no_change",
    runtimeSessionId: "runtime-session-1",
    authorityRevision: 1,
    authorityCommitted: false,
    authorityVerified: true,
    context: { contextId: "context-10", contextType: "side_panel", windowId: 10, createdAt: NOW, sourceUrl: SIDE_PANEL_URL }
  });
}

function deferred() { let resolve; const promise = new Promise((accept) => { resolve = accept; }); return { promise, resolve }; }
