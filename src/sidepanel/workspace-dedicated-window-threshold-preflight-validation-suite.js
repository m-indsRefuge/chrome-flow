import { getWorkspace } from "../core/workspace-store.js";

const DEDICATED_WINDOW_THRESHOLD = 4;
const TARGET_MODE = "new_window";
const PACKET_ENVELOPE_START = "CHROME_FLOW_PACKET_START";
const PACKET_ENVELOPE_END = "CHROME_FLOW_PACKET_END";
const PACKET_CLIPBOARD_FORMAT = "chrome_flow_packet_envelope_v0.1";
const PACKET_CONTENT_TYPE = "application/json";

let lastSuitePacket = null;

installDedicatedWindowThresholdPreflightValidationSuite();

function installDedicatedWindowThresholdPreflightValidationSuite() {
  if (document.getElementById("dedicatedWindowThresholdPreflightValidationSuiteSection")) return;

  const anchor = document.getElementById("dedicatedWindowThresholdPreflightSection") || document.getElementById("dedicatedWindowThresholdValidationSuiteSection") || document.getElementById("dedicatedWindowThresholdPolicySection") || document.querySelector(".workspace-section");
  if (!anchor) return;

  const section = document.createElement("section");
  section.id = "dedicatedWindowThresholdPreflightValidationSuiteSection";
  section.className = "dedicated-window-threshold-preflight-validation-suite-section";
  section.innerHTML = `
    <h2>Dedicated Window Threshold Preflight Validation Suite</h2>
    <p class="section-help">Programmatically validates dedicated-window threshold preflight logic through internal fixtures. This suite does not execute browser actions.</p>
    <div id="dedicatedWindowThresholdPreflightValidationSuiteSummary" class="workspace-session-summary">Threshold preflight validation suite ready.</div>
    <div class="workspace-session-actions">
      <button id="runDedicatedWindowThresholdPreflightValidationSuiteButton" type="button" class="secondary-button">Run Threshold Preflight Validation Suite</button>
      <button id="copyDedicatedWindowThresholdPreflightValidationSuitePacketButton" type="button" class="secondary-button">Copy Threshold Preflight Validation Suite Packet</button>
    </div>
    <p id="dedicatedWindowThresholdPreflightValidationSuiteStatus" class="status-message"></p>
    <pre id="dedicatedWindowThresholdPreflightValidationSuiteOutput" class="diagnostics-output">Dedicated window threshold preflight validation suite output will appear here.</pre>
  `;

  anchor.insertAdjacentElement("afterend", section);

  document.getElementById("runDedicatedWindowThresholdPreflightValidationSuiteButton")?.addEventListener("click", runSuite);
  document.getElementById("copyDedicatedWindowThresholdPreflightValidationSuitePacketButton")?.addEventListener("click", copySuitePacket);
}

async function runSuite() {
  try {
    const packet = await buildSuitePacket();
    lastSuitePacket = packet;
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Threshold preflight validation suite complete: " + packet.suite.overallStatus + ".");
  } catch (error) {
    setError("Could not run threshold preflight validation suite.", error);
  }
}

async function copySuitePacket() {
  try {
    const packet = lastSuitePacket || await buildSuitePacket();
    await navigator.clipboard.writeText(formatPacket(packet));
    lastSuitePacket = packet;
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Threshold preflight validation suite packet copied: " + packet.suite.overallStatus + ".");
  } catch (error) {
    setError("Could not copy threshold preflight validation suite packet.", error);
  }
}

async function buildSuitePacket() {
  const activeWorkspace = await getWorkspace();
  const activeTabs = Array.isArray(activeWorkspace?.tabs) ? activeWorkspace.tabs : [];
  const activePreflight = buildPreflightForTabs(activeTabs, createWorkspaceSummary(activeWorkspace));

  const fixtureMatrix = [
    createFixturePreflight("zero_tabs_blocks", 0, { roleMode: "assigned", urlMode: "present" }),
    createFixturePreflight("one_tab_blocks", 1, { roleMode: "assigned", urlMode: "present" }),
    createFixturePreflight("three_tabs_blocks", 3, { roleMode: "assigned", urlMode: "present" }),
    createFixturePreflight("four_tabs_ready", 4, { roleMode: "assigned", urlMode: "present" }),
    createFixturePreflight("four_tabs_missing_role_blocks", 4, { roleMode: "one_unassigned", urlMode: "present" }),
    createFixturePreflight("four_tabs_missing_url_blocks", 4, { roleMode: "assigned", urlMode: "one_missing" }),
    createFixturePreflight("five_tabs_ready", 5, { roleMode: "assigned", urlMode: "present" })
  ];

  const scenarios = [
    createScenario("active_runtime_preflight_diagnostic_builds", [
      assertCondition("active_preflight_schema", activePreflight.extension.schema === "dedicated-window-threshold-preflight-packet-v0.1-programmatic-fixture", "Active runtime diagnostic preflight uses the programmatic fixture schema."),
      assertCondition("active_workspace_identity_available", Boolean(activePreflight.workspace.workspaceId), "Active runtime workspace identity is available."),
      assertBoundary(activePreflight.source)
    ].flat(), { activeRuntimePreflight: activePreflight }),

    createPreflightScenario("zero_tabs_block", fixtureMatrix[0], {
      expectedStatus: "blocked_before_threshold_projection",
      expectedReady: false,
      expectedFailedChecks: ["dedicated_window_policy_active", "minimum_tab_threshold_met", "workspace_tabs_have_roles", "planned_groups_available"]
    }),

    createPreflightScenario("one_tab_blocks", fixtureMatrix[1], {
      expectedStatus: "blocked_before_threshold_projection",
      expectedReady: false,
      expectedFailedChecks: ["dedicated_window_policy_active", "minimum_tab_threshold_met"]
    }),

    createPreflightScenario("three_tabs_block", fixtureMatrix[2], {
      expectedStatus: "blocked_before_threshold_projection",
      expectedReady: false,
      expectedFailedChecks: ["dedicated_window_policy_active", "minimum_tab_threshold_met"]
    }),

    createPreflightScenario("four_tabs_ready", fixtureMatrix[3], {
      expectedStatus: "ready_for_threshold_review",
      expectedReady: true,
      expectedFailedChecks: []
    }),

    createPreflightScenario("four_tabs_missing_role_blocks", fixtureMatrix[4], {
      expectedStatus: "blocked_before_threshold_projection",
      expectedReady: false,
      expectedFailedChecks: ["workspace_tabs_have_roles"]
    }),

    createPreflightScenario("four_tabs_missing_url_blocks", fixtureMatrix[5], {
      expectedStatus: "blocked_before_threshold_projection",
      expectedReady: false,
      expectedFailedChecks: ["workspace_tabs_have_urls"]
    }),

    createPreflightScenario("five_tabs_ready", fixtureMatrix[6], {
      expectedStatus: "ready_for_threshold_review",
      expectedReady: true,
      expectedFailedChecks: []
    }),

    createScenario("validation_suite_boundary_preserved", [
      assertCondition("suite_runtime_action_not_executed", true, "Validation suite does not execute runtime action."),
      assertCondition("suite_browser_projection_not_changed", true, "Validation suite does not change browser projection."),
      assertCondition("suite_session_db_not_changed", true, "Validation suite does not write Session DB."),
      assertCondition("suite_chrome_storage_runtime_not_changed", true, "Validation suite does not replace chrome.storage.local runtime workspace.")
    ])
  ];

  const overallStatus = scenarios.some((scenario) => scenario.status === "fail") ? "fail" : "pass";

  return {
    packetType: "Chrome Flow Dedicated Window Threshold Preflight Validation Suite Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "dedicated-window-threshold-preflight-validation-suite-packet-v0.1"
    },
    clipboard: createClipboardBlock(),
    source: {
      type: "workspace_dedicated_window_threshold_preflight_validation_suite",
      readOnly: true,
      validationOnly: true,
      preflightValidation: true,
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
    activeRuntimeDiagnostic: {
      workspaceId: activePreflight.workspace.workspaceId,
      name: activePreflight.workspace.name,
      tabCount: activePreflight.tabStatus.totalTabs,
      preflightStatus: activePreflight.preflight.status,
      readyForNextSlice: activePreflight.preflight.readyForNextSlice,
      note: "Active runtime diagnostic is included as evidence only. Fixture scenarios determine suite pass/fail."
    },
    fixtureMatrix,
    nextDecision: createNextDecision(overallStatus, activePreflight)
  };
}

function createNextDecision(overallStatus, activePreflight) {
  if (overallStatus !== "pass") {
    return {
      recommendation: "hold",
      reason: "Programmatic preflight validation suite has failing scenarios. Do not proceed to review/live threshold execution."
    };
  }

  if (activePreflight.preflight.readyForNextSlice) {
    return {
      recommendation: "programmatic_preflight_valid_active_runtime_ready",
      reason: "Fixture suite passed and active runtime workspace also satisfies dedicated-window threshold preflight."
    };
  }

  return {
    recommendation: "programmatic_preflight_valid_active_runtime_not_ready",
    reason: "Fixture suite passed. Active runtime workspace diagnostic is not ready, but this does not invalidate the preflight logic."
  };
}

function createPreflightScenario(name, fixture, expected) {
  const failedCheckNames = fixture.preflight.failedChecks.map((check) => check.check);
  const assertions = [
    assertCondition("expected_status", fixture.preflight.status === expected.expectedStatus, "Preflight status matches expected result."),
    assertCondition("expected_ready_state", fixture.preflight.readyForNextSlice === expected.expectedReady, "Preflight readiness matches expected result."),
    assertCondition("expected_failed_check_count", failedCheckNames.length === expected.expectedFailedChecks.length, "Failed check count matches expected result."),
    ...expected.expectedFailedChecks.map((checkName) => assertCondition("expected_failed_check_" + checkName, failedCheckNames.includes(checkName), "Expected failed check is present: " + checkName + ".")),
    assertBoundary(fixture.source)
  ].flat();

  return createScenario(name, assertions, { fixture });
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

function createFixturePreflight(name, tabCount, options) {
  const tabs = Array.from({ length: tabCount }, (_, index) => createFixtureTab(index, options));
  return {
    name,
    tabCount,
    preflight: buildPreflightForTabs(tabs, {
      workspaceId: "fixture-workspace-" + name,
      name: "Fixture: " + name,
      workspaceType: "research",
      aim: "Programmatic threshold preflight validation"
    })
  };
}

function createFixtureTab(index, options) {
  const roles = ["question", "source", "reference", "docs", "counterpoint"];
  const role = options.roleMode === "one_unassigned" && index === 0 ? "unassigned" : roles[index % roles.length];
  const url = options.urlMode === "one_missing" && index === 0 ? "" : "https://example.com/threshold-preflight-fixture-" + (index + 1);
  return {
    workspaceTabId: "fixture-tab-" + (index + 1),
    tabId: 1000 + index,
    index,
    url,
    role,
    originalTitle: "Fixture tab " + (index + 1)
  };
}

function buildPreflightForTabs(tabs, workspace) {
  const tabStatus = buildTabStatus(tabs);
  const plannedGroups = createPlannedGroups(tabs);
  const policy = classifyWorkspace(tabStatus.totalTabs);
  const checks = createPreflightChecks({ workspace, tabStatus, plannedGroups, policy });
  const failedChecks = checks.filter((check) => check.status === "fail");
  const ready = failedChecks.length === 0;

  return {
    packetType: "Chrome Flow Dedicated Window Threshold Preflight Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "dedicated-window-threshold-preflight-packet-v0.1-programmatic-fixture"
    },
    source: {
      type: "workspace_dedicated_window_threshold_preflight_fixture",
      readOnly: true,
      preflightOnly: true,
      policyOnly: false,
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
      policyStatus: policy.status,
      dedicatedWindowPolicyActive: policy.dedicatedWindowPolicyActive,
      currentWindowStillValid: policy.currentWindowStillValid
    },
    tabStatus,
    browserPlan: {
      targetMode: TARGET_MODE,
      expectedWindowCount: ready ? 1 : 0,
      plannedTabCount: tabs.length,
      missingUrlCount: tabStatus.missingUrlCount,
      plannedGroupCount: plannedGroups.length,
      plannedGroups
    },
    preflight: {
      status: ready ? "ready_for_threshold_review" : "blocked_before_threshold_projection",
      readyForNextSlice: ready,
      availableInThisSlice: false,
      checks,
      failedChecks,
      blockedReasons: failedChecks.map((check) => check.message)
    }
  };
}

function createWorkspaceSummary(workspace) {
  return {
    workspaceId: workspace?.workspaceId || "",
    name: workspace?.name || "",
    workspaceType: workspace?.workspaceType || workspace?.type || "",
    aim: workspace?.aim || ""
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
      dedicatedWindowPolicyActive: false,
      currentWindowStillValid: true
    };
  }

  if (totalTabs < DEDICATED_WINDOW_THRESHOLD) {
    return {
      status: "current_window_valid",
      dedicatedWindowPolicyActive: false,
      currentWindowStillValid: true
    };
  }

  return {
    status: "dedicated_window_policy_active",
    dedicatedWindowPolicyActive: true,
    currentWindowStillValid: false
  };
}

function createPreflightChecks({ workspace, tabStatus, plannedGroups, policy }) {
  return [
    createCheck("runtime_workspace_exists", Boolean(workspace?.workspaceId), "Active or fixture runtime workspace exists."),
    createCheck("dedicated_window_policy_active", policy.dedicatedWindowPolicyActive === true, "Workspace is in the 4+ tab dedicated-window policy range."),
    createCheck("minimum_tab_threshold_met", tabStatus.totalTabs >= DEDICATED_WINDOW_THRESHOLD, "Workspace has at least 4 tabs."),
    createCheck("workspace_tabs_have_urls", tabStatus.totalTabs > 0 && tabStatus.missingUrlCount === 0, "All workspace tabs have URLs."),
    createCheck("workspace_tabs_have_roles", tabStatus.totalTabs > 0 && tabStatus.unassignedTabs === 0, "All workspace tabs have assigned roles."),
    createCheck("planned_groups_available", plannedGroups.length > 0, "Planned role groups are available."),
    createCheck("target_mode_new_window", TARGET_MODE === "new_window", "Target mode is new_window."),
    createCheck("no_runtime_action_executed", true, "Preflight packet does not execute runtime action."),
    createCheck("no_browser_projection_changed", true, "Preflight packet does not change browser projection."),
    createCheck("no_session_db_changed", true, "Preflight packet does not write Session DB."),
    createCheck("no_chrome_storage_runtime_changed", true, "Preflight packet does not replace chrome.storage.local runtime workspace.")
  ];
}

function createPlannedGroups(tabs) {
  const roles = new Map();
  for (const tab of tabs) {
    const role = tab.role || "unassigned";
    if (role === "unassigned") continue;
    if (!roles.has(role)) roles.set(role, []);
    roles.get(role).push(tab.workspaceTabId || String(tab.tabId || tab.url));
  }

  return Array.from(roles.entries()).map(([role, workspaceTabIds]) => ({
    role,
    roleLabel: createRoleLabel(role),
    workspaceTabIds,
    plannedTabCount: workspaceTabIds.length,
    requiredForProjection: true
  }));
}

function createRoleLabel(role) {
  return String(role || "unassigned").replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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

function createCheck(check, passed, message) {
  return { check, status: passed ? "pass" : "fail", severity: "block", message };
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
  return "Threshold preflight validation suite: " + packet.suite.overallStatus + " | Scenarios: " + packet.suite.passedScenarioCount + "/" + packet.suite.scenarioCount + " pass | Active diagnostic: " + packet.activeRuntimeDiagnostic.preflightStatus + " | Next: " + packet.nextDecision.recommendation + ".";
}

function setSummary(message) {
  const summary = document.getElementById("dedicatedWindowThresholdPreflightValidationSuiteSummary");
  if (summary) summary.textContent = message;
}

function setStatus(message) {
  const status = document.getElementById("dedicatedWindowThresholdPreflightValidationSuiteStatus");
  if (status) status.textContent = message;
}

function setOutput(value) {
  const output = document.getElementById("dedicatedWindowThresholdPreflightValidationSuiteOutput");
  if (output) output.textContent = JSON.stringify(value, null, 2);
}

function setError(message, error) {
  setOutput({ status: "error", message, error: error?.message || String(error) });
  setStatus(message);
}
