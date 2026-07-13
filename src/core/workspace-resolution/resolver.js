import { isPlainObject, nonEmptyString, serializableErrors, stableStringify } from "../runtime-contract/value-utils.js";

export const WORKSPACE_RESOLUTION_REQUEST_SCHEMA = "constellation-workspace-resolution-request-v0.1";
export const WORKSPACE_RESOLUTION_RESULT_SCHEMA = "constellation-workspace-resolution-result-v0.1";

export const WORKSPACE_EVIDENCE_KINDS = Object.freeze({
  verifiedRuntimeAssignment: "verified_runtime_assignment",
  exactWindowBinding: "exact_workspace_window_binding",
  compatibilityReference: "compatibility_global_workspace_reference"
});

export const WORKSPACE_RESOLUTION_STATUSES = Object.freeze({ resolved: "resolved", unresolved: "unresolved", ambiguous: "ambiguous", invalid: "invalid" });
export const WORKSPACE_RESOLUTION_REASONS = Object.freeze({
  resolved: "authoritative_evidence_resolved",
  ambiguous: "highest_authority_conflict",
  contradictoryAssignmentIdentity: "contradictory_runtime_assignment_identity",
  compatibilityOnly: "compatibility_evidence_non_authoritative",
  noEligibleEvidence: "no_eligible_workspace_evidence",
  invalidRequest: "invalid_resolution_request"
});
export const WORKSPACE_EVIDENCE_REJECTION_REASONS = Object.freeze({
  malformed: "malformed_evidence",
  unsupportedKind: "unsupported_evidence_kind",
  invalidWorkspaceId: "invalid_workspace_id",
  unverified: "evidence_not_verified",
  wrongWindow: "window_identity_mismatch",
  wrongEpoch: "assignment_epoch_mismatch",
  missingExpectedEpoch: "runtime_assignment_requires_expected_epoch",
  wrongContext: "context_identity_mismatch",
  invalidAssignmentId: "invalid_runtime_assignment_id",
  forbiddenAssignmentId: "runtime_assignment_id_forbidden",
  forbiddenAssignmentEpoch: "assignment_epoch_forbidden",
  noncanonicalCompatibility: "noncanonical_compatibility_evidence"
});

const REQUEST_FIELDS = Object.freeze(["schema", "contextId", "windowId", "expectedAssignmentEpoch", "evidence"]);
const EVIDENCE_FIELDS = Object.freeze(["kind", "workspaceId", "windowId", "assignmentEpoch", "contextId", "runtimeAssignmentId", "verified"]);
const AUTHORITY_LEVELS = Object.freeze({
  [WORKSPACE_EVIDENCE_KINDS.verifiedRuntimeAssignment]: 2,
  [WORKSPACE_EVIDENCE_KINDS.exactWindowBinding]: 1,
  [WORKSPACE_EVIDENCE_KINDS.compatibilityReference]: 0
});

/** Purely resolves already-collected evidence. It performs no collection, assignment, or persistence. */
export function resolveWorkspaceEvidence(request) {
  const requestErrors = validateRequest(request);
  if (requestErrors.length) return result(WORKSPACE_RESOLUTION_STATUSES.invalid, WORKSPACE_RESOLUTION_REASONS.invalidRequest, { requestErrors });

  const acceptedByFingerprint = new Map();
  const rejectedByFingerprint = new Map();
  for (const supplied of request.evidence) {
    const normalized = normalizeEvidence(supplied);
    const rejectionReasons = validateEvidence(supplied, normalized, request);
    const fingerprint = stableStringify(normalized);
    if (rejectionReasons.length) {
      const rejected = { evidence: normalized, rejectionReasons: uniqueSorted(rejectionReasons) };
      rejectedByFingerprint.set(stableStringify(rejected), rejected);
      continue;
    }
    const authorityLevel = AUTHORITY_LEVELS[normalized.kind];
    acceptedByFingerprint.set(fingerprint, { ...normalized, authorityLevel, eligible: authorityLevel > 0 });
  }

  const acceptedEvidence = [...acceptedByFingerprint.values()].sort(compareEvidence);
  const rejectedEvidence = [...rejectedByFingerprint.values()].sort((left, right) => compareStrings(stableStringify(left), stableStringify(right)));
  const eligible = acceptedEvidence.filter((item) => item.eligible);
  const eligibleCandidateWorkspaceIds = uniqueSorted(eligible.map((item) => item.workspaceId));
  if (!eligible.length) {
    const compatibilityOnly = acceptedEvidence.some((item) => item.kind === WORKSPACE_EVIDENCE_KINDS.compatibilityReference);
    return result(WORKSPACE_RESOLUTION_STATUSES.unresolved, compatibilityOnly ? WORKSPACE_RESOLUTION_REASONS.compatibilityOnly : WORKSPACE_RESOLUTION_REASONS.noEligibleEvidence, { acceptedEvidence, rejectedEvidence, eligibleCandidateWorkspaceIds });
  }

  const authorityLevel = Math.max(...eligible.map((item) => item.authorityLevel));
  const decisiveEvidence = eligible.filter((item) => item.authorityLevel === authorityLevel).sort(compareEvidence);
  const authorityKind = decisiveEvidence[0].kind;
  const workspaceIds = uniqueSorted(decisiveEvidence.map((item) => item.workspaceId));
  const runtimeAssignmentIds = authorityKind === WORKSPACE_EVIDENCE_KINDS.verifiedRuntimeAssignment ? uniqueSorted(decisiveEvidence.map((item) => item.runtimeAssignmentId)) : [];
  const ambiguity = { authorityKind, authorityLevel, workspaceIds, runtimeAssignmentIds };
  if (workspaceIds.length > 1) return result(WORKSPACE_RESOLUTION_STATUSES.ambiguous, WORKSPACE_RESOLUTION_REASONS.ambiguous, { acceptedEvidence, rejectedEvidence, eligibleCandidateWorkspaceIds, authorityKind, authorityLevel, decisiveEvidence, ambiguity });
  if (runtimeAssignmentIds.length > 1) return result(WORKSPACE_RESOLUTION_STATUSES.ambiguous, WORKSPACE_RESOLUTION_REASONS.contradictoryAssignmentIdentity, { acceptedEvidence, rejectedEvidence, eligibleCandidateWorkspaceIds, authorityKind, authorityLevel, decisiveEvidence, ambiguity });
  return result(WORKSPACE_RESOLUTION_STATUSES.resolved, WORKSPACE_RESOLUTION_REASONS.resolved, { resolvedWorkspaceId: workspaceIds[0], acceptedEvidence, rejectedEvidence, eligibleCandidateWorkspaceIds, authorityKind, authorityLevel, decisiveEvidence });
}

function validateRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return ["request_must_be_plain_object"];
  if (stableStringify(Object.keys(request).sort(compareStrings)) !== stableStringify([...REQUEST_FIELDS].sort(compareStrings))) errors.push("request_fields_must_match_exact_contract");
  if (request.schema !== WORKSPACE_RESOLUTION_REQUEST_SCHEMA) errors.push("request_schema_invalid");
  if (!nonEmptyString(request.contextId)) errors.push("context_id_invalid");
  if (!Number.isInteger(request.windowId) || request.windowId < 0) errors.push("window_id_invalid");
  if (request.expectedAssignmentEpoch !== null && (!Number.isInteger(request.expectedAssignmentEpoch) || request.expectedAssignmentEpoch <= 0)) errors.push("expected_assignment_epoch_invalid");
  if (!Array.isArray(request.evidence)) errors.push("evidence_collection_invalid");
  return uniqueSorted(errors);
}

function normalizeEvidence(value) {
  return {
    kind: typeof value?.kind === "string" ? value.kind : "",
    workspaceId: typeof value?.workspaceId === "string" ? value.workspaceId : "",
    windowId: Number.isInteger(value?.windowId) ? value.windowId : null,
    assignmentEpoch: Number.isInteger(value?.assignmentEpoch) ? value.assignmentEpoch : null,
    contextId: typeof value?.contextId === "string" ? value.contextId : "",
    runtimeAssignmentId: typeof value?.runtimeAssignmentId === "string" ? value.runtimeAssignmentId : "",
    verified: value?.verified === true
  };
}

function validateEvidence(value, normalized, request) {
  const reasons = [];
  if (!isPlainObject(value) || serializableErrors(value, "evidence").length || stableStringify(Object.keys(value || {}).sort(compareStrings)) !== stableStringify([...EVIDENCE_FIELDS].sort(compareStrings)) || !hasValidRawEvidenceFieldTypes(value)) reasons.push(WORKSPACE_EVIDENCE_REJECTION_REASONS.malformed);
  if (!Object.hasOwn(AUTHORITY_LEVELS, normalized.kind)) return uniqueSorted([...reasons, WORKSPACE_EVIDENCE_REJECTION_REASONS.unsupportedKind]);
  if (!nonEmptyString(normalized.workspaceId)) reasons.push(WORKSPACE_EVIDENCE_REJECTION_REASONS.invalidWorkspaceId);
  if (normalized.kind === WORKSPACE_EVIDENCE_KINDS.compatibilityReference) {
    if (normalized.windowId !== null || normalized.assignmentEpoch !== null || normalized.contextId !== "" || normalized.runtimeAssignmentId !== "" || normalized.verified !== false) reasons.push(WORKSPACE_EVIDENCE_REJECTION_REASONS.noncanonicalCompatibility);
    return uniqueSorted(reasons);
  }
  if (!normalized.verified) reasons.push(WORKSPACE_EVIDENCE_REJECTION_REASONS.unverified);
  if (normalized.windowId !== request.windowId) reasons.push(WORKSPACE_EVIDENCE_REJECTION_REASONS.wrongWindow);
  // contextId is the current context under which this evidence was verified, not necessarily an assignment's original sourceContextId.
  if (normalized.contextId !== request.contextId) reasons.push(WORKSPACE_EVIDENCE_REJECTION_REASONS.wrongContext);
  if (normalized.kind === WORKSPACE_EVIDENCE_KINDS.exactWindowBinding) {
    if (normalized.assignmentEpoch !== null) reasons.push(WORKSPACE_EVIDENCE_REJECTION_REASONS.forbiddenAssignmentEpoch);
    if (normalized.runtimeAssignmentId !== "") reasons.push(WORKSPACE_EVIDENCE_REJECTION_REASONS.forbiddenAssignmentId);
    return uniqueSorted(reasons);
  }
  if (request.expectedAssignmentEpoch === null) reasons.push(WORKSPACE_EVIDENCE_REJECTION_REASONS.missingExpectedEpoch);
  else if (normalized.assignmentEpoch !== request.expectedAssignmentEpoch) reasons.push(WORKSPACE_EVIDENCE_REJECTION_REASONS.wrongEpoch);
  if (!nonEmptyString(normalized.runtimeAssignmentId)) reasons.push(WORKSPACE_EVIDENCE_REJECTION_REASONS.invalidAssignmentId);
  return uniqueSorted(reasons);
}

function hasValidRawEvidenceFieldTypes(value) {
  return typeof value?.kind === "string"
    && typeof value?.workspaceId === "string"
    && (value.windowId === null || Number.isInteger(value.windowId))
    && (value.assignmentEpoch === null || Number.isInteger(value.assignmentEpoch))
    && typeof value?.contextId === "string"
    && typeof value?.runtimeAssignmentId === "string"
    && typeof value?.verified === "boolean";
}

function compareStrings(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function uniqueSorted(values) { return [...new Set(values)].sort(compareStrings); }
function compareEvidence(left, right) { return right.authorityLevel - left.authorityLevel || compareStrings(left.workspaceId, right.workspaceId) || compareStrings(stableStringify(left), stableStringify(right)); }

function result(status, reason, fields = {}) {
  return {
    schema: WORKSPACE_RESOLUTION_RESULT_SCHEMA,
    status,
    reason,
    resolvedWorkspaceId: fields.resolvedWorkspaceId || null,
    authorityKind: fields.authorityKind || null,
    authorityLevel: Number.isInteger(fields.authorityLevel) ? fields.authorityLevel : null,
    decisiveEvidence: fields.decisiveEvidence || [],
    eligibleCandidateWorkspaceIds: fields.eligibleCandidateWorkspaceIds || [],
    acceptedEvidence: fields.acceptedEvidence || [],
    rejectedEvidence: fields.rejectedEvidence || [],
    ambiguity: fields.ambiguity || { authorityKind: null, authorityLevel: null, workspaceIds: [], runtimeAssignmentIds: [] },
    requestErrors: fields.requestErrors || []
  };
}
