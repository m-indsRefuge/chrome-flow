import {
  DEDICATED_WINDOW_THRESHOLD,
  TARGET_MODE_NEW_WINDOW,
  blockedReasons,
  buildWorkspaceTabStatus,
  classifyDedicatedWindowThreshold,
  createCheck,
  createClipboardBlock,
  createPlannedRoleGroups,
  createWorkspaceIdentityBlock,
  failedChecks as collectFailedChecks,
  formatPacketEnvelope,
  humanizeRole
} from "../core/workspace-control/workspace-control-gates.js";

const EXECUTION_PHRASE = "MOVE WORKSPACE TO DEDICATED WINDOW";

function buildThresholdExecutionGatePacket({
  workspace = {},
  tabs = [],
  resolution,
  phrase = "",
  acknowledgementChecked = false,
  createdAt = null,
  roleLabeler = humanizeRole
} = {}) {
  const safeTabs = Array.isArray(tabs) ? tabs : [];
  const safeResolution = resolution || createEmptyResolution(safeTabs);
  const resolvedResults = safeResolution.results.filter((result) => result.liveTab);
  const sortedResults = sortResultsByRuntimeOrder(resolvedResults);
  const sortedWorkspaceTabs = sortedResults.map((result) => result.workspaceTab);
  const tabStatus = buildExecutionTabStatus(safeTabs, safeResolution.results);
  const plannedGroups = createPlannedRoleGroups(sortedWorkspaceTabs, { roleLabeler });
  const policy = classifyDedicatedWindowThreshold(tabStatus.totalTabs);
  const phraseMatches = phrase === EXECUTION_PHRASE;
  const operatorConfirmed = phraseMatches && acknowledgementChecked;
  const checks = createExecutionGateChecks({ workspace, tabStatus, plannedGroups, policy, phraseMatches, acknowledgementChecked, resolution: safeResolution });
  const failedChecks = collectFailedChecks(checks);
  const ready = failedChecks.length === 0;

  return {
    packetType: "Chrome Flow Dedicated Window Threshold Execution Precheck Packet",
    createdAt: createdAt || new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "dedicated-window-threshold-execution-precheck-packet-v0.1"
    },
    clipboard: createClipboardBlock(),
    source: {
      type: "workspace_dedicated_window_threshold_execution_precheck",
      readOnly: true,
      executionPrecheckOnly: true,
      liveActionAvailable: ready,
      runtimeActionExecuted: false,
      browserProjectionChanged: false,
      sessionDbChanged: false,
      chromeStorageRuntimeChanged: false,
      runButtonShouldBeEnabled: ready
    },
    workspace: createWorkspaceIdentityBlock(workspace),
    thresholdPolicy: {
      thresholdTabCount: DEDICATED_WINDOW_THRESHOLD,
      targetMode: TARGET_MODE_NEW_WINDOW,
      policyStatus: policy.status,
      dedicatedWindowPolicyActive: policy.dedicatedWindowPolicyActive,
      currentWindowStillValid: policy.currentWindowStillValid
    },
    tabStatus,
    liveResolution: summarizeResolution(safeResolution),
    browserPlan: {
      targetMode: TARGET_MODE_NEW_WINDOW,
      action: "move_existing_workspace_tabs_to_dedicated_window",
      expectedWindowCountDelta: 1,
      plannedTabCount: sortedResults.length,
      plannedGroupCount: plannedGroups.length,
      plannedGroups,
      tabMovePlan: sortedResults.map((result, index) => ({
        workspaceTabId: result.workspaceTab.workspaceTabId,
        tabId: result.liveTab.id,
        sourceWindowId: result.liveTab.windowId,
        role: result.workspaceTab.role || "unassigned",
        targetIndex: index
      }))
    },
    operatorConfirmation: {
      requiredPhrase: EXECUTION_PHRASE,
      phraseMatches,
      acknowledgementChecked,
      operatorConfirmed
    },
    executionGate: {
      status: ready ? "ready_for_live_threshold_execution" : "blocked_before_live_threshold_execution",
      availableInThisSlice: ready,
      checks,
      failedChecks,
      blockedReasons: blockedReasons(checks),
      notes: [
        "This packet gates a live browser action.",
        "Execution moves existing open workspace tabs into one dedicated Chrome window.",
        "Execution must rebuild this gate immediately before any live action.",
        "Session DB is not written by this command.",
        "chrome.storage.local active workspace may receive metadata and timeline updates, but the active workspace is not replaced."
      ]
    }
  };
}

function createExecutionGateChecks({ workspace, tabStatus, plannedGroups, policy, phraseMatches, acknowledgementChecked, resolution }) {
  const summary = summarizeResolution(resolution);
  return [
    createExecutionCheck("runtime_workspace_exists", Boolean(workspace?.workspaceId), "Active runtime workspace exists."),
    createExecutionCheck("dedicated_window_policy_active", policy.dedicatedWindowPolicyActive === true, "Active workspace is in the 4+ tab dedicated-window policy range."),
    createExecutionCheck("minimum_tab_threshold_met", tabStatus.totalTabs >= DEDICATED_WINDOW_THRESHOLD, "Active workspace has at least 4 tabs."),
    createExecutionCheck("workspace_tabs_have_urls", tabStatus.totalTabs > 0 && tabStatus.missingUrlCount === 0, "All active workspace tabs have URLs."),
    createExecutionCheck("workspace_tabs_have_roles", tabStatus.totalTabs > 0 && tabStatus.unassignedTabs === 0, "All active workspace tabs have assigned roles."),
    createExecutionCheck("planned_groups_available", plannedGroups.length > 0, "Planned role groups are available."),
    createExecutionCheck("live_workspace_tabs_resolved", summary.workspaceTabCount > 0 && summary.resolvedCount === summary.workspaceTabCount, "All workspace tab records resolve to live browser tabs."),
    createExecutionCheck("target_mode_new_window", TARGET_MODE_NEW_WINDOW === "new_window", "Target mode is new_window."),
    createExecutionCheck("operator_phrase_matches", phraseMatches, "Operator typed the required execution phrase."),
    createExecutionCheck("operator_acknowledgement_checked", acknowledgementChecked, "Operator checked the threshold execution acknowledgement."),
    createExecutionCheck("no_runtime_action_executed_yet", true, "Precheck packet does not execute runtime action."),
    createExecutionCheck("no_browser_projection_changed_yet", true, "Precheck packet does not change browser projection."),
    createExecutionCheck("no_session_db_changed", true, "Precheck packet does not write Session DB."),
    createExecutionCheck("no_chrome_storage_runtime_changed_yet", true, "Precheck packet does not change chrome.storage.local before execution.")
  ];
}

function createExecutionCheck(check, passed, message) {
  return createCheck(check, passed, message, "block");
}

function buildExecutionTabStatus(tabs, resolutionResults = []) {
  const baseStatus = buildWorkspaceTabStatus(tabs);
  const openTabs = resolutionResults.filter((result) => result.liveTab).length;
  return {
    ...baseStatus,
    openTabs,
    missingTabs: baseStatus.totalTabs - openTabs
  };
}

function summarizeResolution(resolution) {
  const results = resolution.results.map((result) => ({
    workspaceTabId: result.workspaceTab.workspaceTabId,
    savedTabId: result.workspaceTab.tabId,
    savedUrl: result.workspaceTab.url,
    role: result.workspaceTab.role || "unassigned",
    matchStatus: result.matchStatus,
    candidateCount: result.candidateCount,
    liveTabId: result.liveTab?.id ?? null,
    liveWindowId: result.liveTab?.windowId ?? null,
    liveGroupId: result.liveTab?.groupId ?? null
  }));
  return {
    browserTabCount: resolution.browserTabs.length,
    workspaceTabCount: resolution.results.length,
    resolvedCount: results.filter((result) => Number.isInteger(result.liveTabId)).length,
    unresolvedCount: results.filter((result) => !Number.isInteger(result.liveTabId)).length,
    results
  };
}

function createEmptyResolution(tabs) {
  return {
    browserTabs: [],
    results: tabs.map((workspaceTab) => ({
      workspaceTab,
      liveTab: null,
      matchStatus: "not_found",
      candidateCount: 0
    }))
  };
}

function sortResultsByRuntimeOrder(results) {
  return [...results].sort((left, right) => {
    const leftIndex = Number.isInteger(left.liveTab?.index) ? left.liveTab.index : Number.MAX_SAFE_INTEGER;
    const rightIndex = Number.isInteger(right.liveTab?.index) ? right.liveTab.index : Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return String(left.workspaceTab.workspaceTabId || left.workspaceTab.tabId || left.workspaceTab.url || "").localeCompare(String(right.workspaceTab.workspaceTabId || right.workspaceTab.tabId || right.workspaceTab.url || ""));
  });
}

function formatThresholdExecutionGatePacket(packet) {
  return formatPacketEnvelope(packet);
}

export {
  EXECUTION_PHRASE,
  buildThresholdExecutionGatePacket,
  formatThresholdExecutionGatePacket
};
