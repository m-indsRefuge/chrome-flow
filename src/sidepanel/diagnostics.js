const WORKSPACE_KEY = "chromeFlowWorkspace";
const DIAGNOSTICS_KEY = "chromeFlowDiagnostics";
const MAX_DIAGNOSTICS = 200;
const MAX_PACKET_EVENTS = 30;
const ACTION_TRACE_TIMEOUT_MS = 30000;
const ACTION_TRACE_POLL_MS = 1000;

const diagnosticsStatus = document.getElementById("diagnosticsStatus");
const diagnosticsSummary = document.getElementById("diagnosticsSummary");
const diagnosticsList = document.getElementById("diagnosticsList");
const refreshDiagnosticsButton = document.getElementById("refreshDiagnosticsButton");
const copyDiagnosticPacketButton = document.getElementById("copyDiagnosticPacketButton");
const clearDiagnosticsButton = document.getElementById("clearDiagnosticsButton");

const pendingActionTraces = new Map();

window.addEventListener("error", (event) => {
  void recordDiagnostic("error", "runtime_error", event.message || "Runtime error captured.", {
    source: event.filename || "unknown",
    line: event.lineno || null,
    column: event.colno || null,
    error: summarizeError(event.error)
  });
});

window.addEventListener("unhandledrejection", (event) => {
  void recordDiagnostic("error", "unhandled_rejection", "Unhandled promise rejection captured.", {
    reason: summarizeError(event.reason)
  });
});

document.addEventListener("click", (event) => {
  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return;
  }

  const button = target.closest("button");

  if (!button) {
    return;
  }

  const buttonId = button.id || "";
  const buttonText = (button.textContent || "").trim();

  if (!buttonId && !buttonText) {
    return;
  }

  const clickContext = {
    buttonId: buttonId,
    buttonText: buttonText
  };

  void recordDiagnostic("info", "ui_click", "Button clicked: " + (buttonId || buttonText) + ".", clickContext);

  const traceDefinition = getActionTraceDefinition(clickContext);

  if (traceDefinition) {
    void startActionTrace(traceDefinition, clickContext);
  }
});

refreshDiagnosticsButton?.addEventListener("click", async () => {
  await recordDiagnostic("info", "diagnostics_refreshed", "Developer diagnostics view refreshed.");
  await renderDiagnostics();
});

copyDiagnosticPacketButton?.addEventListener("click", async () => {
  try {
    const packet = await buildDiagnosticPacket();
    await navigator.clipboard.writeText(packet);
    setDiagnosticsStatus("Diagnostic packet copied. Paste it into the chat when reporting an issue.");
    await recordDiagnostic("info", "diagnostic_packet_copied", "Diagnostic packet copied to clipboard.");
    await renderDiagnostics();
  } catch (error) {
    setDiagnosticsStatus("Could not copy diagnostic packet. Open the console and check clipboard permissions.");
    await recordDiagnostic("error", "diagnostic_packet_copy_failed", "Could not copy diagnostic packet.", {
      error: summarizeError(error)
    });
    await renderDiagnostics();
  }
});

clearDiagnosticsButton?.addEventListener("click", async () => {
  const confirmed = window.confirm("Clear Chrome Flow developer diagnostics? This does not clear the User Journal, System Journal, Recovery Journal, workspace tabs, or browser tabs.");

  if (!confirmed) {
    return;
  }

  await chrome.storage.local.set({ [DIAGNOSTICS_KEY]: [] });
  setDiagnosticsStatus("Developer diagnostics cleared.");
  await renderDiagnostics();
});

void initializeDiagnostics();

async function initializeDiagnostics() {
  await recordDiagnostic("info", "diagnostics_loaded", "Developer diagnostics module loaded.");
  await renderDiagnostics();
}

async function recordDiagnostic(level, action, message, details = {}) {
  try {
    const diagnostics = await getDiagnostics();
    diagnostics.push({
      diagnosticId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      level: level,
      action: action,
      message: message,
      details: sanitizeDetails(details)
    });

    const trimmedDiagnostics = diagnostics.slice(-MAX_DIAGNOSTICS);
    await chrome.storage.local.set({ [DIAGNOSTICS_KEY]: trimmedDiagnostics });
  } catch (error) {
    console.warn("Chrome Flow diagnostics logging failed:", error);
  }
}

async function getDiagnostics() {
  const result = await chrome.storage.local.get(DIAGNOSTICS_KEY);
  return Array.isArray(result[DIAGNOSTICS_KEY]) ? result[DIAGNOSTICS_KEY] : [];
}

async function getWorkspace() {
  const result = await chrome.storage.local.get(WORKSPACE_KEY);
  return result[WORKSPACE_KEY] || null;
}

async function startActionTrace(traceDefinition, clickContext) {
  const workspace = await getWorkspace();
  const timelineLength = Array.isArray(workspace?.timeline) ? workspace.timeline.length : 0;
  const traceId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const successTypes = traceDefinition.successTypes || [];
  const skippedTypes = traceDefinition.skippedTypes || [];
  const failedTypes = traceDefinition.failedTypes || [];
  const intermediateTypes = traceDefinition.intermediateTypes || [];

  pendingActionTraces.set(traceId, {
    traceId: traceId,
    actionName: traceDefinition.actionName,
    label: traceDefinition.label,
    successTypes: successTypes,
    skippedTypes: skippedTypes,
    failedTypes: failedTypes,
    intermediateTypes: intermediateTypes,
    terminalTypes: [
      ...successTypes,
      ...skippedTypes,
      ...failedTypes
    ],
    allObservedTypes: [
      ...intermediateTypes,
      ...successTypes,
      ...skippedTypes,
      ...failedTypes
    ],
    observedIntermediateEventIds: [],
    clickContext: clickContext,
    startedAt: startedAt,
    startedAtMs: Date.now(),
    timelineLength: timelineLength
  });

  await recordDiagnostic("info", "action_started", "Action started: " + traceDefinition.label + ".", {
    traceId: traceId,
    actionName: traceDefinition.actionName,
    buttonId: clickContext.buttonId,
    buttonText: clickContext.buttonText,
    timelineLength: timelineLength,
    intermediateEventTypes: intermediateTypes,
    terminalEventTypes: [
      ...successTypes,
      ...skippedTypes,
      ...failedTypes
    ]
  });

  scheduleActionTracePoll(traceId);
}

function scheduleActionTracePoll(traceId) {
  window.setTimeout(() => {
    void pollActionTrace(traceId);
  }, ACTION_TRACE_POLL_MS);
}

async function pollActionTrace(traceId) {
  const trace = pendingActionTraces.get(traceId);

  if (!trace) {
    return;
  }

  const workspace = await getWorkspace();
  const timeline = Array.isArray(workspace?.timeline) ? workspace.timeline : [];
  const intermediateEvents = findNewIntermediateEvents(trace, timeline);

  for (const intermediateEvent of intermediateEvents) {
    trace.observedIntermediateEventIds.push(intermediateEvent.eventId || intermediateEvent.createdAt || intermediateEvent.type);
    await recordActionIntermediate(trace, intermediateEvent);
  }

  const terminalEvent = findTerminalActionEvent(trace, timeline);

  if (terminalEvent) {
    pendingActionTraces.delete(traceId);
    await recordActionResult(trace, terminalEvent, workspace);
    await renderDiagnostics();
    return;
  }

  const elapsedMs = Date.now() - trace.startedAtMs;

  if (elapsedMs >= ACTION_TRACE_TIMEOUT_MS) {
    pendingActionTraces.delete(traceId);
    await recordDiagnostic("warn", "action_no_result_observed", "No terminal System Journal event was observed for: " + trace.label + ".", {
      traceId: trace.traceId,
      actionName: trace.actionName,
      buttonId: trace.clickContext.buttonId,
      buttonText: trace.clickContext.buttonText,
      waitedMs: elapsedMs,
      intermediateEventTypes: trace.intermediateTypes,
      terminalEventTypes: trace.terminalTypes,
      observedIntermediateEventIds: trace.observedIntermediateEventIds,
      note: "This can happen if the user cancelled a confirmation/prompt, the action did not produce a terminal system event, or the event type is not mapped yet."
    });
    await renderDiagnostics();
    return;
  }

  scheduleActionTracePoll(traceId);
}

function findNewIntermediateEvents(trace, timeline) {
  if (!trace.intermediateTypes.length) {
    return [];
  }

  return timeline
    .slice(trace.timelineLength)
    .filter((event) => {
      if (!event || !trace.intermediateTypes.includes(event.type)) {
        return false;
      }

      if (event.createdAt && Date.parse(event.createdAt) < Date.parse(trace.startedAt)) {
        return false;
      }

      const eventKey = event.eventId || event.createdAt || event.type;
      return !trace.observedIntermediateEventIds.includes(eventKey);
    });
}

function findTerminalActionEvent(trace, timeline) {
  return timeline
    .slice(trace.timelineLength)
    .find((event) => {
      if (!event || !trace.terminalTypes.includes(event.type)) {
        return false;
      }

      if (!event.createdAt) {
        return true;
      }

      return Date.parse(event.createdAt) >= Date.parse(trace.startedAt);
    });
}

async function recordActionIntermediate(trace, intermediateEvent) {
  await recordDiagnostic("info", "action_intermediate", "Action intermediate event observed: " + trace.label + ".", {
    traceId: trace.traceId,
    actionName: trace.actionName,
    buttonId: trace.clickContext.buttonId,
    buttonText: trace.clickContext.buttonText,
    observedEvent: createObservedEventSummary(intermediateEvent)
  });
}

async function recordActionResult(trace, observedEvent, workspace) {
  const tabStatus = await calculateTabStatus(workspace);
  const resultType = getActionResultType(trace, observedEvent);
  const diagnosticLevel = resultType === "failed" ? "error" : resultType === "skipped" ? "warn" : "info";
  const diagnosticAction = "action_" + resultType;

  await recordDiagnostic(diagnosticLevel, diagnosticAction, "Action " + resultType + ": " + trace.label + ".", {
    traceId: trace.traceId,
    actionName: trace.actionName,
    buttonId: trace.clickContext.buttonId,
    buttonText: trace.clickContext.buttonText,
    observedEvent: createObservedEventSummary(observedEvent),
    observedIntermediateEventIds: trace.observedIntermediateEventIds,
    tabStatus: tabStatus
  });
}

function createObservedEventSummary(event) {
  return {
    eventId: event.eventId || "",
    type: event.type || "unknown",
    message: event.message || "",
    createdAt: event.createdAt || ""
  };
}

function getActionResultType(trace, observedEvent) {
  if (trace.failedTypes.includes(observedEvent.type)) {
    return "failed";
  }

  if (trace.skippedTypes.includes(observedEvent.type)) {
    return "skipped";
  }

  return "success";
}

function getActionTraceDefinition(clickContext) {
  const buttonId = clickContext.buttonId;
  const buttonText = clickContext.buttonText;

  if (buttonId === "scanTabsButton") {
    return createActionTraceDefinition("scanCurrentWindowTabs", "Scan Current Window Tabs", ["tabs_scanned"]);
  }

  if (buttonId === "addSelectedTabsButton") {
    return createActionTraceDefinition("addSelectedTabsToWorkspace", "Add Selected Tabs to Workspace", ["selected_tabs_added"]);
  }

  if (buttonId === "openSearchTabButton") {
    return createActionTraceDefinition("openSearchTab", "Open Search Tab", ["browser_search_tab_opened"]);
  }

  if (buttonId === "createChromeGroupsButton") {
    return createActionTraceDefinition("createChromeTabGroups", "Create Chrome Tab Groups", ["chrome_tab_groups_created"], ["chrome_tab_grouping_skipped"], ["chrome_tab_grouping_failed"]);
  }

  if (buttonId === "removeChromeGroupsButton") {
    return createActionTraceDefinition("removeAllChromeTabGroups", "Remove All Chrome Tab Groups", ["chrome_tab_groups_removed"], ["chrome_tab_groups_remove_skipped"], ["chrome_tab_groups_remove_failed"]);
  }

  if (buttonId === "refreshWorkspaceTabsButton") {
    return createActionTraceDefinition("refreshWorkspaceTabMetadata", "Refresh Workspace Tab Metadata", ["workspace_tabs_refreshed"]);
  }

  if (buttonId === "clearWorkspaceTabsButton") {
    return createActionTraceDefinition("clearWorkspaceTabs", "Clear Workspace Tabs", ["workspace_tabs_cleared"]);
  }

  if (buttonId === "refreshTabStatusButton") {
    return createActionTraceDefinition("refreshTabStatus", "Refresh Tab Status", ["workspace_tab_status_refreshed"], [], ["workspace_tab_status_refresh_failed"]);
  }

  if (buttonId === "addJournalButton") {
    return createActionTraceDefinition("addUserJournalEntry", "Add User Journal Entry", ["user_journal_added"]);
  }

  if (buttonText === "Focus Group") {
    return createActionTraceDefinition("focusChromeGroupForRole", "Focus Group", ["chrome_tab_group_focused"], ["chrome_tab_group_focus_skipped"], ["chrome_tab_group_focus_failed"]);
  }

  if (buttonText === "Remove Chrome Group") {
    return createActionTraceDefinition("removeChromeTabGroupForRole", "Remove Chrome Group", ["chrome_tab_group_removed"], ["chrome_tab_group_remove_skipped"], ["chrome_tab_group_remove_failed"]);
  }

  if (buttonText === "Focus Tab") {
    return createActionTraceDefinition("focusWorkspaceTab", "Focus Tab", ["browser_tab_focused"], [], ["browser_tab_focus_failed"]);
  }

  if (buttonText === "Close Browser Tab") {
    return createActionTraceDefinition("closeBrowserTabAndRemoveFromWorkspace", "Close Browser Tab", ["browser_tab_closed_and_removed"], [], ["browser_tab_close_failed"]);
  }

  if (buttonText === "Remove from Workspace") {
    return createActionTraceDefinition("removeWorkspaceTab", "Remove from Workspace", ["workspace_tab_removed"]);
  }

  if (buttonText === "Reopen URL") {
    return createActionTraceDefinition("reopenUrlFromRecovery", "Reopen URL", ["timeline_url_reopened"]);
  }

  if (buttonText === "Re-add to Workspace") {
    return createActionTraceDefinition("readdTabFromRecovery", "Re-add to Workspace", ["workspace_tab_readded"]);
  }

  if (buttonText === "Recreate Chrome Groups") {
    return createActionTraceDefinition(
      "recreateChromeGroupsFromRecovery",
      "Recreate Chrome Groups",
      ["chrome_tab_groups_created"],
      ["chrome_tab_grouping_skipped"],
      ["chrome_tab_grouping_failed"],
      ["timeline_chrome_groups_recreate_requested"]
    );
  }

  return null;
}

function createActionTraceDefinition(actionName, label, successTypes = [], skippedTypes = [], failedTypes = [], intermediateTypes = []) {
  return {
    actionName: actionName,
    label: label,
    successTypes: successTypes,
    skippedTypes: skippedTypes,
    failedTypes: failedTypes,
    intermediateTypes: intermediateTypes
  };
}

async function renderDiagnostics() {
  const workspace = await getWorkspace();
  const diagnostics = await getDiagnostics();
  const tabStatus = await calculateTabStatus(workspace);

  renderDiagnosticsSummary(workspace, diagnostics, tabStatus);
  renderDiagnosticsList(diagnostics);
}

function renderDiagnosticsSummary(workspace, diagnostics, tabStatus) {
  clearElement(diagnosticsSummary);

  const summary = document.createElement("div");
  summary.className = "diagnostics-summary-grid";

  summary.appendChild(createDiagnosticsMetric("Workspace", workspace?.name || "Unnamed"));
  summary.appendChild(createDiagnosticsMetric("Type", workspace?.workspaceType || "unknown"));
  summary.appendChild(createDiagnosticsMetric("Tabs", String(workspace?.tabs?.length || 0)));
  summary.appendChild(createDiagnosticsMetric("Open", String(tabStatus.openTabs)));
  summary.appendChild(createDiagnosticsMetric("Grouped", String(tabStatus.groupedTabs)));
  summary.appendChild(createDiagnosticsMetric("Diagnostics", String(diagnostics.length)));

  diagnosticsSummary.appendChild(summary);
}

function createDiagnosticsMetric(label, value) {
  const card = document.createElement("div");
  card.className = "diagnostics-summary-card";

  const strong = document.createElement("strong");
  strong.textContent = value;
  card.appendChild(strong);

  const span = document.createElement("span");
  span.textContent = label;
  card.appendChild(span);

  return card;
}

function renderDiagnosticsList(diagnostics) {
  clearElement(diagnosticsList);

  if (!diagnostics.length) {
    const empty = document.createElement("p");
    empty.textContent = "No developer diagnostics recorded yet.";
    diagnosticsList.appendChild(empty);
    return;
  }

  diagnostics.slice().reverse().slice(0, 30).forEach((event) => {
    const card = document.createElement("div");
    card.className = "diagnostic-card diagnostic-" + event.level;

    const heading = document.createElement("strong");
    heading.textContent = event.level.toUpperCase() + " · " + event.action;
    card.appendChild(heading);

    const message = document.createElement("p");
    message.textContent = event.message;
    card.appendChild(message);

    if (event.details && Object.keys(event.details).length) {
      const details = document.createElement("pre");
      details.textContent = JSON.stringify(event.details, null, 2);
      card.appendChild(details);
    }

    const time = document.createElement("small");
    time.textContent = event.createdAt;
    card.appendChild(time);
    diagnosticsList.appendChild(card);
  });
}

async function buildDiagnosticPacket() {
  const workspace = await getWorkspace();
  const diagnostics = await getDiagnostics();
  const tabStatus = await calculateTabStatus(workspace);
  const recentTimeline = Array.isArray(workspace?.timeline) ? workspace.timeline.slice(-MAX_PACKET_EVENTS) : [];
  const recentDiagnostics = diagnostics.slice(-MAX_PACKET_EVENTS);
  const recentActionResultDiagnostics = diagnostics
    .filter((event) => typeof event.action === "string" && event.action.startsWith("action_"))
    .slice(-MAX_PACKET_EVENTS);
  const recoverableEvents = recentTimeline.filter((event) => event.recoveryActions);

  const packet = {
    packetType: "Chrome Flow Diagnostic Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "diagnostic-packet-v0.3"
    },
    workspace: {
      workspaceId: workspace?.workspaceId || "unknown",
      name: workspace?.name || "",
      workspaceType: workspace?.workspaceType || "unknown",
      tabCount: Array.isArray(workspace?.tabs) ? workspace.tabs.length : 0,
      journalCount: Array.isArray(workspace?.journal) ? workspace.journal.length : 0,
      timelineCount: Array.isArray(workspace?.timeline) ? workspace.timeline.length : 0
    },
    tabStatus: tabStatus,
    pendingActionTraces: Array.from(pendingActionTraces.values()).map((trace) => ({
      traceId: trace.traceId,
      actionName: trace.actionName,
      label: trace.label,
      startedAt: trace.startedAt,
      buttonId: trace.clickContext.buttonId,
      buttonText: trace.clickContext.buttonText,
      intermediateEventTypes: trace.intermediateTypes,
      terminalEventTypes: trace.terminalTypes,
      observedIntermediateEventIds: trace.observedIntermediateEventIds,
      expectedEventTypes: trace.allObservedTypes
    })),
    recentDiagnostics: recentDiagnostics,
    recentActionResultDiagnostics: recentActionResultDiagnostics,
    recentSystemEvents: recentTimeline,
    recentRecoverableEvents: recoverableEvents,
    notes: [
      "This packet is generated locally by Chrome Flow.",
      "It does not intentionally include page content.",
      "Review before sharing if workspace names, tab titles, and URLs are sensitive.",
      "Action result diagnostics link known button clicks to observed System Journal outcomes.",
      "Multi-step diagnostics separate intermediate events from terminal success, skipped, or failed events."
    ]
  };

  return JSON.stringify(packet, null, 2);
}

async function calculateTabStatus(workspace) {
  const tabs = Array.isArray(workspace?.tabs) ? workspace.tabs : [];

  try {
    const browserTabs = await chrome.tabs.query({});
    const liveWorkspaceTabs = tabs
      .map((workspaceTab) => ({
        workspaceTab: workspaceTab,
        liveTab: findBrowserTabMatch(workspaceTab, browserTabs)
      }))
      .filter((item) => Boolean(item.liveTab));

    const groupedTabs = liveWorkspaceTabs.filter((item) => Number.isInteger(item.liveTab.groupId) && item.liveTab.groupId >= 0);

    return {
      totalTabs: tabs.length,
      openTabs: liveWorkspaceTabs.length,
      missingTabs: Math.max(tabs.length - liveWorkspaceTabs.length, 0),
      groupedTabs: groupedTabs.length,
      ungroupedTabs: Math.max(liveWorkspaceTabs.length - groupedTabs.length, 0),
      unassignedTabs: tabs.filter((tab) => (tab.role || "unassigned") === "unassigned").length
    };
  } catch (error) {
    await recordDiagnostic("error", "diagnostic_tab_status_failed", "Could not calculate tab status for diagnostics.", {
      error: summarizeError(error)
    });

    return {
      totalTabs: tabs.length,
      openTabs: 0,
      missingTabs: tabs.length,
      groupedTabs: 0,
      ungroupedTabs: 0,
      unassignedTabs: tabs.filter((tab) => (tab.role || "unassigned") === "unassigned").length,
      error: "Could not query browser tabs."
    };
  }
}

function findBrowserTabMatch(workspaceTab, browserTabs) {
  return browserTabs.find((tab) =>
    tab.id === workspaceTab.tabId ||
    tab.url === workspaceTab.url ||
    createTabKey(tab) === workspaceTab.tabKey
  );
}

function createTabKey(tab) {
  return (tab.url || "") + "::" + (tab.title || "");
}

function sanitizeDetails(details) {
  try {
    return JSON.parse(JSON.stringify(details, truncateLongStrings));
  } catch (error) {
    return { serializationError: String(error) };
  }
}

function truncateLongStrings(key, value) {
  if (typeof value === "string" && value.length > 1000) {
    return value.slice(0, 1000) + "...";
  }

  return value;
}

function summarizeError(error) {
  if (!error) {
    return { message: "Unknown error" };
  }

  if (typeof error === "string") {
    return { message: error };
  }

  return {
    name: error.name || "Error",
    message: error.message || String(error),
    stack: typeof error.stack === "string" ? error.stack.slice(0, 2000) : ""
  };
}

function setDiagnosticsStatus(message) {
  if (diagnosticsStatus) {
    diagnosticsStatus.textContent = message;
  }
}

function clearElement(element) {
  if (!element) {
    return;
  }

  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}
