import { SCHEMAS } from "./constants.js";
import { clone, isPlainObject, nonEmptyString, serializableErrors, validDateTime } from "./value-utils.js";
export function createAssignmentRegistry() { return { schema: SCHEMAS.assignments, nextEpoch: 1, assignments: [] }; }
export function validateAssignmentRegistry(registry) {
  const errors = [];
  if (!isPlainObject(registry)) return { valid: false, errors: ["assignmentRegistry must be a plain object"] };
  errors.push(...serializableErrors(registry, "assignmentRegistry"));
  if (registry.schema !== SCHEMAS.assignments) errors.push("assignmentRegistry schema is invalid");
  if (!Number.isInteger(registry.nextEpoch) || registry.nextEpoch <= 0) errors.push("assignmentRegistry nextEpoch must be positive");
  if (!Array.isArray(registry.assignments)) errors.push("assignmentRegistry assignments must be an array");
  const ids = new Set(), epochs = new Set(), activeWindows = new Set(), activeWorkspaces = new Set();
  let maxEpoch = 0;
  if (Array.isArray(registry.assignments)) registry.assignments.forEach((assignment, index) => {
    const path = `assignmentRegistry.assignments[${index}]`;
    if (!isPlainObject(assignment)) { errors.push(path + " must be a plain object"); return; }
    if (!nonEmptyString(assignment.runtimeAssignmentId)) errors.push(path + ".runtimeAssignmentId is invalid");
    else if (ids.has(assignment.runtimeAssignmentId)) errors.push(path + ".runtimeAssignmentId is duplicate");
    else ids.add(assignment.runtimeAssignmentId);
    if (!nonEmptyString(assignment.workspaceId)) errors.push(path + ".workspaceId is invalid");
    if (!Number.isInteger(assignment.windowId) || assignment.windowId < 0) errors.push(path + ".windowId is invalid");
    if (!Number.isInteger(assignment.assignmentEpoch) || assignment.assignmentEpoch <= 0) errors.push(path + ".assignmentEpoch is invalid");
    else if (epochs.has(assignment.assignmentEpoch)) errors.push(path + ".assignmentEpoch is duplicate");
    else { epochs.add(assignment.assignmentEpoch); maxEpoch = Math.max(maxEpoch, assignment.assignmentEpoch); }
    if (!["active", "released"].includes(assignment.state)) errors.push(path + ".state is invalid");
    for (const field of ["createdAt", "updatedAt", "lastVerifiedAt"]) if (!validDateTime(assignment[field])) errors.push(path + "." + field + " is invalid");
    if (!nonEmptyString(assignment.sourceContextId)) errors.push(path + ".sourceContextId is invalid");
    if (assignment.state === "active") {
      if (activeWindows.has(assignment.windowId)) errors.push(path + ".windowId has another active assignment"); else activeWindows.add(assignment.windowId);
      if (activeWorkspaces.has(assignment.workspaceId)) errors.push(path + ".workspaceId has another active assignment"); else activeWorkspaces.add(assignment.workspaceId);
    }
  });
  if (Number.isInteger(registry.nextEpoch) && registry.nextEpoch <= maxEpoch) errors.push("assignmentRegistry nextEpoch must exceed every issued epoch");
  return { valid: errors.length === 0, errors };
}
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
  return { status: "assigned", registry: next, assignment: clone(assignment), releasedAssignment: clone(stored) };
}
export function replaceRuntimeAssignment(registry, details) {
  const invalid = validateBindingDetails({
    workspaceId: details?.candidateWorkspaceId,
    windowId: details?.windowId,
    sourceContextId: details?.sourceContextId,
    now: details?.now
  });
  if (invalid || !nonEmptyString(details?.expectedWorkspaceId)) {
    return { status: "rejected", reason: invalid || "invalid_expected_workspace_id", registry: clone(registry) };
  }

  const hasExpectedAssignment = details.expectedRuntimeAssignmentId !== null || details.expectedAssignmentEpoch !== null;
  if (hasExpectedAssignment && (
    !nonEmptyString(details.expectedRuntimeAssignmentId) ||
    !Number.isInteger(details.expectedAssignmentEpoch) ||
    details.expectedAssignmentEpoch <= 0 ||
    !Number.isInteger(details.expectedWindowId) ||
    details.expectedWindowId < 0
  )) {
    return { status: "rejected", reason: "invalid_expected_assignment", registry: clone(registry) };
  }

  const candidate = resolveAssignmentByWorkspace(registry, details.candidateWorkspaceId);
  if (candidate) {
    if (candidate.windowId !== details.windowId) {
      return { status: "workspace_conflict", reason: "candidate_active_elsewhere", registry: clone(registry), assignment: candidate };
    }
    let generatedId = "";
    try { generatedId = typeof details.id === "function" ? details.id() : ""; } catch { /* Invalid replay identity is rejected below. */ }
    const releasedPrior = details.expectedRuntimeAssignmentId === null
      ? null
      : registry.assignments.find((item) => item.runtimeAssignmentId === details.expectedRuntimeAssignmentId) || null;
    const candidateIsExactReplay = nonEmptyString(generatedId) &&
      candidate.runtimeAssignmentId === generatedId &&
      candidate.sourceContextId === details.sourceContextId &&
      candidate.createdAt === details.now &&
      candidate.updatedAt === details.now &&
      candidate.lastVerifiedAt === details.now;
    const priorIsExactReplay = details.expectedRuntimeAssignmentId === null
      ? details.expectedAssignmentEpoch === null
      : releasedPrior?.state === "released" &&
        releasedPrior.workspaceId === details.expectedWorkspaceId &&
        releasedPrior.windowId === details.expectedWindowId &&
        releasedPrior.assignmentEpoch === details.expectedAssignmentEpoch &&
        releasedPrior.updatedAt === details.now;
    return candidateIsExactReplay && priorIsExactReplay
      ? { status: "no_change", registry: clone(registry), assignment: candidate, releasedAssignment: clone(releasedPrior) }
      : { status: "assignment_conflict", reason: "candidate_assignment_mismatch", registry: clone(registry), assignment: candidate };
  }

  const prior = resolveAssignmentByWorkspace(registry, details.expectedWorkspaceId);
  const destination = resolveAssignmentByWindow(registry, details.windowId);
  if (!hasExpectedAssignment) {
    if (prior) return { status: "assignment_conflict", reason: "prior_assignment_evidence_required", registry: clone(registry), assignment: prior };
    if (destination) return { status: "assignment_conflict", reason: "target_window_occupied", registry: clone(registry), assignment: destination };
    return bind(registry, {
      workspaceId: details.candidateWorkspaceId,
      windowId: details.windowId,
      sourceContextId: details.sourceContextId,
      now: details.now,
      id: details.id
    });
  }

  if (
    !prior ||
    prior.runtimeAssignmentId !== details.expectedRuntimeAssignmentId ||
    prior.assignmentEpoch !== details.expectedAssignmentEpoch ||
    prior.windowId !== details.expectedWindowId
  ) {
    return { status: "assignment_conflict", reason: "stale_or_missing_prior_assignment", registry: clone(registry) };
  }
  if (destination && destination.runtimeAssignmentId !== prior.runtimeAssignmentId) {
    return { status: "assignment_conflict", reason: "target_window_occupied", registry: clone(registry), assignment: destination || prior };
  }

  const generatedId = typeof details.id === "function" ? details.id() : "";
  if (!nonEmptyString(generatedId)) return { status: "rejected", reason: "invalid_runtime_assignment_id", registry: clone(registry) };
  if (registry.assignments.some((item) => item.runtimeAssignmentId === generatedId)) {
    return { status: "assignment_conflict", reason: "duplicate_runtime_assignment_id", registry: clone(registry) };
  }

  const next = clone(registry);
  const storedPrior = next.assignments.find((item) => item.runtimeAssignmentId === prior.runtimeAssignmentId);
  storedPrior.state = "released";
  storedPrior.updatedAt = details.now;
  const epoch = next.nextEpoch++;
  const assignment = {
    runtimeAssignmentId: generatedId,
    workspaceId: details.candidateWorkspaceId,
    windowId: details.windowId,
    assignmentEpoch: epoch,
    state: "active",
    createdAt: details.now,
    updatedAt: details.now,
    lastVerifiedAt: details.now,
    sourceContextId: details.sourceContextId
  };
  next.assignments.push(assignment);
  return { status: "assigned", registry: next, assignment: clone(assignment), releasedAssignment: clone(storedPrior) };
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
