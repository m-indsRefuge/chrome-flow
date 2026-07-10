import { getRuntimeDiagnostics } from "../core/workspace-runtime-store.js";

const EVIDENCE_KEY = "chromeFlowLayer21HRegressionEvidence";
const PACKET_SCHEMA = "layer2-hardening-regression-packet-v0.3";
const PREPARE_BUTTON_ID = "prepareLayer2HardeningRegressionPacketButton";
const COPY_BUTTON_ID = "copyLayer2HardeningRegressionPacketButton";

document.addEventListener("click", interceptHardeningPacketAction, true);

function interceptHardeningPacketAction(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const button = target.closest("button");
  if (!button) return;

  if (button.id === PREPARE_BUTTON_ID) {
    event.preventDefault();
    event.stopImmediatePropagation();
    void prepareCorrelationCompletePacket();
    return;
  }

  if (button.id === COPY_BUTTON_ID) {
    event.preventDefault();
    event.stopImmediatePropagation();
    void copyCorrelationCompletePacket();
  }
}

async function prepareCorrelationCompletePacket() {
  try {
    const [stored, diagnostics] = await Promise.all([
      chrome.storage.local.get(EVIDENCE_KEY),
      getRuntimeDiagnostics()
    ]);
    const evidence = stored[EVIDENCE_KEY] || null;
    const packet = buildCorrelationCompletePacket(evidence, diagnostics);
    const output = document.getElementById("layer2HardeningRegressionHarnessOutput");
    const copyButton = document.getElementById(COPY_BUTTON_ID);

    if (output) output.textContent = JSON.stringify(packet, null, 2);
    if (copyButton) copyButton.disabled = false;
    setStatus("Hardening correlation packet prepared: " + packet.validation.status + ".");
  } catch (error) {
    const copyButton = document.getElementById(COPY_BUTTON_ID);
    if (copyButton) copyButton.disabled = true;
    setStatus("Could not prepare the hardening correlation packet. Inspect Developer Diagnostics.");
    console.warn("Chrome Flow hardening correlation packet failed:", error);
  }
}

async function copyCorrelationCompletePacket() {
  try {
    const output = document.getElementById("layer2HardeningRegressionHarnessOutput");
    if (!output?.textContent?.trim()) {
      setStatus("Prepare the hardening correlation packet before copying.");
      return;
    }

    await navigator.clipboard.writeText(buildClipboardEnvelope(output.textContent));
    setStatus("Hardening correlation packet copied.");
  } catch (error) {
    setStatus("Could not copy the hardening correlation packet.");
    console.warn("Chrome Flow hardening correlation packet copy failed:", error);
  }
}

function buildCorrelationCompletePacket(evidence, diagnostics) {
  const cases = Array.isArray(evidence?.cases) ? evidence.cases : [];
  const byId = new Map(cases.map((testCase) => [testCase.caseId, testCase]));
  const operationIds = cases.map((testCase) => testCase.operationId).filter(Boolean);
  const blockedEvent = findCurrentRunBlockedEvent(evidence, diagnostics);
  const blockedEventRunCorrelated = Boolean(
    blockedEvent
    && evidence?.regressionRunId
    && blockedEvent.correlationId === evidence.regressionRunId
    && blockedEvent?.details?.regressionRunId === evidence.regressionRunId
  );
  const correlationResolutionRecorded = Boolean(
    blockedEventRunCorrelated
    && blockedEvent?.details?.correlationResolution === "inferred_from_active_layer2_1h_regression_run"
    && blockedEvent?.details?.correlationEvidenceDiagnosticId
  );
  const checks = [
    createCheck("dedicated_regression_evidence_exists", Boolean(evidence?.regressionRunId), "Dedicated correlated regression evidence exists."),
    createCheck("diagnostic_concurrency_passed", byId.get("diagnostic_concurrency")?.passed === true, "Concurrent correlated diagnostic writes were preserved."),
    createCheck("exact_snapshot_replacement_passed", byId.get("exact_snapshot_replacement")?.passed === true, "Exact Session DB snapshot replacement regression passed."),
    createCheck("temporary_snapshot_workspace_removed", byId.get("exact_snapshot_replacement")?.cleanup?.complete === true, "Temporary Session DB regression workspace was removed."),
    createCheck("resume_duplicate_and_rollback_passed", byId.get("resume_duplicate_and_rollback")?.passed === true, "Resume duplicate guard and controlled rollback regression passed."),
    createCheck("resume_provisional_resources_removed", byId.get("resume_duplicate_and_rollback")?.cleanup?.complete === true, "Resume provisional browser resources were removed."),
    createCheck("resume_blocked_event_run_correlated", blockedEventRunCorrelated, "The low-level blocked-resume diagnostic carries the current regression-run correlation."),
    createCheck("resume_blocked_correlation_resolution_recorded", correlationResolutionRecorded, "The blocked-resume diagnostic records how its regression correlation was resolved."),
    createCheck("archive_stale_id_rejection_passed", byId.get("archive_stale_id_rejection")?.passed === true, "Archive stale-ID ownership rejection regression passed."),
    createCheck("archive_test_tab_removed", byId.get("archive_stale_id_rejection")?.cleanup?.complete === true, "Archive ownership test tab was removed by the harness."),
    createCheck("legacy_projection_cleanup_passed", byId.get("legacy_projection_cleanup")?.passed === true, "Legacy projection cleanup regression passed."),
    createCheck("active_runtime_preserved", evidence?.runtimeIntegrity?.preserved === true, "Active runtime remained byte-for-byte unchanged across the suite."),
    createCheck("case_operation_ids_present", operationIds.length === cases.length && operationIds.every(Boolean), "Every regression case has a stable operation ID."),
    createCheck("case_operation_ids_unique", new Set(operationIds).size === operationIds.length, "Regression case operation IDs are unique."),
    createCheck("suite_passed", evidence?.passed === true, "The complete correlated hardening regression suite passed.")
  ];
  const failedChecks = checks.filter((check) => check.status === "fail");
  const passedChecks = checks.filter((check) => check.status === "pass");

  return {
    packetType: "Chrome Flow Layer 2.1H Validation Correlation and Regression Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: PACKET_SCHEMA
    },
    source: {
      type: "layer2_hardening_regression_packet",
      developerOnly: true,
      evidenceAuthority: "dedicated local regression evidence plus current-run low-level diagnostic correlation",
      diagnosticRingAuthority: false,
      activeRuntimeAuthority: "chrome.storage.local",
      longTermMemoryAuthority: "Session DB / IndexedDB"
    },
    validation: {
      status: failedChecks.length ? "needs_attention" : "layer2_hardening_correlation_validated",
      passedCheckCount: passedChecks.length,
      warningCheckCount: 0,
      failedCheckCount: failedChecks.length,
      checkCount: checks.length,
      checks,
      failedChecks,
      warningChecks: []
    },
    correlationCompleteness: {
      regressionRunId: evidence?.regressionRunId || "",
      blockedResumeEventFound: Boolean(blockedEvent),
      blockedResumeEvent: blockedEvent ? {
        diagnosticId: blockedEvent.diagnosticId || "",
        createdAt: blockedEvent.createdAt || "",
        correlationId: blockedEvent.correlationId || "",
        source: blockedEvent?.details?.source || "",
        reason: blockedEvent?.details?.reason || "",
        regressionRunId: blockedEvent?.details?.regressionRunId || "",
        correlationResolution: blockedEvent?.details?.correlationResolution || "",
        correlationEvidenceDiagnosticId: blockedEvent?.details?.correlationEvidenceDiagnosticId || ""
      } : null
    },
    regressionRun: evidence,
    nextDecision: {
      recommendation: failedChecks.length
        ? "repair_layer2_1h_correlation_completeness"
        : "proceed_to_layer2_1i_full_live_extension_validation",
      notes: [
        "Packet truth comes from dedicated run evidence rather than bounded diagnostic history.",
        "The low-level duplicate-resume blocked event must be directly correlated to the current regression run.",
        "After correlation acceptance, run the complete live product validation before the final Codex review."
      ]
    }
  };
}

function findCurrentRunBlockedEvent(evidence, diagnostics) {
  const regressionRunId = evidence?.regressionRunId || "";
  if (!regressionRunId) return null;

  const startedAtMs = Date.parse(evidence?.startedAt || "");
  const completedAtMs = Date.parse(evidence?.completedAt || "");

  return [...(Array.isArray(diagnostics) ? diagnostics : [])]
    .reverse()
    .find((diagnostic) => {
      if (diagnostic?.action !== "workspace_resume_operation_blocked") return false;
      if (diagnostic?.details?.source !== "layer2_1h_duplicate_guard_secondary") return false;

      const createdAtMs = Date.parse(diagnostic?.createdAt || "");
      if (Number.isFinite(startedAtMs) && createdAtMs < startedAtMs) return false;
      if (Number.isFinite(completedAtMs) && createdAtMs > completedAtMs) return false;

      return true;
    }) || null;
}

function createCheck(check, condition, message) {
  return {
    check,
    status: condition ? "pass" : "fail",
    severity: "layer2_1h_correlation_completeness",
    message
  };
}

function setStatus(message) {
  const status = document.getElementById("layer2HardeningRegressionHarnessStatus");
  if (status) status.textContent = message;
}

function buildClipboardEnvelope(jsonText) {
  return [
    "CHROME_FLOW_PACKET_START",
    "packetType: Chrome Flow Layer 2.1H Validation Correlation and Regression Packet",
    "schema: " + PACKET_SCHEMA,
    "clipboardFormat: chrome_flow_packet_envelope_v0.1",
    "createdAt: " + new Date().toISOString(),
    "contentType: application/json",
    "",
    jsonText,
    "",
    "CHROME_FLOW_PACKET_END"
  ].join("\n");
}
