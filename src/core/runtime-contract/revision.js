export function normalizeWorkspaceRevision(workspace) {
  const value = Object.hasOwn(workspace || {}, "workspaceRevision") ? workspace.workspaceRevision : 0;
  return Number.isInteger(value) && value >= 0 ? { valid: true, revision: value } : { valid: false, revision: null, errors: ["workspaceRevision must be a non-negative integer"] };
}
export function incrementWorkspaceRevision(workspace) {
  const normalized = normalizeWorkspaceRevision(workspace);
  if (!normalized.valid) return normalized;
  return { valid: true, revision: normalized.revision + 1, workspace: { ...workspace, workspaceRevision: normalized.revision + 1 } };
}
