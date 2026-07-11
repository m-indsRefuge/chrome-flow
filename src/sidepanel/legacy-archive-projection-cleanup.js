import { appendRuntimeDiagnostic } from "../core/workspace-runtime-store.js";

const WORKSPACE_KEY = "chromeFlowWorkspace";
const CLEANUP_VERSION = "legacy_archive_projection_cleanup_v0.1";
let cleanupInProgress = false;

installLegacyArchiveProjectionCleanup();

function installLegacyArchiveProjectionCleanup() {
  if (globalThis.chrome?.storage?.onChanged?.addListener) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes?.[WORKSPACE_KEY]?.newValue) return;
      void sanitizeAndPersistLegacyRestoredWorkspace(changes[WORKSPACE_KEY].newValue, "storage_change");
    });
  }

  void sanitizeCurrentLegacyRestoredWorkspace();
}

async function sanitizeCurrentLegacyRestoredWorkspace() {
  if (!globalThis.chrome?.storage?.local?.get) return;

  try {
    const result = await chrome.storage.local.get(WORKSPACE_KEY);
    if (result?.[WORKSPACE_KEY]) {
      await sanitizeAndPersistLegacyRestoredWorkspace(result[WORKSPACE_KEY], "module_start");
    }
  } catch (error) {
    await appendRuntimeDiagnostic("warn", "legacy_archive_projection_cleanup_startup_check_failed", "Could not inspect the current workspace for legacy archive projection cleanup.", {
      error: summarizeError(error)
    });
  }
}

async function sanitizeAndPersistLegacyRestoredWorkspace(workspace, source) {
  if (cleanupInProgress || !globalThis.chrome?.storage?.local?.set) return null;

  const restoreEvent = findLatestLegacyArchiveRestoreEvent(workspace);
  if (!restoreEvent) return null;

  const previousCleanup = workspace?.legacyArchiveProjectionCleanup || {};
  if (previousCleanup.version === CLEANUP_VERSION && previousCleanup.restoreEventId === restoreEvent.eventId) {
    return null;
  }

  cleanupInProgress = true;

  try {
    const result = await sanitizeLegacyRestoredWorkspaceProjection(workspace, {
      restoreEvent,
      resolveLiveTab: resolveCurrentLiveTab
    });

    await chrome.storage.local.set({ [WORKSPACE_KEY]: result.workspace });
    await appendRuntimeDiagnostic(
      result.summary.failedVerificationCount > 0 ? "warn" : "info",
      "legacy_archive_projection_cleanup_applied",
      "Legacy archive restore live projection identifiers were normalized before continued runtime use.",
      {
        source,
        cleanupVersion: CLEANUP_VERSION,
        workspaceId: result.workspace.workspaceId || "",
        restoreEventId: restoreEvent.eventId || "",
        archiveId: restoreEvent.archiveId || result.workspace.restoredFromArchiveId || "",
        summary: result.summary,
        activeRuntimeAuthority: "chrome.storage.local",
        unifiedWorkspaceLibraryResumeChanged: false
      }
    );

    window.dispatchEvent(new CustomEvent("chrome-flow-legacy-archive-projection-cleanup-applied", {
      detail: {
        workspaceId: result.workspace.workspaceId || "",
        restoreEventId: restoreEvent.eventId || "",
        summary: result.summary
      }
    }));

    return result;
  } catch (error) {
    await appendRuntimeDiagnostic("error", "legacy_archive_projection_cleanup_failed", "Legacy archive restore projection cleanup failed.", {
      source,
      workspaceId: workspace?.workspaceId || "",
      restoreEventId: restoreEvent?.eventId || "",
      error: summarizeError(error)
    });
    return null;
  } finally {
    cleanupInProgress = false;
  }
}

async function sanitizeLegacyRestoredWorkspaceProjection(workspace, options = {}) {
  const restoreEvent = options.restoreEvent || findLatestLegacyArchiveRestoreEvent(workspace);
  const resolveLiveTab = options.resolveLiveTab || resolveCurrentLiveTab;

  if (!restoreEvent) {
    return {
      workspace: cloneValue(workspace),
      summary: {
        applicable: false,
        reason: "legacy_archive_restore_event_missing",
        tabCount: Array.isArray(workspace?.tabs) ? workspace.tabs.length : 0,
        reopenedVerifiedCount: 0,
        notReopenedClearedCount: 0,
        failedVerificationCount: 0,
        staleIdentifierCountAfterCleanup: countTopLevelLiveProjectionIdentifiers(workspace?.tabs || [])
      }
    };
  }

  const reopenedWorkspaceTabIds = new Set(
    Array.isArray(restoreEvent.restoredWorkspaceTabIds)
      ? restoreEvent.restoredWorkspaceTabIds.filter(Boolean)
      : []
  );
  const sourceTabs = Array.isArray(workspace?.tabs) ? workspace.tabs : [];
  const cleanedTabs = [];
  const details = [];

  for (const sourceTab of sourceTabs) {
    const workspaceTabId = sourceTab?.workspaceTabId || "";
    const intendedReopened = reopenedWorkspaceTabIds.has(workspaceTabId);

    if (!intendedReopened) {
      const cleaned = clearLiveProjectionIdentifiers(sourceTab, "not_reopened_by_legacy_restore");
      cleanedTabs.push(cleaned);
      details.push(summarizeCleanupDetail(sourceTab, cleaned, "not_reopened_cleared", null));
      continue;
    }

    const verification = await verifyReopenedTab(sourceTab, resolveLiveTab);
    if (!verification.verified) {
      const cleaned = clearLiveProjectionIdentifiers(sourceTab, "legacy_reopen_verification_failed");
      cleanedTabs.push(cleaned);
      details.push(summarizeCleanupDetail(sourceTab, cleaned, "reopened_verification_failed", verification.reason));
      continue;
    }

    const liveTab = verification.liveTab;
    const cleaned = {
      ...sourceTab,
      tabId: liveTab.id,
      windowId: Number.isInteger(liveTab.windowId) ? liveTab.windowId : null,
      groupId: Number.isInteger(liveTab.groupId) ? liveTab.groupId : -1,
      isOpen: true,
      url: liveTab.url || sourceTab.url || "",
      title: liveTab.title || sourceTab.title || sourceTab.originalTitle || "",
      originalTitle: sourceTab.originalTitle || liveTab.title || sourceTab.title || "",
      legacyRestoreProjectionState: "reopened_verified_live",
      legacyProjectionVerifiedAt: new Date().toISOString()
    };
    cleanedTabs.push(cleaned);
    details.push(summarizeCleanupDetail(sourceTab, cleaned, "reopened_verified_live", verification.reason));
  }

  const reopenedVerifiedCount = details.filter((detail) => detail.outcome === "reopened_verified_live").length;
  const notReopenedClearedCount = details.filter((detail) => detail.outcome === "not_reopened_cleared").length;
  const failedVerificationCount = details.filter((detail) => detail.outcome === "reopened_verification_failed").length;
  const staleIdentifierCountAfterCleanup = countStaleIdentifiersForClosedTabs(cleanedTabs);
  const appliedAt = new Date().toISOString();
  const summary = {
    applicable: true,
    cleanupVersion: CLEANUP_VERSION,
    restoreEventId: restoreEvent.eventId || "",
    tabCount: cleanedTabs.length,
    intendedReopenedCount: reopenedWorkspaceTabIds.size,
    reopenedVerifiedCount,
    notReopenedClearedCount,
    failedVerificationCount,
    staleIdentifierCountAfterCleanup,
    details
  };

  return {
    workspace: {
      ...cloneValue(workspace),
      tabs: cleanedTabs,
      legacyArchiveProjectionCleanup: {
        version: CLEANUP_VERSION,
        appliedAt,
        restoreEventId: restoreEvent.eventId || "",
        archiveId: restoreEvent.archiveId || workspace?.restoredFromArchiveId || "",
        reopenedVerifiedCount,
        notReopenedClearedCount,
        failedVerificationCount,
        staleIdentifierCountAfterCleanup
      }
    },
    summary
  };
}

async function verifyReopenedTab(tab, resolveLiveTab) {
  const tabId = Number(tab?.tabId);
  if (!Number.isInteger(tabId) || tabId <= 0) {
    return { verified: false, reason: "reopened_tab_id_missing", liveTab: null };
  }

  let liveTab = null;
  try {
    liveTab = await resolveLiveTab(tabId);
  } catch (_error) {
    return { verified: false, reason: "reopened_tab_not_live", liveTab: null };
  }

  if (!liveTab || liveTab.id !== tabId) {
    return { verified: false, reason: "reopened_tab_id_mismatch", liveTab: liveTab || null };
  }

  const savedUrl = normalizeIdentityUrl(tab?.url || "");
  const liveUrl = normalizeIdentityUrl(liveTab?.url || "");
  if (!savedUrl || savedUrl !== liveUrl) {
    return { verified: false, reason: "reopened_tab_url_mismatch", liveTab };
  }

  return { verified: true, reason: "reopened_tab_id_and_url_verified", liveTab };
}

function clearLiveProjectionIdentifiers(tab, state) {
  return {
    ...tab,
    tabId: null,
    windowId: null,
    groupId: -1,
    isOpen: false,
    legacyRestoreProjectionState: state,
    legacyProjectionVerifiedAt: new Date().toISOString()
  };
}

function findLatestLegacyArchiveRestoreEvent(workspace) {
  const timeline = Array.isArray(workspace?.timeline) ? workspace.timeline : [];
  return [...timeline].reverse().find((event) => event?.type === "archive_restored" && event?.eventId) || null;
}

async function resolveCurrentLiveTab(tabId) {
  if (!globalThis.chrome?.tabs?.get) throw new Error("Chrome tabs API is unavailable.");
  return chrome.tabs.get(tabId);
}

function summarizeCleanupDetail(sourceTab, cleanedTab, outcome, verificationReason) {
  return {
    workspaceTabId: sourceTab?.workspaceTabId || "",
    outcome,
    verificationReason: verificationReason || "",
    before: {
      tabId: Number.isInteger(sourceTab?.tabId) ? sourceTab.tabId : null,
      windowId: Number.isInteger(sourceTab?.windowId) ? sourceTab.windowId : null,
      groupId: Number.isInteger(sourceTab?.groupId) ? sourceTab.groupId : -1,
      isOpen: sourceTab?.isOpen !== false
    },
    after: {
      tabId: Number.isInteger(cleanedTab?.tabId) ? cleanedTab.tabId : null,
      windowId: Number.isInteger(cleanedTab?.windowId) ? cleanedTab.windowId : null,
      groupId: Number.isInteger(cleanedTab?.groupId) ? cleanedTab.groupId : -1,
      isOpen: cleanedTab?.isOpen === true,
      state: cleanedTab?.legacyRestoreProjectionState || ""
    }
  };
}

function countStaleIdentifiersForClosedTabs(tabs) {
  return (Array.isArray(tabs) ? tabs : []).filter((tab) => {
    if (tab?.isOpen === true) return false;
    return Number.isInteger(tab?.tabId)
      || Number.isInteger(tab?.windowId)
      || (Number.isInteger(tab?.groupId) && tab.groupId !== -1);
  }).length;
}

function countTopLevelLiveProjectionIdentifiers(tabs) {
  return (Array.isArray(tabs) ? tabs : []).filter((tab) => {
    return Number.isInteger(tab?.tabId)
      || Number.isInteger(tab?.windowId)
      || (Number.isInteger(tab?.groupId) && tab.groupId !== -1);
  }).length;
}

function normalizeIdentityUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  try {
    const url = new URL(text);
    url.hash = "";
    return url.toString();
  } catch (_error) {
    return text.split("#")[0];
  }
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function summarizeError(error) {
  if (!error) return { message: "Unknown error" };
  return {
    name: error.name || "Error",
    message: error.message || String(error),
    stack: typeof error.stack === "string" ? error.stack.slice(0, 2000) : ""
  };
}

export {
  CLEANUP_VERSION,
  findLatestLegacyArchiveRestoreEvent,
  sanitizeLegacyRestoredWorkspaceProjection
};