import {
  createWorkspaceOperationLedger,
  deriveWorkspaceOperationLedgerKey,
  snapshotAndValidateWorkspaceOperationLedger,
  workspaceOperationLedgerFingerprint
} from "./contract.js";
import { discoverWorkspaceRecoveryEvidence } from "./recovery-discovery.js";

export function createWorkspaceOperationLedgerChromeAdapters(chromeApi, options = {}) {
  const local = chromeApi?.storage?.local;
  const withWorkspaceLock = typeof options.withWorkspaceLock === "function"
    ? options.withWorkspaceLock
    : null;

  async function readLedger(workspaceId) {
    let key;
    try { key = deriveWorkspaceOperationLedgerKey(workspaceId); }
    catch (error) { return ledgerResult("rejected", "invalid_workspace_id", workspaceId, null, "key_derivation", false, false, true, [safeError(error)]); }
    if (!local?.get) return ledgerResult("failed", "local_storage_unavailable", workspaceId, null, "read", false, false, true);
    try {
      const values = await local.get(key);
      if (!Object.hasOwn(values || {}, key)) return ledgerResult("absent", "", workspaceId, null, "read", false, true, false);
      const validation = snapshotAndValidateWorkspaceOperationLedger(values[key], { key, workspaceId });
      if (!validation.valid) return ledgerResult("rejected", "malformed_recovery_evidence", workspaceId, null, "read", false, false, false, validation.errors);
      return ledgerResult("found", "", workspaceId, validation.ledger, "read", false, true, false);
    } catch (error) {
      return ledgerResult("failed", "ledger_read_failed", workspaceId, null, "read", false, false, true, [safeError(error)]);
    }
  }

  async function createLedger(workspaceId) {
    let ledger;
    try { ledger = createWorkspaceOperationLedger(workspaceId); }
    catch (error) { return ledgerResult("rejected", "invalid_workspace_id", workspaceId, null, "validate", false, false, true, [safeError(error)]); }
    return locked(workspaceId, async () => {
      const current = await readLedger(workspaceId);
      if (current.status === "found") return ledgerResult("conflict", "ledger_exists", workspaceId, current.ledger, "compare", false, false, false);
      if (current.status !== "absent") return current;
      return persistAndVerify(workspaceId, ledger, "created");
    });
  }

  async function compareWriteLedger(workspaceId, expectedFingerprint, ledger) {
    const validation = snapshotAndValidateWorkspaceOperationLedger(ledger, { workspaceId });
    if (!validation.valid || typeof expectedFingerprint !== "string" || !expectedFingerprint) return ledgerResult("rejected", "invalid_compare_write", workspaceId, null, "validate", false, false, false, validation.errors);
    return locked(workspaceId, async () => {
      const current = await readLedger(workspaceId);
      if (current.status !== "found") return current.status === "absent" ? ledgerResult("conflict", "ledger_absent", workspaceId, null, "compare", false, false, false) : current;
      if (current.fingerprint !== expectedFingerprint) return ledgerResult("conflict", "ledger_fingerprint_conflict", workspaceId, current.ledger, "compare", false, false, false);
      return persistAndVerify(workspaceId, validation.ledger, "committed");
    });
  }

  async function discoverRecovery() {
    if (!local?.get) return { status: "malformed_recovery_evidence", ledgers: [], unresolvedOperations: [], relevanceIndex: [], malformedEvidence: [{ key: "", reason: "local_storage_unavailable" }], writesPerformed: 0 };
    try { return discoverWorkspaceRecoveryEvidence(await local.get(null)); }
    catch (error) { return { status: "malformed_recovery_evidence", ledgers: [], unresolvedOperations: [], relevanceIndex: [], malformedEvidence: [{ key: "", reason: "storage_enumeration_failed", errors: [safeError(error)] }], writesPerformed: 0 }; }
  }

  async function persistAndVerify(workspaceId, ledger, successStatus) {
    const key = deriveWorkspaceOperationLedgerKey(workspaceId);
    const expectedFingerprint = workspaceOperationLedgerFingerprint(ledger);
    try { await local.set({ [key]: ledger }); }
    catch (error) { return ledgerResult("failed", "ledger_write_failed", workspaceId, null, "write", false, false, true, [safeError(error)]); }
    try {
      const values = await local.get(key);
      const validation = snapshotAndValidateWorkspaceOperationLedger(values?.[key], { key, workspaceId });
      const verified = validation.valid && workspaceOperationLedgerFingerprint(validation.ledger) === expectedFingerprint;
      return ledgerResult(verified ? successStatus : "failed", verified ? "" : "ledger_verification_failed", workspaceId, verified ? validation.ledger : null, "verify", true, verified, false, validation.errors);
    } catch (error) {
      return ledgerResult("failed", "ledger_verification_read_failed", workspaceId, null, "verify", true, false, false, [safeError(error)]);
    }
  }

  async function locked(workspaceId, callback) {
    if (!withWorkspaceLock) return ledgerResult("failed", "workspace_lock_unavailable", workspaceId, null, "lock", false, false, true);
    try { return await withWorkspaceLock(workspaceId, callback); }
    catch (error) { return ledgerResult("failed", "workspace_lock_failed", workspaceId, null, "lock", false, false, true, [safeError(error)]); }
  }

  return { readLedger, createLedger, compareWriteLedger, discoverRecovery };
}

function ledgerResult(status, reason, workspaceId, ledger, phase, committed, verified, retrySafe, errors = []) {
  let fingerprint = "";
  if (ledger) { try { fingerprint = workspaceOperationLedgerFingerprint(ledger); } catch { ledger = null; } }
  return { status, reason, workspaceId: typeof workspaceId === "string" ? workspaceId : "", ledger, fingerprint, phase, committed: committed === true, verified: verified === true, retrySafe: retrySafe === true, warnings: [], errors: Array.isArray(errors) ? errors.filter((item) => typeof item === "string") : [] };
}
function safeError(error) { return String(error?.message || error || "unknown_error"); }
