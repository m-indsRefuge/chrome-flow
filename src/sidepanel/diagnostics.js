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
  const newEvents = timeline.slice(trace.timelineLength);
  const observedEvents = newEvents.filter((event) => trace.allObservedTypes.includes(event.type));
  const terminalEvent = observedEvents.find((event) => trace.terminalTypes.includes(event.type));
  const intermediateEvents = observedEvents.filter((event) => trace.intermediateTypes.includes(event.type));

  for (const event of intermediateEvents) {
    if (!trace.observedIntermediateEventIds.includes(event.eventId)) {
      trace.observedIntermediateEventIds.push(event.eventId);
      await recordDiagnostic("info", "action_intermediate", "Action intermediate event observed: " + trace.label + ".", {
        traceId: trace.traceId,
        actionName: trace.actionName,
        buttonId: trace.clickContext.buttonId,
        buttonText: trace.clickContext.buttonText,
        observedEvent: createObservedEventSummary(event)
      });
    }
  }

  if (terminalEvent) {
    await finishActionTrace(trace, terminalEvent, workspace);
    pendingActionTraces.delete(traceId);
    return;
  }

  if (Date.now() - trace.startedAtMs >= ACTION_TRACE_TIMEOUT_MS) {
    await recordDiagnostic("warn", "action_no_result_observed", "No terminal action result observed for: " + trace.label + ".", {
      traceId: trace.traceId,
      actionName: trace.actionName,
      buttonId: trace.clickContext.buttonId,
      buttonText: trace.clickContext.buttonText,
      expectedTerminalEventTypes: trace.terminalTypes,
      observedIntermediateEventIds: trace.observedIntermediateEventIds,
      timelineLengthAtStart: trace.timelineLength,
      timelineLengthNow: timeline.length
    });
    pendingActionTraces.delete(traceId);
    return;
  }

  window.setTimeout(() => {
    void pollActionTrace(traceId);
  }, ACTION_TRACE_POLL_MS);
}

async function finishActionTrace(trace, observedEvent, workspace) {
  const resultType = getActionResultType(trace, observedEvent);
  const level = resultType === "failed" ? "error" : resultType === "skipped" ? "warn" : "info";
  const tabStatus = await calculateTabStatus(workspace);

  await recordDiagnostic(level, "action_" + resultType, "Action " + resultType + ": " + trace.label + ".", {
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

  if (buttonId === "addActiveTabButton") {
    return createActionTraceDefinition("addActiveTabToWorkspace", "Add Current Active Tab", ["active_tab_added"], ["active_tab_add_skipped"]);
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

  const grid = document.createElement("div");
  grid.className = "diagnostics-summary-grid";

  grid.appendChild(createSummaryCard("Workspace", workspace?.name || "Untitled"));
  grid.appendChild(createSummaryCard("Type", workspace?.workspaceType || "unknown"));
  grid.appendChild(createSummaryCard("Tabs", String(tabStatus.totalTabs)));
  grid.appendChild(createSummaryCard("Open", String(tabStatus.openTabs)));
  grid.appendChild(createSummaryCard("Grouped", String(tabStatus.groupedTabs)));
  grid.appendChild(createSummaryCard("Diagnostics", String(diagnostics.length)));

  diagnosticsSummary.appendChild(grid);
}

function createSummaryCard(label, value) {
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
    empty.className = "empty-state";
    empty.textContent = "No diagnostics recorded yet.";
    diagnosticsList.appendChild(empty);
    return;
  }

  diagnostics.slice(-20).reverse().forEach((diagnostic) => {
    const card = document.createElement("article");
    card.className = "diagnostic-card diagnostic-" + diagnostic.level;

    const heading = document.createElement("p");
    heading.textContent = diagnostic.createdAt + " | " + diagnostic.level + " | " + diagnostic.action;
    card.appendChild(heading);

    const message = document.createElement("p");
    message.textContent = diagnostic.message;
    card.appendChild(message);

    if (diagnostic.details && Object.keys(diagnostic.details).length) {
      const details = document.createElement("pre");
      details.textContent = JSON.stringify(diagnostic.details, null, 2);
      card.appendChild(details);
    }

    diagnosticsList.appendChild(card);
  });
}

async function buildDiagnosticPacket() {
  const workspace = await getWorkspace();
  const diagnostics = await getDiagnostics();
  const tabStatus = await calculateTabStatus(workspace);
  const timeline = Array.isArray(workspace?.timeline) ? workspace.timeline : [];

  const packet = {
    packetType: "Chrome Flow Diagnostic Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "diagnostic-packet-v0.3"
    },
    workspace: {
      workspaceId: workspace?.workspaceId || "",
      name: workspace?.name || "",
      workspaceType: workspace?.workspaceType || "",
      tabCount: Array.isArray(workspace?.tabs) ? workspace.tabs.length : 0,
      journalCount: Array.isArray(workspace?.journal) ? workspace.journal.length : 0,
      timelineCount: timeline.length
    },
    tabStatus: tabStatus,
    pendingActionTraces: Array.from(pendingActionTraces.values()).map((trace) => ({
      traceId: trace.traceId,
      actionName: trace.actionName,
      label: trace.label,
      startedAt: trace.startedAt,
      terminalTypes: trace.terminalTypes,
      intermediateTypes: trace.intermediateTypes,
      observedIntermediateEventIds: trace.observedIntermediateEventIds
    })),
    recentDiagnostics: diagnostics.slice(-MAX_PACKET_EVENTS),
    recentActionResultDiagnostics: diagnostics
      .filter((diagnostic) => diagnostic.action.startsWith("action_"))
      .slice(-MAX_PACKET_EVENTS),
    recentSystemEvents: timeline.slice(-MAX_PACKET_EVENTS),
    recentRecoverableEvents: timeline
      .filter((event) => event.recoveryActions)
      .slice(-MAX_PACKET_EVENTS),
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
  if (!workspace || !Array.isArray(workspace.tabs) || !workspace.tabs.length) {
    return {
      totalTabs: 0,
      openTabs: 0,
      missingTabs: 0,
      groupedTabs: 0,
      ungroupedTabs: 0,
      unassignedTabs: 0
    };
  }

  let browserTabs = [];

  try {
    browserTabs = await chrome.tabs.query({});
  } catch (error) {
    return {
      totalTabs: workspace.tabs.length,
      openTabs: 0,
      missingTabs: workspace.tabs.length,
      groupedTabs: 0,
      ungroupedTabs: 0,
      unassignedTabs: workspace.tabs.filter((tab) => (tab.role || "unassigned") === "unassigned").length
    };
  }

  const openTabs = workspace.tabs.filter((workspaceTab) =>
    browserTabs.some((browserTab) => browserTab.id === workspaceTab.tabId || browserTab.url === workspaceTab.url)
  );
  const groupedTabs = openTabs.filter((workspaceTab) =>
    browserTabs.some((browserTab) => browserTab.id === workspaceTab.tabId && Number.isInteger(browserTab.groupId) && browserTab.groupId >= 0)
  );

  return {
    totalTabs: workspace.tabs.length,
    openTabs: openTabs.length,
    missingTabs: Math.max(workspace.tabs.length - openTabs.length, 0),
    groupedTabs: groupedTabs.length,
    ungroupedTabs: Math.max(openTabs.length - groupedTabs.length, 0),
    unassignedTabs: workspace.tabs.filter((tab) => (tab.role || "unassigned") === "unassigned").length
  };
}

function sanitizeDetails(details) {
  try {
    return JSON.parse(JSON.stringify(details || {}));
  } catch (error) {
    return {
      unserializable: true,
      summary: String(details)
    };
  }
}

function summarizeError(error) {
  if (!error) {
    return { message: "Unknown error" };
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
