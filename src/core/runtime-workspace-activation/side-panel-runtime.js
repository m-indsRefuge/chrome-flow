import { readCompatibleStorageValue } from "../constellation-storage-compatibility.js";
import { normalizeWorkspaceRevision } from "../runtime-contract/revision.js";
import { getSidePanelAssignedWorkspaceAuthority, getSidePanelRuntimeSessionContextClient } from "../runtime-window-binding/side-panel-authority.js";
import { createRuntimeWorkspaceActivationClient } from "./client.js";

export const RUNTIME_WORKSPACE_COMMIT_EVENT = "constellation-runtime-workspace-commit-verified";

let singleton = null;

export function getSidePanelRuntimeWorkspaceAuthority() {
  if (singleton) return singleton;
  singleton = createSidePanelRuntimeWorkspaceAuthority({
    contextClient: getSidePanelRuntimeSessionContextClient(),
    bindingAuthority: getSidePanelAssignedWorkspaceAuthority(),
    activationClient: createRuntimeWorkspaceActivationClient({
      createId: () => crypto.randomUUID(),
      now: () => new Date().toISOString(),
      send: (request) => chrome.runtime.sendMessage(request)
    }),
    readCompatibleWorkspace: () => readCompatibleStorageValue("activeWorkspace"),
    dispatchCommit: (detail) => globalThis.dispatchEvent?.(new CustomEvent(RUNTIME_WORKSPACE_COMMIT_EVENT, { detail }))
  });
  return singleton;
}

export function createSidePanelRuntimeWorkspaceAuthority({ contextClient, activationClient, readCompatibleWorkspace, bindingAuthority = null, dispatchCommit = () => undefined }) {
  let latestState = { status: "idle", reason: "", result: null };
  let inFlight = null;
  let lastReplacementInput = null;
  const listeners = new Set();

  async function bootstrapExisting(options = {}) {
    if (inFlight && !options.force) return inFlight;
    inFlight = executeBootstrap(options.workspace || null).finally(() => { inFlight = null; });
    return inFlight;
  }

  async function executeBootstrap(providedWorkspace) {
    if (bindingAuthority) return acceptBindingState(await bindingAuthority.resolve());
    const context = await contextClient.register();
    if (!verifiedContext(context)) return update("blocked", context?.reason || "runtime_context_not_verified", null);
    const workspaceRead = providedWorkspace ? normalizeProvidedWorkspace(providedWorkspace) : normalizeCompatibleRead(await readCompatibleWorkspace());
    if (!workspaceRead.valid) return update("blocked", workspaceRead.reason, null);
    if (
      lastReplacementInput &&
      latestState.result?.operation === "replace_active" &&
      latestState.result.workspaceVerified === true &&
      workspaceRead.workspace.workspaceId === lastReplacementInput.candidateWorkspace.workspaceId
    ) {
      const recovered = await activationClient.replaceActive(lastReplacementInput);
      const recoveredState = acceptResult(recovered, lastReplacementInput.sourceWindowId, "replacement");
      if (verifiedState(recoveredState)) lastReplacementInput = null;
      return recoveredState;
    }
    const result = await activationClient.bootstrapExisting({
      sourceContextId: context.context.contextId,
      sourceWindowId: context.context.windowId,
      expectedWorkspaceId: workspaceRead.workspace.workspaceId,
      expectedWorkspaceRevision: workspaceRead.revision
    });
    return acceptResult(result, context.context.windowId, "activation");
  }

  async function replaceActive(candidateWorkspace, targetWindowId) {
    const baseline = await bootstrapExisting();
    if (baseline.status !== "active") return baseline;
    return executeReplacement(candidateWorkspace, targetWindowId, baseline.result);
  }

  async function replaceActiveFromVerifiedEvidence(candidateWorkspace, targetWindowId, authorityEvidence) {
    const prior = snapshotVerifiedActiveEvidence(authorityEvidence);
    if (!prior.valid) return update("blocked", "replacement_authority_evidence_invalid", null);
    return executeReplacement(candidateWorkspace, targetWindowId, prior.result);
  }

  async function recoverActiveAfterRollback(previousWorkspace, authorityEvidence) {
    const prior = snapshotVerifiedActiveEvidence(authorityEvidence);
    const previous = normalizeProvidedWorkspace(previousWorkspace);
    if (!prior.valid || !previous.valid || previous.workspace.workspaceId !== prior.result.activeWorkspaceId) {
      return update("blocked", "rollback_authority_recovery_input_invalid", null);
    }
    lastReplacementInput = null;
    const context = await contextClient.register();
    if (!verifiedContext(context) || context.context.contextId !== prior.result.sourceContextId || context.context.windowId !== prior.result.sourceWindowId) {
      return update("blocked", context?.reason || "rollback_source_context_not_verified", null);
    }
    const result = await activationClient.bootstrapExisting({
      sourceContextId: context.context.contextId,
      sourceWindowId: context.context.windowId,
      expectedWorkspaceId: previous.workspace.workspaceId,
      expectedWorkspaceRevision: previous.revision
    });
    return acceptResult(result, context.context.windowId, "rollback_recovery");
  }

  async function executeReplacement(candidateWorkspace, targetWindowId, prior) {
    const candidate = normalizeProvidedWorkspace(candidateWorkspace);
    if (!candidate.valid || !Number.isSafeInteger(targetWindowId) || targetWindowId < 0) return update("blocked", "replacement_input_invalid", null);
    lastReplacementInput = {
      sourceContextId: prior.sourceContextId,
      sourceWindowId: prior.sourceWindowId,
      expectedWorkspaceId: prior.activeWorkspaceId,
      expectedWorkspaceRevision: prior.activeWorkspaceRevision,
      candidateWorkspace: candidate.workspace,
      targetWindowId,
      expectedRuntimeAssignmentId: prior.currentRuntimeAssignmentId,
      expectedAssignmentEpoch: prior.currentAssignmentEpoch,
    };
    const result = await activationClient.replaceActive(lastReplacementInput);
    const state = acceptResult(result, prior.sourceWindowId, "replacement");
    if (verifiedState(state)) lastReplacementInput = null;
    return state;
  }

  async function transferActive(targetWindowId) {
    const baseline = await bootstrapExisting();
    if (baseline.status !== "active") return baseline;
    const prior = baseline.result;
    if (!Number.isSafeInteger(targetWindowId) || targetWindowId < 0 || !prior.currentRuntimeAssignmentId || !Number.isInteger(prior.currentAssignmentEpoch)) return update("blocked", "transfer_input_invalid", null);
    const result = await activationClient.transferActive({
      sourceContextId: prior.sourceContextId,
      sourceWindowId: prior.sourceWindowId,
      expectedWorkspaceId: prior.activeWorkspaceId,
      expectedWorkspaceRevision: prior.activeWorkspaceRevision,
      targetWindowId,
      expectedRuntimeAssignmentId: prior.currentRuntimeAssignmentId,
      expectedAssignmentEpoch: prior.currentAssignmentEpoch
    });
    return acceptResult(result, prior.sourceWindowId, "placement");
  }

  function acceptResult(result, sourceWindowId, commitKind) {
    const verified = ["committed", "no_change", "replayed"].includes(result?.status) && result.workspaceVerified === true && result.assignmentVerified === true;
    if (!verified) return update(result?.readOnly ? "read_only" : "blocked", result?.reason || "activation_not_verified", result || null);
    const callerReadOnly = result.readOnly === true || result.targetWindowId !== sourceWindowId;
    const state = update(callerReadOnly ? "read_only" : "active", callerReadOnly ? "workspace_assigned_to_another_window" : "", result);
    try { dispatchCommit({ kind: commitKind, result: structuredClone(result) }); } catch { /* Display refresh is non-authoritative. */ }
    return state;
  }

  function acceptBindingState(state) {
    const result = state?.result;
    if (state?.status === "assigned" && state.authority && result?.authorityVerified === true && result?.workspaceVerified === true) {
      return update("active", "", {
        status: "no_change",
        reason: "",
        operation: "resolve_binding",
        operationId: result.operationId,
        sourceContextId: result.sourceContextId,
        sourceWindowId: result.sourceWindowId,
        expectedWorkspaceId: result.workspaceId,
        expectedWorkspaceRevision: result.workspaceRevision,
        activeWorkspaceId: result.workspaceId,
        activeWorkspaceRevision: result.workspaceRevision,
        targetWindowId: result.sourceWindowId,
        currentRuntimeAssignmentId: result.runtimeAssignmentId,
        currentAssignmentEpoch: result.assignmentEpoch,
        runtimeSessionId: result.runtimeSessionId,
        authorityRevisionAfter: result.authorityRevision,
        workspaceVerified: true,
        assignmentVerified: true,
        readOnly: false,
        workspace: structuredClone(result.workspace),
        bindingResultSchema: result.schema
      });
    }
    if (state?.status === "active_elsewhere") return update("read_only", result?.reason || "workspace_assigned_to_another_window", result || null);
    if (state?.status === "unbound") return update("unbound", "", result || null);
    return update("blocked", state?.reason || result?.reason || "window_binding_not_verified", result || null);
  }

  function update(status, reason, result) {
    latestState = { status, reason, result: result ? structuredClone(result) : null };
    for (const listener of listeners) {
      try { listener(structuredClone(latestState)); } catch { /* Listener failure cannot change authority. */ }
    }
    return structuredClone(latestState);
  }

  return {
    bootstrapExisting,
    replaceActive,
    replaceActiveFromVerifiedEvidence,
    recoverActiveAfterRollback,
    transferActive,
    get latestState() { return structuredClone(latestState); },
    get verifiedEvidence() { return latestState.status === "active" && latestState.result ? structuredClone(latestState.result) : null; },
    get assignedAuthority() { return bindingAuthority?.assignedAuthority || null; },
    get assignedWorkspace() { return bindingAuthority?.assignedAuthority?.workspace || null; },
    subscribe(listener) { if (typeof listener !== "function") throw new TypeError("activation listener is required"); listeners.add(listener); return () => listeners.delete(listener); }
  };
}

function snapshotVerifiedActiveEvidence(evidence) {
  let result;
  try { result = structuredClone(evidence); }
  catch { return { valid: false, result: null }; }
  const valid = Boolean(result && typeof result === "object" && !Array.isArray(result) &&
    ["committed", "no_change", "replayed"].includes(result.status) && result.workspaceVerified === true && result.assignmentVerified === true && result.readOnly !== true &&
    typeof result.sourceContextId === "string" && result.sourceContextId.length > 0 && Number.isSafeInteger(result.sourceWindowId) && result.sourceWindowId >= 0 &&
    result.targetWindowId === result.sourceWindowId && typeof result.activeWorkspaceId === "string" && result.activeWorkspaceId.length > 0 &&
    Number.isInteger(result.activeWorkspaceRevision) && result.activeWorkspaceRevision >= 0 && typeof result.currentRuntimeAssignmentId === "string" && result.currentRuntimeAssignmentId.length > 0 &&
    Number.isInteger(result.currentAssignmentEpoch) && result.currentAssignmentEpoch >= 1);
  return valid ? { valid: true, result } : { valid: false, result: null };
}

function verifiedState(state) {
  return Boolean(["active", "read_only"].includes(state?.status) && ["committed", "no_change", "replayed"].includes(state?.result?.status) && state.result.workspaceVerified === true && state.result.assignmentVerified === true);
}

function normalizeCompatibleRead(read) {
  if (!read?.canonicalPresent && !read?.legacyPresent) return { valid: false, reason: "active_workspace_absent" };
  if (read?.conflict || !read?.canonicalPresent || !read?.legacyPresent || !read?.equivalent) return { valid: false, reason: "workspace_compatibility_conflict" };
  return normalizeProvidedWorkspace(read.value);
}

function normalizeProvidedWorkspace(workspace) {
  const revision = normalizeWorkspaceRevision(workspace);
  return workspace && typeof workspace === "object" && !Array.isArray(workspace) && typeof workspace.workspaceId === "string" && workspace.workspaceId.length > 0 && Array.isArray(workspace.tabs) && revision.valid
    ? { valid: true, workspace: structuredClone(workspace), revision: revision.revision }
    : { valid: false, reason: "workspace_state_malformed" };
}

function verifiedContext(result) {
  return Boolean(result?.authorityVerified && result.context?.contextType === "side_panel" && typeof result.context.contextId === "string" && Number.isSafeInteger(result.context.windowId));
}
