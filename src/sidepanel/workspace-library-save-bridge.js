import { getWorkspace } from "../core/workspace-store.js";

import { saveRuntimeWorkspaceToWorkspaceLibrary } from "../core/workspace-memory-store.js";

import { appendRuntimeDiagnostic } from "../core/workspace-runtime-store.js";

const SAVE_SETTLE_DELAY_MS = 450;
let workspaceLibrarySaveInProgress = false;
let pendingWorkspaceLibrarySave = false;

installWorkspaceLibrarySaveBridge();

function installWorkspaceLibrarySaveBridge() {
  const saveButton = document.getElementById("saveWorkspaceButton");
  if (!saveButton) return;

  saveButton.addEventListener("click", () => {
    void scheduleWorkspaceLibrarySaveFromProductionButton();
  });
}

async function scheduleWorkspaceLibrarySaveFromProductionButton() {
  if (workspaceLibrarySaveInProgress) {
    pendingWorkspaceLibrarySave = true;
    return;
  }

  workspaceLibrarySaveInProgress = true;

  try {
    await delay(SAVE_SETTLE_DELAY_MS);
    await saveActiveRuntimeToWorkspaceLibrary("save_workspace_button");
  } finally {
    workspaceLibrarySaveInProgress = false;

    if (pendingWorkspaceLibrarySave) {
      pendingWorkspaceLibrarySave = false;
      void scheduleWorkspaceLibrarySaveFromProductionButton();
    }
  }
}

async function saveActiveRuntimeToWorkspaceLibrary(source) {
  try {
    const runtimeWorkspace = await getWorkspace();
    const savedAt = new Date().toISOString();
    const result = await saveRuntimeWorkspaceToWorkspaceLibrary(runtimeWorkspace, {
      savedAt,
      lifecycleState: "paused",
      continuationNote: "Saved from the end-user Save Workspace action into Workspace Library."
    });

    await appendRuntimeDiagnostic("info", "workspace_saved_to_workspace_library", "Active workspace saved to Workspace Library from production Save Workspace action.", {
      source,
      saveMode: result.saveMode,
      productionSave: true,
      savedAt,
      workspaceId: result.workspaceId,
      workspaceName: result.workspaceName,
      lifecycleState: result.workspace.lifecycleState,
      tabCount: result.counts.tabs,
      journalEntryCount: result.counts.journalEntries,
      timelineEventCount: result.counts.timelineEvents,
      sessionDbRuntimeSourceOfTruth: result.bridgeStatus.sessionDbRuntimeSourceOfTruth,
      activeWorkspaceRuntimeSource: result.bridgeStatus.activeWorkspaceRuntimeSource,
      migrationMode: result.bridgeStatus.migrationMode
    });

    refreshWorkspaceLibraryProductSurface();
    setProductionSaveStatus("Workspace saved and added to Workspace Library.");
    window.dispatchEvent(new CustomEvent("chrome-flow-workspace-library-save-completed", {
      detail: {
        workspaceId: result.workspaceId,
        workspaceName: result.workspaceName,
        savedAt,
        source
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

function refreshWorkspaceLibraryProductSurface() {
  const refreshButton = document.getElementById("refreshSavedWorkspacesButton");
  if (!refreshButton) return;

  window.setTimeout(() => {
    refreshButton.click();
  }, 150);
}

function setProductionSaveStatus(message) {
  const intakeStatus = document.getElementById("intakeStatus");
  if (!intakeStatus) return;

  intakeStatus.textContent = message;
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
