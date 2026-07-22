import assert from "node:assert/strict";
import test from "node:test";

import {
  WORKSPACE_OPERATION_COMMAND_SCHEMAS,
  WORKSPACE_OPERATION_LEDGER_KEY_PREFIX,
  WORKSPACE_OPERATION_LEDGER_SCHEMA,
  WORKSPACE_OPERATION_TERMINAL_LIMIT,
  createWorkspaceOperationLedger,
  deriveWorkspaceOperationLedgerKey,
  snapshotAndValidateWorkspaceOperationLedger,
  workspaceOperationLedgerFingerprint
} from "../../src/core/runtime-workspace-operation-ledger/contract.js";
import {
  appendOperationProgress,
  inspectWorkspaceOperation,
  pruneWorkspaceOperationTerminals,
  recordImmutableOperationIntent,
  recordWorkspaceOperationTerminal
} from "../../src/core/runtime-workspace-operation-ledger/ledger.js";
import {
  classifyRecoveryOverlap,
  discoverWorkspaceRecoveryEvidence
} from "../../src/core/runtime-workspace-operation-ledger/recovery-discovery.js";
import { createWorkspaceOperationLedgerChromeAdapters } from "../../src/core/runtime-workspace-operation-ledger/chrome-adapter.js";

const NOW = "2026-07-20T00:00:00.000Z";
const LATER = "2026-07-20T00:01:00.000Z";

test("valid workspace ledger uses the exact scoped key schema and terminal limit", () => {
  const ledger = createWorkspaceOperationLedger("workspace-alpha");
  assert.deepEqual(ledger, {
    schema: WORKSPACE_OPERATION_LEDGER_SCHEMA,
    workspaceId: "workspace-alpha",
    terminalRetentionLimit: WORKSPACE_OPERATION_TERMINAL_LIMIT,
    nextSequence: 1,
    entries: []
  });
  assert.equal(deriveWorkspaceOperationLedgerKey("workspace-alpha"), WORKSPACE_OPERATION_LEDGER_KEY_PREFIX + "workspace-alpha");
  assert.equal(snapshotAndValidateWorkspaceOperationLedger(ledger, { workspaceId: "workspace-alpha", key: deriveWorkspaceOperationLedgerKey("workspace-alpha") }).valid, true);
});

test("malformed schema key and unknown ledger fields fail closed", () => {
  const schema = createWorkspaceOperationLedger("workspace-alpha");
  schema.schema = "constellation-runtime-operation-ledger-v0.1";
  const unknown = { ...createWorkspaceOperationLedger("workspace-alpha"), maxEntries: 256 };
  assert.equal(snapshotAndValidateWorkspaceOperationLedger(schema).valid, false);
  assert.equal(snapshotAndValidateWorkspaceOperationLedger(unknown).valid, false);
  assert.equal(snapshotAndValidateWorkspaceOperationLedger(createWorkspaceOperationLedger("workspace-alpha"), { key: deriveWorkspaceOperationLedgerKey("workspace-beta") }).valid, false);
  assert.throws(() => deriveWorkspaceOperationLedgerKey("workspace:alpha"), /workspaceId is invalid/);
});

test("recorded intent has exact immutable pending evidence and a unique positive sequence", () => {
  const original = createWorkspaceOperationLedger("workspace-alpha");
  const details = intentDetails();
  const recorded = recordImmutableOperationIntent(original, details);
  assert.equal(recorded.status, "recorded");
  assert.equal(recorded.entry.sequence, 1);
  assert.equal(recorded.ledger.nextSequence, 2);
  assert.equal(recorded.entry.state, "pending");
  assert.equal(recorded.entry.result, null);
  assert.deepEqual(recorded.entry.recoveryEvidence, { completedPhases: ["pending_evidence"], nextRecoverablePhase: "runtime_record_mutation", createdArtifactIds: [] });
  details.operationIntent.plannedArtifactIds.push("late-artifact");
  assert.deepEqual(recorded.entry.operationIntent.plannedArtifactIds, ["constellationRuntimeWorkspace:workspace-alpha"]);
  assert.deepEqual(original.entries, []);
  assert.equal(snapshotAndValidateWorkspaceOperationLedger(recorded.ledger).valid, true);
});

test("session-independent operation evidence accepts null and rejects every other absent-like session identity", () => {
  const sessionIndependent = recordImmutableOperationIntent(
    createWorkspaceOperationLedger("workspace-alpha"),
    intentDetails({ runtimeSessionId: null })
  );
  assert.equal(sessionIndependent.status, "recorded");
  assert.equal(sessionIndependent.entry.runtimeSessionId, null);
  assert.equal(sessionIndependent.entry.operationIntent.expectedRuntimeSessionId, null);
  assert.equal(snapshotAndValidateWorkspaceOperationLedger(sessionIndependent.ledger).valid, true);

  for (const runtimeSessionId of ["", "   ", 0, false, {}, []]) {
    const rejected = recordImmutableOperationIntent(
      createWorkspaceOperationLedger("workspace-alpha"),
      intentDetails({ runtimeSessionId })
    );
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.reason, "operation_intent_invalid");
  }
});
test("key ledger entry and immutable-intent workspace identities must all match", () => {
  const recorded = recordImmutableOperationIntent(createWorkspaceOperationLedger("workspace-alpha"), intentDetails()).ledger;
  const cases = [
    (ledger) => { ledger.workspaceId = "workspace-beta"; },
    (ledger) => { ledger.entries[0].workspaceId = "workspace-beta"; },
    (ledger) => { ledger.entries[0].operationIntent.primaryWorkspaceId = "workspace-beta"; },
    (ledger) => { ledger.entries[0].operationIntent.expectedWorkspaceRevisions = { "workspace-beta": 0 }; }
  ];
  for (const mutate of cases) {
    const value = structuredClone(recorded);
    mutate(value);
    assert.equal(snapshotAndValidateWorkspaceOperationLedger(value).valid, false);
  }
});

test("unknown entry and immutable-intent fields are rejected", () => {
  const ledger = recordImmutableOperationIntent(createWorkspaceOperationLedger("workspace-alpha"), intentDetails()).ledger;
  const entryUnknown = structuredClone(ledger);
  entryUnknown.entries[0].authority = true;
  const intentUnknown = structuredClone(ledger);
  intentUnknown.entries[0].operationIntent.workspace = {};
  assert.equal(snapshotAndValidateWorkspaceOperationLedger(entryUnknown).valid, false);
  assert.equal(snapshotAndValidateWorkspaceOperationLedger(intentUnknown).valid, false);
});

test("immutable intent cannot be rewritten while progress appends evidence", () => {
  const recorded = recordImmutableOperationIntent(createWorkspaceOperationLedger("workspace-alpha"), intentDetails());
  const intentBefore = JSON.stringify(recorded.entry.operationIntent);
  const progress = appendOperationProgress(recorded.ledger, "operation-1", "fingerprint-1", {
    state: "indeterminate",
    phase: "runtime_record_written",
    updatedAt: LATER,
    completedPhases: ["pending_evidence", "runtime_record_mutation"],
    nextRecoverablePhase: "assignment_mutation",
    createdArtifacts: [{ kind: "runtime_record", id: "constellationRuntimeWorkspace:workspace-alpha" }],
    createdArtifactIds: ["constellationRuntimeWorkspace:workspace-alpha"]
  });
  assert.equal(progress.status, "progress_recorded");
  assert.equal(progress.entry.state, "indeterminate");
  assert.deepEqual(progress.entry.recoveryEvidence.completedPhases, ["pending_evidence", "runtime_record_mutation"]);
  assert.equal(JSON.stringify(progress.entry.operationIntent), intentBefore);
  assert.deepEqual(recorded.ledger, recordImmutableOperationIntent(createWorkspaceOperationLedger("workspace-alpha"), intentDetails()).ledger);
});

test("terminal evidence is required and unresolved evidence remains required before terminal", () => {
  const recorded = recordImmutableOperationIntent(createWorkspaceOperationLedger("workspace-alpha"), intentDetails());
  const invalidTerminal = recordWorkspaceOperationTerminal(recorded.ledger, "operation-1", "fingerprint-1", { phase: "complete", updatedAt: LATER, result: null });
  assert.equal(invalidTerminal.status, "rejected");
  const malformedPending = structuredClone(recorded.ledger);
  malformedPending.entries[0].recoveryEvidence = null;
  assert.equal(snapshotAndValidateWorkspaceOperationLedger(malformedPending).valid, false);
  const terminal = terminalize(recorded.ledger);
  assert.equal(terminal.status, "terminal_recorded");
  assert.equal(terminal.entry.state, "terminal");
  assert.deepEqual(terminal.entry.result, { schema: "test-result-v0.1", status: "committed" });
  assert.equal(terminal.entry.recoveryEvidence.nextRecoverablePhase, null);
});

test("same operation ID and fingerprint replays terminal or unresolved evidence", () => {
  const recorded = recordImmutableOperationIntent(createWorkspaceOperationLedger("workspace-alpha"), intentDetails());
  const unresolvedReplay = recordImmutableOperationIntent(recorded.ledger, intentDetails());
  assert.equal(unresolvedReplay.status, "recovery_required");
  assert.equal(unresolvedReplay.requiresFreshAuthority, true);
  const terminal = terminalize(recorded.ledger);
  const terminalReplay = recordImmutableOperationIntent(terminal.ledger, intentDetails());
  assert.equal(terminalReplay.status, "terminal_replay");
  assert.deepEqual(terminalReplay.entry.result, terminal.entry.result);
});

test("same operation ID with a different fingerprint conflicts without mutation", () => {
  const recorded = recordImmutableOperationIntent(createWorkspaceOperationLedger("workspace-alpha"), intentDetails());
  const conflict = recordImmutableOperationIntent(recorded.ledger, intentDetails({ requestFingerprint: "fingerprint-other" }));
  assert.equal(conflict.status, "operation_id_conflict");
  assert.deepEqual(conflict.ledger, recorded.ledger);
});

test("pending and indeterminate entries are retained while only oldest terminal entries prune above 256", () => {
  const ledger = createWorkspaceOperationLedger("workspace-alpha");
  ledger.nextSequence = 260;
  ledger.entries.push(entryFixture({ operationId: "pending", requestFingerprint: "fp-pending", state: "pending", sequence: 1 }));
  ledger.entries.push(entryFixture({ operationId: "indeterminate", requestFingerprint: "fp-indeterminate", state: "indeterminate", sequence: 2 }));
  for (let sequence = 3; sequence <= 259; sequence += 1) ledger.entries.push(entryFixture({ operationId: "terminal-" + sequence, requestFingerprint: "fp-" + sequence, state: "terminal", sequence }));
  const pruned = pruneWorkspaceOperationTerminals(ledger);
  assert.equal(pruned.status, "pruned");
  assert.equal(pruned.ledger.entries.filter((entry) => entry.state === "terminal").length, 256);
  assert.ok(pruned.ledger.entries.some((entry) => entry.operationId === "pending"));
  assert.ok(pruned.ledger.entries.some((entry) => entry.operationId === "indeterminate"));
  assert.deepEqual(pruned.prunedOperationIds, ["terminal-3"]);
  assert.equal(pruned.ledger.nextSequence, 260);
  assert.equal(snapshotAndValidateWorkspaceOperationLedger(pruned.ledger).valid, true);
});

test("duplicate non-positive unsafe and out-of-range sequences fail validation", () => {
  const recorded = recordImmutableOperationIntent(createWorkspaceOperationLedger("workspace-alpha"), intentDetails()).ledger;
  for (const sequence of [0, -1, 2, Number.MAX_SAFE_INTEGER + 1]) {
    const ledger = structuredClone(recorded);
    ledger.entries[0].sequence = sequence;
    assert.equal(snapshotAndValidateWorkspaceOperationLedger(ledger).valid, false);
  }
  const duplicate = structuredClone(recorded);
  duplicate.entries.push({ ...structuredClone(duplicate.entries[0]), operationId: "operation-2", requestFingerprint: "fingerprint-2" });
  duplicate.nextSequence = 3;
  assert.equal(snapshotAndValidateWorkspaceOperationLedger(duplicate).valid, false);
});

test("discovery indexes affected workspaces including replacement prior and candidate", () => {
  const replacement = intentDetails({
    operationId: "replace-1",
    requestFingerprint: "replace-fp",
    workspaceId: "workspace-candidate",
    affectedWorkspaceIds: ["workspace-candidate", "workspace-prior"],
    operationKind: "replacement"
  });
  const ledger = recordImmutableOperationIntent(createWorkspaceOperationLedger("workspace-candidate"), replacement).ledger;
  const storage = {
    unrelated: { ignored: true },
    [deriveWorkspaceOperationLedgerKey("workspace-candidate")]: ledger
  };
  const discovered = discoverWorkspaceRecoveryEvidence(storage);
  assert.equal(discovered.status, "discovered");
  assert.equal(discovered.writesPerformed, 0);
  assert.deepEqual(discovered.relevanceIndex, [
    { workspaceId: "workspace-candidate", operationIds: ["replace-1"] },
    { workspaceId: "workspace-prior", operationIds: ["replace-1"] }
  ]);
  const prior = classifyRecoveryOverlap(discovered, ["workspace-prior"]);
  assert.equal(prior.status, "recovery_required");
  assert.equal(prior.operation.ledgerWorkspaceId, "workspace-candidate");
});

test("overlapping unresolved operations conflict while disjoint work remains independent", () => {
  const alpha = recordImmutableOperationIntent(createWorkspaceOperationLedger("workspace-alpha"), intentDetails()).ledger;
  const replacement = recordImmutableOperationIntent(createWorkspaceOperationLedger("workspace-beta"), intentDetails({ operationId: "operation-2", requestFingerprint: "fingerprint-2", workspaceId: "workspace-beta", affectedWorkspaceIds: ["workspace-alpha", "workspace-beta"], operationKind: "replacement" })).ledger;
  const conflictDiscovery = discoverWorkspaceRecoveryEvidence({
    [deriveWorkspaceOperationLedgerKey("workspace-alpha")]: alpha,
    [deriveWorkspaceOperationLedgerKey("workspace-beta")]: replacement
  });
  const conflict = classifyRecoveryOverlap(conflictDiscovery, ["workspace-alpha"]);
  assert.equal(conflict.status, "recovery_operation_conflict");
  assert.deepEqual(conflict.overlappingWorkspaceIds, ["workspace-alpha"]);

  const gamma = recordImmutableOperationIntent(createWorkspaceOperationLedger("workspace-gamma"), intentDetails({ operationId: "operation-3", requestFingerprint: "fingerprint-3", workspaceId: "workspace-gamma" })).ledger;
  const independent = classifyRecoveryOverlap(discoverWorkspaceRecoveryEvidence({
    [deriveWorkspaceOperationLedgerKey("workspace-alpha")]: alpha,
    [deriveWorkspaceOperationLedgerKey("workspace-gamma")]: gamma
  }));
  assert.equal(independent.status, "independent_recovery_operations");
  assert.equal(independent.requiresFreshAuthority, true);
});

test("same operation ID reused by distinct ledgers still conflicts when affected workspaces overlap", () => {
  const alpha = recordImmutableOperationIntent(
    createWorkspaceOperationLedger("workspace-alpha"),
    intentDetails({ operationId: "shared-operation", requestFingerprint: "shared-fingerprint" })
  ).ledger;
  const beta = recordImmutableOperationIntent(
    createWorkspaceOperationLedger("workspace-beta"),
    intentDetails({
      operationId: "shared-operation",
      requestFingerprint: "shared-fingerprint",
      workspaceId: "workspace-beta",
      affectedWorkspaceIds: ["workspace-alpha", "workspace-beta"],
      operationKind: "replacement"
    })
  ).ledger;

  const classification = classifyRecoveryOverlap(discoverWorkspaceRecoveryEvidence({
    [deriveWorkspaceOperationLedgerKey("workspace-alpha")]: alpha,
    [deriveWorkspaceOperationLedgerKey("workspace-beta")]: beta
  }), ["workspace-alpha"]);

  assert.equal(classification.status, "recovery_operation_conflict");
  assert.equal(classification.reason, "overlapping_unresolved_operations");
  assert.deepEqual(classification.overlappingWorkspaceIds, ["workspace-alpha"]);
});
test("malformed discovery keys ledgers and intents are reported without repair", () => {
  const ledger = recordImmutableOperationIntent(createWorkspaceOperationLedger("workspace-alpha"), intentDetails()).ledger;
  ledger.entries[0].operationIntent.commandSchema = "wrong";
  const storage = {
    [WORKSPACE_OPERATION_LEDGER_KEY_PREFIX]: {},
    [deriveWorkspaceOperationLedgerKey("workspace-alpha")]: ledger
  };
  const before = structuredClone(storage);
  const discovery = discoverWorkspaceRecoveryEvidence(storage);
  assert.equal(discovery.status, "malformed_recovery_evidence");
  assert.equal(discovery.malformedEvidence.length, 2);
  assert.equal(discovery.writesPerformed, 0);
  assert.deepEqual(storage, before);
  assert.equal(classifyRecoveryOverlap(discovery, ["workspace-alpha"]).status, "malformed_recovery_evidence");
});

test("recorded old session evidence never grants recovery authority", () => {
  const ledger = recordImmutableOperationIntent(createWorkspaceOperationLedger("workspace-alpha"), intentDetails({ runtimeSessionId: "old-session" })).ledger;
  const discovered = discoverWorkspaceRecoveryEvidence({ [deriveWorkspaceOperationLedgerKey("workspace-alpha")]: ledger });
  const classification = classifyRecoveryOverlap(discovered, ["workspace-alpha"]);
  assert.equal(classification.status, "recovery_required");
  assert.equal(classification.operation.entry.runtimeSessionId, "old-session");
  assert.equal(classification.requiresFreshAuthority, true);
  assert.equal(Object.hasOwn(classification, "authorized"), false);
});

test("Chrome adapter compare-write-verifies one local ledger under the supplied workspace lock", async () => {
  const storage = fakeLocalStorage();
  const lockTrace = [];
  const unlocked = createWorkspaceOperationLedgerChromeAdapters({ storage: { local: storage.api } });
  assert.equal((await unlocked.createLedger("workspace-alpha")).reason, "workspace_lock_unavailable");
  const adapters = createWorkspaceOperationLedgerChromeAdapters({ storage: { local: storage.api } }, {
    withWorkspaceLock: async (workspaceId, callback) => { lockTrace.push(workspaceId); return callback(); }
  });
  const created = await adapters.createLedger("workspace-alpha");
  assert.equal(created.status, "created");
  const recorded = recordImmutableOperationIntent(created.ledger, intentDetails());
  const conflict = await adapters.compareWriteLedger("workspace-alpha", "wrong", recorded.ledger);
  assert.equal(conflict.status, "conflict");
  const committed = await adapters.compareWriteLedger("workspace-alpha", created.fingerprint, recorded.ledger);
  assert.equal(committed.status, "committed");
  assert.equal(committed.verified, true);
  assert.equal(committed.fingerprint, workspaceOperationLedgerFingerprint(recorded.ledger));
  assert.deepEqual(lockTrace, ["workspace-alpha", "workspace-alpha", "workspace-alpha"]);
});

test("Chrome recovery enumeration performs exactly one read and zero writes while preserving unrelated ledgers", async () => {
  const storage = fakeLocalStorage();
  const alpha = recordImmutableOperationIntent(createWorkspaceOperationLedger("workspace-alpha"), intentDetails()).ledger;
  const terminal = terminalize(recordImmutableOperationIntent(createWorkspaceOperationLedger("workspace-beta"), intentDetails({ operationId: "operation-2", requestFingerprint: "fingerprint-2", workspaceId: "workspace-beta" })).ledger).ledger;
  storage.values.set(deriveWorkspaceOperationLedgerKey("workspace-alpha"), alpha);
  storage.values.set(deriveWorkspaceOperationLedgerKey("workspace-beta"), terminal);
  storage.values.set("unrelated", { preserved: true });
  const before = structuredClone(Object.fromEntries(storage.values));
  const adapters = createWorkspaceOperationLedgerChromeAdapters({ storage: { local: storage.api } });
  const discovery = await adapters.discoverRecovery();
  assert.equal(discovery.status, "discovered");
  assert.equal(discovery.unresolvedOperations.length, 1);
  assert.equal(storage.getCalls, 1);
  assert.equal(storage.setCalls, 0);
  assert.deepEqual(Object.fromEntries(storage.values), before);
});

function intentDetails(overrides = {}) {
  const workspaceId = overrides.workspaceId || "workspace-alpha";
  const affectedWorkspaceIds = [...(overrides.affectedWorkspaceIds || [workspaceId])].sort();
  const operationKind = overrides.operationKind || "create_and_bind";
  const runtimeSessionId = Object.hasOwn(overrides, "runtimeSessionId") ? overrides.runtimeSessionId : "runtime-session-1";
  return {
    operationId: overrides.operationId || "operation-1",
    requestFingerprint: overrides.requestFingerprint || "fingerprint-1",
    commandSchema: WORKSPACE_OPERATION_COMMAND_SCHEMAS[operationKind],
    affectedWorkspaceIds,
    runtimeSessionId,
    requestedAt: NOW,
    operationIntent: {
      operationKind,
      commandSchema: WORKSPACE_OPERATION_COMMAND_SCHEMAS[operationKind],
      primaryWorkspaceId: workspaceId,
      affectedWorkspaceIds,
      sourceWindowId: null,
      targetWindowId: 101,
      expectedRuntimeSessionId: runtimeSessionId,
      expectedAssignmentId: null,
      expectedAssignmentEpoch: null,
      expectedWorkspaceRevisions: Object.fromEntries(affectedWorkspaceIds.map((id) => [id, 0])),
      durableSourceIdentity: null,
      durableSnapshotDigest: null,
      browserPlanDigest: null,
      projectionBaselineDigest: null,
      compatibilityPreflightFingerprints: { canonical: null, legacy: null },
      completedPhasesAtIntentWrite: [],
      nextRecoverablePhaseAtIntentWrite: "runtime_record_mutation",
      plannedArtifactIds: ["constellationRuntimeWorkspace:" + workspaceId]
    }
  };
}

function entryFixture({ operationId, requestFingerprint, state, sequence }) {
  const details = intentDetails({ operationId, requestFingerprint });
  return {
    operationId,
    requestFingerprint,
    commandSchema: details.commandSchema,
    workspaceId: "workspace-alpha",
    affectedWorkspaceIds: ["workspace-alpha"],
    runtimeSessionId: details.runtimeSessionId,
    operationIntent: details.operationIntent,
    state,
    phase: state === "terminal" ? "complete" : "pending_evidence",
    requestedAt: NOW,
    updatedAt: LATER,
    createdArtifacts: [],
    compensationEvidence: { status: "not_required", actions: [] },
    result: state === "terminal" ? { schema: "test-result-v0.1", status: "committed" } : null,
    recoveryEvidence: { completedPhases: state === "terminal" ? ["complete"] : [], nextRecoverablePhase: state === "terminal" ? null : "runtime_record_mutation", createdArtifactIds: [] },
    sequence
  };
}

function terminalize(ledger) {
  return recordWorkspaceOperationTerminal(ledger, ledger.entries[0].operationId, ledger.entries[0].requestFingerprint, {
    phase: "complete",
    updatedAt: LATER,
    completedPhases: ["pending_evidence", "complete"],
    result: { schema: "test-result-v0.1", status: "committed" }
  });
}

function fakeLocalStorage() {
  const values = new Map();
  const state = {
    values,
    getCalls: 0,
    setCalls: 0,
    api: {
      async get(key) {
        state.getCalls += 1;
        if (key === null) return structuredClone(Object.fromEntries(values));
        const keys = Array.isArray(key) ? key : [key];
        return Object.fromEntries(keys.filter((name) => values.has(name)).map((name) => [name, structuredClone(values.get(name))]));
      },
      async set(items) {
        state.setCalls += 1;
        for (const [key, value] of Object.entries(items)) values.set(key, structuredClone(value));
      }
    }
  };
  return state;
}
