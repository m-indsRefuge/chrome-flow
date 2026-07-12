import { SCHEMAS } from "./constants.js";
import { clone, nonEmptyString, validDateTime } from "./value-utils.js";
export function createAssignmentRegistry() { return { schema: SCHEMAS.assignments, nextEpoch: 1, assignments: [] }; }
export function resolveAssignmentByWindow(registry, windowId) { return clone(registry.assignments.find((a) => a.state === "active" && a.windowId === windowId) || null); }
export function resolveAssignmentByWorkspace(registry, workspaceId) { return clone(registry.assignments.find((a) => a.state === "active" && a.workspaceId === workspaceId) || null); }
function bind(registry, details) {
  const generatedId = typeof details.id === "function" ? details.id() : "";
  if (!nonEmptyString(generatedId)) return { status: "rejected", reason: "invalid_runtime_assignment_id", registry: clone(registry) };
  if (registry.assignments.some((item) => item.runtimeAssignmentId === generatedId)) return { status: "assignment_conflict", reason: "duplicate_runtime_assignment_id", registry: clone(registry) };
  const next = clone(registry); const now = details.now; const epoch = next.nextEpoch++;
  const assignment = { runtimeAssignmentId: generatedId, workspaceId: details.workspaceId, windowId: details.windowId, assignmentEpoch: epoch, state: "active", createdAt: now, updatedAt: now, lastVerifiedAt: now, sourceContextId: details.sourceContextId };
  next.assignments.push(assignment); return { status: "assigned", registry: next, assignment: clone(assignment) };
}
export function assignRuntime(registry, details) {
  const invalid = validateBindingDetails(details);
  if (invalid) return { status: "rejected", reason: invalid, registry: clone(registry) };
  const workspace = resolveAssignmentByWorkspace(registry, details.workspaceId); const destination = resolveAssignmentByWindow(registry, details.windowId);
  if (workspace && destination && workspace.runtimeAssignmentId === destination.runtimeAssignmentId) return { status: "no_change", registry: clone(registry), assignment: workspace };
  if (workspace) return { status: "workspace_conflict", registry: clone(registry), assignment: workspace };
  if (destination) return { status: "assignment_conflict", registry: clone(registry), assignment: destination };
  return bind(registry, details);
}
export function transferRuntime(registry, details) {
  const invalid = validateBindingDetails(details);
  if (invalid) return { status: "rejected", reason: invalid, registry: clone(registry) };
  if (!nonEmptyString(details.expectedRuntimeAssignmentId) || !Number.isInteger(details.expectedAssignmentEpoch) || details.expectedAssignmentEpoch <= 0) return { status: "rejected", reason: "invalid_expected_assignment", registry: clone(registry) };
  const current = resolveAssignmentByWorkspace(registry, details.workspaceId);
  if (!current || current.runtimeAssignmentId !== details.expectedRuntimeAssignmentId || current.assignmentEpoch !== details.expectedAssignmentEpoch) return { status: "assignment_conflict", registry: clone(registry) };
  const occupied = resolveAssignmentByWindow(registry, details.windowId);
  if (occupied && occupied.workspaceId !== details.workspaceId) return { status: "assignment_conflict", registry: clone(registry), assignment: occupied };
  const generatedId = typeof details.id === "function" ? details.id() : "";
  if (!nonEmptyString(generatedId)) return { status: "rejected", reason: "invalid_runtime_assignment_id", registry: clone(registry) };
  if (registry.assignments.some((item) => item.runtimeAssignmentId === generatedId)) return { status: "assignment_conflict", reason: "duplicate_runtime_assignment_id", registry: clone(registry) };
  const next = clone(registry); const stored = next.assignments.find((a) => a.runtimeAssignmentId === current.runtimeAssignmentId); stored.state = "released"; stored.updatedAt = details.now;
  const epoch = next.nextEpoch++;
  const assignment = { runtimeAssignmentId: generatedId, workspaceId: details.workspaceId, windowId: details.windowId, assignmentEpoch: epoch, state: "active", createdAt: details.now, updatedAt: details.now, lastVerifiedAt: details.now, sourceContextId: details.sourceContextId };
  next.assignments.push(assignment);
  return { status: "assigned", registry: next, assignment: clone(assignment) };
}
export function releaseRuntime(registry, details) {
  if (!nonEmptyString(details?.runtimeAssignmentId) || !Number.isInteger(details?.assignmentEpoch) || details.assignmentEpoch <= 0 || !validDateTime(details?.now)) return { status: "rejected", reason: "invalid_release_details", registry: clone(registry) };
  const next = clone(registry); const current = next.assignments.find((a) => a.state === "active" && a.runtimeAssignmentId === details.runtimeAssignmentId);
  if (!current || current.assignmentEpoch !== details.assignmentEpoch) return { status: "assignment_conflict", registry: clone(registry) };
  current.state = "released"; current.updatedAt = details.now; return { status: "released", registry: next, assignment: clone(current) };
}
export function validateEnvelopeAssignment(registry, envelope) {
  const assignment = resolveAssignmentByWorkspace(registry, envelope.workspaceId);
  if (!nonEmptyString(envelope.runtimeAssignmentId)) return assignment ? { valid: false, reason: "active_assignment_requires_identity" } : { valid: true };
  return assignment && assignment.runtimeAssignmentId === envelope.runtimeAssignmentId && assignment.assignmentEpoch === envelope.assignmentEpoch ? { valid: true, assignment } : { valid: false, reason: "stale_or_missing_assignment" };
}
function validateBindingDetails(details) {
  if (!nonEmptyString(details?.workspaceId)) return "invalid_workspace_id";
  if (!Number.isInteger(details?.windowId)) return "invalid_window_id";
  if (!nonEmptyString(details?.sourceContextId)) return "invalid_source_context_id";
  if (!validDateTime(details?.now)) return "invalid_timestamp";
  return null;
}
