import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  MOVE_REQUEST_SCHEMA,
  MOVE_RESULT_SCHEMA,
  snapshotAndValidateProjection
} from "../../src/core/workspace-existing-tab-move-engine/contract.js";
import { moveExistingWorkspaceTabs } from "../../src/core/workspace-existing-tab-move-engine/coordinator.js";
import { checkWorkspaceExistingTabMoveEnginePurity } from "../../scripts/check-runtime-contract-purity.mjs";

const RESULT_KEYS = [
  "schema",
  "status",
  "reason",
  "operationId",
  "workspaceId",
  "mode",
  "targetWindowId",
  "createdWindow",
  "browserMutationStarted",
  "browserMutationVerified",
  "movedTabIds",
  "alreadyInTargetTabIds",
  "unassignedTabIds",
  "createdGroups",
  "verification",
  "retrySafe",
  "warnings",
  "errors"
];

function request(mode = "create_dedicated_window", count = 4) {
  const tabs = Array.from({ length: count }, (_, index) => ({
    workspaceTabId: "w" + (index + 1),
    tabId: index + 1,
    sourceWindowId: mode === "attach_to_existing_dedicated_window" && index < 4 ? 20 : 10,
    sourceGroupId: index < 2 && mode === "attach_to_existing_dedicated_window" ? 90 : -1,
    role: index < 2 ? "research" : "unassigned",
    roleLabel: index < 2 ? "Research" : "Unassigned",
    order: index
  }));
  return {
    schema: MOVE_REQUEST_SCHEMA,
    operationId: "op-1",
    workspaceId: "workspace-1",
    mode,
    sourceWindowIds: [...new Set(tabs.map((tab) => tab.sourceWindowId))].sort((left, right) => left - right),
    targetWindowId: mode === "attach_to_existing_dedicated_window" ? 20 : null,
    tabs,
    groups: [
      {
        role: "research",
        roleLabel: "Research",
        workspaceTabIds: ["w1", "w2"],
        colour: "blue",
        collapsed: false
      }
    ],
    requestedAt: "2026-07-14T00:00:00.000Z"
  };
}

function createTab(id, windowId, index, groupId = -1) {
  return { id, windowId, index, groupId, url: "u" + id, title: "t" + id };
}

function fake(options = {}) {
  let nextWindow = 30;
  let nextGroup = 100;
  let createCalls = 0;
  let moveCalls = 0;
  let groupCalls = 0;
  let updateCalls = 0;
  let focusCalls = 0;
  const state = {
    windows: [
      {
        id: 10,
        focused: true,
        tabs: [1, 2, 3, 4].map((id, index) => createTab(id, 10, index)),
        groups: []
      },
      { id: 20, focused: false, tabs: [], groups: [] }
    ]
  };

  if (options.fifth) {
    state.windows[0].tabs = [createTab(5, 10, 0)];
    state.windows[1].tabs = [1, 2, 3, 4].map((id, index) =>
      createTab(id, 20, index, id < 3 ? 90 : -1)
    );
    state.windows[1].groups = [
      {
        id: 90,
        windowId: 20,
        title: "Research",
        colour: "blue",
        collapsed: false,
        tabIds: [1, 2]
      }
    ];
  }
  if (options.unrelated) state.windows[0].tabs.push(createTab(99, 10, 99));

  function findWindow(windowId) {
    return state.windows.find((browserWindow) => browserWindow.id === windowId);
  }

  function findTab(tabId) {
    return state.windows.flatMap((browserWindow) => browserWindow.tabs).find((tab) => tab.id === tabId);
  }

  function removeTabFromGroups(tabId) {
    for (const browserWindow of state.windows) {
      for (const group of browserWindow.groups) {
        group.tabIds = group.tabIds.filter((id) => id !== tabId);
      }
      browserWindow.groups = browserWindow.groups.filter((group) => group.tabIds.length > 0);
    }
  }

  function detach(tabId) {
    removeTabFromGroups(tabId);
    for (const browserWindow of state.windows) {
      browserWindow.tabs = browserWindow.tabs.filter((tab) => tab.id !== tabId);
      browserWindow.tabs.forEach((tab, index) => { tab.index = index; });
    }
  }

  function move(tabIds, windowId) {
    const target = findWindow(windowId);
    for (const tabId of tabIds) {
      const tab = findTab(tabId);
      detach(tabId);
      tab.windowId = windowId;
      tab.index = target.tabs.length;
      tab.groupId = -1;
      target.tabs.push(tab);
    }
  }

  function group(tabIds, windowId) {
    const target = findWindow(windowId);
    for (const tabId of tabIds) {
      removeTabFromGroups(tabId);
      findTab(tabId).groupId = -1;
    }
    const groupId = nextGroup++;
    target.groups.push({
      id: groupId,
      windowId,
      title: "",
      colour: "grey",
      collapsed: false,
      tabIds: [...tabIds]
    });
    for (const tabId of tabIds) findTab(tabId).groupId = groupId;
    return groupId;
  }

  function focus(windowId) {
    for (const browserWindow of state.windows) browserWindow.focused = browserWindow.id === windowId;
  }

  const adapters = {
    readBrowserProjection: async () => structuredClone(state),
    createWindowFromTab: async (tabId) => {
      createCalls += 1;
      const browserWindow = { id: nextWindow++, focused: false, tabs: [], groups: [] };
      state.windows.push(browserWindow);
      move([tabId], browserWindow.id);
      if (options.extraWindowOnCreate) {
        state.windows.push({ id: nextWindow++, focused: false, tabs: [], groups: [] });
      }
      if (options.throwCreate) throw new Error("uncertain create");
      if (options.malformedCreate) return {};
      if (options.throwingCreateId) {
        return {
          then: undefined,
          get id() { throw new Error("id trap"); }
        };
      }
      if (options.statefulCreateId) {
        let reads = 0;
        return Object.defineProperty({}, "id", {
          enumerable: true,
          get() {
            reads += 1;
            options.statefulCreateId.reads = reads;
            return browserWindow.id;
          }
        });
      }
      return { id: browserWindow.id };
    },
    moveTabs: async (tabIds, windowId) => {
      moveCalls += 1;
      if (options.partialMove) {
        move(tabIds.slice(0, 1), windowId);
        throw new Error("partial move");
      }
      move(tabIds, windowId);
      if (options.replaceWindowOnMove) {
        const source = findWindow(10);
        const replacementTabs = source ? source.tabs.map((tab, index) => ({ ...tab, windowId: 11, index })) : [];
        state.windows = state.windows.filter((browserWindow) => browserWindow.id !== 10);
        state.windows.push({ id: 11, focused: false, tabs: replacementTabs, groups: [] });
      }
      if (options.throwMoveAfterFull) throw new Error("move applied then threw");
      return { tabIds: [...tabIds], windowId };
    },
    groupTabs: async (tabIds, windowId) => {
      groupCalls += 1;
      if (options.groupFailBeforeEffect) throw new Error("group failed");
      const groupId = group(tabIds, windowId);
      if (options.groupAfterEffectThrow) throw new Error("group applied then threw");
      return { groupId, tabIds: [...tabIds], windowId };
    },
    updateGroup: async (groupId, properties) => {
      updateCalls += 1;
      const browserGroup = state.windows.flatMap((browserWindow) => browserWindow.groups)
        .find((item) => item.id === groupId);
      if (!options.updateFailBeforeEffect) Object.assign(browserGroup, properties);
      if (options.updateFailBeforeEffect) throw new Error("update failed");
      if (options.updateAfterEffectThrow) throw new Error("update applied then threw");
      return { groupId };
    },
    focusWindow: async (windowId) => {
      focusCalls += 1;
      if (!options.focusFailBeforeEffect) focus(windowId);
      if (options.focusFailBeforeEffect) throw new Error("focus failed");
      if (options.focusAfterEffectThrow) throw new Error("focus applied then threw");
      return { windowId };
    }
  };

  return {
    adapters,
    state,
    counts: () => ({ createCalls, moveCalls, groupCalls, updateCalls, focusCalls })
  };
}

function checkResultShape(result) {
  assert.equal(result.schema, MOVE_RESULT_SCHEMA);
  assert.deepEqual(Object.keys(result), RESULT_KEYS);
  assert.equal(Array.isArray(result.verification), true);
}

function checkPassed(result, id) {
  return result.verification.find((item) => item.id === id)?.passed;
}

test("create mode moves four tabs into exactly one new verified window", async () => {
  const fixture = fake({ unrelated: true });
  const result = await moveExistingWorkspaceTabs(request(), fixture.adapters);
  assert.equal(result.status, "completed_verified");
  assert.deepEqual(result.movedTabIds, [1, 2, 3, 4]);
  assert.equal(checkPassed(result, "exactly_one_destination_window_created"), true);
});

test("create mode rejects a second newly-created window", async () => {
  const result = await moveExistingWorkspaceTabs(request(), fake({ extraWindowOnCreate: true }).adapters);
  assert.equal(result.status, "indeterminate");
  assert.equal(checkPassed(result, "exactly_one_destination_window_created"), false);
  assert.equal(checkPassed(result, "no_additional_window_created"), false);
});

test("unrelated tabs remain in their original source window", async () => {
  const fixture = fake({ unrelated: true });
  const result = await moveExistingWorkspaceTabs(request(), fixture.adapters);
  const unrelated = fixture.state.windows.flatMap((browserWindow) => browserWindow.tabs).find((tab) => tab.id === 99);
  assert.equal(result.status, "completed_verified");
  assert.equal(unrelated.windowId, 10);
  assert.equal(checkPassed(result, "no_unrelated_tab_moved"), true);
});

test("attach moves a fifth tab without creating a window", async () => {
  const fixture = fake({ fifth: true, unrelated: true });
  const result = await moveExistingWorkspaceTabs(
    request("attach_to_existing_dedicated_window", 5),
    fixture.adapters
  );
  assert.equal(result.status, "completed_verified");
  assert.equal(fixture.counts().createCalls, 0);
  assert.deepEqual(result.movedTabIds, [5]);
});

test("attach rejects closed-and-replaced windows with equal count", async () => {
  const fixture = fake({ fifth: true, unrelated: true, replaceWindowOnMove: true });
  const result = await moveExistingWorkspaceTabs(
    request("attach_to_existing_dedicated_window", 5),
    fixture.adapters
  );
  assert.equal(result.status, "indeterminate");
  assert.equal(checkPassed(result, "no_additional_window_created"), false);
});

test("attach returns no_change when placement groups and focus are already correct", async () => {
  const fixture = fake({ fifth: true });
  fixture.adapters.moveTabs([5], 20);
  fixture.state.windows.forEach((browserWindow) => { browserWindow.focused = browserWindow.id === 20; });
  const value = request("attach_to_existing_dedicated_window", 5);
  value.tabs[4].sourceWindowId = 20;
  value.sourceWindowIds = [20];
  const result = await moveExistingWorkspaceTabs(value, fixture.adapters);
  assert.equal(result.status, "no_change");
  assert.equal(result.browserMutationStarted, false);
});

test("assigned role creates one verified semantic group", async () => {
  const result = await moveExistingWorkspaceTabs(request(), fake().adapters);
  assert.equal(result.createdGroups.length, 1);
  assert.equal(result.createdGroups[0].role, "research");
  assert.equal(Number.isSafeInteger(result.createdGroups[0].groupId), true);
  assert.deepEqual(result.createdGroups[0].tabIds, [1, 2]);
});

test("two role tabs share one group", async () => {
  const fixture = fake();
  await moveExistingWorkspaceTabs(request(), fixture.adapters);
  const target = fixture.state.windows.find((browserWindow) => browserWindow.id === 30);
  assert.deepEqual(target.groups[0].tabIds, [1, 2]);
});

test("unassigned tabs move and remain ungrouped", async () => {
  const fixture = fake();
  const result = await moveExistingWorkspaceTabs(request(), fixture.adapters);
  const target = fixture.state.windows.find((browserWindow) => browserWindow.id === 30);
  assert.equal(result.status, "completed_verified");
  assert.equal(target.tabs.filter((tab) => [3, 4].includes(tab.id)).every((tab) => tab.groupId === -1), true);
});

test("represented colour and collapse are verified", async () => {
  const result = await moveExistingWorkspaceTabs(request(), fake().adapters);
  assert.equal(checkPassed(result, "represented_group_colour_matches"), true);
  assert.equal(checkPassed(result, "represented_group_collapsed_state_matches"), true);
  assert.equal(result.createdGroups[0].colour, "blue");
  assert.equal(result.createdGroups[0].collapsed, false);
});

test("malformed create result is recovered by reread", async () => {
  const result = await moveExistingWorkspaceTabs(request(), fake({ malformedCreate: true }).adapters);
  assert.equal(result.status, "completed_verified");
});

test("thrown create is recovered by reread", async () => {
  const result = await moveExistingWorkspaceTabs(request(), fake({ throwCreate: true }).adapters);
  assert.equal(result.status, "completed_verified");
});

test("throwing create-result id getter never escapes", async () => {
  const result = await moveExistingWorkspaceTabs(request(), fake({ throwingCreateId: true }).adapters);
  assert.equal(result.status, "completed_verified");
});

test("stateful create-result id getter is read once", async () => {
  const tracker = { reads: 0 };
  const result = await moveExistingWorkspaceTabs(request(), fake({ statefulCreateId: tracker }).adapters);
  assert.equal(result.status, "completed_verified");
  assert.equal(tracker.reads, 1);
});

test("move throw after full effect converges by reread without retry", async () => {
  const fixture = fake({ throwMoveAfterFull: true });
  const result = await moveExistingWorkspaceTabs(request(), fixture.adapters);
  assert.equal(result.status, "completed_verified");
  assert.equal(fixture.counts().moveCalls, 1);
});

test("partial move failure is indeterminate with verification evidence", async () => {
  const result = await moveExistingWorkspaceTabs(request(), fake({ partialMove: true }).adapters);
  assert.equal(result.status, "indeterminate");
  assert.equal(result.browserMutationStarted, true);
  assert.equal(result.verification.length, 16);
  assert.equal(result.movedTabIds.length > 0, true);
});

test("group failure includes fresh reread evidence", async () => {
  const result = await moveExistingWorkspaceTabs(request(), fake({ groupFailBeforeEffect: true }).adapters);
  assert.equal(result.status, "indeterminate");
  assert.equal(result.verification.length, 16);
});

test("group throw after effect is recovered by reread", async () => {
  const result = await moveExistingWorkspaceTabs(request(), fake({ groupAfterEffectThrow: true }).adapters);
  assert.equal(result.status, "completed_verified");
});

test("group update failure includes fresh reread evidence", async () => {
  const result = await moveExistingWorkspaceTabs(request(), fake({ updateFailBeforeEffect: true }).adapters);
  assert.equal(result.status, "indeterminate");
  assert.equal(result.verification.length, 16);
});

test("group update throw after effect is recovered by reread", async () => {
  const result = await moveExistingWorkspaceTabs(request(), fake({ updateAfterEffectThrow: true }).adapters);
  assert.equal(result.status, "completed_verified");
});

test("focus failure cannot succeed", async () => {
  const result = await moveExistingWorkspaceTabs(request(), fake({ focusFailBeforeEffect: true }).adapters);
  assert.equal(result.status, "indeterminate");
  assert.equal(checkPassed(result, "target_window_focused"), false);
});

test("focus throw after effect is recovered by reread", async () => {
  const result = await moveExistingWorkspaceTabs(request(), fake({ focusAfterEffectThrow: true }).adapters);
  assert.equal(result.status, "completed_verified");
  assert.equal(checkPassed(result, "target_window_focused"), true);
});

test("duplicate workspace tab identity is invalid before adapters", async () => {
  const value = request();
  value.tabs[1].workspaceTabId = "w1";
  let reads = 0;
  const result = await moveExistingWorkspaceTabs(value, {
    get readBrowserProjection() {
      reads += 1;
      return async () => ({});
    }
  });
  assert.equal(result.status, "invalid");
  assert.equal(reads, 0);
});

test("duplicate semantic role groups are invalid", async () => {
  const value = request();
  value.groups.push({
    role: "research",
    roleLabel: "Research 2",
    workspaceTabIds: ["w1", "w2"]
  });
  assert.equal((await moveExistingWorkspaceTabs(value, {})).status, "invalid");
});

test("duplicate semantic group labels are invalid", async () => {
  const value = request();
  value.tabs[2].role = "reference";
  value.tabs[2].roleLabel = "Research";
  value.groups.push({ role: "reference", roleLabel: "Research", workspaceTabIds: ["w3"] });
  assert.equal((await moveExistingWorkspaceTabs(value, {})).status, "invalid");
});

test("group membership referencing unknown tab is invalid", async () => {
  const value = request();
  value.groups[0].workspaceTabIds[0] = "missing";
  assert.equal((await moveExistingWorkspaceTabs(value, {})).status, "invalid");
});

test("throwing request getter cannot escape", async () => {
  const value = request();
  Object.defineProperty(value, "schema", { enumerable: true, get() { throw new Error("trap"); } });
  assert.equal((await moveExistingWorkspaceTabs(value, {})).status, "invalid");
});

test("stateful request getters are read once", async () => {
  const value = request();
  let reads = 0;
  Object.defineProperty(value, "operationId", {
    enumerable: true,
    get() {
      reads += 1;
      return "op-" + reads;
    }
  });
  await moveExistingWorkspaceTabs(value, fake().adapters);
  assert.equal(reads, 1);
});

test("cyclic request values fail closed", async () => {
  const value = request();
  value.requestedAt = value;
  assert.equal((await moveExistingWorkspaceTabs(value, {})).status, "invalid");
});

test("symbol request fields fail closed", async () => {
  const value = request();
  value[Symbol("x")] = true;
  assert.equal((await moveExistingWorkspaceTabs(value, {})).status, "invalid");
});

test("request array symbols and non-index properties fail closed", async () => {
  const value = request();
  value.tabs.extra = true;
  assert.equal((await moveExistingWorkspaceTabs(value, {})).status, "invalid");
  const symbolValue = request();
  symbolValue.tabs[Symbol("x")] = true;
  assert.equal((await moveExistingWorkspaceTabs(symbolValue, {})).status, "invalid");
});

test("unsafe request IDs fail closed", async () => {
  const value = request();
  value.tabs[0].tabId = Number.MAX_SAFE_INTEGER + 1;
  assert.equal((await moveExistingWorkspaceTabs(value, {})).status, "invalid");
});

test("caller request remains unmodified", async () => {
  const value = request();
  const before = structuredClone(value);
  await moveExistingWorkspaceTabs(value, fake().adapters);
  assert.deepEqual(value, before);
});

test("missing projection windows fails closed before mutation", async () => {
  const fixture = fake();
  fixture.adapters.readBrowserProjection = async () => ({});
  const result = await moveExistingWorkspaceTabs(request(), fixture.adapters);
  assert.equal(result.status, "failed");
  assert.equal(fixture.counts().createCalls, 0);
});

test("symbol-bearing projection fails closed before mutation", async () => {
  const fixture = fake();
  const projection = structuredClone(fixture.state);
  projection[Symbol("x")] = true;
  fixture.adapters.readBrowserProjection = async () => projection;
  const result = await moveExistingWorkspaceTabs(request(), fixture.adapters);
  assert.equal(result.status, "failed");
  assert.equal(fixture.counts().createCalls, 0);
});

test("duplicate projection window IDs fail closed", async () => {
  const projection = {
    windows: [
      { id: 10, focused: true, tabs: [], groups: [] },
      { id: 10, focused: false, tabs: [], groups: [] }
    ]
  };
  assert.equal(snapshotAndValidateProjection(projection).ok, false);
});

test("duplicate global projection tab IDs fail closed", async () => {
  const projection = {
    windows: [
      { id: 10, focused: true, tabs: [createTab(1, 10, 0)], groups: [] },
      { id: 20, focused: false, tabs: [createTab(1, 20, 0)], groups: [] }
    ]
  };
  assert.equal(snapshotAndValidateProjection(projection).ok, false);
});

test("projection tab container mismatch fails closed", async () => {
  const projection = { windows: [{ id: 10, focused: true, tabs: [createTab(1, 20, 0)], groups: [] }] };
  assert.equal(snapshotAndValidateProjection(projection).ok, false);
});

test("projection group container mismatch fails closed", async () => {
  const projection = {
    windows: [{
      id: 10,
      focused: true,
      tabs: [createTab(1, 10, 0, 2)],
      groups: [{ id: 2, windowId: 20, title: "R", colour: "blue", collapsed: false, tabIds: [1] }]
    }]
  };
  assert.equal(snapshotAndValidateProjection(projection).ok, false);
});

test("malformed group tabIds fails closed", async () => {
  const projection = {
    windows: [{
      id: 10,
      focused: true,
      tabs: [createTab(1, 10, 0, 2)],
      groups: [{ id: 2, windowId: 10, title: "R", colour: "blue", collapsed: false, tabIds: "1" }]
    }]
  };
  assert.equal(snapshotAndValidateProjection(projection).ok, false);
});

test("projection tab and group membership disagreement fails closed", async () => {
  const projection = {
    windows: [{
      id: 10,
      focused: true,
      tabs: [createTab(1, 10, 0, -1)],
      groups: [{ id: 2, windowId: 10, title: "R", colour: "blue", collapsed: false, tabIds: [1] }]
    }]
  };
  assert.equal(snapshotAndValidateProjection(projection).ok, false);
});

test("projection getters are snapshotted once", async () => {
  const fixture = fake();
  const source = structuredClone(fixture.state);
  let windowsReads = 0;
  const projection = Object.defineProperty({}, "windows", {
    enumerable: true,
    get() {
      windowsReads += 1;
      return source.windows;
    }
  });
  let calls = 0;
  fixture.adapters.readBrowserProjection = async () => {
    calls += 1;
    return calls === 1 ? projection : structuredClone(fixture.state);
  };
  const result = await moveExistingWorkspaceTabs(request(), fixture.adapters);
  assert.equal(result.status, "completed_verified");
  assert.equal(windowsReads, 1);
});

test("adapter projection remains unmodified", async () => {
  const fixture = fake();
  const readOnly = structuredClone(fixture.state);
  const before = structuredClone(readOnly);
  let first = true;
  fixture.adapters.readBrowserProjection = async () => {
    if (first) {
      first = false;
      return readOnly;
    }
    return structuredClone(fixture.state);
  };
  await moveExistingWorkspaceTabs(request(), fixture.adapters);
  assert.deepEqual(readOnly, before);
});

test("every terminal status uses the exact stable result shape", async () => {
  const completed = await moveExistingWorkspaceTabs(request(), fake().adapters);
  const invalid = await moveExistingWorkspaceTabs(null, null);
  const conflictFixture = fake();
  conflictFixture.state.windows[0].tabs[0].windowId = 20;
  const conflict = await moveExistingWorkspaceTabs(request(), conflictFixture.adapters);
  const indeterminate = await moveExistingWorkspaceTabs(request(), fake({ partialMove: true }).adapters);
  const failedFixture = fake();
  failedFixture.adapters.createWindowFromTab = async () => { throw new Error("no effect"); };
  const failed = await moveExistingWorkspaceTabs(request(), failedFixture.adapters);
  const noChangeFixture = fake({ fifth: true });
  noChangeFixture.adapters.moveTabs([5], 20);
  noChangeFixture.state.windows.forEach((browserWindow) => { browserWindow.focused = browserWindow.id === 20; });
  const noChangeRequest = request("attach_to_existing_dedicated_window", 5);
  noChangeRequest.tabs[4].sourceWindowId = 20;
  noChangeRequest.sourceWindowIds = [20];
  const noChange = await moveExistingWorkspaceTabs(noChangeRequest, noChangeFixture.adapters);
  for (const result of [completed, invalid, conflict, indeterminate, failed, noChange]) checkResultShape(result);
});

test("manual function delegates through the manual-placement transaction without direct browser mutation", async () => {
  const source = await readFile(new URL("../../src/sidepanel/sidepanel.js", import.meta.url), "utf8");
  const body = source.slice(
    source.indexOf("async function moveWorkspaceTabsIntoNewWindow"),
    source.indexOf("async function arrangeWorkspaceTabsByRoleOrder")
  );
  assert.match(body, /runtimeWorkspaceAuthority\.bootstrapExisting/);
  assert.match(body, /workspaceManualPlacementClient\.submit/);
  assert.doesNotMatch(body, /moveExistingWorkspaceTabs|createExistingTabMoveChromeAdapters/);
  assert.doesNotMatch(body, /chrome\.windows\.create|chrome\.tabs\.move/);
});

test("manual transaction retains the shared move adapter whose focus failure cannot be swallowed", async () => {
  const [manualAdapterSource, sharedAdapterSource] = await Promise.all([
    readFile(new URL("../../src/core/workspace-manual-placement-transaction/chrome-adapter.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/core/workspace-automatic-promotion-integration/chrome-adapter.js", import.meta.url), "utf8")
  ]);
  const body = sharedAdapterSource.slice(
    sharedAdapterSource.indexOf("export function createExistingTabMoveChromeAdapters"),
    sharedAdapterSource.indexOf("export async function recordAutomaticPromotionDiagnostic")
  );
  assert.match(manualAdapterSource, /createAutomaticPromotionChromeAdapters/);
  assert.doesNotMatch(body, /focusNormalWindow/);
  assert.match(body, /chromeApi\.windows\.update\(windowId, \{ state: "normal" \}\)/);
  assert.match(body, /chromeApi\.windows\.update\(windowId, \{ focused: true \}\)/);
});

test("purity checker accepts engine", async () => {
  assert.equal(await checkWorkspaceExistingTabMoveEnginePurity(), 2);
});

async function withPurityFixture(source, action) {
  const directory = await mkdtemp(join(tmpdir(), "constellation-move-purity-"));
  try {
    await mkdir(join(directory), { recursive: true });
    await writeFile(join(directory, "contract.js"), "export const ok = true;\n", "utf8");
    await writeFile(join(directory, "coordinator.js"), source, "utf8");
    await action(pathToFileURL(directory + sep));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

for (const [name, source] of [
  ["browser global", "export function bad(){ return chrome.tabs; }\n"],
  ["new Date", "export function bad(){ return new Date(); }\n"],
  ["crypto", "export function bad(){ return crypto.randomUUID(); }\n"],
  ["dynamic import", "export async function bad(){ return import('./contract.js'); }\n"],
  ["import meta", "export const bad = import.meta.url;\n"],
  ["traversal import", "import '../outside.js';\nexport const bad = true;\n"],
  ["template literal", "export const bad = `x`;\n"],
  ["timer", "export function bad(){ return setTimeout(()=>{}, 1); }\n"],
  ["process", "export const bad = process.version;\n"],
  ["console", "export function bad(){ console.log('x'); }\n"]
]) {
  test("purity checker rejects " + name, async () => {
    await withPurityFixture(source, async (url) => {
      await assert.rejects(() => checkWorkspaceExistingTabMoveEnginePurity(url));
    });
  });
}

test("purity checker rejects unexpected artifacts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "constellation-move-purity-"));
  try {
    await writeFile(join(directory, "contract.js"), "export const ok = true;\n", "utf8");
    await writeFile(join(directory, "coordinator.js"), "export const ok = true;\n", "utf8");
    await writeFile(join(directory, "extra.js"), "export const bad = true;\n", "utf8");
    await assert.rejects(() => checkWorkspaceExistingTabMoveEnginePurity(pathToFileURL(directory + sep)));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("canonical ordering rejects noncanonical source window IDs", async () => {
  const value = request();
  value.sourceWindowIds = [20, 10];
  assert.equal((await moveExistingWorkspaceTabs(value, {})).status, "invalid");
});

test("invalid adapters return invalid", async () => {
  assert.equal((await moveExistingWorkspaceTabs(request(), {})).status, "invalid");
});

test("missing attach target is a retry-safe conflict", async () => {
  const fixture = fake();
  fixture.state.windows = fixture.state.windows.filter((browserWindow) => browserWindow.id !== 20);
  const result = await moveExistingWorkspaceTabs(
    request("attach_to_existing_dedicated_window"),
    fixture.adapters
  );
  assert.equal(result.status, "conflict");
  assert.equal(result.retrySafe, true);
});

test("final projection mismatch cannot succeed", async () => {
  const fixture = fake();
  fixture.adapters.updateGroup = async (groupId) => ({ groupId });
  const result = await moveExistingWorkspaceTabs(request(), fixture.adapters);
  assert.notEqual(result.status, "completed_verified");
});
