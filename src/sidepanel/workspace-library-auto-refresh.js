import { appendRuntimeDiagnostic } from "../core/workspace-runtime-store.js";

const SHARED_SAVE_COORDINATOR_KEY = "chromeFlowWorkspaceLibrarySaveCoordinator";
const AUTO_REFRESH_DEBOUNCE_MS = 220;
const LOCAL_SAVE_MEMORY_MS = 10000;
const AUTOMATIC_LIBRARY_HELP_TEXT = "Browse saved workspaces, preview their structure, and resume a selected workspace through a checked action. The library updates automatically when saved workspace memory changes.";

const refreshContextId = crypto.randomUUID();
const locallyHandledSavedAt = new Map();
let autoRefreshTimer = null;
let lastProcessedRevisionSignature = "";

installWorkspaceLibraryAutoRefresh();

function installWorkspaceLibraryAutoRefresh() {
  applyAutomaticLibraryProductContract();
  installProductContractObserver();
  installLocalSaveCompletionListener();
  installSharedCoordinatorListener();
}

function applyAutomaticLibraryProductContract() {
  const refreshButton = document.getElementById("refreshSavedWorkspacesButton");
  if (refreshButton) {
    refreshButton.hidden = true;
    refreshButton.setAttribute("aria-hidden", "true");
    refreshButton.tabIndex = -1;
    refreshButton.dataset.internalMaintenanceControl = "true";
    refreshButton.title = "Internal compatibility control. The Workspace Library updates automatically.";
  }

  const section = document.getElementById("savedWorkspaceRegistrySection");
  const help = section?.querySelector(".section-help");
  if (help && help.textContent !== AUTOMATIC_LIBRARY_HELP_TEXT) {
    help.textContent = AUTOMATIC_LIBRARY_HELP_TEXT;
  }
}

function installProductContractObserver() {
  const section = document.getElementById("savedWorkspaceRegistrySection");
  if (!section) return;

  const observer = new MutationObserver(() => {
    applyAutomaticLibraryProductContract();
  });

  observer.observe(section, {
    childList: true,
    subtree: true
  });
}

function installLocalSaveCompletionListener() {
  window.addEventListener("chrome-flow-workspace-library-save-completed", (event) => {
    const savedAt = String(event?.detail?.savedAt || "");
    if (!savedAt) return;

    locallyHandledSavedAt.set(savedAt, Date.now());
    pruneLocalSaveMemory();
  });
}

function installSharedCoordinatorListener() {
  if (!globalThis.chrome?.storage?.onChanged?.addListener) return;

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "session" && areaName !== "local") return;

    const coordinator = changes?.[SHARED_SAVE_COORDINATOR_KEY]?.newValue;
    if (!coordinator || typeof coordinator !== "object") return;

    const signature = createRevisionSignature(coordinator);
    if (!signature || signature === lastProcessedRevisionSignature) return;
    lastProcessedRevisionSignature = signature;

    const savedAt = String(coordinator.savedAt || "");
    pruneLocalSaveMemory();

    if (savedAt && locallyHandledSavedAt.has(savedAt)) {
      locallyHandledSavedAt.delete(savedAt);
      return;
    }

    scheduleAutomaticLibraryRefresh(coordinator, areaName);
  });
}

function scheduleAutomaticLibraryRefresh(coordinator, areaName) {
  if (autoRefreshTimer) window.clearTimeout(autoRefreshTimer);

  autoRefreshTimer = window.setTimeout(() => {
    autoRefreshTimer = null;
    void refreshWorkspaceLibraryFromSharedRevision(coordinator, areaName);
  }, AUTO_REFRESH_DEBOUNCE_MS);
}

async function refreshWorkspaceLibraryFromSharedRevision(coordinator, areaName) {
  const refreshButton = document.getElementById("refreshSavedWorkspacesButton");
  if (!refreshButton) return;

  invokeInternalLibraryRefresh(refreshButton);

  window.setTimeout(() => {
    applyAutomaticLibraryProductContract();

    const status = document.getElementById("savedWorkspaceRegistryStatus");
    if (status && !/failed|could not|error/i.test(status.textContent || "")) {
      status.textContent = "Workspace Library updated automatically.";
    }
  }, 350);

  await appendRuntimeDiagnostic(
    "info",
    "workspace_library_surface_auto_refreshed",
    "Workspace Library product surface refreshed automatically after a shared durable-save revision.",
    {
      contextId: refreshContextId,
      areaName,
      workspaceId: coordinator.workspaceId || "",
      source: coordinator.source || "",
      savedAt: coordinator.savedAt || "",
      saveContextId: coordinator.contextId || "",
      manualRefreshRequired: false,
      operatorClickRecorded: false,
      invocationMode: "non_bubbling_internal_refresh_event"
    }
  );
}

function invokeInternalLibraryRefresh(refreshButton) {
  // Run the already-registered target handler without producing a bubbling
  // Operator click. The event reaches the refresh control itself, but cannot
  // reach document-level click diagnostics.
  refreshButton.dispatchEvent(new Event("click", {
    bubbles: false,
    cancelable: false
  }));
}

function createRevisionSignature(coordinator) {
  const savedAt = String(coordinator.savedAt || "");
  const contextId = String(coordinator.contextId || "");
  const workspaceId = String(coordinator.workspaceId || "");
  const source = String(coordinator.source || "");

  if (!savedAt && !contextId && !workspaceId) return "";
  return [savedAt, contextId, workspaceId, source].join("|");
}

function pruneLocalSaveMemory() {
  const cutoff = Date.now() - LOCAL_SAVE_MEMORY_MS;

  for (const [savedAt, recordedAt] of locallyHandledSavedAt.entries()) {
    if (recordedAt < cutoff) locallyHandledSavedAt.delete(savedAt);
  }
}
