import { readCompatibleStorageValue, stableStringify, writeCompatibleStorageValue } from "../constellation-storage-compatibility.js";
import { appendDiagnosticEvent } from "../diagnostic-event-store.js";
import { OPERATION_LEDGER_KEY } from "../journal-append-coordination/chrome-adapter.js";
import { validateOperationLedger } from "../journal-append-coordination/ledger-validation.js";
import { resolveAssignmentByWorkspace, validateAssignmentRegistry } from "../runtime-contract/assignments.js";
import { LOCK_NAMES } from "../runtime-contract/constants.js";
import { createOperationLedger } from "../runtime-contract/ledger.js";
import { normalizeWorkspaceRevision } from "../runtime-contract/revision.js";
import { nonEmptyString, validDateTime } from "../runtime-contract/value-utils.js";
import {
  RUNTIME_SESSION_AUTHORITY_KEY,
  rootsEqual,
  validateActiveContext,
  validateSessionAuthority
} from "../runtime-session-authority/contract.js";
import {
  PROMOTION_STATE_SCHEMA,
  snapshotAndValidatePromotionState,
  snapshotSerializable
} from "../workspace-automatic-promotion-transaction/contract.js";
import { moveExistingWorkspaceTabs } from "../workspace-existing-tab-move-engine/coordinator.js";
import { DEFAULT_WORKSPACE_TYPE, getWorkspaceRoleLabel } from "../workspace-role-sets.js";

export function createAutomaticPromotionChromeAdapters(chromeApi, dependencyInput = {}) {
  const dependencies = createDependencies(chromeApi, dependencyInput);
  let exclusiveOperationDepth = 0;
  let lastLedgerRead = null;
  const promotionStateEvidence = new Map();

  return {
    async runExclusiveOperation(callback) {
      if (typeof callback !== "function") throw new TypeError("exclusive callback is required");
      return dependencies.requestLock(LOCK_NAMES.exclusiveOperation, async () => {
        if (exclusiveOperationDepth !== 0) throw new Error("exclusive operation re-entry is not allowed");
        exclusiveOperationDepth += 1;
        try { return await callback(); }
        finally { exclusiveOperationDepth -= 1; }
      });
    },

    async readOperationLedger() {
      const read = await readLedger(dependencies);
      if (!read.valid) return { status: "failed", ledger: null, error: read.error };
      lastLedgerRead = read;
      return { status: "present", ledger: read.ledger, error: "" };
    },

    async writeOperationLedger(nextLedgerInput) {
      if (exclusiveOperationDepth !== 1) return writeResult("failed", "exclusive_operation_not_held");
      const nextSnapshot = snapshotValidLedger(nextLedgerInput);
      if (!nextSnapshot.valid) return writeResult("failed", "operation_ledger_malformed");
      if (!lastLedgerRead) return writeResult("failed", "operation_ledger_expected_state_missing");

      return dependencies.requestLock(LOCK_NAMES.runtimeState, async () => {
        const current = await readLedger(dependencies);
        if (!current.valid) return writeResult("failed", current.error);
        if (!ledgerReadsEqual(current, lastLedgerRead)) return writeResult("conflict", "operation_ledger_changed");

        let writeFailed = false;
        try { await dependencies.writeLedger(nextSnapshot.ledger); }
        catch { writeFailed = true; }

        const verified = await readLedger(dependencies);
        if (verified.valid && stableStringify(verified.ledger) === stableStringify(nextSnapshot.ledger)) {
          lastLedgerRead = verified;
          return writeResult("written", "");
        }
        return writeResult("failed", writeFailed ? "operation_ledger_write_failed" : "operation_ledger_verification_failed");
      });
    },

    async readPromotionState({ workspaceId }) {
      try {
        const collected = await collectPromotionState(workspaceId, dependencies);
        if (collected.state.status === "present") promotionStateEvidence.set(workspaceId, collected.evidence);
        return collected.state;
      } catch {
        return nonPresentPromotionState("failed", "promotion_state_read_failed");
      }
    },

    async readRuntimeAuthority(request) {
      try {
        const root = await dependencies.readAuthority();
        const rootSnapshot = snapshotSerializable(root);
        if (!rootSnapshot.ok || !validateSessionAuthority(rootSnapshot.value).valid) {
          return failedRuntimeAuthority("runtime_authority_malformed");
        }
        const authority = rootSnapshot.value;
        let sourceContextVerified = false;
        if (request.requireSourceContext === true) {
          const context = validateActiveContext(authority, request.sourceContextId, request.sourceWindowId);
          const assignment = resolveAssignmentByWorkspace(authority.assignmentRegistry, request.workspaceId);
          const sourceWindow = await dependencies.getWindow(request.sourceWindowId);
          sourceContextVerified = context.valid === true &&
            sourceWindow?.id === request.sourceWindowId &&
            assignment?.workspaceId === request.workspaceId &&
            assignment?.windowId === request.sourceWindowId &&
            assignment?.state === "active";
        }
        return {
          status: "present",
          runtimeSessionId: authority.runtimeSessionId,
          authorityRevision: authority.authorityRevision,
          sourceContextVerified,
          assignmentRegistry: authority.assignmentRegistry,
          error: ""
        };
      } catch {
        return failedRuntimeAuthority("runtime_authority_read_failed");
      }
    },

    async executeExistingTabMove(moveRequest) {
      const result = await moveExistingWorkspaceTabs(moveRequest, createExistingTabMoveChromeAdapters(chromeApi));
      const snapshot = snapshotSerializable(result);
      if (!snapshot.ok) throw new Error("move result is not serializable");
      return snapshot.value;
    },

    async writeRuntimeAuthority(input) {
      if (exclusiveOperationDepth !== 1) {
        return authorityWriteResult("failed", input?.expectedRuntimeSessionId, input?.expectedAuthorityRevision, "exclusive_operation_not_held");
      }
      const inputSnapshot = snapshotSerializable(input);
      if (!inputSnapshot.ok || !validateAssignmentRegistry(inputSnapshot.value?.nextAssignmentRegistry).valid) {
        return authorityWriteResult("failed", input?.expectedRuntimeSessionId, input?.expectedAuthorityRevision, "runtime_authority_write_request_invalid");
      }
      const expected = inputSnapshot.value;
      return dependencies.requestLock(LOCK_NAMES.runtimeState, async () => {
        let root;
        try { root = await dependencies.readAuthority(); }
        catch { return authorityWriteResult("failed", expected.expectedRuntimeSessionId, expected.expectedAuthorityRevision, "runtime_authority_read_failed"); }
        const rootSnapshot = snapshotSerializable(root);
        if (!rootSnapshot.ok || !validateSessionAuthority(rootSnapshot.value).valid) {
          return authorityWriteResult("failed", expected.expectedRuntimeSessionId, expected.expectedAuthorityRevision, "runtime_authority_malformed");
        }
        const current = rootSnapshot.value;
        if (
          current.runtimeSessionId !== expected.expectedRuntimeSessionId ||
          current.authorityRevision !== expected.expectedAuthorityRevision
        ) {
          return authorityWriteResult("conflict", current.runtimeSessionId, current.authorityRevision, "runtime_authority_changed");
        }
        const next = {
          ...current,
          assignmentRegistry: expected.nextAssignmentRegistry,
          authorityRevision: current.authorityRevision + 1
        };
        if (!validateSessionAuthority(next).valid) {
          return authorityWriteResult("failed", current.runtimeSessionId, current.authorityRevision, "runtime_authority_next_root_invalid");
        }
        let writeFailed = false;
        try { await dependencies.writeAuthority(next); }
        catch { writeFailed = true; }
        let fresh;
        try { fresh = await dependencies.readAuthority(); }
        catch { return authorityWriteResult("failed", current.runtimeSessionId, current.authorityRevision, "runtime_authority_verification_read_failed"); }
        if (validateSessionAuthority(fresh).valid && rootsEqual(next, fresh)) {
          return authorityWriteResult("written", next.runtimeSessionId, next.authorityRevision, "");
        }
        return authorityWriteResult("failed", current.runtimeSessionId, current.authorityRevision, writeFailed ? "runtime_authority_write_failed" : "runtime_authority_verification_failed");
      });
    },

    async writeWorkspacePlacement(input) {
      if (exclusiveOperationDepth !== 1) return placementWriteResult("failed", null, "exclusive_operation_not_held");
      const inputSnapshot = snapshotSerializable(input);
      if (!inputSnapshot.ok || !validPlacementWriteRequest(inputSnapshot.value)) {
        return placementWriteResult("failed", null, "workspace_placement_write_request_invalid");
      }
      const request = inputSnapshot.value;
      return dependencies.requestLock(LOCK_NAMES.runtimeState, async () => {
        let compatibleRead;
        try { compatibleRead = await dependencies.readCompatibleWorkspace(); }
        catch { return placementWriteResult("failed", null, "workspace_read_failed"); }
        const workspaceRead = snapshotCompatibleWorkspace(compatibleRead);
        if (!workspaceRead.valid) return placementWriteResult(workspaceRead.conflict ? "conflict" : "failed", workspaceRead.revision, workspaceRead.error);
        const workspace = workspaceRead.workspace;
        if (workspace.workspaceId !== request.workspaceId) return placementWriteResult("conflict", workspaceRead.revision, "workspace_identity_changed");
        if (workspaceRead.revision !== request.expectedWorkspaceRevision) return placementWriteResult("conflict", workspaceRead.revision, "workspace_revision_changed");

        const priorEvidence = promotionStateEvidence.get(request.workspaceId);
        if (!priorEvidence) return placementWriteResult("conflict", workspaceRead.revision, "workspace_membership_changed");

        let projection;
        try { projection = await dependencies.readBrowserProjection(); }
        catch { return placementWriteResult("failed", workspaceRead.revision, "browser_projection_read_failed"); }
        const freshConstruction = constructPromotionState(workspaceRead, projection);
        if (!freshConstruction.evidence) {
          return placementWriteResult("conflict", workspaceRead.revision, "workspace_or_browser_semantic_plan_changed");
        }
        if (stableStringify(freshConstruction.evidence.workspaceTabIds) !== stableStringify(priorEvidence.workspaceTabIds)) {
          return placementWriteResult("conflict", workspaceRead.revision, "workspace_membership_changed");
        }
        if (stableStringify(freshConstruction.evidence.semanticPlan) !== stableStringify(priorEvidence.semanticPlan)) {
          return placementWriteResult("conflict", workspaceRead.revision, "workspace_or_browser_semantic_plan_changed");
        }
        const placementCheck = validatePersistedPlacementForWrite(workspace, request.dedicatedWindowId);
        if (!placementCheck.valid) return placementWriteResult("conflict", workspaceRead.revision, placementCheck.error);

        const browserTabs = projection.windows.flatMap((browserWindow) => browserWindow.tabs);
        const browserTabById = new Map(browserTabs.map((tab) => [tab.id, tab]));
        const representedIds = sortedUnique([
          ...request.moveResult.movedTabIds,
          ...request.moveResult.alreadyInTargetTabIds
        ]);
        const eligibleIds = sortedUnique(freshConstruction.evidence.eligibleTabIds);
        if (stableStringify(representedIds) !== stableStringify(eligibleIds)) {
          return placementWriteResult("conflict", workspaceRead.revision, "workspace_move_scope_changed");
        }
        if (eligibleIds.some((tabId) => browserTabById.get(tabId)?.windowId !== request.dedicatedWindowId)) {
          return placementWriteResult("failed", workspaceRead.revision, "workspace_tabs_not_verified_in_target");
        }
        const timelineUpdate = prepareTimelineEvidence(workspace, request);
        if (!timelineUpdate.valid) return placementWriteResult("conflict", workspaceRead.revision, timelineUpdate.error);

        const next = {
          ...workspace,
          placementMode: "dedicated_window",
          dedicatedWindowId: request.dedicatedWindowId,
          workspaceRevision: request.nextWorkspaceRevision,
          tabs: workspace.tabs.map((tab) => {
            const live = browserTabById.get(tab.tabId);
            if (!live || !representedIds.includes(tab.tabId)) return tab;
            return {
              ...tab,
              tabId: live.id,
              windowId: request.dedicatedWindowId,
              groupId: live.groupId,
              index: live.index,
              isOpen: true,
              lastMatchStatus: "exact_tab_id"
            };
          })
        };
        if (timelineUpdate.timeline !== null) next.timeline = timelineUpdate.timeline;
        const nextSnapshot = snapshotSerializable(next);
        if (!nextSnapshot.ok) return placementWriteResult("failed", workspaceRead.revision, "workspace_placement_not_serializable");

        let writeFailed = false;
        try { await dependencies.writeCompatibleWorkspace(nextSnapshot.value); }
        catch { writeFailed = true; }
        let verifiedRead;
        try { verifiedRead = await dependencies.readCompatibleWorkspace(); }
        catch { return placementWriteResult("failed", workspaceRead.revision, "workspace_placement_verification_read_failed"); }
        if (completeCompatibleWorkspaceEquals(verifiedRead, nextSnapshot.value)) {
          return placementWriteResult("written", request.nextWorkspaceRevision, "");
        }
        return placementWriteResult("failed", workspaceRead.revision, writeFailed ? "workspace_placement_write_failed" : "workspace_placement_verification_failed");
      });
    }
  };
}

export function createExistingTabMoveChromeAdapters(chromeApi) {
  return {
    readBrowserProjection: () => readBrowserProjection(chromeApi),
    async createWindowFromTab(tabId) {
      const created = await chromeApi.windows.create({ tabId, focused: true, state: "normal" });
      return { id: created.id };
    },
    async moveTabs(tabIds, windowId) {
      await chromeApi.tabs.move(tabIds, { windowId, index: -1 });
      return { tabIds: [...tabIds], windowId };
    },
    async groupTabs(tabIds, windowId) {
      const groupId = await chromeApi.tabs.group({ tabIds, createProperties: { windowId } });
      return { groupId, tabIds: [...tabIds], windowId };
    },
    async updateGroup(groupId, properties) {
      const update = { title: properties.title };
      if (properties.colour !== undefined) update.color = properties.colour;
      if (properties.collapsed !== undefined) update.collapsed = properties.collapsed;
      await chromeApi.tabGroups.update(groupId, update);
      return { groupId };
    },
    async focusWindow(windowId) {
      await chromeApi.windows.update(windowId, { state: "normal" });
      await chromeApi.windows.update(windowId, { focused: true });
      return { windowId };
    }
  };
}

export async function recordAutomaticPromotionDiagnostic(result, dependencyInput = {}) {
  if (result?.replayed === true) return { recorded: false, reason: "replay_not_duplicated" };
  const appendDiagnostic = dependencyInput.appendDiagnostic || appendDiagnosticEvent;
  const details = {};
  for (const field of [
    "operationId", "triggerOperationId", "workspaceId", "sourceContextId", "sourceWindowId",
    "targetWindowId", "status", "reason", "phase", "moveMode", "moveStatus",
    "browserMutationStarted", "browserMutationVerified", "assignmentTransferred",
    "assignmentVerified", "workspacePlacementWritten", "workspacePlacementVerified", "replayed",
    "retrySafe", "indeterminate", "authorityRevisionBefore", "authorityRevisionAfter",
    "workspaceRevisionBefore", "workspaceRevisionAfter", "warnings", "errors"
  ]) details[field] = result?.[field] ?? null;
  await appendDiagnostic(
    ["committed", "no_change"].includes(result?.status) ? "info" : result?.status === "conflict" ? "warn" : "error",
    "workspace_automatic_promotion_completed",
    "Automatic workspace promotion route completed.",
    details
  );
  return { recorded: true, reason: "" };
}

async function collectPromotionState(workspaceId, dependencies) {
  const compatibleRead = await dependencies.readCompatibleWorkspace();
  if (!compatibleRead?.canonicalPresent && !compatibleRead?.legacyPresent) {
    return { state: nonPresentPromotionState("absent", ""), evidence: null };
  }
  const workspaceRead = snapshotCompatibleWorkspace(compatibleRead);
  if (!workspaceRead.valid) {
    return { state: nonPresentPromotionState("failed", workspaceRead.error), evidence: null };
  }
  const workspace = workspaceRead.workspace;
  if (workspace.workspaceId !== workspaceId) {
    return { state: nonPresentPromotionState("absent", ""), evidence: null };
  }
  const projection = await dependencies.readBrowserProjection();
  return constructPromotionState(workspaceRead, projection);
}

function constructPromotionState(workspaceRead, projection) {
  const workspace = workspaceRead.workspace;
  const semantics = normalizeWorkspaceSemantics(workspace);
  if (!semantics.valid) {
    return { state: nonPresentPromotionState("failed", semantics.error), evidence: null };
  }
  const browserTabs = projection.windows.flatMap((browserWindow) => browserWindow.tabs);
  const browserTabById = new Map(browserTabs.map((tab) => [tab.id, tab]));
  const browserGroupById = new Map(projection.windows.flatMap((browserWindow) => browserWindow.groups).map((group) => [group.id, group]));
  const workspaceTabIds = workspace.tabs.map((tab) => tab.workspaceTabId);
  if (workspaceTabIds.some((id) => !nonEmptyString(id)) || new Set(workspaceTabIds).size !== workspaceTabIds.length) {
    return { state: nonPresentPromotionState("failed", "workspace_tab_identity_invalid"), evidence: null };
  }
  const representedTabIds = workspace.tabs.map((tab) => tab.tabId).filter(Number.isSafeInteger);
  if (new Set(representedTabIds).size !== representedTabIds.length) {
    return { state: nonPresentPromotionState("failed", "workspace_tab_projection_duplicate"), evidence: null };
  }

  const tabs = [];
  for (let index = 0; index < workspace.tabs.length; index += 1) {
    const workspaceTab = workspace.tabs[index];
    const semanticTab = semantics.tabs[index];
    if (semanticTab.tabId === null) continue;
    const live = browserTabById.get(semanticTab.tabId);
    if (!live) continue;
    const role = semanticTab.role;
    const semanticRoleLabel = role === "unassigned"
      ? "Unassigned"
      : createChromeGroupTitle(semantics.workspaceName, getWorkspaceRoleLabel(semantics.workspaceType, role));
    tabs.push({
      workspaceTabId: workspaceTab.workspaceTabId,
      tabId: live.id,
      sourceWindowId: live.windowId,
      sourceGroupId: live.groupId,
      role,
      roleLabel: semanticRoleLabel,
      order: tabs.length
    });
  }

  const groups = [];
  const assignedRoles = [...new Set(tabs.filter((tab) => tab.role !== "unassigned").map((tab) => tab.role))].sort(compareText);
  for (const role of assignedRoles) {
    const members = tabs.filter((tab) => tab.role === role);
    const plan = {
      role,
      roleLabel: members[0].roleLabel,
      workspaceTabIds: members.map((tab) => tab.workspaceTabId),
      collapsed: false
    };
    const groupIds = [...new Set(members.map((tab) => tab.sourceGroupId).filter((id) => id >= 0))];
    if (groupIds.length === 1 && members.every((tab) => tab.sourceGroupId === groupIds[0])) {
      const represented = browserGroupById.get(groupIds[0]);
      if (represented) {
        plan.colour = represented.colour;
        plan.collapsed = represented.collapsed;
      }
    }
    groups.push(plan);
  }

  const representedGroupIds = sortedUnique(tabs.map((tab) => tab.sourceGroupId).filter((groupId) => groupId >= 0));
  const representedGroups = representedGroupIds.map((groupId) => {
    const represented = browserGroupById.get(groupId);
    return represented
      ? {
          groupId,
          windowId: represented.windowId,
          title: represented.title,
          tabIds: sortedUnique(represented.tabIds),
          colour: represented.colour,
          collapsed: represented.collapsed
        }
      : {
          groupId,
          windowId: null,
          title: null,
          tabIds: [],
          colour: null,
          collapsed: null
        };
  });
  const semanticPlan = {
    workspaceName: semantics.workspaceName,
    workspaceType: semantics.workspaceType,
    tabs: tabs.map((tab) => ({ ...tab })),
    plannedGroups: groups.map((group) => ({
      ...group,
      workspaceTabIds: [...group.workspaceTabIds]
    })),
    representedGroups,
    unassignedTabs: tabs
      .filter((tab) => tab.role === "unassigned")
      .map((tab) => ({
        workspaceTabId: tab.workspaceTabId,
        tabId: tab.tabId,
        sourceWindowId: tab.sourceWindowId,
        sourceGroupId: tab.sourceGroupId,
        ungrouped: tab.sourceGroupId === -1
      }))
  };
  const evidenceSnapshot = snapshotSerializable({
    workspaceTabIds,
    eligibleTabIds: tabs.map((tab) => tab.tabId),
    semanticPlan
  });
  if (!evidenceSnapshot.ok) {
    return { state: nonPresentPromotionState("failed", "promotion_state_semantic_evidence_malformed"), evidence: null };
  }
  const evidence = evidenceSnapshot.value;
  const placement = interpretPlacement(workspace, projection, tabs);
  if (!placement.valid) return { state: nonPresentPromotionState("failed", placement.error), evidence };
  const state = {
    schema: PROMOTION_STATE_SCHEMA,
    status: "present",
    workspaceId: workspace.workspaceId,
    workspaceRevision: workspaceRead.revision,
    eligibleTabCount: tabs.length,
    placementMode: placement.mode,
    dedicatedWindowId: placement.dedicatedWindowId,
    sourceWindowIds: sortedUnique(tabs.map((tab) => tab.sourceWindowId)),
    tabs,
    groups,
    error: ""
  };
  const validation = snapshotAndValidatePromotionState(state);
  if (!validation.ok) return { state: nonPresentPromotionState("failed", validation.reason), evidence };
  return {
    state: validation.value,
    evidence
  };
}

function normalizeWorkspaceSemantics(workspace) {
  if (Object.hasOwn(workspace, "name") && typeof workspace.name !== "string") {
    return { valid: false, error: "workspace_semantic_state_malformed" };
  }
  if (Object.hasOwn(workspace, "workspaceType") && typeof workspace.workspaceType !== "string") {
    return { valid: false, error: "workspace_semantic_state_malformed" };
  }

  const workspaceName = Object.hasOwn(workspace, "name") ? workspace.name.trim() : "";
  const workspaceType = !Object.hasOwn(workspace, "workspaceType") || workspace.workspaceType.length === 0
    ? DEFAULT_WORKSPACE_TYPE
    : workspace.workspaceType;
  const tabs = [];
  for (const workspaceTab of workspace.tabs) {
    if (!workspaceTab || typeof workspaceTab !== "object" || Array.isArray(workspaceTab)) {
      return { valid: false, error: "workspace_semantic_state_malformed" };
    }
    if (Object.hasOwn(workspaceTab, "role") && typeof workspaceTab.role !== "string") {
      return { valid: false, error: "workspace_semantic_state_malformed" };
    }
    if (
      Object.hasOwn(workspaceTab, "tabId") &&
      workspaceTab.tabId !== null &&
      (!Number.isSafeInteger(workspaceTab.tabId) || workspaceTab.tabId < 0)
    ) {
      return { valid: false, error: "workspace_semantic_state_malformed" };
    }
    tabs.push({
      role: !Object.hasOwn(workspaceTab, "role") || workspaceTab.role.trim().length === 0
        ? "unassigned"
        : workspaceTab.role,
      tabId: !Object.hasOwn(workspaceTab, "tabId") || workspaceTab.tabId === null
        ? null
        : workspaceTab.tabId
    });
  }
  return { valid: true, error: "", workspaceName, workspaceType, tabs };
}

function interpretPlacement(workspace, projection, tabs) {
  const hasMode = Object.hasOwn(workspace, "placementMode");
  const hasTarget = Object.hasOwn(workspace, "dedicatedWindowId") && workspace.dedicatedWindowId !== null;
  if (!hasMode && !hasTarget) return { valid: true, mode: "current_window", dedicatedWindowId: null };
  if (workspace.placementMode === "current_window" && !hasTarget) {
    return { valid: true, mode: "current_window", dedicatedWindowId: null };
  }
  if (workspace.placementMode !== "dedicated_window" || !Number.isSafeInteger(workspace.dedicatedWindowId) || workspace.dedicatedWindowId < 0) {
    return { valid: false, error: "workspace_placement_invalid" };
  }
  const targetExists = projection.windows.some((browserWindow) => browserWindow.id === workspace.dedicatedWindowId);
  const represented = tabs.length === 0 || tabs.some((tab) => tab.sourceWindowId === workspace.dedicatedWindowId);
  return targetExists && represented
    ? { valid: true, mode: "dedicated_window", dedicatedWindowId: workspace.dedicatedWindowId }
    : { valid: false, error: "dedicated_placement_browser_evidence_conflict" };
}

function snapshotCompatibleWorkspace(read) {
  if (!read || read.conflict === true) return { valid: false, conflict: true, revision: null, error: "workspace_compatibility_conflict" };
  if (!read.canonicalPresent || !read.legacyPresent || !read.equivalent) {
    return { valid: false, conflict: true, revision: null, error: "compatible_workspace_peer_missing" };
  }
  const snapshot = snapshotSerializable(read.value);
  if (!snapshot.ok || !nonEmptyString(snapshot.value?.workspaceId) || !Array.isArray(snapshot.value?.tabs)) {
    return { valid: false, conflict: false, revision: null, error: "workspace_state_malformed" };
  }
  const revision = normalizeWorkspaceRevision(snapshot.value);
  if (!revision.valid) return { valid: false, conflict: false, revision: null, error: "workspace_revision_invalid" };
  return { valid: true, workspace: snapshot.value, revision: revision.revision };
}

function completeCompatibleWorkspaceEquals(read, expected) {
  return Boolean(
    read?.canonicalPresent && read?.legacyPresent && read?.equivalent && !read?.conflict &&
    stableStringify(read.value) === stableStringify(expected) &&
    stableStringify(read.canonicalValue) === stableStringify(expected) &&
    stableStringify(read.legacyValue) === stableStringify(expected)
  );
}

async function readBrowserProjection(chromeApi) {
  const [browserWindows, browserGroups] = await Promise.all([
    chromeApi.windows.getAll({ populate: true }),
    chromeApi.tabGroups.query({})
  ]);
  if (!Array.isArray(browserWindows) || !Array.isArray(browserGroups)) throw new Error("browser projection is malformed");
  return {
    windows: browserWindows.map((browserWindow) => ({
      id: browserWindow.id,
      focused: Boolean(browserWindow.focused),
      tabs: (Array.isArray(browserWindow.tabs) ? browserWindow.tabs : []).map((tab) => ({
        id: tab.id,
        windowId: tab.windowId,
        index: tab.index,
        groupId: Number.isInteger(tab.groupId) ? tab.groupId : -1,
        url: typeof tab.url === "string" ? tab.url : "",
        title: typeof tab.title === "string" ? tab.title : ""
      })),
      groups: browserGroups
        .filter((group) => group.windowId === browserWindow.id)
        .map((group) => ({
          id: group.id,
          windowId: group.windowId,
          title: typeof group.title === "string" ? group.title : "",
          colour: typeof group.color === "string" ? group.color : "grey",
          collapsed: Boolean(group.collapsed),
          tabIds: (Array.isArray(browserWindow.tabs) ? browserWindow.tabs : [])
            .filter((tab) => tab.groupId === group.id)
            .map((tab) => tab.id)
        }))
    }))
  };
}

function createDependencies(chromeApi, input) {
  return {
    requestLock: input.requestLock || ((name, callback) => {
      if (!globalThis.navigator?.locks?.request) throw new Error("Web Locks unavailable");
      return globalThis.navigator.locks.request(name, callback);
    }),
    readLedger: input.readLedger || (async () => {
      const result = await chromeApi.storage.session.get(OPERATION_LEDGER_KEY);
      return Object.hasOwn(result, OPERATION_LEDGER_KEY)
        ? { present: true, value: result[OPERATION_LEDGER_KEY] }
        : { present: false, value: undefined };
    }),
    writeLedger: input.writeLedger || ((ledger) => chromeApi.storage.session.set({ [OPERATION_LEDGER_KEY]: ledger })),
    readCompatibleWorkspace: input.readCompatibleWorkspace || (() => readCompatibleStorageValue("activeWorkspace")),
    writeCompatibleWorkspace: input.writeCompatibleWorkspace || ((workspace) => writeCompatibleStorageValue("activeWorkspace", workspace)),
    readAuthority: input.readAuthority || (async () => {
      const result = await chromeApi.storage.session.get(RUNTIME_SESSION_AUTHORITY_KEY);
      return Object.hasOwn(result, RUNTIME_SESSION_AUTHORITY_KEY) ? result[RUNTIME_SESSION_AUTHORITY_KEY] : undefined;
    }),
    writeAuthority: input.writeAuthority || ((authority) => chromeApi.storage.session.set({ [RUNTIME_SESSION_AUTHORITY_KEY]: authority })),
    getWindow: input.getWindow || ((windowId) => chromeApi.windows.get(windowId)),
    readBrowserProjection: input.readBrowserProjection || (() => readBrowserProjection(chromeApi))
  };
}

async function readLedger(dependencies) {
  let raw;
  try { raw = await dependencies.readLedger(); }
  catch { return { valid: false, error: "operation_ledger_read_failed" } };
  if (!raw?.present) return { valid: true, present: false, ledger: createOperationLedger() };
  const snapshot = snapshotValidLedger(raw.value);
  return snapshot.valid
    ? { valid: true, present: true, ledger: snapshot.ledger }
    : { valid: false, error: "operation_ledger_malformed" };
}

function snapshotValidLedger(value) {
  const snapshot = snapshotSerializable(value);
  if (!snapshot.ok) return { valid: false };
  const validation = validateOperationLedger(snapshot.value);
  return validation.valid ? { valid: true, ledger: snapshot.value } : { valid: false };
}

function ledgerReadsEqual(left, right) {
  return left.present === right.present && stableStringify(left.ledger) === stableStringify(right.ledger);
}

function validPlacementWriteRequest(value) {
  return nonEmptyString(value?.workspaceId) &&
    Number.isSafeInteger(value.expectedWorkspaceRevision) && value.expectedWorkspaceRevision >= 0 &&
    value.nextWorkspaceRevision === value.expectedWorkspaceRevision + 1 &&
    value.placementMode === "dedicated_window" &&
    Number.isSafeInteger(value.dedicatedWindowId) && value.dedicatedWindowId >= 0 &&
    value.moveResult && typeof value.moveResult === "object" &&
    Array.isArray(value.moveResult.movedTabIds) && Array.isArray(value.moveResult.alreadyInTargetTabIds) &&
    (!Object.hasOwn(value, "timelineEvent") || validManualPlacementTimelineEvent(value.timelineEvent, value));
}

function prepareTimelineEvidence(workspace, request) {
  if (!Object.hasOwn(request, "timelineEvent")) return { valid: true, timeline: null, error: "" };
  if (!Array.isArray(workspace.timeline)) return { valid: false, timeline: null, error: "workspace_timeline_state_invalid" };
  const matches = workspace.timeline.filter((event) => event?.eventId === request.timelineEvent.eventId);
  if (matches.length > 1) return { valid: false, timeline: null, error: "manual_placement_timeline_evidence_conflict" };
  if (matches.length === 1) {
    return stableStringify(matches[0]) === stableStringify(request.timelineEvent)
      ? { valid: true, timeline: [...workspace.timeline], error: "" }
      : { valid: false, timeline: null, error: "manual_placement_timeline_evidence_conflict" };
  }
  return { valid: true, timeline: [...workspace.timeline, request.timelineEvent], error: "" };
}

function validManualPlacementTimelineEvent(value, request) {
  const fields = [
    "eventId", "type", "message", "createdAt", "evidenceOwner", "manualPlacementOperationId",
    "moveOperationId", "transferOperationId", "workspaceId", "sourceContextId", "sourceWindowId",
    "targetWindowId", "currentRuntimeAssignmentId", "currentAssignmentEpoch", "browserMutationVerified",
    "assignmentVerified", "resolutionMode", "newWindowCreationMode"
  ];
  return value && typeof value === "object" && !Array.isArray(value) &&
    stableStringify(Object.keys(value).sort()) === stableStringify([...fields].sort()) &&
    nonEmptyString(value.manualPlacementOperationId) && value.eventId === value.manualPlacementOperationId + ":manual-placement-committed" &&
    value.type === "workspace_tabs_moved_to_new_window" && nonEmptyString(value.message) && validDateTime(value.createdAt) &&
    value.evidenceOwner === "service_worker_manual_placement_transaction" && nonEmptyString(value.moveOperationId) &&
    nonEmptyString(value.transferOperationId) && value.workspaceId === request.workspaceId && nonEmptyString(value.sourceContextId) &&
    Number.isSafeInteger(value.sourceWindowId) && value.sourceWindowId >= 0 && Number.isSafeInteger(value.targetWindowId) &&
    value.targetWindowId === request.dedicatedWindowId && value.targetWindowId !== value.sourceWindowId && nonEmptyString(value.currentRuntimeAssignmentId) &&
    Number.isSafeInteger(value.currentAssignmentEpoch) && value.currentAssignmentEpoch > 0 && value.browserMutationVerified === true &&
    value.assignmentVerified === true && value.resolutionMode === "stable_one_to_one" &&
    value.newWindowCreationMode === "manual_placement_transaction_v0.1";
}

function validatePersistedPlacementForWrite(workspace, targetWindowId) {
  const hasMode = Object.hasOwn(workspace, "placementMode");
  const hasTarget = Object.hasOwn(workspace, "dedicatedWindowId") && workspace.dedicatedWindowId !== null;
  if (!hasMode && !hasTarget) return { valid: true, error: "" };
  if (workspace.placementMode === "current_window" && !hasTarget) return { valid: true, error: "" };
  if (
    workspace.placementMode === "dedicated_window" &&
    Number.isSafeInteger(workspace.dedicatedWindowId) &&
    workspace.dedicatedWindowId >= 0
  ) {
    return workspace.dedicatedWindowId === targetWindowId
      ? { valid: true, error: "" }
      : { valid: false, error: "dedicated_target_conflict" };
  }
  return { valid: false, error: "workspace_placement_invalid" };
}

function nonPresentPromotionState(status, error) {
  return {
    schema: PROMOTION_STATE_SCHEMA,
    status,
    workspaceId: "",
    workspaceRevision: null,
    eligibleTabCount: null,
    placementMode: null,
    dedicatedWindowId: null,
    sourceWindowIds: [],
    tabs: [],
    groups: [],
    error
  };
}

function failedRuntimeAuthority(error) {
  return {
    status: "failed",
    runtimeSessionId: "",
    authorityRevision: null,
    sourceContextVerified: false,
    assignmentRegistry: null,
    error
  };
}

function writeResult(status, error) { return { status, error }; }
function placementWriteResult(status, workspaceRevision, error) { return { status, workspaceRevision, error }; }
function authorityWriteResult(status, runtimeSessionId, authorityRevision, error) {
  return {
    status,
    runtimeSessionId: nonEmptyString(runtimeSessionId) ? runtimeSessionId : "unknown-runtime-session",
    authorityRevision: Number.isSafeInteger(authorityRevision) && authorityRevision >= 0 ? authorityRevision : 0,
    error
  };
}
function sortedUnique(values) { return [...new Set(values)].sort((left, right) => left - right); }
function compareText(left, right) { return left < right ? -1 : left > right ? 1 : 0; }

function createChromeGroupTitle(workspaceName, roleLabel) {
  const rawName = workspaceName.trim();
  const words = rawName.split(/\s+/).filter(Boolean);
  const initials = words.map((word) => word.replace(/[^a-zA-Z0-9]/g, "")).filter(Boolean).map((word) => word[0]).join("").toUpperCase();
  const compactName = rawName.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const token = initials ? initials.slice(0, 4) : compactName ? compactName.slice(0, 4) : "CF";
  const suffix = " · " + token;
  const role = roleLabel || "Unassigned";
  const available = 32 - suffix.length;
  if (available <= 3) return (role + suffix).slice(0, 29) + "...";
  return (role.length <= available ? role : role.slice(0, available - 3) + "...") + suffix;
}
