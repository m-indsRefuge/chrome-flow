import {
  JOURNAL_APPEND_ASSIGNED_REQUEST_SCHEMA,
  JOURNAL_APPEND_REQUEST_SCHEMA,
  assignedResponse,
  response,
  validateAssignedJournalAppendRequest,
  validateAssignedJournalAppendResponse,
  validateJournalAppendResponse
} from "./contract.js";
import { readAssignedWorkspaceReadonly } from "./readonly-workspace.js";

export function createJournalAppendClient({createId,now,send,refresh,clear,status}) {
  let contextId,pending,inFlight;

  async function execute(request) {
    const assigned = request?.schema === JOURNAL_APPEND_ASSIGNED_REQUEST_SCHEMA;
    const validate = assigned ? validateAssignedJournalAppendResponse : validateJournalAppendResponse;
    let result;
    try {
      result = await send(request);
      if (!validate(result,request).valid) throw Error();
    } catch {
      result = assigned
        ? assignedResponse(request,{reason:"malformed_or_mismatched_response",phase:"transport_response_validation",retrySafe:true})
        : response(request,"failed",{reason:"malformed_or_mismatched_response",retrySafe:true});
    }
    const success=["committed","replayed","no_change"].includes(result.status)&&result.workspaceVerified===true;
    status(result);
    if(success&&pending===request){pending=undefined;clear();await refresh();}
    return result;
  }

  function submit(input) {
    const assigned = hasOwn(input,"authority");
    if (!assigned) contextId ||= createId();
    if(inFlight)return inFlight;
    if(!pending) {
      if (assigned) {
        const created = createAssignedRequest(input,createId,now);
        if (created.failure) {
          status(created.failure);
          return Promise.resolve(created.failure);
        }
        pending = created.request;
      } else {
        pending={schema:JOURNAL_APPEND_REQUEST_SCHEMA,operationId:createId(),contextId,workspaceId:input.workspaceId,requestedAt:now(),entry:{...input.entry,entryId:createId()}};
      }
    }
    const request=pending;
    inFlight=execute(request).finally(()=>{inFlight=undefined});
    return inFlight;
  }

  return {get pending(){return pending},submit};
}

function createAssignedRequest(input,createId,now) {
  let authority;
  try { authority=structuredClone(input.authority); }
  catch (error) { return {failure:assignedFailure(undefined,input,"invalid_assigned_authority","authority_validation",false,[safeError(error)])}; }
  if(!readAssignedWorkspaceReadonly(authority).ok) {
    return {failure:assignedFailure(authority,input,"invalid_assigned_authority","authority_validation")};
  }
  let request;
  try {
    request={
      schema:JOURNAL_APPEND_ASSIGNED_REQUEST_SCHEMA,
      operationId:createId(),
      runtimeSessionId:authority.runtimeSessionId,
      sourceContextId:authority.sourceContextId,
      sourceWindowId:authority.sourceWindowId,
      workspaceId:authority.workspaceId,
      expectedWorkspaceRevision:authority.workspaceRevision,
      runtimeAssignmentId:authority.runtimeAssignmentId,
      assignmentEpoch:authority.assignmentEpoch,
      requestedAt:now(),
      entry:{...input.entry,entryId:createId()}
    };
  } catch (error) { return {failure:assignedFailure(authority,input,"request_generation_failed","request_generation",true,[safeError(error)])}; }
  const validation=validateAssignedJournalAppendRequest(request);
  if(!validation.valid)return {failure:assignedResponse(request,{status:"rejected",reason:"invalid_request",phase:"request_validation",errors:validation.errors})};
  return {request};
}

function assignedFailure(authority,input,reason,phase,retrySafe=false,errors=[]) {
  return assignedResponse({
    schema:JOURNAL_APPEND_ASSIGNED_REQUEST_SCHEMA,
    operationId:"",
    runtimeSessionId:readField(authority,"runtimeSessionId"),
    sourceContextId:readField(authority,"sourceContextId"),
    sourceWindowId:readField(authority,"sourceWindowId"),
    workspaceId:readField(authority,"workspaceId"),
    expectedWorkspaceRevision:readField(authority,"workspaceRevision"),
    runtimeAssignmentId:readField(authority,"runtimeAssignmentId"),
    assignmentEpoch:readField(authority,"assignmentEpoch"),
    requestedAt:"",
    entry:readField(input,"entry")
  },{status:"rejected",reason,phase,retrySafe,errors});
}

function hasOwn(value,field) {
  try { return value!==null&&typeof value==="object"&&Object.hasOwn(value,field); }
  catch { return false; }
}

function readField(value,field) {
  try { return value?.[field]; }
  catch { return undefined; }
}

function safeError(error) { return String(error?.message||error||"unknown_error"); }
