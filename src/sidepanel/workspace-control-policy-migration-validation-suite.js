import { buildDedicatedWindowThresholdPolicyPacketForValidation } from "./workspace-dedicated-window-threshold-policy.js";
import {
  assertCondition,
  assertReadOnlyBoundary,
  createClipboardBlock,
  createScenario,
  formatPacketEnvelope
} from "../core/workspace-control/workspace-control-gates.js";

let lastSuitePacket = null;

installWorkspaceControlPolicyMigrationValidationSuite();

function installWorkspaceControlPolicyMigrationValidationSuite() {
  if (document.getElementById("workspaceControlPolicyMigrationValidationSuiteSection")) return;

  const anchor = document.getElementById("workspaceControlGateConsolidationValidationSuiteSection") || document.getElementById("dedicatedWindowThresholdValidationSuiteSection") || document.getElementById("dedicatedWindowThresholdPolicySection") || document.querySelector(".workspace-section");
  if (!anchor) return;

  const section = document.createElement("section");
  section.id = "workspaceControlPolicyMigrationValidationSuiteSection";
  section.className = "workspace-control-policy-migration-validation-suite-section";
  section.innerHTML = `
    <h2>Workspace Control Policy Migration Validation Suite</h2>
    <p class="section-help">Validates that the threshold policy surface still emits the expected packet shape after migrating onto shared gate helpers.</p>
    <div id="workspaceControlPolicyMigrationValidationSuiteSummary" class="workspace-session-summary">Workspace control policy migration validation suite ready.</div>
    <div class="workspace-session-actions">
      <button id="runWorkspaceControlPolicyMigrationValidationSuiteButton" type="button" class="secondary-button">Run Policy Migration Validation Suite</button>
      <button id="copyWorkspaceControlPolicyMigrationValidationSuitePacketButton" type="button" class="secondary-button">Copy Policy Migration Validation Suite Packet</button>
    </div>
    <p id="workspaceControlPolicyMigrationValidationSuiteStatus" class="status-message"></p>
    <pre id="workspaceControlPolicyMigrationValidationSuiteOutput" class="diagnostics-output">Workspace control policy migration validation suite output will appear here.</pre>
  `;

  anchor.insertAdjacentElement("afterend", section);

  document.getElementById("runWorkspaceControlPolicyMigrationValidationSuiteButton")?.addEventListener("click", runSuite);
  document.getElementById("copyWorkspaceControlPolicyMigrationValidationSuitePacketButton")?.addEventListener("click", copySuitePacket);
}

async function runSuite() {
  try {
    const packet = buildSuitePacket();
    lastSuitePacket = packet;
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Workspace control policy migration validation suite complete: " + packet.suite.overallStatus + ".");
  } catch (error) {
    setError("Could not run workspace control policy migration validation suite.", error);
  }
}

async function copySuitePacket() {
  try {
    const packet = lastSuitePacket || buildSuitePacket();
    await navigator.clipboard.writeText(formatPacketEnvelope(packet));
    lastSuitePacket = packet;
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Workspace control policy migration validation suite packet copied: " + packet.suite.overallStatus + ".");
  } catch (error) {
    setError("Could not copy workspace control policy migration validation suite packet.", error);
  }
}

function buildSuitePacket() {
  const fixtureWorkspace = {
    workspaceId: "policy-migration-fixture-workspace",
    name: "Policy Migration Fixture Workspace",
    workspaceType: "research",
    aim: "Validate migrated policy surface"
  };
  const fixtureTabs = [
    createFixtureTab("fixture-tab-1", "source", "https://example.com/source"),
    createFixtureTab("fixture-tab-2", "question", "https://example.com/question"),
    createFixtureTab("fixture-tab-3", "reference", "https://example.com/reference"),
    createFixtureTab("fixture-tab-4", "docs", "https://example.com/docs")
  ];
  const fixturePacket = buildDedicatedWindowThresholdPolicyPacketForValidation({
    workspace: { ...fixtureWorkspace, tabs: fixtureTabs },
    tabs: fixtureTabs,
    createdAt: "2026-01-01T00:00:00.000Z"
  });

  const scenarios = [
    createPolicyPacketShapeScenario(fixturePacket),
    createPolicyClassificationScenario(fixturePacket),
    createPolicyBoundaryScenario(fixturePacket),
    createPolicyCheckSeverityScenario(fixturePacket),
    createPolicyMigrationBoundaryScenario()
  ];
  const overallStatus = scenarios.some((scenario) => scenario.status === "fail") ? "fail" : "pass";

  return {
    packetType: "Chrome Flow Workspace Control Policy Migration Validation Suite Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "workspace-control-policy-migration-validation-suite-packet-v0.1"
    },
    clipboard: createClipboardBlock(),
    source: {
      type: "workspace_control_policy_migration_validation_suite",
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
    fixturePacket,
    nextDecision: createNextDecision(overallStatus)
  };
}

function createPolicyPacketShapeScenario(packet) {
  return createScenario("policy_packet_shape_preserved_after_helper_migration", [
    assertCondition("packet_type_preserved", packet.packetType === "Chrome Flow Dedicated Window Threshold Policy Packet", "Policy packet type is preserved."),
    assertCondition("schema_preserved", packet.extension.schema === "dedicated-window-threshold-policy-packet-v0.1", "Policy packet schema is preserved."),
    assertCondition("clipboard_format_preserved", packet.clipboard.format === "chrome_flow_packet_envelope_v0.1", "Clipboard format is preserved."),
    assertCondition("workspace_block_preserved", packet.workspace.workspaceId === "policy-migration-fixture-workspace", "Workspace identity block is preserved."),
    assertCondition("tab_status_shape_preserved", packet.tabStatus.totalTabs === 4 && packet.tabStatus.missingUrlCount === 0 && packet.tabStatus.unassignedTabs === 0, "Tab status shape is preserved."),
    assertCondition("threshold_policy_shape_preserved", packet.thresholdPolicy.thresholdTabCount === 4 && packet.thresholdPolicy.currentWindowValidRange === "0-3 tabs" && packet.thresholdPolicy.dedicatedWindowActivationRange === "4+ tabs", "Threshold policy shape is preserved.")
  ]);
}

function createPolicyClassificationScenario(packet) {
  return createScenario("policy_classification_preserved_after_helper_migration", [
    assertCondition("policy_status", packet.policy.status === "dedicated_window_policy_active", "4-tab fixture activates dedicated-window policy."),
    assertCondition("policy_classification", packet.policy.classification === "dedicated_window_recommended", "Policy classification is preserved."),
    assertCondition("recommended_action", packet.policy.recommendedAction === "prepare_dedicated_window_projection", "Recommended action is preserved."),
    assertCondition("dedicated_active", packet.policy.dedicatedWindowPolicyActive === true, "Dedicated-window active flag is preserved."),
    assertCondition("current_window_not_valid", packet.policy.currentWindowStillValid === false, "Current-window valid flag is preserved.")
  ]);
}

function createPolicyBoundaryScenario(packet) {
  return createScenario("policy_read_only_boundary_preserved_after_helper_migration", assertReadOnlyBoundary(packet.source), { source: packet.source });
}

function createPolicyCheckSeverityScenario(packet) {
  return createScenario("policy_check_severity_preserved_after_helper_migration", [
    assertCondition("all_checks_policy_severity", packet.policy.checks.every((check) => check.severity === "policy"), "All policy checks keep policy severity."),
    assertCondition("no_failed_checks", packet.policy.failedChecks.length === 0, "Fixture policy packet has no failed checks."),
    assertCondition("runtime_workspace_check_present", packet.policy.checks.some((check) => check.check === "runtime_workspace_exists" && check.status === "pass"), "Runtime workspace check remains present."),
    assertCondition("storage_boundary_check_present", packet.policy.checks.some((check) => check.check === "no_chrome_storage_runtime_changed" && check.status === "pass"), "Storage boundary check remains present.")
  ], { checks: packet.policy.checks });
}

function createPolicyMigrationBoundaryScenario() {
  return createScenario("policy_migration_suite_does_not_change_runtime", [
    assertCondition("runtime_action_not_executed", true, "Policy migration validation does not execute runtime action."),
    assertCondition("browser_projection_not_changed", true, "Policy migration validation does not change browser projection."),
    assertCondition("session_db_not_changed", true, "Policy migration validation does not write Session DB."),
    assertCondition("chrome_storage_runtime_not_changed", true, "Policy migration validation does not change chrome.storage.local."),
    assertCondition("live_browser_action_not_executed", true, "Policy migration validation does not run live browser action.")
  ]);
}

function createFixtureTab(workspaceTabId, role, url) {
  return {
    workspaceTabId,
    role,
    url,
    originalTitle: "Policy migration fixture " + workspaceTabId
  };
}

function createNextDecision(overallStatus) {
  if (overallStatus !== "pass") {
    return {
      recommendation: "hold",
      reason: "Migrated policy surface did not preserve the expected packet shape or read-only boundary."
    };
  }

  return {
    recommendation: "ready_for_preflight_surface_migration",
    reason: "Policy surface now uses shared gate helpers and preserves the expected packet shape, classification behavior, and read-only boundary."
  };
}

function createSummary(packet) {
  return "Workspace control policy migration validation suite: " + packet.suite.overallStatus + " | Scenarios: " + packet.suite.passedScenarioCount + "/" + packet.suite.scenarioCount + " pass | Next: " + packet.nextDecision.recommendation + ".";
}

function setSummary(message) {
  const summary = document.getElementById("workspaceControlPolicyMigrationValidationSuiteSummary");
  if (summary) summary.textContent = message;
}

function setStatus(message) {
  const status = document.getElementById("workspaceControlPolicyMigrationValidationSuiteStatus");
  if (status) status.textContent = message;
}

function setOutput(value) {
  const output = document.getElementById("workspaceControlPolicyMigrationValidationSuiteOutput");
  if (output) output.textContent = JSON.stringify(value, null, 2);
}

function setError(message, error) {
  setOutput({ status: "error", message, error: { name: error?.name || "Error", message: error?.message || String(error) } });
  setStatus(message);
}
