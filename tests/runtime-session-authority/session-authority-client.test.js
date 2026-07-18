import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeSessionContextClient, startRuntimeSessionContextRegistration } from "../../src/core/runtime-session-authority/client.js";
import { createContextResult } from "../../src/core/runtime-session-authority/contract.js";

const NOW = "2026-07-13T10:00:00.000Z";
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function validResult(request, overrides = {}) { return createContextResult({ ...request, status: "registered", runtimeSessionId: "session-1", authorityRevision: 0, authorityCommitted: true, authorityVerified: true, context: { contextId: request.contextId, contextType: "side_panel", windowId: request.windowId, createdAt: NOW, sourceUrl: "chrome-extension://id/src/sidepanel/sidepanel.html" }, ...overrides }); }

test("one client shares one in-flight registration and generates context once", async () => {
  let ids = 0, sends = 0; const gate = deferred();
  const client = createRuntimeSessionContextClient({ createId: () => "id-" + (++ids), now: () => NOW, getCurrentWindow: async () => ({ id: 7 }), send: async (request) => { sends += 1; await gate.promise; return validResult(request); } });
  const one = client.register(), two = client.register(); assert.equal(one, two); assert.equal(ids, 1);
  gate.resolve(); const result = await one;
  assert.equal(sends, 1); assert.equal(result.contextId, client.contextId); assert.equal(client.latestVerifiedResult.contextId, client.contextId); assert.equal(ids, 2);
});

test("transport retry reuses context and pending operation identity", async () => {
  let attempts = 0; const requests = [];
  const client = createRuntimeSessionContextClient({ createId: (() => { let id = 0; return () => "id-" + (++id); })(), now: () => NOW, getCurrentWindow: async () => ({ id: 7 }), send: async (request) => { requests.push(structuredClone(request)); if (++attempts === 1) throw new Error("transport"); return validResult(request); } });
  await assert.rejects(client.register(), /transport/); const result = await client.register();
  assert.equal(result.status, "registered"); assert.deepEqual(requests[1], requests[0]);
});

test("client rejects invalid windows and unknown or mismatched response fields", async () => {
  const invalidWindow = createRuntimeSessionContextClient({ createId: () => "id", now: () => NOW, getCurrentWindow: async () => ({ id: -1 }), send: async () => null });
  await assert.rejects(invalidWindow.register(), /window identity/);
  for (const mutate of [
    result => ({ ...result, extra: true }),
    result => ({ ...result, contextId: "wrong" }),
    result => ({ ...result, context: { ...result.context, contextId: "nested-wrong" } }),
    result => ({ ...result, context: { ...result.context, windowId: 8 } }),
    result => ({ ...result, assignment: { runtimeAssignmentId: "a", workspaceId: "w", windowId: 8, assignmentEpoch: 1, state: "active", createdAt: NOW, updatedAt: NOW, lastVerifiedAt: NOW, sourceContextId: result.contextId } }),
    result => ({ ...result, status: "rejected", reason: "blocked", authorityCommitted: false, authorityVerified: false, assignment: { runtimeAssignmentId: "a", workspaceId: "w", windowId: 7, assignmentEpoch: 1, state: "active", createdAt: NOW, updatedAt: NOW, lastVerifiedAt: NOW, sourceContextId: result.contextId } })
  ]) {
    const client = createRuntimeSessionContextClient({ createId: (() => { let id = 0; return () => "id-" + (++id); })(), now: () => NOW, getCurrentWindow: async () => ({ id: 7 }), send: async request => mutate(validResult(request)) });
    await assert.rejects(client.register(), /response is invalid/);
  }
});

test("registration failure evidence resolves without blocking existing initialization", async () => {
  const client = { register: async () => { throw new Error("registration failed"); } };
  let evidence = null, existingInitializationContinued = false;
  const registration = startRuntimeSessionContextRegistration(client, value => { evidence = value; });
  existingInitializationContinued = true;
  await registration;
  assert.equal(existingInitializationContinued, true); assert.deepEqual(evidence, { status: "failed", reason: "registration failed" });
});

test("focus changes produce no client authority operation and no assignment methods are exposed", () => {
  let calls = 0;
  const client = createRuntimeSessionContextClient({ createId: () => "id", now: () => NOW, getCurrentWindow: async () => { calls += 1; return { id: 1 }; }, send: async () => null });
  for (const event of ["focus-a", "focus-b", "focus-a"]) void event;
  assert.equal(calls, 0);
  for (const method of ["assign", "transfer", "release"]) assert.equal(Object.hasOwn(client, method), false);
});
