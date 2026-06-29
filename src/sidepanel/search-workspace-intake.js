import {
  getWorkspace,
  saveWorkspace,
  addTimelineEvent
} from "../core/workspace-store.js";

const DIAGNOSTICS_KEY = "chromeFlowDiagnostics";
const MAX_DIAGNOSTICS = 200;
const SEARCH_AUTO_ADD_DELAY_MS = 700;

const openSearchTabButton = document.getElementById("openSearchTabButton");
const searchQueryInput = document.getElementById("searchQuery");
const intakeStatus = document.getElementById("intakeStatus");

openSearchTabButton?.addEventListener("click", () => {
  const query = searchQueryInput?.value?.trim() || "";

  if (!query) {
    return;
  }

  window.setTimeout(() => {
    void autoAddLaunchedSearchTab(query);
  }, SEARCH_AUTO_ADD_DELAY_MS);
});

async function autoAddLaunchedSearchTab(query) {
  try {
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = activeTabs[0];

    if (!activeTab || !isLikelySearchTab(activeTab, query)) {
      await recordDiagnostic("warn", "search_tab_auto_add_skipped", "Could not safely identify the newly launched search tab for workspace auto-add.", {
        query,
        activeTab: summarizeBrowserTab(activeTab)
      });
      setStatus("Search opened. Could not safely auto-add the launched search tab to workspace.");
      return;
    }

    const workspace = await getWorkspace();
    const exactMatch = workspace.tabs.find((tab) => tab.tabId === activeTab.id);

    if (exactMatch) {
      await addTimelineEvent("browser_search_tab_auto_add_skipped", "Search tab was already in the workspace: " + getTabName(exactMatch) + ".", {
        query,
        tabId: activeTab.id,
        url: activeTab.url,
        workspaceTabId: exactMatch.workspaceTabId
      });
      setStatus("Search opened. Search tab is already in the workspace.");
      return;
    }

    const sameUrlDuplicate = workspace.tabs.some((tab) => tab.url && activeTab.url && tab.url === activeTab.url);
    const workspaceTab = createWorkspaceTabFromBrowserTab(activeTab, query);
    workspace.tabs.push(workspaceTab);
    workspace.updatedAt = new Date().toISOString();
    await saveWorkspace(workspace);

    await addTimelineEvent("browser_search_tab_added_to_workspace", "Opened search tab and added it to the workspace: " + getTabName(workspaceTab) + ".", {
      query,
      tabId: workspaceTab.tabId,
      url: workspaceTab.url,
      workspaceTabId: workspaceTab.workspaceTabId,
      sameUrlDuplicate,
      searchLaunchAutoIntake: true
    });

    await recordDiagnostic("info", "search_tab_auto_added_to_workspace", "Search tab auto-added to workspace after Open Search Tab.", {
      query,
      tabId: workspaceTab.tabId,
      url: workspaceTab.url,
      workspaceTabId: workspaceTab.workspaceTabId,
      sameUrlDuplicate
    });

    setStatus("Search opened and added to workspace: " + getTabName(workspaceTab) + ".");
    refreshWorkspaceView();
  } catch (error) {
    await recordDiagnostic("error", "search_tab_auto_add_failed", "Search tab workspace auto-add failed.", {
      query,
      error: summarizeError(error)
    });
    setStatus("Search opened, but Chrome Flow could not auto-add it to the workspace.");
  }
}

function refreshWorkspaceView() {
  const refreshButton = document.getElementById("refreshWorkspaceTabsButton");

  if (refreshButton) {
    refreshButton.click();
  }
}

function isLikelySearchTab(tab, query) {
  if (!tab?.url) {
    return false;
  }

  try {
    const parsedUrl = new URL(tab.url);
    const queryParam = parsedUrl.searchParams.get("q") || "";
    const normalizedExpected = normalizeQuery(query);
    const normalizedActual = normalizeQuery(queryParam);

    return parsedUrl.hostname.includes("google.") && parsedUrl.pathname.includes("/search") && normalizedActual === normalizedExpected;
  } catch (error) {
    return false;
  }
}

function createWorkspaceTabFromBrowserTab(tab, query) {
  const now = new Date().toISOString();
  const title = tab.title || "Search: " + query;
  const url = tab.url || "";

  return {
    workspaceTabId: crypto.randomUUID(),
    tabId: tab.id,
    tabKey: url + "::" + title,
    windowId: tab.windowId,
    groupId: tab.groupId,
    url,
    displayUrl: createDisplayUrl(url),
    originalTitle: title,
    alias: "",
    role: "unassigned",
    isOpen: true,
    firstSeenAt: now,
    lastSeenAt: now,
    searchLaunchAutoIntake: true,
    searchQuery: query
  };
}

function getTabName(tab) {
  return tab.alias || tab.originalTitle || tab.displayUrl || "Untitled tab";
}

function createDisplayUrl(rawUrl) {
  if (!rawUrl) {
    return "";
  }

  try {
    const parsedUrl = new URL(rawUrl);
    const host = parsedUrl.hostname.replace(/^www\./, "");
    const path = parsedUrl.pathname === "/" ? "" : parsedUrl.pathname;
    const cleanUrl = host + path;

    if (cleanUrl.length <= 72) {
      return cleanUrl;
    }

    return cleanUrl.slice(0, 69) + "...";
  } catch (error) {
    return rawUrl.length <= 72 ? rawUrl : rawUrl.slice(0, 69) + "...";
  }
}

function normalizeQuery(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function setStatus(message) {
  if (intakeStatus) {
    intakeStatus.textContent = message;
  }
}

function summarizeBrowserTab(tab) {
  if (!tab) {
    return null;
  }

  return {
    id: tab.id,
    title: tab.title || "",
    url: tab.url || "",
    windowId: tab.windowId,
    active: Boolean(tab.active)
  };
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

async function recordDiagnostic(level, action, message, details = {}) {
  try {
    const result = await chrome.storage.local.get(DIAGNOSTICS_KEY);
    const diagnostics = Array.isArray(result[DIAGNOSTICS_KEY]) ? result[DIAGNOSTICS_KEY] : [];

    diagnostics.push({
      diagnosticId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      level,
      action,
      message,
      details
    });

    await chrome.storage.local.set({ [DIAGNOSTICS_KEY]: diagnostics.slice(-MAX_DIAGNOSTICS) });
  } catch (error) {
    console.warn("Chrome Flow search auto-intake diagnostics failed:", error);
  }
}
