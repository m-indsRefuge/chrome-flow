import { registerDeveloperSurface } from "./developer-mode.js";
import { getWorkspace } from "../core/workspace-store.js";
import { appendRuntimeDiagnostic, getRuntimeDiagnostics } from "../core/workspace-runtime-store.js";
import {
  CLEANUP_VERSION,
  sanitizeLegacyRestoredWorkspaceProjection
} from "./legacy-archive-projection-cleanup.js";

const MAX_DIAGNOSTICS_TO_SCAN = 250;
const PACKET_SCHEMA = "layer2-legacy-archive-projection-validation-packet-v0.3";
const DEFAULT_SEVERITY = "layer2_1g_legacy_cleanup";
const VALIDATION_EVIDENCE_KEY = "chromeFlowLayer21GLegacyProjectionValidation";

installLegacyArchiveProjectionValidationSurface();

function installLegacyArchiveProjectionValidationSurface() {
  const anchor = document.getElementById("layer2ArchiveCloseOwnershipValidationSection")
    || document.getElementById("layer2ResumeTransactionValidationSection")
    || document.getElementById("developerDiagnosticsSection")
    || document.querySelector(".workspace-section");

  if (!anchor || document.getElementById("layer2LegacyArchiveProjectionValidationSection")) return;

  const section = document.createElement("section");
  section.id = "layer2LegacyArchiveProjectionValidationSection";
  section.className = "layer2-legacy-archive-projection-validation-section";
  section.innerHTML = `
    <h2>Layer 2.1G Legacy Restore Projection Cleanup</h2>
    <p class="section-help">Developer-only validation proving that legacy archive restore cannot carry stale tab, window, or group identifiers into active runtime for tabs it did not successfully reopen.</p>
    <div class="workspace-session-actions">
      <button id="runLayer2LegacyProjectionCleanupTestButton" type="button" class="secondary-button">Run Controlled Partial Cleanup Test</button>
      <button id="prepareLayer2LegacyProjectionCleanupPacketButton" type="button" class="secondary-button">Prepare Legacy Cleanup Packet</button>
      <button id="copyLayer2LegacyProjectionCleanupPacketButton" type="button" class="secondary-button" disabled>Copy Legacy Cleanup Packet</button>
    </div>
    <p id="layer2LegacyProjectionCleanupStatus" class="status-message">Run the controlled partial-cleanup test before one normal Developer Mode legacy restore.</p>
    <pre id="layer2LegacyProjectionCleanupOutput" class="diagnostic-output"></pre>
  `;

  anchor.insertAdjacentElement("afterend", section);
  registerDeveloperSurface(section);

  document.getElementById("runLayer2LegacyProjectionCleanupTestButton")?.addEventListener("click", runControlledPartialCleanupTest);
  document.getElementById("prepareLayer2LegacyProjectionCleanupPacketButton")?.addEventListener("click", prepareLegacyProjectionCleanupPacket);
  document.getElementById("copyLayer2LegacyProjectionCleanupPacketButton")?.addEventListener("click", copyLegacyProjectionCleanupPacket);
}

async function runControlledPartialCleanupTest() {
  setButtonsDisabled(true);
  setStatus("Running controlled legacy partial-restore projection cleanup test...");

  try {
    const restoreEventId = crypto.randomUUID();
    const reopenedWorkspaceTabId = crypto.randomUUID();
    const notReopenedWorkspaceTabId = crypto.randomUUID();
    const failedReopenWorkspaceTabId = crypto.randomUUID();
    const syntheticWorkspace = {
      workspaceId: "layer2-1g-controlled-legacy-cleanup",
      name: "Layer 2.1G controlled legacy cleanup",
      tabs: [
        createSyntheticTab(reopenedWorkspaceTabId, 101, 201, 301, "https://example.test/reopened"),
        createSyntheticTab(notReopenedWorkspaceTabId, 102, 202, 302, "https://example.test/not-reopened"),
        createSyntheticTab(failedReopenWorkspaceTabId, 103, 203, 303, "https://example.test/failed-reopen")
      ],
      journal: [],
      timeline: [{
        eventId: restoreEventId,
        type: "archive_restored",
        createdAt: new Date().toISOString(),
        archiveId: "layer2-1g-controlled-archive",
        restoredWorkspaceTabIds: [reopenedWorkspaceTabId, failedReopenWorkspaceTabId]
      }]
    };

    const result = await sanitizeLegacyRestoredWorkspaceProjection(syntheticWorkspace, {
      resolveLiveTab: async (tabId) => {
        if (tabId === 101) {
          return {
            id: 101,
            windowId: 901,
            groupId: 17,
            url: "https://example.test/reopened",
            title: "Reopened live tab"
          };
        }
        throw new Error("Synthetic reopened tab is no longer live.");
      }
    });

    const reopened = findTab(result.workspace, reopenedWorkspaceTabId);
    const notReopened = findTab(result.workspace, notReopenedWorkspaceTabId);
    const failedReopen = findTab(result.workspace, failedReopenWorkspaceTabId);
    const assertions = {
      reopenedVerifiedLive: reopened?.tabId === 101
        && reopened?.windowId === 901
        && reopened?.groupId === 17
        && reopened?.isOpen === true
        && reopened?.legacyRestoreProjectionState === "reopened_verified_live",
      notReopenedCleared: hasClearedProjection(notReopened)
        && notReopened?.legacyRestoreProjectionState === "not_reopened_by_legacy_restore",
      failedReopenCleared: hasClearedProjection(failedReopen)
        && failedReopen?.legacyRestoreProjectionState === "legacy_reopen_verification_failed",
      noStaleIdentifiersRemain: result.summary.staleIdentifierCountAfterCleanup === 0,
      expectedCounts: result.summary.reopenedVerifiedCount === 1
        && result.summary.notReopenedClearedCount === 1
        && result.summary.failedVerificationCount === 1
    };
    const passed = Object.values(assertions).every(Boolean);
    const evidence = createEvidenceRecord(
      passed ? "info" : "error",
      "layer2_legacy_archive_projection_cleanup_test_completed",
      "Layer 2.1G controlled legacy partial-restore projection cleanup test completed.",
      {
        passed,
        cleanupVersion: CLEANUP_VERSION,
        assertions,
        summary: result.summary,
        browserMutationExecuted: false,
        activeRuntimeChanged: false
      }
    );

    await persistValidationEvidence({ controlledTest: evidence });
    await appendRuntimeDiagnostic(
      evidence.level,
      evidence.action,
      evidence.message,
      evidence.details
    );

    setStatus(passed
      ? "Controlled partial cleanup passed. Skipped and failed legacy tabs contain no live Chrome identifiers."
      : "Controlled partial cleanup needs attention. Do not run a normal legacy restore yet.");
  } catch (error) {
    const failureEvidence = createEvidenceRecord(
      "error",
      "layer2_legacy_archive_projection_cleanup_test_failed",
      "Layer 2.1G controlled cleanup test failed unexpectedly.",
      { error: summarizeError(error) }
    );
    await persistValidationEvidence({ controlledTestFailure: failureEvidence });
    await appendRuntimeDiagnostic(
      failureEvidence.level,
      failureEvidence.action,
      failureEvidence.message,
      failureEvidence.details
    );
    setStatus("Controlled cleanup test failed unexpectedly. Inspect Developer Diagnostics.");
  } finally {
    setButtonsDisabled(false);
  }
}

async function prepareLegacyProjectionCleanupPacket() {
  setButtonsDisabled(true);
  const copyButton = document.getElementById("copyLayer2LegacyProjectionCleanupPacketButton");
  if (copyButton) copyButton.disabled = true;

  try {
    const packet = await buildLegacyProjectionCleanupPacket();
    const output = document.getElementById("layer2LegacyProjectionCleanupOutput");

    if (output) output.textContent = JSON.stringify(packet, null, 2);
    if (copyButton) copyButton.disabled = false;
    setStatus("Legacy projection cleanup packet prepared: " + packet.validation.status + ".");

    await appendRuntimeDiagnostic("info", "layer2_legacy_archive_projection_validation_packet_prepared", "Layer 2.1G legacy archive projection cleanup validation packet prepared.", {
      schema: packet.extension.schema,
      status: packet.validation.status,
      passedCheckCount: packet.validation.passedCheckCount,
      warningCheckCount: packet.validation.warningCheckCount,
      failedCheckCount: packet.validation.failedCheckCount,
      controlledEvidenceSource: packet.evidenceSources.controlledTest,
      liveCleanupEvidenceSource: packet.evidenceSources.liveCleanup
    });
  } catch (error) {
    await appendRuntimeDiagnostic("error", "layer2_legacy_archive_projection_validation_packet_failed", "Layer 2.1G legacy cleanup packet preparation failed.", {
      error: summarizeError(error)
    });
    setStatus("Could not prepare the legacy cleanup packet. Inspect Developer Diagnostics.");
  } finally {
    setButtonsDisabled(false);
  }
}

async function copyLegacyProjectionCleanupPacket() {
  const output = document.getElementById("layer2LegacyProjectionCleanupOutput");
  if (!output?.textContent?.trim()) return setStatus("Prepare the legacy cleanup packet before copying.");

  try {
    await navigator.clipboard.writeText(buildClipboardEnvelope(output.textContent));
    setStatus("Legacy projection cleanup packet copied.");
  } catch (error) {
    await appendRuntimeDiagnostic("error", "layer2_legacy_archive_projection_packet_copy_failed", "Could not copy the Layer 2.1G packet.", {
      error: summarizeError(error)
    });
    setStatus("Could not copy the legacy cleanup packet. Inspect Developer Diagnostics.");
  }
}

async function buildLegacyProjectionCleanupPacket() {
  const [workspace, allDiagnostics, storedEvidence] = await Promise.all([
    getWorkspace(),
    getRuntimeDiagnostics(),
    getStoredValidationEvidence()
  ]);
  const diagnostics = allDiagnostics.slice(-MAX_DIAGNOSTICS_TO_SCAN);
  const diagnosticControlledTest = findLatestDiagnostic(diagnostics, "layer2_legacy_archive_projection_cleanup_test_completed");
  const diagnosticLiveCleanup = findLatestDiagnostic(diagnostics, "legacy_archive_projection_cleanup_applied");
  const controlledTest = selectNewestEvidence(diagnosticControlledTest, storedEvidence.controlledTest);
  const liveCleanup = selectNewestEvidence(diagnosticLiveCleanup, buildLiveCleanupEvidenceFromWorkspace(workspace));
  const cleanupFailure = findLatestDiagnostic(diagnostics, "legacy_archive_projection_cleanup_failed")
    || storedEvidence.cleanupFailure
    || null;
  const checks = buildChecks({ controlledTest, liveCleanup, cleanupFailure, workspace });
  const failedChecks = checks.filter((check) => check.status === "fail");
  const warningChecks = checks.filter((check) => check.status === "warn");
  const passedChecks = checks.filter((check) => check.status === "pass");

  return {
    packetType: "Chrome Flow Layer 2.1G Legacy Archive Projection Cleanup Validation Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: PACKET_SCHEMA
    },
    source: {
      type: "layer2_legacy_archive_projection_cleanup_validation",
      developerOnly: true,
      controlledTestBrowserMutation: false,
      unifiedWorkspaceLibraryResumeChanged: false,
      activeRuntimeAuthority: "chrome.storage.local",
      validationEvidenceAuthority: "dedicated local validation evidence with diagnostic fallback"
    },
    policy: {
      cleanupVersion: CLEANUP_VERSION,
      reopenedTabsRequireLiveIdAndUrlVerification: true,
      notReopenedTabsClearLiveProjectionIdentifiers: true,
      failedReopenedTabsClearLiveProjectionIdentifiers: true
    },
    validation: {
      status: failedChecks.length
        ? "needs_attention"
        : warningChecks.length
          ? "controlled_partial_cleanup_validated_live_legacy_restore_pending"
          : "legacy_archive_projection_cleanup_validated",
      passedCheckCount: passedChecks.length,
      warningCheckCount: warningChecks.length,
      failedCheckCount: failedChecks.length,
      checkCount: checks.length,
      checks,
      failedChecks,
      warningChecks
    },
    activeWorkspace: summarizeWorkspace(workspace),
    evidenceSources: {
      controlledTest: diagnosticControlledTest
        ? "runtime_diagnostics"
        : storedEvidence.controlledTest
          ? "dedicated_local_validation_evidence"
          : "missing",
      liveCleanup: diagnosticLiveCleanup
        ? "runtime_diagnostics"
        : liveCleanup
          ? "active_workspace_cleanup_metadata"
          : "missing"
    },
    evidence: {
      controlledTest: summarizeDiagnostic(controlledTest),
      liveCleanup: summarizeDiagnostic(liveCleanup),
      cleanupFailure: summarizeDiagnostic(cleanupFailure)
    },
    nextDecision: {
      recommendation: failedChecks.length
        ? "repair_legacy_archive_projection_cleanup"
        : liveCleanup
          ? "accept_layer2_1g_and_proceed_to_validation_correlation_harness"
          : "run_one_normal_developer_mode_legacy_restore_then_prepare_packet_again",
      notes: [
        "The controlled test proves partial-restore cleanup without opening or closing browser tabs.",
        "Controlled validation evidence is stored under a dedicated local key so concurrent diagnostic writes cannot erase the test result.",
        "Full acceptance also requires one normal Developer Mode legacy archive restore so the storage-change compatibility adapter is exercised.",
        "Unified Workspace Library Resume is not modified by this compatibility adapter."
      ]
    }
  };
}

function buildChecks({ controlledTest, liveCleanup, cleanupFailure, workspace }) {
  const assertions = controlledTest?.details?.assertions || {};
  const liveSummary = liveCleanup?.details?.summary || {};
  const cleanupMetadata = workspace?.legacyArchiveProjectionCleanup || {};
  const liveAvailable = Boolean(liveCleanup);

  return [
    createCheck("controlled_partial_cleanup_passed", controlledTest?.details?.passed === true, "Controlled partial legacy restore cleanup passed."),
    createCheck("controlled_reopened_tab_verified_live", assertions.reopenedVerifiedLive === true, "Successfully reopened tab retained verified current live identifiers."),
    createCheck("controlled_not_reopened_tab_cleared", assertions.notReopenedCleared === true, "Tab not reopened by legacy restore had all live projection identifiers cleared."),
    createCheck("controlled_failed_reopen_tab_cleared", assertions.failedReopenCleared === true, "Failed reopened tab had all live projection identifiers cleared."),
    createCheck("controlled_no_stale_identifiers", assertions.noStaleIdentifiersRemain === true, "No stale live projection identifiers remain on closed synthetic tabs."),
    createCheck("no_unresolved_cleanup_failure", !cleanupFailure || new Date(cleanupFailure.createdAt) < new Date(liveCleanup?.createdAt || 0), "No unresolved legacy projection cleanup failure exists."),
    createCheck("normal_legacy_cleanup_applied", liveAvailable, "A normal Developer Mode legacy restore triggered projection cleanup.", liveAvailable ? DEFAULT_SEVERITY : "warning"),
    createCheck("normal_cleanup_no_stale_closed_identifiers", liveAvailable && Number(liveSummary.staleIdentifierCountAfterCleanup || 0) === 0, "Normal legacy restore cleanup left no stale identifiers on closed tabs.", liveAvailable ? DEFAULT_SEVERITY : "warning"),
    createCheck("normal_cleanup_metadata_committed", liveAvailable
      && cleanupMetadata.version === CLEANUP_VERSION
      && cleanupMetadata.restoreEventId === liveCleanup?.details?.restoreEventId,
    "Active runtime records the applied legacy projection cleanup version and restore event.", liveAvailable ? DEFAULT_SEVERITY : "warning"),
    createCheck("normal_cleanup_all_tabs_classified", liveAvailable
      && Number(liveSummary.tabCount || 0) === Number(liveSummary.reopenedVerifiedCount || 0)
        + Number(liveSummary.notReopenedClearedCount || 0)
        + Number(liveSummary.failedVerificationCount || 0),
    "Every normal legacy restore tab was classified as reopened, not reopened, or failed verification.", liveAvailable ? DEFAULT_SEVERITY : "warning")
  ];
}

function createCheck(check, condition, message, severity = DEFAULT_SEVERITY) {
  return {
    check,
    status: condition ? "pass" : severity === "warning" ? "warn" : "fail",
    severity,
    message
  };
}

function createSyntheticTab(workspaceTabId, tabId, windowId, groupId, url) {
  return {
    workspaceTabId,
    tabId,
    windowId,
    groupId,
    isOpen: true,
    url,
    title: "Archived synthetic tab"
  };
}

function findTab(workspace, workspaceTabId) {
  return (Array.isArray(workspace?.tabs) ? workspace.tabs : [])
    .find((tab) => tab?.workspaceTabId === workspaceTabId) || null;
}

function hasClearedProjection(tab) {
  return tab?.tabId === null
    && tab?.windowId === null
    && tab?.groupId === -1
    && tab?.isOpen === false;
}

function summarizeWorkspace(workspace) {
  const tabs = Array.isArray(workspace?.tabs) ? workspace.tabs : [];
  return {
    workspaceId: workspace?.workspaceId || "",
    name: workspace?.name || "Untitled Workspace",
    tabCount: tabs.length,
    openTabCount: tabs.filter((tab) => tab?.isOpen === true).length,
    closedTabCount: tabs.filter((tab) => tab?.isOpen !== true).length,
    staleIdentifierCountOnClosedTabs: tabs.filter((tab) => tab?.isOpen !== true && (
      Number.isInteger(tab?.tabId)
      || Number.isInteger(tab?.windowId)
      || (Number.isInteger(tab?.groupId) && tab.groupId !== -1)
    )).length,
    cleanupMetadata: workspace?.legacyArchiveProjectionCleanup || null
  };
}

async function getStoredValidationEvidence() {
  const result = await chrome.storage.local.get(VALIDATION_EVIDENCE_KEY);
  const stored = result?.[VALIDATION_EVIDENCE_KEY];
  return stored && typeof stored === "object" ? stored : {};
}

async function persistValidationEvidence(partialEvidence) {
  const current = await getStoredValidationEvidence();
  await chrome.storage.local.set({
    [VALIDATION_EVIDENCE_KEY]: {
      ...current,
      ...cloneValue(partialEvidence),
      updatedAt: new Date().toISOString()
    }
  });
}

function buildLiveCleanupEvidenceFromWorkspace(workspace) {
  const metadata = workspace?.legacyArchiveProjectionCleanup;
  if (!metadata || metadata.version !== CLEANUP_VERSION || !metadata.restoreEventId) return null;

  const reopenedVerifiedCount = Number(metadata.reopenedVerifiedCount || 0);
  const notReopenedClearedCount = Number(metadata.notReopenedClearedCount || 0);
  const failedVerificationCount = Number(metadata.failedVerificationCount || 0);

  return createEvidenceRecord(
    failedVerificationCount > 0 ? "warn" : "info",
    "legacy_archive_projection_cleanup_applied",
    "Legacy archive restore live projection identifiers were normalized before continued runtime use.",
    {
      source: "active_workspace_cleanup_metadata",
      cleanupVersion: metadata.version,
      workspaceId: workspace.workspaceId || "",
      restoreEventId: metadata.restoreEventId,
      archiveId: metadata.archiveId || "",
      summary: {
        applicable: true,
        cleanupVersion: metadata.version,
        restoreEventId: metadata.restoreEventId,
        tabCount: reopenedVerifiedCount + notReopenedClearedCount + failedVerificationCount,
        intendedReopenedCount: reopenedVerifiedCount + failedVerificationCount,
        reopenedVerifiedCount,
        notReopenedClearedCount,
        failedVerificationCount,
        staleIdentifierCountAfterCleanup: Number(metadata.staleIdentifierCountAfterCleanup || 0)
      },
      activeRuntimeAuthority: "chrome.storage.local",
      unifiedWorkspaceLibraryResumeChanged: false
    },
    metadata.appliedAt || new Date().toISOString()
  );
}

function selectNewestEvidence(primary, fallback) {
  if (!primary) return fallback || null;
  if (!fallback) return primary;

  return new Date(primary.createdAt || 0) >= new Date(fallback.createdAt || 0)
    ? primary
    : fallback;
}

function createEvidenceRecord(level, action, message, details, createdAt = new Date().toISOString()) {
  return {
    diagnosticId: crypto.randomUUID(),
    createdAt,
    level,
    action,
    message,
    details: cloneValue(details || {})
  };
}

function findLatestDiagnostic(diagnostics, action) {
  return [...diagnostics].reverse().find((diagnostic) => diagnostic?.action === action) || null;
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

function setButtonsDisabled(disabled) {
  for (const id of [
    "runLayer2LegacyProjectionCleanupTestButton",
    "prepareLayer2LegacyProjectionCleanupPacketButton"
  ]) {
    const button = document.getElementById(id);
    if (button) button.disabled = disabled;
  }
}

function setStatus(message) {
  const status = document.getElementById("layer2LegacyProjectionCleanupStatus");
  if (status) status.textContent = message;
}

function buildClipboardEnvelope(jsonText) {
  return [
    "CHROME_FLOW_PACKET_START",
    "packetType: Chrome Flow Layer 2.1G Legacy Archive Projection Cleanup Validation Packet",
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

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function summarizeError(error) {
  if (!error) return { message: "Unknown error" };
  return {
    name: error.name || "Error",
    message: error.message || String(error),
    stack: typeof error.stack === "string" ? error.stack.slice(0, 2000) : ""
  };
}
