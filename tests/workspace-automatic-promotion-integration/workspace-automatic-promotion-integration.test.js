import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { EVENT_IDENTITIES } from "../../src/core/constellation-identity-contract.js";
import { assignRuntime, createAssignmentRegistry } from "../../src/core/runtime-contract/assignments.js";
import { createOperationLedger } from "../../src/core/runtime-contract/ledger.js";
import { createSessionAuthority } from "../../src/core/runtime-session-authority/contract.js";
import {
  PROMOTION_REQUEST_SCHEMA,
  createPromotionResult,
  normalizePromotionIdentities,
  validatePromotionResult
} from "../../src/core/workspace-automatic-promotion-transaction/contract.js";
import { coordinateAutomaticWorkspacePromotion } from "../../src/core/workspace-automatic-promotion-transaction/coordinator.js";
import {
  createAutomaticPromotionChromeAdapters,
  createExistingTabMoveChromeAdapters,
  recordAutomaticPromotionDiagnostic
} from "../../src/core/workspace-automatic-promotion-integration/chrome-adapter.js";
import { handleAutomaticPromotionMessage } from "../../src/core/workspace-automatic-promotion-integration/service-worker-handler.js";
import { moveExistingWorkspaceTabs } from "../../src/core/workspace-existing-tab-move-engine/coordinator.js";

const NOW = "2026-07-16T10:00:00.000Z";
const SIDE_PANEL_URL = "chrome-extension://extension-id/src/sidepanel/sidepanel.html";

test("valid side-panel request reaches the pure promotion kernel", async () => {
  let calls = 0;
  const dispatched = dispatch(request(), {
    coordinate: async (value) => {
      calls += 1;
      return failedPromotion(value, "stubbed_coordination");
    },
    createAdapters: () => ({})
  });
  assert.equal(dispatched.async, true);
  assert.equal((await dispatched.response).reason, "stubbed_coordination");
  assert.equal(calls, 1);
});

test("unauthorized extension sender is rejected before adapters", async () => {
  let adaptersCreated = 0;
  const dispatched = dispatch(request(), { createAdapters: () => { adaptersCreated += 1; return {}; } }, { id: "other", url: SIDE_PANEL_URL });
  assert.equal(dispatched.async, false);
  const result = await dispatched.response;
  assert.equal(result.status, "invalid");
  assert.equal(result.reason, "sender_not_authorized");
  assert.equal(result.operationId, "promotion-op");
  assert.equal(adaptersCreated, 0);
});

test("wrong side-panel sender URL is rejected before adapters", async () => {
  let adaptersCreated = 0;
  const dispatched = dispatch(request(), { createAdapters: () => { adaptersCreated += 1; return {}; } }, { id: "extension-id", url: SIDE_PANEL_URL + "?wrong" });
  assert.equal((await dispatched.response).reason, "sender_not_authorized");
  assert.equal(adaptersCreated, 0);
});

test("malformed promotion request returns a complete invalid result", async () => {
  const malformed = request();
  delete malformed.threshold;
  const dispatched = dispatch(malformed);
  const result = await dispatched.response;
  assert.equal(dispatched.async, false);
  assert.equal(result.status, "invalid");
  assert.equal(result.operationId, malformed.operationId);
  assert.equal(validatePromotionResult(result), true);
});

test("unknown runtime messages remain unaffected", async () => {
  let responded = false;
  const handled = handleAutomaticPromotionMessage({ schema: "another-route" }, {}, () => { responded = true; }, {});
  assert.equal(handled, false);
  assert.equal(responded, false);
});

test("service-worker source terminally owns the promotion schema before handler dispatch", async () => {
  const source = await readFile(new URL("../../src/background/service-worker.js", import.meta.url), "utf8");
  assert.match(source, /import \{ handleAutomaticPromotionMessage, isAutomaticPromotionMessage \}/);
  assert.match(
    source,
    /if \(isAutomaticPromotionMessage\(message\)\) \{\s*return handleAutomaticPromotionMessage\(message, sender, sendResponse, \{[\s\S]*?\}\);\s*\}/
  );
});

test("malformed promotion-schema message cannot fall through to reconciliation", async () => {
  const message = request({ type: EVENT_IDENTITIES.reconcileWorkspaceProjection.canonical });
  delete message.threshold;
  const dispatched = await dispatchServiceWorker(message);
  assert.equal(dispatched.listenerResult, false);
  assert.equal(dispatched.responses.length, 1);
  assert.equal(dispatched.responses[0].status, "invalid");
  assert.equal(dispatched.responses[0].reason, "invalid_promotion_request");
  assert.equal(dispatched.responses[0].accepted, undefined);
});

test("wrong-URL promotion-schema message cannot fall through to reconciliation", async () => {
  const dispatched = await dispatchServiceWorker(
    request({ type: EVENT_IDENTITIES.reconcileWorkspaceProjection.legacy }),
    { id: "extension-id", url: SIDE_PANEL_URL + "?wrong" }
  );
  assert.equal(dispatched.listenerResult, false);
  assert.equal(dispatched.responses.length, 1);
  assert.equal(dispatched.responses[0].status, "invalid");
  assert.equal(dispatched.responses[0].reason, "sender_not_authorized");
  assert.equal(dispatched.responses[0].accepted, undefined);
});

test("ordinary non-promotion reconciliation message remains unaffected", async () => {
  const dispatched = await dispatchServiceWorker({
    type: EVENT_IDENTITIES.reconcileWorkspaceProjection.canonical,
    trigger: "focused_test"
  });
  assert.equal(dispatched.listenerResult, false);
  assert.equal(dispatched.responses.length, 1);
  assert.equal(dispatched.responses[0].accepted, true);
  assert.equal(dispatched.responses[0].canonicalType, EVENT_IDENTITIES.reconcileWorkspaceProjection.canonical);
});

test("pending operation is persisted before browser mutation", async () => {
  const fixture = environment();
  const result = await coordinateAutomaticWorkspacePromotion(request(), fixture.adapters());
  assert.equal(result.status, "committed");
  assert.ok(fixture.events.indexOf("ledger:write") < fixture.events.indexOf("browser:create"));
  assert.equal(fixture.ledger.entries[0].result.status, "committed");
});

test("service-worker restart rereads pending operation", async () => {
  const fixture = environment({ createThrowAfterEffect: true, failProjectionAfterCreate: true });
  const first = await coordinateAutomaticWorkspacePromotion(request(), fixture.adapters());
  assert.equal(first.status, "indeterminate");
  assert.equal(fixture.ledger.entries[0].result.schema, "constellation-workspace-automatic-promotion-pending-v0.1");
  const second = await coordinateAutomaticWorkspacePromotion(request(), fixture.adapters());
  assert.equal(second.status, "committed");
  assert.ok(second.warnings.includes("pending_operation_recovered"));
});

test("create recovery never creates a second destination window", async () => {
  const fixture = environment({ createThrowAfterEffect: true, failProjectionAfterCreate: true });
  await coordinateAutomaticWorkspacePromotion(request(), fixture.adapters());
  await coordinateAutomaticWorkspacePromotion(request(), fixture.adapters());
  assert.equal(fixture.counts.createWindow, 1);
  assert.equal(fixture.browser.windows.filter((item) => item.id === 20).length, 1);
});

test("attach mode creates zero windows", async () => {
  const fixture = environment({ dedicated: true, fourthTabInSource: true });
  const result = await coordinateAutomaticWorkspacePromotion(request({ sourceWindowId: 20 }), fixture.adapters());
  assert.equal(result.status, "committed");
  assert.equal(result.moveMode, "attach_to_existing_dedicated_window");
  assert.equal(fixture.counts.createWindow, 0);
});

test("exact terminal replay performs zero additional browser mutation", async () => {
  const fixture = environment();
  await coordinateAutomaticWorkspacePromotion(request(), fixture.adapters());
  const before = { ...fixture.counts };
  const replay = await coordinateAutomaticWorkspacePromotion(request(), fixture.adapters());
  assert.equal(replay.status, "replayed");
  assert.deepEqual(fixture.counts, before);
});

test("operation-ID fingerprint conflict fails closed", async () => {
  const fixture = environment();
  await coordinateAutomaticWorkspacePromotion(request(), fixture.adapters());
  const conflicted = request({ triggerOperationId: "different-trigger" });
  const result = await coordinateAutomaticWorkspacePromotion(conflicted, fixture.adapters());
  assert.equal(result.status, "conflict");
  assert.equal(result.reason, "operation_id_fingerprint_conflict");
});

test("runtime authority validates source context against source window", async () => {
  const fixture = environment();
  fixture.authority.contexts[0].windowId = 11;
  const result = await coordinateAutomaticWorkspacePromotion(request(), fixture.adapters());
  assert.equal(result.status, "conflict");
  assert.equal(result.reason, "source_context_not_verified");
  assert.equal(fixture.counts.createWindow, 0);
});

test("destination verification does not require a destination context", async () => {
  const fixture = environment();
  const result = await coordinateAutomaticWorkspacePromotion(request(), fixture.adapters());
  assert.equal(result.status, "committed");
  assert.equal(fixture.authority.contexts.some((context) => context.windowId === result.targetWindowId), false);
  assert.equal(result.assignmentVerified, true);
});

test("pending recovery fails closed when runtime session changes", async () => {
  const fixture = environment({ createThrowAfterEffect: true, failProjectionAfterCreate: true });
  await coordinateAutomaticWorkspacePromotion(request(), fixture.adapters());
  fixture.authority.runtimeSessionId = "replacement-session";
  const result = await coordinateAutomaticWorkspacePromotion(request(), fixture.adapters());
  assert.equal(result.status, "conflict");
  assert.equal(result.reason, "runtime_session_changed");
});

test("stale authority revision fails closed", async () => {
  const fixture = environment();
  const adapters = fixture.adapters();
  const output = await adapters.runExclusiveOperation(() => adapters.writeRuntimeAuthority({
    expectedRuntimeSessionId: fixture.authority.runtimeSessionId,
    expectedAuthorityRevision: fixture.authority.authorityRevision + 1,
    nextAssignmentRegistry: fixture.authority.assignmentRegistry
  }));
  assert.equal(output.status, "conflict");
  assert.equal(output.error, "runtime_authority_changed");
});

test("destination assignment conflict fails closed", async () => {
  const fixture = environment({ destinationConflict: true });
  const result = await coordinateAutomaticWorkspacePromotion(request(), fixture.adapters());
  assert.equal(result.status, "conflict");
  assert.equal(result.reason, "destination_window_assignment_conflict");
});

test("runtime authority write is compare-and-set and reread verified", async () => {
  const fixture = environment();
  const adapters = fixture.adapters();
  const nextRegistry = structuredClone(fixture.authority.assignmentRegistry);
  nextRegistry.forwardField = undefined;
  delete nextRegistry.forwardField;
  const output = await adapters.runExclusiveOperation(() => adapters.writeRuntimeAuthority({
    expectedRuntimeSessionId: fixture.authority.runtimeSessionId,
    expectedAuthorityRevision: 0,
    nextAssignmentRegistry: nextRegistry
  }));
  assert.equal(output.status, "written");
  assert.equal(output.authorityRevision, 1);
  assert.equal(fixture.authority.futureRootField.keep, true);
});

test("workspace placement write requires the exact expected revision", async () => {
  const fixture = environment();
  const adapters = fixture.adapters();
  await adapters.readPromotionState({ workspaceId: "workspace-1" });
  const output = await adapters.runExclusiveOperation(() => adapters.writeWorkspacePlacement(placementInput({ expectedWorkspaceRevision: 4, nextWorkspaceRevision: 5 })));
  assert.equal(output.status, "conflict");
  assert.equal(output.error, "workspace_revision_changed");
});

test("workspace membership change fails closed", async () => {
  const fixture = environment();
  const adapters = fixture.adapters();
  await adapters.readPromotionState({ workspaceId: "workspace-1" });
  const changed = structuredClone(fixture.workspace);
  changed.tabs.push({ workspaceTabId: "late", tabId: 99, role: "unassigned", alias: "preserve" });
  fixture.workspace = changed;
  const output = await adapters.runExclusiveOperation(() => adapters.writeWorkspacePlacement(placementInput()));
  assert.equal(output.status, "conflict");
  assert.equal(output.error, "workspace_membership_changed");
});

test("workspace role drift after the post-move read blocks placement persistence", async () => {
  await assertSemanticDriftBlocked((fixture) => {
    const changed = structuredClone(fixture.workspace);
    changed.tabs[0].role = "question";
    fixture.workspace = changed;
  });
});

test("workspace name drift after the post-move read blocks placement persistence", async () => {
  await assertSemanticDriftBlocked((fixture) => {
    fixture.workspace = { ...fixture.workspace, name: "Replacement Name" };
  });
});

test("workspace type drift that changes role labels blocks placement persistence", async () => {
  await assertSemanticDriftBlocked((fixture) => {
    fixture.workspace = { ...fixture.workspace, workspaceType: "design" };
  });
});

test("represented browser-group title drift blocks placement persistence", async () => {
  await assertSemanticDriftBlocked((fixture) => {
    fixture.browser.groups.find((group) => group.id === 100).title = "Changed title";
  });
});

test("represented browser-group membership drift blocks placement persistence", async () => {
  await assertSemanticDriftBlocked((fixture) => {
    const unrelated = removeTab(fixture.browser, 99);
    const target = fixture.browser.windows.find((window) => window.id === 20);
    target.tabs.push({ ...unrelated, windowId: 20, groupId: 100, index: target.tabs.length });
  });
});

test("represented browser-group colour and collapsed drift blocks placement persistence", async () => {
  await assertSemanticDriftBlocked((fixture) => {
    const group = fixture.browser.groups.find((item) => item.id === 100);
    group.color = "green";
    group.collapsed = false;
  });
});

test("assigned tab becoming ungrouped blocks placement persistence", async () => {
  await assertSemanticDriftBlocked((fixture) => {
    findTab(fixture, 1).groupId = -1;
  });
});

test("unassigned tab becoming grouped blocks placement persistence", async () => {
  await assertSemanticDriftBlocked((fixture) => {
    findTab(fixture, 4).groupId = 100;
  });
});

test("alias drift remains allowed and is preserved by placement persistence", async () => {
  const fixture = environment({ allTabsInTarget: true });
  const adapters = fixture.adapters();
  assert.equal((await adapters.readPromotionState({ workspaceId: "workspace-1" })).status, "present");
  const changed = structuredClone(fixture.workspace);
  changed.tabs[0].alias = "Changed after post-move evidence";
  fixture.workspace = changed;
  const output = await adapters.runExclusiveOperation(() => adapters.writeWorkspacePlacement(placementInput()));
  assert.equal(output.status, "written");
  assert.equal(fixture.workspace.tabs[0].alias, "Changed after post-move evidence");
});

test("journal timeline and unknown-field drift remain allowed and are preserved", async () => {
  const fixture = environment({ allTabsInTarget: true });
  const adapters = fixture.adapters();
  assert.equal((await adapters.readPromotionState({ workspaceId: "workspace-1" })).status, "present");
  const changed = structuredClone(fixture.workspace);
  changed.journal.push({ entryId: "journal-2", text: "Added after evidence" });
  changed.timeline.push({ eventId: "timeline-2", type: "added_after_evidence" });
  changed.unknownForwardField = { preserve: true, changedAfterEvidence: true };
  fixture.workspace = changed;
  const output = await adapters.runExclusiveOperation(() => adapters.writeWorkspacePlacement(placementInput()));
  assert.equal(output.status, "written");
  assert.equal(fixture.workspace.journal.at(-1).text, "Added after evidence");
  assert.equal(fixture.workspace.timeline.at(-1).type, "added_after_evidence");
  assert.equal(fixture.workspace.unknownForwardField.changedAfterEvidence, true);
});

test("unrelated browser tab and group drift remain allowed", async () => {
  const fixture = environment({ allTabsInTarget: true });
  const adapters = fixture.adapters();
  assert.equal((await adapters.readPromotionState({ workspaceId: "workspace-1" })).status, "present");
  const unrelated = findTab(fixture, 99);
  unrelated.title = "Unrelated title changed";
  unrelated.groupId = 999;
  fixture.browser.groups.push({ id: 999, windowId: 10, title: "Unrelated group", color: "yellow", collapsed: true });
  const output = await adapters.runExclusiveOperation(() => adapters.writeWorkspacePlacement(placementInput()));
  assert.equal(output.status, "written");
  assert.equal(findTab(fixture, 99).title, "Unrelated title changed");
  assert.equal(fixture.browser.groups.find((group) => group.id === 999).title, "Unrelated group");
});

test("malformed persisted placement fails closed without overwrite", async () => {
  const fixture = environment({ allTabsInTarget: true });
  const adapters = fixture.adapters();
  assert.equal((await adapters.readPromotionState({ workspaceId: "workspace-1" })).status, "present");
  fixture.workspace = { ...fixture.workspace, placementMode: "dedicated_window", dedicatedWindowId: "20" };
  const output = await adapters.runExclusiveOperation(() => adapters.writeWorkspacePlacement(placementInput()));
  assert.equal(output.status, "conflict");
  assert.equal(output.error, "workspace_placement_invalid");
  assert.equal(fixture.workspace.dedicatedWindowId, "20");
});

test("workspace placement preserves unrelated and user-authored fields", async () => {
  const fixture = environment({ allTabsInTarget: true });
  const adapters = fixture.adapters();
  await adapters.readPromotionState({ workspaceId: "workspace-1" });
  const output = await adapters.runExclusiveOperation(() => adapters.writeWorkspacePlacement(placementInput()));
  assert.equal(output.status, "written");
  assert.deepEqual(fixture.workspace.unknownForwardField, { preserve: true });
  assert.equal(fixture.workspace.tabs[0].alias, "Operator alias 1");
  assert.equal(fixture.workspace.journal[0].text, "Keep journal");
  assert.equal(fixture.workspace.workspaceRevision, 6);
});

test("canonical and legacy workspace peers remain compatible", async () => {
  const fixture = environment({ allTabsInTarget: true });
  const adapters = fixture.adapters();
  await adapters.readPromotionState({ workspaceId: "workspace-1" });
  await adapters.runExclusiveOperation(() => adapters.writeWorkspacePlacement(placementInput()));
  assert.deepEqual(fixture.canonicalWorkspace, fixture.legacyWorkspace);
  assert.deepEqual(fixture.workspace, fixture.canonicalWorkspace);
});

test("malformed present workspace state fails closed", async () => {
  const fixture = environment();
  fixture.workspace = { ...fixture.workspace, tabs: null };
  const state = await fixture.adapters().readPromotionState({ workspaceId: "workspace-1" });
  assert.equal(state.status, "failed");
  assert.equal(state.error, "workspace_state_malformed");
});

test("object-valued workspace name fails semantic promotion state closed", async () => {
  await assertMalformedSemanticState((workspace) => { workspace.name = { malformed: true }; });
});

test("object-valued workspace type fails semantic promotion state closed", async () => {
  await assertMalformedSemanticState((workspace) => { workspace.workspaceType = { malformed: true }; });
});

test("object-valued workspace-tab role fails semantic promotion state closed", async () => {
  await assertMalformedSemanticState((workspace) => { workspace.tabs[0].role = { malformed: true }; });
});

test("numeric workspace-tab role fails semantic promotion state closed", async () => {
  await assertMalformedSemanticState((workspace) => { workspace.tabs[0].role = 1; });
});

test("numeric-string workspace tab ID fails semantic promotion state closed", async () => {
  await assertMalformedSemanticState((workspace) => { workspace.tabs[0].tabId = "1"; });
});

test("negative workspace tab ID fails semantic promotion state closed", async () => {
  await assertMalformedSemanticState((workspace) => { workspace.tabs[0].tabId = -1; });
});

test("unsafe workspace tab ID fails semantic promotion state closed", async () => {
  await assertMalformedSemanticState((workspace) => { workspace.tabs[0].tabId = Number.MAX_SAFE_INTEGER + 1; });
});

test("legitimate absent legacy semantic fields normalize safely", async () => {
  const fixture = environment();
  const workspace = structuredClone(fixture.workspace);
  delete workspace.name;
  delete workspace.workspaceType;
  delete workspace.tabs[3].role;
  workspace.tabs.push({ workspaceTabId: "legacy-tab-without-projection" });
  fixture.workspace = workspace;
  const state = await fixture.adapters().readPromotionState({ workspaceId: "workspace-1" });
  assert.equal(state.status, "present");
  assert.equal(state.error, "");
  assert.equal(state.eligibleTabCount, 4);
  assert.equal(state.tabs.find((tab) => tab.workspaceTabId === "tab-4").role, "unassigned");
  assert.equal(state.groups.find((group) => group.role === "source").roleLabel, "Source · CF");
});

test("malformed present ledger fails closed without replacement", async () => {
  const fixture = environment();
  fixture.ledger = { schema: "wrong" };
  const before = structuredClone(fixture.ledger);
  const read = await fixture.adapters().readOperationLedger();
  assert.equal(read.status, "failed");
  assert.deepEqual(fixture.ledger, before);
  assert.equal(fixture.counts.writeLedger, 0);
});

test("ledger write failure followed by exact reread converges", async () => {
  const fixture = environment({ ledgerThrowAfterEffect: true });
  const result = await coordinateAutomaticWorkspacePromotion(request(), fixture.adapters());
  assert.equal(result.status, "committed");
  assert.equal(fixture.ledger.entries[0].result.status, "committed");
});

test("browser create throw after effect is resolved by reread", async () => {
  const fixture = environment({ createThrowAfterEffect: true });
  const result = await coordinateAutomaticWorkspacePromotion(request(), fixture.adapters());
  assert.equal(result.status, "committed");
  assert.equal(result.targetWindowId, 20);
  assert.equal(fixture.counts.createWindow, 1);
});

test("partial browser movement remains indeterminate", async () => {
  const fixture = environment({ partialMoveThrow: true });
  const result = await coordinateAutomaticWorkspacePromotion(request(), fixture.adapters());
  assert.equal(result.status, "indeterminate");
  assert.equal(result.browserMutationStarted, true);
  assert.equal(result.retrySafe, false);
});

test("only workspace-owned tabs move", async () => {
  const fixture = environment();
  await coordinateAutomaticWorkspacePromotion(request(), fixture.adapters());
  assert.equal(findTab(fixture, 99).windowId, 10);
  assert.deepEqual([1, 2, 3, 4].map((id) => findTab(fixture, id).windowId), [20, 20, 20, 20]);
});

test("unrelated tabs remain in their original windows", async () => {
  const fixture = environment();
  const before = structuredClone(findTab(fixture, 99));
  await coordinateAutomaticWorkspacePromotion(request(), fixture.adapters());
  assert.equal(findTab(fixture, 99).windowId, before.windowId);
  assert.equal(findTab(fixture, 99).id, before.id);
});

test("assigned groups are recreated exactly", async () => {
  const fixture = environment();
  const result = await coordinateAutomaticWorkspacePromotion(request(), fixture.adapters());
  assert.equal(result.status, "committed");
  const target = fixture.browser.windows.find((item) => item.id === 20);
  const groups = fixture.browser.groups.filter((group) => group.windowId === 20);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.title).sort(), ["Question · A", "Source · A"]);
  assert.deepEqual(target.tabs.filter((tab) => [1, 2].includes(tab.id)).map((tab) => tab.groupId), [groups.find((group) => group.title === "Source · A").id, groups.find((group) => group.title === "Source · A").id]);
});

test("unassigned tabs remain ungrouped", async () => {
  const fixture = environment();
  await coordinateAutomaticWorkspacePromotion(request(), fixture.adapters());
  assert.equal(findTab(fixture, 4).groupId, -1);
});

test("diagnostic failure cannot change a verified result", async () => {
  const fixture = environment();
  const dispatched = dispatch(request(), {
    coordinate: coordinateAutomaticWorkspacePromotion,
    createAdapters: () => fixture.adapters(),
    recordDiagnostic: async () => { throw new Error("diagnostic unavailable"); }
  });
  const result = await dispatched.response;
  assert.equal(result.status, "committed");
  assert.equal(result.workspacePlacementVerified, true);
});

test("existing manual move path remains present and uses the shared move engine", async () => {
  const source = await readFile(new URL("../../src/sidepanel/sidepanel.js", import.meta.url), "utf8");
  assert.match(source, /async function moveWorkspaceTabsIntoNewWindow\(\)/);
  assert.match(source, /moveExistingWorkspaceTabs\(request, createExistingTabMoveChromeAdapters\(\)\)/);
  assert.match(source, /moveWorkspaceTabsToNewWindowButton/);
});

test("startup reconciliation tab events render and reload do not invoke promotion", async () => {
  const serviceWorker = await readFile(new URL("../../src/background/service-worker.js", import.meta.url), "utf8");
  const automaticReconciler = await readFile(new URL("../../src/core/automatic-workspace-projection-reconciler.js", import.meta.url), "utf8");
  assert.doesNotMatch(automaticReconciler, /automatic-promotion|coordinateAutomaticWorkspacePromotion/);
  assert.equal((serviceWorker.match(/handleAutomaticPromotionMessage\(/g) || []).length, 1);
  assert.doesNotMatch(serviceWorker, /onStartup[\s\S]{0,200}handleAutomaticPromotionMessage/);
});

test("archive and resume paths do not invoke promotion", async () => {
  for (const path of [
    "../../src/core/workspace-resume-transaction-engine.js",
    "../../src/sidepanel/workspace-library-resume-gate.js",
    "../../src/sidepanel/workspace-archive-restore-control.js"
  ]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /coordinateAutomaticWorkspacePromotion|automatic-promotion-request/);
  }
});

test("no public assignment or browser-move route is introduced", async () => {
  const source = await readFile(new URL("../../src/background/service-worker.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /assignment-(?:create|transfer)-request|existing-tab-move-request/);
  assert.match(source, /handleAutomaticPromotionMessage/);
});

test("production modules contain exactly one promotion coordination invocation site", async () => {
  const handler = await readFile(new URL("../../src/core/workspace-automatic-promotion-integration/service-worker-handler.js", import.meta.url), "utf8");
  const adapter = await readFile(new URL("../../src/core/workspace-automatic-promotion-integration/chrome-adapter.js", import.meta.url), "utf8");
  assert.equal((handler.match(/coordinateAutomaticWorkspacePromotion\(/g) || []).length, 1);
  assert.equal((adapter.match(/coordinateAutomaticWorkspacePromotion\(/g) || []).length, 0);
});

test("route totalizes throwing getters cycles symbols and unsupported values", async () => {
  const throwing = request();
  Object.defineProperty(throwing, "operationId", { enumerable: true, get() { throw new Error("getter"); } });
  const throwingResult = await dispatch(throwing).response;
  assert.equal(throwingResult.status, "invalid");
  const cyclic = request(); cyclic.self = cyclic;
  assert.equal((await dispatch(cyclic).response).status, "invalid");
  const symbolic = request(); symbolic.extra = Symbol("unsupported");
  assert.equal((await dispatch(symbolic).response).status, "invalid");
  const bigint = request(); bigint.extra = 1n;
  assert.equal((await dispatch(bigint).response).status, "invalid");
});

test("unexpected top-level route failure returns a complete failed result", async () => {
  const result = await dispatch(request(), { createAdapters: () => { throw new Error("adapter creation"); } }).response;
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "unhandled_coordination_failure");
  assert.equal(validatePromotionResult(result), true);
});

test("replayed transactions do not emit duplicate terminal diagnostics", async () => {
  let calls = 0;
  const replay = createPromotionResult(normalizePromotionIdentities(request()), {
    status: "replayed", reason: "operation_replayed", decision: "use_dedicated_window", phase: "complete",
    moveMode: "create_dedicated_window", moveStatus: "completed_verified", targetWindowId: 20,
    browserMutationStarted: true, browserMutationVerified: true, assignmentVerified: true,
    workspacePlacementVerified: true, replayed: true
  });
  const output = await recordAutomaticPromotionDiagnostic(replay, { appendDiagnostic: async () => { calls += 1; } });
  assert.equal(output.recorded, false);
  assert.equal(calls, 0);
});

test("shared ledger compare-and-set detects a concurrent replacement", async () => {
  const fixture = environment();
  const adapters = fixture.adapters();
  await adapters.readOperationLedger();
  fixture.ledger = { ...createOperationLedger(), maxEntries: 50 };
  const output = await adapters.runExclusiveOperation(() => adapters.writeOperationLedger(createOperationLedger()));
  assert.equal(output.status, "conflict");
  assert.equal(output.error, "operation_ledger_changed");
});

test("dedicated placement requires current browser evidence", async () => {
  const fixture = environment({ dedicated: true, fourthTabInSource: true });
  fixture.browser.windows = fixture.browser.windows.filter((item) => item.id !== 20);
  const state = await fixture.adapters().readPromotionState({ workspaceId: "workspace-1" });
  assert.equal(state.status, "failed");
  assert.equal(state.error, "dedicated_placement_browser_evidence_conflict");
});

test("move adapter preserves the complete verified move result", async () => {
  const fixture = environment();
  const state = await fixture.adapters().readPromotionState({ workspaceId: "workspace-1" });
  const moveRequest = {
    schema: "constellation-workspace-existing-tab-move-request-v0.1", operationId: "direct-move", workspaceId: "workspace-1",
    mode: "create_dedicated_window", sourceWindowIds: state.sourceWindowIds, targetWindowId: null,
    tabs: state.tabs, groups: state.groups, requestedAt: NOW
  };
  const direct = await moveExistingWorkspaceTabs(moveRequest, createExistingTabMoveChromeAdapters(fixture.chrome));
  assert.equal(direct.verification.length, 16);
  assert.equal(direct.verification.every((check) => check.passed), true);
  assert.equal(direct.browserMutationVerified, true);
});

function request(patch = {}) {
  return {
    schema: PROMOTION_REQUEST_SCHEMA,
    operationId: "promotion-op",
    triggerOperationId: "membership-op",
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
    ...patch
  };
}

function failedPromotion(value, reason) {
  return createPromotionResult(normalizePromotionIdentities(value), {
    status: "failed", reason, decision: "retry_transaction", phase: "state_reread", retrySafe: true
  });
}

function placementInput(patch = {}) {
  return {
    workspaceId: "workspace-1",
    expectedWorkspaceRevision: 5,
    nextWorkspaceRevision: 6,
    placementMode: "dedicated_window",
    dedicatedWindowId: 20,
    moveResult: {
      movedTabIds: [1, 2, 3, 4],
      alreadyInTargetTabIds: []
    },
    ...patch
  };
}

function dispatch(message, options = {}, sender = { id: "extension-id", url: SIDE_PANEL_URL }) {
  let resolve;
  const response = new Promise((done) => { resolve = done; });
  const async = handleAutomaticPromotionMessage(message, sender, resolve, {
    runtimeId: "extension-id",
    sidePanelUrl: SIDE_PANEL_URL,
    chromeApi: {},
    recordDiagnostic: async () => {},
    ...options
  });
  return { async, response };
}

let serviceWorkerHarnessPromise;

async function dispatchServiceWorker(message, sender = { id: "extension-id", url: SIDE_PANEL_URL }) {
  if (!serviceWorkerHarnessPromise) serviceWorkerHarnessPromise = loadServiceWorkerHarness();
  const harness = await serviceWorkerHarnessPromise;
  const responses = [];
  const previousChrome = globalThis.chrome;
  const previousSetTimeout = globalThis.setTimeout;
  globalThis.chrome = harness.chrome;
  globalThis.setTimeout = () => 0;
  let listenerResult;
  try {
    listenerResult = harness.listener(message, sender, (response) => { responses.push(response); });
    await Promise.resolve();
  } finally {
    globalThis.setTimeout = previousSetTimeout;
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  }
  return { listenerResult, responses };
}

async function loadServiceWorkerHarness() {
  const listeners = {};
  const storageValues = {};
  const event = (name) => ({ addListener(callback) { listeners[name] = callback; } });
  const chrome = {
    runtime: {
      id: "extension-id",
      getURL: (path) => "chrome-extension://extension-id/" + path,
      onInstalled: event("installed"),
      onStartup: event("startup"),
      onMessage: event("message")
    },
    sidePanel: { setPanelBehavior: async () => {} },
    tabs: {
      onCreated: event("tab-created"),
      onUpdated: event("tab-updated"),
      onRemoved: event("tab-removed"),
      onMoved: event("tab-moved"),
      onAttached: event("tab-attached"),
      onDetached: event("tab-detached"),
      onReplaced: event("tab-replaced")
    },
    windows: { onRemoved: event("window-removed") },
    tabGroups: {
      onCreated: event("group-created"),
      onUpdated: event("group-updated"),
      onRemoved: event("group-removed")
    },
    storage: {
      local: {
        async get(key) {
          if (key === null) return structuredClone(storageValues);
          if (typeof key === "string") return Object.hasOwn(storageValues, key) ? { [key]: structuredClone(storageValues[key]) } : {};
          return {};
        },
        async set(values) { Object.assign(storageValues, structuredClone(values)); },
        async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete storageValues[key]; }
      },
      session: { get: async () => ({}), set: async () => {} }
    }
  };
  const previousChrome = globalThis.chrome;
  globalThis.chrome = chrome;
  try {
    await import(new URL("../../src/background/service-worker.js?promotion-route-harness", import.meta.url));
  } finally {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  }
  assert.equal(typeof listeners.message, "function");
  return { chrome, listener: listeners.message };
}

async function assertSemanticDriftBlocked(mutate) {
  const fixture = environment({ allTabsInTarget: true });
  const adapters = fixture.adapters();
  assert.equal((await adapters.readPromotionState({ workspaceId: "workspace-1" })).status, "present");
  mutate(fixture);
  const output = await adapters.runExclusiveOperation(() => adapters.writeWorkspacePlacement(placementInput()));
  assert.equal(output.status, "conflict");
  assert.equal(output.error, "workspace_or_browser_semantic_plan_changed");
  assert.equal(fixture.counts.writeWorkspace, 0);
  assert.equal(fixture.workspace.workspaceRevision, 5);
}

async function assertMalformedSemanticState(mutate) {
  const fixture = environment();
  const workspace = structuredClone(fixture.workspace);
  mutate(workspace);
  fixture.workspace = workspace;
  const state = await fixture.adapters().readPromotionState({ workspaceId: "workspace-1" });
  assert.equal(state.status, "failed");
  assert.equal(state.error, "workspace_semantic_state_malformed");
  await coordinateAutomaticWorkspacePromotion(request(), fixture.adapters());
  assert.deepEqual(
    {
      writeLedger: fixture.counts.writeLedger,
      writeAuthority: fixture.counts.writeAuthority,
      writeWorkspace: fixture.counts.writeWorkspace,
      createWindow: fixture.counts.createWindow,
      moveTabs: fixture.counts.moveTabs,
      groupTabs: fixture.counts.groupTabs,
      updateGroup: fixture.counts.updateGroup,
      focusWindow: fixture.counts.focusWindow
    },
    {
      writeLedger: 0,
      writeAuthority: 0,
      writeWorkspace: 0,
      createWindow: 0,
      moveTabs: 0,
      groupTabs: 0,
      updateGroup: 0,
      focusWindow: 0
    }
  );
}

function environment(options = {}) {
  let workspace = createWorkspace(options);
  let canonicalWorkspace = structuredClone(workspace);
  let legacyWorkspace = structuredClone(workspace);
  let ledger = createOperationLedger();
  let authority = createAuthority(options);
  let ledgerThrowRemaining = options.ledgerThrowAfterEffect ? 1 : 0;
  let failNextProjection = false;
  const events = [];
  const counts = {
    createWindow: 0,
    moveTabs: 0,
    groupTabs: 0,
    updateGroup: 0,
    focusWindow: 0,
    writeLedger: 0,
    writeAuthority: 0,
    writeWorkspace: 0
  };
  const browser = createBrowser(options);

  const chrome = {
    windows: {
      async getAll() {
        if (failNextProjection) { failNextProjection = false; throw new Error("projection temporarily unavailable"); }
        return browser.windows.map((browserWindow) => ({
          id: browserWindow.id,
          focused: browserWindow.focused,
          tabs: browserWindow.tabs.map((tab) => ({ ...tab }))
        }));
      },
      async get(windowId) {
        const found = browser.windows.find((item) => item.id === windowId);
        if (!found) throw new Error("window missing");
        return { id: found.id, focused: found.focused };
      },
      async create({ tabId }) {
        events.push("browser:create"); counts.createWindow += 1;
        const tab = removeTab(browser, tabId);
        const target = { id: 20, focused: true, tabs: [{ ...tab, windowId: 20, index: 0, groupId: -1 }] };
        browser.windows.forEach((item) => { item.focused = false; });
        browser.windows.push(target);
        cleanupGroups(browser);
        if (options.createThrowAfterEffect) {
          if (options.failProjectionAfterCreate) failNextProjection = true;
          throw new Error("create threw after effect");
        }
        return { id: 20 };
      },
      async update(windowId, update) {
        counts.focusWindow += update.focused === true ? 1 : 0;
        const target = browser.windows.find((item) => item.id === windowId);
        if (!target) throw new Error("window missing");
        if (update.focused === true) {
          browser.windows.forEach((item) => { item.focused = false; });
          target.focused = true;
        }
        return { id: windowId };
      }
    },
    tabs: {
      async move(tabIds, { windowId }) {
        events.push("browser:move"); counts.moveTabs += 1;
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        const moveIds = options.partialMoveThrow ? ids.slice(0, 1) : ids;
        for (const tabId of moveIds) {
          const tab = removeTab(browser, tabId);
          const target = browser.windows.find((item) => item.id === windowId);
          target.tabs.push({ ...tab, windowId, index: target.tabs.length, groupId: -1 });
        }
        reindex(browser); cleanupGroups(browser);
        if (options.partialMoveThrow) throw new Error("partial move");
        return ids.map((id) => findBrowserTab(browser, id));
      },
      async group({ tabIds, createProperties }) {
        counts.groupTabs += 1;
        const groupId = browser.nextGroupId++;
        browser.groups.push({ id: groupId, windowId: createProperties.windowId, title: "", color: "grey", collapsed: false });
        tabIds.forEach((tabId) => { findBrowserTab(browser, tabId).groupId = groupId; });
        return groupId;
      }
    },
    tabGroups: {
      async query() { return browser.groups.map((group) => ({ ...group })); },
      async update(groupId, update) {
        counts.updateGroup += 1;
        const group = browser.groups.find((item) => item.id === groupId);
        if (!group) throw new Error("group missing");
        if (Object.hasOwn(update, "title")) group.title = update.title;
        if (Object.hasOwn(update, "color")) group.color = update.color;
        if (Object.hasOwn(update, "collapsed")) group.collapsed = update.collapsed;
        return { ...group };
      }
    },
    storage: { session: { get: async () => ({}), set: async () => {} } }
  };

  function adapters() {
    return createAutomaticPromotionChromeAdapters(chrome, {
      requestLock: async (name, callback) => { events.push("lock:" + name); return callback(); },
      readLedger: async () => ({ present: ledger !== undefined, value: structuredClone(ledger) }),
      writeLedger: async (value) => {
        events.push("ledger:write"); counts.writeLedger += 1; ledger = structuredClone(value);
        if (ledgerThrowRemaining > 0) { ledgerThrowRemaining -= 1; throw new Error("ledger throw after effect"); }
      },
      readCompatibleWorkspace: async () => compatibilityRead(canonicalWorkspace, legacyWorkspace),
      writeCompatibleWorkspace: async (value) => {
        counts.writeWorkspace += 1;
        workspace = structuredClone(value);
        canonicalWorkspace = structuredClone(value);
        legacyWorkspace = structuredClone(value);
      },
      readAuthority: async () => structuredClone(authority),
      writeAuthority: async (value) => { counts.writeAuthority += 1; authority = structuredClone(value); },
      getWindow: chrome.windows.get,
      readBrowserProjection: async () => {
        const browserWindows = await chrome.windows.getAll({ populate: true });
        const browserGroups = await chrome.tabGroups.query({});
        return { windows: browserWindows.map((window) => ({ id: window.id, focused: window.focused, tabs: window.tabs.map((tab) => ({ id: tab.id, windowId: tab.windowId, index: tab.index, groupId: tab.groupId, url: tab.url, title: tab.title })), groups: browserGroups.filter((group) => group.windowId === window.id).map((group) => ({ id: group.id, windowId: group.windowId, title: group.title, colour: group.color, collapsed: group.collapsed, tabIds: window.tabs.filter((tab) => tab.groupId === group.id).map((tab) => tab.id) })) })) };
      }
    });
  }

  return {
    adapters, chrome, browser, events, counts,
    get workspace() { return workspace; }, set workspace(value) { workspace = value; canonicalWorkspace = structuredClone(value); legacyWorkspace = structuredClone(value); },
    get canonicalWorkspace() { return canonicalWorkspace; },
    get legacyWorkspace() { return legacyWorkspace; },
    get ledger() { return ledger; }, set ledger(value) { ledger = value; },
    get authority() { return authority; }, set authority(value) { authority = value; }
  };
}

function createWorkspace(options) {
  const targetWindow = options.dedicated || options.allTabsInTarget ? 20 : 10;
  return {
    workspaceId: "workspace-1",
    workspaceRevision: 5,
    name: "Alpha",
    workspaceType: "research",
    placementMode: options.dedicated ? "dedicated_window" : "current_window",
    dedicatedWindowId: options.dedicated ? 20 : null,
    unknownForwardField: { preserve: true },
    journal: [{ entryId: "journal-1", text: "Keep journal" }],
    timeline: [{ eventId: "timeline-1", type: "keep" }],
    tabs: [
      workspaceTab("tab-1", 1, "source", targetWindow, 100),
      workspaceTab("tab-2", 2, "source", targetWindow, 100),
      workspaceTab("tab-3", 3, "question", targetWindow, 101),
      workspaceTab("tab-4", 4, "unassigned", options.fourthTabInSource ? 10 : targetWindow, -1)
    ]
  };
}

function workspaceTab(workspaceTabId, tabId, role, windowId, groupId) {
  return { workspaceTabId, tabId, role, windowId, groupId, alias: "Operator alias " + tabId, url: "https://example.com/" + tabId, originalTitle: "Tab " + tabId, isOpen: true };
}

function createAuthority(options) {
  const root = createSessionAuthority("session-1");
  root.futureRootField = { keep: true };
  root.contexts.push({ contextId: "context-1", contextType: "side_panel", windowId: options.dedicated ? 20 : 10, createdAt: NOW, sourceUrl: SIDE_PANEL_URL });
  let assigned = assignRuntime(root.assignmentRegistry, { workspaceId: "workspace-1", windowId: options.dedicated ? 20 : 10, sourceContextId: "context-1", now: NOW, id: () => "assignment-1" });
  root.assignmentRegistry = assigned.registry;
  if (options.destinationConflict) {
    assigned = assignRuntime(root.assignmentRegistry, { workspaceId: "other-workspace", windowId: 20, sourceContextId: "other-context", now: NOW, id: () => "other-assignment" });
    root.assignmentRegistry = assigned.registry;
  }
  return root;
}

function createBrowser(options) {
  const allTarget = options.dedicated || options.allTabsInTarget;
  const currentTabs = [{ id: 99, windowId: 10, index: 0, groupId: -1, url: "https://unrelated.test", title: "Unrelated" }];
  const targetTabs = [];
  for (const spec of [
    { id: 1, groupId: 100 }, { id: 2, groupId: 100 }, { id: 3, groupId: 101 }, { id: 4, groupId: -1 }
  ]) {
    const useTarget = allTarget && !(options.fourthTabInSource && spec.id === 4);
    const list = useTarget ? targetTabs : currentTabs;
    const windowId = useTarget ? 20 : 10;
    list.push({ id: spec.id, windowId, index: list.length, groupId: spec.groupId, url: "https://example.com/" + spec.id, title: "Tab " + spec.id });
  }
  const windows = [{ id: 10, focused: !allTarget, tabs: currentTabs }];
  if (allTarget) windows.push({ id: 20, focused: true, tabs: targetTabs });
  return {
    windows,
    groups: [
      { id: 100, windowId: allTarget ? 20 : 10, title: "Source · A", color: "blue", collapsed: true },
      { id: 101, windowId: allTarget ? 20 : 10, title: "Question · A", color: "red", collapsed: false }
    ],
    nextGroupId: 200
  };
}

function compatibilityRead(canonical, legacy) {
  const equivalent = JSON.stringify(canonical) === JSON.stringify(legacy);
  return {
    canonicalPresent: canonical !== undefined,
    legacyPresent: legacy !== undefined,
    equivalent,
    conflict: canonical !== undefined && legacy !== undefined && !equivalent,
    canonicalValue: structuredClone(canonical),
    legacyValue: structuredClone(legacy),
    value: structuredClone(canonical ?? legacy)
  };
}

function removeTab(browser, tabId) {
  for (const window of browser.windows) {
    const index = window.tabs.findIndex((tab) => tab.id === tabId);
    if (index >= 0) return window.tabs.splice(index, 1)[0];
  }
  throw new Error("tab missing");
}

function cleanupGroups(browser) {
  const represented = new Set(browser.windows.flatMap((window) => window.tabs).map((tab) => tab.groupId).filter((id) => id >= 0));
  browser.groups = browser.groups.filter((group) => represented.has(group.id));
}

function reindex(browser) {
  browser.windows.forEach((window) => window.tabs.forEach((tab, index) => { tab.index = index; tab.windowId = window.id; }));
}

function findBrowserTab(browser, tabId) { return browser.windows.flatMap((window) => window.tabs).find((tab) => tab.id === tabId); }
function findTab(fixture, tabId) { return findBrowserTab(fixture.browser, tabId); }
