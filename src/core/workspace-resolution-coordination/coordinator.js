import {
  WORKSPACE_EVIDENCE_KINDS,
  WORKSPACE_RESOLUTION_REQUEST_SCHEMA,
  resolveWorkspaceEvidence
} from "../workspace-resolution/resolver.js";
import { isPlainObject, nonEmptyString, serializableErrors, stableStringify } from "../runtime-contract/value-utils.js";
import {
  COLLECTION_STATUSES,
  COORDINATION_DECISIONS,
  COORDINATION_STATUSES,
  EVIDENCE_SOURCES,
  WORKSPACE_RESOLUTION_COORDINATION_RESULT_SCHEMA,
  createEmptyCollection,
  normalizeRequestIdentities,
  validateCollectionResult,
  validateCoordinationRequest
} from "./contract.js";

const SOURCE_PLAN = Object.freeze([
  [EVIDENCE_SOURCES.runtimeAssignment, "readRuntimeAssignmentEvidence"],
  [EVIDENCE_SOURCES.exactWindowBinding, "readExactWindowBindingEvidence"],
  [EVIDENCE_SOURCES.compatibilityWorkspace, "readCompatibilityWorkspaceEvidence"]
]);

export async function coordinateWorkspaceResolution(request, adapters) {
  const identities = normalizeRequestIdentities(request);
  const requestErrors = validateCoordinationRequest(request);
  if (requestErrors.length) return outcome(COORDINATION_STATUSES.invalid, "invalid_coordination_request", COORDINATION_DECISIONS.rejectRequest, identities, { errors: requestErrors });
  const trustedRequest = { operationId: identities.operationId, contextId: identities.contextId, windowId: identities.windowId };

  let collectorPlan;
  try {
    if (!isPlainObject(adapters)) return collectionFailure(identities, failedCollectionSet("collector_adapters_invalid"), "collector_adapters_invalid");
    collectorPlan = SOURCE_PLAN.map(([source, name]) => [source, adapters[name]]);
  } catch { return collectionFailure(identities, failedCollectionSet("collector_adapter_access_failed"), "collector_adapter_access_failed"); }

  const settled = await Promise.all(collectorPlan.map(([source, adapter]) => collect(source, adapter, trustedRequest)));
  const collection = settled.map((item) => item.result);
  const collectionError = settled.find((item) => item.error);
  if (collectionError) return collectionFailure(identities, collection, collectionError.error);

  const assembled = assembleEvidence(trustedRequest, collection);
  if (assembled.error) return collectionFailure(identities, collection, assembled.error);

  const resolution = resolveWorkspaceEvidence({
    schema: WORKSPACE_RESOLUTION_REQUEST_SCHEMA,
    contextId: trustedRequest.contextId,
    windowId: trustedRequest.windowId,
    expectedAssignmentEpoch: assembled.expectedAssignmentEpoch,
    evidence: assembled.evidence
  });
  if (resolution.status === "invalid") return outcome(COORDINATION_STATUSES.invalid, "invalid_assembled_resolution_request", COORDINATION_DECISIONS.rejectRequest, identities, { collection, resolution, expectedAssignmentEpoch: assembled.expectedAssignmentEpoch, errors: ["resolver_rejected_assembled_evidence"] });
  if (resolution.status === "resolved") return outcome(COORDINATION_STATUSES.resolved, resolution.reason, COORDINATION_DECISIONS.useResolvedWorkspace, identities, { collection, resolution, expectedAssignmentEpoch: assembled.expectedAssignmentEpoch, resolvedWorkspaceId: resolution.resolvedWorkspaceId });
  if (resolution.status === "unresolved") return outcome(COORDINATION_STATUSES.creationRequired, resolution.reason, COORDINATION_DECISIONS.createWorkspaceAndAssign, identities, { collection, resolution, expectedAssignmentEpoch: assembled.expectedAssignmentEpoch });
  if (resolution.status === "ambiguous") return outcome(COORDINATION_STATUSES.ambiguous, resolution.reason, COORDINATION_DECISIONS.manualResolutionRequired, identities, { collection, resolution, expectedAssignmentEpoch: assembled.expectedAssignmentEpoch });
  return outcome(COORDINATION_STATUSES.invalid, "unexpected_resolution_status", COORDINATION_DECISIONS.rejectRequest, identities, { collection, resolution, expectedAssignmentEpoch: assembled.expectedAssignmentEpoch, errors: ["unexpected_resolution_status"] });
}

async function collect(source, adapter, request) {
  if (typeof adapter !== "function") return { result: failedCollection(source, "collector_adapter_missing"), error: "collector_adapter_missing" };
  try {
    const value = await adapter({ operationId: request.operationId, contextId: request.contextId, windowId: request.windowId });
    const validationError = validateCollectionResult(value, source);
    if (validationError) return { result: failedCollection(source, validationError), error: validationError };
    const copy = clone(value);
    if (copy.status === COLLECTION_STATUSES.failed) return { result: copy, error: "collector_reported_failure" };
    return { result: copy, error: null };
  } catch { return { result: failedCollection(source, "collector_output_processing_failed"), error: "collector_output_processing_failed" }; }
}

function assembleEvidence(request, collection) {
  const evidence = [];
  let expectedAssignmentEpoch = null;
  let runtimeSessionId = null;
  let authorityRevision = null;
  for (const result of collection) {
    if (result.status === COLLECTION_STATUSES.absent) continue;
    for (const item of result.evidence) {
      const validationError = validateSourceEvidence(result.source, item, request);
      if (validationError) return { error: validationError, evidence: [], expectedAssignmentEpoch: null };
      if (result.source === EVIDENCE_SOURCES.runtimeAssignment) {
        if (expectedAssignmentEpoch === null) expectedAssignmentEpoch = item.assignmentEpoch;
        else if (expectedAssignmentEpoch !== item.assignmentEpoch) return { error: "runtime_assignment_epochs_conflict", evidence: [], expectedAssignmentEpoch: null };
        if (runtimeSessionId === null) runtimeSessionId = item.runtimeSessionId;
        else if (runtimeSessionId !== item.runtimeSessionId) return { error: "runtime_assignment_sessions_conflict", evidence: [], expectedAssignmentEpoch: null };
        if (authorityRevision === null) authorityRevision = item.authorityRevision;
        else if (authorityRevision !== item.authorityRevision) return { error: "runtime_assignment_revisions_conflict", evidence: [], expectedAssignmentEpoch: null };
        evidence.push(canonical(WORKSPACE_EVIDENCE_KINDS.verifiedRuntimeAssignment, item.workspaceId, item.windowId, item.assignmentEpoch, item.contextId, item.runtimeAssignmentId, true));
      } else if (result.source === EVIDENCE_SOURCES.exactWindowBinding) {
        evidence.push(canonical(WORKSPACE_EVIDENCE_KINDS.exactWindowBinding, item.workspaceId, item.windowId, null, item.contextId, "", true));
      } else evidence.push(canonical(WORKSPACE_EVIDENCE_KINDS.compatibilityReference, item.workspaceId, null, null, "", "", false));
    }
  }
  return { error: null, evidence, expectedAssignmentEpoch };
}

function validateSourceEvidence(source, value, request) {
  if (!isPlainObject(value) || serializableErrors(value, "evidence").length) return "malformed_collected_evidence";
  if (source === EVIDENCE_SOURCES.runtimeAssignment) {
    if (!exact(value, ["workspaceId", "windowId", "assignmentEpoch", "runtimeAssignmentId", "authorityRevision", "runtimeSessionId", "authorityVerified", "contextId"])) return "malformed_runtime_assignment_evidence";
    if (value.authorityVerified !== true) return "runtime_assignment_unverified";
    if (value.contextId !== request.contextId) return "runtime_assignment_context_mismatch";
    if (value.windowId !== request.windowId) return "runtime_assignment_window_mismatch";
    if (!Number.isInteger(value.assignmentEpoch) || value.assignmentEpoch <= 0) return "runtime_assignment_epoch_invalid";
    if (!nonEmptyString(value.runtimeAssignmentId) || !nonEmptyString(value.workspaceId) || !nonEmptyString(value.runtimeSessionId) || !Number.isInteger(value.authorityRevision) || value.authorityRevision < 0) return "runtime_assignment_authority_identity_invalid";
    return null;
  }
  if (source === EVIDENCE_SOURCES.exactWindowBinding) {
    if (!exact(value, ["workspaceId", "windowId", "contextId", "verified"])) return "malformed_exact_window_binding_evidence";
    if (value.verified !== true || value.contextId !== request.contextId || value.windowId !== request.windowId || !nonEmptyString(value.workspaceId)) return "exact_window_binding_invalid";
    return null;
  }
  if (!exact(value, ["workspaceId"]) || !nonEmptyString(value.workspaceId)) return "compatibility_evidence_invalid";
  return null;
}

function canonical(kind, workspaceId, windowId, assignmentEpoch, contextId, runtimeAssignmentId, verified) { return { kind, workspaceId, windowId, assignmentEpoch, contextId, runtimeAssignmentId, verified }; }
function exact(value, fields) { return stableStringify(Object.keys(value).sort(compareStrings)) === stableStringify([...fields].sort(compareStrings)); }
function compareStrings(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function clone(value) { return structuredClone(value); }
function failedCollection(source, error) { return { source, status: COLLECTION_STATUSES.failed, evidence: [], error }; }
function failedCollectionSet(error) { return Object.values(EVIDENCE_SOURCES).map((source) => failedCollection(source, error)); }
function collectionFailure(identities, collection, error) { return outcome(COORDINATION_STATUSES.failed, "evidence_collection_failed", COORDINATION_DECISIONS.retryCollection, identities, { collection, retrySafe: true, errors: [error] }); }

function outcome(status, reason, decision, identities, fields = {}) {
  return {
    schema: WORKSPACE_RESOLUTION_COORDINATION_RESULT_SCHEMA,
    status,
    reason,
    decision,
    operationId: identities.operationId,
    contextId: identities.contextId,
    windowId: identities.windowId,
    resolvedWorkspaceId: fields.resolvedWorkspaceId || null,
    expectedAssignmentEpoch: Number.isInteger(fields.expectedAssignmentEpoch) ? fields.expectedAssignmentEpoch : null,
    collection: fields.collection || createEmptyCollection(),
    resolution: fields.resolution || null,
    retrySafe: fields.retrySafe === true,
    warnings: fields.warnings || [],
    errors: fields.errors || []
  };
}
