import {
  PROMOTION_REQUEST_SCHEMA,
  PROMOTION_STATE_SCHEMA,
  REQUIRED_MOVE_VERIFICATION_CHECK_IDS
} from "../src/core/workspace-automatic-promotion-transaction/contract.js";
import {
  coordinateAutomaticWorkspacePromotion
} from "../src/core/workspace-automatic-promotion-transaction/coordinator.js";

const NOW = "2026-07-15T08:00:00.000Z";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createRequest(overrides = {}) {
  return {
    schema: PROMOTION_REQUEST_SCHEMA,
    operationId: "validation-promotion-op",
    triggerOperationId: "validation-membership-op",
    triggerKind: "workspace_membership_increased",
    workspaceId: "validation-workspace",
    sourceContextId: "validation-context",
    sourceWindowId: 10,
    expectedWorkspaceRevision: 5,
    previousEligibleTabCount: 3,
    currentEligibleTabCount: 4,
    threshold: 4,
    nextRuntimeAssignmentId: "validation-assignment-next",
    requestedAt: NOW,
    ...overrides
  };
}

function createTabs(windowIds) {
  return windowIds.map((windowId, index) => ({
    workspaceTabId: "workspace-tab-" + String(index + 1),
    tabId: 101 + index,
    sourceWindowId: windowId,
    sourceGroupId: -1,
    role: index < 2 ? "docs" : index === 2 ? "risk" : "unassigned",
    roleLabel: index < 2 ? "Docs" : index === 2 ? "Risk" : "",
    order: index
  }));
}

function createGroups() {
  return [
    {
      role: "docs",
      roleLabel: "Docs",
      workspaceTabIds: ["workspace-tab-1", "workspace-tab-2"],
      colour: "blue",
      collapsed: false
    },
    {
      role: "risk",
      roleLabel: "Risk",
      workspaceTabIds: ["workspace-tab-3"],
      colour: "red",
      collapsed: false
    }
  ];
}

function createState(windowIds, overrides = {}) {
  return {
    schema: PROMOTION_STATE_SCHEMA,
    status: "present",
    workspaceId: "validation-workspace",
    workspaceRevision: 5,
    eligibleTabCount: windowIds.length,
    placementMode: "current_window",
    dedicatedWindowId: null,
    sourceWindowIds: [...new Set(windowIds)].sort((left, right) => left - right),
    tabs: createTabs(windowIds),
    groups: createGroups(),
    error: "",
    ...overrides
  };
}

function createRegistry(windowId = 10) {
  return {
    schema: "constellation-runtime-assignment-registry-v0.1",
    nextEpoch: 2,
    assignments: [
      {
        runtimeAssignmentId: "validation-assignment-current",
        workspaceId: "validation-workspace",
        windowId,
        assignmentEpoch: 1,
        state: "active",
        createdAt: NOW,
        updatedAt: NOW,
        lastVerifiedAt: NOW,
        sourceContextId: "validation-context"
      }
    ]
  };
}

function createEnvironment({
  state = createState([10, 10, 10, 10]),
  authorityRevision = 7,
  registry = createRegistry(),
  moveThrows = false,
  ledger = null,
  targetWindowId = 20
} = {}) {
  let currentState = clone(state);
  let currentAuthority = {
    status: "present",
    runtimeSessionId: "validation-session",
    authorityRevision,
    sourceContextVerified: true,
    assignmentRegistry: clone(registry),
    error: ""
  };
  let operationLedger = clone(
    ledger || {
      schema: "constellation-runtime-operation-ledger-v0.1",
      maxEntries: 100,
      nextSequence: 1,
      entries: []
    }
  );
  let moveCount = 0;

  const adapters = {
    runExclusiveOperation: async (callback) => callback(),
    readOperationLedger: async () => ({
      status: "present",
      ledger: clone(operationLedger),
      error: ""
    }),
    writeOperationLedger: async (next) => {
      operationLedger = clone(next);
      return { status: "written", error: "" };
    },
    readPromotionState: async () => clone(currentState),
    readRuntimeAuthority: async () => clone(currentAuthority),
    executeExistingTabMove: async (moveRequest) => {
      moveCount += 1;
      if (moveThrows) throw new Error("simulated interruption");
      const target = moveRequest.targetWindowId ?? targetWindowId;
      currentState = {
        ...currentState,
        sourceWindowIds: [target],
        tabs: currentState.tabs.map((tab) => ({
          ...tab,
          sourceWindowId: target,
          sourceGroupId: -1
        }))
      };
      return {
        schema: "constellation-workspace-existing-tab-move-result-v0.1",
        status: moveRequest.mode === "attach_to_existing_dedicated_window" &&
          moveRequest.tabs.every((tab) => tab.sourceWindowId === target)
          ? "no_change"
          : "completed_verified",
        reason: "final_projection_verified",
        operationId: moveRequest.operationId,
        workspaceId: moveRequest.workspaceId,
        mode: moveRequest.mode,
        targetWindowId: target,
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
        errors: []
      };
    },
    writeRuntimeAuthority: async (input) => {
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
    writeWorkspacePlacement: async (input) => {
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
    getLedger: () => clone(operationLedger),
    getMoveCount: () => moveCount
  };
}

const createEnvironmentResult = createEnvironment();
const createResult = await coordinateAutomaticWorkspacePromotion(
  createRequest(),
  createEnvironmentResult.adapters
);

const attachState = createState(
  [20, 20, 20, 30],
  {
    workspaceRevision: 6,
    placementMode: "dedicated_window",
    dedicatedWindowId: 20
  }
);
attachState.tabs.push({
  workspaceTabId: "workspace-tab-5",
  tabId: 105,
  sourceWindowId: 30,
  sourceGroupId: -1,
  role: "unassigned",
  roleLabel: "",
  order: 4
});
attachState.eligibleTabCount = 5;
attachState.sourceWindowIds = [20, 30];

const attachRegistry = createRegistry(20);
const attachEnvironment = createEnvironment({
  state: attachState,
  registry: attachRegistry,
  targetWindowId: 20
});
const attachResult = await coordinateAutomaticWorkspacePromotion(
  createRequest({
    operationId: "validation-attach-op",
    triggerOperationId: "validation-attach-membership-op",
    expectedWorkspaceRevision: 6,
    previousEligibleTabCount: 4,
    currentEligibleTabCount: 5,
    nextRuntimeAssignmentId: "unused-attach-assignment"
  }),
  attachEnvironment.adapters
);

const interruptedEnvironment = createEnvironment({ moveThrows: true });
const interruptedResult = await coordinateAutomaticWorkspacePromotion(
  createRequest({ operationId: "validation-recovery-op" }),
  interruptedEnvironment.adapters
);
const pendingLedger = interruptedEnvironment.getLedger();

const recoveryEnvironment = createEnvironment({
  ledger: pendingLedger,
  state: createState([20, 20, 20, 20])
});
const recoveryResult = await coordinateAutomaticWorkspacePromotion(
  createRequest({ operationId: "validation-recovery-op" }),
  recoveryEnvironment.adapters
);

const replayMoveCountBefore = createEnvironmentResult.getMoveCount();
const replayResult = await coordinateAutomaticWorkspacePromotion(
  createRequest(),
  createEnvironmentResult.adapters
);
const replayMoveCountAfter = createEnvironmentResult.getMoveCount();

const output = {
  schema: "constellation-workspace-automatic-promotion-validation-v0.1",
  create: {
    status: createResult.status,
    moveMode: createResult.moveMode,
    targetWindowId: createResult.targetWindowId,
    assignmentTransferred: createResult.assignmentTransferred,
    placementVerified: createResult.workspacePlacementVerified
  },
  attach: {
    status: attachResult.status,
    moveMode: attachResult.moveMode,
    assignmentTransferred: attachResult.assignmentTransferred,
    targetWindowId: attachResult.targetWindowId
  },
  interruption: {
    status: interruptedResult.status,
    pendingRecorded: pendingLedger.entries[0]?.result?.schema ===
      "constellation-workspace-automatic-promotion-pending-v0.1"
  },
  recovery: {
    status: recoveryResult.status,
    moveMode: recoveryResult.moveMode,
    assignmentTransferred: recoveryResult.assignmentTransferred
  },
  replay: {
    status: replayResult.status,
    additionalMoveCount: replayMoveCountAfter - replayMoveCountBefore
  }
};

if (
  output.create.status !== "committed" ||
  output.create.moveMode !== "create_dedicated_window" ||
  output.create.assignmentTransferred !== true ||
  output.create.placementVerified !== true ||
  output.attach.status !== "committed" ||
  output.attach.moveMode !== "attach_to_existing_dedicated_window" ||
  output.attach.assignmentTransferred !== false ||
  output.interruption.status !== "indeterminate" ||
  output.interruption.pendingRecorded !== true ||
  output.recovery.status !== "committed" ||
  output.recovery.moveMode !== "attach_to_existing_dedicated_window" ||
  output.replay.status !== "replayed" ||
  output.replay.additionalMoveCount !== 0
) {
  throw new Error("automatic promotion validation failed");
}

console.log(JSON.stringify(output));
