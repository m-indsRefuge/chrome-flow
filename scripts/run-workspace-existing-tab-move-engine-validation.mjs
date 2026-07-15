import { MOVE_REQUEST_SCHEMA } from "../src/core/workspace-existing-tab-move-engine/contract.js";
import { moveExistingWorkspaceTabs } from "../src/core/workspace-existing-tab-move-engine/coordinator.js";

function createTab(id, windowId, index) {
  return { id, windowId, index, groupId: -1, url: "u" + id, title: "t" + id };
}

function scenario(mode, count, options = {}) {
  const targetWindowId = mode === "attach_to_existing_dedicated_window" ? 20 : null;
  const tabs = Array.from({ length: count }, (_, index) => ({
    workspaceTabId: "w" + index,
    tabId: index + 1,
    sourceWindowId: mode === "attach_to_existing_dedicated_window" && index < count - 1 ? 20 : 10,
    sourceGroupId: -1,
    role: "unassigned",
    roleLabel: "Unassigned",
    order: index
  }));
  const state = {
    windows: [
      {
        id: 10,
        focused: true,
        tabs: tabs
          .filter((tab) => tab.sourceWindowId === 10)
          .map((tab, index) => createTab(tab.tabId, 10, index))
          .concat([createTab(99, 10, 99)]),
        groups: []
      },
      {
        id: 20,
        focused: false,
        tabs: tabs
          .filter((tab) => tab.sourceWindowId === 20)
          .map((tab, index) => createTab(tab.tabId, 20, index)),
        groups: []
      }
    ]
  };
  let nextGroupId = 100;

  function findTab(tabId) {
    return state.windows.flatMap((browserWindow) => browserWindow.tabs).find((tab) => tab.id === tabId);
  }

  function detach(tabId) {
    for (const browserWindow of state.windows) {
      browserWindow.tabs = browserWindow.tabs.filter((tab) => tab.id !== tabId);
      browserWindow.tabs.forEach((tab, index) => { tab.index = index; });
    }
  }

  function move(tabIds, windowId) {
    const target = state.windows.find((browserWindow) => browserWindow.id === windowId);
    for (const tabId of tabIds) {
      const tab = findTab(tabId);
      detach(tabId);
      tab.windowId = windowId;
      tab.index = target.tabs.length;
      tab.groupId = -1;
      target.tabs.push(tab);
    }
  }

  const adapters = {
    readBrowserProjection: async () => structuredClone(state),
    createWindowFromTab: async (tabId) => {
      const created = { id: 30, focused: false, tabs: [], groups: [] };
      state.windows.push(created);
      move([tabId], 30);
      if (options.ambiguousCreate) {
        state.windows.push({ id: 31, focused: false, tabs: [], groups: [] });
        return {};
      }
      return { id: 30 };
    },
    moveTabs: async (tabIds, windowId) => {
      move(tabIds, windowId);
      return { tabIds: [...tabIds], windowId };
    },
    groupTabs: async (tabIds, windowId) => {
      const groupId = nextGroupId++;
      const target = state.windows.find((browserWindow) => browserWindow.id === windowId);
      target.groups.push({ id: groupId, windowId, title: "", colour: "grey", collapsed: false, tabIds: [...tabIds] });
      for (const tabId of tabIds) findTab(tabId).groupId = groupId;
      return { groupId, tabIds: [...tabIds], windowId };
    },
    updateGroup: async (groupId, properties) => {
      const group = state.windows.flatMap((browserWindow) => browserWindow.groups).find((item) => item.id === groupId);
      Object.assign(group, properties);
      return { groupId };
    },
    focusWindow: async (windowId) => {
      state.windows.forEach((browserWindow) => { browserWindow.focused = browserWindow.id === windowId; });
      return { windowId };
    }
  };
  const moveRequest = {
    schema: MOVE_REQUEST_SCHEMA,
    operationId: "validation",
    workspaceId: "workspace",
    mode,
    sourceWindowIds: [...new Set(tabs.map((tab) => tab.sourceWindowId))].sort((left, right) => left - right),
    targetWindowId,
    tabs,
    groups: [],
    requestedAt: "evidence"
  };
  return { state, request: moveRequest, adapters };
}

function windowOf(state, tabId) {
  return state.windows.flatMap((browserWindow) => browserWindow.tabs).find((tab) => tab.id === tabId)?.windowId ?? null;
}

const create = scenario("create_dedicated_window", 4);
const createInitialWindowCount = create.state.windows.length;
const createUnrelatedInitialWindow = windowOf(create.state, 99);
const createResult = await moveExistingWorkspaceTabs(create.request, create.adapters);
const createUnrelatedFinalWindow = windowOf(create.state, 99);

const attach = scenario("attach_to_existing_dedicated_window", 5);
const attachInitialWindowCount = attach.state.windows.length;
const attachResult = await moveExistingWorkspaceTabs(attach.request, attach.adapters);

const unassigned = scenario("create_dedicated_window", 4);
const unassignedResult = await moveExistingWorkspaceTabs(unassigned.request, unassigned.adapters);
const unassignedGrouped = unassigned.state.windows
  .flatMap((browserWindow) => browserWindow.tabs)
  .filter((tab) => [1, 2, 3, 4].includes(tab.id))
  .some((tab) => tab.groupId !== -1);

const uncertain = scenario("create_dedicated_window", 4, { ambiguousCreate: true });
const uncertainResult = await moveExistingWorkspaceTabs(uncertain.request, uncertain.adapters);

const output = {
  schema: "constellation-workspace-existing-tab-move-engine-validation-v0.1",
  createMode: {
    status: createResult.status,
    windowCountDelta: create.state.windows.length - createInitialWindowCount,
    movedTabCount: createResult.movedTabIds.length,
    unrelatedTabsMoved: createUnrelatedInitialWindow !== createUnrelatedFinalWindow
  },
  attachMode: {
    status: attachResult.status,
    windowCountDelta: attach.state.windows.length - attachInitialWindowCount,
    movedTabCount: attachResult.movedTabIds.length
  },
  unassignedMode: {
    status: unassignedResult.status,
    unassignedTabsGrouped: unassignedGrouped
  },
  uncertainCreate: {
    status: uncertainResult.status
  }
};

if (
  output.createMode.status !== "completed_verified" ||
  output.createMode.windowCountDelta !== 1 ||
  output.createMode.movedTabCount !== 4 ||
  output.createMode.unrelatedTabsMoved !== false ||
  output.attachMode.status !== "completed_verified" ||
  output.attachMode.windowCountDelta !== 0 ||
  output.attachMode.movedTabCount !== 1 ||
  output.unassignedMode.status !== "completed_verified" ||
  output.unassignedMode.unassignedTabsGrouped !== false ||
  output.uncertainCreate.status !== "indeterminate"
) {
  throw new Error("Workspace existing-tab move-engine validation failed: " + JSON.stringify(output));
}

console.log(JSON.stringify(output));
