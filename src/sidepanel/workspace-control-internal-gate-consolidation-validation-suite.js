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
import {
  installValidationSurfaceDebugToggle,
  registerValidationSurface
} from "./sidepanel-debug-mode.js";

let lastSuitePacket = null;

installWorkspaceControlGateConsolidationValidationSuite();

function installWorkspaceControlGateConsolidationValidationSuite() {
  if (document.getElementById("workspaceControlGateConsolidationValidationSuiteSection")) return;

  const anchor = document.getElementById("dedicatedWindowThresholdExecutionValidationSuiteSection") || document.getElementById("dedicatedWindowThresholdExecutionSection") || document.getElementById("dedicatedWindowThresholdPolicySection") || document.querySelector(".workspace-section");
  if (!anchor) return;

  installValidationSurfaceDebugToggle(anchor);

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

  registerValidationSurface(section);
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
    createWorkspaceIdentityScenario(),
    createPolicyBlockScenario(),
    createPlannedGroupsScenario(),
    createGateChecksScenario(),
    createPacketEnvelopeScenario(),
    createBoundaryScenario()
  ];
  const overallStatus = scenarios.some((scenario) => scenario.status === "fail") ? "fail" : "pass";
  return {
    packetType: "Chrome Flow Workspace Control Internal Gate Consolidation Validation Suite Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "workspace-control-internal-gate-consolidation-validation-suite-packet-v0.1"
    },
    clipboard: createClipboardBlock(),
    source: {
      type: "workspace_control_internal_gate_consolidation_validation_suite",
      readOnly: true,
      validationOnly: true,
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
    helperExports: [
      "DEDICATED_WINDOW_THRESHOLD",
      "TARGET_MODE_NEW_WINDOW",
      "buildWorkspaceTabStatus",
      "classifyDedicatedWindowThreshold",
      "createWorkspaceIdentityBlock",
      "createThresholdPolicyBlock",
      "createPlannedRoleGroups",
      "createCheck",
      "formatPacketEnvelope"
    ],
    nextDecision: createNextDecision(overallStatus)
  };
}

function createThresholdClassificationScenario() {
  const small = classifyDedicatedWindowThreshold(3);
  const threshold = classifyDedicatedWindowThreshold(4);
  const larger = classifyDedicatedWindowThreshold(7);
  return createScenario("threshold_classification_shared", [
    assertCondition("threshold_constant", DEDICATED_WINDOW_THRESHOLD === 4, "Dedicated-window threshold remains four tabs."),
    assertCondition("target_mode_constant", TARGET_MODE_NEW_WINDOW === "new_window", "Target mode remains new_window."),
    assertCondition("small_workspace_current_window", small.status === "current_window_valid" && small.currentWindowStillValid === true && small.dedicatedWindowPolicyActive === false, "Workspaces below threshold remain current-window valid."),
    assertCondition("threshold_workspace_dedicated", threshold.status === "dedicated_window_policy_active" && threshold.dedicatedWindowPolicyActive === true && threshold.currentWindowStillValid === false, "Four-tab workspaces activate dedicated-window policy."),
    assertCondition("larger_workspace_dedicated", larger.status === "dedicated_window_policy_active" && larger.dedicatedWindowPolicyActive === true, "Larger workspaces remain in dedicated-window policy range.")
  ]);
}

function createTabStatusScenario() {
  const tabs = createFixtureTabs();
  const status = buildWorkspaceTabStatus(tabs);
  return createScenario("workspace_tab_status_shared", [
    assertCondition("total_tabs", status.totalTabs === 5, "Total tab count is preserved."),
    assertCondition("tabs_with_urls", status.tabsWithUrls === 4 && status.missingUrlCount === 1, "URL counts are preserved."),
    assertCondition("role_counts", status.roleCounts.source === 2 && status.roleCounts.question === 1 && status.roleCounts.reference === 1 && status.roleCounts.unassigned === 1, "Role counts are preserved."),
    assertCondition("assigned_unassigned", status.assignedTabs === 4 && status.unassignedTabs === 1, "Assigned/unassigned counts are preserved.")
  ]);
}

function createWorkspaceIdentityScenario() {
  const workspace = createFixtureWorkspace();
  const block = createWorkspaceIdentityBlock(workspace);
  return createScenario("workspace_identity_shared", [
    assertCondition("workspace_id", block.workspaceId === workspace.workspaceId, "Workspace ID is preserved."),
    assertCondition("workspace_name", block.name === workspace.name, "Workspace name is preserved."),
    assertCondition("workspace_type", block.workspaceType === workspace.workspaceType, "Workspace type is preserved."),
    assertCondition("workspace_aim", block.aim === workspace.aim, "Workspace aim is preserved.")
  ]);
}

function createPolicyBlockScenario() {
  const block = createThresholdPolicyBlock(4);
  return createScenario("threshold_policy_block_shared", [
    assertCondition("threshold", block.thresholdTabCount === 4, "Threshold tab count is preserved."),
    assertCondition("target", block.targetMode === "new_window", "Target mode is preserved."),
    assertCondition("status", block.policyStatus === "dedicated_window_policy_active", "Policy status is preserved."),
    assertCondition("flags", block.dedicatedWindowPolicyActive === true && block.currentWindowStillValid === false, "Policy flags are preserved.")
  ]);
}

function createPlannedGroupsScenario() {
  const groups = createPlannedRoleGroups(createFixtureTabs(), { roleLabeler: humanizeRole });
  return createScenario("planned_role_groups_shared", [
    assertCondition("group_count", groups.length === 3, "Planned groups skip unassigned tabs and preserve grouped roles."),
    assertCondition("source_group", groups[0].role === "source" && groups[0].workspaceTabIds.length === 2 && groups[0].roleLabel === "Source", "Source group is preserved."),
    assertCondition("question_group", groups[1].role === "question" && groups[1].workspaceTabIds.length === 1, "Question group is preserved."),
    assertCondition("required_projection", groups.every((group) => group.requiredForProjection === true), "Groups remain required for projection.")
  ]);
}

function createGateChecksScenario() {
  const checks = [
    createCheck("runtime_workspace_exists", true, "Active runtime workspace exists."),
    createCheck("minimum_tab_threshold_met", false, "Active workspace has at least 4 tabs."),
    createCheck("operator_phrase_matches", false, "Operator typed the required phrase.")
  ];
  const failed = failedChecks(checks);
  const reasons = blockedReasons(checks);
  return createScenario("gate_checks_shared", [
    assertCondition("check_shape", checks[0].check === "runtime_workspace_exists" && checks[0].status === "pass" && checks[0].severity === "block", "Check shape is preserved."),
    assertCondition("failed_count", failed.length === 2, "Failed checks are collected."),
    assertCondition("blocked_reasons", reasons.length === 2 && reasons.includes("Active workspace has at least 4 tabs."), "Blocked reasons are derived from failed checks.")
  ]);
}

function createPacketEnvelopeScenario() {
  const packet = { packetType: "Fixture Packet", createdAt: "2026-01-01T00:00:00.000Z", extension: { schema: "fixture-schema-v0.1" }, clipboard: createClipboardBlock(), value: 1 };
  const envelope = formatPacketEnvelope(packet);
  return createScenario("packet_envelope_shared", [
    assertCondition("starts_with_envelope", envelope.startsWith("CHROME_FLOW_PACKET_START"), "Envelope start marker is preserved."),
    assertCondition("contains_packet_type", envelope.includes("packetType: Fixture Packet"), "Packet type header is preserved."),
    assertCondition("contains_schema", envelope.includes("schema: fixture-schema-v0.1"), "Schema header is preserved."),
    assertCondition("ends_with_envelope", envelope.endsWith("CHROME_FLOW_PACKET_END"), "Envelope end marker is preserved.")
  ]);
}

function createBoundaryScenario() {
  const source = createBoundarySource("gate_consolidation_fixture", { helperMigrationValidation: true });
  return createScenario("read_only_boundary_shared", [
    assertReadOnlyBoundary(source, "runtimeActionExecuted", "Source does not execute runtime actions."),
    assertReadOnlyBoundary(source, "browserProjectionChanged", "Source does not change browser projection."),
    assertReadOnlyBoundary(source, "sessionDbChanged", "Source does not write Session DB."),
    assertReadOnlyBoundary(source, "chromeStorageRuntimeChanged", "Source does not change chrome.storage.local."),
    assertCondition("validation_flag", source.helperMigrationValidation === true, "Additional source metadata is preserved.")
  ]);
}

function createNextDecision(overallStatus) {
  if (overallStatus !== "pass") {
    return {
      recommendation: "hold",
      reason: "Shared workspace control gate helpers did not validate. Do not migrate additional surfaces onto them."
    };
  }
  return {
    recommendation: "ready_for_incremental_surface_migration",
    reason: "Shared workspace control gate helpers validate against deterministic fixtures and read-only boundaries."
  };
}

function createFixtureWorkspace() {
  return {
    workspaceId: "gate-helper-fixture-workspace",
    name: "Gate Helper Fixture Workspace",
    workspaceType: "research",
    aim: "Validate shared workspace control gate helpers"
  };
}

function createFixtureTabs() {
  return [
    { workspaceTabId: "tab-1", tabId: 101, url: "https://example.com/source-a", role: "source" },
    { workspaceTabId: "tab-2", tabId: 102, url: "https://example.com/question", role: "question" },
    { workspaceTabId: "tab-3", tabId: 103, url: "https://example.com/source-b", role: "source" },
    { workspaceTabId: "tab-4", tabId: 104, url: "https://example.com/reference", role: "reference" },
    { workspaceTabId: "tab-5", tabId: 105, url: "", role: "" }
  ];
}

function createSummary(packet) {
  return "Workspace control gate consolidation validation: " + packet.suite.overallStatus + " | Scenarios: " + packet.suite.passedScenarioCount + "/" + packet.suite.scenarioCount + " pass | Next: " + packet.nextDecision.recommendation + ".";
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
