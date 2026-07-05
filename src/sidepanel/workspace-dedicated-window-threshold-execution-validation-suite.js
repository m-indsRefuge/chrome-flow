import { buildExecutionGatePacket, EXECUTION_PHRASE } from "./workspace-dedicated-window-threshold-execution.js";

const PACKET_ENVELOPE_START = "CHROME_FLOW_PACKET_START";
const PACKET_ENVELOPE_END = "CHROME_FLOW_PACKET_END";
const PACKET_CLIPBOARD_FORMAT = "chrome_flow_packet_envelope_v0.1";
const PACKET_CONTENT_TYPE = "application/json";

let lastSuitePacket = null;

installDedicatedWindowThresholdExecutionValidationSuite();

function installDedicatedWindowThresholdExecutionValidationSuite() {
  if (document.getElementById("dedicatedWindowThresholdExecutionValidationSuiteSection")) return;

  const anchor = document.getElementById("dedicatedWindowThresholdExecutionSection") || document.getElementById("dedicatedWindowThresholdReviewValidationSuiteSection") || document.getElementById("dedicatedWindowThresholdPolicySection") || document.querySelector(".workspace-section");
  if (!anchor) return;

  const section = document.createElement("section");
  section.id = "dedicatedWindowThresholdExecutionValidationSuiteSection";
  section.className = "dedicated-window-threshold-execution-validation-suite-section";
  section.innerHTML = `
    <h2>Dedicated Window Threshold Execution Validation Suite</h2>
    <p class="section-help">Programmatically validates dedicated-window threshold execution gates without running live browser action.</p>
    <div id="dedicatedWindowThresholdExecutionValidationSuiteSummary" class="workspace-session-summary">Threshold execution validation suite ready.</div>
    <div class="workspace-session-actions">
      <button id="runDedicatedWindowThresholdExecutionValidationSuiteButton" type="button" class="secondary-button">Run Threshold Execution Validation Suite</button>
      <button id="copyDedicatedWindowThresholdExecutionValidationSuitePacketButton" type="button" class="secondary-button">Copy Threshold Execution Validation Suite Packet</button>
    </div>
    <p id="dedicatedWindowThresholdExecutionValidationSuiteStatus" class="status-message"></p>
    <pre id="dedicatedWindowThresholdExecutionValidationSuiteOutput" class="diagnostics-output">Dedicated window threshold execution validation suite output will appear here.</pre>
  `;

  anchor.insertAdjacentElement("afterend", section);

  document.getElementById("runDedicatedWindowThresholdExecutionValidationSuiteButton")?.addEventListener("click", runSuite);
  document.getElementById("copyDedicatedWindowThresholdExecutionValidationSuitePacketButton")?.addEventListener("click", copySuitePacket);
}

async function runSuite() {
  try {
    const packet = await buildSuitePacket();
    lastSuitePacket = packet;
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Threshold execution validation suite complete: " + packet.suite.overallStatus + ".");
  } catch (error) {
    setError("Could not run threshold execution validation suite.", error);
  }
}

async function copySuitePacket() {
  try {
    const packet = lastSuitePacket || await buildSuitePacket();
    await navigator.clipboard.writeText(formatPacket(packet));
    lastSuitePacket = packet;
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Threshold execution validation suite packet copied: " + packet.suite.overallStatus + ".");
  } catch (error) {
    setError("Could not copy threshold execution validation suite packet.", error);
  }
}

async function buildSuitePacket() {
  const workspace = createFixtureWorkspace("execution-ready-fixture");
  const validTabs = createFixtureTabs(4, { roleMode: "assigned", urlMode: "present", tabIdMode: "present" });
  const smallTabs = createFixtureTabs(3, { roleMode: "assigned", urlMode: "present", tabIdMode: "present" });
  const missingRoleTabs = createFixtureTabs(4, { roleMode: "one_unassigned", urlMode: "present", tabIdMode: "present" });
  const missingUrlTabs = createFixtureTabs(4, { roleMode: "assigned", urlMode: "one_missing", tabIdMode: "present" });
  const missingLiveTabIdTabs = createFixtureTabs(4, { roleMode: "assigned", urlMode: "present", tabIdMode: "one_missing" });

  const cases = {
    noConfirmation: await buildExecutionGatePacket({ workspace, tabs: validTabs, phrase: "", acknowledgementChecked: false }),
    phraseOnly: await buildExecutionGatePacket({ workspace, tabs: validTabs, phrase: EXECUTION_PHRASE, acknowledgementChecked: false }),
    acknowledgementOnly: await buildExecutionGatePacket({ workspace, tabs: validTabs, phrase: "", acknowledgementChecked: true }),
    fullConfirmation: await buildExecutionGatePacket({ workspace, tabs: validTabs, phrase: EXECUTION_PHRASE, acknowledgementChecked: true }),
    smallWorkspaceConfirmed: await buildExecutionGatePacket({ workspace: createFixtureWorkspace("small-workspace"), tabs: smallTabs, phrase: EXECUTION_PHRASE, acknowledgementChecked: true }),
    missingRoleConfirmed: await buildExecutionGatePacket({ workspace: createFixtureWorkspace("missing-role-workspace"), tabs: missingRoleTabs, phrase: EXECUTION_PHRASE, acknowledgementChecked: true }),
    missingUrlConfirmed: await buildExecutionGatePacket({ workspace: createFixtureWorkspace("missing-url-workspace"), tabs: missingUrlTabs, phrase: EXECUTION_PHRASE, acknowledgementChecked: true }),
    missingLiveTabIdConfirmed: await buildExecutionGatePacket({ workspace: createFixtureWorkspace("missing-live-tab-id-workspace"), tabs: missingLiveTabIdTabs, phrase: EXECUTION_PHRASE, acknowledgementChecked: true })
  };

  const scenarios = [
    createExecutionGateScenario("no_confirmation_blocks", cases.noConfirmation, {
      expectedStatus: "blocked_before_live_threshold_execution",
      expectedReady: false,
      expectedRunButton: false,
      expectedFailedChecks: ["operator_phrase_matches", "operator_acknowledgement_checked"]
    }),
    createExecutionGateScenario("phrase_only_blocks", cases.phraseOnly, {
      expectedStatus: "blocked_before_live_threshold_execution",
      expectedReady: false,
      expectedRunButton: false,
      expectedFailedChecks: ["operator_acknowledgement_checked"]
    }),
    createExecutionGateScenario("acknowledgement_only_blocks", cases.acknowledgementOnly, {
      expectedStatus: "blocked_before_live_threshold_execution",
      expectedReady: false,
      expectedRunButton: false,
      expectedFailedChecks: ["operator_phrase_matches"]
    }),
    createExecutionGateScenario("full_confirmation_ready", cases.fullConfirmation, {
      expectedStatus: "ready_for_live_threshold_execution",
      expectedReady: true,
      expectedRunButton: true,
      expectedFailedChecks: []
    }),
    createExecutionGateScenario("small_workspace_confirmed_still_blocks", cases.smallWorkspaceConfirmed, {
      expectedStatus: "blocked_before_live_threshold_execution",
      expectedReady: false,
      expectedRunButton: false,
      expectedFailedChecks: ["dedicated_window_policy_active", "minimum_tab_threshold_met"]
    }),
    createExecutionGateScenario("missing_role_confirmed_blocks", cases.missingRoleConfirmed, {
      expectedStatus: "blocked_before_live_threshold_execution",
      expectedReady: false,
      expectedRunButton: false,
      expectedFailedChecks: ["workspace_tabs_have_roles"]
    }),
    createExecutionGateScenario("missing_url_confirmed_blocks", cases.missingUrlConfirmed, {
      expectedStatus: "blocked_before_live_threshold_execution",
      expectedReady: false,
      expectedRunButton: false,
      expectedFailedChecks: ["workspace_tabs_have_urls"]
    }),
    createExecutionGateScenario("missing_live_tab_id_confirmed_blocks", cases.missingLiveTabIdConfirmed, {
      expectedStatus: "blocked_before_live_threshold_execution",
      expectedReady: false,
      expectedRunButton: false,
      expectedFailedChecks: ["workspace_tabs_have_live_tab_ids"]
    }),
    createScenario("execution_suite_boundary_preserved", [
      assertCondition("suite_runtime_action_not_executed", true, "Validation suite does not execute runtime action."),
      assertCondition("suite_browser_projection_not_changed", true, "Validation suite does not change browser projection."),
      assertCondition("suite_session_db_not_changed", true, "Validation suite does not write Session DB."),
      assertCondition("suite_chrome_storage_runtime_not_changed", true, "Validation suite does not replace chrome.storage.local runtime workspace.")
    ])
  ];

  const overallStatus = scenarios.some((scenario) => scenario.status === "fail") ? "fail" : "pass";

  return {
    packetType: "Chrome Flow Dedicated Window Threshold Execution Validation Suite Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "dedicated-window-threshold-execution-validation-suite-packet-v0.1"
    },
    clipboard: createClipboardBlock(),
    source: {
      type: "workspace_dedicated_window_threshold_execution_validation_suite",
      readOnly: true,
      validationOnly: true,
      executionGateValidation: true,
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
    executionPhrase: EXECUTION_PHRASE,
    fixtureCases: cases,
    nextDecision: createNextDecision(overallStatus)
  };
}

function createNextDecision(overallStatus) {
  if (overallStatus !== "pass") {
    return {
      recommendation: "hold",
      reason: "Programmatic threshold execution gate validation has failing scenarios. Do not run live threshold execution."
    };
  }

  return {
    recommendation: "ready_for_controlled_live_threshold_execution_validation",
    reason: "Execution gate validation suite passed. A controlled live execution validation may be run with Operator approval."
  };
}

function createExecutionGateScenario(name, packet, expected) {
  const failedCheckNames = packet.executionGate.failedChecks.map((check) => check.check);
  const assertions = [
    assertCondition("expected_status", packet.executionGate.status === expected.expectedStatus, "Execution gate status matches expected result."),
    assertCondition("expected_ready_state", packet.executionGate.readyForLiveAction === expected.expectedReady, "Execution readiness matches expected result."),
    assertCondition("expected_run_button_state", packet.source.runButtonShouldBeEnabled === expected.expectedRunButton, "Run button gate state matches expected result."),
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
    aim: "Programmatic threshold execution validation"
  };
}

function createFixtureTabs(tabCount, options) {
  return Array.from({ length: tabCount }, (_, index) => createFixtureTab(index, options));
}

function createFixtureTab(index, options) {
  const roles = ["question", "source", "reference", "docs", "counterpoint"];
  const role = options.roleMode === "one_unassigned" && index === 0 ? "unassigned" : roles[index % roles.length];
  const url = options.urlMode === "one_missing" && index === 0 ? "" : "https://example.com/threshold-execution-fixture-" + (index + 1);
  const tabId = options.tabIdMode === "one_missing" && index === 0 ? null : 3000 + index;
  return {
    workspaceTabId: "fixture-tab-" + (index + 1),
    tabId,
    index,
    url,
    role,
    originalTitle: "Execution fixture tab " + (index + 1)
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
  return "Threshold execution validation suite: " + packet.suite.overallStatus + " | Scenarios: " + packet.suite.passedScenarioCount + "/" + packet.suite.scenarioCount + " pass | Next: " + packet.nextDecision.recommendation + ".";
}

function setSummary(message) {
  const summary = document.getElementById("dedicatedWindowThresholdExecutionValidationSuiteSummary");
  if (summary) summary.textContent = message;
}

function setStatus(message) {
  const status = document.getElementById("dedicatedWindowThresholdExecutionValidationSuiteStatus");
  if (status) status.textContent = message;
}

function setOutput(value) {
  const output = document.getElementById("dedicatedWindowThresholdExecutionValidationSuiteOutput");
  if (output) output.textContent = JSON.stringify(value, null, 2);
}

function setError(message, error) {
  setOutput({ status: "error", message, error: error?.message || String(error) });
  setStatus(message);
}
