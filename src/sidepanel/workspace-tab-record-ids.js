import {
  DEFAULT_WORKSPACE_TYPE,
  getWorkspaceRoleLabel,
  getWorkspaceRoles
} from "../core/workspace-role-sets.js";

const WORKSPACE_KEY = "chromeFlowWorkspace";
const DIAGNOSTICS_KEY = "chromeFlowDiagnostics";
const MAX_DIAGNOSTICS = 200;

const tabsList = document.getElementById("tabsList");
const intakeStatus = document.getElementById("intakeStatus");

await migrateWorkspaceTabRecordIds();
installTabRecordObserver();
installStableRecordActionHandlers();
void annotateRenderedWorkspaceControls();

async function migrateWorkspaceTabRecordIds() {
  const workspace = await getWorkspace();
  let changed = false;

  workspace.tabs = workspace.tabs.map((tab) => {
    if (tab.workspaceTabId) {
      return tab;
    }

    changed = true;
    return {
      ...tab,
      workspaceTabId: crypto.randomUUID()
    };
  });

  if (changed) {
    workspace.updatedAt = new Date().toISOString();
    await saveWorkspace(workspace);
    await recordDiagnostic("info", "workspace_tab_ids_migrated", "Workspace tab records migrated to stable workspaceTabId values.", {
      migratedTabCount: workspace.tabs.length
    });
  }
}

function installTabRecordObserver() {
  if (!tabsList) {
    return;
  }

  const observer = new MutationObserver(() => {
    void annotateRenderedWorkspaceControls();
  });

  observer.observe(tabsList, {
    childList: true,
    subtree: true
  });
}

function installStableRecordActionHandlers() {
  document.addEventListener("change", async (event) => {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.classList.contains("alias-input")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      await updateAliasByWorkspaceTabId(target.dataset.workspaceTabId, target.value || "");
      return;
    }

    if (target.classList.contains("role-select")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      await updateRoleByWorkspaceTabId(target.dataset.workspaceTabId, target.value || "unassigned");
    }
  }, true);

  document.addEventListener("click", async (event) => {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    const button = target.closest("button");

    if (!button) {
      return;
    }

    if (button.classList.contains("focus-tab-button")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      await focusTabByWorkspaceTabId(button.dataset.workspaceTabId);
      return;
    }

    if (button.classList.contains("close-browser-tab-button")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      await closeTabByWorkspaceTabId(button.dataset.workspaceTabId);
      return;
    }

    if (button.classList.contains("remove-tab-button")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      await removeTabByWorkspaceTabId(button.dataset.workspaceTabId);
      return;
    }

    if (button.classList.contains("focus-chrome-group-button")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      await focusGroupByRoleId(button.dataset.roleId || "unassigned", button.dataset.roleLabel || "");
    }
  }, true);
}

async function annotateRenderedWorkspaceControls() {
  if (!tabsList) {
    return;
  }

  const workspace = await getWorkspace();
  const groupedTabs = createTabRoleGroups(workspace);
  const groupSections = Array.from(tabsList.querySelectorAll(".tab-role-group"));

  groupSections.forEach((groupSection, groupIndex) => {
    const group = groupedTabs[groupIndex];

    if (!group) {
      return;
    }

    const cards = Array.from(groupSection.querySelectorAll(":scope > .tab-card"));

    cards.forEach((card, tabIndex) => {
      const tab = group.tabs[tabIndex];

      if (!tab || !tab.workspaceTabId) {
        return;
      }

      card.dataset.workspaceTabId = tab.workspaceTabId;
      card.querySelectorAll(".alias-input, .role-select, .focus-tab-button, .close-browser-tab-button, .remove-tab-button")
        .forEach((control) => {
          control.dataset.workspaceTabId = tab.workspaceTabId;
        });

      let idBadge = card.querySelector(".workspace-tab-id-badge");

      if (!idBadge) {
        idBadge = document.createElement("span");
        idBadge.className = "badge workspace-tab-id-badge";
        card.appendChild(idBadge);
      }

      idBadge.textContent = "Record " + tab.workspaceTabId.slice(0, 8);
      idBadge.title = "Chrome Flow workspaceTabId: " + tab.workspaceTabId;
    });
  });
}

async function updateAliasByWorkspaceTabId(workspaceTabId, aliasValue) {
  const workspace = await getWorkspace();
  const tab = findWorkspaceTabById(workspace, workspaceTabId);

  if (!tab) {
    setIntakeStatus("Could not find that workspace tab record.");
    await recordDiagnostic("warn", "workspace_tab_record_not_found", "Alias update could not find workspaceTabId.", { workspaceTabId });
    return;
  }

  tab.alias = aliasValue.trim();
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  await addTimelineEvent("tab_alias_updated", "Updated alias for: " + getTabName(tab) + ".", {
    workspaceTabId: tab.workspaceTabId
  });
  await recordDiagnostic("info", "workspace_tab_alias_updated", "Alias updated by stable workspaceTabId.", {
    workspaceTabId: tab.workspaceTabId,
    tabId: tab.tabId,
    url: tab.url
  });
  reloadSoon();
}

async function updateRoleByWorkspaceTabId(workspaceTabId, roleValue) {
  const workspace = await getWorkspace();
  const tab = findWorkspaceTabById(workspace, workspaceTabId);

  if (!tab) {
    setIntakeStatus("Could not find that workspace tab record.");
    await recordDiagnostic("warn", "workspace_tab_record_not_found", "Role update could not find workspaceTabId.", { workspaceTabId });
    return;
  }

  tab.role = roleValue;
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);

  const roleLabel = getWorkspaceRoleLabel(workspace.workspaceType || DEFAULT_WORKSPACE_TYPE, tab.role);
  await addTimelineEvent("tab_role_updated", "Assigned " + getTabName(tab) + " to " + roleLabel + " subgroup.", {
    workspaceTabId: tab.workspaceTabId,
    tabId: tab.tabId,
    url: tab.url
  });
  await recordDiagnostic("info", "workspace_tab_role_updated", "Role updated by stable workspaceTabId.", {
    workspaceTabId: tab.workspaceTabId,
    tabId: tab.tabId,
    role: tab.role,
    roleLabel: roleLabel,
    url: tab.url
  });
  setIntakeStatus("Assigned " + getTabName(tab) + " to " + roleLabel + ".");
  reloadSoon();
}

async function focusTabByWorkspaceTabId(workspaceTabId) {
  const workspace = await getWorkspace();
  const tab = findWorkspaceTabById(workspace, workspaceTabId);

  if (!tab) {
    setIntakeStatus("Could not find that workspace tab record.");
    await recordDiagnostic("warn", "workspace_tab_record_not_found", "Focus action could not find workspaceTabId.", { workspaceTabId });
    return;
  }

  const liveTabResult = await findLiveBrowserTabForWorkspaceTab(tab);

  if (!liveTabResult.liveTab) {
    tab.isOpen = false;
    workspace.updatedAt = new Date().toISOString();
    await saveWorkspace(workspace);
    await addTimelineEvent("browser_tab_focus_failed", "Could not focus " + getTabName(tab) + " because it was not found in the browser.", {
      workspaceTabId: tab.workspaceTabId,
      matchStatus: liveTabResult.status
    });
    setIntakeStatus("Could not find " + getTabName(tab) + " in the browser. Match status: " + liveTabResult.status + ".");
    await recordDiagnostic("warn", "workspace_tab_focus_not_found", "Focus action could not find a safe live browser tab.", {
      workspaceTabId: tab.workspaceTabId,
      tabId: tab.tabId,
      url: tab.url,
      matchStatus: liveTabResult.status,
      candidateCount: liveTabResult.candidateCount
    });
    reloadSoon();
    return;
  }

  await chrome.windows.update(liveTabResult.liveTab.windowId, { focused: true });
  await chrome.tabs.update(liveTabResult.liveTab.id, { active: true });
  updateWorkspaceTabFromBrowserTabInPlace(tab, liveTabResult.liveTab, {
    isOpen: true,
    lastSeenAt: new Date().toISOString()
  });
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  await addTimelineEvent("browser_tab_focused", "Focused browser tab: " + getTabName(tab) + ".", {
    workspaceTabId: tab.workspaceTabId,
    tabId: tab.tabId,
    matchStatus: liveTabResult.status
  });
  setIntakeStatus("Focused browser tab: " + getTabName(tab) + ".");
  await recordDiagnostic("info", "workspace_tab_focused_by_record_id", "Focused tab by stable workspaceTabId.", {
    workspaceTabId: tab.workspaceTabId,
    tabId: tab.tabId,
    url: tab.url,
    matchStatus: liveTabResult.status
  });
  reloadSoon();
}

async function closeTabByWorkspaceTabId(workspaceTabId) {
  const workspace = await getWorkspace();
  const tabIndex = workspace.tabs.findIndex((tab) => tab.workspaceTabId === workspaceTabId);

  if (tabIndex < 0) {
    setIntakeStatus("Could not find that workspace tab record.");
    await recordDiagnostic("warn", "workspace_tab_record_not_found", "Close action could not find workspaceTabId.", { workspaceTabId });
    return;
  }

  const tab = workspace.tabs[tabIndex];
  const liveTabResult = await findLiveBrowserTabForWorkspaceTab(tab);

  if (!liveTabResult.liveTab) {
    tab.isOpen = false;
    workspace.updatedAt = new Date().toISOString();
    await saveWorkspace(workspace);
    await addTimelineEvent("browser_tab_close_failed", "Could not close " + getTabName(tab) + " because it was not found in the browser.", {
      workspaceTabId: tab.workspaceTabId,
      matchStatus: liveTabResult.status
    });
    setIntakeStatus("Could not find " + getTabName(tab) + " in the browser. The workspace record was kept.");
    reloadSoon();
    return;
  }

  const confirmed = window.confirm("Close this browser tab and remove it from the workspace? Recovery will be available from the Recovery Journal.");

  if (!confirmed) {
    return;
  }

  const reason = window.prompt("Reason for closing this browser tab and removing it from the workspace? This will be recorded in the System Journal and Recovery Journal.\n\nTab: " + getTabName(tab), "");

  if (reason === null) {
    setIntakeStatus("Close cancelled. No action was taken.");
    return;
  }

  const tabSnapshot = createTabSnapshot(tab, workspace);
  await chrome.tabs.remove(liveTabResult.liveTab.id);
  workspace.tabs.splice(tabIndex, 1);
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  await addTimelineEvent("browser_tab_closed_and_removed", "Closed browser tab and removed from workspace: " + snapshotName(tabSnapshot) + ".", {
    reason: reason.trim() || "No reason recorded.",
    tabSnapshot: tabSnapshot,
    workspaceTabId: tabSnapshot.workspaceTabId,
    matchStatus: liveTabResult.status,
    recoveryActions: { canReopenUrl: true, canReaddToWorkspace: true }
  });
  setIntakeStatus("Closed browser tab and removed " + snapshotName(tabSnapshot) + " from workspace. Recovery is available from Recovery Journal.");
  reloadSoon();
}

async function removeTabByWorkspaceTabId(workspaceTabId) {
  const workspace = await getWorkspace();
  const tabIndex = workspace.tabs.findIndex((tab) => tab.workspaceTabId === workspaceTabId);

  if (tabIndex < 0) {
    setIntakeStatus("Could not find that workspace tab record.");
    await recordDiagnostic("warn", "workspace_tab_record_not_found", "Remove action could not find workspaceTabId.", { workspaceTabId });
    return;
  }

  const tab = workspace.tabs[tabIndex];
  const confirmed = window.confirm("Remove this tab from the workspace? The browser tab itself will not be closed and Recovery Journal will include recovery.");

  if (!confirmed) {
    return;
  }

  const reason = window.prompt("Reason for removing this tab from the workspace? This will be recorded in the System Journal and Recovery Journal.\n\nTab: " + getTabName(tab), "");

  if (reason === null) {
    setIntakeStatus("Remove cancelled. No action was taken.");
    return;
  }

  const tabSnapshot = createTabSnapshot(tab, workspace);
  workspace.tabs.splice(tabIndex, 1);
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  await addTimelineEvent("workspace_tab_removed", "Removed " + snapshotName(tabSnapshot) + " from workspace.", {
    reason: reason.trim() || "No reason recorded.",
    tabSnapshot: tabSnapshot,
    workspaceTabId: tabSnapshot.workspaceTabId,
    recoveryActions: { canReopenUrl: true, canReaddToWorkspace: true }
  });
  setIntakeStatus("Removed " + snapshotName(tabSnapshot) + " from workspace. Recovery is available from Recovery Journal.");
  reloadSoon();
}

async function focusGroupByRoleId(roleId, roleLabel) {
  const workspace = await getWorkspace();
  const safeRoleId = roleId || "unassigned";
  const safeRoleLabel = roleLabel || getWorkspaceRoleLabel(workspace.workspaceType || DEFAULT_WORKSPACE_TYPE, safeRoleId);
  const roleTabs = workspace.tabs.filter((tab) => (tab.role || "unassigned") === safeRoleId);
  const liveResults = [];

  for (const tab of roleTabs) {
    const result = await findLiveBrowserTabForWorkspaceTab(tab);

    if (result.liveTab) {
      liveResults.push({ workspaceTab: tab, liveTab: result.liveTab, matchStatus: result.status });
    }
  }

  if (!liveResults.length) {
    await addTimelineEvent("chrome_tab_group_focus_skipped", "Could not focus " + safeRoleLabel + " because no open workspace tabs were found for that role.", {
      roleId: safeRoleId,
      roleLabel: safeRoleLabel,
      workspaceTabIds: roleTabs.map((tab) => tab.workspaceTabId)
    });
    setIntakeStatus("No open workspace tabs found for " + safeRoleLabel + ".");
    reloadSoon();
    return;
  }

  liveResults.sort(compareLiveTabResults);
  const grouped = liveResults.filter((item) => Number.isInteger(item.liveTab.groupId) && item.liveTab.groupId >= 0);
  const target = grouped[0] || liveResults[0];

  await chrome.windows.update(target.liveTab.windowId, { focused: true });
  await chrome.tabs.update(target.liveTab.id, { active: true });
  await addTimelineEvent("chrome_tab_group_focused", "Focused " + safeRoleLabel + " group using tab: " + getTabName(target.workspaceTab) + ".", {
    roleId: safeRoleId,
    roleLabel: safeRoleLabel,
    workspaceTabId: target.workspaceTab.workspaceTabId,
    tabId: target.liveTab.id,
    matchStatus: target.matchStatus
  });
  setIntakeStatus("Focused " + safeRoleLabel + " group.");
  reloadSoon();
}

function createTabRoleGroups(workspace) {
  const workspaceType = workspace.workspaceType || DEFAULT_WORKSPACE_TYPE;
  const roles = getWorkspaceRoles(workspaceType);
  const roleGroups = roles.map((role) => ({ roleId: role.id, label: role.label, tabs: [], isLegacy: false }));
  const legacyGroups = [];

  workspace.tabs.forEach((tab) => {
    const roleId = tab.role || "unassigned";
    const group = roleGroups.find((item) => item.roleId === roleId);

    if (group) {
      group.tabs.push(tab);
      return;
    }

    let legacyGroup = legacyGroups.find((item) => item.roleId === roleId);

    if (!legacyGroup) {
      legacyGroup = {
        roleId: roleId,
        label: getWorkspaceRoleLabel(workspaceType, roleId),
        tabs: [],
        isLegacy: true
      };
      legacyGroups.push(legacyGroup);
    }

    legacyGroup.tabs.push(tab);
  });

  return roleGroups.filter((group) => group.tabs.length > 0).concat(legacyGroups);
}

async function findLiveBrowserTabForWorkspaceTab(workspaceTab) {
  const browserTabs = await chrome.tabs.query({});

  if (Number.isInteger(workspaceTab.tabId)) {
    const exactTab = browserTabs.find((tab) => tab.id === workspaceTab.tabId);

    if (exactTab) {
      return { liveTab: createBrowserTabSnapshot(exactTab), status: "exact_tab_id", candidateCount: 1 };
    }
  }

  const urlMatches = browserTabs.filter((tab) => workspaceTab.url && tab.url === workspaceTab.url);

  if (urlMatches.length === 1) {
    return { liveTab: createBrowserTabSnapshot(urlMatches[0]), status: "single_url_fallback", candidateCount: 1 };
  }

  if (urlMatches.length > 1) {
    return { liveTab: null, status: "ambiguous_url_matches", candidateCount: urlMatches.length };
  }

  const tabKeyMatches = browserTabs.filter((tab) => createTabKey(tab) === workspaceTab.tabKey);

  if (tabKeyMatches.length === 1) {
    return { liveTab: createBrowserTabSnapshot(tabKeyMatches[0]), status: "single_tab_key_fallback", candidateCount: 1 };
  }

  if (tabKeyMatches.length > 1) {
    return { liveTab: null, status: "ambiguous_tab_key_matches", candidateCount: tabKeyMatches.length };
  }

  return { liveTab: null, status: "not_found", candidateCount: 0 };
}

function createBrowserTabSnapshot(tab) {
  return {
    id: tab.id,
    tabKey: createTabKey(tab),
    windowId: tab.windowId,
    groupId: tab.groupId,
    index: tab.index,
    title: tab.title,
    url: tab.url,
    active: tab.active,
    pinned: tab.pinned
  };
}

function updateWorkspaceTabFromBrowserTabInPlace(workspaceTab, browserTab, extraFields = {}) {
  Object.assign(workspaceTab, {
    ...workspaceTab,
    tabId: browserTab.id,
    tabKey: browserTab.tabKey,
    windowId: browserTab.windowId,
    groupId: browserTab.groupId,
    url: browserTab.url,
    displayUrl: createDisplayUrl(browserTab.url || ""),
    originalTitle: browserTab.title,
    ...extraFields
  });
}

function createTabSnapshot(tab, workspace) {
  return {
    workspaceTabId: tab.workspaceTabId,
    tabId: tab.tabId,
    tabKey: tab.tabKey,
    windowId: tab.windowId,
    groupId: tab.groupId,
    url: tab.url,
    displayUrl: tab.displayUrl || createDisplayUrl(tab.url || ""),
    originalTitle: tab.originalTitle,
    alias: tab.alias || "",
    role: tab.role || "unassigned",
    workspaceType: workspace.workspaceType || DEFAULT_WORKSPACE_TYPE,
    isOpen: tab.isOpen !== false,
    firstSeenAt: tab.firstSeenAt,
    lastSeenAt: tab.lastSeenAt,
    capturedAt: new Date().toISOString()
  };
}

function findWorkspaceTabById(workspace, workspaceTabId) {
  return workspace.tabs.find((tab) => tab.workspaceTabId === workspaceTabId);
}

async function getWorkspace() {
  const result = await chrome.storage.local.get(WORKSPACE_KEY);
  const workspace = result[WORKSPACE_KEY] || null;

  if (!workspace) {
    return {
      workspaceId: crypto.randomUUID(),
      name: "",
      aim: "",
      workspaceType: DEFAULT_WORKSPACE_TYPE,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tabs: [],
      journal: [],
      timeline: []
    };
  }

  return {
    ...workspace,
    tabs: Array.isArray(workspace.tabs) ? workspace.tabs : [],
    journal: Array.isArray(workspace.journal) ? workspace.journal : [],
    timeline: Array.isArray(workspace.timeline) ? workspace.timeline : []
  };
}

async function saveWorkspace(workspace) {
  await chrome.storage.local.set({ [WORKSPACE_KEY]: workspace });
}

async function addTimelineEvent(type, message, details = {}) {
  const workspace = await getWorkspace();
  const event = {
    eventId: crypto.randomUUID(),
    type: type,
    message: message,
    createdAt: new Date().toISOString(),
    ...details
  };

  workspace.timeline.push(event);
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  return event;
}

async function recordDiagnostic(level, action, message, details = {}) {
  try {
    const result = await chrome.storage.local.get(DIAGNOSTICS_KEY);
    const diagnostics = Array.isArray(result[DIAGNOSTICS_KEY]) ? result[DIAGNOSTICS_KEY] : [];

    diagnostics.push({
      diagnosticId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      level: level,
      action: action,
      message: message,
      details: details
    });

    await chrome.storage.local.set({ [DIAGNOSTICS_KEY]: diagnostics.slice(-MAX_DIAGNOSTICS) });
  } catch (error) {
    console.warn("Chrome Flow stable record diagnostics failed:", error);
  }
}

function compareLiveTabResults(left, right) {
  if (left.liveTab.windowId !== right.liveTab.windowId) {
    return left.liveTab.windowId - right.liveTab.windowId;
  }

  return left.liveTab.index - right.liveTab.index;
}

function getTabName(tab) {
  return tab.alias || tab.originalTitle || tab.displayUrl || "Untitled tab";
}

function snapshotName(tabSnapshot) {
  return tabSnapshot.alias || tabSnapshot.originalTitle || tabSnapshot.displayUrl || "Untitled tab";
}

function createTabKey(tab) {
  return (tab.url || "") + "::" + (tab.title || "");
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
    if (rawUrl.length <= 72) {
      return rawUrl;
    }

    return rawUrl.slice(0, 69) + "...";
  }
}

function setIntakeStatus(message) {
  if (intakeStatus) {
    intakeStatus.textContent = message;
  }
}

function reloadSoon() {
  window.setTimeout(() => {
    window.location.reload();
  }, 300);
}
