import {
  IDENTITY_CONTRACT_SCHEMA,
  PACKET_SCHEMA_POLICY,
  SESSION_DB_IDENTITY,
  STORAGE_IDENTITIES
} from "../core/constellation-identity-contract.js";

import {
  createConstellationDataMigrationPackage,
  planConstellationDataImport,
  validateConstellationDataMigrationPackage
} from "../core/constellation-data-portability.js";

import {
  runIdempotentStorageMigrationValidation
} from "../core/constellation-storage-migration-engine.js";

import {
  buildConstellationSourceContractInventory
} from "../core/constellation-source-contract-inventory.js";

import {
  stableStringify
} from "../core/constellation-storage-compatibility.js";

const VALIDATION_SCHEMA = "layer2-2c-compatibility-validation-packet-v0.1";
const EXPECTED_WORKSPACE_RECORD_COUNT = 10;
let lastValidationPacket = null;
let lastDataPackage = null;

installLayer22cCompatibilityValidationSurface();

function installLayer22cCompatibilityValidationSurface() {
  const diagnosticsSection = document.getElementById("developerDiagnosticsSection");
  if (!diagnosticsSection || document.getElementById("layer22cCompatibilityValidationSection")) return;

  const section = document.createElement("section");
  section.id = "layer22cCompatibilityValidationSection";
  section.className = "validation-surface";
  section.dataset.validationSurface = "true";
  section.innerHTML = `
    <h3>Layer 2.2C Storage and Data Compatibility</h3>
    <p class="section-help">Inventories persisted identities, validates two idempotent migration passes, verifies all Session DB stores, and prepares a dry-run import plan. No import writes or database renames occur.</p>
    <div class="diagnostics-actions">
      <button id="runLayer22cCompatibilityValidationButton" class="secondary-button">Run Layer 2.2C Validation</button>
      <button id="copyLayer22cCompatibilityPacketButton" class="secondary-button" disabled>Copy Compatibility Packet</button>
      <button id="copyConstellationDataPackageButton" class="secondary-button" disabled>Copy Migration Data Package</button>
    </div>
    <p id="layer22cCompatibilityStatus" class="status-message"></p>
    <pre id="layer22cCompatibilitySummary"></pre>
  `;

  diagnosticsSection.appendChild(section);

  document.getElementById("runLayer22cCompatibilityValidationButton")?.addEventListener("click", () => {
    void runValidation();
  });
  document.getElementById("copyLayer22cCompatibilityPacketButton")?.addEventListener("click", () => {
    void copyJsonArtifact(lastValidationPacket, "Layer 2.2C compatibility packet copied.");
  });
  document.getElementById("copyConstellationDataPackageButton")?.addEventListener("click", () => {
    void copyJsonArtifact(lastDataPackage, "Constellation migration data package copied. Review it before sharing.");
  });
}

async function runValidation() {
  const status = document.getElementById("layer22cCompatibilityStatus");
  const summary = document.getElementById("layer22cCompatibilitySummary");
  const copyPacketButton = document.getElementById("copyLayer22cCompatibilityPacketButton");
  const copyDataButton = document.getElementById("copyConstellationDataPackageButton");

  setDisabled(copyPacketButton, true);
  setDisabled(copyDataButton, true);
  if (status) status.textContent = "Running Layer 2.2C compatibility validation...";
  if (summary) summary.textContent = "";

  try {
    await delay(250);
    const sourceInventory = await buildConstellationSourceContractInventory();
    const beforePackage = await createConstellationDataMigrationPackage();
    const migrationValidation = await runIdempotentStorageMigrationValidation();
    const afterPackage = await createConstellationDataMigrationPackage();
    const packageValidation = await validateConstellationDataMigrationPackage(afterPackage);
    const importPlan = await planConstellationDataImport(afterPackage);
    const continuity = buildContinuityChecks(beforePackage, afterPackage);
    const checks = buildValidationChecks({
      sourceInventory,
      migrationValidation,
      packageValidation,
      importPlan,
      continuity
    });
    const failedChecks = Object.entries(checks)
      .filter(([, passed]) => passed !== true)
      .map(([name]) => name);

    lastDataPackage = afterPackage;
    lastValidationPacket = {
      packetType: "Constellation Layer 2.2C Compatibility Validation Packet",
      schema: VALIDATION_SCHEMA,
      createdAt: new Date().toISOString(),
      status: failedChecks.length ? "needs_attention" : "validated",
      expectedWorkspaceRecordCount: EXPECTED_WORKSPACE_RECORD_COUNT,
      checks,
      failedChecks,
      identityContract: {
        schema: IDENTITY_CONTRACT_SCHEMA,
        physicalDatabasePreserved: SESSION_DB_IDENTITY.physicalCurrentName,
        logicalCanonicalDatabaseName: SESSION_DB_IDENTITY.logicalCanonicalName,
        packetSchemaPolicy: PACKET_SCHEMA_POLICY,
        registeredStorageIdentities: Object.values(STORAGE_IDENTITIES)
      },
      sourceInventory: summarizeSourceInventory(sourceInventory),
      migrationValidation: summarizeMigrationValidation(migrationValidation),
      continuity,
      exportPackage: {
        schema: afterPackage.schema,
        sourceExtensionId: afterPackage.sourceExtensionId,
        payloadDigest: afterPackage.integrity.payloadDigest,
        inventory: afterPackage.inventory,
        validation: packageValidation,
        safety: afterPackage.safety
      },
      importDryRun: summarizeImportPlan(importPlan),
      compatibilityConflicts: cloneSerializable(globalThis.__constellationCompatibilityConflicts || []),
      notes: [
        "No legacy storage key was deleted.",
        "The physical IndexedDB database was not renamed.",
        "The import path was validated as a dry run only; no import writes occurred.",
        "The full migration data package is copied separately because it contains workspace URLs, titles, and User Journal content."
      ]
    };

    setDisabled(copyPacketButton, false);
    setDisabled(copyDataButton, false);
    if (status) {
      status.textContent = failedChecks.length
        ? "Layer 2.2C validation needs attention: " + failedChecks.join(", ") + "."
        : "Layer 2.2C storage, database, and portability validation passed.";
    }
    if (summary) summary.textContent = formatSummary(lastValidationPacket);
  } catch (error) {
    lastValidationPacket = null;
    lastDataPackage = null;
    if (status) status.textContent = "Layer 2.2C validation failed to run. Check the console.";
    if (summary) {
      summary.textContent = JSON.stringify({
        name: error?.name || "Error",
        message: error?.message || String(error),
        stack: typeof error?.stack === "string" ? error.stack.slice(0, 2000) : ""
      }, null, 2);
    }
  }
}

function buildContinuityChecks(beforePackage, afterPackage) {
  const beforeStores = beforePackage.payload.indexedDb.stores;
  const afterStores = afterPackage.payload.indexedDb.stores;
  const storeComparisons = {};

  for (const storeName of Object.keys(afterStores).sort()) {
    const beforeRecords = Array.isArray(beforeStores[storeName]) ? beforeStores[storeName] : [];
    const afterRecords = Array.isArray(afterStores[storeName]) ? afterStores[storeName] : [];
    storeComparisons[storeName] = {
      beforeCount: beforeRecords.length,
      afterCount: afterRecords.length,
      countPreserved: beforeRecords.length === afterRecords.length,
      contentFingerprintBefore: fingerprint(beforeRecords),
      contentFingerprintAfter: fingerprint(afterRecords),
      contentPreserved: stableStringify(beforeRecords) === stableStringify(afterRecords)
    };
  }

  const beforeRuntime = beforePackage.inventory.runtime;
  const afterRuntime = afterPackage.inventory.runtime;

  return {
    workspaceLibrary: {
      expectedCount: EXPECTED_WORKSPACE_RECORD_COUNT,
      beforeCount: beforePackage.inventory.indexedDb.workspaceRecordCount,
      afterCount: afterPackage.inventory.indexedDb.workspaceRecordCount,
      expectedCountPresent: beforePackage.inventory.indexedDb.workspaceRecordCount === EXPECTED_WORKSPACE_RECORD_COUNT
        && afterPackage.inventory.indexedDb.workspaceRecordCount === EXPECTED_WORKSPACE_RECORD_COUNT
    },
    activeRuntime: {
      before: beforeRuntime,
      after: afterRuntime,
      workspaceIdPreserved: beforeRuntime.activeWorkspaceId === afterRuntime.activeWorkspaceId,
      contentPreserved: fingerprint(beforeRuntime) === fingerprint(afterRuntime)
    },
    durableActiveWorkspaceId: {
      before: beforePackage.inventory.durableActiveWorkspaceId,
      after: afterPackage.inventory.durableActiveWorkspaceId,
      preserved: beforePackage.inventory.durableActiveWorkspaceId === afterPackage.inventory.durableActiveWorkspaceId
    },
    indexedDb: {
      physicalNameBefore: beforePackage.payload.indexedDb.physicalName,
      physicalNameAfter: afterPackage.payload.indexedDb.physicalName,
      physicalNamePreserved: beforePackage.payload.indexedDb.physicalName === afterPackage.payload.indexedDb.physicalName
        && afterPackage.payload.indexedDb.physicalName === SESSION_DB_IDENTITY.physicalCurrentName,
      storeComparisons,
      allStoreCountsPreserved: Object.values(storeComparisons).every((comparison) => comparison.countPreserved),
      allStoreContentPreserved: Object.values(storeComparisons).every((comparison) => comparison.contentPreserved)
    }
  };
}

function buildValidationChecks({ sourceInventory, migrationValidation, packageValidation, importPlan, continuity }) {
  const afterIdentities = migrationValidation.afterSecondPass.identities;

  return {
    sourceInventoryCompleted: sourceInventory.filesScanned > 0
      && sourceInventory.failedPaths.length === 0
      && sourceInventory.truncatedAtFileLimit === false,
    storageIdentitiesClassified: sourceInventory.storage.registeredIdentities.length >= 6,
    databaseIdentityClassified: sourceInventory.indexedDb.contract.physicalCurrentName === SESSION_DB_IDENTITY.physicalCurrentName,
    packetSchemasInventoried: sourceInventory.packets.schemaTokens.length > 0,
    eventContractsInventoried: sourceInventory.events.brandedTokens.length > 0
      || sourceInventory.events.semanticContractCandidates.length > 0,
    migrationFirstPassCompleted: migrationValidation.checks.firstPassCompleted,
    migrationNoConflicts: migrationValidation.checks.noConflicts,
    canonicalPeersPresent: migrationValidation.checks.canonicalPeersPresent,
    legacyPeersPreserved: migrationValidation.checks.legacyPeersPreserved,
    canonicalLegacyPeersEquivalent: migrationValidation.checks.peerFingerprintsEquivalent,
    migrationSecondPassIdempotent: migrationValidation.checks.secondPassChangedNoDataIdentities
      && migrationValidation.checks.dataFingerprintsStable,
    migrationMarkerPresent: Boolean(afterIdentities.length)
      && migrationValidation.secondPass.marker.schema === "constellation-storage-identity-migration-v0.1",
    exportPackageValid: packageValidation.valid === true,
    exportDigestValid: packageValidation.expectedDigest === packageValidation.actualDigest,
    tenWorkspaceRecordsPreserved: continuity.workspaceLibrary.expectedCountPresent,
    activeRuntimeWorkspacePreserved: continuity.activeRuntime.workspaceIdPreserved
      && continuity.activeRuntime.contentPreserved,
    durableActiveWorkspaceIdPreserved: continuity.durableActiveWorkspaceId.preserved,
    allIndexedDbStoreCountsPreserved: continuity.indexedDb.allStoreCountsPreserved,
    allIndexedDbStoreContentPreserved: continuity.indexedDb.allStoreContentPreserved,
    physicalIndexedDbNamePreserved: continuity.indexedDb.physicalNamePreserved,
    importDryRunSafe: importPlan.status === "safe_dry_run"
      && importPlan.importExecuted === false
      && importPlan.conflicts.length === 0,
    noDestructiveDeletion: migrationValidation.checks.destructiveDeletionPerformed === false,
    noImportWrites: importPlan?.safety?.noWritesPerformed === true,
    noCompatibilityBridgeConflicts: (globalThis.__constellationCompatibilityConflicts || []).length === 0
  };
}

function summarizeSourceInventory(inventory) {
  return {
    schema: inventory.schema,
    filesScanned: inventory.filesScanned,
    failedPaths: inventory.failedPaths,
    truncatedAtFileLimit: inventory.truncatedAtFileLimit,
    storageSourceTokens: inventory.storage.sourceTokens,
    databaseSourceNames: inventory.indexedDb.sourceNames,
    brandedEventTokens: inventory.events.brandedTokens,
    semanticContractCandidateCount: inventory.events.semanticContractCandidates.length,
    semanticContractCandidates: inventory.events.semanticContractCandidates,
    packetSchemaTokens: inventory.packets.schemaTokens,
    packetEnvelopeTokens: inventory.packets.envelopeTokens,
    classifications: inventory.classifications
  };
}

function summarizeMigrationValidation(validation) {
  return {
    schema: validation.schema,
    status: validation.status,
    checks: validation.checks,
    secondPassChangedDataIdentities: validation.secondPassChangedDataIdentities,
    firstPass: validation.firstPass.marker,
    secondPass: validation.secondPass.marker,
    afterSecondPass: validation.afterSecondPass
  };
}

function summarizeImportPlan(plan) {
  const storeSummaries = {};
  for (const [storeName, storePlan] of Object.entries(plan.stores || {})) {
    storeSummaries[storeName] = {
      incomingCount: storePlan.incomingCount,
      currentCount: storePlan.currentCount,
      creates: storePlan.creates.length,
      identical: storePlan.identical.length,
      conflicts: storePlan.conflicts.length,
      deletesPlanned: storePlan.deletesPlanned.length
    };
  }

  return {
    schema: plan.schema,
    status: plan.status,
    importExecuted: plan.importExecuted,
    conflicts: plan.conflicts,
    stores: storeSummaries,
    storage: {
      local: summarizeStoragePlan(plan.storage?.local),
      session: summarizeStoragePlan(plan.storage?.session)
    },
    safety: plan.safety
  };
}

function summarizeStoragePlan(plan = {}) {
  return {
    creates: Array.isArray(plan.creates) ? plan.creates.length : 0,
    identical: Array.isArray(plan.identical) ? plan.identical.length : 0,
    conflicts: Array.isArray(plan.conflicts) ? plan.conflicts.length : 0,
    deletesPlanned: Array.isArray(plan.deletesPlanned) ? plan.deletesPlanned.length : 0
  };
}

function formatSummary(packet) {
  return [
    "Status: " + packet.status,
    "Failed checks: " + (packet.failedChecks.length ? packet.failedChecks.join(", ") : "none"),
    "Workspace Library records: " + packet.continuity.workspaceLibrary.afterCount,
    "Session DB stores preserved: " + packet.continuity.indexedDb.allStoreContentPreserved,
    "Migration second pass idempotent: " + packet.checks.migrationSecondPassIdempotent,
    "Export digest valid: " + packet.checks.exportDigestValid,
    "Import dry run safe: " + packet.checks.importDryRunSafe,
    "Source files scanned: " + packet.sourceInventory.filesScanned
  ].join("\n");
}

async function copyJsonArtifact(artifact, successMessage) {
  const status = document.getElementById("layer22cCompatibilityStatus");
  if (!artifact) {
    if (status) status.textContent = "Run Layer 2.2C validation first.";
    return;
  }

  try {
    await navigator.clipboard.writeText(JSON.stringify(artifact, null, 2));
    if (status) status.textContent = successMessage;
  } catch (error) {
    if (status) status.textContent = "Could not copy artifact: " + (error?.message || String(error));
  }
}

function fingerprint(value) {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return "fnv1a32:" + (hash >>> 0).toString(16).padStart(8, "0") + ":" + text.length;
}

function setDisabled(element, disabled) {
  if (element) element.disabled = disabled;
}

function cloneSerializable(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export {
  EXPECTED_WORKSPACE_RECORD_COUNT,
  VALIDATION_SCHEMA
};
