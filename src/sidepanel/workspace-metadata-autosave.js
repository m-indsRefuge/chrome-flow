import {
  appendRuntimeDiagnostic
} from "../core/workspace-runtime-store.js";
import {
  getSidePanelAssignedWorkspaceAuthority
} from "../core/runtime-window-binding/side-panel-authority.js";
import {
  createRuntimeWorkspaceMutationClient
} from "../core/runtime-workspace-mutation/client.js";
import {
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
const assignedMetadataMutationGateway = createAssignedWorkspaceMetadataMutationGateway({
  resolveAuthority: () => getSidePanelAssignedWorkspaceAuthority().resolve(),
  mutationClient: createRuntimeWorkspaceMutationClient({
    createId: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
    send: (command) => chrome.runtime.sendMessage(command)
  })
});
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
  const submission = await assignedMetadataMutationGateway.submitAutosave(snapshot);
  if (!submission.ok) throw new Error(metadataMutationFailureMessage(submission));
  try {
    await appendRuntimeDiagnostic(
      "info",
      "workspace_metadata_autosaved",
      "Assigned workspace metadata autosaved through the scoped runtime mutation route.",
      {
        workspaceId: submission.result.workspaceId,
        reason,
        mutationKind: "workspace.metadata.autosave",
        mutationStatus: submission.result.status,
        workspaceRevision: submission.result.committedRevision,
        activeRuntimeAuthority: "assigned_scoped_runtime_record",
        workspaceLibraryChanged: false
      }
    );
  } catch {
    // Diagnostic evidence is non-authoritative after verified business success.
  }
  return {
    ok: true,
    changed: submission.result.status === "committed",
    result: submission.result,
    authorityState: submission.authorityState
  };
}

async function recordMetadataFailure(error, reason) {
  await appendRuntimeDiagnostic(
    "error",
    "workspace_metadata_autosave_failed",
    "Assigned workspace metadata autosave failed without changing membership or promotion authority.",
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

function getAssignedWorkspaceMetadataMutationGateway() {
  return assignedMetadataMutationGateway;
}

function createAssignedWorkspaceMetadataMutationGateway({ resolveAuthority, mutationClient }) {
  if (typeof resolveAuthority !== "function" || !mutationClient || typeof mutationClient.submit !== "function") {
    throw new TypeError("Assigned workspace metadata mutation dependencies are invalid");
  }

  return Object.freeze({
    submitAutosave,
    submitCommit
  });

  function submitAutosave(input = {}) {
    return submit("workspace.metadata.autosave", {
      name: input?.name,
      aim: input?.aim
    });
  }

  function submitCommit(input = {}) {
    return submit("workspace.metadata.commit", {
      mode: input?.mode,
      name: input?.name,
      aim: input?.aim,
      workspaceType: input?.workspaceType,
      eventId: input?.eventId
    });
  }

  async function submit(mutationKind, payload) {
    const authorityState = await resolveFreshAuthority(resolveAuthority);
    if (!isAssignedWritableAuthorityState(authorityState)) {
      return unavailableAuthorityResult(authorityState);
    }

    let result;
    try {
      result = await mutationClient.submit({
        authority: authorityState.authority,
        mutationKind,
        payload
      });
    } catch (error) {
      return {
        ok: false,
        status: "failed",
        reason: "metadata_mutation_client_failed",
        result: null,
        authorityState: null,
        errors: [safeError(error)]
      };
    }

    if (!isVerifiedMetadataMutationResult(result)) {
      return {
        ok: false,
        status: typeof result?.status === "string" ? result.status : "failed",
        reason: typeof result?.reason === "string" && result.reason
          ? result.reason
          : "metadata_mutation_not_verified",
        result: result || null,
        authorityState: null,
        errors: Array.isArray(result?.errors) ? [...result.errors] : []
      };
    }

    return {
      ok: true,
      status: result.status,
      reason: result.reason || "",
      result,
      authorityState: await resolveFreshAuthority(resolveAuthority),
      errors: []
    };
  }
}

async function resolveFreshAuthority(resolveAuthority) {
  try {
    const state = await resolveAuthority();
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      return {
        status: "failed",
        reason: "assigned_authority_state_invalid",
        authority: null
      };
    }
    return state;
  } catch (error) {
    return {
      status: "failed",
      reason: "assigned_authority_resolve_failed",
      authority: null,
      errors: [safeError(error)]
    };
  }
}

function isAssignedWritableAuthorityState(state) {
  return state?.status === "assigned" &&
    state.authority !== null &&
    typeof state.authority === "object" &&
    state.authority.lifecycleState === "available";
}

function isVerifiedMetadataMutationResult(result) {
  return result &&
    ["committed", "no_change", "replayed"].includes(result.status) &&
    result.authorityVerified === true &&
    result.workspaceVerified === true;
}

function unavailableAuthorityResult(state) {
  return {
    ok: false,
    status: typeof state?.status === "string" ? state.status : "blocked",
    reason: typeof state?.reason === "string" && state.reason
      ? state.reason
      : "assigned_authority_unavailable",
    result: null,
    authorityState: state || null,
    errors: Array.isArray(state?.errors) ? [...state.errors] : []
  };
}

function metadataMutationFailureMessage(submission) {
  return submission?.reason || submission?.status || "assigned_metadata_mutation_failed";
}

function safeError(error) {
  return String(error?.message || error || "unknown_error");
}

export {
  createAssignedWorkspaceMetadataMutationGateway,
  getAssignedWorkspaceMetadataMutationGateway,
  runWithWorkspaceMetadataBarrier,
  runWithWorkspaceMetadataWriter
};
