import {
  addTimelineEvent,
  getWorkspace,
  saveWorkspace
} from "../core/workspace-store.js";

const BUTTON_CLASS = "remove-workspace-only-button";
const TABS_LIST_ID = "tabsList";

installWorkspaceTabRemoveOnlyControl();

function installWorkspaceTabRemoveOnlyControl() {
  const tabsList = document.getElementById(TABS_LIST_ID);
  if (!tabsList) return;

  enhanceWorkspaceTabCards(tabsList);

  const observer = new MutationObserver(() => {
    enhanceWorkspaceTabCards(tabsList);
  });

  observer.observe(tabsList, {
    childList: true,
    subtree: true
  });

  tabsList.addEventListener("click", handleRemoveOnlyClick);
}

function enhanceWorkspaceTabCards(tabsList) {
  tabsList.querySelectorAll(".workspace-tab-card").forEach((card) => {
    if (card.querySelector("." + BUTTON_CLASS)) return;

    const workspaceTabId = card.dataset.workspaceTabId || "";
    const actions = card.querySelector(".tab-actions");
    if (!workspaceTabId || !actions) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-button " + BUTTON_CLASS;
    button.dataset.workspaceTabId = workspaceTabId;
    button.textContent = "Remove from Workspace";
    button.title = "Remove this record from the workspace while keeping the live browser tab open.";

    const closeButton = actions.querySelector(".close-browser-tab-button");
    actions.insertBefore(button, closeButton || null);
  });
}

async function handleRemoveOnlyClick(event) {
  const button = event.target?.closest?.("." + BUTTON_CLASS);
  if (!button) return;

  event.preventDefault();
  event.stopPropagation();

  const workspaceTabId = button.dataset.workspaceTabId || "";
  if (!workspaceTabId || button.disabled) return;

  button.disabled = true;

  try {
    const workspace = await getWorkspace();
    const tabIndex = workspace.tabs.findIndex((tab) => tab.workspaceTabId === workspaceTabId);

    if (tabIndex < 0) {
      setStatus("Workspace tab record was not found.");
      return;
    }

    const tab = workspace.tabs[tabIndex];
    const confirmed = window.confirm(
      "Remove this tab from the workspace but keep the browser tab open?"
    );

    if (!confirmed) return;

    const reason = window.prompt(
      "Reason for removing this tab from the workspace? The browser tab will remain open.",
      ""
    );

    if (reason === null) return;

    const tabSnapshot = createTabSnapshot(tab, workspace);
    workspace.tabs.splice(tabIndex, 1);
    workspace.updatedAt = new Date().toISOString();

    await saveWorkspace(workspace);
    await addTimelineEvent(
      "workspace_tab_removed",
      "Removed " + getTabName(tab) + " from the workspace and kept the browser tab open.",
      {
        workspaceTabId,
        reason: reason.trim() || "No reason recorded.",
        tabSnapshot,
        browserTabClosed: false,
        browserTabKeptOpen: true,
        removeMode: "remove_workspace_only_keep_browser_tab",
        recoveryActions: {
          canReopenUrl: false,
          canReaddToWorkspace: true
        }
      }
    );

    setStatus("Removed from workspace. Browser tab remains open.");

    window.setTimeout(() => {
      document.getElementById("refreshWorkspaceTabsButton")?.click();
    }, 100);
  } catch (error) {
    console.error("Chrome Flow remove-only workspace tab action failed.", error);
    setStatus("Could not remove the tab from the workspace. Check Developer Diagnostics.");
  } finally {
    button.disabled = false;
  }
}

function createTabSnapshot(tab, workspace) {
  return {
    workspaceId: workspace.workspaceId || "",
    workspaceName: workspace.name || "Untitled Workspace",
    workspaceTabId: tab.workspaceTabId || "",
    tabId: Number.isInteger(tab.tabId) ? tab.tabId : null,
    tabKey: tab.tabKey || "",
    windowId: Number.isInteger(tab.windowId) ? tab.windowId : null,
    groupId: Number.isInteger(tab.groupId) ? tab.groupId : -1,
    url: tab.url || "",
    displayUrl: tab.displayUrl || tab.url || "",
    originalTitle: tab.originalTitle || tab.title || "Untitled tab",
    alias: tab.alias || "",
    role: tab.role || "unassigned",
    isOpen: tab.isOpen !== false,
    firstSeenAt: tab.firstSeenAt || "",
    lastSeenAt: tab.lastSeenAt || "",
    capturedAt: new Date().toISOString()
  };
}

function getTabName(tab) {
  return tab.alias || tab.originalTitle || tab.title || tab.displayUrl || tab.url || "workspace tab";
}

function setStatus(message) {
  const status = document.getElementById("intakeStatus");
  if (status) status.textContent = message;
}
