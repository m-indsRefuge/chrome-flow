import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_EVIDENCE_KINDS as KINDS, WORKSPACE_EVIDENCE_REJECTION_REASONS as REJECTIONS, WORKSPACE_RESOLUTION_REQUEST_SCHEMA, WORKSPACE_RESOLUTION_RESULT_SCHEMA, resolveWorkspaceEvidence } from "../../src/core/workspace-resolution/resolver.js";
import { checkWorkspaceResolutionPurity, validWorkspaceResolutionSpecifier } from "../../scripts/check-runtime-contract-purity.mjs";

const request = (evidence = [], overrides = {}) => ({ schema: WORKSPACE_RESOLUTION_REQUEST_SCHEMA, contextId: "context-1", windowId: 7, expectedAssignmentEpoch: 3, evidence, ...overrides });
const assignment = (workspaceId = "workspace-1", overrides = {}) => ({ kind: KINDS.verifiedRuntimeAssignment, workspaceId, windowId: 7, assignmentEpoch: 3, contextId: "context-1", runtimeAssignmentId: "assignment-1", verified: true, ...overrides });
const binding = (workspaceId = "workspace-1", overrides = {}) => ({ kind: KINDS.exactWindowBinding, workspaceId, windowId: 7, assignmentEpoch: null, contextId: "context-1", runtimeAssignmentId: "", verified: true, ...overrides });
const compatibility = (workspaceId = "workspace-1", overrides = {}) => ({ kind: KINDS.compatibilityReference, workspaceId, windowId: null, assignmentEpoch: null, contextId: "", runtimeAssignmentId: "", verified: false, ...overrides });
const rejectedReasons = (result) => new Set(result.rejectedEvidence.flatMap((item) => item.rejectionReasons));

test("nullable request epoch permits exact binding but rejects assignment evidence", () => {
  const exact = resolveWorkspaceEvidence(request([binding("workspace-b")], { expectedAssignmentEpoch: null }));
  assert.equal(exact.status, "resolved"); assert.equal(exact.resolvedWorkspaceId, "workspace-b");
  const assigned = resolveWorkspaceEvidence(request([assignment()], { expectedAssignmentEpoch: null }));
  assert.equal(assigned.status, "unresolved"); assert.equal(rejectedReasons(assigned).has(REJECTIONS.missingExpectedEpoch), true);
});

test("exact binding enforces null epoch empty assignment identity and current verification context", () => {
  const result = resolveWorkspaceEvidence(request([binding("epoch", { assignmentEpoch: 3 }), binding("identity", { runtimeAssignmentId: "assignment-1" }), binding("context", { contextId: "old" })], { expectedAssignmentEpoch: null }));
  const reasons = rejectedReasons(result);
  assert.equal(result.status, "unresolved");
  for (const reason of [REJECTIONS.forbiddenAssignmentEpoch, REJECTIONS.forbiddenAssignmentId, REJECTIONS.wrongContext]) assert.equal(reasons.has(reason), true);
});

test("verified assignment requires matching positive epoch and complete identities", () => {
  const resolved = resolveWorkspaceEvidence(request([assignment("workspace-a")]));
  assert.equal(resolved.status, "resolved"); assert.equal(resolved.resolvedWorkspaceId, "workspace-a");
  const rejected = resolveWorkspaceEvidence(request([assignment("stale", { assignmentEpoch: 2 }), assignment("missing", { runtimeAssignmentId: "" }), assignment("window", { windowId: 8 }), assignment("context", { contextId: "old" }), assignment("unverified", { verified: false })]));
  const reasons = rejectedReasons(rejected);
  for (const reason of [REJECTIONS.wrongEpoch, REJECTIONS.invalidAssignmentId, REJECTIONS.wrongWindow, REJECTIONS.wrongContext, REJECTIONS.unverified]) assert.equal(reasons.has(reason), true);
});

test("exact duplicate and same assignment identity evidence consolidate", () => {
  const item = assignment("workspace-a");
  const result = resolveWorkspaceEvidence(request([item, structuredClone(item), assignment("workspace-a")]));
  assert.equal(result.status, "resolved"); assert.equal(result.acceptedEvidence.length, 1); assert.equal(result.decisiveEvidence.length, 1);
});

test("different assignment identities for one workspace are an identity ambiguity", () => {
  const items = [assignment("workspace-a", { runtimeAssignmentId: "assignment-z" }), assignment("workspace-a", { runtimeAssignmentId: "assignment-a" })];
  const result = resolveWorkspaceEvidence(request(items));
  assert.equal(result.status, "ambiguous"); assert.equal(result.reason, "contradictory_runtime_assignment_identity");
  assert.deepEqual(result.ambiguity, { authorityKind: KINDS.verifiedRuntimeAssignment, authorityLevel: 2, workspaceIds: ["workspace-a"], runtimeAssignmentIds: ["assignment-a", "assignment-z"] });
  assert.equal(JSON.stringify(result).includes("undefined"), false); assert.deepEqual(resolveWorkspaceEvidence(request([...items].reverse())), result);
});

test("ordinary highest-authority workspace conflicts remain ambiguous", () => {
  const result = resolveWorkspaceEvidence(request([assignment("workspace-b", { runtimeAssignmentId: "b" }), assignment("workspace-a", { runtimeAssignmentId: "a" }), binding("workspace-c")]));
  assert.equal(result.status, "ambiguous"); assert.equal(result.reason, "highest_authority_conflict");
  assert.deepEqual(result.ambiguity.workspaceIds, ["workspace-a", "workspace-b"]); assert.equal(result.authorityKind, KINDS.verifiedRuntimeAssignment);
});

test("removed deterministic kind is unsupported", () => {
  const result = resolveWorkspaceEvidence(request([{ ...binding(), kind: "deterministic_workspace_identity" }]));
  assert.equal(result.status, "unresolved"); assert.deepEqual(result.rejectedEvidence[0].rejectionReasons, [REJECTIONS.unsupportedKind]);
});

test("canonical compatibility remains visible and ineligible and never overrides authority", () => {
  const only = resolveWorkspaceEvidence(request([compatibility("workspace-c")]));
  assert.equal(only.status, "unresolved"); assert.equal(only.reason, "compatibility_evidence_non_authoritative"); assert.equal(only.acceptedEvidence[0].eligible, false);
  assert.equal(resolveWorkspaceEvidence(request([compatibility("workspace-c"), binding("workspace-b")])).resolvedWorkspaceId, "workspace-b");
  assert.equal(resolveWorkspaceEvidence(request([compatibility("workspace-c"), assignment("workspace-a")])).resolvedWorkspaceId, "workspace-a");
});

test("noncanonical compatibility claims are rejected", () => {
  const result = resolveWorkspaceEvidence(request([compatibility("window", { windowId: 7 }), compatibility("epoch", { assignmentEpoch: 3 }), compatibility("context", { contextId: "context-1" }), compatibility("identity", { runtimeAssignmentId: "assignment-1" }), compatibility("verified", { verified: true })]));
  assert.equal(result.status, "unresolved"); assert.equal(rejectedReasons(result).has(REJECTIONS.noncanonicalCompatibility), true);
});

test("malformed coercive and nonserializable evidence never becomes authority", () => {
  const callable = assignment("callable"); callable.extra = () => {};
  const result = resolveWorkspaceEvidence(request([assignment(""), assignment("coercive", { windowId: "7", assignmentEpoch: "3", verified: 1, runtimeAssignmentId: 9 }), { ...assignment("extra"), extra: true }, callable]));
  assert.equal(result.status, "unresolved"); const reasons = rejectedReasons(result);
  for (const reason of [REJECTIONS.invalidWorkspaceId, REJECTIONS.malformed, REJECTIONS.invalidAssignmentId]) assert.equal(reasons.has(reason), true);
});

test("malformed raw exact-binding defaults cannot normalize into authority", () => {
  const result = resolveWorkspaceEvidence(request([binding("workspace-a", { assignmentEpoch: "3", runtimeAssignmentId: 9 })], { expectedAssignmentEpoch: null }));
  assert.equal(result.status, "unresolved"); assert.equal(result.acceptedEvidence.length, 0);
  assert.equal(result.rejectedEvidence[0].rejectionReasons.includes(REJECTIONS.malformed), true);
  assert.deepEqual(result.rejectedEvidence[0].evidence, binding("workspace-a", { assignmentEpoch: null, runtimeAssignmentId: "" }));
  assert.doesNotThrow(() => structuredClone(result.rejectedEvidence[0]));
});

test("each malformed raw exact-binding field type is rejected while a valid binding resolves", () => {
  for (const item of [binding("epoch", { assignmentEpoch: "3" }), binding("identity", { runtimeAssignmentId: 9 })]) {
    const result = resolveWorkspaceEvidence(request([item], { expectedAssignmentEpoch: null }));
    assert.equal(result.status, "unresolved"); assert.equal(rejectedReasons(result).has(REJECTIONS.malformed), true);
  }
  assert.equal(resolveWorkspaceEvidence(request([binding("valid")], { expectedAssignmentEpoch: null })).resolvedWorkspaceId, "valid");
});

test("malformed raw compatibility field types are rejected and safely normalized", () => {
  const malformed = compatibility("workspace-a", { windowId: "7", assignmentEpoch: "3", contextId: 9, runtimeAssignmentId: 9, verified: 0 });
  const result = resolveWorkspaceEvidence(request([malformed]));
  assert.equal(result.status, "unresolved"); assert.equal(result.acceptedEvidence.length, 0);
  assert.equal(rejectedReasons(result).has(REJECTIONS.malformed), true);
  assert.deepEqual(result.rejectedEvidence[0].evidence, compatibility("workspace-a"));
  assert.doesNotThrow(() => structuredClone(result.rejectedEvidence[0]));
  for (const item of [compatibility("window", { windowId: "7" }), compatibility("epoch", { assignmentEpoch: "3" }), compatibility("context", { contextId: 9 }), compatibility("identity", { runtimeAssignmentId: 9 }), compatibility("verified-number", { verified: 0 }), compatibility("verified-string", { verified: "false" })]) {
    const isolated = resolveWorkspaceEvidence(request([item]));
    assert.equal(isolated.acceptedEvidence.length, 0); assert.equal(rejectedReasons(isolated).has(REJECTIONS.malformed), true);
  }
  const canonical = resolveWorkspaceEvidence(request([compatibility("valid")]));
  assert.equal(canonical.acceptedEvidence.length, 1); assert.equal(canonical.acceptedEvidence[0].eligible, false);
});

test("explicit code-unit ordering covers Unicode workspace IDs fingerprints and rejections", () => {
  const items = [binding("é"), binding("Z")];
  const result = resolveWorkspaceEvidence(request(items));
  assert.deepEqual(result.ambiguity.workspaceIds, ["Z", "é"]);
  assert.deepEqual(result.acceptedEvidence.map((item) => item.workspaceId), ["Z", "é"]);
  const rejected = resolveWorkspaceEvidence(request([{ ...binding("é"), kind: "z" }, { ...binding("Z"), kind: "z" }]));
  assert.deepEqual(rejected.rejectedEvidence.map((item) => item.evidence.workspaceId), ["Z", "é"]);
});

test("result exposes decisive authority and canonical empty authority fields", () => {
  const resolved = resolveWorkspaceEvidence(request([binding("workspace-b"), assignment("workspace-a")]));
  assert.equal(resolved.authorityKind, KINDS.verifiedRuntimeAssignment); assert.equal(resolved.authorityLevel, 2); assert.deepEqual(resolved.decisiveEvidence, [resolved.acceptedEvidence[0]]);
  for (const value of [resolveWorkspaceEvidence(request()), resolveWorkspaceEvidence(null)]) {
    assert.equal(value.authorityKind, null); assert.equal(value.authorityLevel, null); assert.deepEqual(value.decisiveEvidence, []);
    assert.deepEqual(value.ambiguity, { authorityKind: null, authorityLevel: null, workspaceIds: [], runtimeAssignmentIds: [] });
  }
});

test("input order does not affect complete result and inputs remain unmodified", () => {
  const items = [compatibility("workspace-z"), assignment("workspace-a"), binding("workspace-b")];
  const input = request(items); const before = structuredClone(input);
  const left = resolveWorkspaceEvidence(input); const right = resolveWorkspaceEvidence(request([...items].reverse()));
  assert.deepEqual(left, right); assert.deepEqual(input, before);
});

test("all statuses have one complete serializable result shape", () => {
  const results = [resolveWorkspaceEvidence(request([assignment()])), resolveWorkspaceEvidence(request()), resolveWorkspaceEvidence(request([assignment("a", { runtimeAssignmentId: "a" }), assignment("b", { runtimeAssignmentId: "b" })])), resolveWorkspaceEvidence(null)];
  const keys = Object.keys(results[0]).sort();
  assert.deepEqual(keys, ["acceptedEvidence", "ambiguity", "authorityKind", "authorityLevel", "decisiveEvidence", "eligibleCandidateWorkspaceIds", "reason", "rejectedEvidence", "requestErrors", "resolvedWorkspaceId", "schema", "status"].sort());
  for (const result of results) { assert.deepEqual(Object.keys(result).sort(), keys); assert.doesNotThrow(() => structuredClone(result)); assert.equal(JSON.stringify(result).includes("undefined"), false); assert.equal(result.schema, WORKSPACE_RESOLUTION_RESULT_SCHEMA); }
});

test("invalid requests include invalid epochs and unsupported serialization", () => {
  for (const value of [request([], { expectedAssignmentEpoch: 0 }), request([], { expectedAssignmentEpoch: "3" }), { schema: WORKSPACE_RESOLUTION_REQUEST_SCHEMA }, [], "bad"]) assert.equal(resolveWorkspaceEvidence(value).status, "invalid");
  const cyclic = request(); cyclic.self = cyclic; assert.equal(resolveWorkspaceEvidence(cyclic).status, "invalid");
});

test("resolver source contains no locale-sensitive comparison", async () => {
  const source = await readFile(new URL("../../src/core/workspace-resolution/resolver.js", import.meta.url), "utf8");
  assert.equal(source.includes(".localeCompare("), false);
});

async function withPurityFixture(files, assertion) {
  const directory = await mkdtemp(join(tmpdir(), "constellation-workspace-resolution-"));
  try {
    for (const [name, source] of Object.entries(files)) await writeFile(join(directory, name), source, "utf8");
    await assertion(pathToFileURL(directory + sep));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("workspace-resolution purity accepts the approved family and runtime-contract imports", async () => {
  assert.equal(await checkWorkspaceResolutionPurity(), 1);
  await withPurityFixture({ "resolver.js": 'import { value } from "../runtime-contract/value-utils.js";\nexport { value };\n' }, async (root) => assert.equal(await checkWorkspaceResolutionPurity(root), 1));
});

test("workspace-resolution purity rejects traversal and unapproved static imports", async () => {
  for (const specifier of ["./../workspace-store.js", "./nested/../../workspace-store.js", "node:fs", "some-package"]) {
    await withPurityFixture({ "resolver.js": `import value from ${JSON.stringify(specifier)};\nexport { value };\n` }, async (root) => {
      await assert.rejects(checkWorkspaceResolutionPurity(root), /imports outside approved pure families/);
    });
  }
});

test("workspace-resolution purity rejects literal and computed dynamic imports", async () => {
  for (const source of ['export const value = import("./module.js");\n', 'const target = "./module.js";\nexport const value = import(target);\n']) {
    await withPurityFixture({ "resolver.js": source }, async (root) => {
      await assert.rejects(checkWorkspaceResolutionPurity(root), /forbidden dynamic import/);
    });
  }
});

test("workspace-resolution purity rejects unexpected artifacts", async () => {
  await withPurityFixture({ "resolver.js": "export const value = 1;\n", "unexpected.txt": "artifact\n" }, async (root) => {
    await assert.rejects(checkWorkspaceResolutionPurity(root), /unexpected workspace-resolution artifact/);
  });
});

test("workspace-resolution specifiers require canonical direct relative forms", () => {
  assert.equal(validWorkspaceResolutionSpecifier("./helper.js"), true);
  assert.equal(validWorkspaceResolutionSpecifier("../runtime-contract/value-utils.js"), true);
  for (const specifier of ["evil.js", "./nested/module.js", "./../workspace-store.js", "../runtime-contract/nested/module.js", "../runtime-contract/../workspace-store.js", "../workspace-resolution/resolver.js", "/absolute.js", "https://example.test/module.js", "./helper.js?x", "./helper.js#x"]) assert.equal(validWorkspaceResolutionSpecifier(specifier), false, specifier);
});

test("workspace-resolution purity rejects bare and comment-obfuscated dependencies", async () => {
  const fixtures = [
    'import value from "evil.js";\n',
    'import "evil.js";\n',
    'import/**/value from "../workspace-store.js";\n',
    'import value from/**/"../workspace-store.js";\n',
    'export/**/{ value } from "../workspace-store.js";\n',
    'export{ value }from"../workspace-store.js";\n'
  ];
  for (const source of fixtures) await withPurityFixture({ "resolver.js": source }, async (root) => {
    await assert.rejects(checkWorkspaceResolutionPurity(root), /imports outside approved pure families/);
  });
});

test("workspace-resolution purity rejects comment-obfuscated dynamic imports and import.meta", async () => {
  for (const [source, reason] of [['import/**/("./module.js");\n', /forbidden dynamic import/], ["export const url = import.meta.url;\n", /forbidden import\.meta/]]) {
    await withPurityFixture({ "resolver.js": source }, async (root) => await assert.rejects(checkWorkspaceResolutionPurity(root), reason));
  }
});

test("workspace-resolution purity rejects every code-state template literal", async () => {
  const fixtures = [
    "export const value = `plain template`;\n",
    'export const value = `${import("./helper.js")}`;\n',
    "export const value = `${import.meta.url}`;\n",
    'export const value = `${`${import("./helper.js")}`}`;\n'
  ];
  for (const source of fixtures) await withPurityFixture({ "resolver.js": source }, async (root) => {
    await assert.rejects(checkWorkspaceResolutionPurity(root), /forbidden template literal/);
  });
});

test("quoted and commented backticks do not trigger template rejection", async () => {
  const source = 'export const single = \'backtick: `\';\nexport const double = "backtick: `";\n// backtick: `\n/* backtick: ` */\n';
  await withPurityFixture({ "resolver.js": source }, async (root) => assert.equal(await checkWorkspaceResolutionPurity(root), 1));
});

test("every JavaScript line terminator exposes following dependency syntax", async () => {
  const fixtures = [
    "// comment\rimport(\"./helper.js\");",
    "// comment\u2028import(\"./helper.js\");",
    "// comment\u2029import(\"./helper.js\");",
    "// comment\r\nimport.meta;"
  ];
  for (const source of fixtures) await withPurityFixture({ "resolver.js": source }, async (root) => {
    await assert.rejects(checkWorkspaceResolutionPurity(root), /forbidden dynamic import|forbidden import\.meta/);
  });
});
