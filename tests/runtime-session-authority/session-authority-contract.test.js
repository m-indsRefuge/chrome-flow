import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assignRuntime, createAssignmentRegistry, validateAssignmentRegistry } from "../../src/core/runtime-contract/assignments.js";
import { CONTEXT_REGISTER_REQUEST_SCHEMA, CONTEXT_REGISTER_TYPE, RESERVED_SESSION_AUTHORITY_ROOT_FIELDS, createContextResult, createContextResultFromRequest, createSessionAuthority, registerContext, validateActiveContext, validateContextRegisterRequest, validateContextRegisterResult, validateSessionAuthority, validateSidePanelSender } from "../../src/core/runtime-session-authority/contract.js";

const NOW = "2026-07-13T10:00:00.000Z";
const LATER = "2026-07-13T10:01:00.000Z";
const copy = (value) => structuredClone(value);
const request = (overrides = {}) => ({ type: CONTEXT_REGISTER_TYPE, schema: CONTEXT_REGISTER_REQUEST_SCHEMA, operationId: "op-1", contextId: "context-1", contextType: "side_panel", windowId: 1, requestedAt: NOW, ...overrides });
const context = (overrides = {}) => ({ contextId: "context-1", contextType: "side_panel", windowId: 1, createdAt: NOW, sourceUrl: "chrome-extension://id/src/sidepanel/sidepanel.html", ...overrides });
const assignment = (overrides = {}) => ({ runtimeAssignmentId: "assignment-1", workspaceId: "workspace-1", windowId: 1, assignmentEpoch: 1, state: "active", createdAt: NOW, updatedAt: NOW, lastVerifiedAt: NOW, sourceContextId: "context-1", ...overrides });

test("genesis root is empty, revision zero, and contains no workspace authority", () => {
  const root = createSessionAuthority("session-1");
  assert.equal(validateSessionAuthority(root).valid, true);
  assert.equal(root.authorityRevision, 0);
  assert.deepEqual(root.assignmentRegistry, createAssignmentRegistry());
  assert.deepEqual(root.contexts, []);
  for (const forbidden of ["workspaceStates", "workspace", "journal", "projection", "activeWorkspaceId"]) assert.equal(Object.hasOwn(root, forbidden), false);
});

test("strict request and response contracts reject unknown or mismatched fields", () => {
  assert.equal(validateContextRegisterRequest(request()).valid, true);
  assert.equal(validateContextRegisterRequest(request({ extra: true })).valid, false);
  assert.equal(validateContextRegisterRequest(request({ windowId: -1 })).valid, false);
  const valid = createContextResult({ ...request(), status: "registered", runtimeSessionId: "session-1", authorityRevision: 0, authorityCommitted: true, authorityVerified: true, context: context() });
  assert.equal(validateContextRegisterResult(valid, request()).valid, true);
  assert.equal(validateContextRegisterResult({ ...valid, extra: true }, request()).valid, false);
  assert.equal(validateContextRegisterResult(valid, request({ operationId: "other" })).valid, false);
});

test("malformed requests cannot poison normalized context results", () => {
  const poisoned = request({ status: "registered", reason: "", runtimeSessionId: "injected-session", authorityRevision: 999, authorityCommitted: true, authorityVerified: true, context: context(), assignment: assignment(), retrySafe: true, warnings: ["injected-warning"], errors: ["injected-error"] });
  const validation = validateContextRegisterRequest(poisoned);
  assert.equal(validation.valid, false);
  const result = createContextResultFromRequest(poisoned, { status: "rejected", reason: "invalid_request", errors: validation.errors });
  assert.deepEqual({ status: result.status, operationId: result.operationId, contextId: result.contextId, windowId: result.windowId, runtimeSessionId: result.runtimeSessionId, authorityRevision: result.authorityRevision, committed: result.authorityCommitted, verified: result.authorityVerified, context: result.context, assignment: result.assignment, retrySafe: result.retrySafe, warnings: result.warnings }, { status: "rejected", operationId: "op-1", contextId: "context-1", windowId: 1, runtimeSessionId: "", authorityRevision: -1, committed: false, verified: false, context: null, assignment: null, retrySafe: false, warnings: [] });
  assert.deepEqual(result.errors, validation.errors);
  assert.equal(result.errors.includes("injected-error"), false);
  assert.equal(validateContextRegisterResult(result, poisoned).valid, true);
});

test("response validation binds nested identities and enforces the status matrix", () => {
  const valid = createContextResult({ ...request(), status: "registered", runtimeSessionId: "session-1", authorityRevision: 0, authorityCommitted: true, authorityVerified: true, context: context(), assignment: assignment() });
  assert.equal(validateContextRegisterResult(valid, request()).valid, true);
  for (const changed of [
    { context: context({ contextId: "other" }) },
    { context: context({ windowId: 2 }) },
    { assignment: assignment({ windowId: 2 }) },
    { authorityCommitted: false },
    { authorityVerified: false },
    { reason: "impossible" }
  ]) assert.equal(validateContextRegisterResult({ ...valid, ...changed }, request()).valid, false);
  const noChange = createContextResult({ ...request(), status: "no_change", runtimeSessionId: "session-1", authorityRevision: 1, authorityVerified: true, context: context() });
  assert.equal(validateContextRegisterResult(noChange, request()).valid, true);
  assert.equal(validateContextRegisterResult({ ...noChange, authorityCommitted: true }, request()).valid, false);
  const failedAfterWrite = createContextResult({ ...request(), status: "failed", reason: "authority_verification_failed", authorityCommitted: true, authorityVerified: false });
  assert.equal(validateContextRegisterResult(failedAfterWrite, request()).valid, true);
  assert.equal(validateContextRegisterResult({ ...failedAfterWrite, authorityVerified: true }, request()).valid, false);
  for (const status of ["context_conflict", "rejected", "failed"]) {
    const rejected = createContextResult({ ...request(), status, reason: "blocked", assignment: assignment(), authorityCommitted: status === "failed", authorityVerified: false });
    assert.equal(validateContextRegisterResult(rejected, request()).valid, false);
  }
});

test("sender validation requires exact extension identity and side-panel URL", () => {
  const sender = { id: "id", url: "chrome-extension://id/src/sidepanel/sidepanel.html" };
  assert.equal(validateSidePanelSender(sender, "id", sender.url).valid, true);
  assert.equal(validateSidePanelSender({ ...sender, id: "other" }, "id", sender.url).valid, false);
  assert.equal(validateSidePanelSender({ ...sender, url: sender.url + "?x" }, "id", sender.url).valid, false);
});

test("unauthorized sender rejection uses normalized request identities only", () => {
  const poisoned = request({ status: "registered", runtimeSessionId: "injected-session", authorityCommitted: true, warnings: ["injected"] });
  const result = createContextResultFromRequest(poisoned, { status: "rejected", reason: "sender_not_authorized" });
  assert.deepEqual({ status: result.status, reason: result.reason, operationId: result.operationId, contextId: result.contextId, windowId: result.windowId, runtimeSessionId: result.runtimeSessionId, committed: result.authorityCommitted, warnings: result.warnings }, { status: "rejected", reason: "sender_not_authorized", operationId: "op-1", contextId: "context-1", windowId: 1, runtimeSessionId: "", committed: false, warnings: [] });
  assert.equal(validateContextRegisterResult(result, poisoned).valid, true);
});

test("root rejects duplicate contexts and malformed active-only records", () => {
  for (const contexts of [
    [context(), context({ windowId: 2 })],
    [context(), context({ contextId: "context-2" })],
    [context({ windowId: -1 })],
    [{ ...context(), state: "active" }]
  ]) {
    const root = createSessionAuthority("session-1"); root.contexts = contexts;
    if (contexts[0]?.state === "active") assert.equal(validateSessionAuthority(root).valid, true, "unknown serializable context fields are allowed");
    else assert.equal(validateSessionAuthority(root).valid, false);
  }
});

test("assignment registry rejects duplicate identities, epochs, active targets, and invalid nextEpoch", () => {
  const cases = [
    [assignment(), assignment({ assignmentEpoch: 2, windowId: 2, workspaceId: "workspace-2" })],
    [assignment(), assignment({ runtimeAssignmentId: "assignment-2", windowId: 2, workspaceId: "workspace-2" })],
    [assignment(), assignment({ runtimeAssignmentId: "assignment-2", assignmentEpoch: 2, workspaceId: "workspace-2" })],
    [assignment(), assignment({ runtimeAssignmentId: "assignment-2", assignmentEpoch: 2, windowId: 2 })]
  ];
  for (const assignments of cases) assert.equal(validateAssignmentRegistry({ schema: "constellation-runtime-assignment-registry-v0.1", nextEpoch: 3, assignments }).valid, false);
  assert.equal(validateAssignmentRegistry({ schema: "constellation-runtime-assignment-registry-v0.1", nextEpoch: 1, assignments: [assignment()] }).valid, false);
  assert.equal(validateAssignmentRegistry({ schema: "constellation-runtime-assignment-registry-v0.1", nextEpoch: 2, assignments: [{ ...assignment(), state: "bad" }] }).valid, false);
});

test("validators reject unsupported values before cloning", () => {
  const values = [() => {}, Symbol("x"), 1n, undefined, Infinity, new Date()];
  for (const value of values) {
    const root = createSessionAuthority("session-1"); root.unknown = value;
    assert.equal(validateSessionAuthority(root).valid, false);
  }
  const cyclic = createSessionAuthority("session-1"); cyclic.self = cyclic;
  assert.equal(validateSessionAuthority(cyclic).valid, false);
});

test("every reserved out-of-scope root field fails while future metadata remains valid", () => {
  for (const field of RESERVED_SESSION_AUTHORITY_ROOT_FIELDS) {
    const root = createSessionAuthority("session-1"); root[field] = { forbidden: true };
    assert.equal(validateSessionAuthority(root).valid, false, field);
  }
  const future = createSessionAuthority("session-1"); future.futureMetadata = { version: 2 };
  assert.equal(validateSessionAuthority(future).valid, true);
  const transitioned = registerContext(future, context(), { genesis: true }).root;
  assert.deepEqual(transitioned.futureMetadata, { version: 2 });
});

test("context replacement is active-only and preserves assignment provenance", () => {
  const root = createSessionAuthority("session-1");
  const first = registerContext(root, context(), { genesis: true }).root;
  first.assignmentRegistry = assignRuntime(first.assignmentRegistry, { workspaceId: "workspace-1", windowId: 1, sourceContextId: "context-1", now: NOW, id: () => "assignment-1" }).registry;
  const beforeAssignment = copy(first.assignmentRegistry.assignments[0]);
  const replaced = registerContext(first, context({ contextId: "context-2", createdAt: LATER })).root;
  assert.deepEqual(replaced.contexts.map((item) => item.contextId), ["context-2"]);
  assert.deepEqual(replaced.assignmentRegistry.assignments[0], beforeAssignment);
  assert.equal(validateActiveContext(replaced, "context-1", 1).reason, "stale_context");
});

test("unknown fields survive root and assignment transitions", () => {
  const root = createSessionAuthority("session-1"); root.futureRoot = { keep: true }; root.assignmentRegistry.futureRegistry = 7;
  root.contexts.push(context({ contextId: "unrelated", windowId: 2, futureContext: { keep: true } }));
  const registered = registerContext(root, { ...context(), futureContext: "kept" }, { genesis: true }).root;
  registered.assignmentRegistry = assignRuntime(registered.assignmentRegistry, { workspaceId: "workspace-1", windowId: 1, sourceContextId: "context-1", now: NOW, id: () => "assignment-1" }).registry;
  registered.assignmentRegistry.assignments[0].futureAssignment = { keep: true };
  const replaced = registerContext(registered, context({ contextId: "context-2", createdAt: LATER })).root;
  assert.deepEqual(replaced.futureRoot, { keep: true });
  assert.equal(replaced.assignmentRegistry.futureRegistry, 7);
  assert.deepEqual(replaced.assignmentRegistry.assignments[0].futureAssignment, { keep: true });
  assert.deepEqual(replaced.contexts.find((item) => item.windowId === 2).futureContext, { keep: true });
});

test("service worker recognizes no public assignment activation message", async () => {
  const source = await readFile(new URL("../../src/background/service-worker.js", import.meta.url), "utf8");
  for (const identity of ["constellation-runtime-assignment-create", "constellation-runtime-assignment-transfer", "constellation-runtime-assignment-release"]) assert.equal(source.includes(identity), false);
  assert.equal(source.includes(CONTEXT_REGISTER_TYPE), false, "message identity remains owned by the imported contract rather than duplicated in the worker");
  const route = source.indexOf("if (isContextRegisterMessage(message))");
  const senderCheck = source.indexOf("validateSidePanelSender(sender", route);
  const coordination = source.indexOf("coordinateContextRegistration(message", route);
  assert.ok(route >= 0 && senderCheck > route && coordination > senderCheck, "sender authorization must precede storage coordination");
  assert.equal(source.includes("createContextResult({ ...message"), false);
  assert.equal(source.includes("createContextResultFromRequest(message"), true);
});
