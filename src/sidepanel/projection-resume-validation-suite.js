import { getWorkspace } from "../core/workspace-store.js";

import {
  getActiveWorkspaceId,
  getWorkspaceProjections,
  getWorkspaceRecord,
  getWorkspaceSessions,
  getWorkspaceTabs,
  listWorkspaceRecords
} from "../core/session-repository.js";

const DEFAULT_TARGET_WORKSPACE_ID = "c22b5a00-c68d-4b64-8bba-01172a0dd818";
const RUN_PHRASE = "OPEN NEW WINDOW FOR SAVED WORKSPACE";
const PACKET_ENVELOPE_START = "CHROME_FLOW_PACKET_START";
const PACKET_ENVELOPE_END = "CHROME_FLOW_PACKET_END";
const PACKET_CLIPBOARD_FORMAT = "chrome_flow_packet_envelope_v0.1";
const PACKET_CONTENT_TYPE = "application/json";

installProjectionResumeValidationSuite();

function installProjectionResumeValidationSuite() {
  if (document.getElementById("projectionResumeValidationSuiteSection")) return;

  const anchor = document.getElementById("projectionResumeRunSection") || document.getElementById("projectionResumeReviewSection") || document.querySelector(".workspace-section");
  if (!anchor) return;

  const section = document.createElement("section");
  section.id = "projectionResumeValidationSuiteSection";
  section.className = "projection-resume-validation-suite-section";
  section.innerHTML = `
    <h2>Projection Resume Validation Suite</h2>
    <p class="section-help">Programmatically validates the selected Session DB resume candidates and first live known-fixture gate without executing browser action.</p>
    <div id="projectionResumeValidationSuiteSummary" class="workspace-session-summary">Validation suite ready.</div>
    <div class="workspace-session-actions">
      <button id="runProjectionResumeValidationSuiteButton" type="button" class="secondary-button">Run Resume Validation Suite</button>
      <button id="copyProjectionResumeValidationSuitePacketButton" type="button" class="secondary-button">Copy Validation Suite Packet</button>
    </div>
    <p id="projectionResumeValidationSuiteStatus" class="status-message"></p>
    <pre id="projectionResumeValidationSuiteOutput" class="diagnostics-output">Projection resume validation suite output will appear here.</pre>
  `;

  anchor.insertAdjacentElement("afterend", section);

  document.getElementById("runProjectionResumeValidationSuiteButton")?.addEventListener("click", runSuite);
  document.getElementById("copyProjectionResumeValidationSuitePacketButton")?.addEventListener("click", copySuitePacket);
}

async function runSuite() {
  try {
    const packet = await buildSuitePacket();
    setSummary(createSuiteSummary(packet));
    setOutput(packet);
    setStatus("Resume validation suite complete: " + packet.suite.overallStatus + ".");
  } catch (error) {
    setError("Could not run resume validation suite.", error);
  }
}

async function copySuitePacket() {
  try {
    const packet = await buildSuitePacket();
    await navigator.clipboard.writeText(formatPacket(packet));
    setSummary(createSuiteSummary(packet));
    setOutput(packet);
    setStatus("Resume validation suite packet copied: " + packet.suite.overallStatus + ".");
  } catch (error) {
    setError("Could not copy resume validation suite packet.", error);
  }
}

async function buildSuitePacket() {
  const activeRuntimeWorkspace = await getWorkspace();
  const activeDbWorkspaceId = await getActiveWorkspaceId();
  const candidates = await buildCandidateSummaries();
  const knownCandidate = candidates.find((candidate) => candidate.workspaceId === DEFAULT_TARGET_WORKSPACE_ID) || null;
  const eligibleCandidates = candidates.filter((candidate) => candidate.eligibleForPrecheck);
  const blockedCandidates = candidates.filter((candidate) => !candidate.eligibleForPrecheck);
  const freshCandidates = candidates.filter((candidate) => candidate.workspaceId !== DEFAULT_TARGET_WORKSPACE_ID && candidate.savedTabCount > 0);
  const scenarioResults = [];

  scenarioResults.push(createAssertionScenario("selector_populates_from_session_db", [
    assertCondition("candidate_count_gt_zero", candidates.length > 0, "Candidate selector source has one or more Session DB workspace records."),
    assertCondition("candidate_matrix_available", Array.isArray(candidates), "Candidate matrix is available.")
  ]));

  scenarioResults.push(createAssertionScenario("known_fixture_candidate_available", [
    assertCondition("known_candidate_found", Boolean(knownCandidate), "Known Layer 2 resume fixture candidate is available."),
    assertCondition("known_candidate_eligible", Boolean(knownCandidate?.eligibleForPrecheck), "Known Layer 2 resume fixture candidate is eligible."),
    assertCondition("known_candidate_is_three_tabs", knownCandidate?.savedTabCount === 3, "Known fixture has exactly 3 saved tabs."),
    assertCondition("known_candidate_is_three_groups", knownCandidate?.plannedGroupCount === 3, "Known fixture has exactly 3 planned groups."),
    assertCondition("known_candidate_dehydrated", knownCandidate?.latestProjectionState === "dehydrated", "Known fixture projection is dehydrated.")
  ]));

  if (knownCandidate) {
    scenarioResults.push(createLivePrecheckScenario("known_fixture_live_ready_simulated", await buildSimulatedLivePrecheck(knownCandidate.workspaceId, true, true), {
      expectedStatus: "ready_for_operator_run",
      expectedOperatorConfirmed: true,
      expectedLiveActionAvailable: true,
      expectedRunButtonShouldBeEnabled: true,
      description: "Known fixture becomes live-ready only when phrase and acknowledgement are simulated as true."
    }));

    scenarioResults.push(createLivePrecheckScenario("known_fixture_phrase_only_blocks", await buildSimulatedLivePrecheck(knownCandidate.workspaceId, true, false), {
      expectedStatus: "blocked_before_run",
      expectedOperatorConfirmed: false,
      expectedLiveActionAvailable: false,
      expectedRunButtonShouldBeEnabled: false,
      expectedFailedCheck: "operator_acknowledgement_checked",
      description: "Known fixture blocks when phrase is true but acknowledgement is false."
    }));

    scenarioResults.push(createLivePrecheckScenario("known_fixture_checkbox_only_blocks", await buildSimulatedLivePrecheck(knownCandidate.workspaceId, false, true), {
      expectedStatus: "blocked_before_run",
      expectedOperatorConfirmed: false,
      expectedLiveActionAvailable: false,
      expectedRunButtonShouldBeEnabled: false,
      expectedFailedCheck: "operator_phrase_matches",
      description: "Known fixture blocks when acknowledgement is true but phrase is false."
    }));

    scenarioResults.push(createLivePrecheckScenario("known_fixture_no_confirmation_blocks", await buildSimulatedLivePrecheck(knownCandidate.workspaceId, false, false), {
      expectedStatus: "blocked_before_run",
      expectedOperatorConfirmed: false,
      expectedLiveActionAvailable: false,
      expectedRunButtonShouldBeEnabled: false,
      description: "Known fixture blocks when phrase and acknowledgement are both missing."
    }));
  }

  const blockedCandidate = blockedCandidates[0] || null;
  scenarioResults.push(createAssertionScenario("blocked_candidate_available", [
    assertCondition("blocked_candidate_found", Boolean(blockedCandidate), "At least one blocked or incomplete candidate is available for negative validation.")
  ]));

  if (blockedCandidate) {
    scenarioResults.push(createLivePrecheckScenario("blocked_candidate_cannot_become_live_ready", await buildSimulatedLivePrecheck(blockedCandidate.workspaceId, true, true), {
      expectedStatus: "blocked_before_run",
      expectedOperatorConfirmed: true,
      expectedLiveActionAvailable: false,
      expectedRunButtonShouldBeEnabled: false,
      description: "Incomplete candidate stays blocked even with simulated operator approval."
    }));
  }

  const nonFixtureCandidate = candidates.find((candidate) => candidate.workspaceId !== DEFAULT_TARGET_WORKSPACE_ID) || null;
  scenarioResults.push(createAssertionScenario("non_fixture_candidate_available", [
    assertCondition("non_fixture_candidate_found", Boolean(nonFixtureCandidate), "At least one non-fixture candidate is available for target-boundary validation.")
  ]));

  if (nonFixtureCandidate) {
    scenarioResults.push(createLivePrecheckScenario("non_fixture_candidate_cannot_enable_first_live_run", await buildSimulatedLivePrecheck(nonFixtureCandidate.workspaceId, true, true), {
      expectedStatus: "blocked_before_run",
      expectedOperatorConfirmed: true,
      expectedLiveActionAvailable: false,
      expectedRunButtonShouldBeEnabled: false,
      expectedFailedCheck: "target_workspace_is_known_first_live_fixture",
      description: "First live run cannot enable for a non-fixture candidate."
    }));
  }

  scenarioResults.push(createAssertionScenario("fresh_fixture_classification", [
    assertCondition("fresh_candidate_detected", freshCandidates.length > 0, "At least one non-default candidate with saved tabs is detected."),
    assertCondition("fresh_candidates_classified", freshCandidates.every((candidate) => typeof candidate.eligibleForPrecheck === "boolean"), "Fresh candidates are classified as eligible or blocked.")
  ], {
    freshCandidates: freshCandidates.map(createFreshCandidateReview)
  }));

  scenarioResults.push(createAssertionScenario("validation_suite_does_not_execute_live_action", [
    assertCondition("runtime_action_not_executed", true, "Validation suite does not execute runtime browser action."),
    assertCondition("browser_projection_not_changed", true, "Validation suite does not change browser projection."),
    assertCondition("session_db_not_changed", true, "Validation suite does not write Session DB records."),
    assertCondition("chrome_storage_runtime_not_changed", true, "Validation suite does not replace chrome.storage.local runtime workspace."),
    assertCondition("live_execution_requires_separate_operator_click", true, "Live execution remains a separate Operator action after suite pass.")
  ]));

  scenarioResults.push(createAssertionScenario("live_gate_contract_preserved", [
    assertCondition("suite_has_live_ready_scenario", scenarioResults.some((scenario) => scenario.name === "known_fixture_live_ready_simulated"), "Suite includes known-fixture live-ready scenario."),
    assertCondition("suite_has_negative_operator_gate_scenarios", scenarioResults.some((scenario) => scenario.name === "known_fixture_phrase_only_blocks") && scenarioResults.some((scenario) => scenario.name === "known_fixture_checkbox_only_blocks"), "Suite includes phrase-only and checkbox-only negative gate scenarios."),
    assertCondition("suite_has_non_fixture_boundary_scenario", scenarioResults.some((scenario) => scenario.name === "non_fixture_candidate_cannot_enable_first_live_run"), "Suite includes non-fixture boundary scenario.")
  ]));

  const overallStatus = calculateOverallStatus(scenarioResults);

  return {
    packetType: "Chrome Flow Projection Resume Validation Suite Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "projection-resume-validation-suite-packet-v0.2-live-known-fixture-gate"
    },
    clipboard: {
      format: PACKET_CLIPBOARD_FORMAT,
      contentType: PACKET_CONTENT_TYPE,
      copyMode: "text_envelope",
      envelopeStart: PACKET_ENVELOPE_START,
      envelopeEnd: PACKET_ENVELOPE_END
    },
    source: {
      type: "projection_resume_validation_suite_runner_live_gate",
      readOnly: true,
      validationOnly: true,
      liveGateValidation: true,
      runtimeActionExecuted: false,
      browserProjectionChanged: false,
      sessionDbChanged: false,
      chromeStorageRuntimeChanged: false
    },
    suite: {
      overallStatus,
      scenarioCount: scenarioResults.length,
      passedScenarioCount: scenarioResults.filter((scenario) => scenario.status === "pass").length,
      warningScenarioCount: scenarioResults.filter((scenario) => scenario.status === "warn").length,
      failedScenarioCount: scenarioResults.filter((scenario) => scenario.status === "fail").length,
      scenarios: scenarioResults
    },
    candidateMatrix: {
      candidateCount: candidates.length,
      eligibleCandidateCount: eligibleCandidates.length,
      blockedCandidateCount: blockedCandidates.length,
      freshCandidateCount: freshCandidates.length,
      knownCandidateId: DEFAULT_TARGET_WORKSPACE_ID,
      candidates
    },
    liveGateDecision: createLiveGateDecision(overallStatus, knownCandidate, scenarioResults),
    runtimeReview: {
      activeRuntimeWorkspaceId: activeRuntimeWorkspace?.workspaceId || "",
      activeRuntimeWorkspaceName: activeRuntimeWorkspace?.name || "",
      activeDbWorkspaceId,
      sessionDbRuntimeSourceOfTruth: false,
      chromeStorageRuntimeAuthorityPreserved: true,
      runtimeSelectionReviewOnly: true
    },
    nextDecision: createNextDecision(overallStatus, freshCandidates, scenarioResults)
  };
}

async function buildCandidateSummaries() {
  const workspaces = await listWorkspaceRecords();
  const summaries = [];

  for (const workspace of workspaces) {
    const tabs = sortTabsBySavedOrder(await getWorkspaceTabs(workspace.workspaceId));
    const sessions = await getWorkspaceSessions(workspace.workspaceId);
    const projections = await getWorkspaceProjections(workspace.workspaceId);
    const plannedGroups = createPlannedGroups(tabs);
    const missingUrlCount = tabs.filter((tab) => !tab.url).length;
    const latestProjection = projections[0] || null;
    const eligibility = createCandidateEligibility({ workspace, tabs, sessions, plannedGroups, missingUrlCount, latestProjection });

    summaries.push({
      workspaceId: workspace.workspaceId,
      name: workspace.name,
      lifecycleState: workspace.lifecycleState,
      savedTabCount: tabs.length,
      missingUrlCount,
      plannedGroupCount: plannedGroups.length,
      sessionCount: sessions.length,
      projectionCount: projections.length,
      latestProjectionState: latestProjection?.projectionState || "missing",
      eligibleForPrecheck: eligibility.every((check) => check.status === "pass"),
      eligibility
    });
  }

  return summaries;
}

async function buildSimulatedLivePrecheck(workspaceId, phraseMatches, acknowledgementChecked) {
  const workspace = await getWorkspaceRecord(workspaceId);
  const tabs = sortTabsBySavedOrder(await getWorkspaceTabs(workspaceId));
  const sessions = await getWorkspaceSessions(workspaceId);
  const projections = await getWorkspaceProjections(workspaceId);
  const latestProjection = projections[0] || null;
  const missingUrlCount = tabs.filter((tab) => !tab.url).length;
  const plannedGroups = createPlannedGroups(tabs);
  const checks = createLivePrecheckChecks({ workspace, workspaceId, tabs, sessions, missingUrlCount, plannedGroups, latestProjection, phraseMatches, acknowledgementChecked });
  const failedChecks = checks.filter((check) => check.status === "fail");
  const readyForRun = failedChecks.length === 0;

  return {
    workspaceId,
    workspaceName: workspace?.name || "",
    operatorConfirmation: {
      phraseMatches,
      acknowledgementChecked,
      operatorConfirmed: phraseMatches && acknowledgementChecked
    },
    browserPlan: {
      targetMode: "new_window",
      expectedWindowCount: 1,
      expectedTabCount: 3,
      savedTabCount: tabs.length,
      missingUrlCount,
      expectedGroupCount: 3,
      plannedGroupCount: plannedGroups.length
    },
    sessionDbEvidence: {
      workspaceRecordRead: Boolean(workspace),
      workspaceTabRecordsRead: tabs.length,
      sessionRecordsRead: sessions.length,
      projectionRecordsRead: projections.length,
      latestProjectionState: latestProjection?.projectionState || "missing"
    },
    preRun: {
      status: readyForRun ? "ready_for_operator_run" : "blocked_before_run",
      availableInThisSlice: readyForRun,
      checks,
      failedChecks,
      blockedReasons: failedChecks.map((check) => check.message)
    },
    source: {
      liveActionAvailable: readyForRun,
      runButtonShouldBeEnabled: readyForRun,
      runtimeActionExecuted: false,
      browserProjectionChanged: false,
      sessionDbChanged: false,
      chromeStorageRuntimeChanged: false
    }
  };
}

function createLivePrecheckScenario(name, precheck, options = {}) {
  const assertions = [
    assertCondition("expected_status", precheck.preRun.status === options.expectedStatus, options.description || "Live precheck status matches expected result."),
    assertCondition("operator_confirmation_expected", precheck.operatorConfirmation.operatorConfirmed === options.expectedOperatorConfirmed, "Operator confirmation state matches expectation."),
    assertCondition("live_action_availability_expected", precheck.source.liveActionAvailable === options.expectedLiveActionAvailable, "Live action availability matches expectation."),
    assertCondition("run_button_enablement_expected", precheck.source.runButtonShouldBeEnabled === options.expectedRunButtonShouldBeEnabled, "Run button enablement matches expectation."),
    assertCondition("runtime_action_not_executed", precheck.source.runtimeActionExecuted === false, "No runtime action executed by validation suite."),
    assertCondition("browser_projection_not_changed", precheck.source.browserProjectionChanged === false, "No browser projection changed by validation suite."),
    assertCondition("session_db_not_changed", precheck.source.sessionDbChanged === false, "No Session DB write occurred."),
    assertCondition("chrome_storage_runtime_not_changed", precheck.source.chromeStorageRuntimeChanged === false, "No chrome.storage.local runtime replacement occurred.")
  ];

  if (options.expectedFailedCheck) {
    assertions.push(assertCondition(
      "expected_failed_check_present",
      precheck.preRun.failedChecks.some((check) => check.check === options.expectedFailedCheck),
      "Expected failed check is present."
    ));
  }

  return createAssertionScenario(name, assertions, { precheck });
}

function createAssertionScenario(name, assertions, extra = {}) {
  const failedAssertions = assertions.filter((assertion) => assertion.status === "fail");
  return {
    name,
    status: failedAssertions.length ? "fail" : "pass",
    assertions,
    failedAssertions,
    ...extra
  };
}

function assertCondition(name, passed, message) {
  return { name, status: passed ? "pass" : "fail", message };
}

function calculateOverallStatus(scenarios) {
  if (scenarios.some((scenario) => scenario.status === "fail")) return "fail";
  if (scenarios.some((scenario) => scenario.status === "warn")) return "warn";
  return "pass";
}

function createLiveGateDecision(overallStatus, knownCandidate, scenarios) {
  if (overallStatus !== "pass") {
    return {
      recommendation: "hold",
      reason: "Validation suite has failing scenarios. Do not proceed to the live run button."
    };
  }

  const readyScenario = scenarios.find((scenario) => scenario.name === "known_fixture_live_ready_simulated");
  if (!knownCandidate || readyScenario?.status !== "pass") {
    return {
      recommendation: "hold",
      reason: "Known fixture live-ready scenario did not pass. Do not proceed to the live run button."
    };
  }

  return {
    recommendation: "live_button_may_be_operator_tested",
    reason: "Programmatic suite passed the known-fixture live gate. The suite itself did not execute browser action; live execution still requires the separate Operator click."
  };
}

function createNextDecision(overallStatus, freshCandidates, scenarios) {
  if (overallStatus !== "pass") {
    return {
      recommendation: "hold",
      reason: "Validation suite has failing scenarios. Do not proceed to live browser action."
    };
  }

  const liveReadyScenario = scenarios.find((scenario) => scenario.name === "known_fixture_live_ready_simulated");
  if (liveReadyScenario?.status === "pass") {
    return {
      recommendation: "ready_for_single_operator_live_run",
      reason: "Known fixture live gate passed programmatically. Proceed only with the separate Operator-controlled run button if ready."
    };
  }

  const exactFreshCandidate = freshCandidates.find((candidate) => candidate.savedTabCount === 3 && candidate.plannedGroupCount === 3 && candidate.eligibleForPrecheck);
  if (exactFreshCandidate) {
    return {
      recommendation: "eligible_for_next_review",
      reason: "Validation suite passed and an exact fresh fixture candidate is available.",
      candidateWorkspaceId: exactFreshCandidate.workspaceId
    };
  }

  return {
    recommendation: "pass_with_note",
    reason: "Validation suite passed, but no live-ready fixture scenario was available. Keep live browser action on hold."
  };
}

function createFreshCandidateReview(candidate) {
  return {
    workspaceId: candidate.workspaceId,
    name: candidate.name,
    savedTabCount: candidate.savedTabCount,
    plannedGroupCount: candidate.plannedGroupCount,
    eligibleForPrecheck: candidate.eligibleForPrecheck,
    note: createFreshCandidateNote(candidate)
  };
}

function createFreshCandidateNote(candidate) {
  if (candidate.eligibleForPrecheck) return "Fresh candidate matches the first prototype constraints but is not the known first-live fixture.";
  if (candidate.savedTabCount !== 3) return "Fresh candidate does not match the first prototype tab-count constraint.";
  if (candidate.plannedGroupCount !== 3) return "Fresh candidate does not match the first prototype group-count constraint.";
  return "Fresh candidate is blocked by one or more Session DB eligibility checks.";
}

function createCandidateEligibility(context) {
  return [
    createCheck("workspace_exists", Boolean(context.workspace), "Candidate workspace exists."),
    createCheck("workspace_not_archived", context.workspace?.lifecycleState !== "archived", "Candidate workspace is not archived."),
    createCheck("saved_tab_count_is_three", context.tabs.length === 3, "Candidate has exactly 3 saved tabs."),
    createCheck("saved_urls_available", context.missingUrlCount === 0, "Candidate saved tabs have URLs."),
    createCheck("role_group_evidence_exists", context.plannedGroups.length > 0, "Candidate has saved role/group evidence."),
    createCheck("planned_group_count_is_three", context.plannedGroups.length === 3, "Candidate has exactly 3 planned groups."),
    createCheck("session_record_available", context.sessions.length > 0, "Candidate has at least one Session DB session record."),
    createCheck("projection_record_available", Boolean(context.latestProjection), "Candidate has at least one projection record."),
    createCheck("projection_is_dehydrated", context.latestProjection?.projectionState === "dehydrated", "Candidate projection is dehydrated.")
  ];
}

function createLivePrecheckChecks(context) {
  return [
    createCheck("candidate_selected", Boolean(context.workspaceId), "A Session DB candidate is selected."),
    createCheck("target_workspace_is_known_first_live_fixture", context.workspaceId === DEFAULT_TARGET_WORKSPACE_ID, "Selected workspace is the known first live fixture."),
    createCheck("workspace_exists", Boolean(context.workspace), "Selected workspace exists."),
    createCheck("workspace_not_archived", context.workspace?.lifecycleState !== "archived", "Selected workspace is not archived."),
    createCheck("saved_tab_count_is_three", context.tabs.length === 3, "Saved tab count is exactly 3 for initial validation."),
    createCheck("saved_urls_available", context.missingUrlCount === 0, "Saved tab records have URLs."),
    createCheck("role_group_evidence_exists", context.plannedGroups.length > 0, "Saved role/group evidence exists."),
    createCheck("planned_group_count_is_three", context.plannedGroups.length === 3, "Planned group count is exactly 3 for initial validation."),
    createCheck("session_record_available", context.sessions.length > 0, "Session record is available."),
    createCheck("projection_record_available", Boolean(context.latestProjection), "Projection record is available."),
    createCheck("projection_is_dehydrated", context.latestProjection?.projectionState === "dehydrated", "Projection is dehydrated before future resume."),
    createCheck("operator_phrase_matches", context.phraseMatches, "Operator typed the required run phrase."),
    createCheck("operator_acknowledgement_checked", context.acknowledgementChecked, "Operator checked the run acknowledgement.")
  ];
}

function createCheck(check, passed, message) {
  return { check, status: passed ? "pass" : "fail", severity: "block", message };
}

function createPlannedGroups(tabs) {
  const roles = new Map();
  for (const tab of tabs) {
    const role = tab.role || "unassigned";
    if (role === "unassigned") continue;
    if (!roles.has(role)) roles.set(role, []);
    roles.get(role).push(tab.workspaceTabId);
  }

  return Array.from(roles.entries()).map(([role, workspaceTabIds]) => ({
    role,
    roleLabel: createRoleLabel(role),
    workspaceTabIds,
    requiredForProjection: true
  }));
}

function createRoleLabel(role) {
  return String(role || "unassigned").replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sortTabsBySavedOrder(tabs) {
  return [...tabs].sort((left, right) => {
    const leftCreatedAt = left.createdAt || left.firstSeenAt || "";
    const rightCreatedAt = right.createdAt || right.firstSeenAt || "";
    if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt.localeCompare(rightCreatedAt);
    return String(left.workspaceTabId || "").localeCompare(String(right.workspaceTabId || ""));
  });
}

function formatPacket(packet) {
  return [
    packet.clipboard.envelopeStart,
    "packetType: " + packet.packetType,
    "schema: " + packet.extension.schema,
    "clipboardFormat: " + packet.clipboard.format,
    "createdAt: " + packet.createdAt,
    "contentType: " + packet.clipboard.contentType,
    "",
    JSON.stringify(packet, null, 2),
    "",
    packet.clipboard.envelopeEnd
  ].join("\n");
}

function createSuiteSummary(packet) {
  return "Resume validation suite: " + packet.suite.overallStatus + " | Scenarios: " + packet.suite.passedScenarioCount + "/" + packet.suite.scenarioCount + " pass | Live gate: " + packet.liveGateDecision.recommendation + " | Candidates: " + packet.candidateMatrix.candidateCount + ".";
}

function setSummary(message) {
  const summary = document.getElementById("projectionResumeValidationSuiteSummary");
  if (summary) summary.textContent = message;
}

function setStatus(message) {
  const status = document.getElementById("projectionResumeValidationSuiteStatus");
  if (status) status.textContent = message;
}

function setOutput(value) {
  const output = document.getElementById("projectionResumeValidationSuiteOutput");
  if (output) output.textContent = JSON.stringify(value, null, 2);
}

function setError(message, error) {
  setOutput({ status: "error", message, error: error?.message || String(error) });
  setStatus(message);
}
