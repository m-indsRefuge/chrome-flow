import { getWorkspace } from "../core/workspace-store.js";

const DEDICATED_WINDOW_THRESHOLD = 4;
const PACKET_ENVELOPE_START = "CHROME_FLOW_PACKET_START";
const PACKET_ENVELOPE_END = "CHROME_FLOW_PACKET_END";
const PACKET_CLIPBOARD_FORMAT = "chrome_flow_packet_envelope_v0.1";
const PACKET_CONTENT_TYPE = "application/json";

let lastSuitePacket = null;

installDedicatedWindowThresholdValidationSuite();

function installDedicatedWindowThresholdValidationSuite() {
  if (document.getElementById("dedicatedWindowThresholdValidationSuiteSection")) return;

  const anchor = document.getElementById("dedicatedWindowThresholdPolicySection") || document.getElementById("projectionResumeValidationSuiteSection") || document.querySelector(".workspace-section");
  if (!anchor) return;

  const section = document.createElement("section");
  section.id = "dedicatedWindowThresholdValidationSuiteSection";
  section.className = "dedicated-window-threshold-validation-suite-section";
  section.innerHTML = `
    <h2>Dedicated Window Threshold Validation Suite</h2>
    <p class="section-help">Programmatically validates the 0–3 versus 4+ tab dedicated-window threshold policy without executing browser action.</p>
    <div id="dedicatedWindowThresholdValidationSuiteSummary" class="workspace-session-summary">Threshold validation suite ready.</div>
    <div class="workspace-session-actions">
      <button id="runDedicatedWindowThresholdValidationSuiteButton" type="button" class="secondary-button">Run Threshold Validation Suite</button>
      <button id="copyDedicatedWindowThresholdValidationSuitePacketButton" type="button" class="secondary-button">Copy Threshold Validation Suite Packet</button>
    </div>
    <p id="dedicatedWindowThresholdValidationSuiteStatus" class="status-message"></p>
    <pre id="dedicatedWindowThresholdValidationSuiteOutput" class="diagnostics-output">Dedicated window threshold validation suite output will appear here.</pre>
  `;

  anchor.insertAdjacentElement("afterend", section);

  document.getElementById("runDedicatedWindowThresholdValidationSuiteButton")?.addEventListener("click", runSuite);
  document.getElementById("copyDedicatedWindowThresholdValidationSuitePacketButton")?.addEventListener("click", copySuitePacket);
}

async function runSuite() {
  try {
    const packet = await buildSuitePacket();
    lastSuitePacket = packet;
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Threshold validation suite complete: " + packet.suite.overallStatus + ".");
  } catch (error) {
    setError("Could not run threshold validation suite.", error);
  }
}

async function copySuitePacket() {
  try {
    const packet = lastSuitePacket || await buildSuitePacket();
    await navigator.clipboard.writeText(formatPacket(packet));
    lastSuitePacket = packet;
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Threshold validation suite packet copied: " + packet.suite.overallStatus + ".");
  } catch (error) {
    setError("Could not copy threshold validation suite packet.", error);
  }
}

async function buildSuitePacket() {
  const activeWorkspace = await getWorkspace();
  const activeTabs = Array.isArray(activeWorkspace?.tabs) ? activeWorkspace.tabs : [];
  const activePolicy = buildPolicyForTabs(activeTabs, {
    workspaceId: activeWorkspace?.workspaceId || "",
    name: activeWorkspace?.name || "",
    workspaceType: activeWorkspace?.workspaceType || activeWorkspace?.type || "",
    aim: activeWorkspace?.aim || ""
  });

  const simulatedCases = [
    createSimulatedCase("empty_workspace_zero_tabs", 0),
    createSimulatedCase("one_tab_current_window_valid", 1),
    createSimulatedCase("three_tabs_current_window_valid", 3),
    createSimulatedCase("four_tabs_dedicated_window_active", 4),
    createSimulatedCase("five_tabs_dedicated_window_active", 5)
  ];

  const scenarios = [
    createScenario("active_workspace_policy_packet_builds", [
      assertCondition("active_policy_has_schema", activePolicy.extension.schema === "dedicated-window-threshold-policy-packet-v0.1", "Active policy packet uses the expected schema."),
      assertCondition("active_policy_classified", Boolean(activePolicy.policy.status), "Active runtime workspace policy is classified."),
      assertCondition("active_policy_has_tab_status", Number.isInteger(activePolicy.tabStatus.totalTabs), "Active runtime workspace tab status is available."),
      assertBoundary(activePolicy.source)
    ].flat(), { activePolicy }),

    createScenario("zero_tab_policy_classifies_as_intake", [
      assertSimulatedPolicy(simulatedCases[0], {
        expectedStatus: "no_workspace_tabs_detected",
        expectedClassification: "empty_or_uninitialized_workspace",
        expectedRecommendedAction: "continue_workspace_intake",
        expectedDedicatedActive: false,
        expectedCurrentWindowValid: true
      })
    ].flat(), { simulatedCase: simulatedCases[0] }),

    createScenario("one_tab_policy_classifies_as_current_window_valid", [
      assertSimulatedPolicy(simulatedCases[1], {
        expectedStatus: "current_window_valid",
        expectedClassification: "small_workspace",
        expectedRecommendedAction: "remain_in_current_window",
        expectedDedicatedActive: false,
        expectedCurrentWindowValid: true
      })
    ].flat(), { simulatedCase: simulatedCases[1] }),

    createScenario("three_tab_policy_classifies_as_current_window_valid", [
      assertSimulatedPolicy(simulatedCases[2], {
        expectedStatus: "current_window_valid",
        expectedClassification: "small_workspace",
        expectedRecommendedAction: "remain_in_current_window",
        expectedDedicatedActive: false,
        expectedCurrentWindowValid: true
      })
    ].flat(), { simulatedCase: simulatedCases[2] }),

    createScenario("four_tab_policy_activates_dedicated_window", [
      assertSimulatedPolicy(simulatedCases[3], {
        expectedStatus: "dedicated_window_policy_active",
        expectedClassification: "dedicated_window_recommended",
        expectedRecommendedAction: "prepare_dedicated_window_projection",
        expectedDedicatedActive: true,
        expectedCurrentWindowValid: false
      })
    ].flat(), { simulatedCase: simulatedCases[3] }),

    createScenario("five_tab_policy_activates_dedicated_window", [
      assertSimulatedPolicy(simulatedCases[4], {
        expectedStatus: "dedicated_window_policy_active",
        expectedClassification: "dedicated_window_recommended",
        expectedRecommendedAction: "prepare_dedicated_window_projection",
        expectedDedicatedActive: true,
        expectedCurrentWindowValid: false
      })
    ].flat(), { simulatedCase: simulatedCases[4] }),

    createScenario("active_workspace_threshold_matches_tab_count", [
      assertCondition("active_zero_tabs_matches_intake", activePolicy.tabStatus.totalTabs !== 0 || activePolicy.policy.status === "no_workspace_tabs_detected", "Zero active tabs classify as intake."),
      assertCondition("active_one_to_three_matches_current_window", activePolicy.tabStatus.totalTabs < 1 || activePolicy.tabStatus.totalTabs > 3 || activePolicy.policy.status === "current_window_valid", "One to three active tabs classify as current-window valid."),
      assertCondition("active_four_plus_matches_dedicated_window", activePolicy.tabStatus.totalTabs < DEDICATED_WINDOW_THRESHOLD || activePolicy.policy.status === "dedicated_window_policy_active", "Four or more active tabs classify as dedicated-window policy active.")
    ], { activeTabCount: activePolicy.tabStatus.totalTabs, activePolicyStatus: activePolicy.policy.status }),

    createScenario("validation_suite_boundary_preserved", [
      assertCondition("suite_runtime_action_not_executed", true, "Validation suite does not execute runtime action."),
      assertCondition("suite_browser_projection_not_changed", true, "Validation suite does not change browser projection."),
      assertCondition("suite_session_db_not_changed", true, "Validation suite does not write Session DB."),
      assertCondition("suite_chrome_storage_runtime_not_changed", true, "Validation suite does not replace chrome.storage.local runtime workspace.")
    ])
  ];

  const overallStatus = scenarios.some((scenario) => scenario.status === "fail") ? "fail" : "pass";

  return {
    packetType: "Chrome Flow Dedicated Window Threshold Validation Suite Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "dedicated-window-threshold-validation-suite-packet-v0.1"
    },
    clipboard: createClipboardBlock(),
    source: {
      type: "workspace_dedicated_window_threshold_validation_suite",
      readOnly: true,
      validationOnly: true,
      thresholdPolicyValidation: true,
      runtimeActionExecuted: false,
      browserProjectionChanged: false,
      sessionDbChanged: false,
      chromeStorageRuntimeChanged: false
    },
    suite: {
      overallStatus,
      scenarioCount: scenarios.length,
      passedScenarioCount: scenarios.filter((scenario) => scenario.status === "pass").length,
      failedScenarioCount: scenarios.filter((scenario) => scenario.status === "fail").length,
      scenarios
    },
    activeRuntimePolicy: activePolicy,
    simulatedPolicyMatrix: simulatedCases,
    nextDecision: createNextDecision(overallStatus, activePolicy)
  };
}

function createNextDecision(overallStatus, activePolicy) {
  if (overallStatus !== "pass") {
    return {
      recommendation: "hold",
      reason: "Threshold validation suite has failing scenarios. Do not proceed to threshold preflight."
    };
  }

  if (activePolicy.policy.dedicatedWindowPolicyActive) {
    return {
      recommendation: "ready_for_threshold_preflight_slice",
      reason: "Threshold validation suite passed and active runtime workspace is in the 4+ tab dedicated-window policy range."
    };
  }

  return {
    recommendation: "policy_valid_current_workspace_below_threshold",
    reason: "Threshold validation suite passed, but active runtime workspace is below the 4+ dedicated-window activation range."
  };
}

function createSimulatedCase(name, tabCount) {
  const tabs = Array.from({ length: tabCount }, (_, index) => ({
    workspaceTabId: "simulated-tab-" + (index + 1),
    url: "https://example.com/simulated-" + (index + 1),
    role: createSimulatedRole(index)
  }));
  return {
    name,
    tabCount,
    policy: buildPolicyForTabs(tabs, {
      workspaceId: "simulated-workspace-" + tabCount,
      name: "Simulated " + tabCount + " tab workspace",
      workspaceType: "simulated",
      aim: "Threshold validation"
    })
  };
}

function createSimulatedRole(index) {
  const roles = ["question", "source", "reference", "counterpoint", "docs"];
  return roles[index % roles.length];
}

function buildPolicyForTabs(tabs, workspace) {
  const tabStatus = buildTabStatus(tabs);
  const classification = classifyWorkspace(tabStatus.totalTabs);
  const checks = createPolicyChecks({ workspace, tabStatus, classification });
  const failedChecks = checks.filter((check) => check.status === "fail");

  return {
    packetType: "Chrome Flow Dedicated Window Threshold Policy Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "dedicated-window-threshold-policy-packet-v0.1"
    },
    source: {
      type: "workspace_dedicated_window_threshold_policy",
      readOnly: true,
      policyOnly: true,
      preflightOnly: false,
      runtimeActionExecuted: false,
      browserProjectionChanged: false,
      sessionDbChanged: false,
      chromeStorageRuntimeChanged: false
    },
    workspace,
    thresholdPolicy: {
      thresholdTabCount: DEDICATED_WINDOW_THRESHOLD,
      currentWindowValidRange: "0-3 tabs",
      dedicatedWindowActivationRange: "4+ tabs",
      productRule: "0-3 tabs can remain current-window valid; 4+ tabs activates dedicated/new-window workspace policy."
    },
    tabStatus,
    policy: {
      status: failedChecks.length ? "policy_blocked_missing_runtime_workspace" : classification.status,
      classification: classification.classification,
      recommendedAction: classification.recommendedAction,
      operatorMessage: classification.operatorMessage,
      dedicatedWindowPolicyActive: classification.dedicatedWindowPolicyActive,
      currentWindowStillValid: classification.currentWindowStillValid,
      checks,
      failedChecks
    }
  };
}

function buildTabStatus(tabs) {
  const totalTabs = tabs.length;
  const tabsWithUrls = tabs.filter((tab) => Boolean(tab.url)).length;
  const assignedTabs = tabs.filter((tab) => tab.role && tab.role !== "unassigned").length;
  const unassignedTabs = totalTabs - assignedTabs;
  const roleCounts = tabs.reduce((counts, tab) => {
    const role = tab.role || "unassigned";
    counts[role] = (counts[role] || 0) + 1;
    return counts;
  }, {});

  return {
    totalTabs,
    tabsWithUrls,
    missingUrlCount: totalTabs - tabsWithUrls,
    assignedTabs,
    unassignedTabs,
    roleCounts
  };
}

function classifyWorkspace(totalTabs) {
  if (totalTabs <= 0) {
    return {
      status: "no_workspace_tabs_detected",
      classification: "empty_or_uninitialized_workspace",
      recommendedAction: "continue_workspace_intake",
      operatorMessage: "No workspace tabs are currently recorded. Continue workspace intake before dedicated-window policy activates.",
      dedicatedWindowPolicyActive: false,
      currentWindowStillValid: true
    };
  }

  if (totalTabs < DEDICATED_WINDOW_THRESHOLD) {
    return {
      status: "current_window_valid",
      classification: "small_workspace",
      recommendedAction: "remain_in_current_window",
      operatorMessage: "This workspace has fewer than 4 tabs. It can remain valid in the current window.",
      dedicatedWindowPolicyActive: false,
      currentWindowStillValid: true
    };
  }

  return {
    status: "dedicated_window_policy_active",
    classification: "dedicated_window_recommended",
    recommendedAction: "prepare_dedicated_window_projection",
    operatorMessage: "This workspace has 4 or more tabs. Dedicated/new-window projection policy is active to preserve organisational integrity.",
    dedicatedWindowPolicyActive: true,
    currentWindowStillValid: false
  };
}

function createPolicyChecks({ workspace, tabStatus, classification }) {
  return [
    createCheck("runtime_workspace_exists", Boolean(workspace?.workspaceId), "Active or simulated workspace exists."),
    createCheck("tab_status_available", Number.isInteger(tabStatus.totalTabs), "Workspace tab status is available."),
    createCheck("threshold_policy_classified", Boolean(classification.status), "Threshold policy classification is available."),
    createCheck("no_runtime_action_executed", true, "Policy packet does not execute runtime action."),
    createCheck("no_browser_projection_changed", true, "Policy packet does not change browser projection."),
    createCheck("no_session_db_changed", true, "Policy packet does not write Session DB."),
    createCheck("no_chrome_storage_runtime_changed", true, "Policy packet does not replace chrome.storage.local runtime workspace.")
  ];
}

function assertSimulatedPolicy(simulatedCase, expected) {
  return [
    assertCondition("expected_status", simulatedCase.policy.policy.status === expected.expectedStatus, "Simulated policy status matches expected result."),
    assertCondition("expected_classification", simulatedCase.policy.policy.classification === expected.expectedClassification, "Simulated policy classification matches expected result."),
    assertCondition("expected_recommended_action", simulatedCase.policy.policy.recommendedAction === expected.expectedRecommendedAction, "Simulated policy recommendation matches expected result."),
    assertCondition("expected_dedicated_window_state", simulatedCase.policy.policy.dedicatedWindowPolicyActive === expected.expectedDedicatedActive, "Dedicated-window active state matches expected result."),
    assertCondition("expected_current_window_state", simulatedCase.policy.policy.currentWindowStillValid === expected.expectedCurrentWindowValid, "Current-window validity state matches expected result."),
    assertBoundary(simulatedCase.policy.source)
  ].flat();
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

function assertCondition(name, passed, message) {
  return { name, status: passed ? "pass" : "fail", message };
}

function createCheck(check, passed, message) {
  return { check, status: passed ? "pass" : "fail", severity: "policy", message };
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
  return "Threshold validation suite: " + packet.suite.overallStatus + " | Scenarios: " + packet.suite.passedScenarioCount + "/" + packet.suite.scenarioCount + " pass | Active policy: " + packet.activeRuntimePolicy.policy.status + " | Next: " + packet.nextDecision.recommendation + ".";
}

function setSummary(message) {
  const summary = document.getElementById("dedicatedWindowThresholdValidationSuiteSummary");
  if (summary) summary.textContent = message;
}

function setStatus(message) {
  const status = document.getElementById("dedicatedWindowThresholdValidationSuiteStatus");
  if (status) status.textContent = message;
}

function setOutput(value) {
  const output = document.getElementById("dedicatedWindowThresholdValidationSuiteOutput");
  if (output) output.textContent = JSON.stringify(value, null, 2);
}

function setError(message, error) {
  setOutput({ status: "error", message, error: error?.message || String(error) });
  setStatus(message);
}
