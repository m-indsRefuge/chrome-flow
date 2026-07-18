import { inspectOperation, recordOperation } from "../runtime-contract/ledger.js";
import { validateOperationLedger } from "../journal-append-coordination/ledger-validation.js";
import { LOCK_NAMES, SCHEMAS } from "../runtime-contract/constants.js";
import { normalizeWorkspaceRevision } from "../runtime-contract/revision.js";
import { stableStringify } from "../runtime-contract/value-utils.js";
import {
  createMembershipPendingRecord,
  createMembershipReceipt,
  createMembershipResult,
  snapshotAndValidateMembershipRequest,
  snapshotMembershipAdapters,
  snapshotSerializable,
  validateMembershipPendingRecord,
  validateMembershipResult
} from "./contract.js";
import { createMembershipRequestFingerprint, fingerprintValue } from "./fingerprint.js";

const LEDGER_READ_FIELDS = Object.freeze(["status", "ledger", "error"]);
const LEDGER_WRITE_FIELDS = Object.freeze(["status", "error"]);
const AUTHORITY_FIELDS = Object.freeze(["status", "contextVerified", "error"]);
const PROJECTION_FIELDS = Object.freeze(["status", "tabIds", "error"]);

export async function coordinateWorkspaceMembershipMutation(requestInput, adaptersInput) {
  const requestValidation = snapshotAndValidateMembershipRequest(requestInput);
  const identities = requestValidation.identities;
  if (!requestValidation.ok) {
    return invalid(identities, "invalid_membership_request", requestValidation.errors || [requestValidation.reason]);
  }
  const request = requestValidation.value;
  const fingerprint = createMembershipRequestFingerprint(request);
  const adapterValidation = snapshotMembershipAdapters(adaptersInput);
  if (!adapterValidation.ok) return invalid(identities, "invalid_membership_adapters", [adapterValidation.reason]);
  const adapters = adapterValidation.value;

  let callbackCount = 0;
  let callbackOpen = true;
  let callbackResult;
  try {
    const returned = await adapters.withRuntimeStateLock(LOCK_NAMES.runtimeState, async () => {
      callbackCount += 1;
      if (!callbackOpen || callbackCount !== 1) {
        return indeterminate(identities, fingerprint, "runtime_state_lock_callback_reused");
      }
      callbackResult = await executeLocked(request, identities, fingerprint, adapters);
      return callbackResult;
    });
    callbackOpen = false;
    if (callbackCount === 0) return failed(identities, fingerprint, "runtime_state_lock_callback_not_invoked", true);
    if (callbackCount !== 1 || callbackResult === undefined) return indeterminate(identities, fingerprint, "runtime_state_lock_callback_count_invalid");
    return ensureResult(returned, request, identities, fingerprint);
  } catch {
    callbackOpen = false;
    return callbackCount > 0
      ? indeterminate(identities, fingerprint, "runtime_state_lock_completion_uncertain")
      : failed(identities, fingerprint, "runtime_state_lock_failed", true);
  }
}

async function executeLocked(request, identities, fingerprint, adapters) {
  const ledgerRead = await readLedger(adapters);
  if (!ledgerRead.valid) return failed(identities, fingerprint, ledgerRead.reason, true);
  const inspection = inspectOperation(ledgerRead.ledger, request.operationId, fingerprint);
  if (inspection.status === "conflict") return conflict(identities, fingerprint, "operation_id_fingerprint_conflict");

  let pending = null;
  if (inspection.status === "replay") {
    const pendingValidation = validateMembershipPendingRecord(inspection.entry.result, request);
    if (pendingValidation.valid && pendingValidation.value.requestFingerprint === fingerprint) pending = pendingValidation.value;
    else return replayStored(request, identities, fingerprint, inspection.entry.result);
  }

  const authorityRead = await readRuntimeAuthority(adapters, request);
  if (!authorityRead.valid) return failed(identities, fingerprint, authorityRead.reason, true);
  if (!authorityRead.contextVerified) return conflict(identities, fingerprint, "source_context_not_verified");

  const workspaceRead = await readCompatibleWorkspace(adapters);
  if (!workspaceRead.valid) {
    return workspaceRead.conflict
      ? conflict(identities, fingerprint, workspaceRead.reason)
      : failed(identities, fingerprint, workspaceRead.reason, true);
  }
  if (workspaceRead.workspace.workspaceId !== request.workspaceId) return conflict(identities, fingerprint, "workspace_identity_mismatch");
  const browserProjection = await readBrowserProjection(adapters);
  if (!browserProjection.valid) return failed(identities, fingerprint, browserProjection.reason, true, workspaceRead.revision);
  if (!requestedBrowserTabsAreLive(request, browserProjection.tabIdSet)) {
    return conflict(identities, fingerprint, "requested_browser_tab_not_live", workspaceRead.revision);
  }

  if (pending) {
    return recoverPending(request, identities, fingerprint, adapters, ledgerRead.ledger, pending, workspaceRead, browserProjection);
  }
  if (workspaceRead.revision !== request.expectedWorkspaceRevision) {
    return conflict(identities, fingerprint, "workspace_revision_mismatch", workspaceRead.revision);
  }

  const prepared = prepareMutation(request, workspaceRead.workspace, workspaceRead.revision, browserProjection.tabIdSet);
  if (!prepared.valid) return conflict(identities, fingerprint, prepared.reason, workspaceRead.revision);
  if (prepared.noChange) {
    const receipt = createMembershipReceipt(request, {
      workspaceRevisionBefore: workspaceRead.revision,
      workspaceRevisionAfter: workspaceRead.revision,
      previousEligibleTabCount: prepared.previousEligibleTabCount,
      currentEligibleTabCount: prepared.currentEligibleTabCount,
      addedWorkspaceTabIds: [],
      addedBrowserTabIds: [],
      membershipWritten: false,
      membershipVerified: true,
      compatiblePeersVerified: true
    });
    const terminal = createMembershipResult(identities, {
      status: "no_change",
      reason: "membership_already_exact",
      requestFingerprint: fingerprint,
      workspaceRevisionBefore: workspaceRead.revision,
      workspaceRevisionAfter: workspaceRead.revision,
      membershipVerified: true,
      compatiblePeersVerified: true,
      receipt
    });
    return recordNewTerminal(adapters, ledgerRead.ledger, request, identities, fingerprint, terminal);
  }

  const pendingRecord = createMembershipPendingRecord(request, fingerprint, {
    workspaceRevisionBefore: workspaceRead.revision,
    workspaceRevisionAfter: workspaceRead.revision + 1,
    previousEligibleTabCount: prepared.previousEligibleTabCount,
    currentEligibleTabCount: prepared.currentEligibleTabCount,
    addedWorkspaceTabIds: prepared.addedWorkspaceTabIds,
    addedBrowserTabIds: prepared.addedBrowserTabIds,
    eligibleBrowserTabIdsBefore: prepared.eligibleBrowserTabIdsBefore,
    eligibleBrowserTabIdsAfter: prepared.eligibleBrowserTabIdsAfter,
    workspaceFingerprintBefore: fingerprintValue(workspaceRead.workspace),
    workspaceFingerprintAfter: fingerprintValue(prepared.nextWorkspace)
  });
  const pendingWrite = await recordPending(adapters, ledgerRead.ledger, request, fingerprint, pendingRecord);
  if (!pendingWrite.valid) return failed(identities, fingerprint, pendingWrite.reason, true, workspaceRead.revision);
  return writeAndFinalize(request, identities, fingerprint, adapters, pendingWrite.ledger, pendingRecord, workspaceRead.workspace, prepared.nextWorkspace);
}

async function recoverPending(request, identities, fingerprint, adapters, ledger, pending, workspaceRead, browserProjection) {
  const currentFingerprint = fingerprintValue(workspaceRead.workspace);
  if (currentFingerprint === pending.workspaceFingerprintAfter && workspaceRead.revision === pending.workspaceRevisionAfter) {
    const verification = verifyRequestedMembership(workspaceRead.workspace, request.workspaceTabsToAdd);
    const eligibleIds = collectEligibleBrowserTabIds(workspaceRead.workspace.tabs, browserProjection.tabIdSet);
    if (!verification.valid || stableStringify(eligibleIds) !== stableStringify(pending.eligibleBrowserTabIdsAfter)) {
      return indeterminate(identities, fingerprint, "pending_membership_verification_failed", workspaceRead.revision);
    }
    return finalizeCommitted(request, identities, fingerprint, adapters, ledger, pending, false);
  }
  if (currentFingerprint !== pending.workspaceFingerprintBefore || workspaceRead.revision !== pending.workspaceRevisionBefore) {
    return indeterminate(identities, fingerprint, "pending_workspace_state_changed", workspaceRead.revision);
  }
  const eligibleIds = collectEligibleBrowserTabIds(workspaceRead.workspace.tabs, browserProjection.tabIdSet);
  if (stableStringify(eligibleIds) !== stableStringify(pending.eligibleBrowserTabIdsBefore)) {
    return indeterminate(identities, fingerprint, "pending_browser_eligibility_changed", workspaceRead.revision);
  }
  const prepared = prepareMutation(request, workspaceRead.workspace, workspaceRead.revision, browserProjection.tabIdSet);
  if (
    !prepared.valid || prepared.noChange ||
    fingerprintValue(prepared.nextWorkspace) !== pending.workspaceFingerprintAfter ||
    stableStringify(prepared.addedWorkspaceTabIds) !== stableStringify(pending.addedWorkspaceTabIds) ||
    stableStringify(prepared.addedBrowserTabIds) !== stableStringify(pending.addedBrowserTabIds) ||
    stableStringify(prepared.eligibleBrowserTabIdsBefore) !== stableStringify(pending.eligibleBrowserTabIdsBefore) ||
    stableStringify(prepared.eligibleBrowserTabIdsAfter) !== stableStringify(pending.eligibleBrowserTabIdsAfter)
  ) return indeterminate(identities, fingerprint, "pending_mutation_plan_changed", workspaceRead.revision);
  return writeAndFinalize(request, identities, fingerprint, adapters, ledger, pending, workspaceRead.workspace, prepared.nextWorkspace);
}

async function writeAndFinalize(request, identities, fingerprint, adapters, ledger, pending, previousWorkspace, nextWorkspace) {
  const prewriteProjection = await readBrowserProjection(adapters);
  if (!prewriteProjection.valid || stableStringify(collectEligibleBrowserTabIds(nextWorkspace.tabs, prewriteProjection.tabIdSet)) !== stableStringify(pending.eligibleBrowserTabIdsAfter)) {
    return indeterminate(identities, fingerprint, prewriteProjection.valid ? "prewrite_browser_eligibility_changed" : prewriteProjection.reason, pending.workspaceRevisionBefore);
  }
  let writeFailed = false;
  try { await adapters.writeCompatibleWorkspace(nextWorkspace); }
  catch { writeFailed = true; }

  const verified = await readCompatibleWorkspace(adapters);
  if (verified.valid && completeWorkspaceEquals(verified, nextWorkspace)) {
    const projection = await readBrowserProjection(adapters);
    if (!projection.valid || stableStringify(collectEligibleBrowserTabIds(verified.workspace.tabs, projection.tabIdSet)) !== stableStringify(pending.eligibleBrowserTabIdsAfter)) {
      return indeterminate(identities, fingerprint, projection.valid ? "browser_eligibility_verification_failed" : projection.reason, verified.revision, {
        membershipWritten: true,
        membershipVerified: true,
        compatiblePeersVerified: true,
        warnings: ["membership_committed_before_browser_eligibility_verification_failure"]
      });
    }
    return finalizeCommitted(request, identities, fingerprint, adapters, ledger, pending, true);
  }
  if (verified.valid && completeWorkspaceEquals(verified, previousWorkspace)) {
    return failed(identities, fingerprint, writeFailed ? "workspace_write_failed" : "workspace_write_not_committed", true, verified.revision);
  }
  return indeterminate(identities, fingerprint, verified.valid ? "workspace_verification_mismatch" : verified.reason, verified.revision);
}

async function finalizeCommitted(request, identities, fingerprint, adapters, ledger, pending, membershipWritten) {
  const receipt = createMembershipReceipt(request, {
    workspaceRevisionBefore: pending.workspaceRevisionBefore,
    workspaceRevisionAfter: pending.workspaceRevisionAfter,
    previousEligibleTabCount: pending.previousEligibleTabCount,
    currentEligibleTabCount: pending.currentEligibleTabCount,
    addedWorkspaceTabIds: pending.addedWorkspaceTabIds,
    addedBrowserTabIds: pending.addedBrowserTabIds,
    membershipWritten: true,
    membershipVerified: true,
    compatiblePeersVerified: true
  });
  const terminal = createMembershipResult(identities, {
    status: "committed",
    reason: membershipWritten ? "membership_committed" : "pending_membership_recovered",
    requestFingerprint: fingerprint,
    workspaceRevisionBefore: pending.workspaceRevisionBefore,
    workspaceRevisionAfter: pending.workspaceRevisionAfter,
    membershipWritten: true,
    membershipVerified: true,
    compatiblePeersVerified: true,
    receipt,
    warnings: membershipWritten ? [] : ["pending_operation_recovered"]
  });
  const finalization = await replacePendingWithTerminal(adapters, ledger, request, fingerprint, terminal);
  if (finalization.valid) return terminal;
  return indeterminate(identities, fingerprint, finalization.reason, pending.workspaceRevisionAfter, {
    membershipWritten: true,
    membershipVerified: true,
    compatiblePeersVerified: true,
    warnings: ["membership_committed_before_terminal_ledger_failure"]
  });
}

function prepareMutation(request, workspace, revision, liveTabIds) {
  const workspaceTabById = new Map();
  const browserTabById = new Map();
  for (const tab of workspace.tabs) {
    if (!isPlainRecord(tab) || !nonEmptyString(tab.workspaceTabId)) return { valid: false, reason: "workspace_membership_malformed" };
    if (!(tab.tabId === null || tab.tabId === undefined || safeId(tab.tabId))) return { valid: false, reason: "workspace_membership_malformed" };
    if (workspaceTabById.has(tab.workspaceTabId)) return { valid: false, reason: "workspace_tab_identity_duplicate" };
    workspaceTabById.set(tab.workspaceTabId, tab);
    if (safeId(tab.tabId)) {
      if (browserTabById.has(tab.tabId)) return { valid: false, reason: "browser_tab_identity_duplicate" };
      browserTabById.set(tab.tabId, tab);
    }
  }

  const additions = [];
  for (const requestedTab of request.workspaceTabsToAdd) {
    const sameWorkspaceId = workspaceTabById.get(requestedTab.workspaceTabId);
    if (sameWorkspaceId) {
      if (stableStringify(sameWorkspaceId) !== stableStringify(requestedTab)) return { valid: false, reason: "existing_workspace_tab_identity_conflict" };
      continue;
    }
    if (browserTabById.has(requestedTab.tabId)) return { valid: false, reason: "existing_browser_tab_identity_conflict" };
    additions.push(requestedTab);
  }
  const eligibleBrowserTabIdsBefore = collectEligibleBrowserTabIds(workspace.tabs, liveTabIds);
  const previousEligibleTabCount = eligibleBrowserTabIdsBefore.length;
  if (additions.length === 0) {
    return { valid: true, noChange: true, previousEligibleTabCount, currentEligibleTabCount: previousEligibleTabCount, eligibleBrowserTabIdsBefore, eligibleBrowserTabIdsAfter: eligibleBrowserTabIdsBefore };
  }
  const nextWorkspace = {
    ...workspace,
    updatedAt: request.requestedAt,
    workspaceRevision: revision + 1,
    tabs: [...workspace.tabs, ...additions]
  };
  return {
    valid: true,
    noChange: false,
    previousEligibleTabCount,
    currentEligibleTabCount: collectEligibleBrowserTabIds(nextWorkspace.tabs, liveTabIds).length,
    eligibleBrowserTabIdsBefore,
    eligibleBrowserTabIdsAfter: collectEligibleBrowserTabIds(nextWorkspace.tabs, liveTabIds),
    addedWorkspaceTabIds: additions.map((tab) => tab.workspaceTabId).sort(compareText),
    addedBrowserTabIds: additions.map((tab) => tab.tabId).sort((left, right) => left - right),
    nextWorkspace
  };
}

function verifyRequestedMembership(workspace, requestedTabs) {
  if (!Array.isArray(workspace.tabs)) return { valid: false };
  for (const requested of requestedTabs) {
    const workspaceMatches = workspace.tabs.filter((tab) => tab?.workspaceTabId === requested.workspaceTabId);
    const browserMatches = workspace.tabs.filter((tab) => tab?.tabId === requested.tabId);
    if (workspaceMatches.length !== 1 || browserMatches.length !== 1 || stableStringify(workspaceMatches[0]) !== stableStringify(requested)) return { valid: false };
  }
  return { valid: true };
}

async function readCompatibleWorkspace(adapters) {
  let invoked;
  try { invoked = await adapters.readCompatibleWorkspace(); }
  catch { return { valid: false, conflict: false, revision: null, reason: "workspace_read_failed" }; }
  const snapshot = snapshotSerializable(invoked);
  if (!snapshot.ok) return { valid: false, conflict: false, revision: null, reason: "workspace_read_malformed" };
  const read = snapshot.value;
  if (!isPlainRecord(read)) return { valid: false, conflict: false, revision: null, reason: "workspace_read_malformed" };
  if (read.conflict === true) return { valid: false, conflict: true, revision: null, reason: "workspace_compatibility_conflict" };
  if (!read.canonicalPresent && !read.legacyPresent) return { valid: false, conflict: true, revision: null, reason: "active_workspace_missing" };
  if (!read.canonicalPresent || !read.legacyPresent || read.equivalent !== true || read.conflict !== false) {
    return { valid: false, conflict: true, revision: null, reason: "compatible_workspace_peer_missing" };
  }
  if (stableStringify(read.value) !== stableStringify(read.canonicalValue) || stableStringify(read.value) !== stableStringify(read.legacyValue)) {
    return { valid: false, conflict: true, revision: null, reason: "compatible_workspace_peer_mismatch" };
  }
  if (!isPlainRecord(read.value) || !nonEmptyString(read.value.workspaceId) || !Array.isArray(read.value.tabs)) {
    return { valid: false, conflict: false, revision: null, reason: "workspace_state_malformed" };
  }
  const revision = normalizeWorkspaceRevision(read.value);
  if (!revision.valid) return { valid: false, conflict: false, revision: null, reason: "workspace_revision_invalid" };
  return { valid: true, conflict: false, workspace: read.value, revision: revision.revision, read };
}

function completeWorkspaceEquals(read, expected) {
  return Boolean(read.valid && stableStringify(read.workspace) === stableStringify(expected) && stableStringify(read.read.canonicalValue) === stableStringify(expected) && stableStringify(read.read.legacyValue) === stableStringify(expected));
}

async function readRuntimeAuthority(adapters, request) {
  let invoked;
  try { invoked = await adapters.readRuntimeAuthority({ workspaceId: request.workspaceId, sourceContextId: request.sourceContextId, sourceWindowId: request.sourceWindowId }); }
  catch { return { valid: false, reason: "runtime_authority_read_failed" }; }
  const snapshot = snapshotSerializable(invoked);
  if (!snapshot.ok || !isPlainRecord(snapshot.value) || !exactFields(snapshot.value, AUTHORITY_FIELDS)) return { valid: false, reason: "runtime_authority_result_invalid" };
  const value = snapshot.value;
  if (!["present", "failed"].includes(value.status) || typeof value.contextVerified !== "boolean" || typeof value.error !== "string") return { valid: false, reason: "runtime_authority_result_invalid" };
  if (value.status === "failed") return { valid: false, reason: value.error || "runtime_authority_read_failed" };
  return { valid: true, contextVerified: value.contextVerified };
}

async function readBrowserProjection(adapters) {
  let invoked;
  try { invoked = await adapters.readBrowserProjection(); }
  catch { return { valid: false, reason: "browser_projection_read_failed" }; }
  const snapshot = snapshotSerializable(invoked);
  if (!snapshot.ok || !isPlainRecord(snapshot.value) || !exactFields(snapshot.value, PROJECTION_FIELDS)) return { valid: false, reason: "browser_projection_result_invalid" };
  const value = snapshot.value;
  if (!["present", "failed"].includes(value.status) || typeof value.error !== "string" || !Array.isArray(value.tabIds) || value.tabIds.some((tabId) => !safeId(tabId)) || new Set(value.tabIds).size !== value.tabIds.length) {
    return { valid: false, reason: "browser_projection_result_invalid" };
  }
  if (value.status === "failed") return { valid: false, reason: value.error || "browser_projection_read_failed" };
  const tabIds = [...value.tabIds].sort((left, right) => left - right);
  if (stableStringify(tabIds) !== stableStringify(value.tabIds)) return { valid: false, reason: "browser_projection_result_invalid" };
  return { valid: true, tabIds, tabIdSet: new Set(tabIds) };
}

async function readLedger(adapters) {
  let invoked;
  try { invoked = await adapters.readOperationLedger(); }
  catch { return { valid: false, reason: "operation_ledger_read_failed" }; }
  const snapshot = snapshotSerializable(invoked);
  if (!snapshot.ok || !isPlainRecord(snapshot.value) || !exactFields(snapshot.value, LEDGER_READ_FIELDS)) return { valid: false, reason: "operation_ledger_read_result_invalid" };
  const value = snapshot.value;
  if (!["present", "failed"].includes(value.status) || typeof value.error !== "string") return { valid: false, reason: "operation_ledger_read_result_invalid" };
  if (value.status === "failed" || !validLedger(value.ledger)) return { valid: false, reason: value.error || "operation_ledger_malformed" };
  return { valid: true, ledger: value.ledger };
}

async function writeLedger(adapters, ledger) {
  let invoked;
  try { invoked = await adapters.writeOperationLedger(ledger); }
  catch { return { valid: false, reason: "operation_ledger_write_failed" }; }
  const snapshot = snapshotSerializable(invoked);
  if (!snapshot.ok || !isPlainRecord(snapshot.value) || !exactFields(snapshot.value, LEDGER_WRITE_FIELDS)) return { valid: false, reason: "operation_ledger_write_result_invalid" };
  const value = snapshot.value;
  if (!["written", "failed"].includes(value.status) || typeof value.error !== "string") return { valid: false, reason: "operation_ledger_write_result_invalid" };
  return value.status === "written" ? { valid: true } : { valid: false, reason: value.error || "operation_ledger_write_failed" };
}

async function recordPending(adapters, ledger, request, fingerprint, pending) {
  const recorded = recordOperation(ledger, { operationId: request.operationId, requestFingerprint: fingerprint, result: pending, recordedAt: request.requestedAt });
  if (recorded.status !== "recorded") return { valid: false, reason: "pending_operation_record_conflict" };
  const written = await writeLedger(adapters, recorded.ledger);
  const reread = await readLedger(adapters);
  if (written.valid && reread.valid) {
    const inspection = inspectOperation(reread.ledger, request.operationId, fingerprint);
    const validation = inspection.status === "replay" ? validateMembershipPendingRecord(inspection.entry.result, request) : { valid: false };
    if (validation.valid && validation.value.requestFingerprint === fingerprint) return { valid: true, ledger: reread.ledger };
  }
  return { valid: false, reason: written.valid ? "pending_operation_verification_failed" : written.reason };
}

async function recordNewTerminal(adapters, ledger, request, identities, fingerprint, terminal) {
  const recorded = recordOperation(ledger, { operationId: request.operationId, requestFingerprint: fingerprint, result: terminal, recordedAt: request.requestedAt });
  if (recorded.status !== "recorded") return conflict(identities, fingerprint, "operation_record_conflict");
  const written = await writeLedger(adapters, recorded.ledger);
  const reread = await readLedger(adapters);
  if (written.valid && reread.valid && storedTerminalMatches(reread.ledger, request, fingerprint)) return terminal;
  return indeterminate(identities, fingerprint, written.valid ? "operation_record_verification_failed" : written.reason, terminal.workspaceRevisionAfter);
}

async function replacePendingWithTerminal(adapters, ledger, request, fingerprint, terminal) {
  const snapshot = snapshotSerializable(ledger);
  if (!snapshot.ok) return { valid: false, reason: "operation_ledger_malformed" };
  const next = snapshot.value;
  const entry = next.entries.find((candidate) => candidate.operationId === request.operationId);
  if (!entry || entry.requestFingerprint !== fingerprint) return { valid: false, reason: "pending_operation_missing" };
  entry.result = terminal;
  if (!validLedger(next)) return { valid: false, reason: "terminal_operation_ledger_invalid" };
  const written = await writeLedger(adapters, next);
  const reread = await readLedger(adapters);
  if (written.valid && reread.valid && storedTerminalMatches(reread.ledger, request, fingerprint)) return { valid: true };
  return { valid: false, reason: written.valid ? "terminal_operation_verification_failed" : written.reason };
}

function storedTerminalMatches(ledger, request, fingerprint) {
  const inspection = inspectOperation(ledger, request.operationId, fingerprint);
  return inspection.status === "replay" && validateMembershipResult(inspection.entry.result, request).valid && ["committed", "no_change"].includes(inspection.entry.result.status) && inspection.entry.result.requestFingerprint === fingerprint;
}

function replayStored(request, identities, fingerprint, stored) {
  const validation = validateMembershipResult(stored, request);
  if (!validation.valid || !["committed", "no_change"].includes(stored.status) || stored.requestFingerprint !== fingerprint) {
    return conflict(identities, fingerprint, "operation_replay_result_invalid");
  }
  return createMembershipResult(identities, {
    ...stored,
    status: "replayed",
    reason: "operation_replayed",
    requestFingerprint: fingerprint,
    membershipWritten: false,
    replayed: true,
    receipt: stored.receipt
  });
}

function validLedger(ledger) {
  if (!validateOperationLedger(ledger).valid) return false;
  if (!isPlainRecord(ledger) || ledger.schema !== SCHEMAS.ledger || !safePositive(ledger.maxEntries) || !safePositive(ledger.nextSequence) || !Array.isArray(ledger.entries) || ledger.entries.length > ledger.maxEntries) return false;
  if (!exactFields(ledger, ["schema", "maxEntries", "nextSequence", "entries"])) return false;
  const operationIds = new Set();
  const sequences = new Set();
  let maximumSequence = 0;
  for (const entry of ledger.entries) {
    if (!isPlainRecord(entry) || !exactFields(entry, ["operationId", "requestFingerprint", "result", "recordedAt", "sequence"])) return false;
    if (!nonEmptyString(entry.operationId) || !nonEmptyString(entry.requestFingerprint) || !nonEmptyString(entry.recordedAt) || !safePositive(entry.sequence) || !isPlainRecord(entry.result)) return false;
    if (operationIds.has(entry.operationId) || sequences.has(entry.sequence)) return false;
    operationIds.add(entry.operationId);
    sequences.add(entry.sequence);
    maximumSequence = Math.max(maximumSequence, entry.sequence);
  }
  return ledger.nextSequence > maximumSequence;
}

function ensureResult(candidate, request, identities, fingerprint) {
  const validation = validateMembershipResult(candidate, request);
  return validation.valid
    ? candidate
    : failed(identities, fingerprint, "membership_result_contract_violation", true, null, { errors: validation.errors });
}

function invalid(identities, reason, errors = []) { return createMembershipResult(identities, { status: "invalid", reason, errors }); }
function conflict(identities, fingerprint, reason, revision = null) { return createMembershipResult(identities, { status: "conflict", reason, requestFingerprint: fingerprint, workspaceRevisionBefore: revision, workspaceRevisionAfter: revision }); }
function failed(identities, fingerprint, reason, retrySafe, revision = null, patch = {}) { return createMembershipResult(identities, { ...patch, status: "failed", reason, requestFingerprint: fingerprint, workspaceRevisionBefore: revision, workspaceRevisionAfter: revision, retrySafe }); }
function indeterminate(identities, fingerprint, reason, revision = null, patch = {}) { return createMembershipResult(identities, { ...patch, status: "indeterminate", reason, requestFingerprint: fingerprint, workspaceRevisionBefore: revision, workspaceRevisionAfter: revision, retrySafe: true, indeterminate: true }); }
function collectEligibleBrowserTabIds(tabs, liveTabIds) {
  return tabs.map((tab) => tab?.tabId).filter((tabId) => safeId(tabId) && liveTabIds.has(tabId)).sort((left, right) => left - right);
}
function requestedBrowserTabsAreLive(request, liveTabIds) { return request.workspaceTabsToAdd.every((tab) => liveTabIds.has(tab.tabId)); }
function nonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }
function safeId(value) { return Number.isSafeInteger(value) && value >= 0; }
function safePositive(value) { return Number.isSafeInteger(value) && value > 0; }
function compareText(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function exactFields(value, fields) { return stableStringify(Object.keys(value).sort(compareText)) === stableStringify([...fields].sort(compareText)); }
function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
