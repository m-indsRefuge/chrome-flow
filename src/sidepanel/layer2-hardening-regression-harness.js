import { registerDeveloperSurface } from "./developer-mode.js";

import {
  appendRuntimeDiagnostic,
  getActiveWorkspaceRuntime,
  getRuntimeDiagnostics,
  reconcileRuntimeDiagnostics
} from "../core/workspace-runtime-store.js";

import { getWorkspaceMemoryRecord } from "../core/workspace-memory-store.js";
import { saveRuntimeWorkspaceSnapshotToSessionDb } from "../core/workspace-snapshot-repository.js";
import { SESSION_DB_SCHEMA, runSessionDbTransaction } from "../core/session-db.js";

import {
  VALIDATION_MODE,
  WorkspaceResumeOperationError,
  resumeWorkspaceMemoryRecordSafely
} from "../core/workspace-resume-transaction-engine.js";

import { verifySavedWorkspaceTabAgainstCurrentLiveTab } from "../core/workspace-archive-close-engine.js";
import { sanitizeLegacyRestoredWorkspaceProjection } from "./legacy-archive-projection-cleanup.js";

const EVIDENCE_KEY = "chromeFlowLayer21HRegressionEvidence";
const PACKET_SCHEMA = "layer2-hardening-regression-packet-v0.2";
const EVIDENCE_SCHEMA = "layer2-hardening-regression-evidence-v0.2";
const DIAGNOSTIC_PROBE_COUNT = 8;

installLayer2HardeningRegressionHarness();

function installLayer2HardeningRegressionHarness() {
  const anchor = document.getElementById("layer2LegacyProjectionCleanupSection")
    || document.getElementById("layer2ArchiveCloseOwnershipValidationSection")
    || document.getElementById("layer2ResumeTransactionValidationSection")
    || document.getElementById("developerDiagnosticsSection")
    || document.querySelector(".workspace-section");

  if (!anchor || document.getElementById("layer2HardeningRegressionHarnessSection")) return;

  const section = document.createElement("section");
  section.id = "layer2HardeningRegressionHarnessSection";
  section.className = "layer2-hardening-regression-harness-section";
  section.innerHTML = `
    <h2>Layer 2.1H Hardening Regression Harness</h2>
    <p class="section-help">Developer-only executable regression suite for exact snapshot replacement, resume locking and rollback, archive ownership rejection, legacy projection cleanup, correlated diagnostic writes, and active-runtime preservation. The run creates and removes two background test tabs and writes then deletes one temporary Session DB workspace.</p>
    <div class="workspace-session-actions">
      <button id="runLayer2HardeningRegressionHarnessButton" type="button" class="secondary-button">Run Full Hardening Regression Suite</button>
      <button id="prepareLayer2HardeningRegressionPacketButton" type="button" class="secondary-button">Prepare Hardening Packet</button>
      <button id="copyLayer2HardeningRegressionPacketButton" type="button" class="secondary-button" disabled>Copy Hardening Packet</button>
    </div>
    <p id="layer2HardeningRegressionHarnessStatus" class="status-message">Run the full suite before preparing the consolidated packet.</p>
    <pre id="layer2HardeningRegressionHarnessOutput" class="diagnostic-output"></pre>
  `;

  anchor.insertAdjacentElement("afterend", section);
  registerDeveloperSurface(section);

  document.getElementById("runLayer2HardeningRegressionHarnessButton")?.addEventListener("click", runFullRegressionSuite);
  document.getElementById("prepareLayer2HardeningRegressionPacketButton")?.addEventListener("click", prepareHardeningPacket);
  document.getElementById("copyLayer2HardeningRegressionPacketButton")?.addEventListener("click", copyHardeningPacket);
}

async function runFullRegressionSuite() {
  const regressionRunId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const activeRuntimeBefore = await getActiveWorkspaceRuntime();
  const cases = [];

  setButtonsDisabled(true);
  setStatus("Running correlated hardening suite. Two background test tabs will be created and removed; one temporary Session DB workspace will be written and deleted.");

  try {
    cases.push(await runCase("diagnostic_concurrency", regressionRunId, runDiagnosticConcurrencyRegression));
    cases.push(await runCase("exact_snapshot_replacement", regressionRunId, runExactSnapshotReplacementRegression));
    cases.push(await runCase("resume_duplicate_and_rollback", regressionRunId, runResumeRegression));
    cases.push(await runCase("archive_stale_id_rejection", regressionRunId, runArchiveOwnershipRegression));
    cases.push(await runCase("legacy_projection_cleanup", regressionRunId, runLegacyProjectionCleanupRegression));

    const activeRuntimeAfter = await getActiveWorkspaceRuntime();
    const runtimePreserved = stableStringify(activeRuntimeBefore) === stableStringify(activeRuntimeAfter);
    const passed = cases.every((testCase) => testCase.passed) && runtimePreserved;
    const evidence = {
      evidenceType: "Chrome Flow Layer 2.1H Hardening Regression Evidence",
      schema: EVIDENCE_SCHEMA,
      regressionRunId,
      startedAt,
      completedAt: new Date().toISOString(),
      passed,
      environment: {
        developerOnly: true,
        controlledBrowserMutation: true,
        controlledBrowserMutationDescription: "One resume rollback tab and one archive ownership test tab are created in the background and removed automatically.",
        controlledSessionDbMutation: true,
        controlledSessionDbMutationDescription: "One temporary regression workspace is saved twice and deleted transactionally after verification.",
        activeRuntimeAuthority: "chrome.storage.local",
        validationEvidenceAuthority: "dedicated local regression evidence",
        externalNetworkRequestRequired: false
      },
      runtimeIntegrity: {
        preserved: runtimePreserved,
        beforeWorkspaceId: activeRuntimeBefore?.workspaceId || "",
        afterWorkspaceId: activeRuntimeAfter?.workspaceId || "",
        beforeTabCount: Array.isArray(activeRuntimeBefore?.tabs) ? activeRuntimeBefore.tabs.length : 0,
        afterTabCount: Array.isArray(activeRuntimeAfter?.tabs) ? activeRuntimeAfter.tabs.length : 0
      },
      cases
    };

    await chrome.storage.local.set({ [EVIDENCE_KEY]: evidence });
    await appendRuntimeDiagnostic(passed ? "info" : "error", "layer2_hardening_regression_suite_completed", "Layer 2.1H correlated hardening regression suite completed.", {
      regressionRunId,
      correlationId: regressionRunId,
      passed,
      runtimePreserved,
      caseCount: cases.length,
      passedCaseCount: cases.filter((testCase) => testCase.passed).length,
      failedCaseIds: cases.filter((testCase) => !testCase.passed).map((testCase) => testCase.caseId),
      evidenceSchema: EVIDENCE_SCHEMA
    });

    setStatus(passed
      ? "Hardening regression suite passed. All temporary browser and Session DB resources were removed, and active runtime remained unchanged."
      : "Hardening regression suite needs attention. Prepare the packet and inspect the failed case evidence.");
  } catch (error) {
    await appendRuntimeDiagnostic("error", "layer2_hardening_regression_suite_failed", "Layer 2.1H hardening regression suite failed before evidence commit.", {
      regressionRunId,
      correlationId: regressionRunId,
      error: summarizeError(error)
    });
    setStatus("Hardening regression suite failed unexpectedly. Inspect Developer Diagnostics.");
  } finally {
    setButtonsDisabled(false);
  }
}

async function runCase(caseId, regressionRunId, runner) {
  const operationId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  try {
    const result = await runner({ caseId, regressionRunId, operationId });
    const testCase = {
      caseId,
      operationId,
      startedAt,
      completedAt: new Date().toISOString(),
      passed: result?.passed === true,
      assertions: result?.assertions || {},
      evidence: result?.evidence || {},
      cleanup: result?.cleanup || null,
      error: result?.error || null
    };

    await appendRuntimeDiagnostic(testCase.passed ? "info" : "error", "layer2_hardening_regression_case_completed", "Layer 2.1H regression case completed: " + caseId + ".", {
      regressionRunId,
      correlationId: regressionRunId,
      operationId,
      caseOperationId: operationId,
      caseId,
      passed: testCase.passed,
      assertions: testCase.assertions,
      cleanup: testCase.cleanup
    });

    return testCase;
  } catch (error) {
    const testCase = {
      caseId,
      operationId,
      startedAt,
      completedAt: new Date().toISOString(),
      passed: false,
      assertions: {},
      evidence: {},
      cleanup: null,
      error: summarizeError(error)
    };

    await appendRuntimeDiagnostic("error", "layer2_hardening_regression_case_failed", "Layer 2.1H regression case failed: " + caseId + ".", {
      regressionRunId,
      correlationId: regressionRunId,
      operationId,
      caseOperationId: operationId,
      caseId,
      error: testCase.error
    });

    return testCase;
  }
}

async function runDiagnosticConcurrencyRegression(context) {
  await Promise.all(Array.from({ length: DIAGNOSTIC_PROBE_COUNT }, (_, probeIndex) => appendRuntimeDiagnostic(
    "info",
    "layer2_1h_concurrent_write_probe",
    "Layer 2.1H concurrent diagnostic write probe.",
    {
      regressionRunId: context.regressionRunId,
      correlationId: context.regressionRunId,
      operationId: context.operationId,
      caseOperationId: context.operationId,
      caseId: context.caseId,
      probeIndex
    }
  )));

  await reconcileRuntimeDiagnostics();
  const diagnostics = await getRuntimeDiagnostics();
  const probes = diagnostics.filter((diagnostic) => diagnostic?.action === "layer2_1h_concurrent_write_probe"
    && diagnostic?.details?.regressionRunId === context.regressionRunId
    && diagnostic?.details?.caseOperationId === context.operationId);
  const probeIndexes = Array.from(new Set(probes.map((diagnostic) => diagnostic?.details?.probeIndex))).sort((a, b) => a - b);
  const assertions = {
    expectedProbeCount: probes.length === DIAGNOSTIC_PROBE_COUNT,
    uniqueProbeIndexes: probeIndexes.length === DIAGNOSTIC_PROBE_COUNT,
    sharedRunCorrelation: probes.every((diagnostic) => diagnostic.correlationId === context.regressionRunId),
    uniqueDiagnosticIds: new Set(probes.map((diagnostic) => diagnostic.diagnosticId)).size === DIAGNOSTIC_PROBE_COUNT
  };

  return {
    passed: allTrue(assertions),
    assertions,
    evidence: {
      expectedProbeCount: DIAGNOSTIC_PROBE_COUNT,
      observedProbeCount: probes.length,
      observedProbeIndexes: probeIndexes,
      diagnosticIds: probes.map((diagnostic) => diagnostic.diagnosticId)
    },
    cleanup: { appendOnlyShardsRetainedWithinDiagnosticLimit: true }
  };
}

async function runExactSnapshotReplacementRegression(context) {
  const workspaceId = "layer2-1h-regression-" + context.regressionRunId;
  const now = new Date().toISOString();
  let resultPayload = null;
  let thrownError = null;

  const firstWorkspace = createRegressionWorkspace(workspaceId, now, {
    tabIds: ["tab-a", "tab-b"],
    journalIds: ["journal-a", "journal-b"],
    timelineIds: ["event-a", "event-b"]
  });
  const secondWorkspace = createRegressionWorkspace(workspaceId, now, {
    tabIds: ["tab-a", "tab-c"],
    journalIds: ["journal-a", "journal-c"],
    timelineIds: ["event-a", "event-c"]
  });

  try {
    await saveRuntimeWorkspaceSnapshotToSessionDb(firstWorkspace, {
      savedAt: now,
      lifecycleState: "paused",
      continuationNote: "Layer 2.1H first regression snapshot."
    });
    const secondSave = await saveRuntimeWorkspaceSnapshotToSessionDb(secondWorkspace, {
      savedAt: new Date().toISOString(),
      lifecycleState: "paused",
      continuationNote: "Layer 2.1H replacement regression snapshot."
    });
    const record = await getWorkspaceMemoryRecord(workspaceId);
    const tabIds = sortedIds(record?.tabs, "workspaceTabId");
    const journalIds = sortedIds(record?.journalEntries, "journalEntryId");
    const timelineIds = sortedIds(record?.timelineEvents, "eventId");
    const assertions = {
      exactTabIdentity: sameArray(tabIds, ["tab-a", "tab-c"]),
      obsoleteTabDeleted: !tabIds.includes("tab-b"),
      exactJournalIdentity: sameArray(journalIds, ["journal-a", "journal-c"]),
      obsoleteJournalDeleted: !journalIds.includes("journal-b"),
      exactTimelineIdentity: sameArray(timelineIds, ["event-a", "event-c"]),
      obsoleteTimelineDeleted: !timelineIds.includes("event-b"),
      oneManagedSession: Array.isArray(record?.sessions) && record.sessions.length === 1,
      oneManagedProjection: Array.isArray(record?.projections) && record.projections.length === 1,
      replacementStatsRecorded: secondSave?.replacementStats?.workspaceTabs?.deletedObsoleteCount === 1
        && secondSave?.replacementStats?.journalEntries?.deletedObsoleteCount === 1
        && secondSave?.replacementStats?.timelineEvents?.deletedObsoleteCount === 1
    };

    resultPayload = {
      assertions,
      evidence: {
        workspaceId,
        tabIds,
        journalIds,
        timelineIds,
        replacementStats: secondSave.replacementStats,
        persistenceMode: secondSave.bridgeStatus?.migrationMode || ""
      }
    };
  } catch (error) {
    thrownError = error;
  }

  const cleanup = await deleteRegressionWorkspace(workspaceId);
  if (thrownError) throw thrownError;

  resultPayload.assertions.temporaryWorkspaceRemoved = cleanup.complete === true;
  return {
    passed: allTrue(resultPayload.assertions),
    assertions: resultPayload.assertions,
    evidence: resultPayload.evidence,
    cleanup
  };
}

async function runResumeRegression() {
  const activeBefore = await getActiveWorkspaceRuntime();
  const workspaceId = activeBefore?.workspaceId || "";
  const record = workspaceId ? await getWorkspaceMemoryRecord(workspaceId) : null;

  if (!record || !(record.tabs || []).some((tab) => /^https?:\/\//i.test(tab?.url || ""))) {
    return {
      passed: false,
      assertions: { savedWorkspaceAvailable: false },
      evidence: { workspaceId, reason: "active_workspace_memory_record_with_web_tab_required" },
      cleanup: { complete: true, createdTabIds: [], remainingTabIds: [] }
    };
  }

  const firstOperation = resumeWorkspaceMemoryRecordSafely(record, {
    source: "layer2_1h_duplicate_guard_primary",
    validationMode: VALIDATION_MODE,
    bypassAlreadyActiveGuard: true,
    testHoldBeforeBrowserMutationMs: 650,
    testFailureBeforeBrowserMutation: true
  }).catch((error) => error);

  await delay(100);

  const secondOperation = resumeWorkspaceMemoryRecordSafely(record, {
    source: "layer2_1h_duplicate_guard_secondary",
    validationMode: VALIDATION_MODE,
    bypassAlreadyActiveGuard: true,
    testFailureBeforeBrowserMutation: true
  }).catch((error) => error);

  const [firstResult, secondResult] = await Promise.all([firstOperation, secondOperation]);
  const focusBefore = await captureActiveBrowserFocus();
  let rollbackResult = null;

  try {
    await resumeWorkspaceMemoryRecordSafely(record, {
      source: "layer2_1h_controlled_rollback",
      validationMode: VALIDATION_MODE,
      bypassAlreadyActiveGuard: true,
      keepCreatedTabsInBackground: true,
      testFailureAfterOpenedTabCount: 1
    });
  } catch (error) {
    rollbackResult = error;
  }

  const activeAfter = await getActiveWorkspaceRuntime();
  const focusAfter = await captureActiveBrowserFocus();
  const rollback = rollbackResult?.details?.rollback || null;
  const assertions = {
    firstOperationControlled: firstResult instanceof WorkspaceResumeOperationError && firstResult.code === "resume_controlled_validation_failure",
    secondOperationBlocked: secondResult instanceof WorkspaceResumeOperationError && secondResult.code === "resume_operation_in_progress",
    rollbackControlledFailure: rollbackResult instanceof WorkspaceResumeOperationError && rollbackResult.code === "resume_controlled_validation_failure",
    oneProvisionalTabCreated: rollback?.createdTabIds?.length === 1,
    provisionalTabsRemoved: rollback?.remainingTabIds?.length === 0,
    rollbackComplete: rollback?.complete === true,
    focusRestored: rollback?.focusRestored === true && sameBrowserFocus(focusBefore, focusAfter),
    activeRuntimePreserved: stableStringify(activeBefore) === stableStringify(activeAfter)
  };

  return {
    passed: allTrue(assertions),
    assertions,
    evidence: {
      workspaceId,
      firstOperationCode: firstResult?.code || "",
      secondOperationCode: secondResult?.code || "",
      rollbackOperationCode: rollbackResult?.code || "",
      focusBefore,
      focusAfter,
      rollback
    },
    cleanup: {
      createdTabIds: rollback?.createdTabIds || [],
      remainingTabIds: rollback?.remainingTabIds || [],
      complete: rollback?.complete === true && rollback?.remainingTabIds?.length === 0
    }
  };
}

async function runArchiveOwnershipRegression(context) {
  const focusBefore = await captureActiveBrowserFocus();
  let testTab = null;
  let verification = null;
  let stillLiveBeforeCleanup = false;
  let cleanupError = null;

  try {
    testTab = await chrome.tabs.create({ url: "about:blank", active: false });
    await delay(120);
    const liveTab = await chrome.tabs.get(testTab.id);
    verification = await verifySavedWorkspaceTabAgainstCurrentLiveTab({
      workspaceTabId: "layer2-1h-unrelated-tab",
      tabId: liveTab.id,
      windowId: liveTab.windowId,
      groupId: liveTab.groupId,
      isOpen: true,
      url: "https://not-owned.invalid/regression",
      originalTitle: liveTab.title || "Background test tab",
      tabKey: "https://not-owned.invalid/regression::" + (liveTab.title || "Background test tab")
    });
    stillLiveBeforeCleanup = await tabExists(liveTab.id);
  } finally {
    if (Number.isInteger(testTab?.id)) {
      try {
        if (await tabExists(testTab.id)) await chrome.tabs.remove(testTab.id);
      } catch (error) {
        cleanupError = summarizeError(error);
      }
    }
  }

  const removed = Number.isInteger(testTab?.id) ? !(await tabExists(testTab.id)) : false;
  const focusAfterCleanup = await captureActiveBrowserFocus();
  if (!sameBrowserFocus(focusBefore, focusAfterCleanup)) await restoreBrowserFocus(focusBefore);
  const focusAfterRestore = await captureActiveBrowserFocus();
  const assertions = {
    numericIdMatchedCandidate: verification?.identityEvidence?.idMatches === true,
    ownershipRejected: verification?.verified === false,
    mismatchReasonIsUrl: verification?.reason === "live_url_mismatch",
    unrelatedTabRemainedOpenBeforeHarnessCleanup: stillLiveBeforeCleanup,
    testTabRemovedByHarness: removed,
    browserFocusPreserved: sameBrowserFocus(focusBefore, focusAfterRestore),
    cleanupErrorAbsent: cleanupError == null
  };

  if (cleanupError) {
    await appendRuntimeDiagnostic("error", "layer2_1h_archive_test_cleanup_failed", "Could not remove the Layer 2.1H archive ownership test tab.", {
      regressionRunId: context.regressionRunId,
      correlationId: context.regressionRunId,
      operationId: context.operationId,
      caseId: context.caseId,
      testTabId: testTab?.id || null,
      error: cleanupError
    });
  }

  return {
    passed: allTrue(assertions),
    assertions,
    evidence: {
      testTabId: testTab?.id || null,
      verificationReason: verification?.reason || "",
      identityEvidence: verification?.identityEvidence || null,
      focusBefore,
      focusAfterRestore
    },
    cleanup: { testTabId: testTab?.id || null, removed, error: cleanupError, complete: removed && cleanupError == null }
  };
}

async function runLegacyProjectionCleanupRegression() {
  const restoreEventId = crypto.randomUUID();
  const workspace = {
    workspaceId: "layer2-1h-legacy-synthetic",
    name: "Layer 2.1H legacy cleanup synthetic workspace",
    tabs: [
      createLegacySyntheticTab("legacy-a", 101, 201, 301, "https://example.test/a"),
      createLegacySyntheticTab("legacy-b", 102, 202, 302, "https://example.test/b"),
      createLegacySyntheticTab("legacy-c", 103, 203, 303, "https://example.test/c")
    ],
    journal: [],
    timeline: [{
      eventId: restoreEventId,
      type: "archive_restored",
      restoredWorkspaceTabIds: ["legacy-a", "legacy-c"],
      createdAt: new Date().toISOString()
    }]
  };
  const result = await sanitizeLegacyRestoredWorkspaceProjection(workspace, {
    restoreEvent: workspace.timeline[0],
    resolveLiveTab: async (tabId) => {
      if (tabId === 101) return { id: 101, windowId: 901, groupId: 17, url: "https://example.test/a", title: "Synthetic A" };
      throw new Error("Synthetic tab is not live.");
    }
  });
  const reopened = result.workspace.tabs.find((tab) => tab.workspaceTabId === "legacy-a");
  const notReopened = result.workspace.tabs.find((tab) => tab.workspaceTabId === "legacy-b");
  const failed = result.workspace.tabs.find((tab) => tab.workspaceTabId === "legacy-c");
  const assertions = {
    reopenedVerifiedLive: reopened?.tabId === 101 && reopened?.windowId === 901 && reopened?.groupId === 17 && reopened?.isOpen === true,
    notReopenedCleared: projectionIdentifiersCleared(notReopened),
    failedReopenCleared: projectionIdentifiersCleared(failed),
    exactClassificationCounts: result.summary.reopenedVerifiedCount === 1
      && result.summary.notReopenedClearedCount === 1
      && result.summary.failedVerificationCount === 1,
    noStaleIdentifiers: result.summary.staleIdentifierCountAfterCleanup === 0
  };

  return {
    passed: allTrue(assertions),
    assertions,
    evidence: { summary: result.summary },
    cleanup: { browserMutationExecuted: false, activeRuntimeChanged: false, complete: true }
  };
}

async function prepareHardeningPacket() {
  const result = await chrome.storage.local.get(EVIDENCE_KEY);
  const evidence = result[EVIDENCE_KEY] || null;
  const packet = buildHardeningPacket(evidence);
  const output = document.getElementById("layer2HardeningRegressionHarnessOutput");
  const copyButton = document.getElementById("copyLayer2HardeningRegressionPacketButton");

  if (output) output.textContent = JSON.stringify(packet, null, 2);
  if (copyButton) copyButton.disabled = false;
  setStatus("Hardening packet prepared: " + packet.validation.status + ".");

  await appendRuntimeDiagnostic("info", "layer2_hardening_regression_packet_prepared", "Layer 2.1H hardening regression packet prepared.", {
    regressionRunId: evidence?.regressionRunId || "",
    correlationId: evidence?.regressionRunId || "",
    schema: PACKET_SCHEMA,
    status: packet.validation.status,
    passedCheckCount: packet.validation.passedCheckCount,
    failedCheckCount: packet.validation.failedCheckCount
  });
}

async function copyHardeningPacket() {
  const output = document.getElementById("layer2HardeningRegressionHarnessOutput");
  if (!output?.textContent?.trim()) return setStatus("Prepare the hardening packet before copying.");
  await navigator.clipboard.writeText(buildClipboardEnvelope(output.textContent));
  setStatus("Hardening regression packet copied.");
}

function buildHardeningPacket(evidence) {
  const cases = Array.isArray(evidence?.cases) ? evidence.cases : [];
  const byId = new Map(cases.map((testCase) => [testCase.caseId, testCase]));
  const operationIds = cases.map((testCase) => testCase.operationId).filter(Boolean);
  const checks = [
    createCheck("dedicated_regression_evidence_exists", Boolean(evidence?.regressionRunId), "Dedicated correlated regression evidence exists."),
    createCheck("diagnostic_concurrency_passed", byId.get("diagnostic_concurrency")?.passed === true, "Concurrent correlated diagnostic writes were preserved."),
    createCheck("exact_snapshot_replacement_passed", byId.get("exact_snapshot_replacement")?.passed === true, "Exact Session DB snapshot replacement regression passed."),
    createCheck("temporary_snapshot_workspace_removed", byId.get("exact_snapshot_replacement")?.cleanup?.complete === true, "Temporary Session DB regression workspace was removed."),
    createCheck("resume_duplicate_and_rollback_passed", byId.get("resume_duplicate_and_rollback")?.passed === true, "Resume duplicate guard and controlled rollback regression passed."),
    createCheck("resume_provisional_resources_removed", byId.get("resume_duplicate_and_rollback")?.cleanup?.complete === true, "Resume provisional browser resources were removed."),
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
    extension: { name: "Chrome Flow", schema: PACKET_SCHEMA },
    source: {
      type: "layer2_hardening_regression_packet",
      developerOnly: true,
      evidenceAuthority: "dedicated local regression evidence",
      diagnosticRingAuthority: false,
      activeRuntimeAuthority: "chrome.storage.local",
      longTermMemoryAuthority: "Session DB / IndexedDB"
    },
    validation: {
      status: failedChecks.length ? "needs_attention" : "layer2_hardening_regression_validated",
      passedCheckCount: passedChecks.length,
      warningCheckCount: 0,
      failedCheckCount: failedChecks.length,
      checkCount: checks.length,
      checks,
      failedChecks,
      warningChecks: []
    },
    regressionRun: evidence,
    nextDecision: {
      recommendation: failedChecks.length ? "repair_failed_layer2_hardening_regression_case" : "proceed_to_final_codex_high_level_review",
      notes: [
        "Packet truth comes from dedicated run evidence rather than bounded diagnostic history.",
        "The suite executes the repaired persistence, resume, archive ownership, legacy cleanup, and diagnostic correlation paths.",
        "Temporary browser and Session DB resources must be removed before the suite can pass."
      ]
    }
  };
}

function createRegressionWorkspace(workspaceId, now, identity) {
  return {
    workspaceId,
    name: "Layer 2.1H Temporary Regression Workspace",
    aim: "Verify exact atomic snapshot replacement.",
    workspaceType: "research",
    createdAt: now,
    updatedAt: now,
    tabs: identity.tabIds.map((workspaceTabId, index) => ({
      workspaceTabId,
      tabId: 8000 + index,
      windowId: 9000,
      groupId: -1,
      isOpen: true,
      url: "https://example.test/" + workspaceTabId,
      originalTitle: workspaceTabId,
      title: workspaceTabId,
      alias: "",
      role: "reference",
      firstSeenAt: now,
      lastSeenAt: now
    })),
    journal: identity.journalIds.map((entryId) => ({ entryId, text: entryId, createdAt: now })),
    timeline: identity.timelineIds.map((eventId) => ({ eventId, type: "regression_event", message: eventId, createdAt: now }))
  };
}

async function deleteRegressionWorkspace(workspaceId) {
  const storeNames = [
    SESSION_DB_SCHEMA.stores.workspaces,
    SESSION_DB_SCHEMA.stores.workspaceTabs,
    SESSION_DB_SCHEMA.stores.sessions,
    SESSION_DB_SCHEMA.stores.projections,
    SESSION_DB_SCHEMA.stores.journalEntries,
    SESSION_DB_SCHEMA.stores.timelineEvents,
    SESSION_DB_SCHEMA.stores.summaryCards
  ];
  const cleanup = { attempted: true, complete: false, workspaceId, remainingRecord: null, error: null };

  try {
    await runSessionDbTransaction(storeNames, "readwrite", (stores) => {
      stores.get(SESSION_DB_SCHEMA.stores.workspaces).delete(workspaceId);
      for (const storeName of storeNames.filter((name) => name !== SESSION_DB_SCHEMA.stores.workspaces)) {
        const store = stores.get(storeName);
        const request = store.index("workspaceId").getAllKeys(workspaceId);
        request.onsuccess = () => {
          for (const key of request.result || []) store.delete(key);
        };
      }
    });

    cleanup.remainingRecord = await getWorkspaceMemoryRecord(workspaceId);
    cleanup.complete = !cleanup.remainingRecord;
  } catch (error) {
    cleanup.error = summarizeError(error);
  }

  return cleanup;
}

function createLegacySyntheticTab(workspaceTabId, tabId, windowId, groupId, url) {
  return { workspaceTabId, tabId, windowId, groupId, isOpen: true, url, title: "Synthetic " + workspaceTabId };
}

function projectionIdentifiersCleared(tab) {
  return tab?.tabId == null && tab?.windowId == null && tab?.groupId === -1 && tab?.isOpen === false;
}

function sortedIds(records, key) {
  return (Array.isArray(records) ? records : []).map((record) => record?.[key]).filter(Boolean).sort();
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function allTrue(assertions) {
  return Object.values(assertions).every(Boolean);
}

async function captureActiveBrowserFocus() {
  const [windowInfo, tabs] = await Promise.all([
    globalThis.chrome?.windows?.getLastFocused ? chrome.windows.getLastFocused().catch(() => null) : null,
    globalThis.chrome?.tabs?.query ? chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []) : []
  ]);
  return {
    windowId: Number.isInteger(windowInfo?.id) ? windowInfo.id : null,
    tabId: Number.isInteger(tabs?.[0]?.id) ? tabs[0].id : null
  };
}

function sameBrowserFocus(left, right) {
  return left?.windowId === right?.windowId && left?.tabId === right?.tabId;
}

async function restoreBrowserFocus(focus) {
  try {
    if (Number.isInteger(focus?.windowId) && globalThis.chrome?.windows?.update) await chrome.windows.update(focus.windowId, { focused: true });
    if (Number.isInteger(focus?.tabId) && globalThis.chrome?.tabs?.update) await chrome.tabs.update(focus.tabId, { active: true });
  } catch (_error) {
    // Best-effort test cleanup only.
  }
}

async function tabExists(tabId) {
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch (_error) {
    return false;
  }
}

function createCheck(check, condition, message) {
  return { check, status: condition ? "pass" : "fail", severity: "layer2_1h_hardening", message };
}

function setButtonsDisabled(disabled) {
  for (const id of ["runLayer2HardeningRegressionHarnessButton", "prepareLayer2HardeningRegressionPacketButton", "copyLayer2HardeningRegressionPacketButton"]) {
    const button = document.getElementById(id);
    if (button) button.disabled = disabled || (id === "copyLayer2HardeningRegressionPacketButton" && !document.getElementById("layer2HardeningRegressionHarnessOutput")?.textContent?.trim());
  }
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

function stableStringify(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stableStringify(value[key])).join(",") + "}";
}

function summarizeError(error) {
  if (!error) return { message: "Unknown error" };
  return {
    name: error.name || "Error",
    message: error.message || String(error),
    code: error.code || "",
    details: error.details || {},
    stack: typeof error.stack === "string" ? error.stack.slice(0, 2000) : ""
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
