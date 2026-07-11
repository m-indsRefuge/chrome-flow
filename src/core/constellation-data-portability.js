import {
  SESSION_DB_IDENTITY,
  STORAGE_IDENTITIES
} from "./constellation-identity-contract.js";

import {
  stableStringify
} from "./constellation-storage-compatibility.js";

import {
  SESSION_DB_SCHEMA,
  getAllFromStore
} from "./session-db.js";

const DATA_PACKAGE_SCHEMA = "constellation-data-migration-package-v0.1";
const IMPORT_PLAN_SCHEMA = "constellation-data-import-plan-v0.1";

const STORE_KEY_PATHS = Object.freeze({
  workspaces: "workspaceId",
  workspaceTabs: "workspaceTabId",
  sessions: "sessionId",
  projections: "projectionId",
  workspaceLinks: "linkId",
  constellations: "constellationId",
  journalEntries: "journalEntryId",
  timelineEvents: "eventId",
  summaryCards: "summaryCardId",
  settings: "key"
});

async function createConstellationDataMigrationPackage() {
  const [localStorageState, sessionStorageState, indexedDbState] = await Promise.all([
    chrome.storage.local.get(null),
    chrome.storage.session ? chrome.storage.session.get(null) : Promise.resolve({}),
    exportAllSessionDbStores()
  ]);

  const payload = {
    extension: {
      id: chrome.runtime.id,
      manifestVersion: chrome.runtime.getManifest()?.version || "",
      productName: chrome.runtime.getManifest()?.name || "Constellation"
    },
    storage: {
      local: cloneSerializable(localStorageState),
      session: cloneSerializable(sessionStorageState)
    },
    indexedDb: indexedDbState
  };
  const inventory = createDataInventory(payload);
  const validation = validatePayloadStructure(payload, inventory);
  const payloadDigest = await sha256Digest(stableStringify(payload));

  return {
    schema: DATA_PACKAGE_SCHEMA,
    createdAt: new Date().toISOString(),
    sourceExtensionId: chrome.runtime.id,
    sourcePhysicalDatabaseName: SESSION_DB_SCHEMA.dbName,
    sourceLogicalDatabaseName: SESSION_DB_IDENTITY.logicalCanonicalName,
    payload,
    inventory,
    validation,
    integrity: {
      algorithm: "SHA-256",
      canonicalization: "stable-json-key-order-v0.1",
      payloadDigest
    },
    safety: {
      destructiveDeletionPerformed: false,
      browserTabsCaptured: false,
      pageContentCaptured: false,
      importExecuted: false,
      packageContainsWorkspaceUrlsTitlesAndUserNotes: true
    }
  };
}

async function validateConstellationDataMigrationPackage(dataPackage) {
  const errors = [];
  const warnings = [];

  if (!dataPackage || typeof dataPackage !== "object") {
    return invalidPackageResult(["Package is not an object."]);
  }

  if (dataPackage.schema !== DATA_PACKAGE_SCHEMA) {
    errors.push("Unsupported package schema: " + String(dataPackage.schema || "missing") + ".");
  }

  const payload = dataPackage.payload;
  if (!payload || typeof payload !== "object") {
    errors.push("Package payload is missing.");
    return invalidPackageResult(errors);
  }

  const inventory = createDataInventory(payload);
  const structure = validatePayloadStructure(payload, inventory);
  errors.push(...structure.errors);
  warnings.push(...structure.warnings);

  const expectedDigest = String(dataPackage?.integrity?.payloadDigest || "");
  const actualDigest = await sha256Digest(stableStringify(payload));
  if (!expectedDigest) {
    errors.push("Package payload digest is missing.");
  } else if (expectedDigest !== actualDigest) {
    errors.push("Package payload digest does not match its content.");
  }

  if (dataPackage.sourcePhysicalDatabaseName !== SESSION_DB_SCHEMA.dbName) {
    warnings.push("Package was exported from a different physical database identity.");
  }

  return {
    schema: "constellation-data-package-validation-v0.1",
    validatedAt: new Date().toISOString(),
    valid: errors.length === 0,
    status: errors.length ? "invalid" : warnings.length ? "valid_with_warnings" : "valid",
    errors,
    warnings,
    expectedDigest,
    actualDigest,
    inventory,
    structure
  };
}

async function planConstellationDataImport(dataPackage) {
  const packageValidation = await validateConstellationDataMigrationPackage(dataPackage);
  if (!packageValidation.valid) {
    return {
      schema: IMPORT_PLAN_SCHEMA,
      createdAt: new Date().toISOString(),
      status: "blocked_invalid_package",
      importExecuted: false,
      packageValidation,
      stores: {},
      storage: {},
      conflicts: []
    };
  }

  const currentPackage = await createConstellationDataMigrationPackage();
  const storePlans = {};
  const conflicts = [];

  for (const storeName of Object.values(SESSION_DB_SCHEMA.stores)) {
    const incoming = getStoreRecords(dataPackage.payload.indexedDb, storeName);
    const current = getStoreRecords(currentPackage.payload.indexedDb, storeName);
    const plan = compareRecordCollections(storeName, incoming, current);
    storePlans[storeName] = plan;
    conflicts.push(...plan.conflicts.map((conflict) => ({ storeName, ...conflict })));
  }

  const storagePlan = {
    local: compareStorageMaps(dataPackage.payload.storage.local, currentPackage.payload.storage.local),
    session: compareStorageMaps(dataPackage.payload.storage.session, currentPackage.payload.storage.session)
  };
  conflicts.push(...storagePlan.local.conflicts.map((conflict) => ({ area: "local", ...conflict })));
  conflicts.push(...storagePlan.session.conflicts.map((conflict) => ({ area: "session", ...conflict })));

  return {
    schema: IMPORT_PLAN_SCHEMA,
    createdAt: new Date().toISOString(),
    status: conflicts.length ? "blocked_conflicts_require_review" : "safe_dry_run",
    importExecuted: false,
    packageValidation,
    currentStateDigest: currentPackage.integrity.payloadDigest,
    incomingStateDigest: dataPackage.integrity.payloadDigest,
    stores: storePlans,
    storage: storagePlan,
    conflicts,
    safety: {
      noWritesPerformed: true,
      noDeletesPlanned: true,
      duplicatePrimaryKeysBlocked: true,
      digestValidatedBeforePlanning: true
    }
  };
}

async function exportAllSessionDbStores() {
  const stores = {};

  for (const storeName of Object.values(SESSION_DB_SCHEMA.stores)) {
    const records = await getAllFromStore(storeName);
    stores[storeName] = cloneSerializable(Array.isArray(records) ? records : []);
  }

  return {
    logicalName: SESSION_DB_IDENTITY.logicalCanonicalName,
    physicalName: SESSION_DB_SCHEMA.dbName,
    version: SESSION_DB_SCHEMA.version,
    stores
  };
}

function createDataInventory(payload) {
  const local = payload?.storage?.local || {};
  const session = payload?.storage?.session || {};
  const stores = payload?.indexedDb?.stores || {};
  const storeCounts = {};

  for (const storeName of Object.values(SESSION_DB_SCHEMA.stores)) {
    storeCounts[storeName] = Array.isArray(stores[storeName]) ? stores[storeName].length : 0;
  }

  return {
    storage: {
      localKeyCount: Object.keys(local).length,
      sessionKeyCount: Object.keys(session).length,
      localKeys: Object.keys(local).sort(),
      sessionKeys: Object.keys(session).sort(),
      classifiedLocalKeys: classifyStorageKeys(local),
      classifiedSessionKeys: classifyStorageKeys(session)
    },
    indexedDb: {
      logicalName: payload?.indexedDb?.logicalName || "",
      physicalName: payload?.indexedDb?.physicalName || "",
      version: payload?.indexedDb?.version || 0,
      storeCount: Object.keys(storeCounts).length,
      storeCounts,
      workspaceRecordCount: storeCounts.workspaces || 0,
      journalEntryCount: storeCounts.journalEntries || 0,
      timelineEventCount: storeCounts.timelineEvents || 0
    },
    runtime: summarizeRuntimeStorage(local),
    durableActiveWorkspaceId: getSettingValue(stores.settings, "activeWorkspaceId")
  };
}

function validatePayloadStructure(payload, inventory) {
  const errors = [];
  const warnings = [];
  const duplicateKeys = {};
  const stores = payload?.indexedDb?.stores || {};

  if (payload?.indexedDb?.physicalName !== SESSION_DB_SCHEMA.dbName) {
    warnings.push("Physical IndexedDB name differs from the current continuity database.");
  }

  for (const [storeName, keyPath] of Object.entries(STORE_KEY_PATHS)) {
    const records = Array.isArray(stores[storeName]) ? stores[storeName] : [];
    const duplicateIds = findDuplicateValues(records.map((record) => record?.[keyPath]));
    duplicateKeys[storeName] = duplicateIds;
    if (duplicateIds.length) {
      errors.push(storeName + " contains duplicate primary keys: " + duplicateIds.join(", ") + ".");
    }
  }

  const workspaceIds = new Set((stores.workspaces || []).map((record) => record?.workspaceId).filter(Boolean));
  for (const storeName of ["workspaceTabs", "sessions", "projections", "journalEntries", "timelineEvents", "summaryCards"]) {
    for (const record of stores[storeName] || []) {
      if (record?.workspaceId && !workspaceIds.has(record.workspaceId)) {
        errors.push(storeName + " record references missing workspaceId " + record.workspaceId + ".");
      }
    }
  }

  for (const link of stores.workspaceLinks || []) {
    if (link?.fromWorkspaceId && !workspaceIds.has(link.fromWorkspaceId)) {
      errors.push("workspaceLinks record references missing fromWorkspaceId " + link.fromWorkspaceId + ".");
    }
    if (link?.toWorkspaceId && !workspaceIds.has(link.toWorkspaceId)) {
      errors.push("workspaceLinks record references missing toWorkspaceId " + link.toWorkspaceId + ".");
    }
  }

  const runtimeWorkspaceId = inventory?.runtime?.activeWorkspaceId || "";
  if (runtimeWorkspaceId && !workspaceIds.has(runtimeWorkspaceId)) {
    warnings.push("Active runtime workspace is not currently represented in durable Workspace Library memory.");
  }

  const durableActiveWorkspaceId = inventory?.durableActiveWorkspaceId || "";
  if (durableActiveWorkspaceId && !workspaceIds.has(durableActiveWorkspaceId)) {
    errors.push("Durable activeWorkspaceId setting references a missing workspace.");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    duplicateKeys,
    checks: {
      allExpectedStoresPresent: Object.values(SESSION_DB_SCHEMA.stores).every((storeName) => Array.isArray(stores[storeName])),
      noDuplicatePrimaryKeys: Object.values(duplicateKeys).every((duplicates) => duplicates.length === 0),
      durableWorkspaceReferencesValid: !errors.some((error) => error.includes("missing workspace")),
      physicalDatabasePreserved: payload?.indexedDb?.physicalName === SESSION_DB_SCHEMA.dbName,
      workspaceRecordCount: inventory?.indexedDb?.workspaceRecordCount || 0
    }
  };
}

function compareRecordCollections(storeName, incomingRecords, currentRecords) {
  const keyPath = STORE_KEY_PATHS[storeName];
  const currentById = new Map(currentRecords.map((record) => [record?.[keyPath], record]));
  const creates = [];
  const identical = [];
  const conflicts = [];

  for (const record of incomingRecords) {
    const id = record?.[keyPath];
    if (!id) {
      conflicts.push({ id: "", reason: "missing_primary_key" });
      continue;
    }
    const current = currentById.get(id);
    if (!current) {
      creates.push(id);
    } else if (stableStringify(current) === stableStringify(record)) {
      identical.push(id);
    } else {
      conflicts.push({
        id,
        reason: "same_primary_key_different_content",
        currentFingerprint: simpleFingerprint(current),
        incomingFingerprint: simpleFingerprint(record)
      });
    }
  }

  return {
    keyPath,
    incomingCount: incomingRecords.length,
    currentCount: currentRecords.length,
    creates,
    identical,
    conflicts,
    deletesPlanned: []
  };
}

function compareStorageMaps(incoming = {}, current = {}) {
  const creates = [];
  const identical = [];
  const conflicts = [];

  for (const key of Object.keys(incoming)) {
    if (!Object.prototype.hasOwnProperty.call(current, key)) {
      creates.push(key);
    } else if (stableStringify(incoming[key]) === stableStringify(current[key])) {
      identical.push(key);
    } else {
      conflicts.push({
        key,
        reason: "same_storage_key_different_content",
        currentFingerprint: simpleFingerprint(current[key]),
        incomingFingerprint: simpleFingerprint(incoming[key])
      });
    }
  }

  return { creates, identical, conflicts, deletesPlanned: [] };
}

function classifyStorageKeys(storageMap) {
  const classifications = [];
  const registered = Object.values(STORAGE_IDENTITIES);

  for (const key of Object.keys(storageMap).sort()) {
    const direct = registered.find((identity) => identity.canonicalKey === key || identity.legacyKey === key);
    if (direct) {
      classifications.push({
        key,
        identityId: direct.id,
        classification: key === direct.canonicalKey ? "canonical" : "legacy_compatible"
      });
      continue;
    }

    const shard = registered.find((identity) => identity.canonicalPrefix && (key.startsWith(identity.canonicalPrefix) || key.startsWith(identity.legacyPrefix)));
    if (shard) {
      classifications.push({
        key,
        identityId: shard.id,
        classification: key.startsWith(shard.canonicalPrefix) ? "canonical" : "legacy_compatible"
      });
      continue;
    }

    classifications.push({ key, identityId: "unregistered_extension_state", classification: "inventory_required" });
  }

  return classifications;
}

function summarizeRuntimeStorage(local) {
  const canonical = local?.[STORAGE_IDENTITIES.activeWorkspace.canonicalKey];
  const legacy = local?.[STORAGE_IDENTITIES.activeWorkspace.legacyKey];
  const workspace = canonical || legacy || null;

  return {
    sourceKey: canonical ? STORAGE_IDENTITIES.activeWorkspace.canonicalKey : legacy ? STORAGE_IDENTITIES.activeWorkspace.legacyKey : "",
    activeWorkspaceId: workspace?.workspaceId || "",
    name: workspace?.name || "",
    tabCount: Array.isArray(workspace?.tabs) ? workspace.tabs.length : 0,
    journalCount: Array.isArray(workspace?.journal) ? workspace.journal.length : 0,
    timelineCount: Array.isArray(workspace?.timeline) ? workspace.timeline.length : 0
  };
}

function getStoreRecords(indexedDb, storeName) {
  return Array.isArray(indexedDb?.stores?.[storeName]) ? indexedDb.stores[storeName] : [];
}

function getSettingValue(settings, key) {
  const record = (Array.isArray(settings) ? settings : []).find((item) => item?.key === key);
  return record?.value || "";
}

function findDuplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values.filter(Boolean)) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function simpleFingerprint(value) {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return "fnv1a32:" + (hash >>> 0).toString(16).padStart(8, "0") + ":" + text.length;
}

async function sha256Digest(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function cloneSerializable(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function invalidPackageResult(errors) {
  return {
    schema: "constellation-data-package-validation-v0.1",
    validatedAt: new Date().toISOString(),
    valid: false,
    status: "invalid",
    errors,
    warnings: [],
    inventory: null,
    structure: null
  };
}

export {
  DATA_PACKAGE_SCHEMA,
  IMPORT_PLAN_SCHEMA,
  STORE_KEY_PATHS,
  createConstellationDataMigrationPackage,
  createDataInventory,
  planConstellationDataImport,
  validateConstellationDataMigrationPackage
};
