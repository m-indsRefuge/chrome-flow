import { normalizeWorkspaceRevision } from "../runtime-contract/revision.js";
import { clone, nonEmptyString } from "../runtime-contract/value-utils.js";

export const RECONCILIATION_PROJECTION_FIELDS = Object.freeze(["tabId", "tabKey", "windowId", "groupId", "index", "url", "displayUrl", "originalTitle", "isOpen", "lastMatchStatus"]);

export function normalizeReconciliationTriggers(triggers) {
  return [...new Set((Array.isArray(triggers) ? triggers : [triggers]).map((value)=>String(value||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
}

export function captureWorkspaceProjectionSnapshot(workspace, capturedAt) {
  if (!nonEmptyString(workspace?.workspaceId)) return { valid:false, reason:"active_workspace_missing" };
  if (!Array.isArray(workspace.tabs)) return { valid:false, reason:"invalid_workspace_tabs" };
  const revision=normalizeWorkspaceRevision(workspace); if(!revision.valid)return{valid:false,reason:"invalid_workspace_revision"};
  const ids=workspace.tabs.map((tab)=>tab?.workspaceTabId);
  if(ids.some((id)=>!nonEmptyString(id))||new Set(ids).size!==ids.length)return{valid:false,reason:"invalid_workspace_tab_identity"};
  return { valid:true, snapshot:{ workspaceId:workspace.workspaceId, observedWorkspaceRevision:revision.revision, capturedAt, workspaceTabIds:[...ids], tabs:workspace.tabs.map((tab)=>({ workspaceTabId:tab.workspaceTabId, tabId:tab.tabId, url:tab.url||"", originalTitle:tab.originalTitle||"", observedProjection:captureOwnedProjection(tab) })) } };
}

export function createReconciliationPlan(snapshot, browserTabs, details) {
  const resolved=resolveWorkspaceTabs(snapshot.tabs,Array.isArray(browserTabs)?browserTabs:[]);
  const patches=resolved.map(createProjectionPatch).sort((a,b)=>a.workspaceTabId.localeCompare(b.workspaceTabId));
  return { schema:"constellation-workspace-projection-reconcile-v0.1", operationId:details.operationId, snapshot:{ workspaceId:snapshot.workspaceId, observedWorkspaceRevision:snapshot.observedWorkspaceRevision, capturedAt:snapshot.capturedAt, workspaceTabIds:[...snapshot.workspaceTabIds] }, patches, triggers:normalizeReconciliationTriggers(details.triggers), reconciledAt:details.reconciledAt };
}

function resolveWorkspaceTabs(workspaceTabs,browserTabs){const results=new Array(workspaceTabs.length),consumed=new Set(),unresolved=[];workspaceTabs.forEach((workspaceTab,index)=>{const exact=Number.isInteger(workspaceTab.tabId)?browserTabs.find((tab)=>tab.id===workspaceTab.tabId&&!consumed.has(tab.id)):null;if(exact){consumed.add(exact.id);results[index]={workspaceTab,liveTab:exact,matchStatus:"exact_tab_id",candidateCount:1};}else unresolved.push(index);});const demand=new Map();for(const index of unresolved){const url=String(workspaceTabs[index]?.url||"");if(url)demand.set(url,(demand.get(url)||0)+1);}for(const index of unresolved){const workspaceTab=workspaceTabs[index],url=String(workspaceTab?.url||""),matches=url?browserTabs.filter((tab)=>!consumed.has(tab.id)&&tab.url===url):[],needed=demand.get(url)||0;if(matches.length===1&&needed===1){consumed.add(matches[0].id);results[index]={workspaceTab,liveTab:matches[0],matchStatus:"single_url_fallback",candidateCount:1};}else results[index]={workspaceTab,liveTab:null,matchStatus:matches.length>1||(matches.length>0&&needed>1)?"ambiguous_url_matches":"not_found",candidateCount:matches.length};}return results;}
function createProjectionPatch(result){const base={workspaceTabId:result.workspaceTab.workspaceTabId,observedProjection:clone(result.workspaceTab.observedProjection),candidateCount:result.candidateCount};if(!result.liveTab)return{...base,projection:{isOpen:false,groupId:-1,lastMatchStatus:result.matchStatus}};const live=result.liveTab,url=live.url||result.workspaceTab.url||"",title=live.title||result.workspaceTab.originalTitle||"Untitled tab";return{...base,projection:{tabId:live.id,tabKey:String(url)+"::"+String(title),windowId:live.windowId,groupId:Number.isInteger(live.groupId)?live.groupId:-1,index:Number.isInteger(live.index)?live.index:null,url,displayUrl:createDisplayUrl(url),originalTitle:title,isOpen:true,lastMatchStatus:result.matchStatus}};}
function captureOwnedProjection(tab){const out={};for(const field of[...RECONCILIATION_PROJECTION_FIELDS,"lastSeenAt"])if(Object.hasOwn(tab,field)&&tab[field]!==undefined)out[field]=clone(tab[field]);return out;}
function createDisplayUrl(url){try{const parsed=new URL(url);return parsed.hostname+parsed.pathname.replace(/\/$/,"");}catch{return String(url||"");}}
