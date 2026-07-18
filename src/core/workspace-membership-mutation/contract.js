import { stableStringify, validDateTime } from "../runtime-contract/value-utils.js";

export const MEMBERSHIP_REQUEST_SCHEMA = "constellation-workspace-membership-add-request-v0.1";
export const MEMBERSHIP_RESULT_SCHEMA = "constellation-workspace-membership-add-result-v0.1";
export const MEMBERSHIP_RECEIPT_SCHEMA = "constellation-workspace-membership-receipt-v0.1";
export const MEMBERSHIP_PENDING_SCHEMA = "constellation-workspace-membership-pending-v0.1";

export const MEMBERSHIP_MUTATION_KINDS = Object.freeze([
  "selected_tab_batch",
  "active_tab",
  "search_tab",
  "recovery_readd"
]);

export const MEMBERSHIP_STATUSES = Object.freeze([
  "committed",
  "replayed",
  "no_change",
  "conflict",
  "invalid",
  "failed",
  "indeterminate"
]);

export const REQUEST_FIELDS = Object.freeze([
  "schema",
  "operationId",
  "mutationKind",
  "workspaceId",
  "sourceContextId",
  "sourceWindowId",
  "expectedWorkspaceRevision",
  "requestedAt",
  "workspaceTabsToAdd",
  "promotionOperationId",
  "nextRuntimeAssignmentId"
]);

export const RESULT_FIELDS = Object.freeze([
  "schema",
  "status",
  "reason",
  "operationId",
  "requestFingerprint",
  "mutationKind",
  "workspaceId",
  "sourceContextId",
  "sourceWindowId",
  "expectedWorkspaceRevision",
  "workspaceRevisionBefore",
  "workspaceRevisionAfter",
  "membershipWritten",
  "membershipVerified",
  "compatiblePeersVerified",
  "replayed",
  "retrySafe",
  "indeterminate",
  "receipt",
  "warnings",
  "errors"
]);

export const RECEIPT_FIELDS = Object.freeze([
  "receiptSchema",
  "mutationOperationId",
  "mutationKind",
  "workspaceId",
  "sourceContextId",
  "sourceWindowId",
  "workspaceRevisionBefore",
  "workspaceRevisionAfter",
  "previousEligibleTabCount",
  "currentEligibleTabCount",
  "addedWorkspaceTabIds",
  "addedBrowserTabIds",
  "membershipWritten",
  "membershipVerified",
  "compatiblePeersVerified",
  "requestedAt"
]);

export const PENDING_FIELDS = Object.freeze([
  "schema",
  "operationId",
  "requestFingerprint",
  "mutationKind",
  "workspaceId",
  "sourceContextId",
  "sourceWindowId",
  "expectedWorkspaceRevision",
  "workspaceRevisionBefore",
  "workspaceRevisionAfter",
  "previousEligibleTabCount",
  "currentEligibleTabCount",
  "addedWorkspaceTabIds",
  "addedBrowserTabIds",
  "eligibleBrowserTabIdsBefore",
  "eligibleBrowserTabIdsAfter",
  "workspaceFingerprintBefore",
  "workspaceFingerprintAfter",
  "requestedAt"
]);

const ADAPTER_FIELDS = Object.freeze([
  "withRuntimeStateLock",
  "readCompatibleWorkspace",
  "writeCompatibleWorkspace",
  "readOperationLedger",
  "writeOperationLedger",
  "readRuntimeAuthority",
  "readBrowserProjection"
]);

export function snapshotSerializable(input) {
  const seen = new WeakSet();

  function visit(value) {
    if (value === null || typeof value === "string" || typeof value === "boolean") return { ok: true, value };
    if (typeof value === "number") {
      return Number.isSafeInteger(value)
        ? { ok: true, value }
        : { ok: false, reason: "number_not_safe_integer" };
    }
    if (["undefined", "function", "symbol", "bigint"].includes(typeof value)) {
      return { ok: false, reason: "unsupported_value" };
    }
    if (seen.has(value)) return { ok: false, reason: "cyclic_value" };

    if (Array.isArray(value)) {
      const keys = ownKeys(value);
      const lengthRead = readOnce(value, "length");
      if (!keys || !lengthRead.ok || !Number.isSafeInteger(lengthRead.value) || lengthRead.value < 0) {
        return { ok: false, reason: "invalid_array" };
      }
      if (keys.some((key) => typeof key !== "string")) return { ok: false, reason: "symbol_array_field" };
      const expectedKeys = new Set(["length"]);
      for (let index = 0; index < lengthRead.value; index += 1) expectedKeys.add(String(index));
      if (keys.length !== expectedKeys.size || keys.some((key) => !expectedKeys.has(key))) {
        return { ok: false, reason: "sparse_or_extended_array" };
      }
      seen.add(value);
      const output = [];
      for (let index = 0; index < lengthRead.value; index += 1) {
        const read = readOnce(value, String(index));
        if (!read.ok) return { ok: false, reason: "throwing_array_getter" };
        const nested = visit(read.value);
        if (!nested.ok) return nested;
        output.push(nested.value);
      }
      seen.delete(value);
      return { ok: true, value: output };
    }

    if (!isPlainRecord(value)) return { ok: false, reason: "non_plain_object" };
    const keys = ownKeys(value);
    if (!keys || keys.some((key) => typeof key !== "string")) return { ok: false, reason: "symbol_object_field" };
    seen.add(value);
    const output = {};
    for (const key of [...keys].sort(compareText)) {
      const read = readOnce(value, key);
      if (!read.ok) return { ok: false, reason: "throwing_object_getter" };
      const nested = visit(read.value);
      if (!nested.ok) return nested;
      output[key] = nested.value;
    }
    seen.delete(value);
    return { ok: true, value: output };
  }

  try { return visit(input); }
  catch { return { ok: false, reason: "snapshot_failed" }; }
}

export function snapshotAndValidateMembershipRequest(input) {
  const snapshot = snapshotSerializable(input);
  if (!snapshot.ok) return { ...snapshot, identities: emptyIdentities() };
  const request = snapshot.value;
  const identities = normalizeMembershipIdentities(request);
  const errors = [];

  if (!isPlainRecord(request) || !exactFields(request, REQUEST_FIELDS)) errors.push("request_fields_invalid");
  if (request.schema !== MEMBERSHIP_REQUEST_SCHEMA) errors.push("request_schema_invalid");
  if (!nonEmptyString(request.operationId)) errors.push("operation_id_invalid");
  if (!MEMBERSHIP_MUTATION_KINDS.includes(request.mutationKind)) errors.push("mutation_kind_invalid");
  if (!nonEmptyString(request.workspaceId)) errors.push("workspace_id_invalid");
  if (!nonEmptyString(request.sourceContextId)) errors.push("source_context_id_invalid");
  if (!safeId(request.sourceWindowId)) errors.push("source_window_id_invalid");
  if (!safeId(request.expectedWorkspaceRevision)) errors.push("expected_workspace_revision_invalid");
  if (!validDateTime(request.requestedAt)) errors.push("requested_at_invalid");
  if (!nonEmptyString(request.promotionOperationId)) errors.push("promotion_operation_id_invalid");
  if (!nonEmptyString(request.nextRuntimeAssignmentId)) errors.push("next_runtime_assignment_id_invalid");

  if (!Array.isArray(request.workspaceTabsToAdd) || request.workspaceTabsToAdd.length === 0) {
    errors.push("workspace_tabs_to_add_invalid");
  } else {
    const workspaceTabIds = new Set();
    const browserTabIds = new Set();
    let previousWorkspaceTabId = null;
    for (const tab of request.workspaceTabsToAdd) {
      if (!validWorkspaceTab(tab)) {
        errors.push("workspace_tab_invalid");
        continue;
      }
      if (workspaceTabIds.has(tab.workspaceTabId)) errors.push("workspace_tab_id_duplicate");
      if (browserTabIds.has(tab.tabId)) errors.push("browser_tab_id_duplicate");
      if (previousWorkspaceTabId !== null && compareText(previousWorkspaceTabId, tab.workspaceTabId) >= 0) {
        errors.push("workspace_tabs_not_canonical");
      }
      workspaceTabIds.add(tab.workspaceTabId);
      browserTabIds.add(tab.tabId);
      previousWorkspaceTabId = tab.workspaceTabId;
    }
  }

  return errors.length
    ? { ok: false, reason: "invalid_membership_request", errors: uniqueSorted(errors), identities, snapshot: request }
    : { ok: true, value: request, identities };
}

export function normalizeMembershipIdentities(value) {
  if (!isPlainRecord(value)) return emptyIdentities();
  return {
    operationId: safeString(value.operationId),
    mutationKind: MEMBERSHIP_MUTATION_KINDS.includes(value.mutationKind) ? value.mutationKind : "",
    workspaceId: safeString(value.workspaceId),
    sourceContextId: safeString(value.sourceContextId),
    sourceWindowId: safeId(value.sourceWindowId) ? value.sourceWindowId : null,
    expectedWorkspaceRevision: safeId(value.expectedWorkspaceRevision) ? value.expectedWorkspaceRevision : null
  };
}

export function createMembershipReceipt(request, fields) {
  return {
    receiptSchema: MEMBERSHIP_RECEIPT_SCHEMA,
    mutationOperationId: request.operationId,
    mutationKind: request.mutationKind,
    workspaceId: request.workspaceId,
    sourceContextId: request.sourceContextId,
    sourceWindowId: request.sourceWindowId,
    workspaceRevisionBefore: fields.workspaceRevisionBefore,
    workspaceRevisionAfter: fields.workspaceRevisionAfter,
    previousEligibleTabCount: fields.previousEligibleTabCount,
    currentEligibleTabCount: fields.currentEligibleTabCount,
    addedWorkspaceTabIds: [...fields.addedWorkspaceTabIds],
    addedBrowserTabIds: [...fields.addedBrowserTabIds],
    membershipWritten: fields.membershipWritten === true,
    membershipVerified: fields.membershipVerified === true,
    compatiblePeersVerified: fields.compatiblePeersVerified === true,
    requestedAt: request.requestedAt
  };
}

export function validateMembershipReceipt(input, expectedRequest = null) {
  const snapshot = snapshotSerializable(input);
  if (!snapshot.ok) return { valid: false, errors: [snapshot.reason] };
  const receipt = snapshot.value;
  const errors = [];
  if (!isPlainRecord(receipt) || !exactFields(receipt, RECEIPT_FIELDS)) errors.push("receipt_fields_invalid");
  if (receipt.receiptSchema !== MEMBERSHIP_RECEIPT_SCHEMA) errors.push("receipt_schema_invalid");
  if (!nonEmptyString(receipt.mutationOperationId)) errors.push("receipt_operation_id_invalid");
  if (!MEMBERSHIP_MUTATION_KINDS.includes(receipt.mutationKind)) errors.push("receipt_mutation_kind_invalid");
  if (!nonEmptyString(receipt.workspaceId) || !nonEmptyString(receipt.sourceContextId)) errors.push("receipt_identity_invalid");
  if (!safeId(receipt.sourceWindowId) || !safeId(receipt.workspaceRevisionBefore) || !safeId(receipt.workspaceRevisionAfter)) errors.push("receipt_revision_invalid");
  if (!safeId(receipt.previousEligibleTabCount) || !safeId(receipt.currentEligibleTabCount)) errors.push("receipt_count_invalid");
  if (!validSortedStrings(receipt.addedWorkspaceTabIds) || !validSortedIds(receipt.addedBrowserTabIds)) errors.push("receipt_added_ids_invalid");
  if (typeof receipt.membershipWritten !== "boolean" || receipt.membershipVerified !== true || receipt.compatiblePeersVerified !== true) errors.push("receipt_verification_invalid");
  if (!validDateTime(receipt.requestedAt)) errors.push("receipt_requested_at_invalid");
  if (receipt.membershipWritten && receipt.workspaceRevisionAfter !== receipt.workspaceRevisionBefore + 1) errors.push("receipt_revision_increment_invalid");
  if (!receipt.membershipWritten && receipt.workspaceRevisionAfter !== receipt.workspaceRevisionBefore) errors.push("receipt_no_change_revision_invalid");
  if (receipt.currentEligibleTabCount < receipt.previousEligibleTabCount) errors.push("receipt_count_regressed");

  if (expectedRequest) {
    if (
      receipt.mutationOperationId !== expectedRequest.operationId ||
      receipt.mutationKind !== expectedRequest.mutationKind ||
      receipt.workspaceId !== expectedRequest.workspaceId ||
      receipt.sourceContextId !== expectedRequest.sourceContextId ||
      receipt.sourceWindowId !== expectedRequest.sourceWindowId ||
      receipt.workspaceRevisionBefore !== expectedRequest.expectedWorkspaceRevision ||
      receipt.requestedAt !== expectedRequest.requestedAt
    ) errors.push("receipt_request_identity_mismatch");
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors), value: receipt };
}

export function createMembershipResult(identities, patch = {}) {
  return {
    schema: MEMBERSHIP_RESULT_SCHEMA,
    status: MEMBERSHIP_STATUSES.includes(patch.status) ? patch.status : "failed",
    reason: nonEmptyString(patch.reason) ? patch.reason : "membership_mutation_failed",
    operationId: safeString(identities.operationId),
    requestFingerprint: typeof patch.requestFingerprint === "string" ? patch.requestFingerprint : "",
    mutationKind: MEMBERSHIP_MUTATION_KINDS.includes(identities.mutationKind) ? identities.mutationKind : "",
    workspaceId: safeString(identities.workspaceId),
    sourceContextId: safeString(identities.sourceContextId),
    sourceWindowId: safeId(identities.sourceWindowId) ? identities.sourceWindowId : null,
    expectedWorkspaceRevision: safeId(identities.expectedWorkspaceRevision) ? identities.expectedWorkspaceRevision : null,
    workspaceRevisionBefore: safeId(patch.workspaceRevisionBefore) ? patch.workspaceRevisionBefore : null,
    workspaceRevisionAfter: safeId(patch.workspaceRevisionAfter) ? patch.workspaceRevisionAfter : null,
    membershipWritten: patch.membershipWritten === true,
    membershipVerified: patch.membershipVerified === true,
    compatiblePeersVerified: patch.compatiblePeersVerified === true,
    replayed: patch.replayed === true,
    retrySafe: patch.retrySafe === true,
    indeterminate: patch.indeterminate === true,
    receipt: patch.receipt || null,
    warnings: Array.isArray(patch.warnings) ? [...patch.warnings] : [],
    errors: Array.isArray(patch.errors) ? [...patch.errors] : []
  };
}

export function validateMembershipResult(input, expectedRequest = null) {
  const snapshot = snapshotSerializable(input);
  if (!snapshot.ok) return { valid: false, errors: [snapshot.reason] };
  const result = snapshot.value;
  const errors = [];
  if (!isPlainRecord(result) || !exactFields(result, RESULT_FIELDS)) errors.push("result_fields_invalid");
  if (result.schema !== MEMBERSHIP_RESULT_SCHEMA) errors.push("result_schema_invalid");
  if (!MEMBERSHIP_STATUSES.includes(result.status)) errors.push("result_status_invalid");
  if (!nonEmptyString(result.reason) || typeof result.requestFingerprint !== "string") errors.push("result_reason_or_fingerprint_invalid");
  if (typeof result.operationId !== "string" || typeof result.mutationKind !== "string" || typeof result.workspaceId !== "string" || typeof result.sourceContextId !== "string") errors.push("result_identity_type_invalid");
  for (const field of ["sourceWindowId", "expectedWorkspaceRevision", "workspaceRevisionBefore", "workspaceRevisionAfter"]) {
    if (!(result[field] === null || safeId(result[field]))) errors.push("result_integer_field_invalid");
  }
  for (const field of ["membershipWritten", "membershipVerified", "compatiblePeersVerified", "replayed", "retrySafe", "indeterminate"]) {
    if (typeof result[field] !== "boolean") errors.push("result_flag_invalid");
  }
  if (!Array.isArray(result.warnings) || result.warnings.some((item) => typeof item !== "string") || !Array.isArray(result.errors) || result.errors.some((item) => typeof item !== "string")) errors.push("result_evidence_invalid");

  const successful = ["committed", "replayed", "no_change"].includes(result.status);
  if (successful) {
    const receiptValidation = validateMembershipReceipt(result.receipt, expectedRequest);
    if (!receiptValidation.valid) errors.push(...receiptValidation.errors);
    if (!result.membershipVerified || !result.compatiblePeersVerified || result.indeterminate) errors.push("result_success_matrix_invalid");
    if (result.workspaceRevisionBefore !== result.receipt?.workspaceRevisionBefore || result.workspaceRevisionAfter !== result.receipt?.workspaceRevisionAfter) errors.push("result_receipt_revision_mismatch");
  } else if (result.receipt !== null) errors.push("result_failure_receipt_must_be_null");
  if (result.status === "committed" && (!result.membershipWritten || result.replayed)) errors.push("result_committed_matrix_invalid");
  if (result.status === "no_change" && (result.membershipWritten || result.replayed)) errors.push("result_no_change_matrix_invalid");
  if (result.status === "replayed" && (!result.replayed || result.membershipWritten)) errors.push("result_replay_matrix_invalid");
  if (result.status === "indeterminate" && !result.indeterminate) errors.push("result_indeterminate_matrix_invalid");
  if (["conflict", "invalid"].includes(result.status) && result.retrySafe) errors.push("result_terminal_rejection_retry_invalid");

  if (expectedRequest) {
    if (
      result.operationId !== expectedRequest.operationId ||
      result.mutationKind !== expectedRequest.mutationKind ||
      result.workspaceId !== expectedRequest.workspaceId ||
      result.sourceContextId !== expectedRequest.sourceContextId ||
      result.sourceWindowId !== expectedRequest.sourceWindowId ||
      result.expectedWorkspaceRevision !== expectedRequest.expectedWorkspaceRevision ||
      (successful && result.workspaceRevisionBefore !== expectedRequest.expectedWorkspaceRevision)
    ) errors.push("result_request_identity_mismatch");
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors), value: result };
}

export function createMembershipPendingRecord(request, requestFingerprint, fields) {
  return {
    schema: MEMBERSHIP_PENDING_SCHEMA,
    operationId: request.operationId,
    requestFingerprint,
    mutationKind: request.mutationKind,
    workspaceId: request.workspaceId,
    sourceContextId: request.sourceContextId,
    sourceWindowId: request.sourceWindowId,
    expectedWorkspaceRevision: request.expectedWorkspaceRevision,
    workspaceRevisionBefore: fields.workspaceRevisionBefore,
    workspaceRevisionAfter: fields.workspaceRevisionAfter,
    previousEligibleTabCount: fields.previousEligibleTabCount,
    currentEligibleTabCount: fields.currentEligibleTabCount,
    addedWorkspaceTabIds: [...fields.addedWorkspaceTabIds],
    addedBrowserTabIds: [...fields.addedBrowserTabIds],
    eligibleBrowserTabIdsBefore: [...fields.eligibleBrowserTabIdsBefore],
    eligibleBrowserTabIdsAfter: [...fields.eligibleBrowserTabIdsAfter],
    workspaceFingerprintBefore: fields.workspaceFingerprintBefore,
    workspaceFingerprintAfter: fields.workspaceFingerprintAfter,
    requestedAt: request.requestedAt
  };
}

export function validateMembershipPendingRecord(input, expectedRequest = null) {
  const snapshot = snapshotSerializable(input);
  if (!snapshot.ok) return { valid: false, errors: [snapshot.reason] };
  const pending = snapshot.value;
  const errors = [];
  if (!isPlainRecord(pending) || !exactFields(pending, PENDING_FIELDS)) errors.push("pending_fields_invalid");
  if (pending.schema !== MEMBERSHIP_PENDING_SCHEMA || !nonEmptyString(pending.operationId) || !nonEmptyString(pending.requestFingerprint)) errors.push("pending_identity_invalid");
  if (!MEMBERSHIP_MUTATION_KINDS.includes(pending.mutationKind) || !nonEmptyString(pending.workspaceId) || !nonEmptyString(pending.sourceContextId) || !safeId(pending.sourceWindowId)) errors.push("pending_request_identity_invalid");
  if (!safeId(pending.expectedWorkspaceRevision) || !safeId(pending.workspaceRevisionBefore) || pending.expectedWorkspaceRevision !== pending.workspaceRevisionBefore || pending.workspaceRevisionAfter !== pending.workspaceRevisionBefore + 1) errors.push("pending_revision_invalid");
  if (!safeId(pending.previousEligibleTabCount) || !safeId(pending.currentEligibleTabCount) || pending.currentEligibleTabCount < pending.previousEligibleTabCount) errors.push("pending_count_invalid");
  if (!validSortedStrings(pending.addedWorkspaceTabIds) || !validSortedIds(pending.addedBrowserTabIds)) errors.push("pending_added_ids_invalid");
  if (!validSortedIds(pending.eligibleBrowserTabIdsBefore) || !validSortedIds(pending.eligibleBrowserTabIdsAfter) || pending.eligibleBrowserTabIdsBefore.length !== pending.previousEligibleTabCount || pending.eligibleBrowserTabIdsAfter.length !== pending.currentEligibleTabCount) errors.push("pending_eligibility_evidence_invalid");
  if (!nonEmptyString(pending.workspaceFingerprintBefore) || !nonEmptyString(pending.workspaceFingerprintAfter) || !validDateTime(pending.requestedAt)) errors.push("pending_evidence_invalid");
  if (expectedRequest && (
    pending.operationId !== expectedRequest.operationId ||
    pending.mutationKind !== expectedRequest.mutationKind ||
    pending.workspaceId !== expectedRequest.workspaceId ||
    pending.sourceContextId !== expectedRequest.sourceContextId ||
    pending.sourceWindowId !== expectedRequest.sourceWindowId ||
    pending.expectedWorkspaceRevision !== expectedRequest.expectedWorkspaceRevision ||
    pending.requestedAt !== expectedRequest.requestedAt
  )) errors.push("pending_request_identity_mismatch");
  return { valid: errors.length === 0, errors: uniqueSorted(errors), value: pending };
}

export function snapshotMembershipAdapters(input) {
  if (!isPlainRecord(input)) return { ok: false, reason: "adapters_not_plain_object" };
  const keys = ownKeys(input);
  if (!keys || keys.some((key) => typeof key !== "string") || keys.length !== ADAPTER_FIELDS.length || keys.some((key) => !ADAPTER_FIELDS.includes(key))) {
    return { ok: false, reason: "adapter_fields_invalid" };
  }
  const adapters = {};
  for (const field of ADAPTER_FIELDS) {
    const read = readOnce(input, field);
    if (!read.ok || typeof read.value !== "function") return { ok: false, reason: "adapter_" + field + "_invalid" };
    adapters[field] = read.value;
  }
  return { ok: true, value: adapters };
}

export function validWorkspaceTab(tab) {
  if (!isPlainRecord(tab) || !nonEmptyString(tab.workspaceTabId) || !safeId(tab.tabId)) return false;
  if (Object.hasOwn(tab, "windowId") && !safeId(tab.windowId)) return false;
  if (Object.hasOwn(tab, "groupId") && !(tab.groupId === -1 || safeId(tab.groupId))) return false;
  if (Object.hasOwn(tab, "url") && typeof tab.url !== "string") return false;
  if (Object.hasOwn(tab, "role") && typeof tab.role !== "string") return false;
  return true;
}

function emptyIdentities() {
  return { operationId: "", mutationKind: "", workspaceId: "", sourceContextId: "", sourceWindowId: null, expectedWorkspaceRevision: null };
}
function nonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }
function safeString(value) { return nonEmptyString(value) ? value : ""; }
function safeId(value) { return Number.isSafeInteger(value) && value >= 0; }
function compareText(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function uniqueSorted(values) { return [...new Set(values)].sort(compareText); }
function exactFields(value, fields) { return stableStringify(Object.keys(value).sort(compareText)) === stableStringify([...fields].sort(compareText)); }
function validSortedStrings(value) { return Array.isArray(value) && value.every(nonEmptyString) && new Set(value).size === value.length && value.every((item, index) => index === 0 || compareText(value[index - 1], item) < 0); }
function validSortedIds(value) { return Array.isArray(value) && value.every(safeId) && new Set(value).size === value.length && value.every((item, index) => index === 0 || value[index - 1] < item); }
function ownKeys(value) { try { return Reflect.ownKeys(value); } catch { return null; } }
function readOnce(value, key) { try { return { ok: true, value: Reflect.get(value, key) }; } catch { return { ok: false }; } }
function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try { const prototype = Reflect.getPrototypeOf(value); return prototype === Object.prototype || prototype === null; }
  catch { return false; }
}
