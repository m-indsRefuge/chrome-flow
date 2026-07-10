import {
  stableStringify
} from "./constellation-storage-compatibility.js";

import {
  SESSION_DB_SCHEMA,
  runSessionDbTransaction
} from "./session-db.js";

import {
  STORE_KEY_PATHS,
  createConstellationDataMigrationPackage,
  planConstellationDataImport,
  validateConstellationDataMigrationPackage
} from "./constellation-data-portability.js";

const IMPORT_EXECUTION_SCHEMA = "constellation-data-import-execution-v0.1";
const IMPORT_VERIFICATION_SCHEMA = "constellation-data-import-verification-v0.1";
const IMPORT_AUTHORIZATION_PHRASE = "IMPORT CONSTELLATION DATA";
const IMPORT_LOCK_NAME = "constellation-data-import-execution-v0.1";
const DIAGNOSTIC_RING_KEYS = new Set([
  "chromeFlowDiagnostics",
  "constellationDiagnostics"
]);

let fallbackImportLockHeld = false;

async function prepareConstellationDataImport(dataPackage) {
  const packageValidation = await validateConstellationDataMigrationPackage(dataPackage);
  const plan = packageValidation.valid
    ? await planConstellationDataImport(dataPackage)
    : null;
  const counts = summarizeImportPlanCounts(plan);

  return {
    schema: "constellation-data-import-preparation-v0.1",
    preparedAt: new Date().toISOString(),
    packageValidation,
    plan,
    counts,
    executionEligible: packageValidation.valid === true
      && plan?.status === "safe_dry_run"
      && Array.isArray(plan?.conflicts)
      && plan.conflicts.length === 0,
    executionPolicy: "create_or_identical_only",
    destructiveDeletionPlanned: false,
    existingValueOverwritePlanned: false
  };
}

async function executeConstellationDataImport(dataPackage, authorization = {}, options = {}) {
  return withExclusiveImportLock(async () => {
    const executionId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const baseResult = {
      schema: IMPORT_EXECUTION_SCHEMA,
      executionId,
      startedAt,
      completedAt: "",
      status: "not_started",
      importExecuted: false,
      sourceExtensionId: String(dataPackage?.sourceExtensionId || ""),
      destinationExtensionId: String(globalThis.chrome?.runtime?.id || ""),
      sourcePhysicalDatabaseName: String(dataPackage?.sourcePhysicalDatabaseName || ""),
      destinationPhysicalDatabaseName: SESSION_DB_SCHEMA.dbName,
      executionPolicy: "create_or_identical_only",
      packageValidation: null,
      preMutationPlan: null,
      preImportStateDigest: "",
      incomingStateDigest: String(dataPackage?.integrity?.payloadDigest || ""),
      writes: emptyWriteEvidence(),
      verification: null,
      rollback: null,
      safety: {
        operatorAuthorized: false,
        exactPhraseMatched: false,
        exclusiveLockAcquired: true,
        packageDigestValidatedBeforeMutation: false,
        planRevalidatedImmediatelyBeforeMutation: false,
        existingRecordOverwritePerformed: false,
        existingStorageOverwritePerformed: false,
        deletionOfPreexistingDataPerformed: false,
        browserMutationPerformed: false,
        physicalIndexedDbRenamed: false
      }
    };

    const authorizationResult = validateAuthorization(authorization);
    baseResult.safety.operatorAuthorized = authorizationResult.operatorAuthorized;
    baseResult.safety.exactPhraseMatched = authorizationResult.exactPhraseMatched;

    if (!authorizationResult.valid) {
      return completeResult(baseResult, "blocked_operator_authorization", {
        blockReason: authorizationResult.reason
      });
    }

    const preparation = await prepareConstellationDataImport(dataPackage);
    baseResult.packageValidation = preparation.packageValidation;
    baseResult.preMutationPlan = summarizePlan(preparation.plan);
    baseResult.safety.packageDigestValidatedBeforeMutation = preparation.packageValidation?.expectedDigest
      && preparation.packageValidation.expectedDigest === preparation.packageValidation.actualDigest;

    if (!preparation.executionEligible) {
      return completeResult(baseResult, preparation.packageValidation?.valid
        ? "blocked_conflicts_require_review"
        : "blocked_invalid_package", {
        blockReason: preparation.packageValidation?.valid
          ? "The dry-run plan contains conflicts or is not safe."
          : "The package failed schema or digest validation."
      });
    }

    const preImportPackage = await createConstellationDataMigrationPackage();
    baseResult.preImportStateDigest = preImportPackage.integrity.payloadDigest;

    const revalidatedPlan = await planConstellationDataImport(dataPackage);
    baseResult.preMutationPlan = summarizePlan(revalidatedPlan);
    baseResult.safety.planRevalidatedImmediatelyBeforeMutation = revalidatedPlan.status === "safe_dry_run"
      && revalidatedPlan.conflicts.length === 0;

    if (!baseResult.safety.planRevalidatedImmediatelyBeforeMutation) {
      return completeResult(baseResult, "blocked_state_changed_before_import", {
        blockReason: "Current extension state changed after preparation and now conflicts with the package."
      });
    }

    const writeSet = buildWriteSet(dataPackage, revalidatedPlan);
    const plannedWriteCount = countWriteSet(writeSet);

    if (plannedWriteCount === 0) {
      const verification = await verifyConstellationDataImport(dataPackage);
      baseResult.verification = verification;
      baseResult.importExecuted = false;
      return completeResult(
        baseResult,
        verification.valid ? "verified_noop" : "verification_failed_noop",
        {
          noOp: true,
          blockReason: verification.valid ? "" : "Incoming data was not fully represented in current state."
        }
      );
    }

    const created = emptyCreatedArtifacts();

    try {
      const indexedDbEvidence = await createMissingIndexedDbRecords(writeSet.indexedDb);
      created.indexedDb = indexedDbEvidence.created;
      baseResult.writes.indexedDb = indexedDbEvidence;
      baseResult.importExecuted = indexedDbEvidence.created.length > 0;

      maybeTriggerControlledFailure(options, "after_indexeddb");

      const localEvidence = await createMissingStorageKeys(
        chrome.storage.local,
        "local",
        writeSet.storage.local
      );
      created.storage.local = localEvidence.created;
      baseResult.writes.storage.local = localEvidence;
      baseResult.importExecuted = baseResult.importExecuted || localEvidence.created.length > 0;

      maybeTriggerControlledFailure(options, "after_local_storage");

      const sessionEvidence = chrome.storage.session
        ? await createMissingStorageKeys(
          chrome.storage.session,
          "session",
          writeSet.storage.session
        )
        : createSkippedStorageEvidence("session", writeSet.storage.session);
      created.storage.session = sessionEvidence.created;
      baseResult.writes.storage.session = sessionEvidence;
      baseResult.importExecuted = baseResult.importExecuted || sessionEvidence.created.length > 0;

      maybeTriggerControlledFailure(options, "after_session_storage");

      const verification = await verifyConstellationDataImport(dataPackage);
      baseResult.verification = verification;

      if (!verification.valid) {
        throw new ImportVerificationError("Post-import verification did not confirm every incoming record and key.");
      }

      return completeResult(baseResult, "committed_and_verified", {
        noOp: false
      });
    } catch (error) {
      const rollback = await rollbackCreatedArtifacts(created);
      baseResult.rollback = rollback;
      baseResult.verification = await verifyCreatedArtifactsRemoved(created);

      return completeResult(
        baseResult,
        rollback.complete && baseResult.verification.valid
          ? "rolled_back_after_failure"
          : "rollback_incomplete",
        {
          error: serializeError(error),
          controlledValidationFailure: error?.name === "ControlledImportValidationFailure"
        }
      );
    }
  });
}

async function verifyConstellationDataImport(dataPackage) {
  const packageValidation = await validateConstellationDataMigrationPackage(dataPackage);
  if (!packageValidation.valid) {
    return {
      schema: IMPORT_VERIFICATION_SCHEMA,
      verifiedAt: new Date().toISOString(),
      valid: false,
      status: "invalid_package",
      packageValidation,
      indexedDb: {},
      storage: {},
      failures: ["package_validation_failed"]
    };
  }

  const currentPackage = await createConstellationDataMigrationPackage();
  const indexedDbVerification = verifyIndexedDbPayload(
    dataPackage.payload.indexedDb,
    currentPackage.payload.indexedDb
  );
  const storageVerification = verifyStoragePayload(
    dataPackage.payload.storage,
    currentPackage.payload.storage
  );
  const failures = [
    ...indexedDbVerification.failures,
    ...storageVerification.failures
  ];

  return {
    schema: IMPORT_VERIFICATION_SCHEMA,
    verifiedAt: new Date().toISOString(),
    valid: failures.length === 0,
    status: failures.length ? "verification_failed" : "verified",
    incomingPayloadDigest: dataPackage.integrity.payloadDigest,
    currentPayloadDigest: currentPackage.integrity.payloadDigest,
    exactWholePayloadMatch: dataPackage.integrity.payloadDigest === currentPackage.integrity.payloadDigest,
    indexedDb: indexedDbVerification,
    storage: storageVerification,
    failures,
    safety: {
      verificationPerformedAfterWrites: true,
      extraDestinationRecordsAllowed: true,
      diagnosticRingUsesSubsetVerification: true
    }
  };
}

function buildWriteSet(dataPackage, plan) {
  const indexedDb = {};

  for (const storeName of Object.values(SESSION_DB_SCHEMA.stores)) {
    const createIds = new Set(plan?.stores?.[storeName]?.creates || []);
    const keyPath = STORE_KEY_PATHS[storeName];
    const incoming = Array.isArray(dataPackage?.payload?.indexedDb?.stores?.[storeName])
      ? dataPackage.payload.indexedDb.stores[storeName]
      : [];
    indexedDb[storeName] = incoming
      .filter((record) => createIds.has(record?.[keyPath]))
      .map(cloneSerializable);
  }

  return {
    indexedDb,
    storage: {
      local: selectStorageCreates(
        dataPackage?.payload?.storage?.local,
        plan?.storage?.local?.creates
      ),
      session: selectStorageCreates(
        dataPackage?.payload?.storage?.session,
        plan?.storage?.session?.creates
      )
    }
  };
}

async function createMissingIndexedDbRecords(indexedDbWriteSet) {
  const storeNames = Object.entries(indexedDbWriteSet)
    .filter(([, records]) => records.length > 0)
    .map(([storeName]) => storeName);
  const created = [];

  if (!storeNames.length) {
    return {
      attemptedStoreNames: [],
      plannedCount: 0,
      created,
      transactionCommitted: false,
      noOp: true
    };
  }

  await runSessionDbTransaction(storeNames, "readwrite", (stores) => {
    for (const storeName of storeNames) {
      const store = stores.get(storeName);
      const keyPath = STORE_KEY_PATHS[storeName];
      for (const record of indexedDbWriteSet[storeName]) {
        store.add(cloneSerializable(record));
        created.push({
          storeName,
          keyPath,
          key: record?.[keyPath],
          value: cloneSerializable(record)
        });
      }
    }
  });

  return {
    attemptedStoreNames: storeNames,
    plannedCount: created.length,
    created,
    transactionCommitted: true,
    noOp: false
  };
}

async function createMissingStorageKeys(storageArea, areaName, writeMap) {
  const keys = Object.keys(writeMap || {}).sort();
  if (!keys.length) return createSkippedStorageEvidence(areaName, writeMap);

  const current = await storageArea.get(keys);
  const appearedBeforeWrite = keys.filter((key) => Object.prototype.hasOwnProperty.call(current || {}, key));
  if (appearedBeforeWrite.length) {
    throw new ImportRaceConflictError(
      "Storage keys appeared after planning: " + appearedBeforeWrite.join(", ") + "."
    );
  }

  await storageArea.set(cloneSerializable(writeMap));

  return {
    areaName,
    plannedCount: keys.length,
    created: keys.map((key) => ({ key, value: cloneSerializable(writeMap[key]) })),
    writeCommitted: true,
    noOp: false
  };
}

function createSkippedStorageEvidence(areaName, writeMap) {
  return {
    areaName,
    plannedCount: Object.keys(writeMap || {}).length,
    created: [],
    writeCommitted: false,
    noOp: Object.keys(writeMap || {}).length === 0,
    skipped: Object.keys(writeMap || {}).length > 0
      ? "storage_area_unavailable"
      : "no_missing_keys"
  };
}

async function rollbackCreatedArtifacts(created) {
  const rollback = {
    attemptedAt: new Date().toISOString(),
    indexedDb: {
      removed: [],
      conflicts: [],
      errors: []
    },
    storage: {
      local: { removed: [], conflicts: [], errors: [] },
      session: { removed: [], conflicts: [], errors: [] }
    },
    complete: false
  };

  await rollbackStorageArea(
    chrome.storage.local,
    created.storage.local,
    rollback.storage.local
  );

  if (chrome.storage.session) {
    await rollbackStorageArea(
      chrome.storage.session,
      created.storage.session,
      rollback.storage.session
    );
  }

  await rollbackIndexedDb(created.indexedDb, rollback.indexedDb);

  rollback.complete = rollback.indexedDb.conflicts.length === 0
    && rollback.indexedDb.errors.length === 0
    && rollback.storage.local.conflicts.length === 0
    && rollback.storage.local.errors.length === 0
    && rollback.storage.session.conflicts.length === 0
    && rollback.storage.session.errors.length === 0;

  return rollback;
}

async function rollbackStorageArea(storageArea, createdEntries, evidence) {
  if (!storageArea || !createdEntries.length) return;

  try {
    const keys = createdEntries.map((entry) => entry.key);
    const current = await storageArea.get(keys);
    const removable = [];

    for (const entry of createdEntries) {
      if (!Object.prototype.hasOwnProperty.call(current || {}, entry.key)) continue;
      if (stableStringify(current[entry.key]) === stableStringify(entry.value)) {
        removable.push(entry.key);
      } else {
        evidence.conflicts.push({
          key: entry.key,
          reason: "created_key_changed_before_rollback"
        });
      }
    }

    if (removable.length) {
      await storageArea.remove(removable);
      evidence.removed.push(...removable);
    }
  } catch (error) {
    evidence.errors.push(serializeError(error));
  }
}

async function rollbackIndexedDb(createdEntries, evidence) {
  const byStore = new Map();
  for (const entry of createdEntries) {
    if (!byStore.has(entry.storeName)) byStore.set(entry.storeName, []);
    byStore.get(entry.storeName).push(entry);
  }
  const storeNames = [...byStore.keys()];
  if (!storeNames.length) return;

  try {
    await runSessionDbTransaction(storeNames, "readwrite", (stores) => {
      for (const [storeName, entries] of byStore.entries()) {
        const store = stores.get(storeName);
        for (const entry of entries) {
          const request = store.get(entry.key);
          request.onsuccess = () => {
            if (typeof request.result === "undefined") return;
            if (stableStringify(request.result) === stableStringify(entry.value)) {
              store.delete(entry.key);
              evidence.removed.push({ storeName, key: entry.key });
            } else {
              evidence.conflicts.push({
                storeName,
                key: entry.key,
                reason: "created_record_changed_before_rollback"
              });
            }
          };
        }
      }
    });
  } catch (error) {
    evidence.errors.push(serializeError(error));
  }
}

async function verifyCreatedArtifactsRemoved(created) {
  const failures = [];
  const indexedDb = {};

  for (const storeName of Object.values(SESSION_DB_SCHEMA.stores)) {
    const expectedRemoved = created.indexedDb.filter((entry) => entry.storeName === storeName);
    if (!expectedRemoved.length) continue;

    const dbRecords = await getStoreRecordsForVerification(storeName);
    const keyPath = STORE_KEY_PATHS[storeName];
    const currentIds = new Set(dbRecords.map((record) => record?.[keyPath]));
    const remaining = expectedRemoved
      .map((entry) => entry.key)
      .filter((key) => currentIds.has(key));
    indexedDb[storeName] = { expectedRemoved: expectedRemoved.length, remaining };
    if (remaining.length) failures.push("rollback_indexeddb_remaining:" + storeName);
  }

  const local = await verifyStorageKeysAbsent(chrome.storage.local, created.storage.local);
  const session = chrome.storage.session
    ? await verifyStorageKeysAbsent(chrome.storage.session, created.storage.session)
    : { expectedRemoved: created.storage.session.length, remaining: [] };
  if (local.remaining.length) failures.push("rollback_local_storage_keys_remaining");
  if (session.remaining.length) failures.push("rollback_session_storage_keys_remaining");

  return {
    schema: "constellation-data-import-rollback-verification-v0.1",
    verifiedAt: new Date().toISOString(),
    valid: failures.length === 0,
    status: failures.length ? "rollback_verification_failed" : "rollback_verified",
    indexedDb,
    storage: { local, session },
    failures
  };
}

async function verifyStorageKeysAbsent(storageArea, createdEntries) {
  const keys = createdEntries.map((entry) => entry.key);
  if (!keys.length) return { expectedRemoved: 0, remaining: [] };
  const current = await storageArea.get(keys);
  return {
    expectedRemoved: keys.length,
    remaining: keys.filter((key) => Object.prototype.hasOwnProperty.call(current || {}, key))
  };
}

function verifyIndexedDbPayload(incomingIndexedDb, currentIndexedDb) {
  const stores = {};
  const failures = [];

  for (const storeName of Object.values(SESSION_DB_SCHEMA.stores)) {
    const keyPath = STORE_KEY_PATHS[storeName];
    const incoming = Array.isArray(incomingIndexedDb?.stores?.[storeName])
      ? incomingIndexedDb.stores[storeName]
      : [];
    const current = Array.isArray(currentIndexedDb?.stores?.[storeName])
      ? currentIndexedDb.stores[storeName]
      : [];
    const currentById = new Map(current.map((record) => [record?.[keyPath], record]));
    const missing = [];
    const mismatched = [];

    for (const record of incoming) {
      const id = record?.[keyPath];
      const currentRecord = currentById.get(id);
      if (!currentRecord) {
        missing.push(id || "");
      } else if (stableStringify(currentRecord) !== stableStringify(record)) {
        mismatched.push(id || "");
      }
    }

    stores[storeName] = {
      incomingCount: incoming.length,
      currentCount: current.length,
      missing,
      mismatched,
      verifiedCount: incoming.length - missing.length - mismatched.length
    };
    if (missing.length) failures.push("indexeddb_missing:" + storeName);
    if (mismatched.length) failures.push("indexeddb_mismatched:" + storeName);
  }

  return {
    stores,
    valid: failures.length === 0,
    failures
  };
}

function verifyStoragePayload(incomingStorage, currentStorage) {
  const local = verifyStorageMap(
    incomingStorage?.local || {},
    currentStorage?.local || {},
    "local"
  );
  const session = verifyStorageMap(
    incomingStorage?.session || {},
    currentStorage?.session || {},
    "session"
  );

  return {
    local,
    session,
    valid: local.valid && session.valid,
    failures: [...local.failures, ...session.failures]
  };
}

function verifyStorageMap(incoming, current, areaName) {
  const missing = [];
  const mismatched = [];

  for (const [key, incomingValue] of Object.entries(incoming)) {
    if (!Object.prototype.hasOwnProperty.call(current, key)) {
      missing.push(key);
      continue;
    }

    const matches = DIAGNOSTIC_RING_KEYS.has(key)
      ? diagnosticCollectionContains(current[key], incomingValue)
      : stableStringify(current[key]) === stableStringify(incomingValue);
    if (!matches) mismatched.push(key);
  }

  const failures = [];
  if (missing.length) failures.push("storage_missing:" + areaName);
  if (mismatched.length) failures.push("storage_mismatched:" + areaName);

  return {
    incomingCount: Object.keys(incoming).length,
    currentCount: Object.keys(current).length,
    missing,
    mismatched,
    verifiedCount: Object.keys(incoming).length - missing.length - mismatched.length,
    valid: failures.length === 0,
    failures
  };
}

function diagnosticCollectionContains(currentValue, incomingValue) {
  const current = Array.isArray(currentValue) ? currentValue : [];
  const incoming = Array.isArray(incomingValue) ? incomingValue : [];
  const currentById = new Map(current.map((diagnostic) => [
    diagnosticIdentity(diagnostic),
    diagnostic
  ]));

  return incoming.every((diagnostic) => {
    const currentDiagnostic = currentById.get(diagnosticIdentity(diagnostic));
    return currentDiagnostic
      && stableStringify(currentDiagnostic) === stableStringify(diagnostic);
  });
}

function diagnosticIdentity(diagnostic) {
  return diagnostic?.diagnosticId || [
    diagnostic?.createdAt || "",
    diagnostic?.level || "",
    diagnostic?.action || "",
    diagnostic?.message || "",
    stableStringify(diagnostic?.details || {})
  ].join("::");
}

function selectStorageCreates(incoming = {}, keys = []) {
  const selected = {};
  for (const key of Array.isArray(keys) ? keys : []) {
    if (Object.prototype.hasOwnProperty.call(incoming || {}, key)) {
      selected[key] = cloneSerializable(incoming[key]);
    }
  }
  return selected;
}

function countWriteSet(writeSet) {
  const indexedDbCount = Object.values(writeSet.indexedDb)
    .reduce((total, records) => total + records.length, 0);
  return indexedDbCount
    + Object.keys(writeSet.storage.local).length
    + Object.keys(writeSet.storage.session).length;
}

function summarizeImportPlanCounts(plan) {
  const counts = {
    indexedDbCreates: 0,
    indexedDbIdentical: 0,
    indexedDbConflicts: 0,
    localStorageCreates: 0,
    localStorageIdentical: 0,
    localStorageConflicts: 0,
    sessionStorageCreates: 0,
    sessionStorageIdentical: 0,
    sessionStorageConflicts: 0,
    deletesPlanned: 0
  };

  for (const storePlan of Object.values(plan?.stores || {})) {
    counts.indexedDbCreates += storePlan?.creates?.length || 0;
    counts.indexedDbIdentical += storePlan?.identical?.length || 0;
    counts.indexedDbConflicts += storePlan?.conflicts?.length || 0;
    counts.deletesPlanned += storePlan?.deletesPlanned?.length || 0;
  }

  counts.localStorageCreates = plan?.storage?.local?.creates?.length || 0;
  counts.localStorageIdentical = plan?.storage?.local?.identical?.length || 0;
  counts.localStorageConflicts = plan?.storage?.local?.conflicts?.length || 0;
  counts.sessionStorageCreates = plan?.storage?.session?.creates?.length || 0;
  counts.sessionStorageIdentical = plan?.storage?.session?.identical?.length || 0;
  counts.sessionStorageConflicts = plan?.storage?.session?.conflicts?.length || 0;
  counts.deletesPlanned += plan?.storage?.local?.deletesPlanned?.length || 0;
  counts.deletesPlanned += plan?.storage?.session?.deletesPlanned?.length || 0;

  return counts;
}

function summarizePlan(plan) {
  if (!plan) return null;
  return {
    schema: plan.schema,
    createdAt: plan.createdAt,
    status: plan.status,
    importExecuted: plan.importExecuted,
    currentStateDigest: plan.currentStateDigest || "",
    incomingStateDigest: plan.incomingStateDigest || "",
    conflictCount: plan.conflicts?.length || 0,
    counts: summarizeImportPlanCounts(plan),
    safety: cloneSerializable(plan.safety || {})
  };
}

function validateAuthorization(authorization) {
  const operatorAuthorized = authorization?.operatorAuthorized === true;
  const phrase = String(authorization?.phrase || "");
  const exactPhraseMatched = phrase === IMPORT_AUTHORIZATION_PHRASE;

  return {
    valid: operatorAuthorized && exactPhraseMatched,
    operatorAuthorized,
    exactPhraseMatched,
    reason: !operatorAuthorized
      ? "Operator acknowledgement was not provided."
      : !exactPhraseMatched
        ? "The exact authorization phrase did not match."
        : ""
  };
}

function maybeTriggerControlledFailure(options, stage) {
  if (options?.validationMode !== true) return;
  if (options?.controlledFailureStage !== stage) return;
  const error = new Error("Controlled import validation failure at stage: " + stage + ".");
  error.name = "ControlledImportValidationFailure";
  throw error;
}

async function withExclusiveImportLock(work) {
  if (globalThis.navigator?.locks?.request) {
    return navigator.locks.request(
      IMPORT_LOCK_NAME,
      { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        if (!lock) {
          return {
            schema: IMPORT_EXECUTION_SCHEMA,
            executionId: crypto.randomUUID(),
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            status: "blocked_import_in_progress",
            importExecuted: false,
            safety: {
              exclusiveLockAcquired: false,
              browserMutationPerformed: false,
              physicalIndexedDbRenamed: false
            }
          };
        }
        return work();
      }
    );
  }

  if (fallbackImportLockHeld) {
    return {
      schema: IMPORT_EXECUTION_SCHEMA,
      executionId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      status: "blocked_import_in_progress",
      importExecuted: false,
      safety: {
        exclusiveLockAcquired: false,
        browserMutationPerformed: false,
        physicalIndexedDbRenamed: false
      }
    };
  }

  fallbackImportLockHeld = true;
  try {
    return await work();
  } finally {
    fallbackImportLockHeld = false;
  }
}

function completeResult(baseResult, status, additions = {}) {
  return {
    ...baseResult,
    ...additions,
    status,
    completedAt: new Date().toISOString()
  };
}

function emptyWriteEvidence() {
  return {
    indexedDb: {
      attemptedStoreNames: [],
      plannedCount: 0,
      created: [],
      transactionCommitted: false,
      noOp: true
    },
    storage: {
      local: createSkippedStorageEvidence("local", {}),
      session: createSkippedStorageEvidence("session", {})
    }
  };
}

function emptyCreatedArtifacts() {
  return {
    indexedDb: [],
    storage: {
      local: [],
      session: []
    }
  };
}

async function getStoreRecordsForVerification(storeName) {
  const snapshot = await createConstellationDataMigrationPackage();
  return Array.isArray(snapshot?.payload?.indexedDb?.stores?.[storeName])
    ? snapshot.payload.indexedDb.stores[storeName]
    : [];
}

function serializeError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
    stack: typeof error?.stack === "string" ? error.stack.slice(0, 2000) : ""
  };
}

function cloneSerializable(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

class ImportVerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ImportVerificationError";
  }
}

class ImportRaceConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "ImportRaceConflictError";
  }
}

export {
  IMPORT_AUTHORIZATION_PHRASE,
  IMPORT_EXECUTION_SCHEMA,
  IMPORT_VERIFICATION_SCHEMA,
  executeConstellationDataImport,
  prepareConstellationDataImport,
  verifyConstellationDataImport
};
