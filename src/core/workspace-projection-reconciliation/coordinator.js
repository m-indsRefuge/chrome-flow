import { createAssignmentRegistry } from "../runtime-contract/assignments.js";
import { LOCK_NAMES, SCHEMAS } from "../runtime-contract/constants.js";
import { evaluateRuntimeObservation } from "../runtime-contract/mutation-engine.js";
import { normalizeWorkspaceRevision } from "../runtime-contract/revision.js";
import { stableStringify } from "../runtime-contract/value-utils.js";
import { createReconciliationResult, validateReconciliationRequest } from "./contract.js";

// Inventory evidence for constellation-runtime-state-v0.1; runtime authority is derived from the shared contract.
const RUNTIME_STATE_LOCK_NAME = LOCK_NAMES.runtimeState;

export async function coordinateWorkspaceProjectionReconciliation(request, adapters) {
  const validation=validateReconciliationRequest(request);
  if(!validation.valid)return createReconciliationResult(request,"rejected",{reason:"invalid_request",errors:validation.errors,retrySafe:false,phase:"validation",authorityPhase:"validation",triggers:request?.payload?.triggers});
  let phase="validation",callbackBegan=false;
  try {
    const result=await adapters.withRuntimeStateLock(RUNTIME_STATE_LOCK_NAME,async()=>{
      callbackBegan=true;phase="lock_acquired";
      let read;
      try{read=await adapters.readLatestActiveWorkspace();phase="workspace_read";}catch{return failure("workspace_read_failed",true);}
      if(!read?.canonicalPresent&&!read?.legacyPresent)return failure("active_workspace_missing",true);
      if(read.conflict)return outcome("workspace_conflict","compatibility_conflict");
      if(!read.value?.workspaceId)return failure("active_workspace_missing",true);
      if(read.value.workspaceId!==request.workspaceId)return outcome("workspace_conflict","workspace_id_mismatch");
      const revision=normalizeWorkspaceRevision(read.value);
      if(!revision.valid)return outcome("rejected","invalid_workspace_revision");
      const envelope={schema:SCHEMAS.mutation,operationId:request.operationId,contextId:request.contextId,contextType:"service_worker",runtimeAssignmentId:"",assignmentEpoch:null,workspaceId:request.workspaceId,expectedRevision:revision.revision,mutationType:"workspace.projection.reconcile",payload:request.payload,requestedAt:request.requestedAt,authorization:{mode:"automatic_browser_projection_reconciliation"}};
      const evaluated=evaluateRuntimeObservation({workspace:read.value,envelope,assignmentRegistry:createAssignmentRegistry(),now:request.payload.reconciledAt});
      phase="mutation_evaluated";
      const details=mutationDetails(evaluated.workspace,request,evaluated.result.status);
      if(!["committed","no_change"].includes(evaluated.result.status))return createReconciliationResult(request,evaluated.result.status,{reason:evaluated.result.reason,previousRevision:evaluated.result.previousRevision,committedRevision:evaluated.result.committedRevision,retrySafe:evaluated.result.status==="revision_conflict",phase,authorityPhase:phase,...details});
      const peersComplete=read.canonicalPresent&&read.legacyPresent&&read.equivalent&&!read.conflict;
      if(evaluated.result.status==="no_change"){
        if(!peersComplete)return createReconciliationResult(request,"workspace_conflict",{reason:"compatible_peer_missing",previousRevision:evaluated.result.previousRevision,committedRevision:evaluated.result.committedRevision,retrySafe:true,phase,authorityPhase:phase,...details});
        let verifiedRead;
        try{verifiedRead=await adapters.readLatestActiveWorkspace();}catch{return createReconciliationResult(request,"failed",{reason:"workspace_verification_read_failed",previousRevision:evaluated.result.previousRevision,committedRevision:evaluated.result.committedRevision,retrySafe:true,phase,authorityPhase:phase,...details});}
        if(!verifyCompleteWorkspace(verifiedRead,evaluated.workspace))return createReconciliationResult(request,"failed",{reason:"workspace_verification_failed",previousRevision:evaluated.result.previousRevision,committedRevision:evaluated.result.committedRevision,retrySafe:true,phase,authorityPhase:phase,...details});
        phase="workspace_verified";
        return createReconciliationResult(request,"no_change",{reason:"projection_current",previousRevision:evaluated.result.previousRevision,committedRevision:evaluated.result.committedRevision,workspaceVerified:true,retrySafe:false,phase,authorityPhase:phase,...details});
      }
      try{await adapters.writeCompatibleActiveWorkspace(evaluated.workspace);phase="workspace_write_returned";}catch{return createReconciliationResult(request,"failed",{reason:"workspace_write_failed",previousRevision:evaluated.result.previousRevision,committedRevision:evaluated.result.committedRevision,retrySafe:true,phase,authorityPhase:phase,...details});}
      let verifiedRead;
      try{verifiedRead=await adapters.readLatestActiveWorkspace();}catch{return createReconciliationResult(request,"failed",{reason:"workspace_verification_read_failed",previousRevision:evaluated.result.previousRevision,committedRevision:evaluated.result.committedRevision,workspaceCommitted:true,retrySafe:true,phase,authorityPhase:phase,...details});}
      if(!verifyCompleteWorkspace(verifiedRead,evaluated.workspace))return createReconciliationResult(request,"failed",{reason:"workspace_verification_failed",previousRevision:evaluated.result.previousRevision,committedRevision:evaluated.result.committedRevision,workspaceCommitted:true,retrySafe:true,phase,authorityPhase:phase,...details});
      phase="workspace_verified";
      return createReconciliationResult(request,"committed",{previousRevision:evaluated.result.previousRevision,committedRevision:evaluated.result.committedRevision,workspaceCommitted:true,workspaceVerified:true,retrySafe:false,phase,authorityPhase:phase,...details});
    });
    return {...result,phase:"lock_released",authorityPhase:result.authorityPhase};
  } catch {
    return createReconciliationResult(request,"failed",{reason:callbackBegan?"reconciliation_coordination_internal_failure":"runtime_state_lock_unavailable",workspaceCommitted:phase==="workspace_write_returned"||phase==="workspace_verified",workspaceVerified:phase==="workspace_verified",retrySafe:true,phase,authorityPhase:phase,triggers:request.payload.triggers});
  }

  function failure(reason,retrySafe){return createReconciliationResult(request,"failed",{reason,retrySafe,phase,authorityPhase:phase,triggers:request.payload.triggers});}
  function outcome(status,reason){return createReconciliationResult(request,status,{reason,retrySafe:false,phase,authorityPhase:phase,triggers:request.payload.triggers});}
}

export async function recordReconciliationEffects(result, adapters, options = {}) {
  let next={...result,warnings:[...result.warnings]};
  const effects=effectPolicy(next,options.reconciliationStarted!==false);
  if(effects.diagnostic){try{await adapters.appendDiagnostic(diagnosticFor(next));next={...next,diagnosticRecorded:true,phase:"diagnostic_attempted"};}catch{next={...next,phase:"diagnostic_attempted",warnings:[...next.warnings,"diagnostic_write_failed"]};}}
  if(effects.notification){try{await adapters.sendNotification(next);next={...next,notificationSent:true,phase:"notification_attempted"};}catch{next={...next,phase:"notification_attempted",warnings:[...next.warnings,"notification_failed"]};}}
  return next;
}

function verifyCompleteWorkspace(read,expected){return Boolean(read?.canonicalPresent&&read?.legacyPresent&&read?.equivalent&&!read?.conflict&&stableStringify(read.value)===stableStringify(expected)&&stableStringify(read.canonicalValue)===stableStringify(expected)&&stableStringify(read.legacyValue)===stableStringify(expected));}
function mutationDetails(workspace,request,status){if(status!=="committed")return{recordsExamined:request.payload.snapshot.workspaceTabIds.length,recordsChanged:0,transitionCount:0,triggers:request.payload.triggers};const metadata=workspace.projectionReconciliation||{},prefix=request.operationId+":transition:";return{recordsExamined:metadata.recordsExamined||0,recordsChanged:metadata.recordsChanged||0,transitionCount:(Array.isArray(workspace.timeline)?workspace.timeline:[]).filter((event)=>String(event?.eventId||"").startsWith(prefix)).length,triggers:request.payload.triggers};}
function diagnosticFor(result){const action=result.status==="committed"?"workspace_projection_reconciled":result.status==="no_change"?"workspace_projection_reconciliation_verified":result.status==="workspace_conflict"?"workspace_projection_reconciliation_aborted":"workspace_projection_reconciliation_failed";return{level:["committed","no_change"].includes(result.status)?"info":result.status==="workspace_conflict"?"warn":"error",action,message:"Automatic browser projection reconciliation completed with status "+result.status+".",details:result};}
function effectPolicy(result,reconciliationStarted){const startup=result.triggers.some((trigger)=>["extension_installed","extension_startup","sidepanel_startup"].includes(trigger));if(result.status==="committed")return{diagnostic:true,notification:true};if(result.status==="no_change")return{diagnostic:startup,notification:false};if(["workspace_conflict","rejected","failed"].includes(result.status))return{diagnostic:reconciliationStarted,notification:false};return{diagnostic:false,notification:false};}

export { verifyCompleteWorkspace };
