import {
  createConstellationDataMigrationPackage
} from "../core/constellation-data-portability.js";

import {
  IMPORT_AUTHORIZATION_PHRASE,
  executeConstellationDataImport,
  prepareConstellationDataImport
} from "../core/constellation-data-import-executor.js";

import {
  SESSION_DB_SCHEMA
} from "../core/session-db.js";

const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;

let selectedPackage = null;
let selectedPackageSource = "";
let lastPreparation = null;
let lastInspectionPacket = null;
let lastExecutionPacket = null;

const elements = {
  destinationSummary: document.getElementById("destinationSummary"),
  migrationPackageFile: document.getElementById("migrationPackageFile"),
  inspectButton: document.getElementById("inspectMigrationPackageButton"),
  prepareNoopButton: document.getElementById("prepareCurrentStateNoopButton"),
  copyInspectionButton: document.getElementById("copyImportInspectionButton"),
  inspectionStatus: document.getElementById("inspectionStatus"),
  inspectionSummary: document.getElementById("inspectionSummary"),
  acknowledgement: document.getElementById("importAcknowledgement"),
  authorizationPhrase: document.getElementById("importAuthorizationPhrase"),
  executeButton: document.getElementById("executeMigrationImportButton"),
  copyExecutionButton: document.getElementById("copyImportExecutionButton"),
  executionStatus: document.getElementById("executionStatus"),
  executionSummary: document.getElementById("executionSummary")
};

initializeMigrationRecoveryPage();

function initializeMigrationRecoveryPage() {
  renderDestinationIdentity();
  bindControls();
  updateExecutionControls();
}

function renderDestinationIdentity() {
  const manifest = chrome.runtime.getManifest();
  elements.destinationSummary.textContent = JSON.stringify({
    productName: manifest?.name || "Constellation",
    manifestVersion: manifest?.version || "",
    destinationExtensionId: chrome.runtime.id,
    physicalIndexedDbName: SESSION_DB_SCHEMA.dbName,
    recoveryPage: chrome.runtime.getURL("src/migration/migration.html")
  }, null, 2);
}

function bindControls() {
  elements.migrationPackageFile?.addEventListener("change", () => {
    resetInspectionState();
    const file = elements.migrationPackageFile.files?.[0] || null;
    elements.inspectButton.disabled = !file;
    if (file) {
      elements.inspectionStatus.textContent = "Selected " + file.name + ". Inspection has not run.";
    }
  });

  elements.inspectButton?.addEventListener("click", () => {
    void inspectSelectedFile();
  });

  elements.prepareNoopButton?.addEventListener("click", () => {
    void prepareCurrentStateNoopTest();
  });

  elements.copyInspectionButton?.addEventListener("click", () => {
    void copyJsonArtifact(lastInspectionPacket, "Import inspection packet copied.");
  });

  elements.acknowledgement?.addEventListener("change", updateExecutionControls);
  elements.authorizationPhrase?.addEventListener("input", updateExecutionControls);

  elements.executeButton?.addEventListener("click", () => {
    void executePreparedImport();
  });

  elements.copyExecutionButton?.addEventListener("click", () => {
    void copyJsonArtifact(lastExecutionPacket, "Import execution packet copied.");
  });
}

async function inspectSelectedFile() {
  const file = elements.migrationPackageFile.files?.[0] || null;
  if (!file) return;

  resetInspectionState({ preserveFileStatus: true });
  elements.inspectButton.disabled = true;
  elements.inspectionStatus.textContent = "Reading and validating the selected package locally…";

  try {
    if (file.size > MAX_PACKAGE_BYTES) {
      throw new Error("The selected file exceeds the 64 MiB recovery-page limit.");
    }

    const text = await file.text();
    const parsed = JSON.parse(text);
    await inspectPackage(parsed, "selected_file:" + file.name);
  } catch (error) {
    selectedPackage = null;
    selectedPackageSource = "";
    lastPreparation = null;
    lastInspectionPacket = null;
    elements.inspectionStatus.textContent = "Package inspection failed.";
    elements.inspectionSummary.textContent = JSON.stringify(serializeError(error), null, 2);
    updateExecutionControls();
  } finally {
    elements.inspectButton.disabled = !(elements.migrationPackageFile.files?.[0]);
  }
}

async function prepareCurrentStateNoopTest() {
  resetInspectionState();
  elements.prepareNoopButton.disabled = true;
  elements.inspectionStatus.textContent = "Creating a current-state package for a no-op executor test…";

  try {
    const currentPackage = await createConstellationDataMigrationPackage();
    await inspectPackage(currentPackage, "current_state_noop_test");
  } catch (error) {
    elements.inspectionStatus.textContent = "Current-state no-op preparation failed.";
    elements.inspectionSummary.textContent = JSON.stringify(serializeError(error), null, 2);
  } finally {
    elements.prepareNoopButton.disabled = false;
  }
}

async function inspectPackage(dataPackage, source) {
  const preparation = await prepareConstellationDataImport(dataPackage);
  selectedPackage = dataPackage;
  selectedPackageSource = source;
  lastPreparation = preparation;
  lastInspectionPacket = buildInspectionPacket(dataPackage, source, preparation);

  elements.copyInspectionButton.disabled = false;
  elements.inspectionStatus.textContent = preparation.executionEligible
    ? "Package is valid and the fresh dry-run plan contains no conflicts."
    : "Package inspection completed, but execution is blocked.";
  elements.inspectionSummary.textContent = formatInspectionSummary(lastInspectionPacket);
  updateExecutionControls();
}

async function executePreparedImport() {
  if (!selectedPackage || !lastPreparation?.executionEligible) return;

  const counts = lastPreparation.counts;
  const confirmation = [
    "Execute Constellation transactional import?",
    "",
    "IndexedDB creates: " + counts.indexedDbCreates,
    "Local storage creates: " + counts.localStorageCreates,
    "Session storage creates: " + counts.sessionStorageCreates,
    "Conflicts: " + totalConflicts(counts),
    "Deletes planned: " + counts.deletesPlanned,
    "",
    "Existing records and keys must not be overwritten or deleted."
  ].join("\n");

  if (!window.confirm(confirmation)) {
    elements.executionStatus.textContent = "Import execution cancelled by the Operator.";
    return;
  }

  setExecutionBusy(true);
  elements.executionStatus.textContent = "Executing import under the exclusive recovery lock…";
  elements.executionSummary.textContent = "";

  try {
    lastExecutionPacket = await executeConstellationDataImport(selectedPackage, {
      operatorAuthorized: elements.acknowledgement.checked,
      phrase: elements.authorizationPhrase.value
    });

    elements.copyExecutionButton.disabled = false;
    elements.executionStatus.textContent = executionStatusMessage(lastExecutionPacket.status);
    elements.executionSummary.textContent = formatExecutionSummary(lastExecutionPacket);
  } catch (error) {
    lastExecutionPacket = null;
    elements.executionStatus.textContent = "Import execution failed before a structured result was returned.";
    elements.executionSummary.textContent = JSON.stringify(serializeError(error), null, 2);
  } finally {
    setExecutionBusy(false);
    updateExecutionControls();
  }
}

function buildInspectionPacket(dataPackage, source, preparation) {
  return {
    packetType: "Constellation Data Import Inspection Packet",
    schema: "constellation-data-import-inspection-v0.1",
    createdAt: new Date().toISOString(),
    source,
    sourceExtensionId: String(dataPackage?.sourceExtensionId || ""),
    destinationExtensionId: chrome.runtime.id,
    sourcePhysicalDatabaseName: String(dataPackage?.sourcePhysicalDatabaseName || ""),
    destinationPhysicalDatabaseName: SESSION_DB_SCHEMA.dbName,
    packageSchema: String(dataPackage?.schema || ""),
    packageCreatedAt: String(dataPackage?.createdAt || ""),
    incomingPayloadDigest: String(dataPackage?.integrity?.payloadDigest || ""),
    packageValidation: preparation.packageValidation,
    plan: summarizePlan(preparation.plan),
    counts: preparation.counts,
    executionEligible: preparation.executionEligible,
    safety: {
      inspectionPerformedLocally: true,
      networkRequestPerformed: false,
      writesPerformed: false,
      deletesPlanned: preparation.counts.deletesPlanned,
      executionPolicy: preparation.executionPolicy
    }
  };
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
    conflicts: plan.conflicts || [],
    safety: plan.safety || {}
  };
}

function formatInspectionSummary(packet) {
  return [
    "Status: " + (packet.executionEligible ? "eligible" : "blocked"),
    "Source: " + packet.source,
    "Package schema: " + packet.packageSchema,
    "Package valid: " + String(packet.packageValidation?.valid === true),
    "Digest valid: " + String(packet.packageValidation?.expectedDigest === packet.packageValidation?.actualDigest),
    "Plan status: " + String(packet.plan?.status || "not_available"),
    "Source extension ID: " + packet.sourceExtensionId,
    "Destination extension ID: " + packet.destinationExtensionId,
    "IndexedDB creates: " + packet.counts.indexedDbCreates,
    "IndexedDB identical: " + packet.counts.indexedDbIdentical,
    "IndexedDB conflicts: " + packet.counts.indexedDbConflicts,
    "Local storage creates: " + packet.counts.localStorageCreates,
    "Local storage identical: " + packet.counts.localStorageIdentical,
    "Local storage conflicts: " + packet.counts.localStorageConflicts,
    "Session storage creates: " + packet.counts.sessionStorageCreates,
    "Session storage identical: " + packet.counts.sessionStorageIdentical,
    "Session storage conflicts: " + packet.counts.sessionStorageConflicts,
    "Deletes planned: " + packet.counts.deletesPlanned
  ].join("\n");
}

function formatExecutionSummary(packet) {
  return [
    "Status: " + packet.status,
    "Execution ID: " + packet.executionId,
    "Source extension ID: " + packet.sourceExtensionId,
    "Destination extension ID: " + packet.destinationExtensionId,
    "Import executed: " + String(packet.importExecuted),
    "IndexedDB created: " + String(packet.writes?.indexedDb?.created?.length || 0),
    "Local storage created: " + String(packet.writes?.storage?.local?.created?.length || 0),
    "Session storage created: " + String(packet.writes?.storage?.session?.created?.length || 0),
    "Verification status: " + String(packet.verification?.status || "not_run"),
    "Rollback status: " + (packet.rollback ? String(packet.rollback.complete) : "not_required"),
    "Browser mutation performed: " + String(packet.safety?.browserMutationPerformed),
    "Physical IndexedDB renamed: " + String(packet.safety?.physicalIndexedDbRenamed),
    "Existing record overwrite performed: " + String(packet.safety?.existingRecordOverwritePerformed),
    "Existing storage overwrite performed: " + String(packet.safety?.existingStorageOverwritePerformed)
  ].join("\n");
}

function executionStatusMessage(status) {
  const messages = {
    verified_noop: "No-op import verification passed; current state already contains the complete package.",
    committed_and_verified: "Transactional import committed and post-import verification passed.",
    rolled_back_after_failure: "Import encountered a failure and all newly created data was rolled back.",
    rollback_incomplete: "Import failed and rollback requires attention. Copy the execution packet.",
    blocked_operator_authorization: "Import blocked because Operator authorization was incomplete.",
    blocked_invalid_package: "Import blocked because package validation failed.",
    blocked_conflicts_require_review: "Import blocked because the dry-run plan contains conflicts.",
    blocked_state_changed_before_import: "Import blocked because destination state changed before execution.",
    blocked_import_in_progress: "Import blocked because another import holds the exclusive lock.",
    verification_failed_noop: "No-op verification failed; copy the execution packet for review."
  };
  return messages[status] || "Import completed with status: " + status + ".";
}

function updateExecutionControls() {
  const eligible = Boolean(selectedPackage && lastPreparation?.executionEligible);
  const acknowledgement = elements.acknowledgement?.checked === true;
  const phraseMatches = elements.authorizationPhrase?.value === IMPORT_AUTHORIZATION_PHRASE;

  elements.acknowledgement.disabled = !eligible;
  elements.authorizationPhrase.disabled = !eligible;
  elements.executeButton.disabled = !(eligible && acknowledgement && phraseMatches);
}

function setExecutionBusy(busy) {
  elements.executeButton.disabled = busy;
  elements.inspectButton.disabled = busy || !(elements.migrationPackageFile.files?.[0]);
  elements.prepareNoopButton.disabled = busy;
  elements.migrationPackageFile.disabled = busy;
  elements.acknowledgement.disabled = busy || !lastPreparation?.executionEligible;
  elements.authorizationPhrase.disabled = busy || !lastPreparation?.executionEligible;
}

function resetInspectionState(options = {}) {
  selectedPackage = null;
  selectedPackageSource = "";
  lastPreparation = null;
  lastInspectionPacket = null;
  lastExecutionPacket = null;

  elements.copyInspectionButton.disabled = true;
  elements.copyExecutionButton.disabled = true;
  elements.acknowledgement.checked = false;
  elements.acknowledgement.disabled = true;
  elements.authorizationPhrase.value = "";
  elements.authorizationPhrase.disabled = true;
  elements.executeButton.disabled = true;
  elements.executionStatus.textContent = "";
  elements.executionSummary.textContent = "No import execution attempted.";
  elements.inspectionSummary.textContent = "No package inspected.";
  if (!options.preserveFileStatus) elements.inspectionStatus.textContent = "";
}

function totalConflicts(counts) {
  return counts.indexedDbConflicts
    + counts.localStorageConflicts
    + counts.sessionStorageConflicts;
}

async function copyJsonArtifact(value, successMessage) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
    elements.executionStatus.textContent = successMessage;
  } catch (error) {
    elements.executionStatus.textContent = "Could not copy artifact: " + (error?.message || String(error));
  }
}

function serializeError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
    stack: typeof error?.stack === "string" ? error.stack.slice(0, 2000) : ""
  };
}
