import { readCompatibleStorageValue, stableStringify } from "../constellation-storage-compatibility.js";
import { clone, isPlainObject, nonEmptyString, serializableErrors } from "../runtime-contract/value-utils.js";
import { normalizeWorkspaceRevision } from "../runtime-contract/revision.js";
import { isValidRuntimeWorkspaceId } from "../runtime-workspace-record/contract.js";
import { SIDE_PANEL_ASSIGNED_WORKSPACE_AUTHORITY_SCHEMA } from "../runtime-window-binding/side-panel-authority.js";
const ASSIGNED_AUTHORITY_FIELDS = ["schema", "runtimeSessionId", "sourceContextId", "sourceWindowId", "workspaceId", "workspaceRevision", "runtimeAssignmentId", "assignmentEpoch", "authorityRevision", "lifecycleState", "workspace"];
export async function readActiveWorkspaceReadonly() { const read=await readCompatibleStorageValue("activeWorkspace"); if(read.conflict) return {ok:false,reason:"compatibility_conflict"}; if(!read.value) return {ok:false,reason:"active_workspace_missing"}; return {ok:true,workspace:read.value}; }
export function readAssignedWorkspaceReadonly(authority) { const validation=snapshotAndValidateAssignedAuthority(authority); if(!validation.valid)return {ok:false,reason:"invalid_assigned_authority"}; try{return {ok:true,workspace:clone(validation.authority.workspace)};}catch{return {ok:false,reason:"invalid_assigned_authority"};} }
export function equivalentWorkspace(left,right){return stableStringify(left)===stableStringify(right)}
export function verifyCompatibleWorkspaceRead(read,expected,entry){if(!read||read.canonicalPresent!==true||read.legacyPresent!==true||read.equivalent!==true||read.conflict!==false||!equivalentWorkspace(read.value,expected))return false;const matches=(read.value?.journal||[]).filter(item=>item.entryId===entry.entryId);return matches.length===1&&stableStringify(matches[0])===stableStringify(entry)}

function snapshotAndValidateAssignedAuthority(value) {
  const errors=[];
  let authority;
  try {
    if(!isPlainObject(value))return {valid:false,errors:["assigned authority must be a plain object"],authority:null};
    errors.push(...serializableErrors(value,"assignedAuthority"));
    if(errors.length)return {valid:false,errors,authority:null};
    authority=clone(value);
  } catch (error) { return {valid:false,errors:["assigned authority snapshot failed: "+String(error?.message||error||"unknown_error")],authority:null}; }
  if(Object.keys(authority).sort().join("|")!==[...ASSIGNED_AUTHORITY_FIELDS].sort().join("|"))errors.push("assigned authority fields must match the exact contract");
  if(authority.schema!==SIDE_PANEL_ASSIGNED_WORKSPACE_AUTHORITY_SCHEMA)errors.push("assigned authority schema is invalid");
  for(const field of["runtimeSessionId","sourceContextId","runtimeAssignmentId"])if(!nonEmptyString(authority[field]))errors.push("assigned authority "+field+" is invalid");
  if(!Number.isSafeInteger(authority.sourceWindowId)||authority.sourceWindowId<0)errors.push("assigned authority sourceWindowId is invalid");
  if(!isValidRuntimeWorkspaceId(authority.workspaceId))errors.push("assigned authority workspaceId is invalid");
  if(!Number.isSafeInteger(authority.workspaceRevision)||authority.workspaceRevision<0)errors.push("assigned authority workspaceRevision is invalid");
  if(!Number.isSafeInteger(authority.assignmentEpoch)||authority.assignmentEpoch<=0)errors.push("assigned authority assignmentEpoch is invalid");
  if(!Number.isSafeInteger(authority.authorityRevision)||authority.authorityRevision<0)errors.push("assigned authority authorityRevision is invalid");
  if(authority.lifecycleState!=="available")errors.push("assigned authority lifecycleState is not writable");
  if(!isPlainObject(authority.workspace))errors.push("assigned authority workspace is invalid"); else {
    if(authority.workspace.workspaceId!==authority.workspaceId)errors.push("assigned authority workspace identity does not match workspaceId");
    const revision=normalizeWorkspaceRevision(authority.workspace);
    if(!revision.valid||revision.revision!==authority.workspaceRevision)errors.push("assigned authority workspace revision does not match");
  }
  return {valid:errors.length===0,errors,authority:errors.length?null:authority};
}
