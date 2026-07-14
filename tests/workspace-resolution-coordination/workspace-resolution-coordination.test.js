import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COLLECTION_STATUSES,
  EVIDENCE_SOURCES,
  WORKSPACE_RESOLUTION_COORDINATION_REQUEST_SCHEMA
} from "../../src/core/workspace-resolution-coordination/contract.js";
import { coordinateWorkspaceResolution } from "../../src/core/workspace-resolution-coordination/coordinator.js";
import {
  checkWorkspaceResolutionCoordinationPurity,
  validWorkspaceResolutionCoordinationSpecifier
} from "../../scripts/check-runtime-contract-purity.mjs";

const request = Object.freeze({ schema: WORKSPACE_RESOLUTION_COORDINATION_REQUEST_SCHEMA, operationId: "operation-1", contextId: "context-1", windowId: 7 });
const assignment = Object.freeze({ workspaceId: "workspace-a", windowId: 7, assignmentEpoch: 3, runtimeAssignmentId: "assignment-a", authorityRevision: 2, runtimeSessionId: "session-a", authorityVerified: true, contextId: "context-1" });
const binding = Object.freeze({ workspaceId: "workspace-b", windowId: 7, contextId: "context-1", verified: true });
const present = (source, ...evidence) => ({ source, status: COLLECTION_STATUSES.present, evidence, error: "" });
const absent = (source) => ({ source, status: COLLECTION_STATUSES.absent, evidence: [], error: "" });
const failed = (source) => ({ source, status: COLLECTION_STATUSES.failed, evidence: [], error: "unavailable" });
const adapters = (overrides = {}) => ({
  readRuntimeAssignmentEvidence: async () => absent(EVIDENCE_SOURCES.runtimeAssignment),
  readExactWindowBindingEvidence: async () => absent(EVIDENCE_SOURCES.exactWindowBinding),
  readCompatibilityWorkspaceEvidence: async () => absent(EVIDENCE_SOURCES.compatibilityWorkspace),
  ...overrides
});

test("verified runtime assignment resolves", async () => {
  const result = await coordinateWorkspaceResolution(request, adapters({ readRuntimeAssignmentEvidence: async () => present(EVIDENCE_SOURCES.runtimeAssignment, assignment) }));
  assert.equal(result.status, "resolved"); assert.equal(result.decision, "use_resolved_workspace"); assert.equal(result.resolvedWorkspaceId, "workspace-a"); assert.equal(result.expectedAssignmentEpoch, 3);
  assert.equal(result.resolution.decisiveEvidence[0].runtimeAssignmentId, "assignment-a");
});

test("exact binding resolves when no assignment exists", async () => {
  const result = await coordinateWorkspaceResolution(request, adapters({ readExactWindowBindingEvidence: async () => present(EVIDENCE_SOURCES.exactWindowBinding, binding) }));
  assert.equal(result.resolvedWorkspaceId, "workspace-b"); assert.equal(result.expectedAssignmentEpoch, null);
});

test("assignment outranks exact binding", async () => {
  const result = await coordinateWorkspaceResolution(request, adapters({ readRuntimeAssignmentEvidence: async () => present(EVIDENCE_SOURCES.runtimeAssignment, assignment), readExactWindowBindingEvidence: async () => present(EVIDENCE_SOURCES.exactWindowBinding, binding) }));
  assert.equal(result.resolvedWorkspaceId, "workspace-a");
});

for (const [name, compatibility] of [["compatibility-only evidence", true], ["no evidence", false]]) test(name + " produces creation decision", async () => {
  const result = await coordinateWorkspaceResolution(request, adapters(compatibility ? { readCompatibilityWorkspaceEvidence: async () => present(EVIDENCE_SOURCES.compatibilityWorkspace, { workspaceId: "legacy" }) } : {}));
  assert.equal(result.status, "creation_required"); assert.equal(result.decision, "create_workspace_and_assign"); assert.equal(result.resolvedWorkspaceId, null);
});

test("contradictory assignment workspaces require manual resolution", async () => {
  const other = { ...assignment, workspaceId: "workspace-z", runtimeAssignmentId: "assignment-z" };
  const result = await coordinateWorkspaceResolution(request, adapters({ readRuntimeAssignmentEvidence: async () => present(EVIDENCE_SOURCES.runtimeAssignment, assignment, other) }));
  assert.equal(result.decision, "manual_resolution_required"); assert.equal(result.resolution.reason, "highest_authority_conflict");
});

test("contradictory assignment identities require manual resolution", async () => {
  const other = { ...assignment, runtimeAssignmentId: "assignment-z" };
  const result = await coordinateWorkspaceResolution(request, adapters({ readRuntimeAssignmentEvidence: async () => present(EVIDENCE_SOURCES.runtimeAssignment, assignment, other) }));
  assert.equal(result.decision, "manual_resolution_required"); assert.equal(result.resolution.reason, "contradictory_runtime_assignment_identity");
});

test("malformed request rejects before adapters run", async () => {
  let calls = 0; const counting = async () => { calls += 1; return absent(EVIDENCE_SOURCES.runtimeAssignment); };
  const result = await coordinateWorkspaceResolution({ ...request, workspaceId: "poison" }, adapters({ readRuntimeAssignmentEvidence: counting }));
  assert.equal(result.decision, "reject_request"); assert.equal(calls, 0); assertComplete(result);
});

test("throwing request getter rejects safely before adapters run", async () => {
  let calls = 0;
  const malformed = { schema: WORKSPACE_RESOLUTION_COORDINATION_REQUEST_SCHEMA, contextId: "context-1", windowId: 7 };
  Object.defineProperty(malformed, "operationId", { enumerable: true, get() { throw new Error("request getter escaped"); } });
  const countingAdapters = adapters({ readRuntimeAssignmentEvidence: async () => { calls += 1; return absent(EVIDENCE_SOURCES.runtimeAssignment); } });
  const result = await coordinateWorkspaceResolution(malformed, countingAdapters);
  assert.equal(result.status, "invalid"); assert.equal(result.decision, "reject_request"); assert.equal(calls, 0); assert.deepEqual(result.errors, ["request_validation_failed"]); assertComplete(result);
});

test("request proxy trap rejects safely before adapters run", async () => {
  let calls = 0;
  const malformed = new Proxy({}, { getPrototypeOf() { throw new Error("request proxy escaped"); } });
  const countingAdapters = adapters({ readRuntimeAssignmentEvidence: async () => { calls += 1; return absent(EVIDENCE_SOURCES.runtimeAssignment); } });
  const result = await coordinateWorkspaceResolution(malformed, countingAdapters);
  assert.equal(result.status, "invalid"); assert.equal(result.decision, "reject_request"); assert.equal(calls, 0); assert.deepEqual(result.errors, ["request_validation_failed"]); assertComplete(result);
});

test("throwing adapter property getter retries collection", async () => {
  const malformed = {
    readExactWindowBindingEvidence: async () => absent(EVIDENCE_SOURCES.exactWindowBinding),
    readCompatibilityWorkspaceEvidence: async () => absent(EVIDENCE_SOURCES.compatibilityWorkspace)
  };
  Object.defineProperty(malformed, "readRuntimeAssignmentEvidence", { enumerable: true, get() { throw new Error("adapter getter escaped"); } });
  const result = await coordinateWorkspaceResolution(request, malformed);
  assert.equal(result.status, "failed"); assert.equal(result.decision, "retry_collection"); assert.equal(result.retrySafe, true); assert.deepEqual(result.errors, ["collector_adapter_access_failed"]);
  assert.ok(result.collection.every((item) => item.status === "failed" && item.error === "collector_adapter_access_failed")); assertComplete(result);
});

test("thrown collector retries and does not fall through", async () => {
  let lowerCalls = 0;
  const result = await coordinateWorkspaceResolution(request, adapters({ readRuntimeAssignmentEvidence: async () => { throw new Error("no"); }, readCompatibilityWorkspaceEvidence: async () => { lowerCalls += 1; return present(EVIDENCE_SOURCES.compatibilityWorkspace, { workspaceId: "legacy" }); } }));
  assert.equal(result.decision, "retry_collection"); assert.equal(result.retrySafe, true); assert.equal(lowerCalls, 1); assert.equal(result.resolution, null);
});

test("explicit collector failure retries", async () => {
  const result = await coordinateWorkspaceResolution(request, adapters({ readExactWindowBindingEvidence: async () => failed(EVIDENCE_SOURCES.exactWindowBinding) }));
  assert.equal(result.decision, "retry_collection");
});

test("malformed collector output retries", async () => {
  const result = await coordinateWorkspaceResolution(request, adapters({ readCompatibilityWorkspaceEvidence: async () => ({ status: "absent" }) }));
  assert.equal(result.decision, "retry_collection"); assert.match(result.errors[0], /malformed/);
});

test("throwing evidence getter returns a complete retry result", async () => {
  const value = { source: EVIDENCE_SOURCES.runtimeAssignment, status: COLLECTION_STATUSES.present, error: "" };
  Object.defineProperty(value, "evidence", { enumerable: true, get() { throw new Error("accessor escaped"); } });
  const result = await coordinateWorkspaceResolution(request, adapters({ readRuntimeAssignmentEvidence: async () => value }));
  assert.equal(result.decision, "retry_collection"); assert.equal(result.retrySafe, true); assert.equal(result.resolution, null); assertComplete(result);
});

test("proxy output-processing exceptions cannot escape", async () => {
  const value = new Proxy({}, { ownKeys() { throw new Error("proxy escaped"); } });
  const result = await coordinateWorkspaceResolution(request, adapters({ readExactWindowBindingEvidence: async () => value }));
  assert.equal(result.decision, "retry_collection"); assert.deepEqual(result.errors, ["malformed_collection_result"]); assertComplete(result);
});

for (const [name, change] of [
  ["stale context assignment", { contextId: "stale" }],
  ["wrong-window assignment", { windowId: 8 }],
  ["unverified assignment", { authorityVerified: false }],
  ["malformed epoch", { assignmentEpoch: 0 }],
  ["malformed authority revision", { authorityRevision: -1 }]
]) test(name + " fails closed", async () => {
  const result = await coordinateWorkspaceResolution(request, adapters({ readRuntimeAssignmentEvidence: async () => present(EVIDENCE_SOURCES.runtimeAssignment, { ...assignment, ...change }) }));
  assert.equal(result.decision, "retry_collection"); assert.equal(result.resolution, null);
});

test("malformed exact binding fails closed", async () => {
  const result = await coordinateWorkspaceResolution(request, adapters({ readExactWindowBindingEvidence: async () => present(EVIDENCE_SOURCES.exactWindowBinding, { ...binding, assignmentEpoch: 3 }) }));
  assert.equal(result.decision, "retry_collection");
});

for (const [name, change, error] of [
  ["runtime session", { runtimeSessionId: "session-b" }, "runtime_assignment_sessions_conflict"],
  ["authority revision", { authorityRevision: 4 }, "runtime_assignment_revisions_conflict"]
]) test("conflicting " + name + " values retry collection", async () => {
  const result = await coordinateWorkspaceResolution(request, adapters({ readRuntimeAssignmentEvidence: async () => present(EVIDENCE_SOURCES.runtimeAssignment, assignment, { ...assignment, ...change, runtimeAssignmentId: "assignment-b" }) }));
  assert.equal(result.decision, "retry_collection"); assert.equal(result.retrySafe, true); assert.equal(result.resolution, null); assert.deepEqual(result.errors, [error]); assertComplete(result);
});

test("same-snapshot contradictory claims still reach manual resolution", async () => {
  const workspaceConflict = await coordinateWorkspaceResolution(request, adapters({ readRuntimeAssignmentEvidence: async () => present(EVIDENCE_SOURCES.runtimeAssignment, assignment, { ...assignment, workspaceId: "workspace-z", runtimeAssignmentId: "assignment-z" }) }));
  const identityConflict = await coordinateWorkspaceResolution(request, adapters({ readRuntimeAssignmentEvidence: async () => present(EVIDENCE_SOURCES.runtimeAssignment, assignment, { ...assignment, runtimeAssignmentId: "assignment-z" }) }));
  assert.equal(workspaceConflict.decision, "manual_resolution_required"); assert.equal(identityConflict.decision, "manual_resolution_required");
});

test("invalid adapters report failed collection rather than absence", async () => {
  const result = await coordinateWorkspaceResolution(request, null);
  assert.equal(result.decision, "retry_collection"); assert.ok(result.collection.every((item) => item.status === "failed" && item.error === "collector_adapters_invalid")); assertComplete(result);
});

test("compatibility evidence remains non-authoritative", async () => {
  const result = await coordinateWorkspaceResolution(request, adapters({ readCompatibilityWorkspaceEvidence: async () => present(EVIDENCE_SOURCES.compatibilityWorkspace, { workspaceId: "legacy" }) }));
  assert.equal(result.resolution.acceptedEvidence[0].authorityLevel, 0); assert.equal(result.resolution.acceptedEvidence[0].eligible, false);
});

test("adapter completion order does not affect result", async () => {
  const delayed = (value, delay) => async () => new Promise((resolve) => setTimeout(() => resolve(value), delay));
  const first = await coordinateWorkspaceResolution(request, adapters({ readRuntimeAssignmentEvidence: delayed(present(EVIDENCE_SOURCES.runtimeAssignment, assignment), 8), readExactWindowBindingEvidence: delayed(present(EVIDENCE_SOURCES.exactWindowBinding, binding), 1) }));
  const second = await coordinateWorkspaceResolution(request, adapters({ readRuntimeAssignmentEvidence: delayed(present(EVIDENCE_SOURCES.runtimeAssignment, assignment), 1), readExactWindowBindingEvidence: delayed(present(EVIDENCE_SOURCES.exactWindowBinding, binding), 8) }));
  assert.deepEqual(first, second); assert.deepEqual(first.collection.map((item) => item.source), Object.values(EVIDENCE_SOURCES));
});

test("inputs and adapter values remain unmodified", async () => {
  const mutableRequest = structuredClone(request), value = present(EVIDENCE_SOURCES.runtimeAssignment, structuredClone(assignment));
  const beforeRequest = structuredClone(mutableRequest), beforeValue = structuredClone(value);
  await coordinateWorkspaceResolution(mutableRequest, adapters({ readRuntimeAssignmentEvidence: async () => value }));
  assert.deepEqual(mutableRequest, beforeRequest); assert.deepEqual(value, beforeValue);
});

test("every outcome has one complete serializable shape", async () => {
  const results = await Promise.all([
    coordinateWorkspaceResolution(request, adapters({ readRuntimeAssignmentEvidence: async () => present(EVIDENCE_SOURCES.runtimeAssignment, assignment) })),
    coordinateWorkspaceResolution(request, adapters()),
    coordinateWorkspaceResolution({ ...request, extra: true }, adapters()),
    coordinateWorkspaceResolution(request, adapters({ readRuntimeAssignmentEvidence: async () => failed(EVIDENCE_SOURCES.runtimeAssignment) }))
  ]);
  for (const result of results) assertComplete(result);
});

test("all collectors run once per successful collection", async () => {
  const calls = [0, 0, 0];
  await coordinateWorkspaceResolution(request, { readRuntimeAssignmentEvidence: async () => { calls[0] += 1; return absent(EVIDENCE_SOURCES.runtimeAssignment); }, readExactWindowBindingEvidence: async () => { calls[1] += 1; return absent(EVIDENCE_SOURCES.exactWindowBinding); }, readCompatibilityWorkspaceEvidence: async () => { calls[2] += 1; return absent(EVIDENCE_SOURCES.compatibilityWorkspace); } });
  assert.deepEqual(calls, [1, 1, 1]);
});

test("resolver has exactly one invocation site", async () => {
  const source = await readFile(new URL("../../src/core/workspace-resolution-coordination/coordinator.js", import.meta.url), "utf8");
  assert.equal(source.match(/resolveWorkspaceEvidence\s*\(/g)?.length, 1);
});

test("resolver status mapping is explicit and creation requires unresolved", async () => {
  const source = await readFile(new URL("../../src/core/workspace-resolution-coordination/coordinator.js", import.meta.url), "utf8");
  assert.match(source, /resolution\.status === "unresolved"[^\n]+createWorkspaceAndAssign/);
  assert.match(source, /"unexpected_resolution_status"/);
  assert.equal(source.match(/COORDINATION_STATUSES\.creationRequired/g)?.length, 1);
});

test("coordinator has no time randomness storage browser or network dependency", async () => {
  const source = await readFile(new URL("../../src/core/workspace-resolution-coordination/coordinator.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\b(Date|Math\.random|crypto|chrome|indexedDB|fetch|XMLHttpRequest|WebSocket|localStorage)\b/);
});

test("purity checker accepts canonical imports", async () => {
  assert.equal(validWorkspaceResolutionCoordinationSpecifier("./contract.js"), true);
  assert.equal(validWorkspaceResolutionCoordinationSpecifier("../runtime-contract/value-utils.js"), true);
  assert.equal(validWorkspaceResolutionCoordinationSpecifier("../workspace-resolution/resolver.js"), true);
  assert.equal(await checkWorkspaceResolutionCoordinationPurity(), 2);
});

test("purity checker rejects adversarial imports and artifacts", async () => {
  for (const specifier of ["../../escape.js", "../workspace-resolution/other.js", "node:fs", "pkg", "./nested/file.js", "./contract.js?x=1"]) assert.equal(validWorkspaceResolutionCoordinationSpecifier(specifier), false);
  const root = await mkdtemp(join(tmpdir(), "constellation-purity-"));
  await writeFile(join(root, "contract.js"), "export const ok = true;\n");
  await writeFile(join(root, "coordinator.js"), "import fs from 'node:fs';\nexport { fs };\n");
  await assert.rejects(checkWorkspaceResolutionCoordinationPurity(pathUrl(root)), /outside approved/);
  await writeFile(join(root, "coordinator.js"), "import './contract.js';\nexport const ok = true;\n");
  await mkdir(join(root, "nested"));
  await assert.rejects(checkWorkspaceResolutionCoordinationPurity(pathUrl(root)), /unexpected/);
});

test("coordination purity rejects hardened lexical adversaries", async () => {
  const root = await mkdtemp(join(tmpdir(), "constellation-lexical-purity-"));
  await writeFile(join(root, "contract.js"), "export const ok = true;\n");
  const adversaries = [
    ["dynamic import", "export const value = import('./contract.js');\n", /dynamic import/],
    ["import meta", "export const value = import.meta.url;\n", /import\.meta/],
    ["template literal", "export const value = `unsafe`;\n", /template literal/],
    ["comment-obfuscated import", "import/* hidden */ value from 'node:fs';\nexport { value };\n", /outside approved/],
    ["CR terminator", "// hidden\rimport value from 'node:fs';\nexport { value };\n", /outside approved/],
    ["U+2028 terminator", "// hidden\u2028import value from 'node:fs';\nexport { value };\n", /outside approved/],
    ["U+2029 terminator", "// hidden\u2029import value from 'node:fs';\nexport { value };\n", /outside approved/]
  ];
  for (const [name, source, expected] of adversaries) {
    await writeFile(join(root, "coordinator.js"), source);
    await assert.rejects(checkWorkspaceResolutionCoordinationPurity(pathUrl(root)), expected, name);
  }
});

function pathUrl(path) { return new URL("file:///" + path.replaceAll("\\", "/") + "/"); }
function assertComplete(result) {
  assert.deepEqual(Object.keys(result), ["schema", "status", "reason", "decision", "operationId", "contextId", "windowId", "resolvedWorkspaceId", "expectedAssignmentEpoch", "collection", "resolution", "retrySafe", "warnings", "errors"]);
  assert.doesNotThrow(() => structuredClone(result)); assert.doesNotThrow(() => JSON.stringify(result)); assert.equal(JSON.stringify(result).includes("undefined"), false);
}
