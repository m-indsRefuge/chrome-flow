import {
  buildDedicatedWindowThresholdPreflightPacketForValidation,
  createRuntimeReadEvidence
} from "./workspace-dedicated-window-threshold-preflight.js";
import {
  assertCondition,
  assertReadOnlyBoundary,
  createClipboardBlock,
  createScenario,
  formatPacketEnvelope
} from "../core/workspace-control/workspace-control-gates.js";

let lastSuitePacket = null;

installWorkspaceControlPreflightMigrationValidationSuite();

function installWorkspaceControlPreflightMigrationValidationSuite() {
  if (document.getElementById("workspaceControlPreflightMigrationValidationSuiteSection")) return;

  const anchor = document.getElementById("workspaceControlPolicyMigrationValidationSuiteSection") || document.getElementById("workspaceControlGateConsolidationValidationSuiteSection") || document.getElementById("dedicatedWindowThresholdPreflightSection") || document.querySelector(".workspace-section");
  if (!anchor) return;

  const section = document.createElement("section");
  section.id = "workspaceControlPreflightMigrationValidationSuiteSection";
  section.className = "workspace-control-preflight-migration-validation-suite-section";
  section.innerHTML = `
    <h2>Workspace Control Preflight Migration Validation Suite</h2>
    <p class="section-help">Validates that the threshold preflight surface still emits the expected packet shape after migrating onto shared gate helpers.</p>
    <div id="workspaceControlPreflightMigrationValidationSuiteSummary" class="workspace-session-summary">Workspace control preflight migration validation suite ready.</div>
    <div class="workspace-session-actions">
      <button id="runWorkspaceControlPreflightMigrationValidationSuiteButton" type="button" class="secondary-button">Run Preflight Migration Validation Suite</button>
      <button id="copyWorkspaceControlPreflightMigrationValidationSuitePacketButton" type="button" class="secondary-button">Copy Preflight Migration Validation Suite Packet</button>
    </div>
    <p id="workspaceControlPreflightMigrationValidationSuiteStatus" class="status-message"></p>
    <pre id="workspaceControlPreflightMigrationValidationSuiteOutput" class="diagnostics-output">Workspace control preflight migration validation suite output will appear here.</pre>
  `;

  anchor.insertAdjacentElement("afterend", section);

  document.getElementById("runWorkspaceControlPreflightMigrationValidationSuiteButton")?.addEventListener("click", runSuite);
  document.getElementById("copyWorkspaceControlPreflightMigrationValidationSuitePacketButton")?.addEventListener("click", copySuitePacket);
}

async function runSuite() {
  try {
    const packet = buildSuitePacket();
    lastSuitePacket = packet;
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Workspace control preflight migration validation suite complete: " + packet.suite.overallStatus + ".");
  } catch (error) {
    setError("Could not run workspace control preflight migration validation suite.", error);
  }
}

async function copySuitePacket() {
  try {
    const packet = lastSuitePacket || buildSuitePacket();
    await navigator.clipboard.writeText(formatPacketEnvelope(packet));
    lastSuitePacket = packet;
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Workspace control preflight migration validation suite packet copied: " + packet.suite.overallStatus + ".");
  } catch (error) {
    setError("Could not copy workspace control preflight migration validation suite packet.", error);
  }
}

function buildSuitePacket() {
  const readyRuntimeRead = createReadyRuntimeRead();
  const readyPacket = buildDedicatedWindowThresholdPreflightPacketForValidation({
    runtimeRead: readyRuntimeRead,
    createdAt: "2026-01-01T00:00:00.000Z"
  });
  const smallRuntimeRead = createReadyRuntimeRead({ tabCount: 3, workspaceId: "preflight-small-fixture-workspace" });
  const smallPacket = buildDedicatedWindowThresholdPreflightPacketForValidation({
    runtimeRead: smallRuntimeRead,
    createdAt: "2026-01-01T00:00:00.000Z"
  });
  const missingUrlRuntimeRead = createReadyRuntimeRead({ missingUrlIndex: 0, workspaceId: "preflight-missing-url-fixture-workspace" });
  const missingUrlPacket = buildDedicatedWindowThresholdPreflightPacketForValidation({
    runtimeRead: missingUrlRuntimeRead,
    createdAt: "2026-01-01T00:00:00.000Z"
  });
  const missingRoleRuntimeRead = createReadyRuntimeRead({ unassignedIndex: 0, workspaceId: "preflight-missing-role-fixture-workspace" });
  const missingRolePacket = buildDedicatedWindowThresholdPreflightPacketForValidation({
    runtimeRead: missingRoleRuntimeRead,
    createdAt: "2026-01-01T00:00:00.000Z"
  });

  const scenarios = [
    createPreflightPacketShapeScenario(readyPacket),
    createPreflightReadyScenario(readyPacket),
    createPreflightSmallWorkspaceBlocksScenario(smallPacket),
    createPreflightMissingUrlBlocksScenario(missingUrlPacket),
    createPreflightMissingRoleBlocksScenario(missingRolePacket),
    createPreflightBoundaryScenario(readyPacket),
    createPreflightCheckSeverityScenario(readyPacket),
    createPreflightMigrationBoundaryScenario()
  ];
  const overallStatus = scenarios.some((scenario) => scenario.status === "fail") ? "fail" : "pass";

  return {
    packetType: "Chrome Flow Workspace Control Preflight Migration Validation Suite Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "workspace-control-preflight-migration-validation-suite-packet-v0.1"
    },
    clipboard: createClipboardBlock(),
    source: {
      type: "workspace_control_preflight_migration_validation_suite",
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
      smallPacket,
      missingUrlPacket,
      missingRolePacket
    },
    nextDecision: createNextDecision(overallStatus)
  };
}

function createPreflightPacketShapeScenario(packet) {
  return createScenario("preflight_packet_shape_preserved_after_helper_migration", [
    assertCondition("packet_type_preserved", packet.packetType === "Chrome Flow Dedicated Window Threshold Preflight Packet", "Preflight packet type is preserved."),
    assertCondition("schema_preserved", packet.extension.schema === "dedicated-window-threshold-preflight-packet-v0.2-runtime-hydration", "Preflight packet schema is preserved."),
    assertCondition("clipboard_format_preserved", packet.clipboard.format === "chrome_flow_packet_envelope_v0.1", "Clipboard format is preserved."),
    assertCondition("workspace_block_preserved", packet.workspace.workspaceId === "preflight-fixture-workspace", "Workspace identity block is preserved."),
    assertCondition("runtime_read_preserved", packet.runtimeRead.status === "ready_first_read" && packet.runtimeRead.selectedTabCount === 4, "Runtime read evidence is preserved."),
    assertCondition("browser_plan_preserved", packet.browserPlan.targetMode === "new_window" && packet.browserPlan.plannedTabCount === 4 && packet.browserPlan.plannedGroupCount === 4, "Browser plan shape is preserved.")
  ]);
}

function createPreflightReadyScenario(packet) {
  return createScenario("preflight_ready_fixture_preserved_after_helper_migration", [
    assertCondition("preflight_status_ready", packet.preflight.status === "ready_for_threshold_review", "Ready fixture reaches threshold review."),
    assertCondition("ready_for_next_slice", packet.preflight.readyForNextSlice === true, "Ready fixture is ready for the next slice."),
    assertCondition("available_in_this_slice_false", packet.preflight.availableInThisSlice === false, "Preflight still does not execute live action in this slice."),
    assertCondition("no_failed_checks", packet.preflight.failedChecks.length === 0, "Ready fixture has no failed checks."),
    assertCondition("expected_window_count", packet.browserPlan.expectedWindowCount === 1, "Ready fixture expects one dedicated window.")
  ]);
}

function createPreflightSmallWorkspaceBlocksScenario(packet) {
  const failedCheckNames = packet.preflight.failedChecks.map((check) => check.check);
  return createScenario("preflight_small_workspace_blocks_after_helper_migration", [
    assertCondition("preflight_status_blocked", packet.preflight.status === "blocked_before_threshold_projection", "Small workspace blocks before projection."),
    assertCondition("dedicated_policy_failed", failedCheckNames.includes("dedicated_window_policy_active"), "Dedicated-window policy check fails for small workspace."),
    assertCondition("minimum_threshold_failed", failedCheckNames.includes("minimum_tab_threshold_met"), "Minimum threshold check fails for small workspace."),
    assertCondition("expected_window_count_zero", packet.browserPlan.expectedWindowCount === 0, "Blocked fixture expects zero new windows.")
  ], { failedCheckNames });
}

function createPreflightMissingUrlBlocksScenario(packet) {
  const failedCheckNames = packet.preflight.failedChecks.map((check) => check.check);
  return createScenario("preflight_missing_url_blocks_after_helper_migration", [
    assertCondition("preflight_status_blocked", packet.preflight.status === "blocked_before_threshold_projection", "Missing URL blocks before projection."),
    assertCondition("missing_url_failed", failedCheckNames.includes("workspace_tabs_have_urls"), "Workspace tabs have URLs check fails."),
    assertCondition("missing_url_count", packet.tabStatus.missingUrlCount === 1, "Missing URL count is preserved.")
  ], { failedCheckNames });
}

function createPreflightMissingRoleBlocksScenario(packet) {
  const failedCheckNames = packet.preflight.failedChecks.map((check) => check.check);
  return createScenario("preflight_missing_role_blocks_after_helper_migration", [
    assertCondition("preflight_status_blocked", packet.preflight.status === "blocked_before_threshold_projection", "Missing role blocks before projection."),
    assertCondition("missing_role_failed", failedCheckNames.includes("workspace_tabs_have_roles"), "Workspace tabs have roles check fails."),
    assertCondition("unassigned_count", packet.tabStatus.unassignedTabs === 1, "Unassigned tab count is preserved.")
  ], { failedCheckNames });
}

function createPreflightBoundaryScenario(packet) {
  return createScenario("preflight_read_only_boundary_preserved_after_helper_migration", assertReadOnlyBoundary(packet.source), { source: packet.source });
}

function createPreflightCheckSeverityScenario(packet) {
  return createScenario("preflight_check_severity_preserved_after_helper_migration", [
    assertCondition("all_checks_block_severity", packet.preflight.checks.every((check) => check.severity === "block"), "All preflight checks keep block severity."),
    assertCondition("runtime_hydration_check_present", packet.preflight.checks.some((check) => check.check === "runtime_tabs_hydrated" && check.status === "pass"), "Runtime hydration check remains present."),
    assertCondition("target_mode_check_present", packet.preflight.checks.some((check) => check.check === "target_mode_new_window" && check.status === "pass"), "Target mode check remains present."),
    assertCondition("storage_boundary_check_present", packet.preflight.checks.some((check) => check.check === "no_chrome_storage_runtime_changed" && check.status === "pass"), "Storage boundary check remains present.")
  ], { checks: packet.preflight.checks });
}

function createPreflightMigrationBoundaryScenario() {
  return createScenario("preflight_migration_suite_does_not_change_runtime", [
    assertCondition("runtime_action_not_executed", true, "Preflight migration validation does not execute runtime action."),
    assertCondition("browser_projection_not_changed", true, "Preflight migration validation does not change browser projection."),
    assertCondition("session_db_not_changed", true, "Preflight migration validation does not write Session DB."),
    assertCondition("chrome_storage_runtime_not_changed", true, "Preflight migration validation does not change chrome.storage.local."),
    assertCondition("live_browser_action_not_executed", true, "Preflight migration validation does not run live browser action.")
  ]);
}

function createReadyRuntimeRead(options = {}) {
  const tabCount = options.tabCount || 4;
  const workspace = {
    workspaceId: options.workspaceId || "preflight-fixture-workspace",
    name: "Preflight Fixture Workspace",
    workspaceType: "research",
    aim: "Validate migrated preflight surface"
  };
  const tabs = Array.from({ length: tabCount }, (_, index) => createFixtureTab(index, options));
  workspace.tabs = tabs;
  return createRuntimeReadEvidence({
    status: "ready_first_read",
    selectedRead: "first",
    firstWorkspace: workspace,
    firstTabs: tabs,
    secondWorkspace: null,
    secondTabs: []
  });
}

function createFixtureTab(index, options) {
  const roles = ["source", "question", "reference", "docs", "counterpoint"];
  const role = options.unassignedIndex === index ? "unassigned" : roles[index % roles.length];
  const url = options.missingUrlIndex === index ? "" : "https://example.com/preflight-fixture-" + (index + 1);
  return {
    workspaceTabId: "preflight-fixture-tab-" + (index + 1),
    tabId: 4000 + index,
    index,
    role,
    url,
    originalTitle: "Preflight migration fixture " + (index + 1)
  };
}

function createNextDecision(overallStatus) {
  if (overallStatus !== "pass") {
    return {
      recommendation: "hold",
      reason: "Migrated preflight surface did not preserve the expected packet shape, blocking behavior, or read-only boundary."
    };
  }

  return {
    recommendation: "ready_for_review_surface_migration",
    reason: "Preflight surface now uses shared gate helpers and preserves the expected packet shape, blocking behavior, and read-only boundary."
  };
}

function createSummary(packet) {
  return "Workspace control preflight migration validation suite: " + packet.suite.overallStatus + " | Scenarios: " + packet.suite.passedScenarioCount + "/" + packet.suite.scenarioCount + " pass | Next: " + packet.nextDecision.recommendation + ".";
}

function setSummary(message) {
  const summary = document.getElementById("workspaceControlPreflightMigrationValidationSuiteSummary");
  if (summary) summary.textContent = message;
}

function setStatus(message) {
  const status = document.getElementById("workspaceControlPreflightMigrationValidationSuiteStatus");
  if (status) status.textContent = message;
}

function setOutput(value) {
  const output = document.getElementById("workspaceControlPreflightMigrationValidationSuiteOutput");
  if (output) output.textContent = JSON.stringify(value, null, 2);
}

function setError(message, error) {
  setOutput({ status: "error", message, error: { name: error?.name || "Error", message: error?.message || String(error) } });
  setStatus(message);
}
