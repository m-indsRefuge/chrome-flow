import {
  EXECUTION_PHRASE,
  buildThresholdExecutionGatePacket
} from "./workspace-dedicated-window-threshold-execution-gate.js";
import {
  assertCondition,
  createClipboardBlock,
  createScenario,
  formatPacketEnvelope
} from "../core/workspace-control/workspace-control-gates.js";

let lastSuitePacket = null;

installWorkspaceControlExecutionGateValidationSuite();

function installWorkspaceControlExecutionGateValidationSuite() {
  if (document.getElementById("workspaceControlExecutionGateValidationSuiteSection")) return;

  const anchor = document.getElementById("workspaceControlReviewMigrationValidationSuiteSection") || document.getElementById("dedicatedWindowThresholdExecutionValidationSuiteSection") || document.querySelector(".workspace-section");
  if (!anchor) return;

  const section = document.createElement("section");
  section.id = "workspaceControlExecutionGateValidationSuiteSection";
  section.className = "workspace-control-execution-gate-validation-suite-section";
  section.innerHTML = `
    <h2>Workspace Control Execution Gate Validation Suite</h2>
    <p class="section-help">Validates migrated execution gate packet construction before it is wired into the browser-control surface.</p>
    <div id="workspaceControlExecutionGateValidationSuiteSummary" class="workspace-session-summary">Workspace control execution gate validation suite ready.</div>
    <div class="workspace-session-actions">
      <button id="runWorkspaceControlExecutionGateValidationSuiteButton" type="button" class="secondary-button">Run Execution Gate Validation Suite</button>
      <button id="copyWorkspaceControlExecutionGateValidationSuitePacketButton" type="button" class="secondary-button">Copy Execution Gate Validation Suite Packet</button>
    </div>
    <p id="workspaceControlExecutionGateValidationSuiteStatus" class="status-message"></p>
    <pre id="workspaceControlExecutionGateValidationSuiteOutput" class="diagnostics-output">Workspace control execution gate validation suite output will appear here.</pre>
  `;

  anchor.insertAdjacentElement("afterend", section);

  document.getElementById("runWorkspaceControlExecutionGateValidationSuiteButton")?.addEventListener("click", runSuite);
  document.getElementById("copyWorkspaceControlExecutionGateValidationSuitePacketButton")?.addEventListener("click", copySuitePacket);
}

async function runSuite() {
  try {
    const packet = buildSuitePacket();
    lastSuitePacket = packet;
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Workspace control execution gate validation suite complete: " + packet.suite.overallStatus + ".");
  } catch (error) {
    setError("Could not run workspace control execution gate validation suite.", error);
  }
}

async function copySuitePacket() {
  try {
    const packet = lastSuitePacket || buildSuitePacket();
    await navigator.clipboard.writeText(formatPacketEnvelope(packet));
    lastSuitePacket = packet;
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Workspace control execution gate validation suite packet copied: " + packet.suite.overallStatus + ".");
  } catch (error) {
    setError("Could not copy workspace control execution gate validation suite packet.", error);
  }
}

function buildSuitePacket() {
  const readyPacket = createGatePacket({ workspaceId: "execution-gate-ready", tabCount: 4, phrase: EXECUTION_PHRASE, acknowledgementChecked: true, resolutionMode: "resolved" });
  const noConfirmPacket = createGatePacket({ workspaceId: "execution-gate-no-confirm", tabCount: 4, phrase: "", acknowledgementChecked: false, resolutionMode: "resolved" });
  const smallPacket = createGatePacket({ workspaceId: "execution-gate-small", tabCount: 3, phrase: EXECUTION_PHRASE, acknowledgementChecked: true, resolutionMode: "resolved" });
  const unresolvedPacket = createGatePacket({ workspaceId: "execution-gate-unresolved", tabCount: 4, phrase: EXECUTION_PHRASE, acknowledgementChecked: true, resolutionMode: "unresolved" });
  const callerSortedPacket = createGatePacket({ workspaceId: "execution-gate-caller-sorted", tabCount: 4, phrase: EXECUTION_PHRASE, acknowledgementChecked: true, resolutionMode: "resolved", sortResolvedResults: reverseResolvedResults });

  const scenarios = [
    createPacketShapeScenario(readyPacket),
    createReadyScenario(readyPacket),
    createNoConfirmScenario(noConfirmPacket),
    createSmallScenario(smallPacket),
    createUnresolvedScenario(unresolvedPacket),
    createCallerSortedScenario(callerSortedPacket),
    createBoundaryScenario(readyPacket)
  ];
  const overallStatus = scenarios.some((scenario) => scenario.status === "fail") ? "fail" : "pass";

  return {
    packetType: "Chrome Flow Workspace Control Execution Gate Validation Suite Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "workspace-control-execution-gate-validation-suite-packet-v0.2-caller-ordering"
    },
    clipboard: createClipboardBlock(),
    source: {
      type: "workspace_control_execution_gate_validation_suite",
      readOnly: true,
      validationOnly: true,
      helperMigrationValidation: true,
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
    fixturePackets: {
      readyPacket,
      noConfirmPacket,
      smallPacket,
      unresolvedPacket,
      callerSortedPacket
    },
    nextDecision: createNextDecision(overallStatus)
  };
}

function createPacketShapeScenario(packet) {
  return createScenario("execution_gate_packet_shape_preserved", [
    assertCondition("packet_type", packet.packetType === "Chrome Flow Dedicated Window Threshold Execution Precheck Packet", "Execution precheck packet type is preserved."),
    assertCondition("schema", packet.extension.schema === "dedicated-window-threshold-execution-precheck-packet-v0.1", "Execution precheck schema is preserved."),
    assertCondition("workspace_block", packet.workspace.workspaceId === "execution-gate-ready", "Workspace identity block is preserved."),
    assertCondition("resolution_summary", packet.liveResolution.resolvedCount === 4 && packet.liveResolution.unresolvedCount === 0, "Resolution summary is preserved."),
    assertCondition("browser_plan", packet.browserPlan.targetMode === "new_window" && packet.browserPlan.plannedTabCount === 4 && packet.browserPlan.plannedGroupCount === 4, "Browser plan shape is preserved."),
    assertCondition("operator_block", packet.operatorConfirmation.requiredPhrase === EXECUTION_PHRASE && packet.operatorConfirmation.operatorConfirmed === true, "Operator confirmation block is preserved.")
  ]);
}

function createReadyScenario(packet) {
  return createScenario("execution_gate_ready_fixture_preserved", [
    assertCondition("gate_ready", packet.executionGate.status === "ready_for_live_threshold_execution", "Ready fixture reaches execution readiness."),
    assertCondition("available_true", packet.executionGate.availableInThisSlice === true, "Availability flag is true when all checks pass."),
    assertCondition("button_enabled", packet.source.runButtonShouldBeEnabled === true, "Run-button flag is true when all checks pass."),
    assertCondition("no_failed_checks", packet.executionGate.failedChecks.length === 0, "Ready fixture has no failed checks."),
    assertCondition("open_tabs", packet.tabStatus.openTabs === 4 && packet.tabStatus.missingTabs === 0, "Open/missing tab counts are preserved.")
  ]);
}

function createNoConfirmScenario(packet) {
  const failedCheckNames = packet.executionGate.failedChecks.map((check) => check.check);
  return createScenario("execution_gate_no_confirmation_blocks", [
    assertCondition("blocked", packet.executionGate.status === "blocked_before_live_threshold_execution", "Missing confirmation blocks execution gate."),
    assertCondition("phrase_failed", failedCheckNames.includes("operator_phrase_matches"), "Phrase check fails."),
    assertCondition("ack_failed", failedCheckNames.includes("operator_acknowledgement_checked"), "Acknowledgement check fails.")
  ], { failedCheckNames });
}

function createSmallScenario(packet) {
  const failedCheckNames = packet.executionGate.failedChecks.map((check) => check.check);
  return createScenario("execution_gate_small_workspace_blocks", [
    assertCondition("blocked", packet.executionGate.status === "blocked_before_live_threshold_execution", "Small workspace blocks execution gate."),
    assertCondition("policy_failed", failedCheckNames.includes("dedicated_window_policy_active"), "Dedicated-window policy check fails."),
    assertCondition("threshold_failed", failedCheckNames.includes("minimum_tab_threshold_met"), "Minimum threshold check fails.")
  ], { failedCheckNames });
}

function createUnresolvedScenario(packet) {
  const failedCheckNames = packet.executionGate.failedChecks.map((check) => check.check);
  return createScenario("execution_gate_unresolved_tabs_blocks", [
    assertCondition("blocked", packet.executionGate.status === "blocked_before_live_threshold_execution", "Unresolved tabs block execution gate."),
    assertCondition("resolution_failed", failedCheckNames.includes("live_workspace_tabs_resolved"), "Live tab resolution check fails."),
    assertCondition("resolved_count_zero", packet.liveResolution.resolvedCount === 0 && packet.liveResolution.unresolvedCount === 4, "Resolution counts are preserved.")
  ], { failedCheckNames });
}

function createCallerSortedScenario(packet) {
  const tabMoveIds = packet.browserPlan.tabMovePlan.map((item) => item.workspaceTabId);
  return createScenario("execution_gate_preserves_caller_supplied_ordering", [
    assertCondition("first_tab_reversed", tabMoveIds[0] === "execution-gate-tab-4", "Caller-supplied order controls the first planned move."),
    assertCondition("last_tab_reversed", tabMoveIds[3] === "execution-gate-tab-1", "Caller-supplied order controls the final planned move."),
    assertCondition("planned_groups_follow_order", packet.browserPlan.plannedGroups[0]?.role === "docs" && packet.browserPlan.plannedGroups[3]?.role === "source", "Planned groups follow caller-supplied result order."),
    assertCondition("gate_still_ready", packet.executionGate.status === "ready_for_live_threshold_execution", "Caller ordering does not break a ready gate.")
  ], { tabMoveIds });
}

function createBoundaryScenario(packet) {
  return createScenario("execution_gate_boundary_preserved", [
    assertCondition("source_read_only", packet.source.readOnly === true, "Source is read-only."),
    assertCondition("runtime_action_not_executed", packet.source.runtimeActionExecuted === false, "No runtime action is executed."),
    assertCondition("browser_projection_not_changed", packet.source.browserProjectionChanged === false, "No browser projection is changed."),
    assertCondition("session_db_not_changed", packet.source.sessionDbChanged === false, "No Session DB write occurs."),
    assertCondition("chrome_storage_not_changed", packet.source.chromeStorageRuntimeChanged === false, "No chrome.storage.local runtime change occurs.")
  ]);
}

function createGatePacket(options) {
  const workspace = createFixtureWorkspace(options.workspaceId);
  const tabs = createFixtureTabs(options.tabCount);
  workspace.tabs = tabs;
  return buildThresholdExecutionGatePacket({
    workspace,
    tabs,
    resolution: createFixtureResolution(tabs, options.resolutionMode),
    phrase: options.phrase,
    acknowledgementChecked: options.acknowledgementChecked,
    createdAt: "2026-01-01T00:00:00.000Z",
    sortResolvedResults: options.sortResolvedResults
  });
}

function createFixtureWorkspace(workspaceId) {
  return {
    workspaceId,
    name: "Execution Gate Fixture Workspace",
    workspaceType: "research",
    aim: "Validate execution gate construction"
  };
}

function createFixtureTabs(tabCount) {
  const roles = ["source", "question", "reference", "docs", "counterpoint"];
  return Array.from({ length: tabCount }, (_, index) => ({
    workspaceTabId: "execution-gate-tab-" + (index + 1),
    tabId: 6000 + index,
    index,
    windowId: 7000,
    groupId: -1,
    role: roles[index % roles.length],
    url: "https://example.com/execution-gate-fixture-" + (index + 1),
    originalTitle: "Execution gate fixture " + (index + 1),
    isOpen: true
  }));
}

function createFixtureResolution(tabs, resolutionMode) {
  const browserTabs = resolutionMode === "resolved" ? tabs.map((tab) => ({
    id: tab.tabId,
    windowId: tab.windowId,
    groupId: tab.groupId,
    index: tab.index,
    title: tab.originalTitle,
    url: tab.url,
    active: false,
    pinned: false
  })) : [];

  return {
    browserTabs,
    results: tabs.map((tab) => {
      const liveTab = resolutionMode === "resolved" ? browserTabs.find((browserTab) => browserTab.id === tab.tabId) : null;
      return {
        workspaceTab: tab,
        liveTab,
        matchStatus: liveTab ? "exact_tab_id" : "not_found",
        candidateCount: liveTab ? 1 : 0
      };
    })
  };
}

function reverseResolvedResults(results) {
  return [...results].reverse();
}

function createNextDecision(overallStatus) {
  if (overallStatus !== "pass") {
    return {
      recommendation: "hold",
      reason: "Migrated execution gate packet construction did not validate. Do not wire the browser-control surface onto it."
    };
  }

  return {
    recommendation: "ready_to_wire_execution_surface_to_migrated_gate",
    reason: "Migrated execution gate packet construction validates, including caller-supplied result ordering. The browser-control surface can be wired onto this builder in a separate patch."
  };
}

function createSummary(packet) {
  return "Workspace control execution gate validation suite: " + packet.suite.overallStatus + " | Scenarios: " + packet.suite.passedScenarioCount + "/" + packet.suite.scenarioCount + " pass | Next: " + packet.nextDecision.recommendation + ".";
}

function setSummary(message) {
  const summary = document.getElementById("workspaceControlExecutionGateValidationSuiteSummary");
  if (summary) summary.textContent = message;
}

function setStatus(message) {
  const status = document.getElementById("workspaceControlExecutionGateValidationSuiteStatus");
  if (status) status.textContent = message;
}

function setOutput(value) {
  const output = document.getElementById("workspaceControlExecutionGateValidationSuiteOutput");
  if (output) output.textContent = JSON.stringify(value, null, 2);
}

function setError(message, error) {
  setOutput({ status: "error", message, error: { name: error?.name || "Error", message: error?.message || String(error) } });
  setStatus(message);
}
