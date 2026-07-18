import { readCompatibleStorageValue, stableStringify } from "../constellation-storage-compatibility.js";
import { LOCK_NAMES } from "../runtime-contract/constants.js";
import { coordinateRuntimeWorkspaceActivation } from "../runtime-workspace-activation/coordinator.js";
import { createRuntimeWorkspaceActivationChromeAdapters } from "../runtime-workspace-activation/chrome-adapter.js";
import { createAutomaticPromotionChromeAdapters } from "../workspace-automatic-promotion-integration/chrome-adapter.js";
import { snapshotSerializable } from "./contract.js";

export function createWorkspaceManualPlacementChromeAdapters(chromeApi, dependencyInput = {}) {
  const realRequestLock = dependencyInput.requestLock || ((name, callback) => {
    if (!globalThis.navigator?.locks?.request) throw new Error("Web Locks unavailable");
    return globalThis.navigator.locks.request(name, callback);
  });
  let manualExclusiveDepth = 0;
  const promotionAdapters = createAutomaticPromotionChromeAdapters(chromeApi, { ...dependencyInput, requestLock: realRequestLock });
  const activationAdapters = createRuntimeWorkspaceActivationChromeAdapters(chromeApi, {
    ...dependencyInput,
    requestLock: (name, callback) => {
      if (name === LOCK_NAMES.exclusiveOperation && manualExclusiveDepth === 1) return callback();
      return realRequestLock(name, callback);
    }
  });
  const readCompatibleWorkspace = dependencyInput.readCompatibleWorkspace || (() => readCompatibleStorageValue("activeWorkspace"));

  return {
    async runExclusiveOperation(callback) {
      return promotionAdapters.runExclusiveOperation(async () => {
        if (manualExclusiveDepth !== 0) throw new Error("manual placement re-entry is not allowed");
        manualExclusiveDepth += 1;
        try { return await callback(); }
        finally { manualExclusiveDepth -= 1; }
      });
    },
    readOperationLedger: () => promotionAdapters.readOperationLedger(),
    writeOperationLedger: (ledger) => promotionAdapters.writeOperationLedger(ledger),
    readPlacementState: (request) => promotionAdapters.readPromotionState(request),
    readManualPlacementEvidence: (request) => readManualPlacementEvidence(request, readCompatibleWorkspace),
    executeExistingTabMove: (request) => promotionAdapters.executeExistingTabMove(request),
    transferActive: (request) => coordinateRuntimeWorkspaceActivation(request, activationAdapters),
    writeWorkspacePlacement: (request) => promotionAdapters.writeWorkspacePlacement(request)
  };
}

async function readManualPlacementEvidence(input, readCompatibleWorkspace) {
  const snapshot = snapshotSerializable(input);
  if (!snapshot.ok || !nonEmpty(snapshot.value?.workspaceId) || !nonEmpty(snapshot.value?.timelineEvent?.eventId)) {
    return evidenceResult("failed", null, "manual_placement_timeline_evidence_request_invalid");
  }
  let compatibleRead;
  try { compatibleRead = await readCompatibleWorkspace(); }
  catch { return evidenceResult("failed", null, "workspace_read_failed"); }
  if (!compatibleRead?.canonicalPresent || !compatibleRead?.legacyPresent || !compatibleRead?.equivalent || compatibleRead?.conflict) {
    return evidenceResult("conflict", null, "workspace_compatibility_conflict");
  }
  const workspaceSnapshot = snapshotSerializable(compatibleRead.value);
  if (!workspaceSnapshot.ok || workspaceSnapshot.value?.workspaceId !== snapshot.value.workspaceId || !Array.isArray(workspaceSnapshot.value?.timeline)) {
    return evidenceResult("failed", null, "workspace_timeline_state_invalid");
  }
  const matches = workspaceSnapshot.value.timeline.filter((event) => event?.eventId === snapshot.value.timelineEvent.eventId);
  if (matches.length === 0) return evidenceResult("missing", 0, "manual_placement_timeline_evidence_missing");
  if (matches.length !== 1 || stableStringify(matches[0]) !== stableStringify(snapshot.value.timelineEvent)) {
    return evidenceResult("conflict", matches.length, "manual_placement_timeline_evidence_conflict");
  }
  return evidenceResult("verified", 1, "");
}

function evidenceResult(status, count, error) { return { status, count, error }; }
function nonEmpty(value) { return typeof value === "string" && value.trim().length > 0; }
