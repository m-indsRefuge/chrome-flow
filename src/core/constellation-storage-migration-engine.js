import {
  MIGRATION_STATE_SCHEMA,
  STORAGE_IDENTITIES,
  getStorageIdentity
} from "./constellation-identity-contract.js";

import {
  fingerprintValue,
  mergeDiagnosticCollections,
  stableStringify,
  writeCompatibleStorageValue
} from "./constellation-storage-compatibility.js";

const MIGRATED_IDENTITY_IDS = Object.freeze([
  "activeWorkspace",
  "diagnostics",
  "workspaceArchive",
  "workspaceLibrarySaveCoordinator"
]);

async function runStorageMigrationPass(options = {}) {
  const identityIds = Array.isArray(options.identityIds) && options.identityIds.length
    ? options.identityIds
    : [...MIGRATED_IDENTITY_IDS];
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const results = [];

  for (const identityId of identityIds) {
    results.push(await migrateIdentity(identityId));
  }

  const conflictIdentityIds = results
    .filter((result) => result.status === "conflict_requires_review")
    .map((result) => result.identityId);
  const changedIdentityIds = results
    .filter((result) => result.changed)
    .map((result) => result.identityId);
  const marker = {
    schema: MIGRATION_STATE_SCHEMA,
    runId,
    startedAt,
    completedAt: new Date().toISOString(),
    status: conflictIdentityIds.length ? "completed_with_conflicts" : "completed",
    identityIds,
    changedIdentityIds,
    conflictIdentityIds,
    destructiveDeletionPerformed: false,
    physicalIndexedDbRenamed: false,
    results: results.map((result) => ({
      identityId: result.identityId,
      status: result.status,
      changed: result.changed,
      canonicalPresent: result.after.canonicalPresent,
      legacyPresent: result.after.legacyPresent,
      equivalent: result.after.equivalent,
      canonicalFingerprint: result.after.canonicalFingerprint,
      legacyFingerprint: result.after.legacyFingerprint
    }))
  };

  await chrome.storage.local.set({
    [STORAGE_IDENTITIES.migrationState.canonicalKey]: marker
  });

  return { marker, results };
}

async function runIdempotentStorageMigrationValidation(options = {}) {
  const before = await captureIdentitySnapshot(options.identityIds);
  const firstPass = await runStorageMigrationPass(options);
  const afterFirstPass = await captureIdentitySnapshot(options.identityIds);
  const secondPass = await runStorageMigrationPass(options);
  const afterSecondPass = await captureIdentitySnapshot(options.identityIds);
  const secondPassChangedDataIdentities = secondPass.results
    .filter((result) => result.changed)
    .map((result) => result.identityId);
  const dataFingerprintsStable = compareSnapshotFingerprints(afterFirstPass, afterSecondPass);

  return {
    schema: "constellation-storage-migration-validation-v0.1",
    validationRunId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    before,
    firstPass,
    afterFirstPass,
    secondPass,
    afterSecondPass,
    checks: {
      firstPassCompleted: firstPass.marker.status === "completed",
      noConflicts: firstPass.marker.conflictIdentityIds.length === 0,
      canonicalPeersPresent: afterFirstPass.identities.every((identity) => identity.canonicalPresent || (!identity.canonicalKey && !identity.legacyKey)),
      legacyPeersPreserved: afterFirstPass.identities.every((identity) => !identity.legacyKey || identity.legacyPresent),
      peerFingerprintsEquivalent: afterFirstPass.identities.every((identity) => !identity.legacyKey || identity.equivalent),
      secondPassChangedNoDataIdentities: secondPassChangedDataIdentities.length === 0,
      dataFingerprintsStable,
      destructiveDeletionPerformed: false,
      physicalIndexedDbRenamed: false
    },
    secondPassChangedDataIdentities,
    status: firstPass.marker.status === "completed"
      && secondPass.marker.status === "completed"
      && secondPassChangedDataIdentities.length === 0
      && dataFingerprintsStable
      ? "validated"
      : "needs_attention"
  };
}

async function captureIdentitySnapshot(identityIds = MIGRATED_IDENTITY_IDS) {
  const resolvedIds = Array.isArray(identityIds) && identityIds.length
    ? identityIds
    : [...MIGRATED_IDENTITY_IDS];
  const identities = [];

  for (const identityId of resolvedIds) {
    identities.push(await readRawIdentity(identityId));
  }

  return {
    capturedAt: new Date().toISOString(),
    identities: identities.map((identity) => summarizeRawIdentity(identity))
  };
}

async function migrateIdentity(identityId) {
  const before = await readRawIdentity(identityId);

  if (!before.canonicalPresent && !before.legacyPresent) {
    return buildResult(identityId, "no_data_present", false, before, before);
  }

  if (identityId === "diagnostics") {
    const merged = mergeDiagnosticCollections(before.canonicalValue, before.legacyValue);
    const changed = !before.canonicalPresent
      || !before.legacyPresent
      || !before.equivalent
      || stableStringify(before.canonicalValue) !== stableStringify(merged);

    if (changed) {
      await writeCompatibleStorageValue(identityId, merged);
    }

    return buildResult(
      identityId,
      changed ? "diagnostics_merged_and_written_through" : "already_equivalent",
      changed,
      before,
      await readRawIdentity(identityId)
    );
  }

  if (identityId === "workspaceLibrarySaveCoordinator" && before.conflict) {
    const newest = chooseNewestCoordinator(before.canonicalValue, before.legacyValue);
    await writeCompatibleStorageValue(identityId, newest);
    return buildResult(identityId, "newest_coordinator_written_through", true, before, await readRawIdentity(identityId));
  }

  if (before.conflict) {
    return buildResult(identityId, "conflict_requires_review", false, before, before);
  }

  if (before.canonicalPresent && before.legacyPresent && before.equivalent) {
    return buildResult(identityId, "already_equivalent", false, before, before);
  }

  const value = before.canonicalPresent ? before.canonicalValue : before.legacyValue;
  await writeCompatibleStorageValue(identityId, value);
  return buildResult(identityId, "missing_peer_key_written_through", true, before, await readRawIdentity(identityId));
}

async function readRawIdentity(identityId) {
  const identity = getStorageIdentity(identityId);
  const storageArea = getStorageArea(identity);
  const keys = [identity.canonicalKey, identity.legacyKey].filter(Boolean);
  const result = keys.length ? await storageArea.get(keys) : {};
  const canonicalPresent = Boolean(identity.canonicalKey) && hasOwn(result, identity.canonicalKey);
  const legacyPresent = Boolean(identity.legacyKey) && hasOwn(result, identity.legacyKey);
  const canonicalValue = canonicalPresent ? result[identity.canonicalKey] : undefined;
  const legacyValue = legacyPresent ? result[identity.legacyKey] : undefined;
  const equivalent = canonicalPresent && legacyPresent
    ? stableStringify(canonicalValue) === stableStringify(legacyValue)
    : false;

  return {
    identityId,
    area: getStorageAreaName(identity),
    canonicalKey: identity.canonicalKey || "",
    legacyKey: identity.legacyKey || "",
    canonicalPresent,
    legacyPresent,
    canonicalValue,
    legacyValue,
    equivalent,
    conflict: canonicalPresent && legacyPresent && !equivalent,
    canonicalFingerprint: fingerprintValue(canonicalValue),
    legacyFingerprint: fingerprintValue(legacyValue)
  };
}

function buildResult(identityId, status, changed, before, after) {
  return {
    identityId,
    status,
    changed,
    before: summarizeRawIdentity(before),
    after: summarizeRawIdentity(after)
  };
}

function summarizeRawIdentity(identity) {
  return {
    identityId: identity.identityId,
    area: identity.area,
    canonicalKey: identity.canonicalKey,
    legacyKey: identity.legacyKey,
    canonicalPresent: identity.canonicalPresent,
    legacyPresent: identity.legacyPresent,
    equivalent: identity.equivalent,
    conflict: identity.conflict,
    canonicalFingerprint: identity.canonicalFingerprint,
    legacyFingerprint: identity.legacyFingerprint
  };
}

function compareSnapshotFingerprints(left, right) {
  const leftMap = new Map(left.identities.map((identity) => [identity.identityId, identity]));

  return right.identities.every((identity) => {
    const previous = leftMap.get(identity.identityId);
    return previous
      && previous.canonicalFingerprint === identity.canonicalFingerprint
      && previous.legacyFingerprint === identity.legacyFingerprint
      && previous.equivalent === identity.equivalent;
  });
}

function chooseNewestCoordinator(canonicalValue, legacyValue) {
  return [canonicalValue, legacyValue]
    .filter((value) => value && typeof value === "object")
    .sort((left, right) => getCoordinatorTime(right) - getCoordinatorTime(left))[0] || null;
}

function getCoordinatorTime(value) {
  return Number(value?.completedAtMs) || Date.parse(value?.savedAt || "") || 0;
}

function getStorageArea(identity) {
  if (identity.area === "session_preferred") {
    return chrome.storage.session || chrome.storage.local;
  }
  return chrome.storage[identity.area] || chrome.storage.local;
}

function getStorageAreaName(identity) {
  if (identity.area === "session_preferred") {
    return chrome.storage.session ? "session" : "local";
  }
  return identity.area;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

export {
  MIGRATED_IDENTITY_IDS,
  captureIdentitySnapshot,
  readRawIdentity,
  runIdempotentStorageMigrationValidation,
  runStorageMigrationPass
};
