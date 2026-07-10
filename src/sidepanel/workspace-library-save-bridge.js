import { getWorkspace } from "../core/workspace-store.js";

import { saveRuntimeWorkspaceToWorkspaceLibrary } from "../core/workspace-memory-store.js";

import { appendRuntimeDiagnostic } from "../core/workspace-runtime-store.js";

import { refreshWorkspaceLibrarySurfaceDirectly } from "./workspace-library-direct-refresh.js";

const WORKSPACE_STORAGE_KEY = "chromeFlowWorkspace";
const SAVE_SETTLE_DELAY_MS = 450;
const AUTO_SAVE_DEBOUNCE_MS = 900;
const AUTO_SAVE_MINIMUM_INTERVAL_MS = 1500;
const CROSS_CONTEXT_DUPLICATE_WINDOW_MS = 5000;
const CROSS_CONTEXT_SAVE_LOCK_NAME = "chrome-flow-workspace-library-save";
const SHARED_SAVE_COORDINATOR_KEY = "chromeFlowWorkspaceLibrarySaveCoordinator";
const LEGACY_IMPORT_EVENT_TYPE = "legacy_workspace_imported_to_session_db";
const MEANINGFUL_WORKSPACE_EVENT_TYPES = new Set([
  "selected_tabs_added",
  "active_tab_added",
  "workspace_tabs_refreshed",
  "workspace_tab_metadata_refreshed",
  "tab_role_updated",
  "tab_alias_updated",
  "tab_removed_from_workspace",
  "workspace_tabs_cleared",
  "chrome_tab_groups_created",
  "chrome_tab_groups_removed",
  "chrome_tab_groups_collapsed",
  "chrome_tab_groups_expanded",
  "workspace_tabs_arranged_by_role",
  "workspace_tabs_moved_to_new_window",
  "user_journal_added",
  "workspace_archived"
]);

const saveContextId = crypto.randomUUID();
let workspaceLibrarySaveInProgress = false;
let pendingWorkspaceLibrarySave = false;
let autoSaveTimer = null;
let lastSavedSignature = "";
let lastSaveStartedAtMs = 0;
let storageListenerInstalled = false;

installWorkspaceLibrarySaveBridge();

function installWorkspaceLibrarySaveBridge() {
  ensureWorkspaceLibrarySaveStatusSurface();

  const saveButton = document.getElementById("saveWorkspaceButton");
  if (saveButton) {
    saveButton.addEventListener("click", () => {
      void scheduleWorkspaceLibrarySaveFromProductionButton();
    });
  }

  installWorkspaceStorageChangeListener();
}

function ensureWorkspaceLibrarySaveStatusSurface() {
  if (document.getElementById("workspaceLibrarySaveStatus")) return;

  const saveButton = document.getElementById("saveWorkspaceButton");
  if (!saveButton) return;

  const status = document.createElement("p");
  status.id = "workspaceLibrarySaveStatus";
  status.className = "status-message workspace-library-save-status";
  status.textContent = "Save Workspace also updates the Workspace Library.";

  saveButton.insertAdjacentElement("afterend", status);
}

function installWorkspaceStorageChangeListener() {
  if (storageListenerInstalled || !globalThis.chrome?.storage?.onChanged?.addListener) return;
  storageListenerInstalled = true;

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes?.[WORKSPACE_STORAGE_KEY]?.newValue) return;

    const newWorkspace = changes[WORKSPACE_STORAGE_KEY].newValue;
    const oldWorkspace = changes[WORKSPACE_STORAGE_KEY].oldValue || null;
    const source = inferAutoSaveSource(newWorkspace, oldWorkspace);

    if (!source) return;

    scheduleWorkspaceLibraryAutoSave(source);
  });
}

async function scheduleWorkspaceLibrarySaveFromProductionButton() {
  setProductionSaveStatus("Saving workspace to Workspace Library...");
  await runWorkspaceLibrarySave("save_workspace_button", {
    statusMessage: "Workspace saved to Workspace Library.",
    continuationNote: "Saved from the end-user Save Workspace action into Workspace Library."
  });
}

function scheduleWorkspaceLibraryAutoSave(source) {
  if (autoSaveTimer) window.clearTimeout(autoSaveTimer);

  autoSaveTimer = window.setTimeout(() => {
    autoSaveTimer = null;
    void runWorkspaceLibrarySave(source, {
      statusMessage: "Workspace Library updated from latest workspace changes.",
      continuationNote: "Auto-saved from active runtime changes into Workspace Library."
    });
  }, AUTO_SAVE_DEBOUNCE_MS);
}

async function runWorkspaceLibrarySave(source, options = {}) {
  if (workspaceLibrarySaveInProgress) {
    pendingWorkspaceLibrarySave = true;
    setProductionSaveStatus("Workspace Library save is already running; latest changes are queued.");
    return null;
  }

  workspaceLibrarySaveInProgress = true;

  try {
    await delay(SAVE_SETTLE_DELAY_MS);
    const runtimeWorkspace = await getWorkspace();
    const signature = createWorkspaceLibrarySaveSignature(runtimeWorkspace);
    const nowMs = Date.now();

    if (signature === lastSavedSignature && nowMs - lastSaveStartedAtMs < AUTO_SAVE_MINIMUM_INTERVAL_MS) {
      setProductionSaveStatus("Workspace Library is already current.");
      return null;
    }

    lastSaveStartedAtMs = nowMs;

    const result = await runWithCrossContextSaveLock(async () => {
      const coordinator = await getSharedSaveCoordinator();

      if (isRecentMatchingCoordinator(coordinator, signature)) {
        lastSavedSignature = signature;
        setProductionSaveStatus("Workspace Library is already current.");

        await appendRuntimeDiagnostic(
          "info",
          "workspace_library_save_deduplicated_cross_context",
          "Skipped a duplicate Workspace Library save from another side-panel context.",
          {
            source,
            workspaceId: runtimeWorkspace.workspaceId || "",
            contextId: saveContextId,
            matchedContextId: coordinator.contextId || "",
            matchedSource: coordinator.source || "",
            matchedSavedAt: coordinator.savedAt || "",
            duplicateWindowMs: CROSS_CONTEXT_DUPLICATE_WINDOW_MS
          }
        );

        return null;
      }

      const saveResult = await saveActiveRuntimeToWorkspaceLibrary(source, options);

      if (saveResult) {
        await setSharedSaveCoordinator({
          signature,
          workspaceId: saveResult.workspaceId || runtimeWorkspace.workspaceId || "",
          source,
          savedAt: saveResult.savedAt || "",
          completedAtMs: Date.now(),
          contextId: saveContextId
        });
      }

      return saveResult;
    });

    if (result) {
      lastSavedSignature = signature;
    }

    return result;
  } finally {
    workspaceLibrarySaveInProgress = false;

    if (pendingWorkspaceLibrarySave) {
      pendingWorkspaceLibrarySave = false;
      scheduleWorkspaceLibraryAutoSave("coalesced_runtime_workspace_change");
    }
  }
}

async function saveActiveRuntimeToWorkspaceLibrary(source, options = {}) {
  try {
    const runtimeWorkspace = await getWorkspace();
    const savedAt = new Date().toISOString();
    const result = await saveRuntimeWorkspaceToWorkspaceLibrary(runtimeWorkspace, {
      savedAt,
      lifecycleState: "paused",
      continuationNote: options.continuationNote || "Saved from the end-user Save Workspace action into Workspace Library."
    });
    const snapshotIdentity = createSnapshotIdentity(runtimeWorkspace, result);

    await appendRuntimeDiagnostic("info", "workspace_saved_to_workspace_library", "Active workspace saved to Workspace Library from production runtime path.", {
      source,
      saveMode: result.saveMode,
      persistenceMode: result.persistenceMode,
      productionSave: true,
      savedAt,
      workspaceId: result.workspaceId,
      workspaceName: result.workspaceName,
      lifecycleState: result.workspace.lifecycleState,
      tabCount: result.counts.tabs,
      journalEntryCount: result.counts.journalEntries,
      timelineEventCount: result.counts.timelineEvents,
      snapshotIdentity,
      replacementStats: result.replacementStats,
      sessionDbRuntimeSourceOfTruth: result.bridgeStatus.sessionDbRuntimeSourceOfTruth,
      activeWorkspaceRuntimeSource: result.bridgeStatus.activeWorkspaceRuntimeSource,
      migrationMode: result.bridgeStatus.migrationMode
    });

    await refreshWorkspaceLibrarySurfaceDirectly();
    setProductionSaveStatus(options.statusMessage || "Workspace saved to Workspace Library.");
    window.dispatchEvent(new CustomEvent("chrome-flow-workspace-library-save-completed", {
      detail: {
        workspaceId: result.workspaceId,
        workspaceName: result.workspaceName,
        savedAt,
        source,
        persistenceMode: result.persistenceMode,
        snapshotIdentity,
        replacementStats: result.replacementStats
      }
    }));

    return result;
  } catch (error) {
    await appendRuntimeDiagnostic("error", "workspace_save_to_workspace_library_failed", "Could not save active workspace to Workspace Library.", {
      source,
      error: summarizeError(error)
    });
    setProductionSaveStatus("Workspace saved locally, but Workspace Library save failed. Check Developer Diagnostics.");
    return null;
  }
}

function createSnapshotIdentity(runtimeWorkspace, result) {
  const tabs = Array.isArray(runtimeWorkspace?.tabs) ? runtimeWorkspace.tabs : [];
  const journal = Array.isArray(runtimeWorkspace?.journal) ? runtimeWorkspace.journal : [];
  const timeline = Array.isArray(runtimeWorkspace?.timeline) ? runtimeWorkspace.timeline : [];

  return {
    workspaceId: result.workspaceId,
    workspaceTabIds: sortUniqueStrings(tabs.map((tab) => tab?.workspaceTabId)),
    journalEntryIds: sortUniqueStrings(journal.map((entry) => entry?.entryId || entry?.journalEntryId)),
    timelineEventIds: sortUniqueStrings(
      timeline
        .filter((event) => event?.type !== LEGACY_IMPORT_EVENT_TYPE)
        .map((event) => event?.eventId)
    ),
    sessionId: result.session?.sessionId || "",
    projectionId: result.projection?.projectionId || ""
  };
}

function inferAutoSaveSource(newWorkspace, oldWorkspace) {
  if (!isMeaningfulWorkspaceForLibrary(newWorkspace)) return "";

  const newTabs = Array.isArray(newWorkspace.tabs) ? newWorkspace.tabs : [];
  const oldTabs = Array.isArray(oldWorkspace?.tabs) ? oldWorkspace.tabs : [];
  const newJournal = Array.isArray(newWorkspace.journal) ? newWorkspace.journal : [];
  const oldJournal = Array.isArray(oldWorkspace?.journal) ? oldWorkspace.journal : [];
  const latestEventType = getLatestTimelineEventType(newWorkspace);

  if (latestEventType && MEANINGFUL_WORKSPACE_EVENT_TYPES.has(latestEventType)) {
    return "runtime_event_" + latestEventType;
  }

  if (newTabs.length !== oldTabs.length) return "runtime_tabs_changed";
  if (newJournal.length !== oldJournal.length) return "runtime_journal_changed";
  if (tabContentSignature(newTabs) !== tabContentSignature(oldTabs)) return "runtime_tab_content_changed";
  if (journalContentSignature(newJournal) !== journalContentSignature(oldJournal)) return "runtime_journal_content_changed";
  if (tabProjectionSignature(newTabs) !== tabProjectionSignature(oldTabs)) return "runtime_tab_projection_changed";

  return "";
}

function isMeaningfulWorkspaceForLibrary(workspace) {
  if (!workspace?.workspaceId) return false;
  const hasName = Boolean(String(workspace.name || "").trim());
  const hasAim = Boolean(String(workspace.aim || "").trim());
  const hasTabs = Array.isArray(workspace.tabs) && workspace.tabs.length > 0;
  const hasJournal = Array.isArray(workspace.journal) && workspace.journal.length > 0;

  return hasName || hasAim || hasTabs || hasJournal;
}

function getLatestTimelineEventType(workspace) {
  const timeline = Array.isArray(workspace?.timeline) ? workspace.timeline : [];
  return timeline.length ? timeline[timeline.length - 1]?.type || "" : "";
}

function createWorkspaceLibrarySaveSignature(workspace) {
  const tabs = Array.isArray(workspace?.tabs) ? workspace.tabs : [];
  const journal = Array.isArray(workspace?.journal) ? workspace.journal : [];
  const timeline = Array.isArray(workspace?.timeline) ? workspace.timeline : [];

  return JSON.stringify({
    workspaceId: workspace?.workspaceId || "",
    name: workspace?.name || "",
    aim: workspace?.aim || "",
    workspaceType: workspace?.workspaceType || "",
    tabContent: tabContentSignature(tabs),
    tabProjection: tabProjectionSignature(tabs),
    journalContent: journalContentSignature(journal),
    timelineCount: timeline.length,
    latestTimelineEventType: getLatestTimelineEventType(workspace),
    latestTimelineEventId: timeline.length ? timeline[timeline.length - 1]?.eventId || "" : ""
  });
}

function tabContentSignature(tabs) {
  return tabs.map((tab) => [
    tab?.workspaceTabId || "",
    tab?.url || "",
    tab?.originalTitle || tab?.title || "",
    tab?.role || "",
    tab?.alias || ""
  ].join(":"))
    .sort()
    .join("|");
}

function journalContentSignature(entries) {
  return entries.map((entry) => [
    entry?.entryId || entry?.journalEntryId || "",
    entry?.text || "",
    entry?.tag || "",
    entry?.relatedRoleId || entry?.relatedRoleLabel || entry?.relatedRole || "",
    entry?.createdAt || ""
  ].join(":"))
    .sort()
    .join("|");
}

function tabProjectionSignature(tabs) {
  return tabs.map((tab) => [
    tab?.workspaceTabId || "",
    tab?.tabId || "",
    tab?.windowId || "",
    tab?.groupId || "",
    tab?.isOpen === false ? "closed" : "open"
  ].join(":"))
    .sort()
    .join("|");
}

function sortUniqueStrings(values) {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value))).sort();
}

async function runWithCrossContextSaveLock(callback) {
  if (globalThis.navigator?.locks?.request) {
    return navigator.locks.request(CROSS_CONTEXT_SAVE_LOCK_NAME, { mode: "exclusive" }, callback);
  }

  return callback();
}

async function getSharedSaveCoordinator() {
  const storageArea = getCoordinatorStorageArea();
  const result = await storageArea.get(SHARED_SAVE_COORDINATOR_KEY);
  const coordinator = result?.[SHARED_SAVE_COORDINATOR_KEY];

  return coordinator && typeof coordinator === "object" ? coordinator : null;
}

async function setSharedSaveCoordinator(coordinator) {
  const storageArea = getCoordinatorStorageArea();
  await storageArea.set({
    [SHARED_SAVE_COORDINATOR_KEY]: coordinator
  });
}

function getCoordinatorStorageArea() {
  return chrome.storage.session || chrome.storage.local;
}

function isRecentMatchingCoordinator(coordinator, signature) {
  if (!coordinator || coordinator.signature !== signature) return false;

  const completedAtMs = Number(coordinator.completedAtMs);
  if (!Number.isFinite(completedAtMs)) return false;

  const elapsedMs = Date.now() - completedAtMs;
  return elapsedMs >= 0 && elapsedMs < CROSS_CONTEXT_DUPLICATE_WINDOW_MS;
}

function setProductionSaveStatus(message) {
  ensureWorkspaceLibrarySaveStatusSurface();

  const primaryStatus = document.getElementById("workspaceLibrarySaveStatus");
  if (primaryStatus) {
    primaryStatus.textContent = message;
  }

  const intakeStatus = document.getElementById("intakeStatus");
  if (intakeStatus && message.includes("failed")) {
    intakeStatus.textContent = message;
  }
}

function summarizeError(error) {
  if (!error) return { message: "Unknown error" };

  return {
    name: error.name || "Error",
    message: error.message || String(error),
    stack: typeof error.stack === "string" ? error.stack.slice(0, 2000) : ""
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
