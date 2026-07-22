import {
  createRuntimeWorkspaceRecord,
  createRuntimeWorkspaceResult,
  deriveRuntimeWorkspaceKey,
  runtimeWorkspaceFingerprint,
  snapshotAndValidateRuntimeWorkspaceRecord
} from "./contract.js";

export function createRuntimeWorkspaceRecordChromeAdapters(chromeApi, options = {}) {
  const local = chromeApi?.storage?.local;
  const withWorkspaceLock = typeof options.withWorkspaceLock === "function"
    ? options.withWorkspaceLock
    : null;

  async function readRecord(workspaceId) {
    let key;
    try { key = deriveRuntimeWorkspaceKey(workspaceId); }
    catch (error) { return failure(workspaceId, "key_derivation", "invalid_workspace_id", error, true); }
    if (!local?.get) return failure(workspaceId, "read", "local_storage_unavailable", null, true);
    try {
      const values = await local.get(key);
      if (!Object.hasOwn(values || {}, key)) return createRuntimeWorkspaceResult({ status: "absent", workspaceId, phase: "read", verified: true });
      const validation = snapshotAndValidateRuntimeWorkspaceRecord(values[key], { workspaceId, key });
      if (!validation.valid) return createRuntimeWorkspaceResult({ status: "rejected", reason: "malformed_runtime_record", workspaceId, phase: "read", errors: validation.errors });
      return createRuntimeWorkspaceResult({ status: "found", workspaceId, record: validation.record, recordFingerprint: runtimeWorkspaceFingerprint(validation.record), phase: "read", verified: true });
    } catch (error) {
      return failure(workspaceId, "read", "runtime_record_read_failed", error, true);
    }
  }

  async function createRecord(record) {
    const validation = snapshotAndValidateRuntimeWorkspaceRecord(record);
    if (!validation.valid) return createRuntimeWorkspaceResult({ status: "rejected", reason: "malformed_runtime_record", phase: "validate", errors: validation.errors });
    const workspaceId = validation.record.workspaceId;
    return safelyLocked(workspaceId, () => writeAfterComparison(workspaceId, "absent", validation.record, "created"));
  }

  async function compareWriteRecord(workspaceId, expectedFingerprint, record) {
    const validation = snapshotAndValidateRuntimeWorkspaceRecord(record, { workspaceId });
    if (!validation.valid || typeof expectedFingerprint !== "string" || !expectedFingerprint) {
      return createRuntimeWorkspaceResult({ status: "rejected", reason: "invalid_compare_write", workspaceId, phase: "validate", errors: validation.errors });
    }
    return safelyLocked(workspaceId, () => writeAfterComparison(workspaceId, expectedFingerprint, validation.record, "committed"));
  }

  async function pauseRecord(workspaceId, expectedFingerprint, lastVerifiedAt) {
    return safelyLocked(workspaceId, async () => {
      const current = await readRecord(workspaceId);
      if (current.status !== "found") return current.status === "absent"
        ? createRuntimeWorkspaceResult({ status: "conflict", reason: "runtime_record_absent", workspaceId, phase: "compare" })
        : current;
      if (current.recordFingerprint !== expectedFingerprint) return createRuntimeWorkspaceResult({ status: "conflict", reason: "runtime_record_fingerprint_conflict", workspaceId, record: current.record, recordFingerprint: current.recordFingerprint, phase: "compare" });
      let paused;
      try {
        paused = createRuntimeWorkspaceRecord({ ...current.record, lifecycleState: "paused", lastVerifiedAt });
      } catch (error) {
        return failure(workspaceId, "validate", "invalid_pause_record", error, false);
      }
      return persistAndVerify(workspaceId, paused, "paused");
    });
  }

  async function deleteRecord(workspaceId, expectedFingerprint) {
    return safelyLocked(workspaceId, async () => {
      const current = await readRecord(workspaceId);
      if (current.status === "absent") return createRuntimeWorkspaceResult({ status: "no_change", reason: "runtime_record_already_absent", workspaceId, phase: "verify_absence", verified: true });
      if (current.status !== "found") return current;
      if (typeof expectedFingerprint !== "string" || current.recordFingerprint !== expectedFingerprint) return createRuntimeWorkspaceResult({ status: "conflict", reason: "runtime_record_fingerprint_conflict", workspaceId, record: current.record, recordFingerprint: current.recordFingerprint, phase: "compare" });
      const key = deriveRuntimeWorkspaceKey(workspaceId);
      try { await local.remove(key); }
      catch (error) { return failure(workspaceId, "delete", "runtime_record_delete_failed", error, true); }
      try {
        const values = await local.get(key);
        const absent = !Object.hasOwn(values || {}, key);
        return createRuntimeWorkspaceResult({ status: absent ? "deleted" : "failed", reason: absent ? "" : "runtime_record_delete_verification_failed", workspaceId, phase: "verify_absence", committed: true, verified: absent, retrySafe: false });
      } catch (error) {
        return failure(workspaceId, "verify_absence", "runtime_record_delete_verification_read_failed", error, false, true);
      }
    });
  }

  async function writeAfterComparison(workspaceId, expected, record, successStatus) {
    const current = await readRecord(workspaceId);
    if (expected === "absent") {
      if (current.status === "found") return createRuntimeWorkspaceResult({ status: "conflict", reason: "runtime_record_exists", workspaceId, record: current.record, recordFingerprint: current.recordFingerprint, phase: "compare" });
      if (current.status !== "absent") return current;
    } else {
      if (current.status !== "found") return current.status === "absent"
        ? createRuntimeWorkspaceResult({ status: "conflict", reason: "runtime_record_absent", workspaceId, phase: "compare" })
        : current;
      if (current.recordFingerprint !== expected) return createRuntimeWorkspaceResult({ status: "conflict", reason: "runtime_record_fingerprint_conflict", workspaceId, record: current.record, recordFingerprint: current.recordFingerprint, phase: "compare" });
    }
    return persistAndVerify(workspaceId, record, successStatus);
  }

  async function persistAndVerify(workspaceId, record, successStatus) {
    const key = deriveRuntimeWorkspaceKey(workspaceId);
    const expectedFingerprint = runtimeWorkspaceFingerprint(record);
    try { await local.set({ [key]: record }); }
    catch (error) { return failure(workspaceId, "write", "runtime_record_write_failed", error, true); }
    try {
      const values = await local.get(key);
      const validation = snapshotAndValidateRuntimeWorkspaceRecord(values?.[key], { workspaceId, key });
      const freshFingerprint = validation.valid ? runtimeWorkspaceFingerprint(validation.record) : "";
      const verified = validation.valid && freshFingerprint === expectedFingerprint;
      return createRuntimeWorkspaceResult({ status: verified ? successStatus : "failed", reason: verified ? "" : "runtime_record_verification_failed", workspaceId, record: verified ? validation.record : null, recordFingerprint: verified ? freshFingerprint : "", phase: "verify", committed: true, verified, retrySafe: false, errors: validation.errors });
    } catch (error) {
      return failure(workspaceId, "verify", "runtime_record_verification_read_failed", error, false, true);
    }
  }

  async function safelyLocked(workspaceId, operation) {
    if (!withWorkspaceLock) return failure(workspaceId, "lock", "workspace_lock_unavailable", null, true);
    try { return await withWorkspaceLock(workspaceId, operation); }
    catch (error) { return failure(workspaceId, "lock", "workspace_lock_failed", error, true); }
  }

  return { readRecord, createRecord, compareWriteRecord, pauseRecord, deleteRecord };
}

function failure(workspaceId, phase, reason, error, retrySafe, committed = false) {
  return createRuntimeWorkspaceResult({ status: "failed", reason, workspaceId, phase, committed, verified: false, retrySafe, errors: error ? [String(error?.message || error)] : [] });
}
