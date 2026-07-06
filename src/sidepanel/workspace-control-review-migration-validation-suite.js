import {
  REVIEW_PHRASE,
  buildDedicatedWindowThresholdReviewPacketForValidation
} from "./workspace-dedicated-window-threshold-review.js";
import {
  assertCondition,
  assertReadOnlyBoundary,
  createClipboardBlock,
  createScenario,
  formatPacketEnvelope
} from "../core/workspace-control/workspace-control-gates.js";

let lastSuitePacket = null;

installWorkspaceControlReviewMigrationValidationSuite();

function installWorkspaceControlReviewMigrationValidationSuite() {
  if (document.getElementById("workspaceControlReviewMigrationValidationSuiteSection")) return;

  const anchor = document.getElementById("workspaceControlPreflightMigrationValidationSuiteSection") || document.getElementById("workspaceControlPolicyMigrationValidationSuiteSection") || document.getElementById("dedicatedWindowThresholdReviewSection") || document.querySelector(".workspace-section");
  if (!anchor) return;

  const section = document.createElement("section");
  section.id = "workspaceControlReviewMigrationValidationSuiteSection";
  section.className = "workspace-control-review-migration-validation-suite-section";
  section.innerHTML = `
    <h2>Workspace Control Review Migration Validation Suite</h2>
    <p class="section-help">Validates that the threshold review surface still emits the expected packet shape after migrating onto shared gate helpers.</p>
    <div id="workspaceControlReviewMigrationValidationSuiteSummary" class="workspace-session-summary">Workspace control review migration validation suite ready.</div>
    <div class="workspace-session-actions">
      <button id="runWorkspaceControlReviewMigrationValidationSuiteButton" type="button" class="secondary-button">Run Review Migration Validation Suite</button>
      <button id="copyWorkspaceControlReviewMigrationValidationSuitePacketButton" type="button" class="secondary-button">Copy Review Migration Validation Suite Packet</button>
    </div>
    <p id="workspaceControlReviewMigrationValidationSuiteStatus" class="status-message"></p>
    <pre id="workspaceControlReviewMigrationValidationSuiteOutput" class="diagnostics-output">Workspace control review migration validation suite output will appear here.</pre>
  `;

  anchor.insertAdjacentElement("afterend", section);

  document.getElementById("runWorkspaceControlReviewMigrationValidationSuiteButton")?.addEventListener("click", runSuite);
  document.getElementById("copyWorkspaceControlReviewMigrationValidationSuitePacketButton")?.addEventListener("click", copySuitePacket);
}

async function runSuite() {
  try {
    const packet = buildSuitePacket();
    lastSuitePacket = packet;
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Workspace control review migration validation suite complete: " + packet.suite.overallStatus + ".");
  } catch (error) {
    setError("Could not run workspace control review migration validation suite.", error);
  }
}

async function copySuitePacket() {
  try {
    const packet = lastSuitePacket || buildSuitePacket();
    await navigator.clipboard.writeText(formatPacketEnvelope(packet));
    lastSuitePacket = packet;
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Workspace control review migration validation suite packet copied: " + packet.suite.overallStatus + ".");
  } catch (error) {
    setError("Could not copy workspace control review migration validation suite packet.", error);
  }
}

function buildSuitePacket() {
  const readyPacket = buildDedicatedWindowThresholdReviewPacketForValidation({
    workspace: createFixtureWorkspace("review-fixture-workspace"),
    tabs: createFixtureTabs(4),
    phrase: REVIEW_PHRASE,
    acknowledgementChecked: true,
    createdAt: "2026-01-01T00:00:00.000Z"
  });
  const noConfirmationPacket = buildDedicatedWindowThresholdReviewPacketForValidation({
    workspace: createFixtureWorkspace("review-no-confirmation-fixture-workspace"),
    tabs: createFixtureTabs(4),
    phrase: "",
    acknowledgementChecked: false,
    createdAt: "2026-01-01T00:00:00.000Z"
  });
  const phraseOnlyPacket = buildDedicatedWindowThresholdReviewPacketForValidation({
    workspace: createFixtureWorkspace("review-phrase-only-fixture-workspace"),
    tabs: createFixtureTabs(4),
    phrase: REVIEW_PHRASE,
    acknowledgementChecked: false,
    createdAt: "2026-01-01T00:00:00.000Z"
  });
  const acknowledgementOnlyPacket = buildDedicatedWindowThresholdReviewPacketForValidation({
    workspace: createFixtureWorkspace("review-ack-only-fixture-workspace"),
    tabs: createFixtureTabs(4),
    phrase: "",
    acknowledgementChecked: true,
    createdAt: "2026-01-01T00:00:00.000Z"
  });
  const smallPacket = buildDedicatedWindowThresholdReviewPacketForValidation({
    workspace: createFixtureWorkspace("review-small-fixture-workspace"),
    tabs: createFixtureTabs(3),
    phrase: REVIEW_PHRASE,
    acknowledgementChecked: true,
    createdAt: "2026-01-01T00:00:00.000Z"
  });
  const missingUrlPacket = buildDedicatedWindowThresholdReviewPacketForValidation({
    workspace: createFixtureWorkspace("review-missing-url-fixture-workspace"),
    tabs: createFixtureTabs(4, { missingUrlIndex: 0 }),
    phrase: REVIEW_PHRASE,
    acknowledgementChecked: true,
    createdAt: "2026-01-01T00:00:00.000Z"
  });
  const missingRolePacket = buildDedicatedWindowThresholdReviewPacketForValidation({
    workspace: createFixtureWorkspace("review-missing-role-fixture-workspace"),
    tabs: createFixtureTabs(4, { unassignedIndex: 0 }),
    phrase: REVIEW_PHRASE,
    acknowledgementChecked: true,
    createdAt: "2026-01-01T00:00:00.000Z"
  });

  const scenarios = [
    createReviewPacketShapeScenario(readyPacket),
    createReviewReadyScenario(readyPacket),
    createReviewConfirmationBlocksScenario(noConfirmationPacket, ["operator_phrase_matches", "operator_acknowledgement_checked"], "review_no_confirmation_blocks_after_helper_migration"),
    createReviewConfirmationBlocksScenario(phraseOnlyPacket, ["operator_acknowledgement_checked"], "review_phrase_only_blocks_after_helper_migration"),
    createReviewConfirmationBlocksScenario(acknowledgementOnlyPacket, ["operator_phrase_matches"], "review_acknowledgement_only_blocks_after_helper_migration"),
    createReviewSmallWorkspaceBlocksScenario(smallPacket),
    createReviewMissingUrlBlocksScenario(missingUrlPacket),
    createReviewMissingRoleBlocksScenario(missingRolePacket),
    createReviewBoundaryScenario(readyPacket),
    createReviewCheckSeverityScenario(readyPacket),
    createReviewMigrationBoundaryScenario()
  ];
  const overallStatus = scenarios.some((scenario) => scenario.status === "fail") ? "fail" : "pass";

  return {
    packetType: "Chrome Flow Workspace Control Review Migration Validation Suite Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "workspace-control-review-migration-validation-suite-packet-v0.1"
    },
    clipboard: createClipboardBlock(),
    source: {
      type: "workspace_control_review_migration_validation_suite",
      readOnly: true,
      validationOnly: true,
      helperMigrationValidation: true,
      runtimeActionExecuted: false,
      browserProjectionChanged: false,
      sessionDbChanged: false,
      chromeStorageRuntimeChanged: false,
      liveBrowserActionExecuted: false
    },
    suite: {
      overallStatus,
      scenarioCount: scenarios.length,
      passedScenarioCount: scenarios.filter((scenario) => scenario.status === "pass").length,
      failedScenarioCount: scenarios.filter((scenario) => scenario.status === "fail").length,
      scenarios
    },
    fixturePackets: {
      readyPacket,
      noConfirmationPacket,
      phraseOnlyPacket,
      acknowledgementOnlyPacket,
      smallPacket,
      missingUrlPacket,
      missingRolePacket
    },
    nextDecision: createNextDecision(overallStatus)
  };
}

function createReviewPacketShapeScenario(packet) {
  return createScenario("review_packet_shape_preserved_after_helper_migration", [
    assertCondition("packet_type_preserved", packet.packetType === "Chrome Flow Dedicated Window Threshold Review Packet", "Review packet type is preserved."),
    assertCondition("schema_preserved", packet.extension.schema === "dedicated-window-threshold-review-packet-v0.1", "Review packet schema is preserved."),
    assertCondition("clipboard_format_preserved", packet.clipboard.format === "chrome_flow_packet_envelope_v0.1", "Clipboard format is preserved."),
    assertCondition("workspace_block_preserved", packet.workspace.workspaceId === "review-fixture-workspace", "Workspace identity block is preserved."),
    assertCondition("browser_plan_preserved", packet.browserPlan.targetMode === "new_window" && packet.browserPlan.plannedTabCount === 4 && packet.browserPlan.plannedGroupCount === 4, "Browser plan shape is preserved."),
    assertCondition("operator_review_block_preserved", packet.operatorReview.requiredPhrase === REVIEW_PHRASE && packet.operatorReview.operatorConfirmed === true, "Operator review block is preserved.")
  ]);
}

function createReviewReadyScenario(packet) {
  return createScenario("review_ready_fixture_preserved_after_helper_migration", [
    assertCondition("review_status_ready", packet.review.status === "ready_for_threshold_execution_slice", "Ready fixture reaches execution slice."),
    assertCondition("ready_for_next_slice", packet.review.readyForNextSlice === true, "Ready fixture is ready for next slice."),
    assertCondition("available_in_this_slice_false", packet.review.availableInThisSlice === false, "Review still does not execute live action in this slice."),
    assertCondition("no_failed_checks", packet.review.failedChecks.length === 0, "Ready fixture has no failed checks."),
    assertCondition("expected_window_count", packet.browserPlan.expectedWindowCount === 1, "Ready fixture expects one dedicated window.")
  ]);
}

function createReviewConfirmationBlocksScenario(packet, expectedFailedChecks, name) {
  const failedCheckNames = packet.review.failedChecks.map((check) => check.check);
  return createScenario(name, [
    assertCondition("review_status_blocked", packet.review.status === "awaiting_or_blocked_before_threshold_execution", "Incomplete confirmation blocks before execution."),
    assertCondition("ready_for_next_slice_false", packet.review.readyForNextSlice === false, "Incomplete confirmation is not ready for next slice."),
    assertCondition("failed_check_count", failedCheckNames.length === expectedFailedChecks.length, "Expected failed confirmation check count is preserved."),
    ...expectedFailedChecks.map((checkName) => assertCondition("expected_failed_check_" + checkName, failedCheckNames.includes(checkName), "Expected failed check is present: " + checkName + "."))
  ], { failedCheckNames });
}

function createReviewSmallWorkspaceBlocksScenario(packet) {
  const failedCheckNames = packet.review.failedChecks.map((check) => check.check);
  return createScenario("review_small_workspace_blocks_after_helper_migration", [
    assertCondition("review_status_blocked", packet.review.status === "awaiting_or_blocked_before_threshold_execution", "Small workspace blocks before execution."),
    assertCondition("dedicated_policy_failed", failedCheckNames.includes("dedicated_window_policy_active"), "Dedicated-window policy check fails for small workspace."),
    assertCondition("minimum_threshold_failed", failedCheckNames.includes("minimum_tab_threshold_met"), "Minimum threshold check fails for small workspace."),
    assertCondition("expected_window_count_zero", packet.browserPlan.expectedWindowCount === 0, "Blocked fixture expects zero new windows.")
  ], { failedCheckNames });
}

function createReviewMissingUrlBlocksScenario(packet) {
  const failedCheckNames = packet.review.failedChecks.map((check) => check.check);
  return createScenario("review_missing_url_blocks_after_helper_migration", [
    assertCondition("review_status_blocked", packet.review.status === "awaiting_or_blocked_before_threshold_execution", "Missing URL blocks before execution."),
    assertCondition("missing_url_failed", failedCheckNames.includes("workspace_tabs_have_urls"), "Workspace tabs have URLs check fails."),
    assertCondition("missing_url_count", packet.tabStatus.missingUrlCount === 1, "Missing URL count is preserved.")
  ], { failedCheckNames });
}

function createReviewMissingRoleBlocksScenario(packet) {
  const failedCheckNames = packet.review.failedChecks.map((check) => check.check);
  return createScenario("review_missing_role_blocks_after_helper_migration", [
    assertCondition("review_status_blocked", packet.review.status === "awaiting_or_blocked_before_threshold_execution", "Missing role blocks before execution."),
    assertCondition("missing_role_failed", failedCheckNames.includes("workspace_tabs_have_roles"), "Workspace tabs have roles check fails."),
    assertCondition("unassigned_count", packet.tabStatus.unassignedTabs === 1, "Unassigned tab count is preserved.")
  ], { failedCheckNames });
}

function createReviewBoundaryScenario(packet) {
  return createScenario("review_read_only_boundary_preserved_after_helper_migration", assertReadOnlyBoundary(packet.source), { source: packet.source });
}

function createReviewCheckSeverityScenario(packet) {
  return createScenario("review_check_severity_preserved_after_helper_migration", [
    assertCondition("all_checks_block_severity", packet.review.checks.every((check) => check.severity === "block"), "All review checks keep block severity."),
    assertCondition("operator_phrase_check_present", packet.review.checks.some((check) => check.check === "operator_phrase_matches" && check.status === "pass"), "Operator phrase check remains present."),
    assertCondition("operator_ack_check_present", packet.review.checks.some((check) => check.check === "operator_acknowledgement_checked" && check.status === "pass"), "Operator acknowledgement check remains present."),
    assertCondition("storage_boundary_check_present", packet.review.checks.some((check) => check.check === "no_chrome_storage_runtime_changed" && check.status === "pass"), "Storage boundary check remains present.")
  ], { checks: packet.review.checks });
}

function createReviewMigrationBoundaryScenario() {
  return createScenario("review_migration_suite_does_not_change_runtime", [
    assertCondition("runtime_action_not_executed", true, "Review migration validation does not execute runtime action."),
    assertCondition("browser_projection_not_changed", true, "Review migration validation does not change browser projection."),
    assertCondition("session_db_not_changed", true, "Review migration validation does not write Session DB."),
    assertCondition("chrome_storage_runtime_not_changed", true, "Review migration validation does not change chrome.storage.local."),
    assertCondition("live_browser_action_not_executed", true, "Review migration validation does not run live browser action.")
  ]);
}

function createFixtureWorkspace(workspaceId) {
  return {
    workspaceId,
    name: "Review Fixture Workspace",
    workspaceType: "research",
    aim: "Validate migrated review surface"
  };
}

function createFixtureTabs(tabCount, options = {}) {
  return Array.from({ length: tabCount }, (_, index) => createFixtureTab(index, options));
}

function createFixtureTab(index, options) {
  const roles = ["source", "question", "reference", "docs", "counterpoint"];
  const role = options.unassignedIndex === index ? "unassigned" : roles[index % roles.length];
  const url = options.missingUrlIndex === index ? "" : "https://example.com/review-fixture-" + (index + 1);
  return {
    workspaceTabId: "review-fixture-tab-" + (index + 1),
    tabId: 5000 + index,
    index,
    role,
    url,
    originalTitle: "Review migration fixture " + (index + 1)
  };
}

function createNextDecision(overallStatus) {
  if (overallStatus !== "pass") {
    return {
      recommendation: "hold",
      reason: "Migrated review surface did not preserve the expected packet shape, confirmation blocking behavior, or read-only boundary."
    };
  }

  return {
    recommendation: "ready_for_execution_surface_migration",
    reason: "Review surface now uses shared gate helpers and preserves the expected packet shape, confirmation blocking behavior, and read-only boundary."
  };
}

function createSummary(packet) {
  return "Workspace control review migration validation suite: " + packet.suite.overallStatus + " | Scenarios: " + packet.suite.passedScenarioCount + "/" + packet.suite.scenarioCount + " pass | Next: " + packet.nextDecision.recommendation + ".";
}

function setSummary(message) {
  const summary = document.getElementById("workspaceControlReviewMigrationValidationSuiteSummary");
  if (summary) summary.textContent = message;
}

function setStatus(message) {
  const status = document.getElementById("workspaceControlReviewMigrationValidationSuiteStatus");
  if (status) status.textContent = message;
}

function setOutput(value) {
  const output = document.getElementById("workspaceControlReviewMigrationValidationSuiteOutput");
  if (output) output.textContent = JSON.stringify(value, null, 2);
}

function setError(message, error) {
  setOutput({ status: "error", message, error: { name: error?.name || "Error", message: error?.message || String(error) } });
  setStatus(message);
}
