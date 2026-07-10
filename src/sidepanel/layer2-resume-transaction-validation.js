import { getWorkspaceMemoryRecord } from "../core/workspace-memory-store.js";

import {
  VALIDATION_MODE,
  WorkspaceResumeOperationError,
  resumeWorkspaceMemoryRecordSafely
} from "../core/workspace-resume-transaction-engine.js";

import {
  appendRuntimeDiagnostic,
  getActiveWorkspaceRuntime,
  getRuntimeDiagnostics
} from "../core/workspace-runtime-store.js";

import { registerDeveloperSurface } from "./developer-mode.js";

const MAX_DIAGNOSTICS_TO_SCAN = 200;

installLayer2ResumeTransactionValidationSurface();

function installLayer2ResumeTransactionValidationSurface() {
  const anchor = document.getElementById("layer2ProductionSaveValidationPacketSection")
    || document.getElementById("layer2PostResumeVerificationPacketSection")
    || document.getElementById("developerDiagnosticsSection")
    || document.querySelector(".workspace-section");

  if (!anchor || document.getElementById("layer2ResumeTransactionValidationSection")) return;

  const section = document.createElement("section");
  section.id = "layer2ResumeTransactionValidationSection";
  section.className = "layer2-resume-transaction-validation-section";
  section.innerHTML = `
    <h2>Layer 2.1E Resume Transaction Safety</h2>
    <p class="section-help">Developer-only controlled validation for duplicate-resume blocking and rollback before active-runtime commit. The rollback test temporarily opens one saved tab and then removes it automatically.</p>
    <div class="workspace-session-actions">
      <button id="runLayer2ResumeDuplicateGuardTestButton" type="button" class="secondary-button">Run Duplicate Guard Test</button>
      <button id="runLayer2ResumeRollbackTestButton" type="button" class="secondary-button">Run Controlled Rollback Test</button>
      <button id="prepareLayer2ResumeTransactionPacketButton" type="button" class="secondary-button">Prepare Resume Safety Packet</button>
      <button id="copyLayer2ResumeTransactionPacketButton" type="button" class="secondary-button" disabled>Copy Resume Safety Packet</button>
    </div>
    <p id="layer2ResumeTransactionValidationStatus" class="status-message">Select a saved workspace in Workspace Library before running the controlled tests.</p>
    <pre id="layer2ResumeTransactionValidationOutput" class="diagnostic-output"></pre>
  `;

  anchor.insertAdjacentElement("afterend", section);
  registerDeveloperSurface(section);

  document.getElementById("runLayer2ResumeDuplicateGuardTestButton")?.addEventListener("click", runDuplicateGuardTest);
  document.getElementById("runLayer2ResumeRollbackTestButton")?.addEventListener("click", runControlledRollbackTest);
  document.getElementById("prepareLayer2ResumeTransactionPacketButton")?.addEventListener("click", prepareResumeTransactionPacket);
  document.getElementById("copyLayer2ResumeTransactionPacketButton")?.addEventListener("click", copyResumeTransactionPacket);
}

async function runDuplicateGuardTest() {
  const workspaceId = getSelectedWorkspaceId();

  if (!workspaceId) {
    setStatus("Select a saved workspace in Workspace Library first.");
    return;
  }

  const record = await getWorkspaceMemoryRecord(workspaceId);
  if (!record) {
    setStatus("Selected saved workspace could not be loaded.");
    return;
  }

  setTestButtonsDisabled(true);
  setStatus("Running duplicate guard test. No browser tab should be opened.");

  try {
    const firstOperation = resumeWorkspaceMemoryRecordSafely(record, {
      source: "layer2_1e_duplicate_guard_primary",
      validationMode: VALIDATION_MODE,
      bypassAlreadyActiveGuard: true,
      testHoldBeforeBrowserMutationMs: 900,
      testFailureBeforeBrowserMutation: true
    }).catch((error) => error);

    await delay(120);

    const secondOperation = resumeWorkspaceMemoryRecordSafely(record, {
      source: "layer2_1e_duplicate_guard_secondary",
      validationMode: VALIDATION_MODE,
      bypassAlreadyActiveGuard: true,
      testFailureBeforeBrowserMutation: true
    }).catch((error) => error);

    const [firstResult, secondResult] = await Promise.all([
      firstOperation,
      secondOperation
    ]);

    const firstControlled = firstResult instanceof WorkspaceResumeOperationError
      && firstResult.code === "resume_controlled_validation_failure";
    const secondBlocked = secondResult instanceof WorkspaceResumeOperationError
      && secondResult.code === "resume_operation_in_progress";

    await appendRuntimeDiagnostic(
      firstControlled && secondBlocked ? "info" : "error",
      "layer2_resume_duplicate_guard_test_completed",
      "Layer 2.1E duplicate resume guard test completed.",
      {
        workspaceId,
        firstOperationControlledFailure: firstControlled,
        secondOperationBlocked: secondBlocked,
        firstOperationCode: firstResult?.code || "",
        secondOperationCode: secondResult?.code || "",
        passed: firstControlled && secondBlocked
      }
    );

    setStatus(firstControlled && secondBlocked
      ? "Duplicate guard test passed. Second resume was blocked before browser mutation."
      : "Duplicate guard test needs attention. Prepare the packet and inspect diagnostics.");
  } finally {
    setTestButtonsDisabled(false);
  }
}

async function runControlledRollbackTest() {
  const workspaceId = getSelectedWorkspaceId();

  if (!workspaceId) {
    setStatus("Select a saved workspace in Workspace Library first.");
    return;
  }

  const record = await getWorkspaceMemoryRecord(workspaceId);
  if (!record) {
    setStatus("Selected saved workspace could not be loaded.");
    return;
  }

  const activeBefore = await getActiveWorkspaceRuntime();
  setTestButtonsDisabled(true);
  setStatus("Running controlled rollback test. One provisional tab may appear briefly and must be removed automatically.");

  try {
    let result = null;

    try {
      await resumeWorkspaceMemoryRecordSafely(record, {
        source: "layer2_1e_controlled_rollback",
        validationMode: VALIDATION_MODE,
        bypassAlreadyActiveGuard: true,
        testFailureAfterOpenedTabCount: 1
      });
    } catch (error) {
      result = error;
    }

    const activeAfter = await getActiveWorkspaceRuntime();
    const rollback = result?.details?.rollback || null;
    const controlledFailure = result instanceof WorkspaceResumeOperationError
      && result.code === "resume_controlled_validation_failure";
    const runtimePreserved = activeAfter?.workspaceId === activeBefore?.workspaceId;
    const passed = controlledFailure
      && rollback?.complete === true
      && rollback.createdTabIds?.length === 1
      && rollback.remainingTabIds?.length === 0
      && runtimePreserved;

    await appendRuntimeDiagnostic(
      passed ? "info" : "error",
      "layer2_resume_controlled_rollback_test_completed",
      "Layer 2.1E controlled resume rollback test completed.",
      {
        workspaceId,
        controlledFailure,
        runtimeBeforeWorkspaceId: activeBefore?.workspaceId || "",
        runtimeAfterWorkspaceId: activeAfter?.workspaceId || "",
        runtimePreserved,
        rollback,
        passed
      }
    );

    setStatus(passed
      ? "Controlled rollback test passed. Provisional browser changes were removed and active runtime was preserved."
      : "Controlled rollback test needs attention. Do not run a normal resume until the packet is inspected.");
  } finally {
    setTestButtonsDisabled(false);
  }
}

async function prepareResumeTransactionPacket() {
  const packet = await buildResumeTransactionPacket();
  const output = document.getElementById("layer2ResumeTransactionValidationOutput");
  const copyButton = document.getElementById("copyLayer2ResumeTransactionPacketButton");

  if (output) output.textContent = JSON.stringify(packet, null, 2);
  if (copyButton) copyButton.disabled = false;
  setStatus("Resume safety packet prepared: " + packet.validation.status + ".");

  await appendRuntimeDiagnostic("info", "layer2_resume_transaction_validation_packet_prepared", "Layer 2.1E resume transaction validation packet prepared.", {
    schema: packet.extension.schema,
    status: packet.validation.status,
    passedCheckCount: packet.validation.passedCheckCount,
    failedCheckCount: packet.validation.failedCheckCount,
    warningCheckCount: packet.validation.warningCheckCount
  });
}

async function copyResumeTransactionPacket() {
  const output = document.getElementById("layer2ResumeTransactionValidationOutput");

  if (!output?.textContent?.trim()) {
    setStatus("Prepare the resume safety packet before copying.");
    return;
  }

  await navigator.clipboard.writeText(buildClipboardEnvelope(output.textContent));
  setStatus("Resume safety packet copied.");
}

async function buildResumeTransactionPacket() {
  const diagnostics = (await getRuntimeDiagnostics()).slice(-MAX_DIAGNOSTICS_TO_SCAN);
  const activeRuntime = await getActiveWorkspaceRuntime();
  const duplicateTest = findLatestDiagnostic(diagnostics, "layer2_resume_duplicate_guard_test_completed");
  const rollbackTest = findLatestDiagnostic(diagnostics, "layer2_resume_controlled_rollback_test_completed");
  const blockedOperation = findLatestDiagnostic(diagnostics, "workspace_resume_operation_blocked");
  const rolledBackOperation = findLatestDiagnosticMatching(
    diagnostics,
    "workspace_resume_operation_rolled_back",
    (diagnostic) => diagnostic?.details?.error?.details?.stage === "after_opened_tab_1"
  );
  const incompleteRollback = findLatestDiagnostic(diagnostics, "workspace_resume_operation_rollback_incomplete");
  const committedOperation = findLatestDiagnostic(diagnostics, "workspace_resume_operation_committed");
  const transactionalResume = findLatestDiagnosticMatching(
    diagnostics,
    "workspace_library_resume_executed",
    (diagnostic) => diagnostic?.details?.transactionalResume === true
  );
  const checks = buildChecks({
    duplicateTest,
    rollbackTest,
    blockedOperation,
    rolledBackOperation,
    incompleteRollback,
    committedOperation,
    transactionalResume
  });
  const failedChecks = checks.filter((check) => check.status === "fail");
  const warningChecks = checks.filter((check) => check.status === "warn");
  const passedChecks = checks.filter((check) => check.status === "pass");

  return {
    packetType: "Chrome Flow Layer 2.1E Resume Transaction Safety Validation Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "layer2-resume-transaction-validation-packet-v0.1"
    },
    source: {
      type: "layer2_resume_transaction_safety_validation",
      developerOnly: true,
      controlledBrowserMutationTest: true,
      activeRuntimeAuthority: "chrome.storage.local"
    },
    validation: {
      status: failedChecks.length
        ? "needs_attention"
        : warningChecks.length
          ? "controlled_safety_validated_normal_commit_pending"
          : "resume_transaction_safety_validated",
      passedCheckCount: passedChecks.length,
      warningCheckCount: warningChecks.length,
      failedCheckCount: failedChecks.length,
      checkCount: checks.length,
      checks,
      failedChecks,
      warningChecks
    },
    activeRuntime: {
      workspaceId: activeRuntime?.workspaceId || "",
      name: activeRuntime?.name || "Untitled Workspace",
      tabCount: Array.isArray(activeRuntime?.tabs) ? activeRuntime.tabs.length : 0,
      resumeOperationId: activeRuntime?.resumeOperationId || ""
    },
    evidence: {
      duplicateTest: summarizeDiagnostic(duplicateTest),
      rollbackTest: summarizeDiagnostic(rollbackTest),
      blockedOperation: summarizeDiagnostic(blockedOperation),
      rolledBackOperation: summarizeDiagnostic(rolledBackOperation),
      incompleteRollback: summarizeDiagnostic(incompleteRollback),
      committedOperation: summarizeDiagnostic(committedOperation),
      transactionalResume: summarizeDiagnostic(transactionalResume)
    },
    nextDecision: {
      recommendation: failedChecks.length
        ? "repair_resume_transaction_safety"
        : committedOperation && transactionalResume
          ? "accept_layer2_1e_and_proceed_to_archive_close_ownership_revalidation"
          : "run_one_normal_transactional_resume_then_prepare_packet_again",
      notes: [
        "Duplicate and rollback tests are controlled Developer Mode tests.",
        "A complete Layer 2.1E acceptance packet also requires one successful normal resume through the transactional controller.",
        "Rollback must remove all provisional browser resources and preserve the previous active runtime workspace."
      ]
    }
  };
}

function buildChecks(evidence) {
  const rollback = evidence.rollbackTest?.details?.rollback || {};
  const committedAvailable = Boolean(evidence.committedOperation);
  const transactionalAvailable = Boolean(evidence.transactionalResume);

  return [
    createCheck("duplicate_guard_test_passed", evidence.duplicateTest?.details?.passed === true, "Controlled duplicate resume guard test passed."),
    createCheck("duplicate_operation_blocked", evidence.blockedOperation?.details?.reason === "local_resume_operation_in_progress" || evidence.blockedOperation?.details?.reason === "cross_context_resume_lock_unavailable", "Second concurrent resume operation was blocked before browser mutation."),
    createCheck("controlled_rollback_test_passed", evidence.rollbackTest?.details?.passed === true, "Controlled rollback test passed."),
    createCheck("one_provisional_tab_created", Array.isArray(rollback.createdTabIds) && rollback.createdTabIds.length === 1, "Controlled rollback created exactly one provisional tab."),
    createCheck("provisional_tabs_removed", Array.isArray(rollback.remainingTabIds) && rollback.remainingTabIds.length === 0, "No provisional tabs remain after rollback."),
    createCheck("previous_runtime_preserved", rollback.runtimePreserved === true, "Previous active runtime workspace was preserved."),
    createCheck("rollback_completed", rollback.complete === true, "Rollback completed successfully."),
    createCheck("no_incomplete_rollback_observed", !evidence.incompleteRollback || new Date(evidence.incompleteRollback.createdAt) < new Date(evidence.rolledBackOperation?.createdAt || 0), "No unresolved incomplete rollback exists after the latest successful controlled rollback."),
    createCheck("normal_transactional_resume_committed", committedAvailable, "A normal transactional resume committed successfully.", committedAvailable ? "layer2_1e_resume_safety" : "warning"),
    createCheck("compatibility_resume_evidence_transactional", transactionalAvailable, "Compatibility resume evidence confirms transactional execution.", transactionalAvailable ? "layer2_1e_resume_safety" : "warning")
  ];
}

function createCheck(check, condition, message, severity = "layer2_1e_resume_safety") {
  if (severity === "warning" && !condition) {
    return { check, status: "warn", severity, message };
  }

  return {
    check,
    status: condition ? "pass" : "fail",
    severity,
    message
  };
}

function findLatestDiagnostic(diagnostics, action) {
  return [...diagnostics].reverse().find((diagnostic) => diagnostic?.action === action) || null;
}

function findLatestDiagnosticMatching(diagnostics, action, predicate) {
  return [...diagnostics].reverse().find((diagnostic) =>
    diagnostic?.action === action && predicate(diagnostic)
  ) || null;
}

function summarizeDiagnostic(diagnostic) {
  if (!diagnostic) return null;

  return {
    createdAt: diagnostic.createdAt || "",
    level: diagnostic.level || "",
    action: diagnostic.action || "",
    message: diagnostic.message || "",
    details: diagnostic.details || {}
  };
}

function getSelectedWorkspaceId() {
  return document.getElementById("savedWorkspaceSelect")?.value || "";
}

function setTestButtonsDisabled(disabled) {
  document.getElementById("runLayer2ResumeDuplicateGuardTestButton")?.toggleAttribute("disabled", disabled);
  document.getElementById("runLayer2ResumeRollbackTestButton")?.toggleAttribute("disabled", disabled);
}

function setStatus(message) {
  const status = document.getElementById("layer2ResumeTransactionValidationStatus");
  if (status) status.textContent = message;
}

function buildClipboardEnvelope(jsonText) {
  return [
    "CHROME_FLOW_PACKET_START",
    "packetType: Chrome Flow Layer 2.1E Resume Transaction Safety Validation Packet",
    "schema: layer2-resume-transaction-validation-packet-v0.1",
    "clipboardFormat: chrome_flow_packet_envelope_v0.1",
    "createdAt: " + new Date().toISOString(),
    "contentType: application/json",
    "",
    jsonText,
    "",
    "CHROME_FLOW_PACKET_END"
  ].join("\n");
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
