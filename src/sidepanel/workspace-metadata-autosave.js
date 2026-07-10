import {
  appendRuntimeDiagnostic
} from "../core/workspace-runtime-store.js";

const WORKSPACE_KEY = "chromeFlowWorkspace";
const AUTOSAVE_DELAY_MS = 250;
const TYPE_RECONCILE_DELAY_MS = 180;

const workspaceNameInput = document.getElementById("workspaceName");
const workspaceAimInput = document.getElementById("workspaceAim");
const workspaceTypeSelect = document.getElementById("workspaceType");

let cachedWorkspace = null;
let autosaveTimer = null;
let pendingReason = "";
let latestRequestedSnapshot = null;
let diagnosticQueue = Promise.resolve();

await initializeWorkspaceMetadataAutosave();

async function initializeWorkspaceMetadataAutosave() {
  const result = await chrome.storage.local.get(WORKSPACE_KEY);
  cachedWorkspace = isWorkspaceObject(result[WORKSPACE_KEY])
    ? result[WORKSPACE_KEY]
    : null;

  chrome.storage.onChanged.addListener(handleWorkspaceStorageChanged);

  workspaceNameInput?.addEventListener("input", () => scheduleMetadataAutosave("workspace_name_input"));
  workspaceAimInput?.addEventListener("input", () => scheduleMetadataAutosave("workspace_aim_input"));

  workspaceNameInput?.addEventListener("blur", () => flushMetadataAutosave("workspace_name_blur"));
  workspaceAimInput?.addEventListener("blur", () => flushMetadataAutosave("workspace_aim_blur"));

  workspaceNameInput?.addEventListener("change", () => flushMetadataAutosave("workspace_name_change"));
  workspaceAimInput?.addEventListener("change", () => flushMetadataAutosave("workspace_aim_change"));

  workspaceTypeSelect?.addEventListener("change", handleWorkspaceTypeCapture, true);

  window.addEventListener("pagehide", () => {
    if (latestRequestedSnapshot) commitMetadataSnapshot(latestRequestedSnapshot, "sidepanel_pagehide");
  });
}

function handleWorkspaceStorageChanged(changes, areaName) {
  if (areaName !== "local" || !changes[WORKSPACE_KEY]) return;

  const nextWorkspace = changes[WORKSPACE_KEY].newValue;
  if (isWorkspaceObject(nextWorkspace)) cachedWorkspace = nextWorkspace;
}

function scheduleMetadataAutosave(reason) {
  latestRequestedSnapshot = captureMetadataSnapshot();
  pendingReason = reason;

  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    const snapshot = latestRequestedSnapshot;
    latestRequestedSnapshot = null;
    commitMetadataSnapshot(snapshot, pendingReason || "workspace_metadata_input");
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
  commitMetadataSnapshot(snapshot, reason);
}

function handleWorkspaceTypeCapture() {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }

  const snapshot = captureMetadataSnapshot();
  latestRequestedSnapshot = null;
  pendingReason = "";

  // Issue the complete metadata write before the existing type-change handler
  // performs its read so name and aim cannot be lost during the full rerender.
  commitMetadataSnapshot(snapshot, "workspace_type_change_precommit");

  // The existing type handler also updates role validity and appends a timeline
  // event. Reconcile afterward against the newest stored workspace so those
  // changes are preserved while the captured form metadata remains authoritative.
  setTimeout(() => {
    commitMetadataSnapshot(snapshot, "workspace_type_change_reconcile");
    restoreCapturedFormValues(snapshot);
  }, TYPE_RECONCILE_DELAY_MS);
}

function captureMetadataSnapshot() {
  return {
    name: workspaceNameInput?.value?.trim() || "",
    aim: workspaceAimInput?.value?.trim() || "",
    workspaceType: workspaceTypeSelect?.value || "research"
  };
}

function commitMetadataSnapshot(snapshot, reason) {
  if (!snapshot || !cachedWorkspace) return;

  const changedFields = getChangedFields(cachedWorkspace, snapshot);
  if (!changedFields.length) return;

  const nextWorkspace = {
    ...cachedWorkspace,
    name: snapshot.name,
    aim: snapshot.aim,
    workspaceType: snapshot.workspaceType,
    updatedAt: new Date().toISOString()
  };

  cachedWorkspace = nextWorkspace;

  const writePromise = chrome.storage.local.set({
    [WORKSPACE_KEY]: nextWorkspace
  });

  diagnosticQueue = diagnosticQueue
    .then(async () => {
      await writePromise;
      await appendRuntimeDiagnostic(
        "info",
        "workspace_metadata_autosaved",
        "Active workspace metadata autosaved to chrome.storage.local.",
        {
          workspaceId: nextWorkspace.workspaceId || "",
          reason,
          changedFields,
          workspaceType: nextWorkspace.workspaceType || "",
          activeRuntimeAuthority: "chrome.storage.local",
          workspaceLibraryChanged: false
        }
      );
    })
    .catch(async (error) => {
      await appendRuntimeDiagnostic(
        "error",
        "workspace_metadata_autosave_failed",
        "Active workspace metadata autosave failed.",
        {
          workspaceId: nextWorkspace.workspaceId || "",
          reason,
          changedFields,
          error: error?.message || String(error)
        }
      );
    });
}

function restoreCapturedFormValues(snapshot) {
  if (workspaceNameInput && workspaceNameInput.value !== snapshot.name) {
    workspaceNameInput.value = snapshot.name;
  }

  if (workspaceAimInput && workspaceAimInput.value !== snapshot.aim) {
    workspaceAimInput.value = snapshot.aim;
  }

  if (workspaceTypeSelect && workspaceTypeSelect.value !== snapshot.workspaceType) {
    workspaceTypeSelect.value = snapshot.workspaceType;
  }
}

function getChangedFields(workspace, snapshot) {
  const changedFields = [];

  if ((workspace.name || "") !== snapshot.name) changedFields.push("name");
  if ((workspace.aim || "") !== snapshot.aim) changedFields.push("aim");
  if ((workspace.workspaceType || "research") !== snapshot.workspaceType) changedFields.push("workspaceType");

  return changedFields;
}

function isWorkspaceObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
