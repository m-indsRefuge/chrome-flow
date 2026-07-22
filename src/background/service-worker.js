import { scheduleWorkspaceProjectionReconciliation } from "../core/automatic-workspace-projection-reconciler.js";
import { CONSTELLATION_PRODUCT_NAME } from "../core/product-identity.js";
import { EVENT_IDENTITIES } from "../core/constellation-identity-contract.js";
import { coordinateJournalAppend } from "../core/journal-append-coordination/coordinator.js";
import { createChromeJournalAdapters } from "../core/journal-append-coordination/chrome-adapter.js";
import { JOURNAL_APPEND_REQUEST_SCHEMA, response as journalResponse } from "../core/journal-append-coordination/contract.js";
import { coordinateContextRegistration, coordinateWindowCloseCleanup } from "../core/runtime-session-authority/coordinator.js";
import { createChromeRuntimeSessionAuthorityAdapters } from "../core/runtime-session-authority/chrome-adapter.js";
import { createContextResultFromRequest, isContextRegisterMessage, validateContextRegisterRequest, validateSidePanelSender } from "../core/runtime-session-authority/contract.js";
import { handleRuntimeWindowBindingMessage, isRuntimeWindowBindingResolveMessage } from "../core/runtime-window-binding/service-worker-handler.js";
import { handleRuntimeWorkspaceActivationMessage, isRuntimeWorkspaceActivationMessage } from "../core/runtime-workspace-activation/service-worker-handler.js";
import { handleWorkspaceManualPlacementMessage, isWorkspaceManualPlacementMessage } from "../core/workspace-manual-placement-transaction/service-worker-handler.js";
import { handleAutomaticPromotionMessage, isAutomaticPromotionMessage } from "../core/workspace-automatic-promotion-integration/service-worker-handler.js";
import { classifyWorkspaceMembershipMessage, handleWorkspaceMembershipMessage } from "../core/workspace-membership-mutation/service-worker-handler.js";

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
  void cleanupRemovedWindowAuthorityThenReconcile(windowId);
});

async function cleanupRemovedWindowAuthorityThenReconcile(windowId) {
  let cleanupResult;

  try {
    cleanupResult = await coordinateWindowCloseCleanup(
      windowId,
      createChromeRuntimeSessionAuthorityAdapters(chrome)
    );
  } catch (error) {
    cleanupResult = {
      status: "failed",
      reason: "window_authority_cleanup_failed",
      authorityCommitted: false,
      authorityVerified: false,
      error: String(error?.message || error || "unknown_error")
    };
  }

  scheduleWorkspaceProjectionReconciliation("window_removed", {
    windowId,
    authorityCleanupStatus: cleanupResult?.status || "failed",
    authorityCleanupVerified: cleanupResult?.authorityVerified === true,
    authorityCleanupReason: cleanupResult?.reason || ""
  });

  return cleanupResult;
}

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
  const sidePanelUrl = chrome.runtime.getURL("src/sidepanel/sidepanel.html");
  if (isRuntimeWindowBindingResolveMessage(message)) {
    return handleRuntimeWindowBindingMessage(message, sender, sendResponse, {
      chromeApi: chrome,
      runtimeId: chrome.runtime.id,
      sidePanelUrl
    });
  }
  if (isWorkspaceManualPlacementMessage(message)) {
    return handleWorkspaceManualPlacementMessage(message, sender, sendResponse, {
      chromeApi: chrome,
      runtimeId: chrome.runtime.id,
      sidePanelUrl
    });
  }
  if (isRuntimeWorkspaceActivationMessage(message)) {
    return handleRuntimeWorkspaceActivationMessage(message, sender, sendResponse, {
      chromeApi: chrome,
      runtimeId: chrome.runtime.id,
      sidePanelUrl
    });
  }
  const membershipClassification = classifyWorkspaceMembershipMessage(message);
  if (membershipClassification.isMembership) {
    return handleWorkspaceMembershipMessage(message, sender, sendResponse, {
      chromeApi: chrome,
      runtimeId: chrome.runtime.id,
      sidePanelUrl,
      membershipClassification
    });
  }
  if (isAutomaticPromotionMessage(message)) {
    return handleAutomaticPromotionMessage(message, sender, sendResponse, {
      chromeApi: chrome,
      runtimeId: chrome.runtime.id,
      sidePanelUrl
    });
  }
  if (isContextRegisterMessage(message)) {
    const senderValidation = validateSidePanelSender(sender, chrome.runtime.id, sidePanelUrl);
    const requestValidation = validateContextRegisterRequest(message);
    if (!senderValidation.valid || !requestValidation.valid) {
      sendResponse(createContextResultFromRequest(message, { status: "rejected", reason: senderValidation.valid ? "invalid_request" : senderValidation.reason, errors: requestValidation.errors || [] }));
      return false;
    }
    coordinateContextRegistration(message, { sourceUrl: sender.url }, createChromeRuntimeSessionAuthorityAdapters(chrome)).then(sendResponse, () => sendResponse(createContextResultFromRequest(message, { status: "failed", reason: "unhandled_coordination_failure", retrySafe: true })));
    return true;
  }
  if (message?.schema === JOURNAL_APPEND_REQUEST_SCHEMA) {
    if (sender?.id !== chrome.runtime.id || sender?.url !== sidePanelUrl) { sendResponse(journalResponse(message, "rejected", { reason: "sender_not_authorized" })); return false; }
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
