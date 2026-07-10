import { getWorkspaceMemoryRecord } from "../core/workspace-memory-store.js";

import {
  WorkspaceResumeOperationError,
  resumeWorkspaceMemoryRecordSafely
} from "../core/workspace-resume-transaction-engine.js";

import {
  evaluateSavedWorkspaceResumeGate
} from "./workspace-library-resume-gate.js";

const RESUME_BUTTON_ID = "workspaceLibraryResumeButton";
let productResumeClickInProgress = false;

installWorkspaceLibraryResumeTransactionController();

function installWorkspaceLibraryResumeTransactionController() {
  document.addEventListener("click", interceptWorkspaceLibraryResumeClick, true);
}

function interceptWorkspaceLibraryResumeClick(event) {
  const button = event.target?.closest?.("#" + RESUME_BUTTON_ID);
  if (!button) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  void handleTransactionalResumeClick(button);
}

async function handleTransactionalResumeClick(resumeButton) {
  if (productResumeClickInProgress) {
    setLibraryActionStatus("A workspace resume is already running. Duplicate request blocked.");
    return;
  }

  const workspaceId = getSelectedWorkspaceId();

  if (!workspaceId) {
    setLibraryActionStatus("Select and preview a workspace before resuming.");
    return;
  }

  productResumeClickInProgress = true;
  resumeButton.disabled = true;
  resumeButton.dataset.resumeExecutionController = "transactional_resume_v0.1";
  setLibraryActionStatus("Preparing transactional workspace resume...");

  try {
    const record = await getWorkspaceMemoryRecord(workspaceId);

    if (!record) {
      setLibraryActionStatus("Selected workspace could not be found in long-term memory.");
      return;
    }

    const resumeGate = evaluateSavedWorkspaceResumeGate(
      createGateDetailFromMemoryRecord(record)
    );

    if (resumeGate.status !== "ready_for_precheck") {
      setLibraryActionStatus(
        "Resume blocked: "
        + resumeGate.failedChecks.map((check) => check.check).join(", ")
        + "."
      );
      return;
    }

    const confirmed = window.confirm(
      "Resume workspace: " + (record.workspace.name || "Untitled Workspace") + "?\n\n"
      + "Chrome Flow will transactionally reopen " + record.counts.tabs + " saved tab(s), recreate role groups, and use the " + formatTargetMode(resumeGate.restoreTargetMode) + ".\n\n"
      + "If resume fails before active-runtime commit, browser tabs and windows created by this operation will be rolled back. Existing browser tabs will not be closed."
    );

    if (!confirmed) {
      setLibraryActionStatus("Resume cancelled. No tabs or windows were changed.");
      return;
    }

    setLibraryActionStatus(
      "Resuming workspace transactionally. Browser changes are provisional until active runtime commits..."
    );

    const result = await resumeWorkspaceMemoryRecordSafely(record, {
      source: "workspace_library_resume_transaction_controller"
    });

    setLibraryActionStatus(
      "Workspace resumed and committed: "
      + result.hydratedWorkspace.name
      + ". Reopened " + result.restoreResult.openedTabs.length
      + " tab(s), recreated " + result.groupResult.recreatedGroupCount
      + " group(s), target: " + result.restoreTargetMode + "."
    );

    window.setTimeout(() => window.location.reload(), 1200);
  } catch (error) {
    handleResumeError(error);
  } finally {
    productResumeClickInProgress = false;

    window.setTimeout(() => {
      if (resumeButton.dataset.resumeGateStatus === "ready_for_precheck") {
        resumeButton.disabled = false;
      }
    }, 1200);
  }
}

function handleResumeError(error) {
  if (error instanceof WorkspaceResumeOperationError) {
    if (error.code === "resume_operation_in_progress") {
      setLibraryActionStatus(
        "Duplicate resume request blocked. The existing resume operation remains authoritative."
      );
      return;
    }

    if (error.code === "resume_workspace_already_active") {
      setLibraryActionStatus(
        "Resume blocked because this workspace is already active with live browser tabs. No duplicate tabs were created."
      );
      return;
    }

    const rollback = error.details?.rollback;

    if (rollback?.complete) {
      setLibraryActionStatus(
        "Resume failed before runtime commit, and all provisional browser changes were rolled back. Previous active workspace preserved."
      );
      return;
    }

    if (rollback && !rollback.complete) {
      setLibraryActionStatus(
        "Resume failed and rollback was incomplete. Do not retry yet; inspect Developer Diagnostics."
      );
      return;
    }
  }

  setLibraryActionStatus(
    "Resume failed. Check Developer Diagnostics. "
    + (error?.message || String(error))
  );
}

function createGateDetailFromMemoryRecord(record) {
  const projection = record.projections?.[0] || {};
  const summary = record.summaryCard || {};

  return {
    Workspace: record.workspace.name || "Untitled Workspace",
    Type: record.workspace.workspaceType || "workspace",
    Lifecycle: record.workspace.lifecycleState || "unknown",
    Projection: [
      projection.projectionState || "none",
      projection.projectionMode || "none"
    ].join(" / "),
    Tabs: String(record.counts.tabs || 0),
    Sessions: String(record.counts.sessions || 0),
    "Timeline events": String(record.counts.timelineEvents || 0),
    "Journal entries": String(record.counts.journalEntries || 0),
    Aim: record.workspace.aim || summary.workspaceAim || "No aim recorded",
    Summary: summary.deterministicSummary || "No summary available yet.",
    Continuation: summary.continuationSummary || "No continuation note recorded."
  };
}

function getSelectedWorkspaceId() {
  const select = document.getElementById("savedWorkspaceSelect");
  return select?.value || "";
}

function formatTargetMode(targetMode) {
  return targetMode === "dedicated_window"
    ? "dedicated-window path"
    : "current-window path";
}

function setLibraryActionStatus(message) {
  const status = document.getElementById("workspaceLibraryActionStatus");
  if (status) status.textContent = message;
}
