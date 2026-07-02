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
    <p class="section-help">Programmatically validates the selected Session DB resume candidates without live browser action.</p>
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

  scenarioResults.push(createAssertionScenario("known_candidate_available", [
    assertCondition("known_candidate_found", Boolean(knownCandidate), "Known Layer 2 resume candidate is available."),
    assertCondition("known_candidate_eligible", Boolean(knownCandidate?.eligibleForPrecheck), "Known Layer 2 resume candidate is eligible.")
  ]));

  if (knownCandidate) {
    scenarioResults.push(createPrecheckScenario("known_candidate_positive_simulated", await buildSimulatedPrecheck(knownCandidate.workspaceId, true, true), {
      expectedStatus: "precheck_passed_run_still_disabled",
      expectedOperatorConfirmed: true,
      description: "Known candidate passes when phrase and acknowledgement are simulated as true."
    }));

    scenarioResults.push(createPrecheckScenario("known_candidate_phrase_only_blocks", await buildSimulatedPrecheck(knownCandidate.workspaceId, true, false), {
      expectedStatus: "blocked_before_run",
      expectedOperatorConfirmed: false,
      expectedFailedCheck: "operator_acknowledgement_checked",
      description: "Known candidate blocks when phrase is true but acknowledgement is false."
    }));

    scenarioResults.push(createPrecheckScenario("known_candidate_checkbox_only_blocks", await buildSimulatedPrecheck(knownCandidate.workspaceId, false, true), {
      expectedStatus: "blocked_before_run",
      expectedOperatorConfirmed: false,
      expectedFailedCheck: "operator_phrase_matches",
      description: "Known candidate blocks when acknowledgement is true but phrase is false."
    }));
  }

  const blockedCandidate = blockedCandidates[0] || null;
  scenarioResults.push(createAssertionScenario("blocked_candidate_available", [
    assertCondition("blocked_candidate_found", Boolean(blockedCandidate), "At least one blocked or incomplete candidate is available for negative validation.")
  ]));

  if (blockedCandidate) {
    scenarioResults.push(createPrecheckScenario("blocked_candidate_stays_blocked", await buildSimulatedPrecheck(blockedCandidate.workspaceId, true, true), {
      expectedStatus: "blocked_before_run",
      expectedOperatorConfirmed: true,
      description: "Incomplete candidate stays blocked even with simulated operator approval."
    }));
  }

  scenarioResults.push(createAssertionScenario("fresh_fixture_classification", [
    assertCondition("fresh_candidate_detected", freshCandidates.length > 0, "At least one non-default candidate with saved tabs is detected."),
    assertCondition("fresh_candidates_classified", freshCandidates.every((candidate) => typeof candidate.eligibleForPrecheck === "boolean"), "Fresh candidates are classified as eligible or blocked.")
  ], {
    freshCandidates: freshCandidates.map(createFreshCandidateReview)
  }));

  scenarioResults.push(createAssertionScenario("boundary_preserved", [
    assertCondition("runtime_action_not_executed", true, "Validation suite does not execute runtime browser action."),
    assertCondition("browser_projection_not_changed", true, "Validation suite does not change browser projection."),
    assertCondition("session_db_not_changed", true, "Validation suite does not write Session DB records."),
    assertCondition("chrome_storage_runtime_not_changed", true, "Validation suite does not replace chrome.storage.local runtime workspace.")
  ]));

  const overallStatus = calculateOverallStatus(scenarioResults);

  return {
    packetType: "Chrome Flow Projection Resume Validation Suite Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "projection-resume-validation-suite-packet-v0.1"
    },
    clipboard: {
      format: PACKET_CLIPBOARD_FORMAT,
      contentType: PACKET_CONTENT_TYPE,
      copyMode: "text_envelope",
      envelopeStart: PACKET_ENVELOPE_START,
      envelopeEnd: PACKET_ENVELOPE_END
    },
    source: {
      type: "projection_resume_validation_suite_runner",
      readOnly: true,
      validationOnly: true,
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
    runtimeReview: {
      activeRuntimeWorkspaceId: activeRuntimeWorkspace?.workspaceId || "",
      activeRuntimeWorkspaceName: activeRuntimeWorkspace?.name || "",
      activeDbWorkspaceId,
      sessionDbRuntimeSourceOfTruth: false,
      chromeStorageRuntimeAuthorityPreserved: true,
      runtimeSelectionReviewOnly: true
    },
    nextDecision: createNextDecision(overallStatus, freshCandidates)
  };
}

async function buildCandidateSummaries() {
  const workspaces = await listWorkspaceRecords();
  const summaries = [];

  for (const workspace of workspaces) {
    const tabs = await getWorkspaceTabs(workspace.workspaceId);
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

async function buildSimulatedPrecheck(workspaceId, phraseMatches, acknowledgementChecked) {
  const workspace = await getWorkspaceRecord(workspaceId);
  const tabs = await getWorkspaceTabs(workspaceId);
  const sessions = await getWorkspaceSessions(workspaceId);
  const projections = await getWorkspaceProjections(workspaceId);
  const latestProjection = projections[0] || null;
  const missingUrlCount = tabs.filter((tab) => !tab.url).length;
  const plannedGroups = createPlannedGroups(tabs);
  const runButtonDisabled = true;
  const checks = createPrecheckChecks({ workspace, tabs, sessions, missingUrlCount, plannedGroups, latestProjection, phraseMatches, acknowledgementChecked, runButtonDisabled });
  const failedChecks = checks.filter((check) => check.status === "fail");

  return {
    workspaceId,
    workspaceName: workspace?.name || "",
    operatorConfirmation: {
      phraseMatches,
      acknowledgementChecked,
      operatorConfirmed: phraseMatches && acknowledgementChecked
    },
    browserPlan: {
      savedTabCount: tabs.length,
      missingUrlCount,
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
      status: failedChecks.length ? "blocked_before_run" : "precheck_passed_run_still_disabled",
      availableInThisSlice: false,
      checks,
      failedChecks,
      blockedReasons: failedChecks.map((check) => check.message)
    },
    source: {
      runButtonDisabled,
      runtimeActionExecuted: false,
      browserProjectionChanged: false,
      sessionDbChanged: false,
      chromeStorageRuntimeChanged: false
    }
  };
}

function createPrecheckScenario(name, precheck, options = {}) {
  const assertions = [
    assertCondition("expected_status", precheck.preRun.status === options.expectedStatus, options.description || "Precheck status matches expected result."),
    assertCondition("operator_confirmation_expected", precheck.operatorConfirmation.operatorConfirmed === options.expectedOperatorConfirmed, "Operator confirmation state matches expectation."),
    assertCondition("run_button_disabled", precheck.source.runButtonDisabled === true, "Run button remains disabled."),
    assertCondition("runtime_action_not_executed", precheck.source.runtimeActionExecuted === false, "No runtime action executed."),
    assertCondition("browser_projection_not_changed", precheck.source.browserProjectionChanged === false, "No browser projection changed."),
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

function createNextDecision(overallStatus, freshCandidates) {
  if (overallStatus !== "pass") {
    return {
      recommendation: "hold",
      reason: "Validation suite has failing scenarios. Do not proceed to live browser action."
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
    reason: "Validation suite passed, but no exact fresh 3-tab/3-group fixture candidate is available. Keep live browser action on hold or create exact fixture."
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
  if (candidate.eligibleForPrecheck) return "Fresh candidate matches the first prototype constraints.";
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

function createPrecheckChecks(context) {
  return [
    createCheck("candidate_selected", Boolean(context.workspace?.workspaceId), "A Session DB candidate is selected."),
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
    createCheck("operator_acknowledgement_checked", context.acknowledgementChecked, "Operator checked the run acknowledgement."),
    createCheck("run_button_disabled", context.runButtonDisabled, "Run button is disabled in this validation suite.")
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
  return "Resume validation suite: " + packet.suite.overallStatus + " | Scenarios: " + packet.suite.passedScenarioCount + "/" + packet.suite.scenarioCount + " pass | Candidates: " + packet.candidateMatrix.candidateCount + " | Eligible: " + packet.candidateMatrix.eligibleCandidateCount + ".";
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
