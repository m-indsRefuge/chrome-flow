import { getWorkspace } from "../core/workspace-store.js";
import { saveRuntimeWorkspaceToWorkspaceLibrary } from "../core/workspace-memory-store.js";
import { appendRuntimeDiagnostic } from "../core/workspace-runtime-store.js";
import { getSidePanelRuntimeWorkspaceAuthority } from "../core/runtime-workspace-activation/side-panel-runtime.js";
import {
  ARCHIVE_CLOSE_IDENTITY_POLICY,
  buildVerifiedWorkspaceBrowserClosePlan,
  closeVerifiedWorkspaceBrowserProjection,
  summarizeVerifiedClosePlan
} from "../core/workspace-archive-close-engine.js";

const WORKSPACE_ARCHIVE_KEY = "chromeFlowWorkspaceArchive";
const MAX_ARCHIVED_WORKSPACES = 20;
let archiveOperationInProgress = false;
const runtimeWorkspaceAuthority = getSidePanelRuntimeWorkspaceAuthority();

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
    const authorityState = await runtimeWorkspaceAuthority.bootstrapExisting({ workspace, force: true });
    if (authorityState.status !== "active") {
      setStatus("Archive is disabled until this panel has verified workspace authority: " + (authorityState.reason || "unknown_reason") + ".");
      await appendRuntimeDiagnostic("warn", "workspace_archive_authority_blocked", "Archive operation was blocked before browser or runtime mutation because workspace authority was not verified.", { workspaceId: workspace.workspaceId || "", startFresh, reason: authorityState.reason || "runtime_workspace_activation_not_verified" });
      return;
    }

    const materiality = inspectWorkspaceMateriality(workspace);
    const disposition = startFresh
      ? await requestStartFreshDisposition(workspace, materiality)
      : window.confirm(
        "Archive the current workspace and close only verified workspace-owned tabs?"
        + "\n\nConstellation will revalidate each live tab using its saved tab ID, URL, and tab-key/title evidence immediately before closing it. Mismatched or ambiguous tabs will be skipped."
      )
        ? "archive"
        : "cancel";

    if (disposition === "cancel") {
      setStatus("Archive cancelled. No action was taken.");
      await appendRuntimeDiagnostic("info", "workspace_archive_cancelled", "Operator cancelled verified workspace archive or start-fresh operation.", {
        workspaceId: workspace.workspaceId || "",
        startFresh,
        materiality
      });
      return;
    }

    const shouldArchive = disposition === "archive";
    const actionLabel = shouldArchive
      ? startFresh ? "archive and start fresh" : "archive current workspace"
      : "discard draft and start fresh";
    const operationAt = new Date().toISOString();
    let archiveRecord = null;
    let memorySave = null;

    setStatus(shouldArchive
      ? "Preparing verified archive snapshot and checking live tab ownership..."
      : "Preparing verified draft discard and checking live tab ownership...");

    if (shouldArchive) {
      archiveRecord = await createLegacyCompatibleArchiveRecord(workspace, operationAt, startFresh);
      memorySave = await saveRuntimeWorkspaceToWorkspaceLibrary(workspace, {
        savedAt: operationAt,
        lifecycleState: "archived",
        lastArchivedAt: operationAt,
        lastPausedAt: workspace.lastPausedAt || "",
        continuationNote: "Archived through the verified browser-projection close controller."
      });
    }

    const closePlan = await buildVerifiedWorkspaceBrowserClosePlan(workspace);

    await appendRuntimeDiagnostic("info", "workspace_archive_verified_close_plan_prepared", "Verified workspace browser close plan prepared.", {
      action: actionLabel,
      disposition,
      archiveId: archiveRecord?.archiveId || "",
      archiveName: archiveRecord?.archiveName || "",
      workspaceId: workspace.workspaceId || "",
      closePlan: summarizeVerifiedClosePlan(closePlan),
      materiality,
      memoryPersistenceMode: memorySave?.persistenceMode || memorySave?.saveMode || "not_persisted_for_discard",
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
      const replacementState = await runtimeWorkspaceAuthority.replaceActive(freshWorkspace, authorityState.result.sourceWindowId);
      if (replacementState.status !== "active" || replacementState.result?.activeWorkspaceId !== freshWorkspace.workspaceId) {
        throw new Error("Fresh workspace replacement authority was not verified: " + (replacementState.reason || "unknown_reason"));
      }
      await appendRuntimeDiagnostic("info", shouldArchive ? "workspace_started_fresh" : "workspace_draft_discarded_start_fresh", shouldArchive
        ? "Archived current workspace and started a fresh active workspace before verified browser close."
        : "Discarded the current draft without creating a new archive or Workspace Library record, then started a fresh active workspace before verified browser close.", {
        previousWorkspaceId: workspace.workspaceId || "",
        archiveId: archiveRecord?.archiveId || "",
        newWorkspaceId: freshWorkspace.workspaceId,
        disposition,
        materiality,
        priorSavedCopiesPreserved: true,
        verifiedClosePlan: summarizeVerifiedClosePlan(closePlan),
        activation: replacementState.result
      });
    }

    setStatus(
      (shouldArchive ? "Workspace archived." : "Current draft discarded without creating a new saved record.")
      + " Closing " + closePlan.verifiedTabs.length
      + " verified workspace tab(s); skipping " + closePlan.skippedTabs.length
      + " unverified tab candidate(s)."
    );

    const closeResult = await closeVerifiedWorkspaceBrowserProjection(closePlan);
    await appendRuntimeDiagnostic(
      closeResult.errors.length ? "error" : closeResult.skippedTabs.length ? "warn" : "info",
      shouldArchive ? "workspace_archive_verified_close_completed" : "workspace_discard_verified_close_completed",
      shouldArchive
        ? "Verified archived workspace browser close completed."
        : "Verified discarded-draft browser close completed.",
      {
        action: actionLabel,
        disposition,
        archiveId: archiveRecord?.archiveId || "",
        archiveName: archiveRecord?.archiveName || "",
        workspaceId: workspace.workspaceId || "",
        startFresh,
        newWorkspaceId: freshWorkspace?.workspaceId || "",
        closePlan: summarizeVerifiedClosePlan(closePlan),
        closeResult,
        materiality,
        priorSavedCopiesPreserved: true,
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
      (shouldArchive ? "Archived " + archiveRecord.archiveName : "Discarded current draft")
      + ". Closed " + closedCount
      + " verified workspace tab(s), skipped " + skippedCount
      + " unverified tab(s), and encountered " + errorCount + " close error(s)."
      + (startFresh ? " A fresh workspace is now active." : "")
    );

    if (startFresh) window.setTimeout(() => window.location.reload(), 900);
  } catch (error) {
    await appendRuntimeDiagnostic("error", "workspace_archive_verified_close_failed", "Verified workspace archive or discard operation failed.", {
      startFresh,
      error: summarizeError(error)
    });
    setStatus("Could not complete the verified archive or discard operation. No unverified tab was intentionally closed; inspect Developer Diagnostics.");
  } finally {
    archiveOperationInProgress = false;
    setArchiveButtonsDisabled(false);
  }
}
function inspectWorkspaceMateriality(workspace) {
  const name = String(workspace?.name || "").trim();
  const normalizedName = name.toLowerCase();
  const aim = String(workspace?.aim || "").trim();
  const workspaceType = String(workspace?.workspaceType || "research").trim().toLowerCase();
  const tabs = Array.isArray(workspace?.tabs) ? workspace.tabs : [];
  const journal = Array.isArray(workspace?.journal) ? workspace.journal : [];
  const meaningfulName = name.length > 0 && normalizedName !== "untitled workspace";
  const meaningfulAim = aim.length > 0;
  const meaningfulType = workspaceType.length > 0 && workspaceType !== "research";
  const meaningfulTabs = tabs.length > 0;
  const meaningfulJournal = journal.length > 0;

  return {
    meaningful: meaningfulName || meaningfulAim || meaningfulType || meaningfulTabs || meaningfulJournal,
    meaningfulName,
    meaningfulAim,
    meaningfulType,
    meaningfulTabs,
    meaningfulJournal,
    tabCount: tabs.length,
    journalCount: journal.length,
    timelineIgnoredForMateriality: true
  };
}

function requestStartFreshDisposition(workspace, materiality) {
  const dialog = document.getElementById("workspaceStartFreshDialog");
  const description = document.getElementById("workspaceStartFreshDialogDescription");
  const archiveButton = document.getElementById("workspaceStartFreshArchiveButton");
  const discardButton = document.getElementById("workspaceStartFreshDiscardButton");

  if (!dialog || typeof dialog.showModal !== "function") {
    return Promise.resolve("cancel");
  }

  if (description) {
    description.textContent = materiality.meaningful
      ? "This workspace contains meaningful work. Archive preserves a new saved copy. Discard starts fresh without creating a new archive or Workspace Library record; earlier saved copies are not deleted."
      : "This workspace appears to be an empty draft. Discard starts fresh without adding it to Archive or Workspace Library. Archive remains available if you intentionally want to preserve it.";
  }

  const workspaceName = String(workspace?.name || "Untitled Workspace").trim() || "Untitled Workspace";
  dialog.setAttribute("aria-label", "Start fresh from " + workspaceName);
  dialog.returnValue = "cancel";

  return new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      const value = dialog.returnValue;
      resolve(value === "archive" || value === "discard" ? value : "cancel");
    }, { once: true });

    dialog.showModal();
    window.setTimeout(() => {
      const preferred = materiality.meaningful ? archiveButton : discardButton;
      preferred?.focus();
    }, 0);
  });
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
