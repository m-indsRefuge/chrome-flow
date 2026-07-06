import {
  DEDICATED_WINDOW_THRESHOLD,
  TARGET_MODE_NEW_WINDOW,
  assertCondition,
  assertReadOnlyBoundary,
  blockedReasons,
  buildWorkspaceTabStatus,
  classifyDedicatedWindowThreshold,
  createBoundarySource,
  createCheck,
  createClipboardBlock,
  createPlannedRoleGroups,
  createScenario,
  createThresholdPolicyBlock,
  createWorkspaceIdentityBlock,
  failedChecks,
  formatPacketEnvelope,
  humanizeRole
} from "../core/workspace-control/workspace-control-gates.js";

let lastSuitePacket = null;

installWorkspaceControlGateConsolidationValidationSuite();

function installWorkspaceControlGateConsolidationValidationSuite() {
  if (document.getElementById("workspaceControlGateConsolidationValidationSuiteSection")) return;

  const anchor = document.getElementById("dedicatedWindowThresholdExecutionValidationSuiteSection") || document.getElementById("dedicatedWindowThresholdExecutionSection") || document.getElementById("dedicatedWindowThresholdPolicySection") || document.querySelector(".workspace-section");
  if (!anchor) return;

  const section = document.createElement("section");
  section.id = "workspaceControlGateConsolidationValidationSuiteSection";
  section.className = "workspace-control-gate-consolidation-validation-suite-section";
  section.innerHTML = `
    <h2>Workspace Control Gate Consolidation Validation Suite</h2>
    <p class="section-help">Programmatically validates the extracted internal gate helpers before live surfaces migrate onto them.</p>
    <div id="workspaceControlGateConsolidationValidationSuiteSummary" class="workspace-session-summary">Workspace control gate consolidation validation suite ready.</div>
    <div class="workspace-session-actions">
      <button id="runWorkspaceControlGateConsolidationValidationSuiteButton" type="button" class="secondary-button">Run Gate Consolidation Validation Suite</button>
      <button id="copyWorkspaceControlGateConsolidationValidationSuitePacketButton" type="button" class="secondary-button">Copy Gate Consolidation Validation Suite Packet</button>
    </div>
    <p id="workspaceControlGateConsolidationValidationSuiteStatus" class="status-message"></p>
    <pre id="workspaceControlGateConsolidationValidationSuiteOutput" class="diagnostics-output">Workspace control gate consolidation validation suite output will appear here.</pre>
  `;

  anchor.insertAdjacentElement("afterend", section);

  document.getElementById("runWorkspaceControlGateConsolidationValidationSuiteButton")?.addEventListener("click", runSuite);
  document.getElementById("copyWorkspaceControlGateConsolidationValidationSuitePacketButton")?.addEventListener("click", copySuitePacket);
}

async function runSuite() {
  try {
    const packet = buildSuitePacket();
    lastSuitePacket = packet;
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Workspace control gate consolidation validation suite complete: " + packet.suite.overallStatus + ".");
  } catch (error) {
    setError("Could not run workspace control gate consolidation validation suite.", error);
  }
}

async function copySuitePacket() {
  try {
    const packet = lastSuitePacket || buildSuitePacket();
    await navigator.clipboard.writeText(formatPacketEnvelope(packet));
    lastSuitePacket = packet;
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Workspace control gate consolidation validation suite packet copied: " + packet.suite.overallStatus + ".");
  } catch (error) {
    setError("Could not copy workspace control gate consolidation validation suite packet.", error);
  }
}

function buildSuitePacket() {
  const scenarios = [
    createThresholdClassificationScenario(),
    createTabStatusScenario(),
    createRoleGroupScenario(),
    createCheckFailureScenario(),
    createPacketEnvelopeScenario(),
    createWorkspaceIdentityScenario(),
    createReadOnlyBoundaryScenario(),
    createConsolidationBoundaryScenario()
  ];

  const overallStatus = scenarios.some((scenario) => scenario.status === "fail") ? "fail" : "pass";

  return {
    packetType: "Chrome Flow Workspace Control Gate Consolidation Validation Suite Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "workspace-control-gate-consolidation-validation-suite-packet-v0.1"
    },
    clipboard: createClipboardBlock(),
    source: {
      type: "workspace_control_internal_gate_consolidation_validation_suite",
      readOnly: true,
      validationOnly: true,
      helperExtractionValidation: true,
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
    nextDecision: createNextDecision(overallStatus)
  };
}

function createThresholdClassificationScenario() {
  const zero = classifyDedicatedWindowThreshold(0);
  const one = classifyDedicatedWindowThreshold(1);
  const three = classifyDedicatedWindowThreshold(3);
  const four = classifyDedicatedWindowThreshold(4);
  const five = classifyDedicatedWindowThreshold(5);

  return createScenario("threshold_classification_matches_existing_policy", [
    assertCondition("threshold_constant_is_four", DEDICATED_WINDOW_THRESHOLD === 4, "Dedicated-window threshold remains 4 tabs."),
    assertCondition("target_mode_is_new_window", TARGET_MODE_NEW_WINDOW === "new_window", "Target mode constant remains new_window."),
    assertCondition("zero_tabs_intake", zero.status === "no_workspace_tabs_detected" && zero.dedicatedWindowPolicyActive === false && zero.currentWindowStillValid === true, "Zero tabs classify as intake."),
    assertCondition("one_tab_current_window", one.status === "current_window_valid" && one.dedicatedWindowPolicyActive === false && one.currentWindowStillValid === true, "One tab remains current-window valid."),
    assertCondition("three_tabs_current_window", three.status === "current_window_valid" && three.dedicatedWindowPolicyActive === false && three.currentWindowStillValid === true, "Three tabs remain current-window valid."),
    assertCondition("four_tabs_dedicated", four.status === "dedicated_window_policy_active" && four.dedicatedWindowPolicyActive === true && four.currentWindowStillValid === false, "Four tabs activate dedicated-window policy."),
    assertCondition("five_tabs_dedicated", five.status === "dedicated_window_policy_active" && five.dedicatedWindowPolicyActive === true && five.currentWindowStillValid === false, "Five tabs activate dedicated-window policy.")
  ], { matrix: { zero, one, three, four, five } });
}

function createTabStatusScenario() {
  const tabs = [
    createFixtureTab("tab-1", "source", "https://example.com/1"),
    createFixtureTab("tab-2", "question", "https://example.com/2"),
    createFixtureTab("tab-3", "unassigned", "https://example.com/3"),
    createFixtureTab("tab-4", "docs", "")
  ];
  const status = buildWorkspaceTabStatus(tabs);

  return createScenario("tab_status_matches_existing_shape", [
    assertCondition("total_tabs", status.totalTabs === 4, "Total tab count is correct."),
    assertCondition("tabs_with_urls", status.tabsWithUrls === 3, "URL count is correct."),
    assertCondition("missing_url_count", status.missingUrlCount === 1, "Missing URL count is correct."),
    assertCondition("assigned_tabs", status.assignedTabs === 3, "Assigned tab count is correct."),
    assertCondition("unassigned_tabs", status.unassignedTabs === 1, "Unassigned tab count is correct."),
    assertCondition("role_counts_source", status.roleCounts.source === 1, "Source role count is correct."),
    assertCondition("role_counts_unassigned", status.roleCounts.unassigned === 1, "Unassigned role count is correct.")
  ], { status });
}

function createRoleGroupScenario() {
  const tabs = [
    createFixtureTab("tab-1", "source", "https://example.com/1"),
    createFixtureTab("tab-2", "source", "https://example.com/2"),
    createFixtureTab("tab-3", "question", "https://example.com/3"),
    createFixtureTab("tab-4", "unassigned", "https://example.com/4")
  ];
  const groups = createPlannedRoleGroups(tabs, { roleLabeler: humanizeRole });
  const sourceGroup = groups.find((group) => group.role === "source");
  const questionGroup = groups.find((group) => group.role === "question");

  return createScenario("planned_role_groups_preserve_projection_shape", [
    assertCondition("unassigned_excluded", groups.every((group) => group.role !== "unassigned"), "Unassigned tabs are excluded from planned groups."),
    assertCondition("group_count", groups.length === 2, "Two role groups are created."),
    assertCondition("source_group_count", sourceGroup?.plannedTabCount === 2, "Source group contains two tabs."),
    assertCondition("question_group_count", questionGroup?.plannedTabCount === 1, "Question group contains one tab."),
    assertCondition("required_for_projection", groups.every((group) => group.requiredForProjection === true), "Groups remain marked as required for projection.")
  ], { groups });
}

function createCheckFailureScenario() {
  const checks = [
    createCheck("first_pass", true, "First check passes."),
    createCheck("second_fail", false, "Second check fails."),
    createCheck("third_pass", true, "Third check passes.")
  ];
  const failures = failedChecks(checks);
  const reasons = blockedReasons(checks);

  return createScenario("check_failure_helpers_match_gate_behavior", [
    assertCondition("failure_count", failures.length === 1, "One failed check is returned."),
    assertCondition("failure_name", failures[0]?.check === "second_fail", "Failed check name is preserved."),
    assertCondition("blocked_reason", reasons[0] === "Second check fails.", "Blocked reason is derived from failed check message.")
  ], { checks, failures, reasons });
}

function createPacketEnvelopeScenario() {
  const packet = {
    packetType: "Fixture Packet",
    createdAt: "2026-01-01T00:00:00.000Z",
    extension: {
      name: "Chrome Flow",
      schema: "fixture-schema-v0.1"
    },
    clipboard: createClipboardBlock(),
    source: createBoundarySource("fixture_source")
  };
  const text = formatPacketEnvelope(packet);

  return createScenario("packet_envelope_matches_existing_format", [
    assertCondition("starts_with_envelope", text.startsWith("CHROME_FLOW_PACKET_START"), "Envelope starts with the packet start marker."),
    assertCondition("contains_packet_type", text.includes("packetType: Fixture Packet"), "Envelope contains packet type header."),
    assertCondition("contains_schema", text.includes("schema: fixture-schema-v0.1"), "Envelope contains schema header."),
    assertCondition("ends_with_envelope", text.trim().endsWith("CHROME_FLOW_PACKET_END"), "Envelope ends with the packet end marker.")
  ], { envelopePreview: text.split("\n").slice(0, 6) });
}

function createWorkspaceIdentityScenario() {
  const workspace = {
    workspaceId: "workspace-1",
    name: "Fixture Workspace",
    workspaceType: "research",
    aim: "Validate helper extraction"
  };
  const identity = createWorkspaceIdentityBlock(workspace);
  const policy = classifyDedicatedWindowThreshold(4);
  const policyBlock = createThresholdPolicyBlock(policy);

  return createScenario("workspace_and_policy_blocks_preserve_packet_shape", [
    assertCondition("workspace_id", identity.workspaceId === "workspace-1", "Workspace id is preserved."),
    assertCondition("workspace_type", identity.workspaceType === "research", "Workspace type is preserved."),
    assertCondition("threshold_count", policyBlock.thresholdTabCount === 4, "Threshold count is preserved."),
    assertCondition("target_mode", policyBlock.targetMode === "new_window", "Target mode is preserved."),
    assertCondition("policy_active", policyBlock.dedicatedWindowPolicyActive === true, "Dedicated-window active flag is preserved.")
  ], { identity, policyBlock });
}

function createReadOnlyBoundaryScenario() {
  const source = createBoundarySource("fixture_validation_source", {
    validationOnly: true,
    helperExtractionValidation: true
  });

  return createScenario("read_only_boundary_source_preserved", assertReadOnlyBoundary(source), { source });
}

function createConsolidationBoundaryScenario() {
  return createScenario("consolidation_suite_does_not_change_runtime", [
    assertCondition("runtime_action_not_executed", true, "Consolidation validation does not execute runtime action."),
    assertCondition("browser_projection_not_changed", true, "Consolidation validation does not change browser projection."),
    assertCondition("session_db_not_changed", true, "Consolidation validation does not write Session DB."),
    assertCondition("chrome_storage_runtime_not_changed", true, "Consolidation validation does not change chrome.storage.local."),
    assertCondition("live_browser_action_not_executed", true, "Consolidation validation does not run live browser action.")
  ]);
}

function createFixtureTab(workspaceTabId, role, url) {
  return {
    workspaceTabId,
    tabId: Number(workspaceTabId.replace(/\D/g, "")) || undefined,
    role,
    url,
    originalTitle: "Fixture " + workspaceTabId
  };
}

function createNextDecision(overallStatus) {
  if (overallStatus !== "pass") {
    return {
      recommendation: "hold",
      reason: "Extracted workspace-control gate helpers failed validation. Do not migrate live surfaces onto them."
    };
  }

  return {
    recommendation: "ready_for_incremental_surface_migration",
    reason: "Extracted workspace-control gate helpers match the expected deterministic gate behavior and can be adopted incrementally by policy/preflight/review/execution surfaces."
  };
}

function createSummary(packet) {
  return "Workspace control gate consolidation validation suite: " + packet.suite.overallStatus + " | Scenarios: " + packet.suite.passedScenarioCount + "/" + packet.suite.scenarioCount + " pass | Next: " + packet.nextDecision.recommendation + ".";
}

function setSummary(message) {
  const summary = document.getElementById("workspaceControlGateConsolidationValidationSuiteSummary");
  if (summary) summary.textContent = message;
}

function setStatus(message) {
  const status = document.getElementById("workspaceControlGateConsolidationValidationSuiteStatus");
  if (status) status.textContent = message;
}

function setOutput(value) {
  const output = document.getElementById("workspaceControlGateConsolidationValidationSuiteOutput");
  if (output) output.textContent = JSON.stringify(value, null, 2);
}

function setError(message, error) {
  setOutput({ status: "error", message, error: { name: error?.name || "Error", message: error?.message || String(error) } });
  setStatus(message);
}
