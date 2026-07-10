import { appendRuntimeDiagnostic } from "../core/workspace-runtime-store.js";

const WORKSPACE_STORAGE_KEY = "chromeFlowWorkspace";
const LEGACY_CLOSE_BUTTON_CLASS = "close-browser-tab-button";
const INTERNAL_REFRESH_BUTTON_IDS = new Set([
  "refreshWorkspaceTabsButton",
  "refreshTabStatusButton"
]);
const FOCUS_BUTTON_TEXT = "Focus Tab";
const FOCUS_BUTTON_REPLACEMENT_TEXT = "Focus Workspace Tab";
const OBSERVED_FOCUS_EVENT_TYPES = new Set([
  "workspace_tab_focused",
  "workspace_tab_focus_failed"
]);

const knownTimelineEventIds = new Set();
let initialized = false;
let projectionRenderTimer = null;

installWorkspaceTabActionContractCleanup();

async function installWorkspaceTabActionContractCleanup() {
  cleanProductControls(document);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) cleanProductControls(node);
      }
    }
  });

  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  await seedKnownTimelineEvents();
  installWorkspaceFocusDiagnosticBridge();
  installAutomaticProjectionSurfaceSync();
  initialized = true;

  try {
    await chrome.runtime.sendMessage({
      type: "chrome-flow-reconcile-workspace-projection",
      trigger: "sidepanel_startup"
    });
  } catch {
    // The side panel can still render the persisted runtime state if the worker is restarting.
  }
}

function cleanProductControls(root) {
  if (!(root instanceof Document || root instanceof Element)) return;

  root.querySelectorAll?.("." + LEGACY_CLOSE_BUTTON_CLASS).forEach((button) => {
    button.remove();
  });

  root.querySelectorAll?.("button").forEach((button) => {
    if (INTERNAL_REFRESH_BUTTON_IDS.has(button.id)) {
      button.hidden = true;
      button.setAttribute("aria-hidden", "true");
      button.tabIndex = -1;
      button.dataset.internalMaintenanceControl = "true";
      return;
    }

    if ((button.textContent || "").trim() !== FOCUS_BUTTON_TEXT) return;
    button.textContent = FOCUS_BUTTON_REPLACEMENT_TEXT;
    button.title = "Focus the live browser tab represented by this workspace record.";
  });
}

async function seedKnownTimelineEvents() {
  const workspace = await readWorkspace();
  const timeline = Array.isArray(workspace?.timeline) ? workspace.timeline : [];

  timeline.forEach((event) => {
    if (event?.eventId) knownTimelineEventIds.add(event.eventId);
  });
}

function installWorkspaceFocusDiagnosticBridge() {
  if (!globalThis.chrome?.storage?.onChanged?.addListener) return;

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (!initialized || areaName !== "local") return;

    const workspace = changes?.[WORKSPACE_STORAGE_KEY]?.newValue;
    const timeline = Array.isArray(workspace?.timeline) ? workspace.timeline : [];

    for (const event of timeline) {
      if (!event?.eventId || knownTimelineEventIds.has(event.eventId)) continue;
      knownTimelineEventIds.add(event.eventId);

      if (!OBSERVED_FOCUS_EVENT_TYPES.has(event.type)) continue;
      void recordFocusEventDiagnostic(event);
    }
  });
}

function installAutomaticProjectionSurfaceSync() {
  if (!globalThis.chrome?.storage?.onChanged?.addListener) return;

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    const workspace = changes?.[WORKSPACE_STORAGE_KEY]?.newValue;
    if (!workspace?.workspaceId) return;
    scheduleProjectionSurfaceRender(workspace);
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "chrome-flow-workspace-projection-reconciled") return false;
    void readWorkspace().then((workspace) => {
      if (workspace?.workspaceId) scheduleProjectionSurfaceRender(workspace);
    });
    return false;
  });
}

function scheduleProjectionSurfaceRender(workspace) {
  if (projectionRenderTimer) window.clearTimeout(projectionRenderTimer);
  projectionRenderTimer = window.setTimeout(() => {
    projectionRenderTimer = null;
    renderProjectionSurface(workspace);
  }, 60);
}

function renderProjectionSurface(workspace) {
  const tabs = Array.isArray(workspace.tabs) ? workspace.tabs : [];
  const status = calculateProjectionStatus(tabs);

  setText("statusTotalTabs", status.totalTabs);
  setText("statusOpenTabs", status.openTabs);
  setText("statusMissingTabs", status.missingTabs);
  setText("statusGroupedTabs", status.groupedTabs);
  setText("statusUngroupedTabs", status.ungroupedTabs);
  setText("statusUnassignedTabs", status.unassignedTabs);

  for (const tab of tabs) updateWorkspaceTabCard(tab);
  renderSystemTimeline(workspace);

  const intakeStatus = document.getElementById("intakeStatus");
  if (intakeStatus && workspace.projectionReconciliation?.reconciledAt) {
    intakeStatus.textContent = "Workspace browser state is current.";
  }
}

function calculateProjectionStatus(tabs) {
  const totalTabs = tabs.length;
  const openTabs = tabs.filter((tab) => tab.isOpen !== false).length;
  const groupedTabs = tabs.filter((tab) => tab.isOpen !== false && isValidGroupId(tab.groupId)).length;
  const ungroupedTabs = openTabs - groupedTabs;
  const unassignedTabs = tabs.filter((tab) => !tab.role || tab.role === "unassigned").length;

  return {
    totalTabs,
    openTabs,
    missingTabs: totalTabs - openTabs,
    groupedTabs,
    ungroupedTabs,
    unassignedTabs
  };
}

function updateWorkspaceTabCard(tab) {
  const workspaceTabId = tab.workspaceTabId || "";
  if (!workspaceTabId) return;

  const card = Array.from(document.querySelectorAll(".workspace-tab-card"))
    .find((item) => item.dataset.workspaceTabId === workspaceTabId);
  if (!card) return;

  const title = card.querySelector("h4");
  if (title) title.textContent = getTabName(tab);

  const url = card.querySelector(".tab-url");
  if (url) url.textContent = tab.displayUrl || createDisplayUrl(tab.url || "");

  const badges = card.querySelector(".tab-state-badges");
  if (!badges) return;
  badges.replaceChildren();

  badges.appendChild(createBadge("Record " + workspaceTabId.slice(0, 8), "record-status-badge"));

  const ambiguous = String(tab.lastMatchStatus || "").startsWith("ambiguous");
  if (tab.isOpen !== false) badges.appendChild(createBadge("Open", "browser-status-badge open"));
  else if (ambiguous) badges.appendChild(createBadge("Ambiguous", "browser-status-badge ambiguous"));
  else badges.appendChild(createBadge("Missing", "browser-status-badge closed"));

  badges.appendChild(
    isValidGroupId(tab.groupId)
      ? createBadge("Grouped", "group-status-badge grouped")
      : createBadge("Ungrouped", "group-status-badge ungrouped")
  );

  if (!tab.role || tab.role === "unassigned") {
    badges.appendChild(createBadge("Unassigned", "role-status-badge unassigned"));
  }

  if (tab.lastMatchStatus) {
    badges.appendChild(createBadge(tab.lastMatchStatus, "match-status-badge"));
  }
}

function renderSystemTimeline(workspace) {
  const list = document.getElementById("systemTimelineList");
  if (!list) return;
  const timeline = Array.isArray(workspace.timeline) ? workspace.timeline : [];

  list.replaceChildren();
  if (!timeline.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No system events yet.";
    list.appendChild(empty);
    return;
  }

  [...timeline].reverse().slice(0, 80).forEach((event) => {
    const article = document.createElement("article");
    article.className = "timeline-event-card";

    const title = document.createElement("h4");
    title.textContent = event.type || "system_event";
    article.appendChild(title);

    const message = document.createElement("p");
    message.textContent = event.message || "";
    article.appendChild(message);

    const meta = document.createElement("p");
    meta.className = "tab-meta";
    meta.textContent = event.createdAt || "";
    article.appendChild(meta);

    list.appendChild(article);
  });
}

async function recordFocusEventDiagnostic(event) {
  const succeeded = event.type === "workspace_tab_focused";

  await appendRuntimeDiagnostic(
    succeeded ? "info" : "warn",
    succeeded ? "workspace_tab_focus_verified" : "workspace_tab_focus_failed",
    succeeded
      ? "Workspace tab focus completed and was verified by the System Journal event."
      : "Workspace tab focus did not complete safely.",
    {
      eventId: event.eventId || "",
      eventType: event.type || "",
      workspaceTabId: event.workspaceTabId || "",
      tabId: Number.isInteger(event.tabId) ? event.tabId : null,
      windowId: Number.isInteger(event.windowId) ? event.windowId : null,
      matchStatus: event.matchStatus || "",
      message: event.message || ""
    }
  );
}

function createBadge(text, className) {
  const badge = document.createElement("span");
  badge.className = className;
  badge.textContent = text;
  return badge;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = String(value);
}

function isValidGroupId(groupId) {
  return Number.isInteger(groupId) && groupId >= 0;
}

function getTabName(tab) {
  return tab.alias || tab.originalTitle || tab.title || tab.displayUrl || tab.url || "workspace tab";
}

function createDisplayUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname + parsed.pathname.replace(/\/$/, "");
  } catch {
    return String(url || "");
  }
}

async function readWorkspace() {
  const result = await chrome.storage.local.get(WORKSPACE_STORAGE_KEY);
  return result?.[WORKSPACE_STORAGE_KEY] || null;
}
