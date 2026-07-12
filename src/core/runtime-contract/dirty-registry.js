import { SCHEMAS } from "./constants.js";
import { clone, isPlainObject, nonEmptyString, serializableErrors, validDateTime } from "./value-utils.js";
export function createDirtyRegistry() { return { schema: SCHEMAS.dirty, records: [] }; }
const keyOf = (workspaceId, runtimeAssignmentId = "") => workspaceId + "\u0000" + runtimeAssignmentId;
export function markDirty(registry, details) {
  const invalid = validateDirtyDetails(details);
  if (invalid) return { status: "rejected", reason: invalid, registry: clone(registry) };
  const next = clone(registry); const key = keyOf(details.workspaceId, details.runtimeAssignmentId); let record = next.records.find((item) => item.key === key);
  if (record && record.assignmentEpoch !== details.assignmentEpoch) return { status: "assignment_conflict", registry: clone(registry) };
  if (!record) { record = { key, workspaceId: details.workspaceId, runtimeAssignmentId: details.runtimeAssignmentId || "", assignmentEpoch: details.assignmentEpoch || null, status: "pending", triggers: [], firstRequestedAt: details.now, lastRequestedAt: details.now, attemptCount: 0, failureCount: 0, lastFailure: null }; next.records.push(record); }
  if (!record.triggers.includes(details.trigger)) record.triggers.push(details.trigger);
  record.lastRequestedAt = details.now; record.status = "pending"; return { status: "pending", registry: next, record: clone(record) };
}
export function startDirtyAttempt(registry, workspaceId, runtimeAssignmentId = "") { const next = clone(registry); const record = next.records.find((item) => item.key === keyOf(workspaceId, runtimeAssignmentId)); if (!record) return { status: "missing", registry: next }; record.attemptCount += 1; return { status: "started", registry: next }; }
export function failDirtyAttempt(registry, details) { if (!isPlainObject(details?.failure) || serializableErrors(details.failure, "failure").length) return { status: "rejected", reason: "invalid_failure_evidence", registry: clone(registry) }; const next = clone(registry); const record = next.records.find((item) => item.key === keyOf(details.workspaceId, details.runtimeAssignmentId)); if (!record) return { status: "missing", registry: next }; record.status = "pending"; record.failureCount += 1; record.lastFailure = clone(details.failure); return { status: "pending", registry: next }; }
export function completeDirtyTarget(registry, workspaceId, runtimeAssignmentId = "") { const next = clone(registry); const before = next.records.length; next.records = next.records.filter((item) => item.key !== keyOf(workspaceId, runtimeAssignmentId)); return { status: before === next.records.length ? "missing" : "cleared", registry: next }; }
export function listPendingDirty(registry) { return clone(registry.records.filter((record) => record.status === "pending").sort((a, b) => a.key.localeCompare(b.key))); }
function validateDirtyDetails(details) {
  if (!nonEmptyString(details?.workspaceId)) return "invalid_workspace_id";
  if (!nonEmptyString(details?.trigger)) return "invalid_trigger";
  if (!validDateTime(details?.now)) return "invalid_timestamp";
  const assigned = nonEmptyString(details?.runtimeAssignmentId);
  if (!assigned && details?.assignmentEpoch != null) return "unassigned_target_must_not_have_epoch";
  if (assigned && (!Number.isInteger(details?.assignmentEpoch) || details.assignmentEpoch <= 0)) return "assigned_target_requires_positive_epoch";
  return null;
}
