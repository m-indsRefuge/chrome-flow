import {
  stableStringify
} from "../core/constellation-storage-compatibility.js";

import {
  createConstellationDataMigrationPackage,
  createDataInventory,
  planConstellationDataImport,
  validateConstellationDataMigrationPackage
} from "../core/constellation-data-portability.js";

import {
  IMPORT_AUTHORIZATION_PHRASE,
  executeConstellationDataImport
} from "../core/constellation-data-import-executor.js";

import {
  SESSION_DB_SCHEMA,
  deleteFromStore,
  getFromStore
} from "../core/session-db.js";

const VALIDATION_SCHEMA = "layer2-2d-controlled-import-validation-v0.1";
const DISPOSABLE_STORAGE_PREFIX = "constellationImportValidation:";
const DISPOSABLE_WORKSPACE_PREFIX = "layer2-2d-import-validation-";

async function runLayer22dControlledImportValidation() {
  const validationRunId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const baselinePackage = await createConstellationDataMigrationPackage();
  const baselineBrowser = await captureBrowserProjection();
  const evidence = {
    invalidDigest: null,
    conflict: null,
    authorization: null,
    noOp: null,
    create: null,
    createCleanup: null,
    rollback: null,
    rollbackCleanup: null
  };

  const createFixture = createFixtureIdentity(validationRunId, "commit");
  const rollbackFixture = createFixtureIdentity(validationRunId, "rollback");

  try {
    const invalidDigestPackage = cloneSerializable(baselinePackage);
    invalidDigestPackage.payload.extension.productName = "Tampered Constellation Validation Fixture";
    evidence.invalidDigest = await validateConstellationDataMigrationPackage(invalidDigestPackage);

    const conflictPackage = await buildConflictFixturePackage(baselinePackage);
    evidence.conflict = conflictPackage
      ? await planConstellationDataImport(conflictPackage)
      : { status: "not_applicable_no_existing_workspace", conflicts: [] };

    evidence.authorization = await executeConstellationDataImport(baselinePackage, {
      operatorAuthorized: false,
      phrase: ""
    });

    evidence.noOp = await executeConstellationDataImport(baselinePackage, {
      operatorAuthorized: true,
      phrase: IMPORT_AUTHORIZATION_PHRASE
    });

    const createPackage = await buildDisposablePackage(baselinePackage, createFixture);
    evidence.create = await executeConstellationDataImport(createPackage, {
      operatorAuthorized: true,
      phrase: IMPORT_AUTHORIZATION_PHRASE
    });
    evidence.createCleanup = await cleanupFixture(createFixture);

    const postCreateCleanupPackage = await createConstellationDataMigrationPackage();
    const rollbackPackage = await buildDisposablePackage(postCreateCleanupPackage, rollbackFixture);
    evidence.rollback = await executeConstellationDataImport(
      rollbackPackage,
      {
        operatorAuthorized: true,
        phrase: IMPORT_AUTHORIZATION_PHRASE
      },
      {
        validationMode: true,
        controlledFailureStage: "after_indexeddb"
      }
    );
    evidence.rollbackCleanup = await inspectFixtureAbsence(rollbackFixture);
  } finally {
    await cleanupFixture(createFixture);
    await cleanupFixture(rollbackFixture);
  }

  const finalPackage = await createConstellationDataMigrationPackage();
  const finalBrowser = await captureBrowserProjection();
  const checks = buildChecks({
    baselinePackage,
    finalPackage,
    baselineBrowser,
    finalBrowser,
    evidence
  });
  const failedChecks = Object.entries(checks)
    .filter(([, passed]) => passed !== true)
    .map(([name]) => name);

  return {
    packetType: "Constellation Layer 2.2D Controlled Import Validation Packet",
    schema: VALIDATION_SCHEMA,
    validationRunId,
    startedAt,
    completedAt: new Date().toISOString(),
    status: failedChecks.length ? "needs_attention" : "validated",
    checks,
    failedChecks,
    baseline: summarizePackage(baselinePackage),
    final: summarizePackage(finalPackage),
    browserProjection: {
      before: baselineBrowser,
      after: finalBrowser,
      preserved: stableStringify(baselineBrowser) === stableStringify(finalBrowser)
    },
    fixtures: {
      createFixture,
      rollbackFixture
    },
    evidence: summarizeEvidence(evidence),
    safety: {
      productionBackupRead: false,
      productionBackupWritten: false,
      disposableRecordsOnly: true,
      existingRecordsOverwritten: false,
      existingRecordsDeleted: false,
      physicalIndexedDbRenamed: false,
      browserMutationRequested: false
    }
  };
}

async function buildDisposablePackage(basePackage, fixture) {
  const dataPackage = cloneSerializable(basePackage);
  dataPackage.createdAt = new Date().toISOString();
  dataPackage.payload.indexedDb.stores.workspaces.push(createDisposableWorkspace(fixture));
  dataPackage.payload.storage.local[fixture.storageKey] = {
    validationRunId: fixture.validationRunId,
    fixtureKind: fixture.fixtureKind,
    workspaceId: fixture.workspaceId,
    createdAt: fixture.createdAt,
    disposable: true
  };
  return resealPackage(dataPackage);
}

async function buildConflictFixturePackage(basePackage) {
  const existing = basePackage?.payload?.indexedDb?.stores?.workspaces?.[0];
  if (!existing?.workspaceId) return null;

  const dataPackage = cloneSerializable(basePackage);
  const target = dataPackage.payload.indexedDb.stores.workspaces
    .find((workspace) => workspace.workspaceId === existing.workspaceId);
  target.name = String(target.name || "Workspace") + " — controlled conflict fixture";
  target.updatedAt = new Date().toISOString();
  return resealPackage(dataPackage);
}

async function resealPackage(dataPackage) {
  dataPackage.inventory = createDataInventory(dataPackage.payload);
  dataPackage.integrity = {
    algorithm: "SHA-256",
    canonicalization: "stable-json-key-order-v0.1",
    payloadDigest: await sha256Digest(stableStringify(dataPackage.payload))
  };
  dataPackage.validation = await validateConstellationDataMigrationPackage(dataPackage);
  return dataPackage;
}

function createDisposableWorkspace(fixture) {
  return {
    workspaceId: fixture.workspaceId,
    name: "Layer 2.2D Disposable Import Validation",
    aim: "Prove create-only transactional import and cleanup.",
    workspaceType: "research",
    lifecycleState: "paused",
    createdAt: fixture.createdAt,
    updatedAt: fixture.createdAt,
    lastActivatedAt: "",
    tabCount: 0,
    journalEntryCount: 0,
    timelineEventCount: 0,
    validationFixture: true,
    validationRunId: fixture.validationRunId,
    fixtureKind: fixture.fixtureKind
  };
}

function createFixtureIdentity(validationRunId, fixtureKind) {
  const suffix = validationRunId + "-" + fixtureKind;
  return {
    validationRunId,
    fixtureKind,
    workspaceId: DISPOSABLE_WORKSPACE_PREFIX + suffix,
    storageKey: DISPOSABLE_STORAGE_PREFIX + suffix,
    createdAt: new Date().toISOString()
  };
}

async function cleanupFixture(fixture) {
  const result = {
    workspaceId: fixture.workspaceId,
    storageKey: fixture.storageKey,
    workspaceRemoved: false,
    storageKeyRemoved: false,
    errors: []
  };

  try {
    const workspace = await getFromStore(SESSION_DB_SCHEMA.stores.workspaces, fixture.workspaceId);
    if (workspace?.validationFixture === true && workspace?.validationRunId === fixture.validationRunId) {
      await deleteFromStore(SESSION_DB_SCHEMA.stores.workspaces, fixture.workspaceId);
      result.workspaceRemoved = true;
    } else if (typeof workspace === "undefined") {
      result.workspaceRemoved = true;
    } else {
      result.errors.push("Workspace identity existed but was not the disposable fixture.");
    }
  } catch (error) {
    result.errors.push(error?.message || String(error));
  }

  try {
    const current = await chrome.storage.local.get(fixture.storageKey);
    const value = current?.[fixture.storageKey];
    if (value?.disposable === true && value?.validationRunId === fixture.validationRunId) {
      await chrome.storage.local.remove(fixture.storageKey);
      result.storageKeyRemoved = true;
    } else if (!Object.prototype.hasOwnProperty.call(current || {}, fixture.storageKey)) {
      result.storageKeyRemoved = true;
    } else {
      result.errors.push("Storage identity existed but was not the disposable fixture.");
    }
  } catch (error) {
    result.errors.push(error?.message || String(error));
  }

  const absence = await inspectFixtureAbsence(fixture);
  return {
    ...result,
    absence,
    complete: result.errors.length === 0 && absence.absent
  };
}

async function inspectFixtureAbsence(fixture) {
  const workspace = await getFromStore(SESSION_DB_SCHEMA.stores.workspaces, fixture.workspaceId);
  const storage = await chrome.storage.local.get(fixture.storageKey);
  return {
    workspaceAbsent: typeof workspace === "undefined",
    storageKeyAbsent: !Object.prototype.hasOwnProperty.call(storage || {}, fixture.storageKey),
    absent: typeof workspace === "undefined"
      && !Object.prototype.hasOwnProperty.call(storage || {}, fixture.storageKey)
  };
}

function buildChecks({ baselinePackage, finalPackage, baselineBrowser, finalBrowser, evidence }) {
  return {
    invalidDigestRejected: evidence.invalidDigest?.valid === false
      && evidence.invalidDigest?.errors?.some((error) => error.includes("digest")),
    conflictRejectedBeforeWrites: evidence.conflict?.status === "blocked_conflicts_require_review"
      && evidence.conflict?.importExecuted === false
      && evidence.conflict?.conflicts?.length > 0,
    missingAuthorizationRejected: evidence.authorization?.status === "blocked_operator_authorization"
      && evidence.authorization?.importExecuted === false,
    identicalPackageVerifiedNoop: evidence.noOp?.status === "verified_noop"
      && evidence.noOp?.importExecuted === false
      && evidence.noOp?.verification?.valid === true,
    disposableCreateCommitted: evidence.create?.status === "committed_and_verified"
      && evidence.create?.importExecuted === true,
    disposableCreateVerified: evidence.create?.verification?.valid === true,
    disposableCreateDidNotOverwrite: evidence.create?.safety?.existingRecordOverwritePerformed === false
      && evidence.create?.safety?.existingStorageOverwritePerformed === false,
    disposableCreateCleanupComplete: evidence.createCleanup?.complete === true,
    controlledFailureTriggered: evidence.rollback?.controlledValidationFailure === true,
    controlledFailureRolledBack: evidence.rollback?.status === "rolled_back_after_failure"
      && evidence.rollback?.rollback?.complete === true,
    rollbackFixtureAbsent: evidence.rollbackCleanup?.absent === true,
    baselineIndexedDbRestored: stableStringify(baselinePackage.payload.indexedDb)
      === stableStringify(finalPackage.payload.indexedDb),
    baselineStorageRestored: stableStringify(baselinePackage.payload.storage)
      === stableStringify(finalPackage.payload.storage),
    physicalIndexedDbPreserved: finalPackage.payload.indexedDb.physicalName === SESSION_DB_SCHEMA.dbName,
    browserProjectionPreserved: stableStringify(baselineBrowser) === stableStringify(finalBrowser)
  };
}

async function captureBrowserProjection() {
  const [tabs, windows] = await Promise.all([
    chrome.tabs.query({}),
    chrome.windows.getAll({ populate: false })
  ]);
  return {
    tabIds: tabs.map((tab) => tab.id).filter(Number.isInteger).sort((a, b) => a - b),
    windowIds: windows.map((windowInfo) => windowInfo.id).filter(Number.isInteger).sort((a, b) => a - b)
  };
}

function summarizePackage(dataPackage) {
  return {
    payloadDigest: dataPackage?.integrity?.payloadDigest || "",
    physicalDatabaseName: dataPackage?.payload?.indexedDb?.physicalName || "",
    workspaceCount: dataPackage?.payload?.indexedDb?.stores?.workspaces?.length || 0,
    localStorageKeyCount: Object.keys(dataPackage?.payload?.storage?.local || {}).length,
    sessionStorageKeyCount: Object.keys(dataPackage?.payload?.storage?.session || {}).length
  };
}

function summarizeEvidence(evidence) {
  return {
    invalidDigest: {
      valid: evidence.invalidDigest?.valid,
      status: evidence.invalidDigest?.status,
      errors: evidence.invalidDigest?.errors || []
    },
    conflict: {
      status: evidence.conflict?.status,
      importExecuted: evidence.conflict?.importExecuted,
      conflictCount: evidence.conflict?.conflicts?.length || 0
    },
    authorization: summarizeExecution(evidence.authorization),
    noOp: summarizeExecution(evidence.noOp),
    create: summarizeExecution(evidence.create),
    createCleanup: evidence.createCleanup,
    rollback: summarizeExecution(evidence.rollback),
    rollbackCleanup: evidence.rollbackCleanup
  };
}

function summarizeExecution(execution) {
  if (!execution) return null;
  return {
    schema: execution.schema,
    executionId: execution.executionId,
    status: execution.status,
    importExecuted: execution.importExecuted,
    sourceExtensionId: execution.sourceExtensionId,
    destinationExtensionId: execution.destinationExtensionId,
    writes: {
      indexedDbCreated: execution.writes?.indexedDb?.created?.length || 0,
      localStorageCreated: execution.writes?.storage?.local?.created?.length || 0,
      sessionStorageCreated: execution.writes?.storage?.session?.created?.length || 0
    },
    verificationStatus: execution.verification?.status || "not_run",
    verificationValid: execution.verification?.valid,
    rollbackComplete: execution.rollback?.complete,
    controlledValidationFailure: execution.controlledValidationFailure === true,
    safety: execution.safety
  };
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

export {
  VALIDATION_SCHEMA,
  runLayer22dControlledImportValidation
};
