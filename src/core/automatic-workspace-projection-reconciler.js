import { createChromeReconciliationAdapters } from "./workspace-projection-reconciliation/chrome-adapter.js";
import { createReconciliationResult } from "./workspace-projection-reconciliation/contract.js";
import { coordinateWorkspaceProjectionReconciliation, recordReconciliationEffects } from "./workspace-projection-reconciliation/coordinator.js";
import { captureWorkspaceProjectionSnapshot, createReconciliationPlan, normalizeReconciliationTriggers } from "./workspace-projection-reconciliation/planner.js";
import { createReconciliationScheduler } from "./workspace-projection-reconciliation/scheduler.js";

const RECONCILE_DEBOUNCE_MS = 220;
let contextId="";

async function reconcileActiveWorkspaceProjection(context={}) {
  const adapters=createChromeReconciliationAdapters(chrome);
  const operationId=adapters.createId();
  if(!contextId)contextId=adapters.createId();
  const requestedAt=adapters.now();
  const triggers=normalizeReconciliationTriggers(context.triggers||[]);
  let initialRead;
  try{initialRead=await adapters.readLatestActiveWorkspace();}
  catch{return recordReconciliationEffects(initialFailure("workspace_read_failed",true),adapters,{reconciliationStarted:false});}
  if(initialRead?.conflict)return recordReconciliationEffects(initialOutcome("workspace_conflict","compatibility_conflict"),adapters,{reconciliationStarted:false});
  if(!initialRead?.value?.workspaceId)return recordReconciliationEffects(initialFailure("active_workspace_missing",true),adapters,{reconciliationStarted:false});
  const capturedAt=adapters.now();
  const captured=captureWorkspaceProjectionSnapshot(initialRead.value,capturedAt);
  if(!captured.valid)return recordReconciliationEffects(initialOutcome("rejected",captured.reason),adapters,{reconciliationStarted:false});
  let browserTabs;
  try{browserTabs=await adapters.queryTabs();}
  catch{return recordReconciliationEffects(initialFailure("browser_snapshot_failed",true),adapters,{reconciliationStarted:true});}
  const reconciledAt=adapters.now();
  const payload=createReconciliationPlan(captured.snapshot,browserTabs,{operationId,triggers,reconciledAt});
  const request={schema:"constellation-workspace-projection-reconcile-v0.1",operationId,contextId,workspaceId:captured.snapshot.workspaceId,requestedAt,payload};
  const result=await coordinateWorkspaceProjectionReconciliation(request,adapters);
  return recordReconciliationEffects(result,adapters);

  function initialFailure(reason,retrySafe){return createReconciliationResult({operationId,workspaceId:initialRead?.value?.workspaceId||""},"failed",{reason,retrySafe,phase:"validation",authorityPhase:"validation",triggers});}
  function initialOutcome(status,reason){return createReconciliationResult({operationId,workspaceId:initialRead?.value?.workspaceId||""},status,{reason,retrySafe:false,phase:"validation",authorityPhase:"validation",triggers});}
}

async function executeScheduledReconciliation(context) {
  try{return await reconcileActiveWorkspaceProjection(context);}
  catch(error){const adapters=createChromeReconciliationAdapters(chrome),operationId=adapters.createId(),result=createReconciliationResult({operationId,workspaceId:""},"failed",{reason:"reconciliation_execution_failed",retrySafe:true,phase:"validation",authorityPhase:"validation",triggers:normalizeReconciliationTriggers(context?.triggers||[]),errors:[error?.message||String(error)]});return recordReconciliationEffects(result,adapters,{reconciliationStarted:false});}
}

const scheduler=createReconciliationScheduler({setTimer:(callback,delay)=>setTimeout(callback,delay),clearTimer:(timer)=>clearTimeout(timer),execute:executeScheduledReconciliation,debounceMs:RECONCILE_DEBOUNCE_MS});

function scheduleWorkspaceProjectionReconciliation(trigger="unspecified") { scheduler.schedule(trigger); }

export { reconcileActiveWorkspaceProjection, scheduleWorkspaceProjectionReconciliation };
