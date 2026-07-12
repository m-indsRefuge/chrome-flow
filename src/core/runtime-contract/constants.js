export const SCHEMAS = Object.freeze({
  context: "constellation-runtime-context-v0.1",
  assignments: "constellation-runtime-assignment-registry-v0.1",
  ledger: "constellation-runtime-operation-ledger-v0.1",
  dirty: "constellation-runtime-dirty-registry-v0.1",
  mutation: "constellation-runtime-mutation-v0.1",
  result: "constellation-runtime-mutation-result-v0.1"
});
export const LOCK_NAMES = Object.freeze({
  runtimeState: "constellation-runtime-state-v0.1",
  exclusiveOperation: "constellation-runtime-exclusive-operation-v0.1"
});
export const LOCK_ORDER = Object.freeze([LOCK_NAMES.exclusiveOperation, LOCK_NAMES.runtimeState]);
export const CONTEXT_TYPES = Object.freeze(["side_panel", "service_worker", "migration_page", "developer_validation"]);
export const RESULT_STATUSES = Object.freeze(["committed", "no_change", "replayed", "revision_conflict", "assignment_conflict", "workspace_conflict", "operation_id_conflict", "rejected", "failed"]);
export const MUTATION_TYPES = Object.freeze(["journal.append", "timeline.append", "workspace.metadata.patch", "workspace.tab.add", "workspace.tab.remove", "workspace.tab.metadata.patch", "workspace.tab.projection.patch"]);
