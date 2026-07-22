import { clone, isPlainObject, nonEmptyString, serializableErrors, stableStringify } from "../runtime-contract/value-utils.js";
import { isValidRuntimeWorkspaceId } from "../runtime-workspace-record/contract.js";
import {
  WORKSPACE_OPERATION_LEDGER_KEY_PREFIX,
  deriveWorkspaceOperationLedgerKey,
  snapshotAndValidateWorkspaceOperationLedger
} from "./contract.js";

export function discoverWorkspaceRecoveryEvidence(storageValues) {
  const malformedEvidence = [];
  const ledgers = [];
  let snapshot;
  try {
    if (!isPlainObject(storageValues)) return result("malformed_recovery_evidence", [], [], [], [{ key: "", reason: "storage_snapshot_not_plain" }]);
    const serialization = serializableErrors(storageValues, "storageValues");
    if (serialization.length) return result("malformed_recovery_evidence", [], [], [], serialization.map((reason) => ({ key: "", reason })));
    snapshot = clone(storageValues);
  } catch (error) {
    return result("malformed_recovery_evidence", [], [], [], [{ key: "", reason: String(error?.message || error) }]);
  }

  for (const key of Object.keys(snapshot).sort(compareCodeUnits)) {
    if (!key.startsWith(WORKSPACE_OPERATION_LEDGER_KEY_PREFIX)) continue;
    const suffix = key.slice(WORKSPACE_OPERATION_LEDGER_KEY_PREFIX.length);
    if (!isValidRuntimeWorkspaceId(suffix) || deriveWorkspaceOperationLedgerKey(suffix) !== key) {
      malformedEvidence.push({ key, reason: "malformed_ledger_key" });
      continue;
    }
    const validation = snapshotAndValidateWorkspaceOperationLedger(snapshot[key], { key, workspaceId: suffix });
    if (!validation.valid) {
      malformedEvidence.push({ key, reason: "malformed_ledger", errors: [...validation.errors] });
      continue;
    }
    ledgers.push({ key, workspaceId: suffix, ledger: validation.ledger });
  }

  const unresolvedOperations = [];
  for (const item of ledgers) for (const entry of item.ledger.entries) if (entry.state !== "terminal") {
    unresolvedOperations.push({ ledgerKey: item.key, ledgerWorkspaceId: item.workspaceId, entry: clone(entry) });
  }
  unresolvedOperations.sort(compareOperations);
  const relevanceIndex = buildRelevanceIndex(unresolvedOperations);
  return result(malformedEvidence.length ? "malformed_recovery_evidence" : "discovered", ledgers, unresolvedOperations, relevanceIndex, malformedEvidence);
}

export function classifyRecoveryOverlap(discovery, workspaceIds = []) {
  if (!isPlainObject(discovery) || !Array.isArray(discovery.unresolvedOperations) || !Array.isArray(discovery.malformedEvidence)) {
    return classification("malformed_recovery_evidence", "discovery_result_invalid", [], null);
  }
  if (discovery.malformedEvidence.length) return classification("malformed_recovery_evidence", "malformed_discovery_evidence", [], null, discovery.malformedEvidence);
  if (!Array.isArray(workspaceIds) || workspaceIds.some((workspaceId) => !isValidRuntimeWorkspaceId(workspaceId))) return classification("malformed_recovery_evidence", "workspace_filter_invalid", [], null);
  const filter = new Set(workspaceIds);
  const relevant = discovery.unresolvedOperations.filter((operation) => filter.size === 0 || operation.entry.affectedWorkspaceIds.some((workspaceId) => filter.has(workspaceId)));
  const owners = new Map();
  const overlaps = new Set();
  for (const operation of relevant) for (const workspaceId of operation.entry.affectedWorkspaceIds) {
    const prior = owners.get(workspaceId);
    const identity = recoveryOperationIdentity(operation);
    if (prior && prior !== identity) overlaps.add(workspaceId);
    else owners.set(workspaceId, identity);
  }
  if (overlaps.size) return classification("recovery_operation_conflict", "overlapping_unresolved_operations", relevant, null, [], [...overlaps].sort(compareCodeUnits));
  if (relevant.length === 0) return classification("no_unresolved_operation", "", [], null);
  if (relevant.length === 1) return classification("recovery_required", "fresh_authority_verification_required", relevant, relevant[0]);
  return classification("independent_recovery_operations", "fresh_authority_verification_required", relevant, null);
}

function buildRelevanceIndex(operations) {
  const index = new Map();
  for (const operation of operations) for (const workspaceId of operation.entry.affectedWorkspaceIds) {
    const operationIds = index.get(workspaceId) || [];
    operationIds.push(operation.entry.operationId);
    index.set(workspaceId, operationIds);
  }
  return [...index.entries()].sort(([left], [right]) => compareCodeUnits(left, right)).map(([workspaceId, operationIds]) => ({ workspaceId, operationIds: [...new Set(operationIds)].sort(compareCodeUnits) }));
}

function result(status, ledgers, unresolvedOperations, relevanceIndex, malformedEvidence) {
  return { status, ledgers: clone(ledgers), unresolvedOperations: clone(unresolvedOperations), relevanceIndex: clone(relevanceIndex), malformedEvidence: clone(malformedEvidence), writesPerformed: 0 };
}
function classification(status, reason, operations, operation, errors = [], overlappingWorkspaceIds = []) {
  return { status, reason, operations: clone(operations), operation: operation ? clone(operation) : null, overlappingWorkspaceIds: [...overlappingWorkspaceIds], requiresFreshAuthority: ["recovery_required", "independent_recovery_operations"].includes(status), errors: clone(errors) };
}
function recoveryOperationIdentity(operation) { return stableStringify({ ledgerWorkspaceId: operation.ledgerWorkspaceId, operationId: operation.entry.operationId, requestFingerprint: operation.entry.requestFingerprint }); }
function compareOperations(left, right) { return left.entry.sequence - right.entry.sequence || compareCodeUnits(left.ledgerKey, right.ledgerKey) || compareCodeUnits(left.entry.operationId, right.entry.operationId); }
function compareCodeUnits(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
