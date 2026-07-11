import { registerDeveloperSurface } from "./developer-mode.js";
import { getWorkspace } from "../core/workspace-store.js";
import { appendRuntimeDiagnostic, getRuntimeDiagnostics } from "../core/workspace-runtime-store.js";
import {
  ARCHIVE_CLOSE_IDENTITY_POLICY,
  buildVerifiedWorkspaceBrowserClosePlan,
  summarizeVerifiedClosePlan
} from "../core/workspace-archive-close-engine.js";

const MAX_DIAGNOSTICS_TO_SCAN = 250;

installArchiveCloseOwnershipValidationSurface();

function installArchiveCloseOwnershipValidationSurface() {
  const anchor = document.getElementById("layer2ResumeTransactionValidationSection")
    || document.getElementById("developerDiagnosticsSection")
    || document.querySelector(".workspace-section");

  if (!anchor || document.getElementById("layer2ArchiveCloseOwnershipValidationSection")) return;

  const section = document.createElement("section");
  section.id = "layer2ArchiveCloseOwnershipValidationSection";
  section.className = "layer2-archive-close-ownership-validation-section";
  section.innerHTML = `
    <h2>Layer 2.1F Archive-Close Ownership Safety</h2>
    <p class="section-help">Developer-only validation proving that a stale or reused numeric Chrome tab ID cannot authorize closing an unrelated live tab. The guard test creates one background test tab and removes it after verification.</p>
    <div class="workspace-session-actions">
      <button id="runLayer2ArchiveStaleIdGuardTestButton" type="button" class="secondary-button">Run Stale-ID Guard Test</button>
      <button id="runLayer2ArchiveOwnershipPreviewButton" type="button" class="secondary-button">Preview Current Close Ownership</button>
      <button id="prepareLayer2ArchiveOwnershipPacketButton" type="button" class="secondary-button">Prepare Archive Ownership Packet</button>
      <button id="copyLayer2ArchiveOwnershipPacketButton" type="button" class="secondary-button" disabled>Copy Archive Ownership Packet</button>
    </div>
    <p id="layer2ArchiveCloseOwnershipStatus" class="status-message">Run the stale-ID guard test before archiving a live workspace.</p>
    <pre id="layer2ArchiveCloseOwnershipOutput" class="diagnostic-output"></pre>
  `;

  anchor.insertAdjacentElement("afterend", section);
  registerDeveloperSurface(section);

  document.getElementById("runLayer2ArchiveStaleIdGuardTestButton")?.addEventListener("click", runStaleIdGuardTest);
  document.getElementById("runLayer2ArchiveOwnershipPreviewButton")?.addEventListener("click", runCurrentOwnershipPreview);
  document.getElementById("prepareLayer2ArchiveOwnershipPacketButton")?.addEventListener("click", prepareArchiveOwnershipPacket);
  document.getElementById("copyLayer2ArchiveOwnershipPacketButton")?.addEventListener("click", copyArchiveOwnershipPacket);
}

async function runStaleIdGuardTest() {
  setButtonsDisabled(true);
  setStatus("Running stale-ID guard test with one background test tab...");
  let testTabId = null;

  try {
    const testTab = await chrome.tabs.create({ url: "about:blank", active: false });
    testTabId = testTab?.id ?? null;

    if (!Number.isInteger(testTabId)) {
      throw new Error("Chrome did not return a valid test tab id.");
    }

    const syntheticWorkspace = {
      workspaceId: "layer2-1f-stale-id-guard",
      name: "Layer 2.1F synthetic ownership guard",
      tabs: [{
        workspaceTabId: crypto.randomUUID(),
        tabId: testTabId,
        tabKey: "https://example.invalid/constellation-stale-id-guard::Synthetic unrelated workspace tab",
        windowId: testTab.windowId,
        groupId: -1,
        url: "https://example.invalid/constellation-stale-id-guard",
        originalTitle: "Synthetic unrelated workspace tab",
        isOpen: true
      }]
    };

    const closePlan = await buildVerifiedWorkspaceBrowserClosePlan(syntheticWorkspace);
    const liveTabAfterPlanning = await getTabOrNull(testTabId);
    const mismatch = closePlan.skippedTabs[0] || null;
    const passed = closePlan.closeTabIds.length === 0
      && closePlan.verifiedTabs.length === 0
      && closePlan.skippedTabs.length === 1
      && mismatch?.reason === "live_url_mismatch"
      && Boolean(liveTabAfterPlanning);

    await appendRuntimeDiagnostic(
      passed ? "info" : "error",
      "layer2_archive_stale_id_guard_test_completed",
      "Layer 2.1F stale/reused tab ID ownership guard test completed.",
      {
        passed,
        testTabId,
        testTabRemainedOpenAfterPlanning: Boolean(liveTabAfterPlanning),
        mismatchReason: mismatch?.reason || "",
        closePlan: summarizeVerifiedClosePlan(closePlan),
        policyId: ARCHIVE_CLOSE_IDENTITY_POLICY.policyId
      }
    );

    setStatus(passed
      ? "Stale-ID guard test passed. The unrelated background tab was not authorized for closure."
      : "Stale-ID guard test needs attention. Do not run a live archive yet.");
  } catch (error) {
    await appendRuntimeDiagnostic("error", "layer2_archive_stale_id_guard_test_failed", "Layer 2.1F stale-ID guard test failed unexpectedly.", {
      testTabId,
      error: summarizeError(error)
    });
    setStatus("Stale-ID guard test failed unexpectedly. Inspect diagnostics before archiving.");
  } finally {
    if (Number.isInteger(testTabId)) {
      try {
        await chrome.tabs.remove(testTabId);
        await appendRuntimeDiagnostic("info", "layer2_archive_stale_id_guard_test_tab_cleaned", "Layer 2.1F background test tab removed after validation.", {
          testTabId,
          cleanupComplete: true
        });
      } catch (error) {
        await appendRuntimeDiagnostic("error", "layer2_archive_stale_id_guard_test_tab_cleanup_failed", "Could not remove the Layer 2.1F background test tab.", {
          testTabId,
          cleanupComplete: false,
          error: summarizeError(error)
        });
      }
    }

    setButtonsDisabled(false);
  }
}

async function runCurrentOwnershipPreview() {
  setButtonsDisabled(true);
  setStatus("Preparing a read-only ownership preview for the current workspace...");

  try {
    const workspace = await getWorkspace();
    const closePlan = await buildVerifiedWorkspaceBrowserClosePlan(workspace);
    const summary = summarizeVerifiedClosePlan(closePlan);

    await appendRuntimeDiagnostic("info", "layer2_archive_current_ownership_preview_completed", "Layer 2.1F current workspace archive ownership preview completed without closing tabs.", {
      workspaceId: workspace.workspaceId || "",
      closePlan: summary,
      browserMutationExecuted: false
    });

    setStatus(
      "Ownership preview complete: " + summary.verifiedTabCount + " verified tab(s), "
      + summary.skippedTabCount + " skipped candidate(s). No tab was closed."
    );
  } catch (error) {
    await appendRuntimeDiagnostic("error", "layer2_archive_current_ownership_preview_failed", "Layer 2.1F current ownership preview failed.", {
      error: summarizeError(error)
    });
    setStatus("Ownership preview failed. Inspect Developer Diagnostics.");
  } finally {
    setButtonsDisabled(false);
  }
}

async function prepareArchiveOwnershipPacket() {
  const packet = await buildArchiveOwnershipPacket();
  const output = document.getElementById("layer2ArchiveCloseOwnershipOutput");
  const copyButton = document.getElementById("copyLayer2ArchiveOwnershipPacketButton");

  if (output) output.textContent = JSON.stringify(packet, null, 2);
  if (copyButton) copyButton.disabled = false;
  setStatus("Archive ownership packet prepared: " + packet.validation.status + ".");

  await appendRuntimeDiagnostic("info", "layer2_archive_close_ownership_validation_packet_prepared", "Layer 2.1F archive-close ownership validation packet prepared.", {
    schema: packet.extension.schema,
    status: packet.validation.status,
    passedCheckCount: packet.validation.passedCheckCount,
    warningCheckCount: packet.validation.warningCheckCount,
    failedCheckCount: packet.validation.failedCheckCount
  });
}

async function copyArchiveOwnershipPacket() {
  const output = document.getElementById("layer2ArchiveCloseOwnershipOutput");
  if (!output?.textContent?.trim()) return setStatus("Prepare the archive ownership packet before copying.");

  await navigator.clipboard.writeText(buildClipboardEnvelope(output.textContent));
  setStatus("Archive ownership packet copied.");
}

async function buildArchiveOwnershipPacket() {
  const diagnostics = (await getRuntimeDiagnostics()).slice(-MAX_DIAGNOSTICS_TO_SCAN);
  const workspace = await getWorkspace();
  const currentPlan = await buildVerifiedWorkspaceBrowserClosePlan(workspace);
  const staleIdTest = findLatestDiagnostic(diagnostics, "layer2_archive_stale_id_guard_test_completed");
  const staleIdCleanup = findLatestDiagnostic(diagnostics, "layer2_archive_stale_id_guard_test_tab_cleaned");
  const staleIdCleanupFailure = findLatestDiagnostic(diagnostics, "layer2_archive_stale_id_guard_test_tab_cleanup_failed");
  const ownershipPreview = findLatestDiagnostic(diagnostics, "layer2_archive_current_ownership_preview_completed");
  const liveArchive = findLatestDiagnostic(diagnostics, "workspace_archive_verified_close_completed");
  const checks = buildChecks({ staleIdTest, staleIdCleanup, staleIdCleanupFailure, ownershipPreview, liveArchive });
  const failedChecks = checks.filter((check) => check.status === "fail");
  const warningChecks = checks.filter((check) => check.status === "warn");
  const passedChecks = checks.filter((check) => check.status === "pass");

  return {
    packetType: "Chrome Flow Layer 2.1F Archive-Close Ownership Validation Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "layer2-archive-close-ownership-validation-packet-v0.1"
    },
    source: {
      type: "layer2_archive_close_ownership_validation",
      developerOnly: true,
      staleIdGuardUsesBackgroundTestTab: true,
      currentOwnershipPreviewReadOnly: true,
      numericTabIdIsOwnershipProof: false
    },
    policy: ARCHIVE_CLOSE_IDENTITY_POLICY,
    validation: {
      status: failedChecks.length
        ? "needs_attention"
        : warningChecks.length
          ? "stale_id_guard_validated_live_archive_pending"
          : "archive_close_ownership_validated",
      passedCheckCount: passedChecks.length,
      warningCheckCount: warningChecks.length,
      failedCheckCount: failedChecks.length,
      checkCount: checks.length,
      checks,
      failedChecks,
      warningChecks
    },
    activeWorkspace: {
      workspaceId: workspace.workspaceId || "",
      name: workspace.name || "Untitled Workspace",
      tabCount: Array.isArray(workspace.tabs) ? workspace.tabs.length : 0
    },
    currentReadOnlyClosePlan: summarizeVerifiedClosePlan(currentPlan),
    evidence: {
      staleIdTest: summarizeDiagnostic(staleIdTest),
      staleIdCleanup: summarizeDiagnostic(staleIdCleanup),
      staleIdCleanupFailure: summarizeDiagnostic(staleIdCleanupFailure),
      ownershipPreview: summarizeDiagnostic(ownershipPreview),
      liveArchive: summarizeDiagnostic(liveArchive)
    },
    nextDecision: {
      recommendation: failedChecks.length
        ? "repair_archive_close_ownership_guard"
        : liveArchive
          ? "accept_layer2_1f_and_proceed_to_legacy_archive_projection_cleanup"
          : "run_one_normal_verified_archive_then_prepare_packet_again",
      notes: [
        "A numeric Chrome tab id is only a candidate locator and is never sufficient ownership proof.",
        "The engine compares URL and tab-key/title evidence at planning time and again immediately before removal.",
        "Mismatched, ambiguous, missing, or insufficiently corroborated tabs are skipped.",
        "One normal archive is required for full acceptance after the synthetic stale-ID guard passes."
      ]
    }
  };
}

function buildChecks(evidence) {
  const liveArchiveAvailable = Boolean(evidence.liveArchive);
  const liveArchiveDetails = evidence.liveArchive?.details || {};
  const liveCloseResult = liveArchiveDetails.closeResult || {};
  const liveSafety = liveArchiveDetails.safety || {};

  return [
    createCheck("numeric_tab_id_not_ownership_proof", ARCHIVE_CLOSE_IDENTITY_POLICY.numericTabIdIsOwnershipProof === false, "Archive policy rejects numeric tab ID as sufficient ownership proof."),
    createCheck("execution_revalidation_required", ARCHIVE_CLOSE_IDENTITY_POLICY.executionPolicy === "revalidate_immediately_before_individual_tab_removal", "Ownership is revalidated immediately before each tab removal."),
    createCheck("mismatch_policy_skip_never_close", ARCHIVE_CLOSE_IDENTITY_POLICY.mismatchPolicy === "skip_never_close", "Identity mismatches are skipped and never closed."),
    createCheck("stale_id_guard_test_passed", evidence.staleIdTest?.details?.passed === true, "Synthetic stale/reused tab ID guard test passed."),
    createCheck("stale_id_mismatch_detected", evidence.staleIdTest?.details?.mismatchReason === "live_url_mismatch", "Synthetic unrelated live tab was rejected because its URL did not match saved ownership evidence."),
    createCheck("unrelated_test_tab_remained_open_during_plan", evidence.staleIdTest?.details?.testTabRemainedOpenAfterPlanning === true, "Unrelated background test tab remained open during ownership planning."),
    createCheck("test_tab_cleanup_completed", evidence.staleIdCleanup?.details?.cleanupComplete === true && !evidence.staleIdCleanupFailure, "Background test tab was removed after validation."),
    createCheck("current_ownership_preview_available", Boolean(evidence.ownershipPreview), "Read-only current workspace ownership preview was prepared."),
    createCheck("normal_verified_archive_completed", liveArchiveAvailable, "A normal archive completed through the verified ownership controller.", liveArchiveAvailable ? "layer2_1f_archive_safety" : "warning"),
    createCheck("normal_archive_closed_no_unrelated_tabs", liveArchiveAvailable && liveSafety.unrelatedTabsClosed === false, "Normal archive reports zero unrelated tab closures.", liveArchiveAvailable ? "layer2_1f_archive_safety" : "warning"),
    createCheck("normal_archive_execution_revalidated", liveArchiveAvailable && liveSafety.removedOnlyAfterExecutionRevalidation === true, "Normal archive removed tabs only after execution-time ownership revalidation.", liveArchiveAvailable ? "layer2_1f_archive_safety" : "warning"),
    createCheck("normal_archive_close_errors_zero", liveArchiveAvailable && Array.isArray(liveCloseResult.errors) && liveCloseResult.errors.length === 0, "Normal verified archive completed with zero tab-close errors.", liveArchiveAvailable ? "layer2_1f_archive_safety" : "warning")
  ];
}

function createCheck(check, condition, message, severity = "layer2_1f_archive_safety") {
  return {
    check,
    status: condition ? "pass" : severity === "warning" ? "warn" : "fail",
    severity,
    message
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

async function getTabOrNull(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch (_error) {
    return null;
  }
}

function setButtonsDisabled(disabled) {
  for (const id of [
    "runLayer2ArchiveStaleIdGuardTestButton",
    "runLayer2ArchiveOwnershipPreviewButton",
    "prepareLayer2ArchiveOwnershipPacketButton"
  ]) {
    const button = document.getElementById(id);
    if (button) button.disabled = disabled;
  }
}

function setStatus(message) {
  const status = document.getElementById("layer2ArchiveCloseOwnershipStatus");
  if (status) status.textContent = message;
}

function buildClipboardEnvelope(jsonText) {
  return [
    "CHROME_FLOW_PACKET_START",
    "packetType: Chrome Flow Layer 2.1F Archive-Close Ownership Validation Packet",
    "schema: layer2-archive-close-ownership-validation-packet-v0.1",
    "clipboardFormat: chrome_flow_packet_envelope_v0.1",
    "createdAt: " + new Date().toISOString(),
    "contentType: application/json",
    "",
    jsonText,
    "",
    "CHROME_FLOW_PACKET_END"
  ].join("\n");
}

function summarizeError(error) {
  if (!error) return { message: "Unknown error" };
  return {
    name: error.name || "Error",
    message: error.message || String(error),
    stack: typeof error.stack === "string" ? error.stack.slice(0, 2000) : ""
  };
}
