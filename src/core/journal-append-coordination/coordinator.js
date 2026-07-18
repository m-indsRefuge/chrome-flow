import { LOCK_NAMES, SCHEMAS } from "../runtime-contract/constants.js";
import { createAssignmentRegistry } from "../runtime-contract/assignments.js";
import { evaluateRuntimeMutation } from "../runtime-contract/mutation-engine.js";
import { normalizeWorkspaceRevision } from "../runtime-contract/revision.js";
import { validateJournalAppendRequest, response } from "./contract.js";
import { validateOperationLedger } from "./ledger-validation.js";
const RUNTIME_STATE_LOCK_NAME = "constellation-runtime-state-v0.1";
export async function coordinateJournalAppend(request, adapters) {
  const validation = validateJournalAppendRequest(request);
  if (!validation.valid) return response(request, "rejected", { reason: "invalid_request", errors: validation.errors });
  let callbackBegan=false;
  try { return await adapters.withRuntimeStateLock(LOCK_NAMES.runtimeState, async () => { callbackBegan=true; try {
    let read; try { read = await adapters.readLatestActiveWorkspace(); } catch { return response(request, "failed", { reason: "workspace_read_failed", retrySafe: true }); }
    if (!read?.value) return response(request, "failed", { reason: "active_workspace_missing", retrySafe: true });
    if (read.conflict || read.value.workspaceId !== request.workspaceId) return response(request, "workspace_conflict", { reason: read.conflict ? "compatibility_conflict" : "workspace_id_mismatch" });
    let ledger; try { ledger = await adapters.readOperationLedger(); } catch { return response(request, "failed", { reason: "operation_ledger_read_failed", retrySafe: true }); }
    const ledgerValidation=validateOperationLedger(ledger); if(!ledgerValidation.valid)return response(request,"failed",{reason:"operation_ledger_malformed",errors:ledgerValidation.errors,retrySafe:true});
    const revision = normalizeWorkspaceRevision(read.value); if (!revision.valid) return response(request, "rejected", { reason: "invalid_workspace_revision" });
    const existingOperation = ledger.entries.find((entry) => entry.operationId === request.operationId);
    const expectedRevision = Number.isInteger(existingOperation?.result?.previousRevision) ? existingOperation.result.previousRevision : revision.revision;
    const envelope = { schema: SCHEMAS.mutation, operationId: request.operationId, contextId: request.contextId, contextType: "side_panel", runtimeAssignmentId: "", assignmentEpoch: null, workspaceId: request.workspaceId, expectedRevision, mutationType: "journal.append", payload: { record: request.entry }, requestedAt: request.requestedAt, authorization: { mode: "operator_side_panel_journal_submission" } };
    const evaluated = evaluateRuntimeMutation({ workspace: read.value, envelope, operationLedger: ledger, assignmentRegistry: createAssignmentRegistry(), now: adapters.now() });
    if (!["committed", "no_change", "replayed"].includes(evaluated.result.status)) return response(request, evaluated.result.status, { previousRevision: evaluated.result.previousRevision, committedRevision: evaluated.result.committedRevision, reason: evaluated.result.reason });
    let workspaceCommitted = evaluated.result.status === "committed";
    if (evaluated.result.status === "committed") { try { await adapters.writeCompatibleActiveWorkspace(evaluated.workspace); } catch { return response(request, "failed", { reason: "workspace_write_failed", retrySafe: true }); } }
    let verified=false; try { verified=await adapters.verifyCompatibleActiveWorkspace(evaluated.workspace,request.entry); } catch { verified=false; }
    if(!verified)return response(request,"failed",{reason:"workspace_verification_failed",previousRevision:evaluated.result.previousRevision,committedRevision:evaluated.result.committedRevision,workspaceCommitted,retrySafe:true});
    try { await adapters.writeOperationLedger(evaluated.operationLedger); } catch { return response(request, "failed", { reason: workspaceCommitted ? "operation_ledger_write_failed_after_workspace_commit" : "operation_ledger_write_failed_after_verified_state", previousRevision: evaluated.result.previousRevision, committedRevision: evaluated.result.committedRevision, workspaceCommitted, workspaceVerified: verified, retrySafe: true }); }
    return response(request, evaluated.result.status, { previousRevision: evaluated.result.previousRevision, committedRevision: evaluated.result.committedRevision, workspaceCommitted, workspaceVerified: verified, ledgerRecorded: true, retrySafe: false, reason: evaluated.result.reason });
  } catch { return response(request,"failed",{reason:"journal_coordination_internal_failure",retrySafe:true}); }}); } catch { return response(request, "failed", { reason: callbackBegan ? "journal_coordination_internal_failure" : "runtime_state_lock_unavailable", retrySafe: true }); }
}
