import {
  MIGRATION_STATE_SCHEMA,
  STORAGE_IDENTITIES,
  getStorageIdentity
} from "./constellation-identity-contract.js";

const DEFAULT_MIGRATION_IDENTITIES = Object.freeze([
  "activeWorkspace",
  "diagnostics",
  "workspaceArchive",
  "workspaceLibrarySaveCoordinator"
]);

async function readCompatibleStorageValue(identityId) {
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
  const conflict = canonicalPresent && legacyPresent && !equivalent;
  const selected = selectCompatibleValue(identityId, {
    canonicalPresent,
    legacyPresent,
    canonicalValue,
    legacyValue,
    conflict
  });

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
    conflict,
    sourceKey: selected.sourceKey,
    value: selected.value,
    canonicalFingerprint: fingerprintValue(canonicalValue),
    legacyFingerprint: fingerprintValue(legacyValue)
  };
}

async function writeCompatibleStorageValue(identityId, value, options = {}) {
  const identity = getStorageIdentity(identityId);
  const storageArea = getStorageArea(identity);
  const writes = {};

  if (identity.canonicalKey) writes[identity.canonicalKey] = cloneSerializable(value);
  if (identity.legacyKey && options.writeLegacy !== false) {
    writes[identity.legacyKey] = cloneSerializable(value);
  }

  await storageArea.set(writes);

  return {
    identityId,
    area: getStorageAreaName(identity),
    writtenKeys: Object.keys(writes),
    fingerprint: fingerprintValue(value),
    writeThrough: Boolean(identity.canonicalKey && identity.legacyKey && options.writeLegacy !== false)
  };
}

async function clearCompatibleStorageValue(identityId) {
  const identity = getStorageIdentity(identityId);
  const storageArea = getStorageArea(identity);
  const keys = [identity.canonicalKey, identity.legacyKey].filter(Boolean);
  if (keys.length) await storageArea.remove(keys);
  return { identityId, removedKeys: keys };
}

async function migrateStorageIdentity(identityId) {
  const before = await readCompatibleStorageValue(identityId);
  const identity = getStorageIdentity(identityId);

  if (!identity.legacyKey) {
    return createMigrationResult(identityId, before, before, "canonical_only_no_action", false);
  }

  if (!before.canonicalPresent && !before.legacyPresent) {
    return createMigrationResult(identityId, before, before, "no_data_present", false);
  }

  if (identityId === "diagnostics") {
    const merged = mergeDiagnosticCollections(before.canonicalValue, before.legacyValue);
    const changed = !before.canonicalPresent
      || !before.legacyPresent
      || !before.equivalent
      || stableStringify(before.value) !== stableStringify(merged);
    if (changed) await writeCompatibleStorageValue(identityId, merged);
    const after = await readCompatibleStorageValue(identityId);
    return createMigrationResult(identityId, before, after, changed ? "diagnostics_merged_and_written_through" : "already_equivalent", changed);
  }

  if (identityId === "workspaceLibrarySaveCoordinator" && before.conflict) {
    const selected = selectNewestCoordinator(before.canonicalValue, before.legacyValue);
    await writeCompatibleStorageValue(identityId, selected);
    const after = await readCompatibleStorageValue(identityId);
    return createMigrationResult(identityId, before, after, "newest_coordinator_written_through", true);
  }

  if (before.conflict) {
    return createMigrationResult(identityId, before, before, "conflict_requires_review", false, true);
  }

  if (before.canonicalPresent && before.legacyPresent && before.equivalent) {
    return createMigrationResult(identityId, before, before, "already_equivalent", false);
  }

  const value = before.canonicalPresent ? before.canonicalValue : before.legacyValue;
  await writeCompatibleStorageValue(identityId, value);
  const after = await readCompatibleStorageValue(identityId);
  return createMigrationResult(identityId, before, after, "missing_peer_key_written_through", true);
}

async function runConstellationStorageIdentityMigration(options = {}) {
  const identityIds = Array.isArray(options.identityIds) && options.identityIds.length
    ? options.identityIds
    : [...DEFAULT_MIGRATION_IDENTITIES];
  const results = [];
  const startedAt = new Date().toISOString();

  for (const identityId of identityIds) {
    results.push(await migrateStorageIdentity(identityId));
  }

  const conflictIdentityIds = results
    .filter((result) => result.conflictRequiresReview)
    .map((result) => result.identityId);
  const marker = {
    schema: MIGRATION_STATE_SCHEMA,
    runId: crypto.randomUUID(),
    startedAt,
    completedAt: new Date().toISOString(),
    status: conflictIdentityIds.length ? "completed_with_conflicts" : "completed",
    identityIds,
    changedIdentityIds: results.filter((result) => result.changed).map((result) => result.identityId),
    conflictIdentityIds,
    destructiveDeletionPerformed: false,
    physicalIndexedDbRenamed: false,
    results: results.map(summarizeMigrationResult)
  };

  await chrome.storage.local.set({
    [STORAGE_IDENTITIES.migrationState.canonicalKey]: marker
  });

  return { marker, results };
}

async function getConstellationStorageMigrationState() {
  const key = STORAGE_IDENTITIES.migrationState.canonicalKey;
  const result = await chrome.storage.local.get(key);
  return result?.[key] || null;
}

function selectCompatibleValue(identityId, state) {
  if (identityId === "diagnostics") {
    return {
      sourceKey: state.canonicalPresent && state.legacyPresent
        ? "merged_canonical_and_legacy"
        : state.canonicalPresent ? "canonical" : state.legacyPresent ? "legacy" : "none",
      value: mergeDiagnosticCollections(state.canonicalValue, state.legacyValue)
    };
  }

  if (identityId === "workspaceLibrarySaveCoordinator" && state.conflict) {
    return { sourceKey: "newest_completed_coordinator", value: selectNewestCoordinator(state.canonicalValue, state.legacyValue) };
  }

  if (state.canonicalPresent) return { sourceKey: "canonical", value: state.canonicalValue };
  if (state.legacyPresent) return { sourceKey: "legacy", value: state.legacyValue };
  return { sourceKey: "none", value: undefined };
}

function mergeDiagnosticCollections(canonicalValue, legacyValue) {
  const canonical = Array.isArray(canonicalValue) ? canonicalValue : [];
  const legacy = Array.isArray(legacyValue) ? legacyValue : [];
  const byId = new Map();

  for (const diagnostic of [...canonical, ...legacy]) {
    if (!diagnostic || typeof diagnostic !== "object") continue;
    const identity = diagnostic.diagnosticId || createDiagnosticFallbackIdentity(diagnostic);
    byId.set(identity, diagnostic);
  }

  return Array.from(byId.values()).sort(compareDiagnostics).slice(-200);
}

function selectNewestCoordinator(canonicalValue, legacyValue) {
  return [canonicalValue, legacyValue]
    .filter((value) => value && typeof value === "object")
    .sort((left, right) => getCoordinatorTime(right) - getCoordinatorTime(left))[0] || null;
}

function getCoordinatorTime(value) {
  return Number(value?.completedAtMs) || Date.parse(value?.savedAt || "") || 0;
}

function createMigrationResult(identityId, before, after, action, changed, conflictRequiresReview = false) {
  return {
    identityId,
    action,
    changed,
    conflictRequiresReview,
    before: summarizeCompatibilityRead(before),
    after: summarizeCompatibilityRead(after)
  };
}

function summarizeCompatibilityRead(read) {
  return {
    area: read.area,
    canonicalKey: read.canonicalKey,
    legacyKey: read.legacyKey,
    canonicalPresent: read.canonicalPresent,
    legacyPresent: read.legacyPresent,
    equivalent: read.equivalent,
    conflict: read.conflict,
    sourceKey: read.sourceKey,
    canonicalFingerprint: read.canonicalFingerprint,
    legacyFingerprint: read.legacyFingerprint
  };
}

function summarizeMigrationResult(result) {
  return {
    identityId: result.identityId,
    action: result.action,
    changed: result.changed,
    conflictRequiresReview: result.conflictRequiresReview,
    afterCanonicalPresent: result.after.canonicalPresent,
    afterLegacyPresent: result.after.legacyPresent,
    afterEquivalent: result.after.equivalent,
    afterCanonicalFingerprint: result.after.canonicalFingerprint,
    afterLegacyFingerprint: result.after.legacyFingerprint
  };
}

function getStorageArea(identity) {
  if (identity.area === "session_preferred") return chrome.storage.session || chrome.storage.local;
  return chrome.storage[identity.area] || chrome.storage.local;
}

function getStorageAreaName(identity) {
  if (identity.area === "session_preferred") return chrome.storage.session ? "session" : "local";
  return identity.area;
}

function fingerprintValue(value) {
  if (typeof value === "undefined") return "absent";
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return "fnv1a32:" + (hash >>> 0).toString(16).padStart(8, "0") + ":" + text.length;
}

function createDiagnosticFallbackIdentity(diagnostic) {
  return [
    diagnostic?.createdAt || "",
    diagnostic?.level || "",
    diagnostic?.action || "",
    diagnostic?.message || "",
    stableStringify(diagnostic?.details || {})
  ].join("::");
}

function compareDiagnostics(left, right) {
  const createdComparison = String(left?.createdAt || "").localeCompare(String(right?.createdAt || ""));
  if (createdComparison !== 0) return createdComparison;
  return String(left?.diagnosticId || createDiagnosticFallbackIdentity(left))
    .localeCompare(String(right?.diagnosticId || createDiagnosticFallbackIdentity(right)));
}

function cloneSerializable(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function stableStringify(value) {
  if (typeof value === "undefined") return "undefined";
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stableStringify(value[key])).join(",") + "}";
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

export {
  DEFAULT_MIGRATION_IDENTITIES,
  clearCompatibleStorageValue,
  fingerprintValue,
  getConstellationStorageMigrationState,
  mergeDiagnosticCollections,
  migrateStorageIdentity,
  readCompatibleStorageValue,
  runConstellationStorageIdentityMigration,
  stableStringify,
  writeCompatibleStorageValue
};
