import { createOperationLedger } from "../src/core/runtime-contract/ledger.js";
import { MEMBERSHIP_REQUEST_SCHEMA } from "../src/core/workspace-membership-mutation/contract.js";
import { coordinateWorkspaceMembershipMutation } from "../src/core/workspace-membership-mutation/coordinator.js";

const requestedAt = "2026-07-16T08:00:00.000Z";
const request = {
  schema: MEMBERSHIP_REQUEST_SCHEMA,
  operationId: "validation-membership-op",
  mutationKind: "active_tab",
  workspaceId: "validation-workspace",
  sourceContextId: "validation-context",
  sourceWindowId: 10,
  expectedWorkspaceRevision: 5,
  requestedAt,
  workspaceTabsToAdd: [{
    workspaceTabId: "validation-workspace-tab-4",
    tabId: 104,
    windowId: 10,
    groupId: -1,
    url: "https://example.com/4",
    role: "unassigned"
  }],
  promotionOperationId: "validation-promotion-op",
  nextRuntimeAssignmentId: "validation-next-assignment"
};
let workspace = {
  workspaceId: "validation-workspace",
  workspaceRevision: 5,
  name: "Validation Workspace",
  updatedAt: "2026-07-16T07:00:00.000Z",
  tabs: [1, 2, 3].map((index) => ({
    workspaceTabId: "validation-workspace-tab-" + index,
    tabId: 100 + index,
    windowId: 10,
    groupId: -1,
    url: "https://example.com/" + index,
    role: "unassigned"
  })),
  journal: [],
  timeline: [],
  unknownValidationField: { preserved: true }
};
let ledger = createOperationLedger();
let workspaceWrites = 0;

const adapters = {
  withRuntimeStateLock: async (_name, callback) => callback(),
  readCompatibleWorkspace: async () => ({
    canonicalPresent: true,
    legacyPresent: true,
    canonicalValue: structuredClone(workspace),
    legacyValue: structuredClone(workspace),
    equivalent: true,
    conflict: false,
    value: structuredClone(workspace)
  }),
  writeCompatibleWorkspace: async (next) => { workspaceWrites += 1; workspace = structuredClone(next); },
  readOperationLedger: async () => ({ status: "present", ledger: structuredClone(ledger), error: "" }),
  writeOperationLedger: async (next) => { ledger = structuredClone(next); return { status: "written", error: "" }; },
  readRuntimeAuthority: async () => ({ status: "present", contextVerified: true, error: "" }),
  readBrowserProjection: async () => ({ status: "present", tabIds: [101, 102, 103, 104], error: "" })
};

const committed = await coordinateWorkspaceMembershipMutation(request, adapters);
const replayed = await coordinateWorkspaceMembershipMutation(request, adapters);
const output = {
  schema: "constellation-workspace-membership-mutation-validation-v0.1",
  committedStatus: committed.status,
  replayStatus: replayed.status,
  revisionBefore: committed.receipt?.workspaceRevisionBefore,
  revisionAfter: committed.receipt?.workspaceRevisionAfter,
  previousEligibleTabCount: committed.receipt?.previousEligibleTabCount,
  currentEligibleTabCount: committed.receipt?.currentEligibleTabCount,
  compatiblePeersVerified: committed.receipt?.compatiblePeersVerified,
  unknownFieldPreserved: workspace.unknownValidationField?.preserved === true,
  workspaceWrites
};

if (
  output.committedStatus !== "committed" ||
  output.replayStatus !== "replayed" ||
  output.revisionBefore !== 5 ||
  output.revisionAfter !== 6 ||
  output.previousEligibleTabCount !== 3 ||
  output.currentEligibleTabCount !== 4 ||
  output.compatiblePeersVerified !== true ||
  output.unknownFieldPreserved !== true ||
  output.workspaceWrites !== 1
) throw new Error("workspace membership mutation validation failed");

console.log(JSON.stringify(output));
