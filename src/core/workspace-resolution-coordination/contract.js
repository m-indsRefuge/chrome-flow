import { isPlainObject, nonEmptyString, serializableErrors, stableStringify } from "../runtime-contract/value-utils.js";

export const WORKSPACE_RESOLUTION_COORDINATION_REQUEST_SCHEMA = "constellation-workspace-resolution-coordination-request-v0.1";
export const WORKSPACE_RESOLUTION_COORDINATION_RESULT_SCHEMA = "constellation-workspace-resolution-coordination-result-v0.1";

export const EVIDENCE_SOURCES = Object.freeze({
  runtimeAssignment: "runtime_assignment",
  exactWindowBinding: "exact_window_binding",
  compatibilityWorkspace: "compatibility_workspace"
});

export const COLLECTION_STATUSES = Object.freeze({ present: "present", absent: "absent", failed: "failed" });
export const COORDINATION_STATUSES = Object.freeze({ resolved: "resolved", creationRequired: "creation_required", ambiguous: "ambiguous", invalid: "invalid", failed: "failed" });
export const COORDINATION_DECISIONS = Object.freeze({
  useResolvedWorkspace: "use_resolved_workspace",
  createWorkspaceAndAssign: "create_workspace_and_assign",
  manualResolutionRequired: "manual_resolution_required",
  rejectRequest: "reject_request",
  retryCollection: "retry_collection"
});

const REQUEST_FIELDS = Object.freeze(["schema", "operationId", "contextId", "windowId"]);
const COLLECTION_FIELDS = Object.freeze(["source", "status", "evidence", "error"]);

export function validateCoordinationRequest(request) {
  try {
    const errors = [];
    if (!isPlainObject(request)) return ["request_must_be_plain_object"];
    if (!exactFields(request, REQUEST_FIELDS)) errors.push("request_fields_must_match_exact_contract");
    if (request.schema !== WORKSPACE_RESOLUTION_COORDINATION_REQUEST_SCHEMA) errors.push("request_schema_invalid");
    if (!nonEmptyString(request.operationId)) errors.push("operation_id_invalid");
    if (!nonEmptyString(request.contextId)) errors.push("context_id_invalid");
    if (!Number.isInteger(request.windowId) || request.windowId < 0) errors.push("window_id_invalid");
    errors.push(...serializableErrors(request, "request"));
    return uniqueSorted(errors);
  } catch { return ["request_validation_failed"]; }
}

export function validateCollectionResult(value, source) {
  try {
    if (!isPlainObject(value) || !exactFields(value, COLLECTION_FIELDS) || serializableErrors(value, "collection").length) return "malformed_collection_result";
    if (value.source !== source) return "collection_source_mismatch";
    if (!Object.values(COLLECTION_STATUSES).includes(value.status)) return "collection_status_invalid";
    if (!Array.isArray(value.evidence) || typeof value.error !== "string") return "malformed_collection_result";
    if (value.status === COLLECTION_STATUSES.present && (!value.evidence.length || value.error !== "")) return "malformed_collection_result";
    if (value.status === COLLECTION_STATUSES.absent && (value.evidence.length || value.error !== "")) return "malformed_collection_result";
    if (value.status === COLLECTION_STATUSES.failed && (value.evidence.length || !nonEmptyString(value.error))) return "malformed_collection_result";
    return null;
  } catch { return "malformed_collection_result"; }
}

export function normalizeRequestIdentities(request) {
  return {
    operationId: safeStringProperty(request, "operationId"),
    contextId: safeStringProperty(request, "contextId"),
    windowId: safeWindowIdProperty(request, "windowId")
  };
}

export function createEmptyCollection() {
  return [
    { source: EVIDENCE_SOURCES.runtimeAssignment, status: COLLECTION_STATUSES.absent, evidence: [], error: "" },
    { source: EVIDENCE_SOURCES.exactWindowBinding, status: COLLECTION_STATUSES.absent, evidence: [], error: "" },
    { source: EVIDENCE_SOURCES.compatibilityWorkspace, status: COLLECTION_STATUSES.absent, evidence: [], error: "" }
  ];
}

function exactFields(value, fields) { return stableStringify(Object.keys(value).sort(compareStrings)) === stableStringify([...fields].sort(compareStrings)); }
function safeStringProperty(value, key) { try { const candidate = value?.[key]; return typeof candidate === "string" ? candidate : ""; } catch { return ""; } }
function safeWindowIdProperty(value, key) { try { const candidate = value?.[key]; return Number.isInteger(candidate) && candidate >= 0 ? candidate : null; } catch { return null; } }
function compareStrings(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function uniqueSorted(values) { return [...new Set(values)].sort(compareStrings); }
