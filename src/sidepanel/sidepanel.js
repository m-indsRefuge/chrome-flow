import {
  getWorkspace,
  saveWorkspace,
  addJournalEntry,
  addTimelineEvent
} from "../core/workspace-store.js";

import {
  createBrowserTabSnapshot,
  getAllBrowserTabs,
  getCurrentWindowTabs
} from "../core/tab-state.js";

import {
  DEFAULT_WORKSPACE_TYPE,
  WORKSPACE_TYPES,
  getWorkspaceRoleLabel,
  getWorkspaceType,
  getWorkspaceTypeDescription,
  getWorkspaceTypeLabel,
  getWorkspaceRoles,
  isValidWorkspaceRole
} from "../core/workspace-role-sets.js";

const workspaceNameInput = document.getElementById("workspaceName");
const workspaceAimInput = document.getElementById("workspaceAim");
const workspaceTypeSelect = document.getElementById("workspaceType");
const workspaceTypeDescription = document.getElementById("workspaceTypeDescription");
const saveWorkspaceButton = document.getElementById("saveWorkspaceButton");
const scanTabsButton = document.getElementById("scanTabsButton");
const addSelectedTabsButton = document.getElementById("addSelectedTabsButton");
const clearScannedTabsButton = document.getElementById("clearScannedTabsButton");
const intakeStatus = document.getElementById("intakeStatus");
const availableTabsList = document.getElementById("availableTabsList");
const searchQueryInput = document.getElementById("searchQuery");
const openSearchTabButton = document.getElementById("openSearchTabButton");
const refreshWorkspaceTabsButton = document.getElementById("refreshWorkspaceTabsButton");
const clearWorkspaceTabsButton = document.getElementById("clearWorkspaceTabsButton");
const tabsList = document.getElementById("tabsList");
const journalEntryInput = document.getElementById("journalEntry");
const addJournalButton = document.getElementById("addJournalButton");
const journalList = document.getElementById("journalList");
const timelineList = document.getElementById("timelineList");

let workspace = await getWorkspace();
let availableTabs = [];

populateWorkspaceTypeSelect();
renderWorkspace();
renderAvailableTabs();

saveWorkspaceButton.addEventListener("click", async () => {
  workspace.name = workspaceNameInput.value.trim();
  workspace.aim = workspaceAimInput.value.trim();
  workspace.workspaceType = workspaceTypeSelect.value || DEFAULT_WORKSPACE_TYPE;
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  await addTimelineEvent("workspace_saved", "Workspace saved.");
  workspace = await getWorkspace();
  renderWorkspace();
});

workspaceTypeSelect.addEventListener("change", async () => {
  workspace.workspaceType = workspaceTypeSelect.value || DEFAULT_WORKSPACE_TYPE;
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  await addTimelineEvent("workspace_type_changed", "Workspace type changed to " + getWorkspaceTypeLabel(workspace.workspaceType) + ".");
  workspace = await getWorkspace();
  setIntakeStatus("Workspace type set to " + getWorkspaceTypeLabel(workspace.workspaceType) + ". Tab role options and subgroups have been updated.");
  renderWorkspace();
});

scanTabsButton.addEventListener("click", async () => {
  availableTabs = await getCurrentWindowTabs();
  await addTimelineEvent("tabs_scanned", "Scanned " + availableTabs.length + " tabs from current window.");
  workspace = await getWorkspace();
  setIntakeStatus("Scanned " + availableTabs.length + " tabs. Select the tabs you want to add to this workspace.");
  renderAvailableTabs();
  renderTimeline();
});

addSelectedTabsButton.addEventListener("click", async () => {
  const selectedIndexes = getSelectedAvailableTabIndexes();

  if (!selectedIndexes.length) {
    setIntakeStatus("No tabs selected. Tick one or more scanned tabs first.");
    return;
  }

  let addedCount = 0;
  let skippedCount = 0;

  selectedIndexes.forEach((index) => {
    const tab = availableTabs[index];

    if (!tab) {
      return;
    }

    if (findWorkspaceTabMatch(tab)) {
      skippedCount += 1;
      return;
    }

    workspace.tabs.push(createWorkspaceTab(tab));
    addedCount += 1;
  });

  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  await addTimelineEvent("selected_tabs_added", "Added " + addedCount + " selected tab(s) to workspace. Skipped " + skippedCount + " existing tab(s).");
  workspace = await getWorkspace();
  setIntakeStatus("Added " + addedCount + " tab(s) to workspace. Skipped " + skippedCount + " existing tab(s).");
  renderWorkspace();
  renderAvailableTabs();
});

clearScannedTabsButton.addEventListener("click", () => {
  availableTabs = [];
  setIntakeStatus("Cleared scanned tabs.");
  renderAvailableTabs();
});

openSearchTabButton.addEventListener("click", async () => {
  await openSearchTabFromWorkspace();
});

searchQueryInput.addEventListener("keydown", async (event) => {
  if (event.key === "Enter") {
    await openSearchTabFromWorkspace();
  }
});

refreshWorkspaceTabsButton.addEventListener("click", async () => {
  if (!workspace.tabs.length) {
    setIntakeStatus("Workspace has no tabs to refresh.");
    return;
  }

  const currentTabs = await getAllBrowserTabs();
  const now = new Date().toISOString();
  let refreshedCount = 0;
  let missingCount = 0;

  workspace.tabs = workspace.tabs.map((workspaceTab) => {
    const currentTab = findCurrentTabForWorkspaceTab(workspaceTab, currentTabs);

    if (!currentTab) {
      missingCount += 1;
      return {
        ...workspaceTab,
        isOpen: false
      };
    }

    refreshedCount += 1;
    return updateWorkspaceTabFromBrowserTab(workspaceTab, currentTab, {
      isOpen: true,
      lastSeenAt: now
    });
  });

  workspace.updatedAt = now;
  await saveWorkspace(workspace);
  await addTimelineEvent("workspace_tabs_refreshed", "Refreshed metadata for " + refreshedCount + " workspace tab(s). " + missingCount + " tab(s) were not found in the browser.");
  workspace = await getWorkspace();
  setIntakeStatus("Refreshed " + refreshedCount + " workspace tab(s). " + missingCount + " tab(s) were not found in the browser.");
  renderWorkspace();
  renderAvailableTabs();
});

clearWorkspaceTabsButton.addEventListener("click", async () => {
  if (!workspace.tabs.length) {
    setIntakeStatus("Workspace already has no tabs.");
    return;
  }

  const confirmed = window.confirm("Clear all workspace tabs? This will remove tab aliases and roles from this workspace, but it will keep the workspace name, aim, journal, and timeline.");

  if (!confirmed) {
    return;
  }

  const clearedCount = workspace.tabs.length;
  workspace.tabs = [];
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  await addTimelineEvent("workspace_tabs_cleared", "Cleared " + clearedCount + " tab(s) from workspace.");
  workspace = await getWorkspace();
  setIntakeStatus("Cleared " + clearedCount + " workspace tab(s). Scan again and select only the tabs you want.");
  renderWorkspace();
  renderAvailableTabs();
});

addJournalButton.addEventListener("click", async () => {
  const text = journalEntryInput.value.trim();

  if (!text) {
    return;
  }

  await addJournalEntry(text);
  await addTimelineEvent("journal_added", "Journal entry added.");
  journalEntryInput.value = "";
  workspace = await getWorkspace();
  renderWorkspace();
});

function populateWorkspaceTypeSelect() {
  clearElement(workspaceTypeSelect);
  WORKSPACE_TYPES.forEach((workspaceType) => {
    const option = document.createElement("option");
    option.value = workspaceType.id;
    option.textContent = workspaceType.label;
    workspaceTypeSelect.appendChild(option);
  });
}

function renderWorkspace() {
  const workspaceType = getWorkspaceType(workspace.workspaceType);
  workspace.workspaceType = workspaceType.id;
  workspaceNameInput.value = workspace.name || "";
  workspaceAimInput.value = workspace.aim || "";
  workspaceTypeSelect.value = workspaceType.id;
  workspaceTypeDescription.textContent = getWorkspaceTypeDescription(workspaceType.id);
  renderTabs();
  renderJournal();
  renderTimeline();
}

function renderAvailableTabs() {
  clearElement(availableTabsList);

  if (!availableTabs.length) {
    const empty = document.createElement("p");
    empty.textContent = "No scanned tabs yet.";
    availableTabsList.appendChild(empty);
    return;
  }

  availableTabs.forEach((tab, index) => {
    const alreadyInWorkspace = Boolean(findWorkspaceTabMatch(tab));
    const card = document.createElement("div");
    card.className = "available-tab-card";

    if (alreadyInWorkspace) {
      card.classList.add("disabled");
    }

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "available-tab-checkbox";
    checkbox.dataset.tabIndex = String(index);
    checkbox.disabled = alreadyInWorkspace;
    checkbox.checked = false;
    card.appendChild(checkbox);

    const content = document.createElement("div");
    appendTextDiv(content, "tab-title", tab.title || "Untitled tab");

    const url = document.createElement("div");
    url.className = "tab-url";
    url.textContent = createDisplayUrl(tab.url || "");
    url.title = tab.url || "";
    content.appendChild(url);

    appendTextDiv(content, "tab-meta", "Window " + tab.windowId + " | Tab " + tab.id);

    if (alreadyInWorkspace) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Already in workspace";
      content.appendChild(badge);
    }

    card.appendChild(content);
    availableTabsList.appendChild(card);
  });
}

function renderTabs() {
  clearElement(tabsList);

  if (!workspace.tabs.length) {
    const empty = document.createElement("p");
    empty.textContent = "No workspace tabs yet. Scan the current window and add selected tabs.";
    tabsList.appendChild(empty);
    return;
  }

  createTabRoleGroups(workspace.tabs).forEach((group) => {
    const groupSection = document.createElement("div");
    groupSection.className = "tab-role-group";

    if (group.isLegacy) {
      groupSection.classList.add("legacy-role-group");
    }

    const groupHeader = document.createElement("div");
    groupHeader.className = "tab-role-group-header";
    appendTextHeading(groupHeader, "h3", group.label);
    appendTextSpan(groupHeader, "tab-role-group-count", group.tabs.length + " tab" + (group.tabs.length === 1 ? "" : "s"));
    groupSection.appendChild(groupHeader);

    group.tabs.forEach((tab) => {
      groupSection.appendChild(createWorkspaceTabCard(tab));
    });

    tabsList.appendChild(groupSection);
  });

  attachWorkspaceTabHandlers();
}

function attachWorkspaceTabHandlers() {
  document.querySelectorAll(".alias-input").forEach((input) => {
    input.addEventListener("change", async (event) => {
      const tab = findWorkspaceTabByKey(event.target.dataset.tabKey);

      if (!tab) {
        return;
      }

      tab.alias = event.target.value.trim();
      workspace.updatedAt = new Date().toISOString();
      await saveWorkspace(workspace);
      await addTimelineEvent("tab_alias_updated", "Updated alias for: " + getTabName(tab) + ".");
      workspace = await getWorkspace();
      renderWorkspace();
    });
  });

  document.querySelectorAll(".role-select").forEach((select) => {
    select.addEventListener("change", async (event) => {
      const tab = findWorkspaceTabByKey(event.target.dataset.tabKey);

      if (!tab) {
        return;
      }

      tab.role = event.target.value;
      workspace.updatedAt = new Date().toISOString();
      const roleLabel = getWorkspaceRoleLabel(workspace.workspaceType, tab.role);
      await saveWorkspace(workspace);
      await addTimelineEvent("tab_role_updated", "Assigned " + getTabName(tab) + " to " + roleLabel + " subgroup.");
      workspace = await getWorkspace();
      renderWorkspace();
    });
  });

  document.querySelectorAll(".focus-tab-button").forEach((button) => {
    button.addEventListener("click", async (event) => {
      await focusWorkspaceTab(event.target.dataset.tabKey);
    });
  });

  document.querySelectorAll(".close-browser-tab-button").forEach((button) => {
    button.addEventListener("click", async (event) => {
      await closeBrowserTabForWorkspaceTab(event.target.dataset.tabKey);
    });
  });

  document.querySelectorAll(".remove-tab-button").forEach((button) => {
    button.addEventListener("click", async (event) => {
      await removeWorkspaceTabWithTrail(event.target.dataset.tabKey);
    });
  });
}

function createWorkspaceTabCard(tab) {
  const card = document.createElement("div");
  card.className = "tab-card";
  appendTextDiv(card, "tab-title", tab.originalTitle || "Untitled tab");

  const url = document.createElement("div");
  url.className = "tab-url";
  url.textContent = tab.displayUrl || createDisplayUrl(tab.url || "");
  url.title = tab.url || "";
  card.appendChild(url);

  const statusBadge = document.createElement("span");
  statusBadge.className = "badge browser-status-badge";

  if (tab.isOpen === false) {
    statusBadge.classList.add("closed");
    statusBadge.textContent = "Not currently open";
  } else {
    statusBadge.textContent = "Saved browser tab";
  }

  card.appendChild(statusBadge);

  const aliasLabel = document.createElement("label");
  aliasLabel.textContent = "Custom Alias";
  card.appendChild(aliasLabel);

  const aliasInput = document.createElement("input");
  aliasInput.type = "text";
  aliasInput.className = "alias-input";
  aliasInput.dataset.tabKey = tab.tabKey || "";
  aliasInput.value = tab.alias || "";
  card.appendChild(aliasInput);

  const roleLabel = document.createElement("label");
  roleLabel.textContent = "Role for " + getWorkspaceTypeLabel(workspace.workspaceType);
  card.appendChild(roleLabel);

  const roleSelect = document.createElement("select");
  roleSelect.className = "role-select";
  roleSelect.dataset.tabKey = tab.tabKey || "";
  renderRoleOptions(roleSelect, tab.role || "unassigned");
  card.appendChild(roleSelect);

  const actions = document.createElement("div");
  actions.className = "tab-card-actions";
  actions.appendChild(createActionButton("Focus Tab", "focus-tab-button secondary-button", tab.tabKey));
  actions.appendChild(createActionButton("Close Browser Tab", "close-browser-tab-button danger-button", tab.tabKey));
  actions.appendChild(createActionButton("Remove from Workspace", "remove-tab-button danger-button", tab.tabKey));
  card.appendChild(actions);

  return card;
}

function createTabRoleGroups(tabs) {
  const workspaceType = workspace.workspaceType || DEFAULT_WORKSPACE_TYPE;
  const roles = getWorkspaceRoles(workspaceType);
  const roleGroups = roles.map((role) => ({ roleId: role.id, label: role.label, tabs: [], isLegacy: false }));
  const legacyGroups = [];

  tabs.forEach((tab) => {
    const roleId = tab.role || "unassigned";
    const group = roleGroups.find((item) => item.roleId === roleId);

    if (group) {
      group.tabs.push(tab);
      return;
    }

    let legacyGroup = legacyGroups.find((item) => item.roleId === roleId);

    if (!legacyGroup) {
      legacyGroup = { roleId: roleId, label: getWorkspaceRoleLabel(workspaceType, roleId), tabs: [], isLegacy: true };
      legacyGroups.push(legacyGroup);
    }

    legacyGroup.tabs.push(tab);
  });

  return roleGroups.filter((group) => group.tabs.length > 0).concat(legacyGroups);
}

function renderRoleOptions(roleSelect, currentRole) {
  clearElement(roleSelect);
  const roles = getWorkspaceRoles(workspace.workspaceType || DEFAULT_WORKSPACE_TYPE);
  const currentRoleIsValid = isValidWorkspaceRole(workspace.workspaceType, currentRole);

  if (currentRole && !currentRoleIsValid) {
    const legacyOption = document.createElement("option");
    legacyOption.value = currentRole;
    legacyOption.textContent = "Legacy: " + currentRole;
    roleSelect.appendChild(legacyOption);
  }

  roles.forEach((role) => {
    const option = document.createElement("option");
    option.value = role.id;
    option.textContent = role.label;
    roleSelect.appendChild(option);
  });

  roleSelect.value = currentRole || "unassigned";
}

async function openSearchTabFromWorkspace() {
  const query = searchQueryInput.value.trim();

  if (!query) {
    setIntakeStatus("Enter a search query first.");
    return;
  }

  const searchUrl = "https://www.google.com/search?q=" + encodeURIComponent(query);
  await chrome.tabs.create({ url: searchUrl, active: true });
  await addTimelineEvent("browser_search_tab_opened", "Opened search tab for: " + query + ".");
  searchQueryInput.value = "";
  workspace = await getWorkspace();
  setIntakeStatus("Opened search tab for: " + query + ". Scan current window if you want to add it to this workspace.");
  renderTimeline();
}

async function focusWorkspaceTab(tabKey) {
  const tab = findWorkspaceTabByKey(tabKey);

  if (!tab) {
    setIntakeStatus("Could not find that workspace tab.");
    return;
  }

  const liveTab = await findLiveBrowserTabForWorkspaceTab(tab);

  if (!liveTab) {
    tab.isOpen = false;
    workspace.updatedAt = new Date().toISOString();
    await saveWorkspace(workspace);
    await addTimelineEvent("browser_tab_focus_failed", "Could not focus " + getTabName(tab) + " because it was not found in the browser.");
    workspace = await getWorkspace();
    setIntakeStatus("Could not find " + getTabName(tab) + " in the browser. Use timeline recovery if a saved action exists.");
    renderWorkspace();
    return;
  }

  await chrome.windows.update(liveTab.windowId, { focused: true });
  await chrome.tabs.update(liveTab.id, { active: true });
  updateWorkspaceTabFromBrowserTabInPlace(tab, liveTab, { isOpen: true, lastSeenAt: new Date().toISOString() });
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  await addTimelineEvent("browser_tab_focused", "Focused browser tab: " + getTabName(tab) + ".");
  workspace = await getWorkspace();
  setIntakeStatus("Focused browser tab: " + getTabName(tab) + ".");
  renderWorkspace();
}

async function closeBrowserTabForWorkspaceTab(tabKey) {
  const tabIndex = workspace.tabs.findIndex((item) => item.tabKey === tabKey);

  if (tabIndex < 0) {
    setIntakeStatus("Could not find that workspace tab.");
    return;
  }

  const tab = workspace.tabs[tabIndex];
  const liveTab = await findLiveBrowserTabForWorkspaceTab(tab);

  if (!liveTab) {
    tab.isOpen = false;
    workspace.updatedAt = new Date().toISOString();
    await saveWorkspace(workspace);
    await addTimelineEvent("browser_tab_close_failed", "Could not close " + getTabName(tab) + " because it was not found in the browser.");
    workspace = await getWorkspace();
    setIntakeStatus("Could not find " + getTabName(tab) + " in the browser. The workspace record was kept.");
    renderWorkspace();
    return;
  }

  const confirmed = window.confirm("Close this browser tab and remove it from the workspace? The timeline will keep a recovery record.");

  if (!confirmed) {
    return;
  }

  const reason = promptForActionReason("closing this browser tab and removing it from the workspace", getTabName(tab));

  if (reason === null) {
    setIntakeStatus("Close cancelled. No action was taken.");
    return;
  }

  const tabSnapshot = createTabSnapshot(tab);
  await chrome.tabs.remove(liveTab.id);
  workspace.tabs.splice(tabIndex, 1);
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  await addActionJournalEntry("Closed browser tab and removed from workspace", tabSnapshot, reason);
  await addTimelineEvent("browser_tab_closed_and_removed", "Closed browser tab and removed from workspace: " + snapshotName(tabSnapshot) + ".", {
    reason: reason,
    tabSnapshot: tabSnapshot,
    recoveryActions: { canReopenUrl: true, canReaddToWorkspace: true }
  });
  workspace = await getWorkspace();
  setIntakeStatus("Closed browser tab and removed " + snapshotName(tabSnapshot) + " from workspace. Recovery is available from the timeline.");
  renderWorkspace();
  renderAvailableTabs();
}

async function removeWorkspaceTabWithTrail(tabKey) {
  const tabIndex = workspace.tabs.findIndex((item) => item.tabKey === tabKey);

  if (tabIndex < 0) {
    setIntakeStatus("Could not find that workspace tab to remove.");
    return;
  }

  const tab = workspace.tabs[tabIndex];
  const tabSnapshot = createTabSnapshot(tab);
  const confirmed = window.confirm("Remove this tab from the workspace? The browser tab itself will not be closed and the timeline will include recovery.");

  if (!confirmed) {
    return;
  }

  const reason = promptForActionReason("removing this tab from the workspace", snapshotName(tabSnapshot));

  if (reason === null) {
    setIntakeStatus("Remove cancelled. No action was taken.");
    return;
  }

  workspace.tabs.splice(tabIndex, 1);
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  await addActionJournalEntry("Removed tab from workspace", tabSnapshot, reason);
  await addTimelineEvent("workspace_tab_removed", "Removed " + snapshotName(tabSnapshot) + " from workspace.", {
    reason: reason,
    tabSnapshot: tabSnapshot,
    recoveryActions: { canReopenUrl: true, canReaddToWorkspace: true }
  });
  workspace = await getWorkspace();
  setIntakeStatus("Removed " + snapshotName(tabSnapshot) + " from workspace. Recovery is available from the timeline.");
  renderWorkspace();
  renderAvailableTabs();
}

function renderJournal() {
  clearElement(journalList);

  if (!workspace.journal.length) {
    const empty = document.createElement("p");
    empty.textContent = "No journal entries yet.";
    journalList.appendChild(empty);
    return;
  }

  workspace.journal.forEach((entry) => {
    const card = document.createElement("div");
    card.className = "journal-card";
    const text = document.createElement("p");
    text.textContent = entry.text;
    card.appendChild(text);
    const time = document.createElement("small");
    time.textContent = entry.createdAt;
    card.appendChild(time);
    journalList.appendChild(card);
  });
}

function renderTimeline() {
  clearElement(timelineList);

  if (!workspace.timeline.length) {
    const empty = document.createElement("p");
    empty.textContent = "No timeline events yet.";
    timelineList.appendChild(empty);
    return;
  }

  workspace.timeline.slice().reverse().forEach((event) => {
    const card = document.createElement("div");
    card.className = "timeline-card";
    const type = document.createElement("strong");
    type.textContent = event.type;
    card.appendChild(type);
    const message = document.createElement("p");
    message.textContent = event.message;
    card.appendChild(message);

    if (event.reason) {
      const reason = document.createElement("p");
      reason.className = "timeline-reason";
      reason.textContent = "Reason: " + event.reason;
      card.appendChild(reason);
    }

    if (event.tabSnapshot) {
      card.appendChild(createTimelineTabSnapshot(event.tabSnapshot));
    }

    if (event.recoveryActions && event.tabSnapshot) {
      const actions = document.createElement("div");
      actions.className = "timeline-actions";

      if (event.recoveryActions.canReopenUrl) {
        const reopenButton = document.createElement("button");
        reopenButton.type = "button";
        reopenButton.className = "timeline-reopen-url-button secondary-button";
        reopenButton.dataset.eventId = event.eventId;
        reopenButton.textContent = "Reopen URL";
        actions.appendChild(reopenButton);
      }

      if (event.recoveryActions.canReaddToWorkspace) {
        const readdButton = document.createElement("button");
        readdButton.type = "button";
        readdButton.className = "timeline-readd-workspace-button secondary-button";
        readdButton.dataset.eventId = event.eventId;
        readdButton.textContent = "Re-add to Workspace";
        actions.appendChild(readdButton);
      }

      card.appendChild(actions);
    }

    const time = document.createElement("small");
    time.textContent = event.createdAt;
    card.appendChild(time);
    timelineList.appendChild(card);
  });

  attachTimelineRecoveryHandlers();
}

function createTimelineTabSnapshot(tabSnapshot) {
  const snapshot = document.createElement("div");
  snapshot.className = "timeline-tab-snapshot";
  appendTextDiv(snapshot, "tab-title", snapshotName(tabSnapshot));
  const url = document.createElement("div");
  url.className = "tab-url";
  url.textContent = tabSnapshot.displayUrl || createDisplayUrl(tabSnapshot.url || "");
  url.title = tabSnapshot.url || "";
  snapshot.appendChild(url);
  appendTextDiv(snapshot, "tab-meta", "Role: " + (tabSnapshot.role || "unassigned") + " | Workspace type: " + (tabSnapshot.workspaceType || "unknown"));
  return snapshot;
}

function attachTimelineRecoveryHandlers() {
  document.querySelectorAll(".timeline-reopen-url-button").forEach((button) => {
    button.addEventListener("click", async (event) => {
      await reopenUrlFromTimeline(event.target.dataset.eventId);
    });
  });

  document.querySelectorAll(".timeline-readd-workspace-button").forEach((button) => {
    button.addEventListener("click", async (event) => {
      await readdWorkspaceTabFromTimeline(event.target.dataset.eventId);
    });
  });
}

async function reopenUrlFromTimeline(eventId) {
  const timelineEvent = findTimelineEventById(eventId);

  if (!timelineEvent || !timelineEvent.tabSnapshot || !timelineEvent.tabSnapshot.url) {
    setIntakeStatus("Could not find a saved URL for this timeline event.");
    return;
  }

  const createdTab = await chrome.tabs.create({ url: timelineEvent.tabSnapshot.url, active: true });
  const browserTab = createBrowserTabSnapshot(createdTab);
  const matchingWorkspaceTab = workspace.tabs.find((tab) => tab.url === timelineEvent.tabSnapshot.url || tab.tabKey === timelineEvent.tabSnapshot.tabKey);

  if (matchingWorkspaceTab) {
    updateWorkspaceTabFromBrowserTabInPlace(matchingWorkspaceTab, browserTab, {
      isOpen: true,
      lastOpenedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    });
    workspace.updatedAt = new Date().toISOString();
    await saveWorkspace(workspace);
  }

  await addTimelineEvent("timeline_url_reopened", "Reopened URL from timeline for: " + snapshotName(timelineEvent.tabSnapshot) + ".", {
    tabSnapshot: timelineEvent.tabSnapshot,
    recoverySourceEventId: eventId
  });
  workspace = await getWorkspace();
  setIntakeStatus("Reopened URL from timeline for: " + snapshotName(timelineEvent.tabSnapshot) + ".");
  renderWorkspace();
  renderAvailableTabs();
}

async function readdWorkspaceTabFromTimeline(eventId) {
  const timelineEvent = findTimelineEventById(eventId);

  if (!timelineEvent || !timelineEvent.tabSnapshot) {
    setIntakeStatus("Could not find a saved tab snapshot for this timeline event.");
    return;
  }

  const tabSnapshot = timelineEvent.tabSnapshot;
  const existing = workspace.tabs.find((tab) => tab.url === tabSnapshot.url || tab.tabKey === tabSnapshot.tabKey);

  if (existing) {
    setIntakeStatus(snapshotName(tabSnapshot) + " is already in the workspace.");
    return;
  }

  workspace.tabs.push(createWorkspaceTabFromSnapshot(tabSnapshot));
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  await addTimelineEvent("workspace_tab_readded", "Re-added " + snapshotName(tabSnapshot) + " to workspace from timeline recovery.", {
    tabSnapshot: tabSnapshot,
    recoverySourceEventId: eventId
  });
  workspace = await getWorkspace();
  setIntakeStatus("Re-added " + snapshotName(tabSnapshot) + " to workspace from timeline recovery.");
  renderWorkspace();
  renderAvailableTabs();
}

function getSelectedAvailableTabIndexes() {
  return Array.from(document.querySelectorAll(".available-tab-checkbox:checked"))
    .filter((checkbox) => !checkbox.disabled)
    .map((checkbox) => Number(checkbox.dataset.tabIndex))
    .filter((index) => Number.isInteger(index));
}

function findWorkspaceTabMatch(tab) {
  return workspace.tabs.find((item) => item.tabId === tab.id || item.tabKey === tab.tabKey || item.url === tab.url);
}

function findCurrentTabForWorkspaceTab(workspaceTab, currentTabs) {
  return currentTabs.find((tab) => tab.id === workspaceTab.tabId || tab.url === workspaceTab.url || tab.tabKey === workspaceTab.tabKey);
}

async function findLiveBrowserTabForWorkspaceTab(workspaceTab) {
  const allTabs = await getAllBrowserTabs();
  return findCurrentTabForWorkspaceTab(workspaceTab, allTabs);
}

function findWorkspaceTabByKey(tabKey) {
  return workspace.tabs.find((item) => item.tabKey === tabKey);
}

function findTimelineEventById(eventId) {
  return workspace.timeline.find((event) => event.eventId === eventId);
}

function createWorkspaceTab(tab) {
  const now = new Date().toISOString();
  return {
    tabId: tab.id,
    tabKey: tab.tabKey,
    windowId: tab.windowId,
    groupId: tab.groupId,
    url: tab.url,
    displayUrl: createDisplayUrl(tab.url || ""),
    originalTitle: tab.title,
    alias: "",
    role: "unassigned",
    isOpen: true,
    firstSeenAt: now,
    lastSeenAt: now
  };
}

function createWorkspaceTabFromSnapshot(tabSnapshot) {
  const now = new Date().toISOString();
  return {
    tabId: tabSnapshot.tabId,
    tabKey: tabSnapshot.tabKey || ((tabSnapshot.url || "") + "::" + (tabSnapshot.originalTitle || "")),
    windowId: tabSnapshot.windowId,
    groupId: tabSnapshot.groupId,
    url: tabSnapshot.url,
    displayUrl: tabSnapshot.displayUrl || createDisplayUrl(tabSnapshot.url || ""),
    originalTitle: tabSnapshot.originalTitle,
    alias: tabSnapshot.alias || "",
    role: tabSnapshot.role || "unassigned",
    isOpen: false,
    firstSeenAt: tabSnapshot.firstSeenAt || now,
    lastSeenAt: tabSnapshot.lastSeenAt || now,
    restoredAt: now
  };
}

function createTabSnapshot(tab) {
  return {
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

function updateWorkspaceTabFromBrowserTab(workspaceTab, browserTab, extraFields = {}) {
  return {
    ...workspaceTab,
    tabId: browserTab.id,
    tabKey: browserTab.tabKey,
    windowId: browserTab.windowId,
    groupId: browserTab.groupId,
    url: browserTab.url,
    displayUrl: createDisplayUrl(browserTab.url || ""),
    originalTitle: browserTab.title,
    ...extraFields
  };
}

function updateWorkspaceTabFromBrowserTabInPlace(workspaceTab, browserTab, extraFields = {}) {
  Object.assign(workspaceTab, updateWorkspaceTabFromBrowserTab(workspaceTab, browserTab, extraFields));
}

function getTabName(tab) {
  return tab.alias || tab.originalTitle || tab.displayUrl || "Untitled tab";
}

function snapshotName(tabSnapshot) {
  return tabSnapshot.alias || tabSnapshot.originalTitle || tabSnapshot.displayUrl || "Untitled tab";
}

function promptForActionReason(actionLabel, tabName) {
  const reason = window.prompt("Reason for " + actionLabel + "? This will be recorded in the journal and timeline.\n\nTab: " + tabName, "");

  if (reason === null) {
    return null;
  }

  return reason.trim() || "No reason recorded.";
}

async function addActionJournalEntry(actionLabel, tabSnapshot, reason) {
  await addJournalEntry(actionLabel + ": " + snapshotName(tabSnapshot) + "\nReason: " + reason + "\nURL: " + (tabSnapshot.url || "No URL recorded."));
}

function createActionButton(text, className, tabKey) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.dataset.tabKey = tabKey || "";
  button.textContent = text;
  return button;
}

function appendTextDiv(parent, className, text) {
  const element = document.createElement("div");
  element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function appendTextSpan(parent, className, text) {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function appendTextHeading(parent, tagName, text) {
  const element = document.createElement(tagName);
  element.textContent = text;
  parent.appendChild(element);
  return element;
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
  intakeStatus.textContent = message;
}

function clearElement(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}
