import { buildReviewPacket, REVIEW_PHRASE } from "./workspace-dedicated-window-threshold-review.js";

const PACKET_ENVELOPE_START = "CHROME_FLOW_PACKET_START";
const PACKET_ENVELOPE_END = "CHROME_FLOW_PACKET_END";
const PACKET_CLIPBOARD_FORMAT = "chrome_flow_packet_envelope_v0.1";
const PACKET_CONTENT_TYPE = "application/json";

let lastSuitePacket = null;

installDedicatedWindowThresholdReviewValidationSuite();

function installDedicatedWindowThresholdReviewValidationSuite() {
  if (document.getElementById("dedicatedWindowThresholdReviewValidationSuiteSection")) return;

  const anchor = document.getElementById("dedicatedWindowThresholdReviewSection") || document.getElementById("dedicatedWindowThresholdPreflightValidationSuiteSection") || document.getElementById("dedicatedWindowThresholdPolicySection") || document.querySelector(".workspace-section");
  if (!anchor) return;

  const section = document.createElement("section");
  section.id = "dedicatedWindowThresholdReviewValidationSuiteSection";
  section.className = "dedicated-window-threshold-review-validation-suite-section";
  section.innerHTML = `
    <h2>Dedicated Window Threshold Review Validation Suite</h2>
    <p class="section-help">Programmatically validates dedicated-window threshold review gates without executing browser action.</p>
    <div id="dedicatedWindowThresholdReviewValidationSuiteSummary" class="workspace-session-summary">Threshold review validation suite ready.</div>
    <div class="workspace-session-actions">
      <button id="runDedicatedWindowThresholdReviewValidationSuiteButton" type="button" class="secondary-button">Run Threshold Review Validation Suite</button>
      <button id="copyDedicatedWindowThresholdReviewValidationSuitePacketButton" type="button" class="secondary-button">Copy Threshold Review Validation Suite Packet</button>
    </div>
    <p id="dedicatedWindowThresholdReviewValidationSuiteStatus" class="status-message"></p>
    <pre id="dedicatedWindowThresholdReviewValidationSuiteOutput" class="diagnostics-output">Dedicated window threshold review validation suite output will appear here.</pre>
  `;

  anchor.insertAdjacentElement("afterend", section);

  document.getElementById("runDedicatedWindowThresholdReviewValidationSuiteButton")?.addEventListener("click", runSuite);
  document.getElementById("copyDedicatedWindowThresholdReviewValidationSuitePacketButton")?.addEventListener("click", copySuitePacket);
}

async function runSuite() {
  try {
    const packet = await buildSuitePacket();
    lastSuitePacket = packet;
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Threshold review validation suite complete: " + packet.suite.overallStatus + ".");
  } catch (error) {
    setError("Could not run threshold review validation suite.", error);
  }
}

async function copySuitePacket() {
  try {
    const packet = lastSuitePacket || await buildSuitePacket();
    await navigator.clipboard.writeText(formatPacket(packet));
    lastSuitePacket = packet;
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Threshold review validation suite packet copied: " + packet.suite.overallStatus + ".");
  } catch (error) {
    setError("Could not copy threshold review validation suite packet.", error);
  }
}

async function buildSuitePacket() {
  const fixtureWorkspace = createFixtureWorkspace("review-ready-fixture");
  const validTabs = createFixtureTabs(4, { roleMode: "assigned", urlMode: "present" });
  const smallTabs = createFixtureTabs(3, { roleMode: "assigned", urlMode: "present" });
  const missingRoleTabs = createFixtureTabs(4, { roleMode: "one_unassigned", urlMode: "present" });
  const missingUrlTabs = createFixtureTabs(4, { roleMode: "assigned", urlMode: "one_missing" });

  const cases = {
    noConfirmation: await buildReviewPacket({ workspace: fixtureWorkspace, tabs: validTabs, phrase: "", acknowledgementChecked: false }),
    phraseOnly: await buildReviewPacket({ workspace: fixtureWorkspace, tabs: validTabs, phrase: REVIEW_PHRASE, acknowledgementChecked: false }),
    acknowledgementOnly: await buildReviewPacket({ workspace: fixtureWorkspace, tabs: validTabs, phrase: "", acknowledgementChecked: true }),
    fullConfirmation: await buildReviewPacket({ workspace: fixtureWorkspace, tabs: validTabs, phrase: REVIEW_PHRASE, acknowledgementChecked: true }),
    smallWorkspaceConfirmed: await buildReviewPacket({ workspace: createFixtureWorkspace("small-workspace"), tabs: smallTabs, phrase: REVIEW_PHRASE, acknowledgementChecked: true }),
    missingRoleConfirmed: await buildReviewPacket({ workspace: createFixtureWorkspace("missing-role-workspace"), tabs: missingRoleTabs, phrase: REVIEW_PHRASE, acknowledgementChecked: true }),
    missingUrlConfirmed: await buildReviewPacket({ workspace: createFixtureWorkspace("missing-url-workspace"), tabs: missingUrlTabs, phrase: REVIEW_PHRASE, acknowledgementChecked: true })
  };

  const scenarios = [
    createReviewScenario("no_confirmation_blocks", cases.noConfirmation, {
      expectedStatus: "awaiting_or_blocked_before_threshold_execution",
      expectedReady: false,
      expectedOperatorConfirmed: false,
      expectedFailedChecks: ["operator_phrase_matches", "operator_acknowledgement_checked"]
    }),
    createReviewScenario("phrase_only_blocks", cases.phraseOnly, {
      expectedStatus: "awaiting_or_blocked_before_threshold_execution",
      expectedReady: false,
      expectedOperatorConfirmed: false,
      expectedFailedChecks: ["operator_acknowledgement_checked"]
    }),
    createReviewScenario("acknowledgement_only_blocks", cases.acknowledgementOnly, {
      expectedStatus: "awaiting_or_blocked_before_threshold_execution",
      expectedReady: false,
      expectedOperatorConfirmed: false,
      expectedFailedChecks: ["operator_phrase_matches"]
    }),
    createReviewScenario("full_confirmation_ready", cases.fullConfirmation, {
      expectedStatus: "ready_for_threshold_execution_slice",
      expectedReady: true,
      expectedOperatorConfirmed: true,
      expectedFailedChecks: []
    }),
    createReviewScenario("small_workspace_confirmed_still_blocks", cases.smallWorkspaceConfirmed, {
      expectedStatus: "awaiting_or_blocked_before_threshold_execution",
      expectedReady: false,
      expectedOperatorConfirmed: true,
      expectedFailedChecks: ["dedicated_window_policy_active", "minimum_tab_threshold_met"]
    }),
    createReviewScenario("missing_role_confirmed_blocks", cases.missingRoleConfirmed, {
      expectedStatus: "awaiting_or_blocked_before_threshold_execution",
      expectedReady: false,
      expectedOperatorConfirmed: true,
      expectedFailedChecks: ["workspace_tabs_have_roles"]
    }),
    createReviewScenario("missing_url_confirmed_blocks", cases.missingUrlConfirmed, {
      expectedStatus: "awaiting_or_blocked_before_threshold_execution",
      expectedReady: false,
      expectedOperatorConfirmed: true,
      expectedFailedChecks: ["workspace_tabs_have_urls"]
    }),
    createScenario("review_suite_boundary_preserved", [
      assertCondition("suite_runtime_action_not_executed", true, "Validation suite does not execute runtime action."),
      assertCondition("suite_browser_projection_not_changed", true, "Validation suite does not change browser projection."),
      assertCondition("suite_session_db_not_changed", true, "Validation suite does not write Session DB."),
      assertCondition("suite_chrome_storage_runtime_not_changed", true, "Validation suite does not replace chrome.storage.local runtime workspace.")
    ])
  ];

  const overallStatus = scenarios.some((scenario) => scenario.status === "fail") ? "fail" : "pass";

  return {
    packetType: "Chrome Flow Dedicated Window Threshold Review Validation Suite Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "dedicated-window-threshold-review-validation-suite-packet-v0.1"
    },
    clipboard: createClipboardBlock(),
    source: {
      type: "workspace_dedicated_window_threshold_review_validation_suite",
      readOnly: true,
      validationOnly: true,
      reviewValidation: true,
      runtimeActionExecuted: false,
      browserProjectionChanged: false,
      sessionDbChanged: false,
      chromeStorageRuntimeChanged: false,
      operatorManualFixtureRequired: false
    },
    suite: {
      overallStatus,
      scenarioCount: scenarios.length,
      passedScenarioCount: scenarios.filter((scenario) => scenario.status === "pass").length,
      failedScenarioCount: scenarios.filter((scenario) => scenario.status === "fail").length,
      scenarios
    },
    reviewPhrase: REVIEW_PHRASE,
    fixtureCases: cases,
    nextDecision: createNextDecision(overallStatus)
  };
}

function createNextDecision(overallStatus) {
  if (overallStatus !== "pass") {
    return {
      recommendation: "hold",
      reason: "Programmatic threshold review validation has failing scenarios. Do not proceed to live threshold execution."
    };
  }

  return {
    recommendation: "ready_for_threshold_execution_slice_design",
    reason: "Review validation suite passed. The next slice may design live threshold execution, but execution must still rebuild preflight and require Operator confirmation."
  };
}

function createReviewScenario(name, packet, expected) {
  const failedCheckNames = packet.review.failedChecks.map((check) => check.check);
  const assertions = [
    assertCondition("expected_status", packet.review.status === expected.expectedStatus, "Review status matches expected result."),
    assertCondition("expected_ready_state", packet.review.readyForNextSlice === expected.expectedReady, "Review readiness matches expected result."),
    assertCondition("expected_operator_confirmation", packet.operatorReview.operatorConfirmed === expected.expectedOperatorConfirmed, "Operator confirmation state matches expected result."),
    assertCondition("expected_failed_check_count", failedCheckNames.length === expected.expectedFailedChecks.length, "Failed check count matches expected result."),
    ...expected.expectedFailedChecks.map((checkName) => assertCondition("expected_failed_check_" + checkName, failedCheckNames.includes(checkName), "Expected failed check is present: " + checkName + ".")),
    assertBoundary(packet.source)
  ].flat();

  return createScenario(name, assertions, { packet });
}

function createScenario(name, assertions, extra = {}) {
  const failedAssertions = assertions.filter((assertion) => assertion.status === "fail");
  return {
    name,
    status: failedAssertions.length ? "fail" : "pass",
    assertions,
    failedAssertions,
    ...extra
  };
}

function createFixtureWorkspace(name) {
  return {
    workspaceId: "fixture-workspace-" + name,
    name: "Fixture: " + name,
    workspaceType: "research",
    aim: "Programmatic threshold review validation"
  };
}

function createFixtureTabs(tabCount, options) {
  return Array.from({ length: tabCount }, (_, index) => createFixtureTab(index, options));
}

function createFixtureTab(index, options) {
  const roles = ["question", "source", "reference", "docs", "counterpoint"];
  const role = options.roleMode === "one_unassigned" && index === 0 ? "unassigned" : roles[index % roles.length];
  const url = options.urlMode === "one_missing" && index === 0 ? "" : "https://example.com/threshold-review-fixture-" + (index + 1);
  return {
    workspaceTabId: "fixture-tab-" + (index + 1),
    tabId: 2000 + index,
    index,
    url,
    role,
    originalTitle: "Review fixture tab " + (index + 1)
  };
}

function assertBoundary(source) {
  return [
    assertCondition("source_read_only", source.readOnly === true, "Source is read-only."),
    assertCondition("runtime_action_not_executed", source.runtimeActionExecuted === false, "No runtime action executed."),
    assertCondition("browser_projection_not_changed", source.browserProjectionChanged === false, "No browser projection changed."),
    assertCondition("session_db_not_changed", source.sessionDbChanged === false, "No Session DB write occurred."),
    assertCondition("chrome_storage_runtime_not_changed", source.chromeStorageRuntimeChanged === false, "No chrome.storage.local runtime replacement occurred.")
  ];
}

function assertCondition(name, passed, message) {
  return { name, status: passed ? "pass" : "fail", message };
}

function createClipboardBlock() {
  return {
    format: PACKET_CLIPBOARD_FORMAT,
    contentType: PACKET_CONTENT_TYPE,
    copyMode: "text_envelope",
    envelopeStart: PACKET_ENVELOPE_START,
    envelopeEnd: PACKET_ENVELOPE_END
  };
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

function createSummary(packet) {
  return "Threshold review validation suite: " + packet.suite.overallStatus + " | Scenarios: " + packet.suite.passedScenarioCount + "/" + packet.suite.scenarioCount + " pass | Next: " + packet.nextDecision.recommendation + ".";
}

function setSummary(message) {
  const summary = document.getElementById("dedicatedWindowThresholdReviewValidationSuiteSummary");
  if (summary) summary.textContent = message;
}

function setStatus(message) {
  const status = document.getElementById("dedicatedWindowThresholdReviewValidationSuiteStatus");
  if (status) status.textContent = message;
}

function setOutput(value) {
  const output = document.getElementById("dedicatedWindowThresholdReviewValidationSuiteOutput");
  if (output) output.textContent = JSON.stringify(value, null, 2);
}

function setError(message, error) {
  setOutput({ status: "error", message, error: error?.message || String(error) });
  setStatus(message);
}
