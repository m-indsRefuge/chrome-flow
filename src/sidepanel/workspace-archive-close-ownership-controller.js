import { getWorkspace, saveWorkspace } from "../core/workspace-store.js";
import { saveRuntimeWorkspaceToWorkspaceLibrary } from "../core/workspace-memory-store.js";
import { appendRuntimeDiagnostic } from "../core/workspace-runtime-store.js";
import {
  ARCHIVE_CLOSE_IDENTITY_POLICY,
  buildVerifiedWorkspaceBrowserClosePlan,
  closeVerifiedWorkspaceBrowserProjection,
  summarizeVerifiedClosePlan
} from "../core/workspace-archive-close-engine.js";

const WORKSPACE_ARCHIVE_KEY = "chromeFlowWorkspaceArchive";
const MAX_ARCHIVED_WORKSPACES = 20;
let archiveOperationInProgress = false;

installWorkspaceArchiveCloseOwnershipController();

function installWorkspaceArchiveCloseOwnershipController() {
  document.getElementById("archiveWorkspaceButton")?.addEventListener(
    "click",
    (event) => interceptArchiveClick(event, false),
    true
  );

  document.getElementById("archiveAndStartFreshButton")?.addEventListener(
    "click",
    (event) => interceptArchiveClick(event, true),
    true
  );
}

function interceptArchiveClick(event, startFresh) {
  event.preventDefault();
  event.stopImmediatePropagation();
  void runVerifiedArchiveOperation(startFresh);
}

async function runVerifiedArchiveOperation(startFresh) {
  if (archiveOperationInProgress) {
    setStatus("An archive operation is already running.");
    await appendRuntimeDiagnostic("warn", "workspace_archive_operation_blocked", "A second archive operation was blocked.", {
      reason: "archive_operation_in_progress",
      startFresh
    });
    return;
  }

  archiveOperationInProgress = true;
  setArchiveButtonsDisabled(true);

  try {
    const workspace = await getWorkspace();
    const actionLabel = startFresh ? "archive and start fresh" : "archive current workspace";
    const confirmed = window.confirm(
      (startFresh
        ? "Archive the current workspace, close only verified workspace-owned tabs, and start a fresh workspace?"
        : "Archive the current workspace and close only verified workspace-owned tabs?")
      + "\n\nChrome Flow will revalidate each live tab using its saved tab ID, URL, and tab-key/title evidence immediately before closing it. Mismatched or ambiguous tabs will be skipped."
    );

    if (!confirmed) {
      setStatus("Archive cancelled. No action was taken.");
      await appendRuntimeDiagnostic("info", "workspace_archive_cancelled", "Operator cancelled verified workspace archive.", {
        workspaceId: workspace.workspaceId || "",
        startFresh
      });
      return;
    }

    setStatus("Preparing verified archive snapshot and checking live tab ownership...");
    const archivedAt = new Date().toISOString();
    const archiveRecord = await createLegacyCompatibleArchiveRecord(workspace, archivedAt, startFresh);
    const memorySave = await saveRuntimeWorkspaceToWorkspaceLibrary(workspace, {
      savedAt: archivedAt,
      lifecycleState: "archived",
      lastArchivedAt: archivedAt,
      lastPausedAt: workspace.lastPausedAt || "",
      continuationNote: "Archived through the verified browser-projection close controller."
    });
    const closePlan = await buildVerifiedWorkspaceBrowserClosePlan(workspace);

    await appendRuntimeDiagnostic("info", "workspace_archive_verified_close_plan_prepared", "Verified archive browser close plan prepared.", {
      action: actionLabel,
      archiveId: archiveRecord.archiveId,
      archiveName: archiveRecord.archiveName,
      workspaceId: workspace.workspaceId || "",
      closePlan: summarizeVerifiedClosePlan(closePlan),
      memoryPersistenceMode: memorySave.persistenceMode || memorySave.saveMode || "",
      safety: {
        policyId: ARCHIVE_CLOSE_IDENTITY_POLICY.policyId,
        numericTabIdIsOwnershipProof: false,
        executionRevalidationRequired: true,
        mismatchPolicy: "skip_never_close"
      }
    });

    let freshWorkspace = null;
    if (startFresh) {
      freshWorkspace = createFreshWorkspace();
      await saveWorkspace(freshWorkspace);
      await appendRuntimeDiagnostic("info", "workspace_started_fresh", "Archived current workspace and started a fresh active workspace before verified browser close.", {
        archivedWorkspaceId: workspace.workspaceId || "",
        archiveId: archiveRecord.archiveId,
        newWorkspaceId: freshWorkspace.workspaceId,
        verifiedClosePlan: summarizeVerifiedClosePlan(closePlan)
      });
    }

    setStatus(
      "Workspace archived. Closing " + closePlan.verifiedTabs.length
      + " verified workspace tab(s); skipping " + closePlan.skippedTabs.length
      + " unverified tab candidate(s)."
    );

    const closeResult = await closeVerifiedWorkspaceBrowserProjection(closePlan);
    await appendRuntimeDiagnostic(
      closeResult.errors.length ? "error" : closeResult.skippedTabs.length ? "warn" : "info",
      "workspace_archive_verified_close_completed",
      "Verified archived workspace browser close completed.",
      {
        action: actionLabel,
        archiveId: archiveRecord.archiveId,
        archiveName: archiveRecord.archiveName,
        workspaceId: workspace.workspaceId || "",
        startFresh,
        newWorkspaceId: freshWorkspace?.workspaceId || "",
        closePlan: summarizeVerifiedClosePlan(closePlan),
        closeResult,
        safety: {
          unrelatedTabsClosed: false,
          removedOnlyAfterExecutionRevalidation: true,
          mismatchesSkipped: true
        }
      }
    );

    const closedCount = closeResult.closedTabs.length;
    const skippedCount = closePlan.skippedTabs.length + closeResult.skippedTabs.length;
    const errorCount = closeResult.errors.length;
    setStatus(
      "Archived " + archiveRecord.archiveName + ". Closed " + closedCount
      + " verified workspace tab(s), skipped " + skippedCount
      + " unverified tab(s), and encountered " + errorCount + " close error(s)."
      + (startFresh ? " A fresh workspace is now active." : "")
    );

    if (startFresh) {
      window.setTimeout(() => window.location.reload(), 900);
    }
  } catch (error) {
    await appendRuntimeDiagnostic("error", "workspace_archive_verified_close_failed", "Verified workspace archive operation failed.", {
      startFresh,
      error: summarizeError(error)
    });
    setStatus("Could not complete the verified archive operation. No unverified tab was intentionally closed; inspect Developer Diagnostics.");
  } finally {
    archiveOperationInProgress = false;
    setArchiveButtonsDisabled(false);
  }
}

async function createLegacyCompatibleArchiveRecord(workspace, archivedAt, startFresh) {
  const result = await chrome.storage.local.get(WORKSPACE_ARCHIVE_KEY);
  const archives = Array.isArray(result[WORKSPACE_ARCHIVE_KEY]) ? result[WORKSPACE_ARCHIVE_KEY] : [];
  const archiveRecord = {
    archiveId: crypto.randomUUID(),
    archiveName: buildArchiveName(workspace, archivedAt),
    archivedAt,
    reason: startFresh ? "archive_before_start_fresh_verified_close" : "manual_archive_verified_close",
    summary: createWorkspaceSummary(workspace),
    workspace: cloneValue(workspace),
    archiveClosePolicyId: ARCHIVE_CLOSE_IDENTITY_POLICY.policyId
  };

  const nextArchives = [archiveRecord, ...archives].slice(0, MAX_ARCHIVED_WORKSPACES);
  await chrome.storage.local.set({ [WORKSPACE_ARCHIVE_KEY]: nextArchives });
  await appendRuntimeDiagnostic("info", "workspace_archived", "Workspace archived with verified-close ownership policy.", {
    archiveId: archiveRecord.archiveId,
    archiveName: archiveRecord.archiveName,
    reason: archiveRecord.reason,
    summary: archiveRecord.summary,
    archiveCount: nextArchives.length,
    archiveClosePolicyId: ARCHIVE_CLOSE_IDENTITY_POLICY.policyId
  });

  return archiveRecord;
}

function createFreshWorkspace() {
  const now = new Date().toISOString();
  return {
    workspaceId: crypto.randomUUID(),
    name: "Untitled Workspace",
    aim: "",
    workspaceType: "research",
    createdAt: now,
    updatedAt: now,
    tabs: [],
    journal: [],
    timeline: []
  };
}

function createWorkspaceSummary(workspace) {
  return {
    workspaceId: workspace.workspaceId || "",
    name: workspace.name || "",
    workspaceType: workspace.workspaceType || "unknown",
    tabCount: Array.isArray(workspace.tabs) ? workspace.tabs.length : 0,
    journalCount: Array.isArray(workspace.journal) ? workspace.journal.length : 0,
    timelineCount: Array.isArray(workspace.timeline) ? workspace.timeline.length : 0,
    createdAt: workspace.createdAt || "",
    updatedAt: workspace.updatedAt || ""
  };
}

function buildArchiveName(workspace, archivedAt) {
  const name = String(workspace?.name || "Untitled Workspace").trim() || "Untitled Workspace";
  return name + " @ " + archivedAt;
}

function setArchiveButtonsDisabled(disabled) {
  for (const id of ["archiveWorkspaceButton", "archiveAndStartFreshButton"]) {
    const button = document.getElementById(id);
    if (button) button.disabled = disabled;
  }
}

function setStatus(message) {
  const status = document.getElementById("workspaceSessionStatus");
  if (status) status.textContent = message;
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
