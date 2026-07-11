import {
  runLayer22dControlledImportValidation
} from "./layer2-2d-import-validation.js";

let lastValidationPacket = null;

const runButton = document.getElementById("runControlledImportValidationButton");
const copyButton = document.getElementById("copyControlledImportValidationButton");
const status = document.getElementById("controlledValidationStatus");
const summary = document.getElementById("controlledValidationSummary");

runButton?.addEventListener("click", () => {
  void runControlledValidation();
});

copyButton?.addEventListener("click", () => {
  void copyValidationPacket();
});

async function runControlledValidation() {
  const confirmed = window.confirm([
    "Run Layer 2.2D controlled import validation?",
    "",
    "The harness will create uniquely identified disposable extension data, verify it, remove it, force one controlled import failure, and verify rollback.",
    "",
    "It will not read or modify the saved production migration backup and will not mutate browser tabs or windows."
  ].join("\n"));
  if (!confirmed) {
    if (status) status.textContent = "Controlled validation cancelled by the Operator.";
    return;
  }

  runButton.disabled = true;
  copyButton.disabled = true;
  if (status) status.textContent = "Running controlled create, cleanup, failure, and rollback validation…";
  if (summary) summary.textContent = "";

  try {
    lastValidationPacket = await runLayer22dControlledImportValidation();
    copyButton.disabled = false;
    if (status) {
      status.textContent = lastValidationPacket.status === "validated"
        ? "Layer 2.2D controlled import validation passed."
        : "Layer 2.2D controlled import validation needs attention.";
    }
    if (summary) summary.textContent = formatSummary(lastValidationPacket);
  } catch (error) {
    lastValidationPacket = null;
    if (status) status.textContent = "Controlled validation failed before a packet was produced.";
    if (summary) summary.textContent = JSON.stringify(serializeError(error), null, 2);
  } finally {
    runButton.disabled = false;
  }
}

async function copyValidationPacket() {
  if (!lastValidationPacket) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(lastValidationPacket, null, 2));
    if (status) status.textContent = "Layer 2.2D controlled validation packet copied.";
  } catch (error) {
    if (status) status.textContent = "Could not copy validation packet: " + (error?.message || String(error));
  }
}

function formatSummary(packet) {
  return [
    "Status: " + packet.status,
    "Failed checks: " + (packet.failedChecks.length ? packet.failedChecks.join(", ") : "none"),
    "Invalid digest rejected: " + packet.checks.invalidDigestRejected,
    "Conflict rejected before writes: " + packet.checks.conflictRejectedBeforeWrites,
    "Missing authorization rejected: " + packet.checks.missingAuthorizationRejected,
    "Identical package verified no-op: " + packet.checks.identicalPackageVerifiedNoop,
    "Disposable create committed: " + packet.checks.disposableCreateCommitted,
    "Disposable create verified: " + packet.checks.disposableCreateVerified,
    "Disposable cleanup complete: " + packet.checks.disposableCreateCleanupComplete,
    "Controlled failure rolled back: " + packet.checks.controlledFailureRolledBack,
    "Rollback fixture absent: " + packet.checks.rollbackFixtureAbsent,
    "Baseline IndexedDB restored: " + packet.checks.baselineIndexedDbRestored,
    "Baseline storage restored: " + packet.checks.baselineStorageRestored,
    "Browser projection preserved: " + packet.checks.browserProjectionPreserved,
    "Physical IndexedDB preserved: " + packet.checks.physicalIndexedDbPreserved
  ].join("\n");
}

function serializeError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
    stack: typeof error?.stack === "string" ? error.stack.slice(0, 2000) : ""
  };
}
