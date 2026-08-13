import {
  ASSIGNED_WORKSPACE_REFRESH_EVENT,
  createAssignedWorkspaceRuntimeMutationGateway
} from "../core/workspace-runtime-store.js";
import {
  getSidePanelAssignedWorkspaceAuthority
} from "../core/runtime-window-binding/side-panel-authority.js";
import {
  createRuntimeWorkspaceMutationClient
} from "../core/runtime-workspace-mutation/client.js";

const DIAGNOSTICS_KEY = "chromeFlowDiagnostics";
const MAX_DIAGNOSTICS = 200;
const SEARCH_AUTO_ADD_DELAY_MS = 700;

const openSearchTabButton = document.getElementById("openSearchTabButton");
const searchQueryInput = document.getElementById("searchQuery");
const intakeStatus = document.getElementById("intakeStatus");
const assignedSearchMutationGateway = createAssignedWorkspaceRuntimeMutationGateway({
  resolveAuthority: () => getSidePanelAssignedWorkspaceAuthority().resolve(),
  mutationClient: createRuntimeWorkspaceMutationClient({
    createId: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
    send: (command) => chrome.runtime.sendMessage(command)
  })
});
const searchWorkspaceIntakeController = createSearchWorkspaceIntakeController({
  getActiveSearchTab: getActiveSearchTabFromCurrentWindow,
  assignedMutationGateway: assignedSearchMutationGateway,
  recordDiagnostic,
  setStatus,
  refreshAssignedWorkspace: requestAssignedWorkspaceRefresh
});

openSearchTabButton?.addEventListener("click", () => {
  const query = searchQueryInput?.value?.trim() || "";

  if (!query) {
    return;
  }

  window.setTimeout(() => {
    void searchWorkspaceIntakeController.autoAddLaunchedSearchTab(query);
  }, SEARCH_AUTO_ADD_DELAY_MS);
});

function createSearchWorkspaceIntakeController({
  getActiveSearchTab,
  assignedMutationGateway,
  recordDiagnostic: record,
  setStatus: reportStatus,
  refreshAssignedWorkspace
} = {}) {
  async function autoAddLaunchedSearchTab(query) {
    let activeTab;
    try {
      activeTab = await getActiveSearchTab();
    } catch (error) {
      await recordSearchDiagnostic(record, "error", "search_tab_auto_add_failed", "Search tab workspace auto-add failed.", {
        query,
        error: summarizeError(error)
      });
      reportStatus?.("Search opened, but Chrome Flow could not auto-add it to the workspace.");
      return { ok: false, reason: "search_tab_lookup_failed" };
    }

    if (!activeTab || !isLikelySearchTab(activeTab, query)) {
      await recordSearchDiagnostic(record, "warn", "search_tab_auto_add_skipped", "Could not safely identify the newly launched search tab for workspace auto-add.", {
        query,
        activeTab: summarizeBrowserTab(activeTab)
      });
      reportStatus?.("Search opened. Could not safely auto-add the launched search tab to workspace.");
      return { ok: false, reason: "search_tab_not_identified" };
    }

    let assignedRead;
    try {
      assignedRead = await assignedMutationGateway.resolveAssignedWorkspace();
    } catch (error) {
      await recordSearchDiagnostic(record, "error", "search_tab_auto_add_authority_failed", "Search tab was left open because assigned workspace authority could not be resolved for auto-add.", {
        query,
        tabId: activeTab.id,
        url: activeTab.url,
        error: summarizeError(error)
      });
      reportStatus?.("Search opened, but this panel could not verify assigned workspace authority for auto-add.");
      return { ok: false, reason: "assigned_authority_resolve_failed" };
    }
    if (!assignedRead?.ok) {
      await recordSearchDiagnostic(record, "warn", "search_tab_auto_add_authority_unavailable", "Search tab was left open because assigned workspace authority was unavailable for auto-add.", {
        query,
        tabId: activeTab.id,
        url: activeTab.url,
        reason: assignedRead?.reason || "assigned_authority_unavailable"
      });
      reportStatus?.("Search opened, but this panel could not verify assigned workspace authority for auto-add.");
      return {
        ok: false,
        reason: assignedRead?.reason || "assigned_authority_unavailable"
      };
    }

    const workspace = assignedRead.workspace;
    const exactMatch = workspace.tabs.find((tab) => tab.tabId === activeTab.id);

    if (exactMatch) {
      let skipped;
      try {
        skipped = await assignedMutationGateway.appendTimeline(
          "browser_search_tab_auto_add_skipped",
          "Search tab was already in the workspace: " + getTabName(exactMatch) + ".",
          {
            query,
            tabId: activeTab.id,
            url: activeTab.url,
            workspaceTabId: exactMatch.workspaceTabId
          }
        );
      } catch (error) {
        skipped = { ok: false, status: "failed", reason: "assigned_timeline_client_failed", errors: [summarizeError(error)] };
      }
      if (skipped?.ok) await refreshAssignedWorkspaceSafely(refreshAssignedWorkspace);
      reportStatus?.("Search opened. Search tab is already in the workspace.");
      return {
        ok: skipped?.ok === true,
        status: skipped?.status || "no_change",
        reason: skipped?.reason || ""
      };
    }

    const sameUrlDuplicate = workspace.tabs.some((tab) => tab.url && activeTab.url && tab.url === activeTab.url);
    const workspaceTab = createWorkspaceTabFromBrowserTab(activeTab, query);
    let submission;
    try {
      submission = await assignedMutationGateway.submit({
        mutationKind: "search.intake.add",
        payload: {
          tab: workspaceTab,
          query,
          eventId: crypto.randomUUID(),
          sameUrlDuplicate
        }
      });
    } catch (error) {
      submission = { ok: false, status: "failed", reason: "assigned_mutation_client_failed", errors: [summarizeError(error)] };
    }

    if (!submission?.ok) {
      await recordSearchDiagnostic(record, "error", "search_tab_auto_add_failed", "Search tab workspace auto-add failed.", {
        query,
        tabId: workspaceTab.tabId,
        url: workspaceTab.url,
        workspaceTabId: workspaceTab.workspaceTabId,
        reason: submission?.reason || "assigned_mutation_not_verified"
      });
      reportStatus?.("Search opened, but Chrome Flow could not auto-add it to the workspace.");
      return submission || { ok: false, reason: "assigned_mutation_not_verified" };
    }

    await recordSearchDiagnostic(record, "info", "search_tab_auto_added_to_workspace", "Search tab auto-added to workspace after Open Search Tab.", {
      query,
      tabId: workspaceTab.tabId,
      url: workspaceTab.url,
      workspaceTabId: workspaceTab.workspaceTabId,
      sameUrlDuplicate
    });
    reportStatus?.("Search opened and added to workspace: " + getTabName(workspaceTab) + ".");
    await refreshAssignedWorkspaceSafely(refreshAssignedWorkspace);
    return submission;
  }

  return {
    autoAddLaunchedSearchTab
  };
}

async function getActiveSearchTabFromCurrentWindow() {
  const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return activeTabs[0] || null;
}

async function refreshAssignedWorkspaceSafely(refreshAssignedWorkspace) {
  try {
    await refreshAssignedWorkspace?.();
  } catch {
    // Refresh is observational after a verified business result.
  }
}

async function recordSearchDiagnostic(record, level, action, message, details) {
  try {
    await record?.(level, action, message, details);
  } catch {
    // Diagnostics are non-authoritative.
  }
}

function requestAssignedWorkspaceRefresh() {
  try {
    globalThis.dispatchEvent?.(new CustomEvent(ASSIGNED_WORKSPACE_REFRESH_EVENT));
  } catch {
    // Rendering refresh is best effort and cannot change mutation correctness.
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

export {
  createSearchWorkspaceIntakeController
};
