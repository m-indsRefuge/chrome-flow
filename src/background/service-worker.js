import { scheduleWorkspaceProjectionReconciliation } from "../core/automatic-workspace-projection-reconciler.js";
import { CONSTELLATION_PRODUCT_NAME } from "../core/product-identity.js";
import { EVENT_IDENTITIES } from "../core/constellation-identity-contract.js";
import { coordinateJournalAppend } from "../core/journal-append-coordination/coordinator.js";
import { createChromeJournalAdapters } from "../core/journal-append-coordination/chrome-adapter.js";
import { JOURNAL_APPEND_REQUEST_SCHEMA, response as journalResponse } from "../core/journal-append-coordination/contract.js";

chrome.runtime.onInstalled.addListener(() => {
  console.log(CONSTELLATION_PRODUCT_NAME + " installed.");

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
  if (message?.schema === JOURNAL_APPEND_REQUEST_SCHEMA) {
    const expectedUrl = chrome.runtime.getURL("src/sidepanel/sidepanel.html");
    if (sender?.id !== chrome.runtime.id || sender?.url !== expectedUrl) { sendResponse(journalResponse(message, "rejected", { reason: "sender_not_authorized" })); return false; }
    coordinateJournalAppend(message, createChromeJournalAdapters(chrome)).then(sendResponse, () => sendResponse(journalResponse(message, "failed", { reason: "unhandled_coordination_failure", retrySafe: true })));
    return true;
  }
  const messageType = String(message?.type || "");
  const identity = EVENT_IDENTITIES.reconcileWorkspaceProjection;

  if (messageType !== identity.canonical && messageType !== identity.legacy) {
    return false;
  }

  scheduleWorkspaceProjectionReconciliation(message.trigger || "sidepanel_startup", {
    senderTabId: sender?.tab?.id ?? null,
    senderWindowId: sender?.tab?.windowId ?? null,
    messageIdentity: messageType === identity.canonical ? "canonical" : "legacy_compatible"
  });
  sendResponse({
    accepted: true,
    canonicalType: identity.canonical,
    receivedType: messageType
  });
  return false;
});
