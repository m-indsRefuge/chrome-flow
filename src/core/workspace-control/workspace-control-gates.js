const DEDICATED_WINDOW_THRESHOLD = 4;
const TARGET_MODE_NEW_WINDOW = "new_window";
const PACKET_ENVELOPE_START = "CHROME_FLOW_PACKET_START";
const PACKET_ENVELOPE_END = "CHROME_FLOW_PACKET_END";
const PACKET_CLIPBOARD_FORMAT = "chrome_flow_packet_envelope_v0.1";
const PACKET_CONTENT_TYPE = "application/json";

function buildWorkspaceTabStatus(tabs = []) {
  const safeTabs = Array.isArray(tabs) ? tabs : [];
  const totalTabs = safeTabs.length;
  const tabsWithUrls = safeTabs.filter((tab) => Boolean(tab.url)).length;
  const assignedTabs = safeTabs.filter((tab) => tab.role && tab.role !== "unassigned").length;
  const unassignedTabs = totalTabs - assignedTabs;
  const roleCounts = safeTabs.reduce((counts, tab) => {
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

function classifyDedicatedWindowThreshold(totalTabs, thresholdTabCount = DEDICATED_WINDOW_THRESHOLD) {
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

  if (totalTabs < thresholdTabCount) {
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

function createPlannedRoleGroups(tabs = [], options = {}) {
  const safeTabs = Array.isArray(tabs) ? tabs : [];
  const roleLabeler = typeof options.roleLabeler === "function" ? options.roleLabeler : humanizeRole;
  const roles = new Map();

  for (const tab of safeTabs) {
    const role = tab.role || "unassigned";
    if (role === "unassigned") continue;
    if (!roles.has(role)) roles.set(role, []);
    roles.get(role).push(tab.workspaceTabId || String(tab.tabId || tab.url || ""));
  }

  return Array.from(roles.entries()).map(([role, workspaceTabIds]) => ({
    role,
    roleLabel: roleLabeler(role),
    workspaceTabIds,
    plannedTabCount: workspaceTabIds.length,
    requiredForProjection: true
  }));
}

function createWorkspaceIdentityBlock(workspace = {}) {
  return {
    workspaceId: workspace?.workspaceId || "",
    name: workspace?.name || "",
    workspaceType: workspace?.workspaceType || workspace?.type || "",
    aim: workspace?.aim || ""
  };
}

function createThresholdPolicyBlock(policy, thresholdTabCount = DEDICATED_WINDOW_THRESHOLD, targetMode = TARGET_MODE_NEW_WINDOW) {
  return {
    thresholdTabCount,
    targetMode,
    policyStatus: policy.status,
    dedicatedWindowPolicyActive: policy.dedicatedWindowPolicyActive,
    currentWindowStillValid: policy.currentWindowStillValid
  };
}

function createCheck(check, passed, message, severity = "block") {
  return {
    check,
    status: passed ? "pass" : "fail",
    severity,
    message
  };
}

function failedChecks(checks = []) {
  return checks.filter((check) => check.status === "fail");
}

function blockedReasons(checks = []) {
  return failedChecks(checks).map((check) => check.message);
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

function formatPacketEnvelope(packet) {
  const clipboard = packet?.clipboard || createClipboardBlock();
  return [
    clipboard.envelopeStart || PACKET_ENVELOPE_START,
    "packetType: " + packet.packetType,
    "schema: " + packet.extension.schema,
    "clipboardFormat: " + (clipboard.format || PACKET_CLIPBOARD_FORMAT),
    "createdAt: " + packet.createdAt,
    "contentType: " + (clipboard.contentType || PACKET_CONTENT_TYPE),
    "",
    JSON.stringify(packet, null, 2),
    "",
    clipboard.envelopeEnd || PACKET_ENVELOPE_END
  ].join("\n");
}

function createBoundarySource(type, extra = {}) {
  return {
    type,
    readOnly: true,
    runtimeActionExecuted: false,
    browserProjectionChanged: false,
    sessionDbChanged: false,
    chromeStorageRuntimeChanged: false,
    ...extra
  };
}

function assertCondition(name, passed, message) {
  return {
    name,
    status: passed ? "pass" : "fail",
    message
  };
}

function createScenario(name, assertions, extra = {}) {
  const safeAssertions = Array.isArray(assertions) ? assertions.flat() : [];
  const failedAssertions = safeAssertions.filter((assertion) => assertion.status === "fail");
  return {
    ...extra,
    name,
    status: failedAssertions.length ? "fail" : "pass",
    assertions: safeAssertions,
    failedAssertions
  };
}

function assertReadOnlyBoundary(source) {
  return [
    assertCondition("source_read_only", source.readOnly === true, "Source is read-only."),
    assertCondition("runtime_action_not_executed", source.runtimeActionExecuted === false, "No runtime action executed."),
    assertCondition("browser_projection_not_changed", source.browserProjectionChanged === false, "No browser projection changed."),
    assertCondition("session_db_not_changed", source.sessionDbChanged === false, "No Session DB write occurred."),
    assertCondition("chrome_storage_runtime_not_changed", source.chromeStorageRuntimeChanged === false, "No chrome.storage.local runtime change occurred.")
  ];
}

function humanizeRole(role) {
  return String(role || "unassigned")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export {
  DEDICATED_WINDOW_THRESHOLD,
  TARGET_MODE_NEW_WINDOW,
  PACKET_ENVELOPE_START,
  PACKET_ENVELOPE_END,
  PACKET_CLIPBOARD_FORMAT,
  PACKET_CONTENT_TYPE,
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
};
