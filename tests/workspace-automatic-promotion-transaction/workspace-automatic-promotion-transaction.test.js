import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  PROMOTION_REQUEST_SCHEMA,
  PROMOTION_RESULT_SCHEMA,
  PROMOTION_STATE_SCHEMA,
  REQUIRED_MOVE_VERIFICATION_CHECK_IDS,
  RESULT_FIELDS,
  validatePromotionResult
} from "../../src/core/workspace-automatic-promotion-transaction/contract.js";
import {
  coordinateAutomaticWorkspacePromotion
} from "../../src/core/workspace-automatic-promotion-transaction/coordinator.js";
import {
  checkWorkspaceAutomaticPromotionTransactionPurity
} from "../../scripts/check-runtime-contract-purity.mjs";

const NOW = "2026-07-15T08:00:00.000Z";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function request(overrides = {}) {
  return {
    schema: PROMOTION_REQUEST_SCHEMA,
    operationId: "promotion-op-1",
    triggerOperationId: "membership-op-1",
    triggerKind: "workspace_membership_increased",
    workspaceId: "workspace-1",
    sourceContextId: "context-1",
    sourceWindowId: 10,
    expectedWorkspaceRevision: 5,
    previousEligibleTabCount: 3,
    currentEligibleTabCount: 4,
    threshold: 4,
    nextRuntimeAssignmentId: "assignment-2",
    requestedAt: NOW,
    ...overrides
  };
}

function tabs(windowIds = [10, 10, 10, 10]) {
  return [
    {
      workspaceTabId: "wt-1",
      tabId: 101,
      sourceWindowId: windowIds[0],
      sourceGroupId: -1,
      role: "docs",
      roleLabel: "Docs",
      order: 0
    },
    {
      workspaceTabId: "wt-2",
      tabId: 102,
      sourceWindowId: windowIds[1],
      sourceGroupId: -1,
      role: "docs",
      roleLabel: "Docs",
      order: 1
    },
    {
      workspaceTabId: "wt-3",
      tabId: 103,
      sourceWindowId: windowIds[2],
      sourceGroupId: -1,
      role: "risk",
      roleLabel: "Risk",
      order: 2
    },
    {
      workspaceTabId: "wt-4",
      tabId: 104,
      sourceWindowId: windowIds[3],
      sourceGroupId: -1,
      role: "unassigned",
      roleLabel: "",
      order: 3
    }
  ];
}

function groups() {
  return [
    {
      role: "docs",
      roleLabel: "Docs",
      workspaceTabIds: ["wt-1", "wt-2"],
      colour: "blue",
      collapsed: false
    },
    {
      role: "risk",
      roleLabel: "Risk",
      workspaceTabIds: ["wt-3"],
      colour: "red",
      collapsed: false
    }
  ];
}

function state(overrides = {}) {
  const tabPlans = overrides.tabs || tabs();
  const sourceWindowIds = overrides.sourceWindowIds ||
    [...new Set(tabPlans.map((tab) => tab.sourceWindowId))].sort((a, b) => a - b);
  return {
    schema: PROMOTION_STATE_SCHEMA,
    status: "present",
    workspaceId: "workspace-1",
    workspaceRevision: 5,
    eligibleTabCount: tabPlans.length,
    placementMode: "current_window",
    dedicatedWindowId: null,
    sourceWindowIds,
    tabs: tabPlans,
    groups: groups(),
    error: "",
    ...overrides,
    sourceWindowIds,
    tabs: tabPlans
  };
}

function assignmentRegistry(overrides = {}) {
  const assignment = {
    runtimeAssignmentId: "assignment-1",
    workspaceId: "workspace-1",
    windowId: 10,
    assignmentEpoch: 1,
    state: "active",
    createdAt: NOW,
    updatedAt: NOW,
    lastVerifiedAt: NOW,
    sourceContextId: "context-1",
    ...(overrides.assignment || {})
  };
  return {
    schema: "constellation-runtime-assignment-registry-v0.1",
    nextEpoch: overrides.nextEpoch || 2,
    assignments: overrides.assignments || [assignment]
  };
}

function authority(overrides = {}) {
  return {
    status: "present",
    runtimeSessionId: "runtime-session-1",
    authorityRevision: 7,
    sourceContextVerified: true,
    assignmentRegistry: assignmentRegistry(),
    error: "",
    ...overrides
  };
}

function emptyLedger() {
  return {
    schema: "constellation-runtime-operation-ledger-v0.1",
    maxEntries: 1000,
    nextSequence: 1,
    entries: []
  };
}

function moveResult(moveRequest, overrides = {}) {
  const targetWindowId =
    overrides.targetWindowId ??
    moveRequest.targetWindowId ??
    20;
  return {
    schema: "constellation-workspace-existing-tab-move-result-v0.1",
    status: "completed_verified",
    reason: "final_projection_verified",
    operationId: moveRequest.operationId,
    workspaceId: moveRequest.workspaceId,
    mode: moveRequest.mode,
    targetWindowId,
    createdWindow: moveRequest.mode === "create_dedicated_window",
    browserMutationStarted: true,
    browserMutationVerified: true,
    movedTabIds: moveRequest.tabs.map((tab) => tab.tabId),
    alreadyInTargetTabIds: [],
    unassignedTabIds: moveRequest.tabs
      .filter((tab) => tab.role === "unassigned")
      .map((tab) => tab.tabId),
    createdGroups: [],
    verification: REQUIRED_MOVE_VERIFICATION_CHECK_IDS.map((id) => ({ id, passed: true })),
    retrySafe: false,
    warnings: [],
    errors: [],
    ...overrides
  };
}

function makeEnvironment(options = {}) {
  let ledger = clone(options.ledger || emptyLedger());
  let currentState = clone(options.state || state());
  let currentAuthority = clone(options.authority || authority());
  const calls = [];
  const target = options.targetWindowId || 20;

  const adapters = {
    async runExclusiveOperation(callback) {
      calls.push("exclusive");
      if (options.skipCallback) return undefined;
      if (options.doubleCallback) {
        await callback();
        return callback();
      }
      return callback();
    },
    async readOperationLedger() {
      calls.push("readLedger");
      if (options.ledgerReadFailure) {
        return { status: "failed", ledger: null, error: "read failed" };
      }
      return { status: "present", ledger: clone(ledger), error: "" };
    },
    async writeOperationLedger(next) {
      calls.push("writeLedger");
      if (options.ledgerWriteFailure) {
        return { status: "failed", error: "write failed" };
      }
      ledger = clone(next);
      return { status: "written", error: "" };
    },
    async readPromotionState() {
      calls.push("readState");
      if (options.stateReadFailure) throw new Error("state read failed");
      return clone(currentState);
    },
    async readRuntimeAuthority(input) {
      calls.push("readAuthority:" + String(input.requireSourceContext));
      const output = clone(currentAuthority);
      if (options.sourceContextInvalid && input.requireSourceContext) {
        output.sourceContextVerified = false;
      }
      return output;
    },
    async executeExistingTabMove(moveRequest) {
      calls.push("move:" + moveRequest.mode);
      if (options.moveThrows) throw new Error("move failed");
      if (options.beforeMove) await options.beforeMove({
        moveRequest,
        getState: () => currentState,
        setState: (next) => { currentState = clone(next); },
        getAuthority: () => currentAuthority,
        setAuthority: (next) => { currentAuthority = clone(next); }
      });
      const produced = options.moveResult
        ? options.moveResult(moveRequest)
        : moveResult(moveRequest, { targetWindowId: target });
      if (produced.status === "completed_verified") {
        currentState = {
          ...currentState,
          sourceWindowIds: [produced.targetWindowId],
          tabs: currentState.tabs.map((tab) => ({
            ...tab,
            sourceWindowId: produced.targetWindowId,
            sourceGroupId: -1
          }))
        };
      }
      return clone(produced);
    },
    async writeRuntimeAuthority(input) {
      calls.push("writeAuthority");
      if (options.authorityWriteFailure) {
        if (options.applyAuthorityDespiteFailure) {
          currentAuthority = {
            ...currentAuthority,
            authorityRevision: currentAuthority.authorityRevision + 1,
            assignmentRegistry: clone(input.nextAssignmentRegistry)
          };
        }
        return {
          status: "failed",
          runtimeSessionId: currentAuthority.runtimeSessionId,
          authorityRevision: currentAuthority.authorityRevision,
          error: "write failed"
        };
      }
      currentAuthority = {
        ...currentAuthority,
        authorityRevision: currentAuthority.authorityRevision + 1,
        assignmentRegistry: clone(input.nextAssignmentRegistry)
      };
      return {
        status: "written",
        runtimeSessionId: currentAuthority.runtimeSessionId,
        authorityRevision: currentAuthority.authorityRevision,
        error: ""
      };
    },
    async writeWorkspacePlacement(input) {
      calls.push("writePlacement");
      if (options.placementWriteFailure) {
        if (options.applyPlacementDespiteFailure) {
          currentState = {
            ...currentState,
            workspaceRevision: input.nextWorkspaceRevision,
            placementMode: "dedicated_window",
            dedicatedWindowId: input.dedicatedWindowId,
            sourceWindowIds: [input.dedicatedWindowId],
            tabs: currentState.tabs.map((tab) => ({
              ...tab,
              sourceWindowId: input.dedicatedWindowId
            }))
          };
        }
        return { status: "failed", workspaceRevision: null, error: "write failed" };
      }
      currentState = {
        ...currentState,
        workspaceRevision: input.nextWorkspaceRevision,
        placementMode: "dedicated_window",
        dedicatedWindowId: input.dedicatedWindowId,
        sourceWindowIds: [input.dedicatedWindowId],
        tabs: currentState.tabs.map((tab) => ({
          ...tab,
          sourceWindowId: input.dedicatedWindowId
        }))
      };
      return {
        status: "written",
        workspaceRevision: currentState.workspaceRevision,
        error: ""
      };
    }
  };

  return {
    adapters,
    calls,
    getLedger: () => clone(ledger),
    getState: () => clone(currentState),
    getAuthority: () => clone(currentAuthority),
    setLedger: (next) => { ledger = clone(next); },
    setState: (next) => { currentState = clone(next); },
    setAuthority: (next) => { currentAuthority = clone(next); }
  };
}

function terminalKeys(result) {
  return Object.keys(result).sort();
}

test("clean 3 to 4 promotion creates dedicated placement and transfers assignment", async () => {
  const env = makeEnvironment();
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "committed");
  assert.equal(output.moveMode, "create_dedicated_window");
  assert.equal(output.targetWindowId, 20);
  assert.equal(output.assignmentTransferred, true);
  assert.equal(output.assignmentVerified, true);
  assert.equal(output.workspacePlacementWritten, true);
  assert.equal(output.workspacePlacementVerified, true);
  assert.equal(output.browserMutationVerified, true);
  assert.equal(env.getState().dedicatedWindowId, 20);
  const active = env.getAuthority().assignmentRegistry.assignments.find(
    (item) => item.state === "active"
  );
  assert.equal(active.runtimeAssignmentId, "assignment-2");
  assert.equal(active.windowId, 20);
});

test("attach 4 to 5 uses existing dedicated target and does not transfer assignment", async () => {
  const tabPlans = tabs([20, 20, 20, 30]);
  tabPlans.push({
    workspaceTabId: "wt-5",
    tabId: 105,
    sourceWindowId: 30,
    sourceGroupId: -1,
    role: "unassigned",
    roleLabel: "",
    order: 4
  });
  const env = makeEnvironment({
    state: state({
      workspaceRevision: 6,
      eligibleTabCount: 5,
      placementMode: "dedicated_window",
      dedicatedWindowId: 20,
      tabs: tabPlans,
      sourceWindowIds: [20, 30]
    }),
    authority: authority({
      assignmentRegistry: assignmentRegistry({
        assignment: { windowId: 20 }
      })
    })
  });
  const output = await coordinateAutomaticWorkspacePromotion(
    request({
      expectedWorkspaceRevision: 6,
      previousEligibleTabCount: 4,
      currentEligibleTabCount: 5
    }),
    env.adapters
  );
  assert.equal(output.status, "committed");
  assert.equal(output.moveMode, "attach_to_existing_dedicated_window");
  assert.equal(output.assignmentTransferred, false);
  assert.equal(output.targetWindowId, 20);
  assert.equal(env.calls.includes("writeAuthority"), false);
});

test("pending record is written before browser movement", async () => {
  const env = makeEnvironment();
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "committed");
  assert.ok(env.calls.indexOf("writeLedger") < env.calls.indexOf("move:create_dedicated_window"));
});

test("exact terminal replay performs no browser mutation", async () => {
  const env = makeEnvironment();
  const first = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(first.status, "committed");
  const before = env.calls.filter((item) => item.startsWith("move:")).length;
  const second = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(second.status, "replayed");
  assert.equal(env.calls.filter((item) => item.startsWith("move:")).length, before);
});

test("operation ID fingerprint conflict fails closed", async () => {
  const env = makeEnvironment();
  await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  const output = await coordinateAutomaticWorkspacePromotion(
    request({ sourceWindowId: 11 }),
    env.adapters
  );
  assert.equal(output.status, "conflict");
  assert.equal(output.reason, "operation_id_fingerprint_conflict");
});

test("unverified source context blocks a new promotion", async () => {
  const env = makeEnvironment({ sourceContextInvalid: true });
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "conflict");
  assert.equal(output.reason, "source_context_not_verified");
  assert.equal(env.calls.some((item) => item.startsWith("move:")), false);
});

test("missing workspace assignment blocks promotion", async () => {
  const env = makeEnvironment({
    authority: authority({
      assignmentRegistry: assignmentRegistry({
        assignments: [],
        nextEpoch: 1
      })
    })
  });
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "conflict");
  assert.equal(output.reason, "workspace_assignment_missing");
});

test("workspace revision change blocks stale trigger", async () => {
  const env = makeEnvironment({ state: state({ workspaceRevision: 6 }) });
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "conflict");
  assert.equal(output.reason, "workspace_revision_changed");
});

test("workspace tab count change blocks stale trigger", async () => {
  const tabPlans = tabs();
  tabPlans.push({
    workspaceTabId: "wt-5",
    tabId: 105,
    sourceWindowId: 10,
    sourceGroupId: -1,
    role: "unassigned",
    roleLabel: "",
    order: 4
  });
  const env = makeEnvironment({
    state: state({ tabs: tabPlans, eligibleTabCount: 5 })
  });
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "conflict");
  assert.equal(output.reason, "workspace_tab_count_changed");
});

test("canonical state below threshold returns recorded no_change", async () => {
  const tabPlans = tabs().slice(0, 3);
  const stateValue = state({
    tabs: tabPlans,
    groups: [
      {
        role: "docs",
        roleLabel: "Docs",
        workspaceTabIds: ["wt-1", "wt-2"],
        colour: "blue",
        collapsed: false
      },
      {
        role: "risk",
        roleLabel: "Risk",
        workspaceTabIds: ["wt-3"],
        colour: "red",
        collapsed: false
      }
    ],
    eligibleTabCount: 3
  });
  stateValue.groups = [
    {
      role: "docs",
      roleLabel: "Docs",
      workspaceTabIds: ["wt-1", "wt-2"],
      colour: "blue",
      collapsed: false
    },
    {
      role: "risk",
      roleLabel: "Risk",
      workspaceTabIds: ["wt-3"],
      colour: "red",
      collapsed: false
    }
  ];
  const env = makeEnvironment({ state: stateValue });
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "no_change");
  assert.equal(output.reason, "promotion_no_longer_required");
  assert.equal(env.calls.some((item) => item.startsWith("move:")), false);
});

test("browser move exception leaves a pending recoverable operation", async () => {
  const env = makeEnvironment({ moveThrows: true });
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "indeterminate");
  assert.equal(output.reason, "browser_move_result_unavailable");
  const entry = env.getLedger().entries[0];
  assert.equal(entry.result.schema, "constellation-workspace-automatic-promotion-pending-v0.1");
});

test("pending create recovers through attach when one new window is observed", async () => {
  const firstEnv = makeEnvironment({ moveThrows: true });
  await coordinateAutomaticWorkspacePromotion(request(), firstEnv.adapters);
  const pendingLedger = firstEnv.getLedger();

  const movedState = state({
    sourceWindowIds: [20],
    tabs: tabs([20, 20, 20, 20])
  });
  const env = makeEnvironment({
    ledger: pendingLedger,
    state: movedState
  });
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "committed");
  assert.equal(output.moveMode, "attach_to_existing_dedicated_window");
  assert.ok(env.calls.includes("move:attach_to_existing_dedicated_window"));
});

test("released source assignment is safely rebound after source-window cleanup", async () => {
  const firstEnv = makeEnvironment({ moveThrows: true });
  await coordinateAutomaticWorkspacePromotion(request(), firstEnv.adapters);
  const pendingLedger = firstEnv.getLedger();

  const released = assignmentRegistry();
  released.assignments[0].state = "released";
  released.assignments[0].updatedAt = NOW;
  const env = makeEnvironment({
    ledger: pendingLedger,
    state: state({
      sourceWindowIds: [20],
      tabs: tabs([20, 20, 20, 20])
    }),
    authority: authority({
      authorityRevision: 8,
      sourceContextVerified: false,
      assignmentRegistry: released
    })
  });
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "committed");
  assert.equal(output.assignmentTransferred, true);
  assert.ok(output.warnings.includes("source_assignment_released_before_transfer"));
});

test("multiple recovery targets remain indeterminate", async () => {
  const firstEnv = makeEnvironment({ moveThrows: true });
  await coordinateAutomaticWorkspacePromotion(request(), firstEnv.adapters);
  const env = makeEnvironment({
    ledger: firstEnv.getLedger(),
    state: state({
      sourceWindowIds: [20, 21],
      tabs: tabs([20, 20, 21, 21])
    })
  });
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "indeterminate");
  assert.equal(output.reason, "multiple_recovery_targets_observed");
  assert.equal(env.calls.some((item) => item.startsWith("move:")), false);
});

test("pending operation with unchanged source safely retries create mode", async () => {
  const firstEnv = makeEnvironment({ moveThrows: true });
  await coordinateAutomaticWorkspacePromotion(request(), firstEnv.adapters);
  const env = makeEnvironment({ ledger: firstEnv.getLedger() });
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "committed");
  assert.ok(env.calls.includes("move:create_dedicated_window"));
});

test("destination assignment conflict blocks runtime transfer", async () => {
  const registry = assignmentRegistry();
  registry.assignments.push({
    runtimeAssignmentId: "assignment-other",
    workspaceId: "workspace-other",
    windowId: 20,
    assignmentEpoch: 2,
    state: "active",
    createdAt: NOW,
    updatedAt: NOW,
    lastVerifiedAt: NOW,
    sourceContextId: "context-other"
  });
  registry.nextEpoch = 3;
  const env = makeEnvironment({
    authority: authority({ assignmentRegistry: registry })
  });
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "conflict");
  assert.equal(output.reason, "destination_window_assignment_conflict");
});

test("authority write failure that is proved by reread rolls forward", async () => {
  const env = makeEnvironment({
    authorityWriteFailure: true,
    applyAuthorityDespiteFailure: true
  });
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "committed");
  assert.ok(output.warnings.includes("runtime_assignment_verified_by_reread"));
});

test("placement write failure that is proved by reread rolls forward", async () => {
  const env = makeEnvironment({
    placementWriteFailure: true,
    applyPlacementDespiteFailure: true
  });
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "committed");
  assert.ok(output.warnings.includes("workspace_placement_verified_by_reread"));
});

test("already-correct dedicated placement returns no_change", async () => {
  const env = makeEnvironment({
    state: state({
      placementMode: "dedicated_window",
      dedicatedWindowId: 20,
      sourceWindowIds: [20],
      tabs: tabs([20, 20, 20, 20])
    }),
    authority: authority({
      assignmentRegistry: assignmentRegistry({
        assignment: { windowId: 20 }
      })
    }),
    moveResult: (moveRequest) => moveResult(moveRequest, {
      status: "no_change",
      reason: "already_verified",
      targetWindowId: 20,
      createdWindow: false,
      browserMutationStarted: false,
      browserMutationVerified: true,
      movedTabIds: [],
      alreadyInTargetTabIds: [101, 102, 103, 104]
    })
  });
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "no_change");
  assert.equal(output.assignmentTransferred, false);
  assert.equal(output.workspacePlacementWritten, false);
});

test("malformed move identity cannot become success", async () => {
  const env = makeEnvironment({
    moveResult: (moveRequest) => moveResult(moveRequest, {
      operationId: "wrong-operation"
    })
  });
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "indeterminate");
  assert.equal(output.reason, "browser_move_identity_mismatch");
});

test("malformed promotion state fails closed before movement", async () => {
  const malformed = state();
  malformed.extra = true;
  const env = makeEnvironment({ state: malformed });
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "failed");
  assert.equal(output.phase, "state_reread");
  assert.equal(env.calls.some((item) => item.startsWith("move:")), false);
});

test("malformed runtime authority fails closed", async () => {
  const malformed = authority();
  malformed.assignmentRegistry.nextEpoch = 1;
  const env = makeEnvironment({ authority: malformed });
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "failed");
  assert.equal(output.phase, "authority_validation");
});

test("pending ledger write failure occurs before browser mutation", async () => {
  const env = makeEnvironment({ ledgerWriteFailure: true });
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "failed");
  assert.equal(output.phase, "operation_recording");
  assert.equal(env.calls.some((item) => item.startsWith("move:")), false);
});

test("terminal ledger failure preserves verified authorities as indeterminate", async () => {
  let writeCount = 0;
  const env = makeEnvironment();
  const original = env.adapters.writeOperationLedger;
  env.adapters.writeOperationLedger = async (ledgerValue) => {
    writeCount += 1;
    if (writeCount === 1) return original(ledgerValue);
    return { status: "failed", error: "terminal write failed" };
  };
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "indeterminate");
  assert.equal(output.phase, "operation_recording");
  assert.equal(output.assignmentVerified, true);
  assert.equal(output.workspacePlacementVerified, true);
});

test("exclusive adapter must invoke callback exactly once", async () => {
  const skipped = makeEnvironment({ skipCallback: true });
  const skippedResult = await coordinateAutomaticWorkspacePromotion(request(), skipped.adapters);
  assert.equal(skippedResult.status, "failed");
  assert.equal(skippedResult.reason, "exclusive_callback_not_invoked");

  const doubled = makeEnvironment({ doubleCallback: true });
  const doubledResult = await coordinateAutomaticWorkspacePromotion(request(), doubled.adapters);
  assert.notEqual(doubledResult.status, "committed");
});

test("throwing request getter cannot escape", async () => {
  const hostile = request();
  Object.defineProperty(hostile, "workspaceId", {
    enumerable: true,
    get() {
      throw new Error("trap");
    }
  });
  const env = makeEnvironment();
  const output = await coordinateAutomaticWorkspacePromotion(hostile, env.adapters);
  assert.equal(output.status, "invalid");
});

test("stateful request fields are read once", async () => {
  const original = request();
  let reads = 0;
  Object.defineProperty(original, "workspaceId", {
    enumerable: true,
    get() {
      reads += 1;
      return reads === 1 ? "workspace-1" : "workspace-poison";
    }
  });
  const env = makeEnvironment();
  const output = await coordinateAutomaticWorkspacePromotion(original, env.adapters);
  assert.equal(output.status, "committed");
  assert.equal(reads, 1);
});

test("symbol-bearing and cyclic requests fail closed", async () => {
  const symbolRequest = request();
  symbolRequest[Symbol("bad")] = true;
  const env = makeEnvironment();
  assert.equal(
    (await coordinateAutomaticWorkspacePromotion(symbolRequest, env.adapters)).status,
    "invalid"
  );

  const cyclic = request();
  cyclic.self = cyclic;
  assert.equal(
    (await coordinateAutomaticWorkspacePromotion(cyclic, env.adapters)).status,
    "invalid"
  );
});

test("invalid adapter contract rejects before execution", async () => {
  const output = await coordinateAutomaticWorkspacePromotion(request(), {});
  assert.equal(output.status, "invalid");
  assert.equal(output.reason, "invalid_promotion_adapters");
});

test("request and adapter-owned values remain unmodified", async () => {
  const originalRequest = request();
  const requestBefore = clone(originalRequest);
  const stateValue = state();
  const stateBefore = clone(stateValue);
  const authorityValue = authority();
  const authorityBefore = clone(authorityValue);
  const env = makeEnvironment({
    state: stateValue,
    authority: authorityValue
  });
  await coordinateAutomaticWorkspacePromotion(originalRequest, env.adapters);
  assert.deepEqual(originalRequest, requestBefore);
  assert.deepEqual(stateValue, stateBefore);
  assert.deepEqual(authorityValue, authorityBefore);
});

test("all terminal outcomes use the exact stable result shape", async () => {
  const success = await coordinateAutomaticWorkspacePromotion(
    request(),
    makeEnvironment().adapters
  );
  const invalid = await coordinateAutomaticWorkspacePromotion(
    { schema: "wrong" },
    {}
  );
  const conflictResult = await coordinateAutomaticWorkspacePromotion(
    request(),
    makeEnvironment({ sourceContextInvalid: true }).adapters
  );
  const failed = await coordinateAutomaticWorkspacePromotion(
    request(),
    makeEnvironment({ ledgerReadFailure: true }).adapters
  );
  const indeterminateResult = await coordinateAutomaticWorkspacePromotion(
    request(),
    makeEnvironment({ moveThrows: true }).adapters
  );
  for (const output of [success, invalid, conflictResult, failed, indeterminateResult]) {
    assert.deepEqual(terminalKeys(output), [...RESULT_FIELDS].sort());
    assert.equal(validatePromotionResult(output), true);
  }
});

test("fingerprint excludes requestedAt but binds authority-relevant fields", async () => {
  const env = makeEnvironment();
  const first = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(first.status, "committed");
  const replay = await coordinateAutomaticWorkspacePromotion(
    request({ requestedAt: "2026-07-15T08:30:00.000Z" }),
    env.adapters
  );
  assert.equal(replay.status, "replayed");
  const conflictResult = await coordinateAutomaticWorkspacePromotion(
    request({
      operationId: "promotion-op-1",
      triggerOperationId: "different-trigger"
    }),
    env.adapters
  );
  assert.equal(conflictResult.status, "conflict");
});

test("result schema is stable and serializable", async () => {
  const output = await coordinateAutomaticWorkspacePromotion(
    request(),
    makeEnvironment().adapters
  );
  assert.equal(output.schema, PROMOTION_RESULT_SCHEMA);
  assert.doesNotThrow(() => JSON.stringify(output));
});


test("pending recovery refuses to widen scope when tab count changes", async () => {
  const firstEnv = makeEnvironment({ moveThrows: true });
  await coordinateAutomaticWorkspacePromotion(request(), firstEnv.adapters);
  const tabPlans = tabs();
  tabPlans.push({
    workspaceTabId: "wt-5",
    tabId: 105,
    sourceWindowId: 10,
    sourceGroupId: -1,
    role: "unassigned",
    roleLabel: "",
    order: 4
  });
  const env = makeEnvironment({
    ledger: firstEnv.getLedger(),
    state: state({ tabs: tabPlans, eligibleTabCount: 5 })
  });
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "conflict");
  assert.equal(output.reason, "pending_workspace_tab_count_changed");
  assert.equal(env.calls.some((item) => item.startsWith("move:")), false);
});

test("promotion-state getters are snapshotted once per adapter result", async () => {
  const env = makeEnvironment();
  const originalRead = env.adapters.readPromotionState;
  const readsPerResult = [];
  env.adapters.readPromotionState = async (...args) => {
    const value = await originalRead(...args);
    let reads = 0;
    readsPerResult.push(() => reads);
    Object.defineProperty(value, "workspaceId", {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? "workspace-1" : "workspace-poison";
      }
    });
    return value;
  };
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "committed");
  assert.ok(readsPerResult.length >= 2);
  assert.ok(readsPerResult.every((readCount) => readCount() === 1));
});

test("adapter property getters are read once", async () => {
  const env = makeEnvironment();
  const adapterObject = {};
  let reads = 0;
  for (const [key, value] of Object.entries(env.adapters)) {
    Object.defineProperty(adapterObject, key, {
      enumerable: true,
      get() {
        reads += 1;
        return value;
      }
    });
  }
  const output = await coordinateAutomaticWorkspacePromotion(request(), adapterObject);
  assert.equal(output.status, "committed");
  assert.equal(reads, 8);
});

test("authority write failure without proof remains indeterminate", async () => {
  const env = makeEnvironment({ authorityWriteFailure: true });
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "indeterminate");
  assert.equal(output.assignmentVerified, false);
  assert.equal(output.browserMutationVerified, true);
});

test("placement write failure without proof remains indeterminate", async () => {
  const env = makeEnvironment({ placementWriteFailure: true });
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "indeterminate");
  assert.equal(output.workspacePlacementVerified, false);
  assert.equal(output.assignmentVerified, true);
});

test("move success claim without verified browser mutation is rejected", async () => {
  const env = makeEnvironment({
    moveResult: (moveRequest) => moveResult(moveRequest, {
      browserMutationVerified: false
    })
  });
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "indeterminate");
  assert.equal(output.reason, "browser_move_result_invalid");
});

test("move success claim with a failed required verification check is rejected", async () => {
  const verification = REQUIRED_MOVE_VERIFICATION_CHECK_IDS.map((id) => ({
    id,
    passed: id !== "no_unrelated_tab_moved"
  }));
  const env = makeEnvironment({
    moveResult: (moveRequest) => moveResult(moveRequest, { verification })
  });
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "indeterminate");
  assert.equal(output.reason, "browser_move_result_invalid");
  assert.equal(output.browserMutationVerified, false);
});

test("stored replayed result without original terminal verification is rejected", async () => {
  const first = makeEnvironment();
  await coordinateAutomaticWorkspacePromotion(request(), first.adapters);
  const ledger = first.getLedger();
  ledger.entries[0].result = {
    ...ledger.entries[0].result,
    status: "replayed",
    reason: "forged_replay",
    decision: "retry_transaction",
    replayed: true,
    browserMutationVerified: false,
    assignmentVerified: false,
    workspacePlacementVerified: false
  };
  const env = makeEnvironment({ ledger });
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(validatePromotionResult(ledger.entries[0].result), false);
  assert.equal(output.status, "conflict");
  assert.equal(output.reason, "operation_replay_result_invalid");
  assert.equal(env.calls.some((item) => item.startsWith("move:")), false);
});

test("pending operation whose tab count falls below threshold fails with exact scope conflict", async () => {
  const first = makeEnvironment({ moveThrows: true });
  await coordinateAutomaticWorkspacePromotion(request(), first.adapters);
  const tabPlans = tabs().slice(0, 3);
  const reducedState = state({
    tabs: tabPlans,
    groups: [
      {
        role: "docs",
        roleLabel: "Docs",
        workspaceTabIds: ["wt-1", "wt-2"],
        colour: "blue",
        collapsed: false
      },
      {
        role: "risk",
        roleLabel: "Risk",
        workspaceTabIds: ["wt-3"],
        colour: "red",
        collapsed: false
      }
    ],
    eligibleTabCount: 3
  });
  reducedState.groups = [
    {
      role: "docs",
      roleLabel: "Docs",
      workspaceTabIds: ["wt-1", "wt-2"],
      colour: "blue",
      collapsed: false
    },
    {
      role: "risk",
      roleLabel: "Risk",
      workspaceTabIds: ["wt-3"],
      colour: "red",
      collapsed: false
    }
  ];
  const env = makeEnvironment({
    ledger: first.getLedger(),
    state: reducedState
  });
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "conflict");
  assert.equal(output.reason, "pending_workspace_tab_count_changed");
  assert.equal(output.phase, "state_reread");
  assert.equal(output.assignmentVerified, false);
  assert.equal(output.workspacePlacementVerified, false);
  assert.equal(env.calls.some((item) => item.startsWith("move:")), false);
  assert.equal(env.getLedger().entries[0].result.schema, "constellation-workspace-automatic-promotion-pending-v0.1");
});

test("below-threshold no_change reports assignment verification from actual authority", async () => {
  const tabPlans = tabs().slice(0, 3);
  const reducedState = state({
    tabs: tabPlans,
    groups: [
      {
        role: "docs",
        roleLabel: "Docs",
        workspaceTabIds: ["wt-1", "wt-2"],
        colour: "blue",
        collapsed: false
      },
      {
        role: "risk",
        roleLabel: "Risk",
        workspaceTabIds: ["wt-3"],
        colour: "red",
        collapsed: false
      }
    ],
    eligibleTabCount: 3
  });
  reducedState.groups = [
    {
      role: "docs",
      roleLabel: "Docs",
      workspaceTabIds: ["wt-1", "wt-2"],
      colour: "blue",
      collapsed: false
    },
    {
      role: "risk",
      roleLabel: "Risk",
      workspaceTabIds: ["wt-3"],
      colour: "red",
      collapsed: false
    }
  ];
  const missingAssignment = authority({
    assignmentRegistry: {
      schema: "constellation-runtime-assignment-registry-v0.1",
      nextEpoch: 1,
      assignments: []
    }
  });
  const env = makeEnvironment({
    state: reducedState,
    authority: missingAssignment
  });
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "no_change");
  assert.equal(output.reason, "promotion_no_longer_required");
  assert.equal(output.assignmentVerified, false);
  assert.equal(output.workspacePlacementVerified, true);
  assert.equal(validatePromotionResult(output), true);
});

test("pending record rejects duplicate or unbound baseline window identities", async () => {
  const first = makeEnvironment({ moveThrows: true });
  await coordinateAutomaticWorkspacePromotion(request(), first.adapters);
  const duplicateLedger = first.getLedger();
  duplicateLedger.entries[0].result.baselineSourceWindowIds = [10, 10];
  let env = makeEnvironment({ ledger: duplicateLedger });
  let output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "conflict");
  assert.equal(output.reason, "operation_replay_result_invalid");

  const attachState = state({
    placementMode: "dedicated_window",
    dedicatedWindowId: 10
  });
  const attachRequest = request({
    operationId: "promotion-op-attach",
    triggerOperationId: "membership-op-attach",
    previousEligibleTabCount: 4,
    currentEligibleTabCount: 5
  });
  const tabPlans = tabs();
  tabPlans.push({
    workspaceTabId: "wt-5",
    tabId: 105,
    sourceWindowId: 11,
    sourceGroupId: -1,
    role: "unassigned",
    roleLabel: "",
    order: 4
  });
  attachState.tabs = tabPlans;
  attachState.eligibleTabCount = 5;
  attachState.sourceWindowIds = [10, 11];
  const attachFirst = makeEnvironment({ state: attachState, moveThrows: true });
  await coordinateAutomaticWorkspacePromotion(attachRequest, attachFirst.adapters);
  const unboundLedger = attachFirst.getLedger();
  unboundLedger.entries[0].result.targetWindowId = 99;
  env = makeEnvironment({ ledger: unboundLedger, state: attachState });
  output = await coordinateAutomaticWorkspacePromotion(attachRequest, env.adapters);
  assert.equal(output.status, "conflict");
  assert.equal(output.reason, "operation_replay_result_invalid");
});

test("below-threshold terminal ledger write failure rolls forward when reread proves the record", async () => {
  const tabPlans = tabs().slice(0, 3);
  const reducedState = state({
    tabs: tabPlans,
    groups: [
      {
        role: "docs",
        roleLabel: "Docs",
        workspaceTabIds: ["wt-1", "wt-2"],
        colour: "blue",
        collapsed: false
      },
      {
        role: "risk",
        roleLabel: "Risk",
        workspaceTabIds: ["wt-3"],
        colour: "red",
        collapsed: false
      }
    ],
    eligibleTabCount: 3
  });
  reducedState.groups = [
    {
      role: "docs",
      roleLabel: "Docs",
      workspaceTabIds: ["wt-1", "wt-2"],
      colour: "blue",
      collapsed: false
    },
    {
      role: "risk",
      roleLabel: "Risk",
      workspaceTabIds: ["wt-3"],
      colour: "red",
      collapsed: false
    }
  ];
  const env = makeEnvironment({ state: reducedState });
  const original = env.adapters.writeOperationLedger;
  env.adapters.writeOperationLedger = async (ledgerValue) => {
    await original(ledgerValue);
    return { status: "failed", error: "reported failure after apply" };
  };
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "no_change");
  assert.equal(output.reason, "promotion_no_longer_required");
  assert.equal(output.assignmentVerified, true);
  assert.equal(output.nextRuntimeAssignmentId, "assignment-1");
  assert.equal(output.nextAssignmentEpoch, 1);
});

test("malformed ledger entry fails closed", async () => {
  const malformed = emptyLedger();
  malformed.entries.push({
    operationId: "promotion-op-1",
    requestFingerprint: "x",
    result: {},
    recordedAt: NOW,
    sequence: 1,
    extra: true
  });
  malformed.nextSequence = 2;
  const env = makeEnvironment({ ledger: malformed });
  const output = await coordinateAutomaticWorkspacePromotion(request(), env.adapters);
  assert.equal(output.status, "failed");
  assert.equal(output.phase, "operation_inspection");
});


async function withPurityFixture(files, action) {
  const directory = await mkdtemp(join(tmpdir(), "constellation-promotion-purity-"));
  try {
    for (const [name, source] of Object.entries(files)) {
      await writeFile(join(directory, name), source, "utf8");
    }
    await action(pathToFileURL(directory + "/"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("purity checker accepts the automatic promotion kernel", async () => {
  assert.equal(await checkWorkspaceAutomaticPromotionTransactionPurity(), 3);
});

for (const [name, source] of [
  ["browser global", "export function bad() { return chrome.tabs; }\n"],
  ["new Date", "export function bad() { return new Date(); }\n"],
  ["crypto", "export function bad() { return crypto.randomUUID(); }\n"],
  ["timer", "export function bad() { return setTimeout(() => {}, 1); }\n"],
  ["process", "export function bad() { return process.cwd(); }\n"],
  ["console", "export function bad() { console.log('x'); }\n"],
  ["dynamic import", "export async function bad() { return import('./x.js'); }\n"],
  ["import meta", "export const bad = import.meta.url;\n"],
  ["traversal import", "import x from '../../outside.js'; export { x };\n"],
  ["template literal", "export const bad = `x`;\n"]
]) {
  test("purity checker rejects " + name, async () => {
    await withPurityFixture(
      {
        "contract.js": source,
        "fingerprint.js": "export const ok = true;\n",
        "coordinator.js": "export const ok = true;\n"
      },
      async (url) => {
        await assert.rejects(
          checkWorkspaceAutomaticPromotionTransactionPurity(url)
        );
      }
    );
  });
}

test("purity checker rejects unexpected artifacts", async () => {
  await withPurityFixture(
    {
      "contract.js": "export const ok = true;\n",
      "fingerprint.js": "export const ok = true;\n",
      "coordinator.js": "export const ok = true;\n",
      "extra.js": "export const bad = true;\n"
    },
    async (url) => {
      await assert.rejects(
        checkWorkspaceAutomaticPromotionTransactionPurity(url)
      );
    }
  );
});


test("pending retry preserves the original transaction timestamp", async () => {
  const firstEnv = makeEnvironment({ moveThrows: true });
  await coordinateAutomaticWorkspacePromotion(request(), firstEnv.adapters);
  const env = makeEnvironment({ ledger: firstEnv.getLedger() });
  const output = await coordinateAutomaticWorkspacePromotion(
    request({ requestedAt: "2026-07-15T09:00:00.000Z" }),
    env.adapters
  );
  assert.equal(output.status, "committed");
  const active = env.getAuthority().assignmentRegistry.assignments.find(
    (assignment) => assignment.state === "active"
  );
  assert.equal(active.createdAt, NOW);
});
