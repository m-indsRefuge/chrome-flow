const WORKSPACE_KEY = "chromeFlowWorkspace";
const DIAGNOSTICS_KEY = "chromeFlowDiagnostics";
const MAX_DIAGNOSTICS = 200;
const MAX_PACKET_EVENTS = 30;

const diagnosticsStatus = document.getElementById("diagnosticsStatus");
const diagnosticsSummary = document.getElementById("diagnosticsSummary");
const diagnosticsList = document.getElementById("diagnosticsList");
const refreshDiagnosticsButton = document.getElementById("refreshDiagnosticsButton");
const copyDiagnosticPacketButton = document.getElementById("copyDiagnosticPacketButton");
const clearDiagnosticsButton = document.getElementById("clearDiagnosticsButton");

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

  void recordDiagnostic("info", "ui_click", "Button clicked: " + (buttonId || buttonText) + ".", {
    buttonId: buttonId,
    buttonText: buttonText
  });
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
  const recoverableEvents = recentTimeline.filter((event) => event.recoveryActions);

  const packet = {
    packetType: "Chrome Flow Diagnostic Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "diagnostic-packet-v0.1"
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
    recentDiagnostics: recentDiagnostics,
    recentSystemEvents: recentTimeline,
    recentRecoverableEvents: recoverableEvents,
    notes: [
      "This packet is generated locally by Chrome Flow.",
      "It does not intentionally include page content.",
      "Review before sharing if workspace names, tab titles, or URLs are sensitive."
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
