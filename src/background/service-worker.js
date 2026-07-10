import { scheduleWorkspaceProjectionReconciliation } from "../core/workspace-projection-reconciler-v3.js";

chrome.runtime.onInstalled.addListener(() => {
  console.log("Chrome Flow installed.");

  chrome.sidePanel
    .setPanelBehavior({
      openPanelOnActionClick: true
    })
    .catch((error) => {
      console.error("Side panel behavior error:", error);
    });

  scheduleWorkspaceProjectionReconciliation("extension_installed");
});

chrome.runtime.onStartup.addListener(() => {
  scheduleWorkspaceProjectionReconciliation("extension_startup");
});

chrome.tabs.onCreated.addListener((tab) => {
  scheduleWorkspaceProjectionReconciliation("tab_created", {
    tabId: tab.id ?? null,
    windowId: tab.windowId ?? null
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!Object.keys(changeInfo || {}).length) return;
  scheduleWorkspaceProjectionReconciliation("tab_updated", {
    tabId,
    windowId: tab?.windowId ?? null,
    status: changeInfo.status || "",
    urlChanged: Object.prototype.hasOwnProperty.call(changeInfo, "url"),
    titleChanged: Object.prototype.hasOwnProperty.call(changeInfo, "title")
  });
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  scheduleWorkspaceProjectionReconciliation("tab_removed", {
    tabId,
    windowId: removeInfo?.windowId ?? null,
    isWindowClosing: Boolean(removeInfo?.isWindowClosing)
  });
});

chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
  scheduleWorkspaceProjectionReconciliation("tab_moved", {
    tabId,
    windowId: moveInfo?.windowId ?? null,
    fromIndex: moveInfo?.fromIndex ?? null,
    toIndex: moveInfo?.toIndex ?? null
  });
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  scheduleWorkspaceProjectionReconciliation("tab_attached", {
    tabId,
    windowId: attachInfo?.newWindowId ?? null,
    position: attachInfo?.newPosition ?? null
  });
});

chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
  scheduleWorkspaceProjectionReconciliation("tab_detached", {
    tabId,
    windowId: detachInfo?.oldWindowId ?? null,
    position: detachInfo?.oldPosition ?? null
  });
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  scheduleWorkspaceProjectionReconciliation("tab_replaced", {
    addedTabId,
    removedTabId
  });
});

chrome.windows.onRemoved.addListener((windowId) => {
  scheduleWorkspaceProjectionReconciliation("window_removed", { windowId });
});

if (chrome.tabGroups?.onCreated) {
  chrome.tabGroups.onCreated.addListener((group) => {
    scheduleWorkspaceProjectionReconciliation("tab_group_created", {
      groupId: group?.id ?? null,
      windowId: group?.windowId ?? null
    });
  });
}

if (chrome.tabGroups?.onUpdated) {
  chrome.tabGroups.onUpdated.addListener((group) => {
    scheduleWorkspaceProjectionReconciliation("tab_group_updated", {
      groupId: group?.id ?? null,
      windowId: group?.windowId ?? null
    });
  });
}

if (chrome.tabGroups?.onRemoved) {
  chrome.tabGroups.onRemoved.addListener((group) => {
    scheduleWorkspaceProjectionReconciliation("tab_group_removed", {
      groupId: group?.id ?? null,
      windowId: group?.windowId ?? null
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "chrome-flow-reconcile-workspace-projection") return false;

  scheduleWorkspaceProjectionReconciliation(message.trigger || "sidepanel_startup", {
    senderTabId: sender?.tab?.id ?? null,
    senderWindowId: sender?.tab?.windowId ?? null
  });
  sendResponse({ accepted: true });
  return false;
});
