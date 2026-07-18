import {
  appendRuntimeDiagnostic
} from "../core/workspace-runtime-store.js";
import {
  readCompatibleStorageValue,
  stableStringify,
  writeCompatibleStorageValue
} from "../core/constellation-storage-compatibility.js";
import { LOCK_NAMES } from "../core/runtime-contract/constants.js";
import {
  applyWorkspaceMetadataAutosaveSnapshot,
  createWorkspaceMetadataBarrier,
  runWorkspaceMetadataWriterWithLatestSnapshot
} from "./workspace-metadata-barrier.js";

const AUTOSAVE_DELAY_MS = 250;

const workspaceNameInput = document.getElementById("workspaceName");
const workspaceAimInput = document.getElementById("workspaceAim");
const workspaceTypeSelect = document.getElementById("workspaceType");

let autosaveTimer = null;
let pendingReason = "";
let latestRequestedSnapshot = null;
const metadataBarrier = createWorkspaceMetadataBarrier({
  commitSnapshot: commitMetadataSnapshotAgainstLatest,
  recordFailure: recordMetadataFailure
});

initializeWorkspaceMetadataAutosave();

function initializeWorkspaceMetadataAutosave() {
  workspaceNameInput?.addEventListener("input", () => scheduleMetadataAutosave("workspace_name_input"));
  workspaceAimInput?.addEventListener("input", () => scheduleMetadataAutosave("workspace_aim_input"));

  workspaceNameInput?.addEventListener("blur", () => flushMetadataAutosave("workspace_name_blur"));
  workspaceAimInput?.addEventListener("blur", () => flushMetadataAutosave("workspace_aim_blur"));

  workspaceNameInput?.addEventListener("change", () => flushMetadataAutosave("workspace_name_change"));
  workspaceAimInput?.addEventListener("change", () => flushMetadataAutosave("workspace_aim_change"));

  window.addEventListener("pagehide", () => {
    if (latestRequestedSnapshot) void metadataBarrier.submit(latestRequestedSnapshot, "sidepanel_pagehide");
  });
}

function scheduleMetadataAutosave(reason) {
  latestRequestedSnapshot = captureMetadataSnapshot();
  pendingReason = reason;

  if (metadataBarrier.paused) {
    const snapshot = latestRequestedSnapshot;
    latestRequestedSnapshot = null;
    pendingReason = "";
    void metadataBarrier.submit(snapshot, reason);
    return;
  }

  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    const snapshot = latestRequestedSnapshot;
    latestRequestedSnapshot = null;
    void metadataBarrier.submit(snapshot, pendingReason || "workspace_metadata_input");
    pendingReason = "";
  }, AUTOSAVE_DELAY_MS);
}

function flushMetadataAutosave(reason) {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }

  latestRequestedSnapshot = captureMetadataSnapshot();
  const snapshot = latestRequestedSnapshot;
  latestRequestedSnapshot = null;
  pendingReason = "";
  void metadataBarrier.submit(snapshot, reason);
}

function captureMetadataSnapshot({ includeWorkspaceType = false } = {}) {
  const snapshot = {
    name: workspaceNameInput?.value?.trim() || "",
    aim: workspaceAimInput?.value?.trim() || ""
  };
  if (includeWorkspaceType) snapshot.workspaceType = workspaceTypeSelect?.value || "research";
  return snapshot;
}

async function commitMetadataSnapshotAgainstLatest(snapshot, reason) {
  if (!snapshot) return { ok: true, changed: false };
  return navigator.locks.request(LOCK_NAMES.runtimeState, async () => {
    const compatibleRead = await readCompatibleStorageValue("activeWorkspace");
    if (
      compatibleRead.conflict ||
      !compatibleRead.canonicalPresent ||
      !compatibleRead.legacyPresent ||
      !compatibleRead.equivalent ||
      !isWorkspaceObject(compatibleRead.value)
    ) throw new Error("Compatible active workspace is unavailable for metadata persistence");
    const workspace = compatibleRead.value;
    const changedFields = getChangedFields(workspace, snapshot);
    if (!changedFields.length) return { ok: true, changed: false };
    const nextWorkspace = applyWorkspaceMetadataAutosaveSnapshot(workspace, snapshot, new Date().toISOString());
    await writeCompatibleStorageValue("activeWorkspace", nextWorkspace);
    const verified = await readCompatibleStorageValue("activeWorkspace");
    if (
      verified.conflict ||
      !verified.canonicalPresent ||
      !verified.legacyPresent ||
      !verified.equivalent ||
      stableStringify(verified.value) !== stableStringify(nextWorkspace)
    ) throw new Error("Metadata persistence verification failed");
    await appendRuntimeDiagnostic(
      "info",
      "workspace_metadata_autosaved",
      "Active workspace metadata autosaved to compatible chrome.storage.local peers.",
      {
        workspaceId: nextWorkspace.workspaceId || "",
        reason,
        changedFields,
        workspaceType: nextWorkspace.workspaceType || "",
        workspaceRevision: Number.isSafeInteger(nextWorkspace.workspaceRevision) ? nextWorkspace.workspaceRevision : 0,
        placementMode: nextWorkspace.placementMode || "",
        activeRuntimeAuthority: "chrome.storage.local",
        workspaceLibraryChanged: false
      }
    );
    return { ok: true, changed: true };
  });
}

async function recordMetadataFailure(error, reason) {
  await appendRuntimeDiagnostic(
    "error",
    "workspace_metadata_autosave_failed",
    "Active workspace metadata autosave failed without changing membership or promotion authority.",
    { reason, error: error?.message || String(error) }
  );
}

async function runWithWorkspaceMetadataBarrier(work) {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
  const snapshot = captureMetadataSnapshot();
  latestRequestedSnapshot = null;
  pendingReason = "";
  return metadataBarrier.run(work, snapshot, "workspace_membership_sequence_flush");
}

async function runWithWorkspaceMetadataWriter(work) {
  if (typeof work !== "function") throw new TypeError("Workspace metadata writer work must be a function");
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
  latestRequestedSnapshot = null;
  pendingReason = "";
  return runWorkspaceMetadataWriterWithLatestSnapshot(
    metadataBarrier,
    () => captureMetadataSnapshot({ includeWorkspaceType: true }),
    work
  );
}

function getChangedFields(workspace, snapshot) {
  const changedFields = [];

  if ((workspace.name || "") !== snapshot.name) changedFields.push("name");
  if ((workspace.aim || "") !== snapshot.aim) changedFields.push("aim");

  return changedFields;
}

function isWorkspaceObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export { runWithWorkspaceMetadataBarrier, runWithWorkspaceMetadataWriter };
