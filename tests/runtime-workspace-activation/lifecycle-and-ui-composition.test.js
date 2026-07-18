import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createSidePanelRuntimeWorkspaceAuthority } from "../../src/core/runtime-workspace-activation/side-panel-runtime.js";
import {
  isVerifiedWorkspaceReplacementForCandidate,
  prepareResumeWorkspaceForActivation,
  stabilizeOpenedTabProjection
} from "../../src/core/workspace-resume-transaction-engine.js";
import { workspaceProjectionReconciliationHeld } from "../../src/core/automatic-workspace-projection-reconciler.js";
import {
  PROJECTION_RECONCILIATION_HOLD_KEY,
  PROJECTION_RECONCILIATION_HOLD_SCHEMA,
  snapshotAndValidateProjectionReconciliationHold
} from "../../src/core/workspace-projection-reconciliation/contract.js";
import { createWorkspaceMembershipPromotionSequencer } from "../../src/sidepanel/workspace-membership-promotion-sequencer.js";

const ROOT = new URL("../../", import.meta.url);

test("side-panel barrier orders context registration then compatible read then bootstrap", async () => {
  const order = [];
  const authority = createSidePanelRuntimeWorkspaceAuthority({
    contextClient: { register: async () => { order.push("context"); return contextResult(); } },
    readCompatibleWorkspace: async () => { order.push("workspace"); return compatibleRead(); },
    activationClient: { bootstrapExisting: async (input) => { order.push("activation"); return activationResult(input); } },
    dispatchCommit: () => order.push("commit_event")
  });
  const state = await authority.bootstrapExisting();
  assert.equal(state.status, "active");
  assert.deepEqual(order, ["context", "workspace", "activation", "commit_event"]);
  assert.equal(authority.verifiedEvidence.currentRuntimeAssignmentId, "assignment-1");
});

test("resume replacement reuses verified pre-mutation authority and does not bootstrap after the destination exists", async () => {
  let contextRegistrations = 0;
  let workspaceReads = 0;
  let bootstrapCalls = 0;
  const replacements = [];
  const authority = createSidePanelRuntimeWorkspaceAuthority({
    contextClient: { register: async () => { contextRegistrations += 1; return contextResult(); } },
    readCompatibleWorkspace: async () => { workspaceReads += 1; return compatibleRead(); },
    activationClient: {
      bootstrapExisting: async (input) => { bootstrapCalls += 1; return activationResult(input); },
      replaceActive: async (input) => {
        replacements.push(structuredClone(input));
        return replacementResult(input);
      }
    }
  });
  const baseline = await authority.bootstrapExisting();
  const candidate = { workspaceId: "workspace-1", workspaceRevision: 3, tabs: [{ workspaceTabId: "tab-1" }] };
  const replacement = await authority.replaceActiveFromVerifiedEvidence(candidate, 20, baseline.result);
  assert.equal(replacement.status, "read_only");
  assert.equal(contextRegistrations, 1);
  assert.equal(workspaceReads, 1);
  assert.equal(bootstrapCalls, 1);
  assert.equal(replacements.length, 1);
  assert.deepEqual(replacements[0], {
    sourceContextId: "context-1",
    sourceWindowId: 10,
    expectedWorkspaceId: "workspace-1",
    expectedWorkspaceRevision: 2,
    candidateWorkspace: candidate,
    targetWindowId: 20,
    expectedRuntimeAssignmentId: "assignment-1",
    expectedAssignmentEpoch: 1
  });
});

test("rollback recovery discards the local replacement retry and re-establishes the surviving source owner", async () => {
  let bootstrapCalls = 0;
  let replacementCalls = 0;
  const authority = createSidePanelRuntimeWorkspaceAuthority({
    contextClient: { register: async () => contextResult() },
    readCompatibleWorkspace: async () => compatibleRead(),
    activationClient: {
      bootstrapExisting: async (input) => { bootstrapCalls += 1; return activationResult(input); },
      replaceActive: async (input) => {
        replacementCalls += 1;
        return {
          ...replacementResult(input),
          status: "conflict",
          reason: "injected_replacement_conflict",
          workspaceVerified: false,
          assignmentVerified: false,
          readOnly: true
        };
      }
    }
  });
  const baseline = await authority.bootstrapExisting();
  const candidate = { workspaceId: "workspace-1", workspaceRevision: 3, tabs: [] };
  const failed = await authority.replaceActiveFromVerifiedEvidence(candidate, 20, baseline.result);
  assert.equal(failed.status, "read_only");
  const recovered = await authority.recoverActiveAfterRollback(compatibleRead().value, baseline.result);
  assert.equal(recovered.status, "active");
  assert.equal(bootstrapCalls, 2);
  assert.equal(replacementCalls, 1);
});

test("assignment in another live window makes requesting panel read-only without transfer", async () => {
  let transfers = 0;
  const authority = createSidePanelRuntimeWorkspaceAuthority({
    contextClient: { register: async () => contextResult() },
    readCompatibleWorkspace: async () => compatibleRead(),
    activationClient: {
      bootstrapExisting: async (input) => activationResult(input, { targetWindowId: 20 }),
      transferActive: async () => { transfers += 1; }
    }
  });
  const state = await authority.bootstrapExisting();
  assert.equal(state.status, "read_only");
  assert.equal(authority.verifiedEvidence, null);
  assert.equal(transfers, 0);
});

test("compatible peer conflict blocks activation before the worker request", async () => {
  let activations = 0;
  const authority = createSidePanelRuntimeWorkspaceAuthority({
    contextClient: { register: async () => contextResult() },
    readCompatibleWorkspace: async () => ({ ...compatibleRead(), conflict: true, equivalent: false }),
    activationClient: { bootstrapExisting: async () => { activations += 1; } }
  });
  const state = await authority.bootstrapExisting();
  assert.equal(state.status, "blocked");
  assert.equal(state.reason, "workspace_compatibility_conflict");
  assert.equal(activations, 0);
});

test("activation failure blocks membership delivery", async () => {
  let membershipSends = 0;
  const sequencer = createWorkspaceMembershipPromotionSequencer({
    createId: () => "unused-id",
    now: () => "2026-07-17T10:00:00.000Z",
    sendMembership: async () => { membershipSends += 1; },
    sendPromotion: async () => undefined,
    activateWorkspace: async () => ({ status: "blocked", reason: "activation_not_verified", result: null }),
    runMetadataBarrier: async (operation) => operation()
  });
  const result = await sequencer.sequenceWorkspaceMembershipPromotion({ mutationKind: "active_tab", workspaceId: "workspace-1", workspace: { workspaceId: "workspace-1", workspaceRevision: 1, tabs: [] }, workspaceTabsToAdd: [] });
  assert.equal(result.status, "activation_not_verified");
  assert.equal(membershipSends, 0);
});

test("lifecycle paths use replacement activation and contain no direct runtime success bypass", async () => {
  const archive = await source("src/sidepanel/workspace-archive-close-ownership-controller.js");
  const resume = await source("src/core/workspace-resume-transaction-engine.js");
  const restore = await source("src/sidepanel/workspace-archive-restore-control.js");
  const product = await source("src/sidepanel/workspace-library-product-surface.js");
  assert.match(archive, /runtimeWorkspaceAuthority\.replaceActive\(freshWorkspace/);
  assert.doesNotMatch(archive, /saveWorkspace\(freshWorkspace\)/);
  assert.match(resume, /runtimeWorkspaceAuthority\.replaceActiveFromVerifiedEvidence\(/);
  assert.doesNotMatch(resume, /runtimeWorkspaceAuthority\.replaceActive\(hydratedWorkspace/);
  assert.doesNotMatch(resume, /saveActiveWorkspaceRuntime\(hydratedWorkspace\)/);
  assert.match(restore, /runtimeWorkspaceAuthority\.replaceActive\(restoredWorkspace/);
  assert.doesNotMatch(restore, /chrome\.storage\.local\.set\(\{\s*\[WORKSPACE_KEY\]/);
  assert.match(product, /resumeWorkspaceMemoryRecordSafely/);
  assert.doesNotMatch(product, /hydrateWorkspaceMemoryRecordToRuntime/);
});

test("resume rollback suppression requires exact candidate-workspace proof", async () => {
  const sourceText = await source("src/core/workspace-resume-transaction-engine.js");
  const candidate = { workspaceId: "workspace-resumed", workspaceRevision: 4, tabs: [] };
  assert.equal(isVerifiedWorkspaceReplacementForCandidate({ workspaceVerified: true, activeWorkspaceId: "workspace-old", activeWorkspaceRevision: 2 }, candidate), false);
  assert.equal(isVerifiedWorkspaceReplacementForCandidate({ workspaceVerified: true, activeWorkspaceId: "workspace-resumed", activeWorkspaceRevision: 4 }, candidate), true);
  assert.match(sourceText, /context\.workspaceReplacementVerified\s*=\s*isVerifiedWorkspaceReplacementForCandidate/);
  assert.match(sourceText, /if \(context\.workspaceReplacementVerified\)/);
  assert.match(sourceText, /rollbackResumeOperation\(context\)/);
  assert.ok(sourceText.indexOf("if (context.workspaceReplacementVerified)") < sourceText.indexOf("rollbackResumeOperation(context)"));
});


test("same-workspace resume uses verified active state and advances its revision exactly once", () => {
  const active = {
    workspaceId: "workspace-1",
    workspaceRevision: 7,
    name: "Latest active name",
    tabs: [
      { workspaceTabId: "tab-b", url: "https://example.com/b", tabId: 2, isOpen: false },
      { workspaceTabId: "tab-a", url: "https://example.com/a", tabId: 1, isOpen: false }
    ],
    journal: [{ entryId: "latest", text: "Latest" }],
    timeline: []
  };
  const memory = {
    ...active,
    workspaceRevision: 3,
    name: "Older saved name",
    tabs: [...active.tabs].reverse().map((tab) => ({ ...tab, url: tab.url + "?saved=older" })),
    journal: []
  };
  const prepared = prepareResumeWorkspaceForActivation(memory, active, {
    activeWorkspaceId: "workspace-1",
    activeWorkspaceRevision: 7
  });
  assert.equal(prepared.valid, true);
  assert.equal(prepared.sameWorkspaceIdentity, true);
  assert.equal(prepared.candidateWorkspaceRevision, 8);
  assert.equal(prepared.workspace.name, "Latest active name");
  assert.equal(prepared.workspace.journal.length, 1);
  assert.equal(prepared.workspace.tabs[0].url, "https://example.com/b");
  assert.notEqual(prepared.workspace, active);
});

test("same-workspace resume fails closed when saved and active semantic tab identities diverge", () => {
  const active = { workspaceId: "workspace-1", workspaceRevision: 7, tabs: [{ workspaceTabId: "tab-a", url: "https://example.com/a" }] };
  const memory = { workspaceId: "workspace-1", workspaceRevision: 3, tabs: [{ workspaceTabId: "tab-b", url: "https://example.com/b" }] };
  const prepared = prepareResumeWorkspaceForActivation(memory, active, {
    activeWorkspaceId: "workspace-1",
    activeWorkspaceRevision: 7
  });
  assert.equal(prepared.valid, false);
  assert.equal(prepared.reason, "resume_same_workspace_snapshot_conflict");
});

test("dedicated-window resume binds replacement to pre-mutation authority and brackets browser events with a reconciliation hold", async () => {
  const resume = await source("src/core/workspace-resume-transaction-engine.js");
  const reconciler = await source("src/core/automatic-workspace-projection-reconciler.js");
  const evidenceIndex = resume.indexOf("const preMutationAuthorityEvidence");
  const preparationIndex = resume.indexOf("prepareResumeWorkspaceForActivation");
  const holdIndex = resume.indexOf("acquireProjectionReconciliationHold");
  const browserMutationIndex = resume.indexOf("restoreWorkspaceTabsTransactionally");
  const stabilizationIndex = resume.indexOf("stabilizeOpenedTabProjection");
  const replacementIndex = resume.indexOf("replaceActiveFromVerifiedEvidence");
  assert.ok(evidenceIndex > 0 && evidenceIndex < preparationIndex);
  assert.ok(preparationIndex < holdIndex);
  assert.ok(holdIndex < browserMutationIndex && browserMutationIndex < stabilizationIndex && stabilizationIndex < replacementIndex);
  assert.match(resume, /replaceActiveFromVerifiedEvidence\([\s\S]*preMutationAuthorityEvidence/);
  assert.doesNotMatch(resume, /runtimeWorkspaceAuthority\.replaceActive\(hydratedWorkspace/);
  assert.match(resume, /recoverActiveAfterRollback/);
  assert.match(resume, /finally \{[\s\S]*releaseProjectionReconciliationHold[\s\S]*requestProjectionReconciliation/);
  const reconcileBody = reconciler.slice(
    reconciler.indexOf("async function reconcileActiveWorkspaceProjection"),
    reconciler.indexOf("async function workspaceProjectionReconciliationHeld")
  );
  assert.ok(reconcileBody.indexOf("workspaceProjectionReconciliationHeld") < reconcileBody.indexOf("captureWorkspaceProjectionSnapshot"));
  assert.ok(reconcileBody.indexOf("workspaceProjectionReconciliationHeld") < reconcileBody.indexOf("adapters.queryTabs"));
  assert.match(reconciler, /workspace_resume_transaction_in_progress/);
});

test("resume target projection stabilization waits for exact URL or title corroboration before replacement", async () => {
  let reads = 0;
  const waits = [];
  const result = await stabilizeOpenedTabProjection([
    { workspaceTabId: "tab-a", tabId: 101, windowId: 20, url: "https://example.com/a", title: "A" },
    { workspaceTabId: "tab-b", tabId: 102, windowId: 20, url: "https://example.com/b", title: "B" }
  ], 20, {
    maxAttempts: 3,
    intervalMs: 25,
    wait: async (milliseconds) => waits.push(milliseconds),
    getTab: async (tabId) => {
      reads += 1;
      const attempt = Math.ceil(reads / 2);
      if (attempt === 1) return { id: tabId, windowId: 20, url: "chrome://newtab/", title: "" };
      return tabId === 101
        ? { id: 101, windowId: 20, url: "https://example.com/a", title: "A" }
        : { id: 102, windowId: 20, url: "https://example.com/b", title: "B" };
    }
  });
  assert.equal(result.verified, true);
  assert.equal(result.attempts, 2);
  assert.deepEqual(waits, [25]);
  assert.equal(result.tabs.every((tab) => tab.verified), true);
});

test("resume target projection stabilization accepts an exact Chrome pending URL", async () => {
  const result = await stabilizeOpenedTabProjection([
    { workspaceTabId: "tab-a", tabId: 101, windowId: 20, url: "https://example.com/a", title: "A" }
  ], 20, {
    maxAttempts: 1,
    intervalMs: 0,
    getTab: async () => ({ id: 101, windowId: 20, url: "chrome://newtab/", pendingUrl: "https://example.com/a", title: "" })
  });
  assert.equal(result.verified, true);
  assert.equal(result.tabs[0].urlCorroborated, true);
});

test("resume target projection stabilization fails closed for a moved or unsettled tab", async () => {
  const result = await stabilizeOpenedTabProjection([
    { workspaceTabId: "tab-a", tabId: 101, windowId: 20, url: "https://example.com/a", title: "A" }
  ], 20, {
    maxAttempts: 2,
    intervalMs: 0,
    getTab: async () => ({ id: 101, windowId: 99, url: "chrome://newtab/", title: "" })
  });
  assert.equal(result.verified, false);
  assert.equal(result.reason, "target_projection_not_stable");
  assert.equal(result.attempts, 2);
  assert.equal(result.tabs[0].reason, "tab_window_mismatch");
});

test("window cleanup completes before window-removed reconciliation and surviving panels observe authority changes", async () => {
  const worker = await source("src/background/service-worker.js");
  const sidePanel = await source("src/sidepanel/sidepanel.js");
  const cleanupPath = worker.slice(worker.indexOf("async function cleanupRemovedWindowAuthorityThenReconcile"), worker.indexOf("if (chrome.tabGroups?.onCreated)"));
  assert.ok(cleanupPath.indexOf("await coordinateWindowCloseCleanup") < cleanupPath.indexOf("scheduleWorkspaceProjectionReconciliation"));
  assert.match(cleanupPath, /authorityCleanupVerified/);
  assert.match(sidePanel, /RUNTIME_SESSION_AUTHORITY_KEY/);
  assert.match(sidePanel, /areaName !== "session"/);
  assert.match(sidePanel, /queueRuntimeWorkspaceAuthorityRefresh/);
  const refreshPath = sidePanel.slice(sidePanel.indexOf("function queueRuntimeWorkspaceAuthorityRefresh"), sidePanel.indexOf("function setAuthoritySensitiveControlsDisabled"));
  assert.match(refreshPath, /runtimeWorkspaceAuthority\.bootstrapExisting\(\{ force: true \}\)/);
  assert.match(refreshPath, /applyRuntimeWorkspaceAuthorityState/);
  assert.match(refreshPath, /await renderWorkspace\(\)/);
});

test("start fresh offers archive discard and cancel without silently saving an empty draft", async () => {
  const controller = await source("src/sidepanel/workspace-archive-close-ownership-controller.js");
  const html = await source("src/sidepanel/sidepanel.html");
  assert.match(controller, /requestStartFreshDisposition/);
  assert.match(controller, /inspectWorkspaceMateriality/);
  assert.match(controller, /disposition === "archive"/);
  assert.match(controller, /not_persisted_for_discard/);
  assert.match(controller, /workspace_draft_discarded_start_fresh/);
  assert.match(controller, /priorSavedCopiesPreserved: true/);
  assert.match(html, /workspace-archive-close-ownership-controller\.js/);
  const persistencePath = controller.slice(controller.indexOf("if (shouldArchive)"), controller.indexOf("const closePlan"));
  assert.match(persistencePath, /createLegacyCompatibleArchiveRecord/);
  assert.match(persistencePath, /saveRuntimeWorkspaceToWorkspaceLibrary/);
  assert.match(html, /value="archive"/);
  assert.match(html, /value="discard"/);
  assert.match(html, /value="cancel"/);
});

test("projection reconciliation hold is exact, bounded, and observable by the service-worker reconciler", async () => {
  const hold = {
    schema: PROJECTION_RECONCILIATION_HOLD_SCHEMA,
    operationId: "resume-op",
    workspaceIds: ["workspace-1"],
    sourceWindowId: 10,
    startedAt: "2026-07-18T07:00:00.000Z",
    expiresAt: "2026-07-18T07:02:00.000Z"
  };
  assert.equal(snapshotAndValidateProjectionReconciliationHold(hold).valid, true);
  assert.equal(snapshotAndValidateProjectionReconciliationHold({ ...hold, extra: true }).valid, false);
  assert.equal(snapshotAndValidateProjectionReconciliationHold({ ...hold, workspaceIds: [] }).valid, false);
  assert.equal(snapshotAndValidateProjectionReconciliationHold({ ...hold, workspaceIds: ["workspace-1", "workspace-1"] }).valid, false);
  assert.equal(snapshotAndValidateProjectionReconciliationHold({ ...hold, expiresAt: hold.startedAt }).valid, false);

  const previousChrome = globalThis.chrome;
  let removed = false;
  const storage = {
    async get() { return { [PROJECTION_RECONCILIATION_HOLD_KEY]: structuredClone(hold) }; },
    async remove() { removed = true; }
  };
  globalThis.chrome = { storage: { session: storage } };
  try {
    assert.equal(await workspaceProjectionReconciliationHeld("workspace-1", "2026-07-18T07:01:00.000Z"), true);
    assert.equal(await workspaceProjectionReconciliationHeld("workspace-2", "2026-07-18T07:01:00.000Z"), false);
    assert.equal(await workspaceProjectionReconciliationHeld("workspace-1", "2026-07-18T07:03:00.000Z"), false);
    assert.equal(removed, true);
  } finally {
    if (typeof previousChrome === "undefined") delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  }
});

test("manual product path delegates to one private transaction and not the browser engine", async () => {
  const sidePanel = await source("src/sidepanel/sidepanel.js");
  const worker = await source("src/background/service-worker.js");
  assert.match(sidePanel, /workspaceManualPlacementClient\.submit/);
  assert.doesNotMatch(sidePanel, /moveExistingWorkspaceTabs\(/);
  const manualPath = sidePanel.slice(sidePanel.indexOf("async function moveWorkspaceTabsIntoNewWindow"), sidePanel.indexOf("async function arrangeWorkspaceTabsByRoleOrder"));
  const submitIndex = manualPath.indexOf("workspaceManualPlacementClient.submit");
  const refreshIndex = manualPath.indexOf("refreshRuntimeAuthorityAfterVerifiedTransfer(result)", submitIndex);
  const statusIndex = manualPath.indexOf("setAdvancedStatus", refreshIndex);
  const metadataBarrierIndex = manualPath.indexOf("runWithWorkspaceMetadataBarrier", manualPath.indexOf("sourceAuthorityVerified = true"));
  const postSubmitSuccessPath = manualPath.slice(submitIndex, manualPath.indexOf("} catch (error)"));
  assert.ok(metadataBarrierIndex > 0 && metadataBarrierIndex < submitIndex);
  assert.ok(manualPath.indexOf("setAuthoritySensitiveControlsDisabled(true)") < submitIndex);
  assert.ok(refreshIndex > submitIndex);
  assert.ok(statusIndex > refreshIndex);
  assert.doesNotMatch(postSubmitSuccessPath, /addTimelineEvent|renderWorkspace/);
  assert.match(manualPath, /if \(!transactionAttempted && sourceAuthorityVerified\)/);
  assert.match(manualPath, /const retainedAuthority = await runtimeWorkspaceAuthority\.bootstrapExisting\(\{ force: true \}\)/);
  assert.ok(manualPath.indexOf("retainedAuthority.status === \"active\"") < manualPath.indexOf("await addTimelineEvent", manualPath.indexOf("} catch (error)")));
  assert.equal((worker.match(/handleWorkspaceManualPlacementMessage\(/g) || []).length, 1);
});

test("manual and automatic transfer attempts refresh fail-closed before later UI-only source behavior", async () => {
  const sidePanel = await source("src/sidepanel/sidepanel.js");
  assert.match(sidePanel, /async function refreshRuntimeAuthorityAfterVerifiedTransfer/);
  assert.doesNotMatch(sidePanel, /result\?\.assignmentTransferred !== true/);
  assert.match(sidePanel, /runtimeWorkspaceAuthority\.bootstrapExisting\(\{ force: true \}\)/);
  assert.match(sidePanel, /refreshRuntimeAuthorityAfterVerifiedTransfer\(sequence\?\.promotionResult\)/);
  assert.match(sidePanel, /post_transaction_authority_refresh_failed/);
  const statusPath = sidePanel.slice(sidePanel.indexOf("async function setMembershipSequenceIntakeStatus"), sidePanel.indexOf("async function refreshRuntimeAuthorityAfterVerifiedTransfer"));
  assert.ok(statusPath.indexOf("refreshRuntimeAuthorityAfterVerifiedTransfer") < statusPath.indexOf("workspacePromotionNoticeController.showSequence"));
  assert.doesNotMatch(statusPath, /addTimelineEvent|saveWorkspace|writeCompatibleStorageValue/);
  assert.match(statusPath, /setIntakeStatus/);
  assert.match(statusPath, /return sequence\?\.promotionResult == null/);
  assert.equal((sidePanel.match(/const mayRenderSourceWorkspace = await setMembershipSequenceIntakeStatus/g) || []).length, 4);
  assert.equal((sidePanel.match(/if \(mayRenderSourceWorkspace\) await renderWorkspace\(\)/g) || []).length, 4);

  const independentControlPath = sidePanel.slice(sidePanel.indexOf("const runtimeAuthorityIndependentControlIds"), sidePanel.indexOf("const runtimeAuthorityEnableWhenActiveControlIds"));
  const authorityControlPath = sidePanel.slice(sidePanel.indexOf("function setAuthoritySensitiveControlsDisabled"), sidePanel.indexOf("function attachEventHandlers"));
  assert.match(sidePanel, /new MutationObserver/);
  assert.match(authorityControlPath, /querySelectorAll\("button, input, select, textarea"\)/);
  assert.match(authorityControlPath, /runtimeAuthorityPreviouslyDisabled/);
  assert.match(authorityControlPath, /runtimeAuthorityIndependentControlIds/);
  for (const controlId of [
    "toggleDeveloperModeButton", "refreshDiagnosticsButton", "copyDiagnosticPacketButton", "clearDiagnosticsButton",
    "copyAutomaticPromotionScenarioChecklistButton", "prepareAutomaticPromotionEvidencePacketButton", "copyAutomaticPromotionEvidencePacketButton"
  ]) assert.match(independentControlPath, new RegExp(controlId));
  assert.match(authorityControlPath, /restoreRuntimeAuthorityControlState/);
  assert.match(authorityControlPath, /function guardRuntimeWorkspaceMutation/);
  assert.match(authorityControlPath, /requireRuntimeWorkspaceAuthority/);

  const handlerPath = sidePanel.slice(sidePanel.indexOf("function attachEventHandlers"), sidePanel.indexOf("function populateWorkspaceTypeSelect"));
  for (const handler of [
    "saveWorkspaceDetails", "updateWorkspaceType", "scanCurrentWindowTabs", "addActiveTabToWorkspace",
    "addSelectedTabsToWorkspace", "openSearchTab", "createChromeTabGroupsFromWorkspace",
    "removeAllChromeTabGroupsForWorkspace", "refreshWorkspaceTabMetadata", "clearWorkspaceTabs",
    "refreshTabStatus", "saveJournalEntry", "handleTabsListClick", "handleTabsListChange",
    "handleRecoveryClick", "moveWorkspaceTabsIntoNewWindow", "arrangeWorkspaceTabsByRoleOrder",
    "reopenAllMissingWorkspaceTabs", "copyWorkspaceUrlList"
  ]) assert.match(handlerPath, new RegExp("guardRuntimeWorkspaceMutation\\(" + handler + "\\)"));

  const renderPath = sidePanel.slice(sidePanel.indexOf("async function renderWorkspace"), sidePanel.indexOf("function populateJournalRoleSelect"));
  assert.match(renderPath, /readActiveWorkspaceReadonly/);
  assert.doesNotMatch(renderPath, /\bgetWorkspace\(|\bsaveWorkspace\(|\baddTimelineEvent\(/);
  const metadataRefreshPath = sidePanel.slice(sidePanel.indexOf("async function refreshWorkspaceTabMetadata"), sidePanel.indexOf("async function refreshTabStatus"));
  assert.ok(metadataRefreshPath.indexOf("requireRuntimeWorkspaceAuthority") < metadataRefreshPath.indexOf("getWorkspace"));
  assert.equal((sidePanel.match(/setAuthoritySensitiveControlsDisabled\(true\);\s*const sequence = await workspaceMembershipPromotionSequencer\.sequenceWorkspaceMembershipPromotion/g) || []).length, 4);
  assert.equal((sidePanel.match(/if \(await requireRuntimeWorkspaceAuthority\(\)\) await addTimelineEvent\("(?:browser_search_tab_membership_failed|workspace_tab_readd_membership_failed)"/g) || []).length, 3);
});


test("side-panel initialization establishes authority before legacy workspace migration writes", async () => {
  const sidePanel = await source("src/sidepanel/sidepanel.js");
  const initialization = sidePanel.slice(sidePanel.indexOf("async function initializeSidePanel"), sidePanel.indexOf("async function requireRuntimeWorkspaceAuthority"));
  assert.ok(initialization.indexOf("runtimeWorkspaceAuthority.bootstrapExisting") < initialization.indexOf("migrateWorkspaceTabIds"));
  assert.match(initialization, /activationState\.status === "active"/);
  const migration = sidePanel.slice(sidePanel.indexOf("async function migrateWorkspaceTabIds"), sidePanel.indexOf("async function renderWorkspace"));
  assert.ok(migration.indexOf("requireRuntimeWorkspaceAuthority") < migration.indexOf("getWorkspace"));
  assert.ok(migration.lastIndexOf("requireRuntimeWorkspaceAuthority") < migration.indexOf("saveWorkspace"));
  assert.equal((migration.match(/requireRuntimeWorkspaceAuthority/g) || []).length, 2);
});

test("Current Workspace refresh is compatible display-only and covers verified commits and storage changes", async () => {
  const current = await source("src/sidepanel/workspace-session-control.js");
  assert.match(current, /readCompatibleStorageValue\("activeWorkspace"\)/);
  assert.match(current, /RUNTIME_WORKSPACE_COMMIT_EVENT/);
  assert.match(current, /workspaceLibrarySaveCompleted\.canonical/);
  assert.match(current, /workspaceLibrarySaveCompleted\.legacy/);
  assert.match(current, /chrome\.storage\.onChanged/);
  assert.doesNotMatch(current, /writeCompatibleStorageValue/);
});

test("durable saved-pointer language is truthful and never claims runtime authority", async () => {
  const paths = [
    "src/sidepanel/workspace-library-direct-refresh.js",
    "src/sidepanel/saved-workspace-registry.js",
    "src/sidepanel/workspace-library-product-surface.js"
  ];
  const combined = (await Promise.all(paths.map(source))).join("\n");
  assert.doesNotMatch(combined, /Active DB workspace|Active saved workspace|\[active DB\]|\[active saved\]/);
  assert.match(combined, /Last saved workspace/);
  assert.match(combined, /\[last saved\]/);
});

test("activation and manual placement do not invoke automatic promotion", async () => {
  const files = [
    "src/core/runtime-workspace-activation/coordinator.js",
    "src/core/runtime-workspace-activation/chrome-adapter.js",
    "src/core/workspace-manual-placement-transaction/coordinator.js",
    "src/core/workspace-manual-placement-transaction/chrome-adapter.js"
  ];
  const combined = (await Promise.all(files.map(source))).join("\n");
  assert.doesNotMatch(combined, /coordinateAutomaticWorkspacePromotion|handleAutomaticPromotionMessage|PROMOTION_THRESHOLD/);
});

function contextResult() {
  return { authorityVerified: true, context: { contextId: "context-1", contextType: "side_panel", windowId: 10 } };
}

function compatibleRead() {
  const workspace = { workspaceId: "workspace-1", workspaceRevision: 2, tabs: [] };
  return { canonicalPresent: true, legacyPresent: true, equivalent: true, conflict: false, value: workspace };
}

function activationResult(input, overrides = {}) {
  return {
    status: "no_change",
    reason: "activation_already_verified",
    operation: "bootstrap_existing",
    sourceContextId: input.sourceContextId,
    sourceWindowId: input.sourceWindowId,
    targetWindowId: input.sourceWindowId,
    activeWorkspaceId: input.expectedWorkspaceId,
    activeWorkspaceRevision: input.expectedWorkspaceRevision,
    workspaceVerified: true,
    assignmentVerified: true,
    currentRuntimeAssignmentId: "assignment-1",
    currentAssignmentEpoch: 1,
    ...overrides
  };
}

function replacementResult(input) {
  return {
    status: "committed",
    reason: "activation_committed",
    operation: "replace_active",
    sourceContextId: input.sourceContextId,
    sourceWindowId: input.sourceWindowId,
    targetWindowId: input.targetWindowId,
    activeWorkspaceId: input.candidateWorkspace.workspaceId,
    activeWorkspaceRevision: input.candidateWorkspace.workspaceRevision,
    workspaceVerified: true,
    assignmentVerified: true,
    currentRuntimeAssignmentId: "assignment-2",
    currentAssignmentEpoch: 2,
    readOnly: input.targetWindowId !== input.sourceWindowId
  };
}

async function source(path) { return readFile(new URL(path, ROOT), "utf8"); }
