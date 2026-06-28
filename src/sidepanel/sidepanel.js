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
const createChromeGroupsButton = document.getElementById("createChromeGroupsButton");
const removeChromeGroupsButton = document.getElementById("removeChromeGroupsButton");
const refreshWorkspaceTabsButton = document.getElementById("refreshWorkspaceTabsButton");
const clearWorkspaceTabsButton = document.getElementById("clearWorkspaceTabsButton");
const refreshTabStatusButton = document.getElementById("refreshTabStatusButton");
const tabsList = document.getElementById("tabsList");
const journalEntryInput = document.getElementById("journalEntry");
const journalTagInput = document.getElementById("journalTag");
const journalRelatedRoleSelect = document.getElementById("journalRelatedRole");
const addJournalButton = document.getElementById("addJournalButton");
const journalList = document.getElementById("journalList");
const recoveryList = document.getElementById("recoveryList");
const systemTimelineList = document.getElementById("systemTimelineList");

let availableTabs = [];

await initializeSidePanel();

async function initializeSidePanel() {
  await migrateWorkspaceTabIds();
  populateWorkspaceTypeSelect();
  attachEventHandlers();
  await renderWorkspace();
}

function attachEventHandlers() {
  saveWorkspaceButton?.addEventListener("click", saveWorkspaceDetails);
  workspaceTypeSelect?.addEventListener("change", updateWorkspaceType);
  scanTabsButton?.addEventListener("click", scanCurrentWindowTabs);
  addSelectedTabsButton?.addEventListener("click", addSelectedTabsToWorkspace);
  clearScannedTabsButton?.addEventListener("click", clearScannedTabs);
  openSearchTabButton?.addEventListener("click", openSearchTab);
  createChromeGroupsButton?.addEventListener("click", createChromeTabGroupsFromWorkspace);
  removeChromeGroupsButton?.addEventListener("click", removeAllChromeTabGroupsForWorkspace);
  refreshWorkspaceTabsButton?.addEventListener("click", refreshWorkspaceTabMetadata);
  clearWorkspaceTabsButton?.addEventListener("click", clearWorkspaceTabs);
  refreshTabStatusButton?.addEventListener("click", refreshTabStatus);
  addJournalButton?.addEventListener("click", addUserJournalEntry);
}

function populateWorkspaceTypeSelect() {
  if (!workspaceTypeSelect) {
    return;
  }

  clearElement(workspaceTypeSelect);

  WORKSPACE_TYPES.forEach((workspaceType) => {
    const option = document.createElement("option");
    option.value = workspaceType.id;
    option.textContent = workspaceType.label;
    workspaceTypeSelect.appendChild(option);
  });
}

async function renderWorkspace() {
  const workspace = await getWorkspace();
  await ensureWorkspaceTabIds(workspace);

  workspaceNameInput.value = workspace.name || "";
  workspaceAimInput.value = workspace.aim || "";
  workspaceTypeSelect.value = workspace.workspaceType || DEFAULT_WORKSPACE_TYPE;

  renderWorkspaceTypeDescription(workspace);
  renderJournalRelatedRoleOptions(workspace);
  renderAvailableTabs(workspace);
  renderWorkspaceTabs(workspace);
  renderUserJournal(workspace);
  renderRecoveryJournal(workspace);
  renderSystemTimeline(workspace);

  const resolution = await resolveWorkspaceTabsToLiveTabs(workspace);
  renderTabStatus(calculateStableTabStatus(workspace, resolution.results));
}

async function saveWorkspaceDetails() {
  const workspace = await getWorkspace();
  workspace.name = workspaceNameInput.value.trim();
  workspace.aim = workspaceAimInput.value.trim();
  workspace.workspaceType = workspaceTypeSelect.value || DEFAULT_WORKSPACE_TYPE;
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  await addTimelineEvent("workspace_saved", "Workspace saved.");
  setStatus("Workspace saved.");
  await renderWorkspace();
}

async function updateWorkspaceType() {
  const workspace = await getWorkspace();
  const previousType = workspace.workspaceType || DEFAULT_WORKSPACE_TYPE;
  const nextType = workspaceTypeSelect.value || DEFAULT_WORKSPACE_TYPE;

  if (previousType === nextType) {
    renderWorkspaceTypeDescription(workspace);
    return;
  }

  workspace.workspaceType = nextType;
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  await addTimelineEvent("workspace_type_updated", "Workspace type changed from " + getWorkspaceTypeLabel(previousType) + " to " + getWorkspaceTypeLabel(nextType) + ".", {
    previousType,
    nextType
  });
  setStatus("Workspace type changed to " + getWorkspaceTypeLabel(nextType) + ".");
  await renderWorkspace();
}

function renderWorkspaceTypeDescription(workspace) {
  if (!workspaceTypeDescription) {
    return;
  }

  const workspaceType = workspace.workspaceType || DEFAULT_WORKSPACE_TYPE;
  workspaceTypeDescription.textContent = getWorkspaceTypeDescription(workspaceType);
}

async function scanCurrentWindowTabs() {
  availableTabs = await getCurrentWindowTabs();
  await addTimelineEvent("tabs_scanned", "Scanned " + availableTabs.length + " tabs from current window.");
  setStatus("Scanned " + availableTabs.length + " tabs from current window.");
  await renderWorkspace();
}

function clearScannedTabs() {
  availableTabs = [];
  clearElement(availableTabsList);
  setStatus("Scanned tabs cleared.");
}

function renderAvailableTabs(workspace) {
  if (!availableTabsList) {
    return;
  }

  clearElement(availableTabsList);

  if (!availableTabs.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No scanned tabs yet.";
    availableTabsList.appendChild(empty);
    return;
  }

  availableTabs.forEach((tab) => {
    const exactMatch = findExactWorkspaceTabMatch(workspace, tab);
    const sameUrlMatch = findSameUrlWorkspaceTabMatch(workspace, tab);
    const card = document.createElement("label");
    card.className = "available-tab-card" + (exactMatch ? " disabled" : "");
    card.dataset.tabId = String(tab.id);
    card.dataset.windowId = String(tab.windowId);
    card.dataset.tabUrl = tab.url || "";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "available-tab-checkbox";
    checkbox.dataset.tabId = String(tab.id);
    checkbox.disabled = Boolean(exactMatch);
    card.appendChild(checkbox);

    const content = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = tab.title || "Untitled tab";
    content.appendChild(title);

    const url = document.createElement("span");
    url.className = "tab-url";
    url.textContent = createDisplayUrl(tab.url || "");
    content.appendChild(url);

    if (exactMatch) {
      content.appendChild(createBadge("Already in workspace", "exact-instance-badge"));
    } else if (sameUrlMatch) {
      content.appendChild(createBadge("Same URL already in workspace", "duplicate-url-badge"));
    }

    card.appendChild(content);
    availableTabsList.appendChild(card);
  });
}

async function addSelectedTabsToWorkspace() {
  const selectedCheckboxes = Array.from(document.querySelectorAll(".available-tab-checkbox:checked"))
    .filter((checkbox) => !checkbox.disabled);

  if (!selectedCheckboxes.length) {
    setStatus("No tabs selected. Tick one or more scanned tabs first.");
    return;
  }

  const workspace = await getWorkspace();
  await ensureWorkspaceTabIds(workspace);

  let addedCount = 0;
  let exactSkippedCount = 0;
  let missingCount = 0;
  let duplicateUrlAddedCount = 0;

  selectedCheckboxes.forEach((checkbox) => {
    const tabId = Number(checkbox.dataset.tabId);
    const tab = availableTabs.find((item) => item.id === tabId);

    if (!tab) {
      missingCount += 1;
      return;
    }

    if (findExactWorkspaceTabMatch(workspace, tab)) {
      exactSkippedCount += 1;
      return;
    }

    if (findSameUrlWorkspaceTabMatch(workspace, tab)) {
      duplicateUrlAddedCount += 1;
    }

    workspace.tabs.push(createWorkspaceTab(tab));
    addedCount += 1;
  });

  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);

  const message = "Added " + addedCount + " selected tab(s) to workspace. Skipped " + exactSkippedCount + " exact existing tab(s). Allowed " + duplicateUrlAddedCount + " same-URL duplicate tab(s)." + (missingCount ? " " + missingCount + " selected tab(s) were no longer found." : "");
  await addTimelineEvent("selected_tabs_added", message, {
    intakeMatchingMode: "instance_aware",
    addedCount,
    exactSkippedCount,
    duplicateUrlAddedCount,
    missingCount
  });

  availableTabs = [];
  setStatus(message);
  await renderWorkspace();
}

async function openSearchTab() {
  const query = searchQueryInput.value.trim();

  if (!query) {
    setStatus("Enter a search query first.");
    return;
  }

  const url = "https://www.google.com/search?q=" + encodeURIComponent(query);
  await chrome.tabs.create({ url, active: true });
  await addTimelineEvent("browser_search_tab_opened", "Opened search tab for: " + query + ".", {
    query,
    url
  });
  searchQueryInput.value = "";
  setStatus("Opened search tab for: " + query + ".");
}

function renderWorkspaceTabs(workspace) {
  if (!tabsList) {
    return;
  }

  clearElement(tabsList);

  if (!workspace.tabs.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No tabs added to this workspace yet.";
    tabsList.appendChild(empty);
    return;
  }

  createTabRoleGroups(workspace).forEach((group) => {
    const section = document.createElement("section");
    section.className = "tab-role-group";
    section.dataset.roleId = group.roleId;

    const header = document.createElement("div");
    header.className = "tab-role-group-header";

    const heading = document.createElement("h3");
    heading.textContent = group.label + " (" + group.tabs.length + ")";
    header.appendChild(heading);

    const headerActions = document.createElement("div");
    headerActions.className = "tab-role-group-actions";
    headerActions.appendChild(createRoleActionButton("Focus Group", "focus-chrome-group-button secondary-button", group.roleId, group.label, focusChromeGroupForRole));
    headerActions.appendChild(createRoleActionButton("Remove Chrome Group", "remove-chrome-group-button danger-button", group.roleId, group.label, removeChromeTabGroupForRole));
    header.appendChild(headerActions);

    section.appendChild(header);

    group.tabs.forEach((tab) => {
      section.appendChild(createWorkspaceTabCard(workspace, tab));
    });

    tabsList.appendChild(section);
  });
}

function createWorkspaceTabCard(workspace, tab) {
  const card = document.createElement("article");
  card.className = "tab-card";
  card.dataset.workspaceTabId = tab.workspaceTabId || "";

  const title = document.createElement("h4");
  title.textContent = getTabName(tab);
  card.appendChild(title);

  const originalTitle = document.createElement("p");
  originalTitle.className = "tab-original-title";
  originalTitle.textContent = tab.originalTitle || "Untitled tab";
  card.appendChild(originalTitle);

  const url = document.createElement("p");
  url.className = "tab-url";
  url.textContent = tab.displayUrl || createDisplayUrl(tab.url || "");
  card.appendChild(url);

  const recordBadge = createBadge("Record " + (tab.workspaceTabId || "unknown").slice(0, 8), "workspace-tab-id-badge");
  recordBadge.title = "Chrome Flow workspaceTabId: " + (tab.workspaceTabId || "missing");
  card.appendChild(recordBadge);

  const aliasLabel = document.createElement("label");
  aliasLabel.textContent = "Alias";
  const aliasInput = document.createElement("input");
  aliasInput.className = "alias-input";
  aliasInput.value = tab.alias || "";
  aliasInput.dataset.workspaceTabId = tab.workspaceTabId || "";
  aliasInput.addEventListener("change", () => updateTabAlias(tab.workspaceTabId, aliasInput.value));
  aliasLabel.appendChild(aliasInput);
  card.appendChild(aliasLabel);

  const roleLabel = document.createElement("label");
  roleLabel.textContent = "Role";
  const roleSelect = document.createElement("select");
  roleSelect.className = "role-select";
  roleSelect.dataset.workspaceTabId = tab.workspaceTabId || "";
  populateRoleSelect(roleSelect, workspace, tab.role || "unassigned");
  roleSelect.addEventListener("change", () => updateTabRole(tab.workspaceTabId, roleSelect.value));
  roleLabel.appendChild(roleSelect);
  card.appendChild(roleLabel);

  const actions = document.createElement("div");
  actions.className = "tab-card-actions";
  actions.appendChild(createTabActionButton("Focus Tab", "focus-tab-button secondary-button", tab.workspaceTabId, focusWorkspaceTab));
  actions.appendChild(createTabActionButton("Close Browser Tab", "close-browser-tab-button danger-button", tab.workspaceTabId, closeBrowserTabFromWorkspace));
  actions.appendChild(createTabActionButton("Remove from Workspace", "remove-tab-button danger-button", tab.workspaceTabId, removeWorkspaceTab));
  card.appendChild(actions);

  return card;
}

function populateRoleSelect(select, workspace, selectedRoleId) {
  clearElement(select);
  const workspaceType = workspace.workspaceType || DEFAULT_WORKSPACE_TYPE;
  const roles = getWorkspaceRoles(workspaceType);
  const hasCurrentRole = roles.some((role) => role.id === selectedRoleId);

  roles.forEach((role) => {
    const option = document.createElement("option");
    option.value = role.id;
    option.textContent = role.label;
    select.appendChild(option);
  });

  if (selectedRoleId && !hasCurrentRole) {
    const legacyOption = document.createElement("option");
    legacyOption.value = selectedRoleId;
    legacyOption.textContent = getWorkspaceRoleLabel(workspaceType, selectedRoleId);
    select.appendChild(legacyOption);
  }

  select.value = selectedRoleId || "unassigned";
}

async function updateTabAlias(workspaceTabId, aliasValue) {
  const workspace = await getWorkspace();
  const tab = findWorkspaceTabById(workspace, workspaceTabId);

  if (!tab) {
    setStatus("Could not find that workspace tab record.");
    return;
  }

  tab.alias = aliasValue.trim();
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  await addTimelineEvent("tab_alias_updated", "Updated alias for: " + getTabName(tab) + ".", {
    workspaceTabId: tab.workspaceTabId
  });
  setStatus("Updated alias for " + getTabName(tab) + ".");
  await renderWorkspace();
}

async function updateTabRole(workspaceTabId, roleValue) {
  const workspace = await getWorkspace();
  const tab = findWorkspaceTabById(workspace, workspaceTabId);

  if (!tab) {
    setStatus("Could not find that workspace tab record.");
    return;
  }

  tab.role = roleValue || "unassigned";
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);

  const roleLabel = getWorkspaceRoleLabel(workspace.workspaceType || DEFAULT_WORKSPACE_TYPE, tab.role);
  await addTimelineEvent("tab_role_updated", "Assigned " + getTabName(tab) + " to " + roleLabel + " subgroup.", {
    workspaceTabId: tab.workspaceTabId,
    tabId: tab.tabId,
    url: tab.url
  });
  setStatus("Assigned " + getTabName(tab) + " to " + roleLabel + ".");
  await renderWorkspace();
}

async function focusWorkspaceTab(workspaceTabId) {
  const workspace = await getWorkspace();
  const tab = findWorkspaceTabById(workspace, workspaceTabId);

  if (!tab) {
    setStatus("Could not find that workspace tab record.");
    return;
  }

  const result = await resolveSingleWorkspaceTabForAction(tab);

  if (!result.liveTab) {
    tab.isOpen = false;
    tab.lastMatchStatus = result.matchStatus;
    workspace.updatedAt = new Date().toISOString();
    await saveWorkspace(workspace);
    await addTimelineEvent("browser_tab_focus_failed", "Could not focus " + getTabName(tab) + " because it was not safely found in the browser.", {
      workspaceTabId: tab.workspaceTabId,
      matchStatus: result.matchStatus,
      candidateCount: result.candidateCount
    });
    setStatus("Could not safely find " + getTabName(tab) + ". Match status: " + result.matchStatus + ".");
    await renderWorkspace();
    return;
  }

  await chrome.windows.update(result.liveTab.windowId, { focused: true });
  await chrome.tabs.update(result.liveTab.id, { active: true });
  updateWorkspaceTabFromBrowserTab(tab, result.liveTab, {
    isOpen: true,
    lastSeenAt: new Date().toISOString(),
    lastMatchStatus: result.matchStatus
  });
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  await addTimelineEvent("browser_tab_focused", "Focused browser tab: " + getTabName(tab) + ".", {
    workspaceTabId: tab.workspaceTabId,
    tabId: result.liveTab.id,
    matchStatus: result.matchStatus
  });
  setStatus("Focused browser tab: " + getTabName(tab) + ".");
  await renderWorkspace();
}

async function closeBrowserTabFromWorkspace(workspaceTabId) {
  const workspace = await getWorkspace();
  const tabIndex = workspace.tabs.findIndex((tab) => tab.workspaceTabId === workspaceTabId);

  if (tabIndex < 0) {
    setStatus("Could not find that workspace tab record.");
    return;
  }

  const tab = workspace.tabs[tabIndex];
  const result = await resolveSingleWorkspaceTabForAction(tab);

  if (!result.liveTab) {
    tab.isOpen = false;
    tab.lastMatchStatus = result.matchStatus;
    workspace.updatedAt = new Date().toISOString();
    await saveWorkspace(workspace);
    await addTimelineEvent("browser_tab_close_failed", "Could not close " + getTabName(tab) + " because it was not safely found in the browser.", {
      workspaceTabId: tab.workspaceTabId,
      matchStatus: result.matchStatus,
      candidateCount: result.candidateCount
    });
    setStatus("Could not safely find " + getTabName(tab) + ". The workspace record was kept.");
    await renderWorkspace();
    return;
  }

  const confirmed = window.confirm("Close this browser tab and remove it from the workspace? Recovery will be available from the Recovery Journal.");

  if (!confirmed) {
    setStatus("Close cancelled. No action was taken.");
    return;
  }

  const reason = window.prompt("Reason for closing this browser tab and removing it from the workspace? This will be recorded in the System Journal and Recovery Journal.\n\nTab: " + getTabName(tab), "");

  if (reason === null) {
    setStatus("Close cancelled. No action was taken.");
    return;
  }

  const tabSnapshot = createTabSnapshot(tab, workspace);
  await chrome.tabs.remove(result.liveTab.id);
  workspace.tabs.splice(tabIndex, 1);
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  await addTimelineEvent("browser_tab_closed_and_removed", "Closed browser tab and removed from workspace: " + snapshotName(tabSnapshot) + ".", {
    reason: reason.trim() || "No reason recorded.",
    tabSnapshot,
    workspaceTabId: tabSnapshot.workspaceTabId,
    matchStatus: result.matchStatus,
    recoveryActions: {
      canReopenUrl: true,
      canReaddToWorkspace: true
    }
  });
  setStatus("Closed browser tab and removed " + snapshotName(tabSnapshot) + " from workspace. Recovery is available from Recovery Journal.");
  await renderWorkspace();
}

async function removeWorkspaceTab(workspaceTabId) {
  const workspace = await getWorkspace();
  const tabIndex = workspace.tabs.findIndex((tab) => tab.workspaceTabId === workspaceTabId);

  if (tabIndex < 0) {
    setStatus("Could not find that workspace tab record.");
    return;
  }

  const tab = workspace.tabs[tabIndex];
  const confirmed = window.confirm("Remove this tab from the workspace? The browser tab itself will not be closed and Recovery Journal will include recovery.");

  if (!confirmed) {
    setStatus("Remove cancelled. No action was taken.");
    return;
  }

  const reason = window.prompt("Reason for removing this tab from the workspace? This will be recorded in the System Journal and Recovery Journal.\n\nTab: " + getTabName(tab), "");

  if (reason === null) {
    setStatus("Remove cancelled. No action was taken.");
    return;
  }

  const tabSnapshot = createTabSnapshot(tab, workspace);
  workspace.tabs.splice(tabIndex, 1);
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  await addTimelineEvent("workspace_tab_removed", "Removed " + snapshotName(tabSnapshot) + " from workspace.", {
    reason: reason.trim() || "No reason recorded.",
    tabSnapshot,
    workspaceTabId: tabSnapshot.workspaceTabId,
    recoveryActions: {
      canReopenUrl: true,
      canReaddToWorkspace: true
    }
  });
  setStatus("Removed " + snapshotName(tabSnapshot) + " from workspace. Recovery is available from Recovery Journal.");
  await renderWorkspace();
}

async function refreshWorkspaceTabMetadata() {
  const workspace = await getWorkspace();
  await ensureWorkspaceTabIds(workspace);
  const resolution = await resolveWorkspaceTabsToLiveTabs(workspace);
  const foundResults = resolution.results.filter((result) => result.liveTab);
  const missingResults = resolution.results.filter((result) => !result.liveTab);

  foundResults.forEach((result) => {
    updateWorkspaceTabFromBrowserTab(result.workspaceTab, result.liveTab, {
      isOpen: true,
      lastSeenAt: new Date().toISOString(),
      lastMatchStatus: result.matchStatus
    });
  });

  missingResults.forEach((result) => {
    result.workspaceTab.isOpen = false;
    result.workspaceTab.lastMatchStatus = result.matchStatus;
  });

  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  await addTimelineEvent("workspace_tabs_refreshed", "Refreshed metadata for " + foundResults.length + " workspace tab(s). " + missingResults.length + " tab(s) were not found or were ambiguous in the browser.", {
    resolutionMode: "stable_one_to_one",
    foundCount: foundResults.length,
    missingCount: missingResults.length,
    resolutionResults: summarizeResolutionResults(resolution.results)
  });
  setStatus("Refreshed metadata for " + foundResults.length + " workspace tab(s). " + missingResults.length + " tab(s) were not found or were ambiguous.");
  await renderWorkspace();
}

async function refreshTabStatus() {
  const workspace = await getWorkspace();
  const resolution = await resolveWorkspaceTabsToLiveTabs(workspace);
  const status = calculateStableTabStatus(workspace, resolution.results);
  renderTabStatus(status);
  await addTimelineEvent("workspace_tab_status_refreshed", "Tab status refreshed: " + status.openTabs + " open, " + status.missingTabs + " missing or ambiguous, " + status.groupedTabs + " grouped, " + status.ungroupedTabs + " ungrouped, " + status.unassignedTabs + " unassigned.", {
    resolutionMode: "stable_one_to_one",
    resolutionResults: summarizeResolutionResults(resolution.results)
  });
  setStatus("Tab status refreshed: " + status.openTabs + " open, " + status.missingTabs + " missing or ambiguous, " + status.groupedTabs + " grouped.");
}

async function clearWorkspaceTabs() {
  const workspace = await getWorkspace();

  if (!workspace.tabs.length) {
    setStatus("Workspace tabs are already clear.");
    return;
  }

  const confirmed = window.confirm("Clear all workspace tab records? Browser tabs will remain open, but workspace tab cards will be removed.");

  if (!confirmed) {
    setStatus("Clear workspace tabs cancelled.");
    return;
  }

  const clearedCount = workspace.tabs.length;
  workspace.tabs = [];
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  await addTimelineEvent("workspace_tabs_cleared", "Cleared " + clearedCount + " tab(s) from workspace.");
  setStatus("Cleared " + clearedCount + " tab(s) from workspace.");
  await renderWorkspace();
}

async function createChromeTabGroupsFromWorkspace() {
  const workspace = await getWorkspace();
  await ensureWorkspaceTabIds(workspace);
  const resolution = await resolveWorkspaceTabsToLiveTabs(workspace);
  const liveResults = resolution.results.filter((result) => result.liveTab);
  const skippedResults = resolution.results.filter((result) => !result.liveTab);

  if (!liveResults.length) {
    await addTimelineEvent("chrome_tab_grouping_skipped", "No open workspace tabs were found for native Chrome grouping.", {
      resolutionMode: "stable_one_to_one",
      skippedCount: skippedResults.length,
      resolutionResults: summarizeResolutionResults(resolution.results)
    });
    setStatus("No open workspace tabs were found for grouping.");
    return;
  }

  const groupRequests = buildRoleWindowGroupRequests(workspace, liveResults);
  const createdGroupDetails = [];

  try {
    for (const request of groupRequests) {
      const groupId = await chrome.tabs.group({ tabIds: request.tabIds });
      await chrome.tabGroups.update(groupId, {
        title: createChromeGroupTitle(workspace, request.roleLabel)
      });

      request.items.forEach((item) => {
        updateWorkspaceTabFromBrowserTab(item.workspaceTab, item.liveTab, {
          groupId,
          isOpen: true,
          lastSeenAt: new Date().toISOString(),
          lastMatchStatus: item.matchStatus
        });
      });

      createdGroupDetails.push({
        groupId,
        roleId: request.roleId,
        roleLabel: request.roleLabel,
        windowId: request.windowId,
        tabIds: request.tabIds,
        workspaceTabIds: request.items.map((item) => item.workspaceTab.workspaceTabId)
      });
    }

    skippedResults.forEach((result) => {
      result.workspaceTab.isOpen = false;
      result.workspaceTab.lastMatchStatus = result.matchStatus;
    });

    workspace.updatedAt = new Date().toISOString();
    await saveWorkspace(workspace);

    await addTimelineEvent("chrome_tab_groups_created", "Created " + createdGroupDetails.length + " native Chrome tab group(s) from " + liveResults.length + " open workspace tab(s). Skipped " + skippedResults.length + " missing or ambiguous tab(s).", {
      resolutionMode: "stable_one_to_one",
      groupedTabCount: liveResults.length,
      skippedCount: skippedResults.length,
      groups: createdGroupDetails,
      skippedResolutionResults: summarizeResolutionResults(skippedResults),
      resolutionResults: summarizeResolutionResults(resolution.results)
    });
    setStatus("Created " + createdGroupDetails.length + " native Chrome tab group(s) from " + liveResults.length + " open workspace tab(s).");
    await renderWorkspace();
  } catch (error) {
    await addTimelineEvent("chrome_tab_grouping_failed", "Native Chrome grouping failed: " + (error.message || "Unknown error") + ".", {
      resolutionMode: "stable_one_to_one",
      error: summarizeError(error)
    });
    setStatus("Could not create Chrome tab groups. Check Developer Diagnostics.");
  }
}

async function removeAllChromeTabGroupsForWorkspace() {
  const workspace = await getWorkspace();
  const resolution = await resolveWorkspaceTabsToLiveTabs(workspace);
  const liveResults = resolution.results.filter((result) => result.liveTab && isValidChromeGroupId(result.liveTab.groupId));

  if (!liveResults.length) {
    await addTimelineEvent("chrome_tab_groups_remove_skipped", "No native Chrome tab groups were found for this workspace.", {
      resolutionMode: "stable_one_to_one"
    });
    setStatus("No native Chrome tab groups found for this workspace.");
    return;
  }

  const tabIds = Array.from(new Set(liveResults.map((result) => result.liveTab.id)));
  const groupIds = Array.from(new Set(liveResults.map((result) => result.liveTab.groupId)));
  await chrome.tabs.ungroup(tabIds);

  workspace.tabs.forEach((tab) => {
    if (liveResults.some((result) => result.workspaceTab.workspaceTabId === tab.workspaceTabId)) {
      tab.groupId = -1;
    }
  });
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);

  await addTimelineEvent("chrome_tab_groups_removed", "Removed " + groupIds.length + " native Chrome tab group(s) for this workspace. Kept " + tabIds.length + " browser tab(s) open.", {
    resolutionMode: "stable_one_to_one",
    groupIds,
    tabIds,
    recoveryActions: {
      canRecreateChromeGroups: true
    }
  });
  setStatus("Removed " + groupIds.length + " native Chrome tab group(s). Browser tabs remain open.");
  await renderWorkspace();
}

async function removeChromeTabGroupForRole(roleId, roleLabel) {
  const workspace = await getWorkspace();
  const resolution = await resolveWorkspaceTabsToLiveTabs(workspace);
  const roleResults = resolution.results.filter((result) =>
    result.liveTab &&
    isValidChromeGroupId(result.liveTab.groupId) &&
    (result.workspaceTab.role || "unassigned") === roleId
  );

  if (!roleResults.length) {
    await addTimelineEvent("chrome_tab_group_remove_skipped", "No native Chrome tab group was found for " + roleLabel + ".", {
      roleId,
      roleLabel,
      resolutionMode: "stable_one_to_one"
    });
    setStatus("No native Chrome group found for " + roleLabel + ".");
    return;
  }

  const tabIds = Array.from(new Set(roleResults.map((result) => result.liveTab.id)));
  await chrome.tabs.ungroup(tabIds);

  workspace.tabs.forEach((tab) => {
    if (roleResults.some((result) => result.workspaceTab.workspaceTabId === tab.workspaceTabId)) {
      tab.groupId = -1;
    }
  });
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);

  await addTimelineEvent("chrome_tab_group_removed", "Removed native Chrome tab group for " + roleLabel + ". Kept " + tabIds.length + " browser tab(s) open.", {
    roleId,
    roleLabel,
    tabIds,
    resolutionMode: "stable_one_to_one",
    recoveryActions: {
      canRecreateChromeGroups: true
    }
  });
  setStatus("Removed native Chrome group for " + roleLabel + ".");
  await renderWorkspace();
}

async function focusChromeGroupForRole(roleId, roleLabel) {
  const workspace = await getWorkspace();
  const resolution = await resolveWorkspaceTabsToLiveTabs(workspace);
  const roleResults = resolution.results.filter((result) =>
    result.liveTab &&
    (result.workspaceTab.role || "unassigned") === roleId
  );

  if (!roleResults.length) {
    await addTimelineEvent("chrome_tab_group_focus_skipped", "Could not focus " + roleLabel + " because no open workspace tabs were found for that role.", {
      roleId,
      roleLabel,
      resolutionMode: "stable_one_to_one"
    });
    setStatus("No open workspace tabs found for " + roleLabel + ".");
    return;
  }

  roleResults.sort(compareLiveTabResults);
  const grouped = roleResults.filter((result) => isValidChromeGroupId(result.liveTab.groupId));
  const target = grouped[0] || roleResults[0];

  await chrome.windows.update(target.liveTab.windowId, { focused: true });
  await chrome.tabs.update(target.liveTab.id, { active: true });
  await addTimelineEvent("chrome_tab_group_focused", "Focused " + roleLabel + " group using tab: " + getTabName(target.workspaceTab) + ".", {
    roleId,
    roleLabel,
    workspaceTabId: target.workspaceTab.workspaceTabId,
    tabId: target.liveTab.id,
    matchStatus: target.matchStatus
  });
  setStatus("Focused " + roleLabel + " group.");
}

async function addUserJournalEntry() {
  const text = journalEntryInput.value.trim();

  if (!text) {
    setStatus("Write a journal entry first.");
    return;
  }

  const workspace = await getWorkspace();
  const relatedRoleId = journalRelatedRoleSelect.value || "";
  const relatedRoleLabel = relatedRoleId ? getWorkspaceRoleLabel(workspace.workspaceType || DEFAULT_WORKSPACE_TYPE, relatedRoleId) : "";

  await addJournalEntry(text, {
    tag: journalTagInput.value.trim(),
    relatedRoleId,
    relatedRoleLabel
  });
  await addTimelineEvent("user_journal_added", "User journal entry added.");

  journalEntryInput.value = "";
  journalTagInput.value = "";
  journalRelatedRoleSelect.value = "";
  setStatus("User journal entry added.");
  await renderWorkspace();
}

function renderJournalRelatedRoleOptions(workspace) {
  if (!journalRelatedRoleSelect) {
    return;
  }

  const selected = journalRelatedRoleSelect.value;
  clearElement(journalRelatedRoleSelect);

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "No related group";
  journalRelatedRoleSelect.appendChild(emptyOption);

  getWorkspaceRoles(workspace.workspaceType || DEFAULT_WORKSPACE_TYPE).forEach((role) => {
    const option = document.createElement("option");
    option.value = role.id;
    option.textContent = role.label;
    journalRelatedRoleSelect.appendChild(option);
  });

  if (selected) {
    journalRelatedRoleSelect.value = selected;
  }
}

function renderUserJournal(workspace) {
  if (!journalList) {
    return;
  }

  clearElement(journalList);

  if (!workspace.journal.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No user journal entries yet.";
    journalList.appendChild(empty);
    return;
  }

  [...workspace.journal].reverse().forEach((entry) => {
    const card = document.createElement("article");
    card.className = "journal-card";

    const meta = document.createElement("p");
    meta.className = "journal-meta";
    meta.textContent = entry.createdAt + (entry.tag ? " | " + entry.tag : "") + (entry.relatedRoleLabel ? " | " + entry.relatedRoleLabel : "");
    card.appendChild(meta);

    const text = document.createElement("p");
    text.textContent = entry.text;
    card.appendChild(text);

    journalList.appendChild(card);
  });
}

function renderRecoveryJournal(workspace) {
  if (!recoveryList) {
    return;
  }

  clearElement(recoveryList);
  const recoverableEvents = workspace.timeline.filter((event) => event.recoveryActions);

  if (!recoverableEvents.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No recovery actions available.";
    recoveryList.appendChild(empty);
    return;
  }

  [...recoverableEvents].reverse().forEach((event) => {
    const card = createTimelineCard(event, true);
    recoveryList.appendChild(card);
  });
}

function renderSystemTimeline(workspace) {
  if (!systemTimelineList) {
    return;
  }

  clearElement(systemTimelineList);

  if (!workspace.timeline.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No system events yet.";
    systemTimelineList.appendChild(empty);
    return;
  }

  [...workspace.timeline].reverse().forEach((event) => {
    systemTimelineList.appendChild(createTimelineCard(event, false));
  });
}

function createTimelineCard(event, includeRecoveryActions) {
  const card = document.createElement("article");
  card.className = "timeline-card";

  const header = document.createElement("p");
  header.className = "timeline-meta";
  header.textContent = event.createdAt + " | " + event.type;
  card.appendChild(header);

  const message = document.createElement("p");
  message.textContent = event.message || "";
  card.appendChild(message);

  if (event.reason) {
    const reason = document.createElement("p");
    reason.className = "timeline-reason";
    reason.textContent = "Reason: " + event.reason;
    card.appendChild(reason);
  }

  if (event.tabSnapshot) {
    const snapshot = document.createElement("p");
    snapshot.className = "timeline-snapshot";
    snapshot.textContent = "Snapshot: " + snapshotName(event.tabSnapshot) + " | " + (event.tabSnapshot.displayUrl || createDisplayUrl(event.tabSnapshot.url || ""));
    card.appendChild(snapshot);
  }

  if (includeRecoveryActions && event.recoveryActions) {
    const actions = document.createElement("div");
    actions.className = "timeline-recovery-actions";

    if (event.recoveryActions.canReopenUrl) {
      actions.appendChild(createRecoveryButton("Reopen URL", "timeline-reopen-url-button secondary-button", event.eventId, reopenUrlFromTimeline));
    }

    if (event.recoveryActions.canReaddToWorkspace) {
      actions.appendChild(createRecoveryButton("Re-add to Workspace", "timeline-readd-workspace-button secondary-button", event.eventId, readdWorkspaceTabFromTimeline));
    }

    if (event.recoveryActions.canRecreateChromeGroups) {
      actions.appendChild(createRecoveryButton("Recreate Chrome Groups", "timeline-recreate-chrome-groups-button secondary-button", event.eventId, recreateChromeGroupsFromTimeline));
    }

    card.appendChild(actions);
  }

  return card;
}

async function reopenUrlFromTimeline(eventId) {
  const workspace = await getWorkspace();
  const event = workspace.timeline.find((item) => item.eventId === eventId);

  if (!event?.tabSnapshot?.url) {
    setStatus("No saved URL found for this recovery event.");
    return;
  }

  const createdTab = await chrome.tabs.create({ url: event.tabSnapshot.url, active: true });
  const browserTab = createBrowserTabSnapshotWithFallback(createdTab, event.tabSnapshot);
  const existing = findExistingWorkspaceTab(workspace, event.tabSnapshot);

  if (existing) {
    updateWorkspaceTabFromBrowserTab(existing, browserTab, {
      isOpen: true,
      lastOpenedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    });
    workspace.updatedAt = new Date().toISOString();
    await saveWorkspace(workspace);
  }

  await addTimelineEvent("timeline_url_reopened", "Reopened URL from Recovery View: " + snapshotName(event.tabSnapshot) + ".", {
    recoverySourceEventId: eventId,
    workspaceTabId: event.tabSnapshot.workspaceTabId || "",
    tabId: browserTab.id,
    url: browserTab.url
  });
  setStatus("Reopened URL: " + snapshotName(event.tabSnapshot) + ".");
  await renderWorkspace();
}

async function readdWorkspaceTabFromTimeline(eventId) {
  const workspace = await getWorkspace();
  const event = workspace.timeline.find((item) => item.eventId === eventId);

  if (!event?.tabSnapshot) {
    setStatus("Could not find a saved tab snapshot for this recovery event.");
    return;
  }

  const tabSnapshot = event.tabSnapshot;
  const wasClosedTabEvent = event.type === "browser_tab_closed_and_removed";
  const existing = findExistingWorkspaceTab(workspace, tabSnapshot);
  const restoredTabRecord = existing || createWorkspaceTabFromSnapshot(tabSnapshot);
  let browserTabReopened = false;
  let browserTabAlreadyOpen = false;
  let restoreMode = wasClosedTabEvent ? "readd_and_reopen_closed_tab" : "readd_workspace_record";

  if (wasClosedTabEvent) {
    const liveExisting = existing ? await resolveSingleWorkspaceTabForAction(existing) : { liveTab: null, matchStatus: "no_existing_record" };

    if (liveExisting.liveTab) {
      browserTabAlreadyOpen = true;
      updateWorkspaceTabFromBrowserTab(restoredTabRecord, liveExisting.liveTab, {
        isOpen: true,
        lastSeenAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString()
      });
      restoreMode = existing ? "existing_record_already_open" : restoreMode;
    } else if (tabSnapshot.url) {
      const createdTab = await chrome.tabs.create({ url: tabSnapshot.url, active: true });
      const browserTab = createBrowserTabSnapshotWithFallback(createdTab, tabSnapshot);
      updateWorkspaceTabFromBrowserTab(restoredTabRecord, browserTab, {
        isOpen: true,
        lastSeenAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString()
      });
      browserTabReopened = true;
    }
  } else {
    const liveTab = await resolveSingleWorkspaceTabForAction(restoredTabRecord);

    if (liveTab.liveTab) {
      browserTabAlreadyOpen = true;
      updateWorkspaceTabFromBrowserTab(restoredTabRecord, liveTab.liveTab, {
        isOpen: true,
        lastSeenAt: new Date().toISOString()
      });
    }
  }

  if (!restoredTabRecord.workspaceTabId) {
    restoredTabRecord.workspaceTabId = crypto.randomUUID();
  }

  if (existing) {
    Object.assign(existing, restoredTabRecord);
  } else {
    workspace.tabs.push(restoredTabRecord);
  }

  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);

  const message = buildRecoveryReaddMessage(tabSnapshot, {
    existing: Boolean(existing),
    browserTabReopened,
    browserTabAlreadyOpen,
    wasClosedTabEvent
  });

  await addTimelineEvent("workspace_tab_readded", message, {
    tabSnapshot: createTabSnapshot(restoredTabRecord, workspace),
    recoverySourceEventId: eventId,
    workspaceTabId: restoredTabRecord.workspaceTabId,
    browserTabReopened,
    browserTabAlreadyOpen,
    restoredExistingWorkspaceRecord: Boolean(existing),
    restoreMode
  });
  setStatus(message);
  await renderWorkspace();
}

async function recreateChromeGroupsFromTimeline(eventId) {
  await addTimelineEvent("timeline_chrome_groups_recreate_requested", "Requested Chrome tab group recreation from Recovery View.", {
    recoverySourceEventId: eventId
  });
  await createChromeTabGroupsFromWorkspace();
}

function buildRecoveryReaddMessage(tabSnapshot, result) {
  const name = snapshotName(tabSnapshot);

  if (result.browserTabReopened) {
    return "Re-added " + name + " to workspace and reopened the browser tab from Recovery View.";
  }

  if (result.browserTabAlreadyOpen && result.existing) {
    return name + " was already in the workspace and already open in the browser.";
  }

  if (result.existing) {
    return name + " was already in the workspace. The saved record was refreshed from Recovery View.";
  }

  if (result.wasClosedTabEvent) {
    return "Re-added " + name + " to workspace from Recovery View. Browser tab could not be reopened because no URL was saved.";
  }

  return "Re-added " + name + " to workspace from Recovery View.";
}

async function migrateWorkspaceTabIds() {
  const workspace = await getWorkspace();
  await ensureWorkspaceTabIds(workspace);
}

async function ensureWorkspaceTabIds(workspace) {
  let changed = false;

  workspace.tabs.forEach((tab) => {
    if (!tab.workspaceTabId) {
      tab.workspaceTabId = crypto.randomUUID();
      changed = true;
    }
  });

  if (changed) {
    workspace.updatedAt = new Date().toISOString();
    await saveWorkspace(workspace);
  }
}

async function resolveWorkspaceTabsToLiveTabs(workspace) {
  const browserTabs = await getAllBrowserTabs();
  const consumedLiveTabIds = new Set();
  const results = [];

  workspace.tabs.forEach((workspaceTab) => {
    if (!workspaceTab.workspaceTabId) {
      workspaceTab.workspaceTabId = crypto.randomUUID();
    }

    const result = resolveWorkspaceTabAgainstBrowserTabs(workspaceTab, browserTabs, consumedLiveTabIds);

    if (result.liveTab) {
      consumedLiveTabIds.add(result.liveTab.id);
    }

    results.push(result);
  });

  return {
    browserTabs,
    results
  };
}

async function resolveSingleWorkspaceTabForAction(workspaceTab) {
  const browserTabs = await getAllBrowserTabs();
  return resolveWorkspaceTabAgainstBrowserTabs(workspaceTab, browserTabs, new Set());
}

function resolveWorkspaceTabAgainstBrowserTabs(workspaceTab, browserTabs, consumedLiveTabIds) {
  if (Number.isInteger(workspaceTab.tabId)) {
    const exactTab = browserTabs.find((tab) => tab.id === workspaceTab.tabId);

    if (exactTab && !consumedLiveTabIds.has(exactTab.id)) {
      return createResolutionResult(workspaceTab, exactTab, "exact_tab_id", 1);
    }

    if (exactTab && consumedLiveTabIds.has(exactTab.id)) {
      const unconsumedUrlMatches = findUnconsumedUrlMatches(workspaceTab, browserTabs, consumedLiveTabIds);

      if (unconsumedUrlMatches.length === 1) {
        return createResolutionResult(workspaceTab, unconsumedUrlMatches[0], "exact_tab_id_consumed_single_url_repair", 1);
      }

      return createResolutionResult(workspaceTab, null, "exact_tab_id_consumed", unconsumedUrlMatches.length);
    }
  }

  const urlMatches = findUnconsumedUrlMatches(workspaceTab, browserTabs, consumedLiveTabIds);

  if (urlMatches.length === 1) {
    return createResolutionResult(workspaceTab, urlMatches[0], "single_url_fallback", 1);
  }

  if (urlMatches.length > 1) {
    return createResolutionResult(workspaceTab, null, "ambiguous_url_matches", urlMatches.length);
  }

  const tabKeyMatches = browserTabs.filter((tab) =>
    !consumedLiveTabIds.has(tab.id) && workspaceTab.tabKey && tab.tabKey === workspaceTab.tabKey
  );

  if (tabKeyMatches.length === 1) {
    return createResolutionResult(workspaceTab, tabKeyMatches[0], "single_tab_key_fallback", 1);
  }

  if (tabKeyMatches.length > 1) {
    return createResolutionResult(workspaceTab, null, "ambiguous_tab_key_matches", tabKeyMatches.length);
  }

  return createResolutionResult(workspaceTab, null, "not_found", 0);
}

function findUnconsumedUrlMatches(workspaceTab, browserTabs, consumedLiveTabIds) {
  return browserTabs.filter((tab) =>
    !consumedLiveTabIds.has(tab.id) && workspaceTab.url && tab.url === workspaceTab.url
  );
}

function createResolutionResult(workspaceTab, liveTab, matchStatus, candidateCount) {
  return {
    workspaceTab,
    liveTab,
    matchStatus,
    candidateCount
  };
}

function summarizeResolutionResults(results) {
  return results.map((result) => ({
    workspaceTabId: result.workspaceTab.workspaceTabId || "",
    alias: result.workspaceTab.alias || "",
    role: result.workspaceTab.role || "unassigned",
    savedTabId: result.workspaceTab.tabId ?? null,
    savedUrl: result.workspaceTab.url || "",
    liveTabId: result.liveTab?.id ?? null,
    liveWindowId: result.liveTab?.windowId ?? null,
    liveGroupId: result.liveTab?.groupId ?? null,
    matchStatus: result.matchStatus,
    candidateCount: result.candidateCount
  }));
}

function buildRoleWindowGroupRequests(workspace, liveResults) {
  const groups = new Map();

  liveResults.forEach((result) => {
    const roleId = result.workspaceTab.role || "unassigned";
    const roleLabel = getWorkspaceRoleLabel(workspace.workspaceType || DEFAULT_WORKSPACE_TYPE, roleId);
    const windowId = result.liveTab.windowId;
    const key = roleId + "::" + windowId;

    if (!groups.has(key)) {
      groups.set(key, {
        roleId,
        roleLabel,
        windowId,
        items: []
      });
    }

    groups.get(key).items.push(result);
  });

  return Array.from(groups.values()).map((group) => ({
    ...group,
    tabIds: group.items.map((item) => item.liveTab.id)
  }));
}

function calculateStableTabStatus(workspace, results) {
  const openResults = results.filter((result) => result.liveTab);
  const groupedResults = openResults.filter((result) => isValidChromeGroupId(result.liveTab.groupId));

  return {
    totalTabs: workspace.tabs.length,
    openTabs: openResults.length,
    missingTabs: Math.max(workspace.tabs.length - openResults.length, 0),
    groupedTabs: groupedResults.length,
    ungroupedTabs: Math.max(openResults.length - groupedResults.length, 0),
    unassignedTabs: workspace.tabs.filter((tab) => (tab.role || "unassigned") === "unassigned").length
  };
}

function renderTabStatus(status) {
  setElementText("statusTotalTabs", status.totalTabs);
  setElementText("statusOpenTabs", status.openTabs);
  setElementText("statusMissingTabs", status.missingTabs);
  setElementText("statusGroupedTabs", status.groupedTabs);
  setElementText("statusUngroupedTabs", status.ungroupedTabs);
  setElementText("statusUnassignedTabs", status.unassignedTabs);
}

function createTabRoleGroups(workspace) {
  const workspaceType = workspace.workspaceType || DEFAULT_WORKSPACE_TYPE;
  const roles = getWorkspaceRoles(workspaceType);
  const roleGroups = roles.map((role) => ({
    roleId: role.id,
    label: role.label,
    tabs: [],
    isLegacy: false
  }));
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
        roleId,
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

function createWorkspaceTab(tab) {
  const now = new Date().toISOString();
  return {
    workspaceTabId: crypto.randomUUID(),
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
    workspaceTabId: tabSnapshot.workspaceTabId || crypto.randomUUID(),
    tabId: tabSnapshot.tabId,
    tabKey: tabSnapshot.tabKey,
    windowId: tabSnapshot.windowId,
    groupId: tabSnapshot.groupId,
    url: tabSnapshot.url,
    displayUrl: tabSnapshot.displayUrl || createDisplayUrl(tabSnapshot.url || ""),
    originalTitle: tabSnapshot.originalTitle,
    alias: tabSnapshot.alias || "",
    role: tabSnapshot.role || "unassigned",
    isOpen: tabSnapshot.isOpen !== false,
    firstSeenAt: tabSnapshot.firstSeenAt || now,
    lastSeenAt: now,
    recoveredAt: now
  };
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

function createBrowserTabSnapshotWithFallback(tab, fallback = {}) {
  const title = tab.title || fallback.originalTitle || fallback.title || "";
  const url = tab.url || fallback.url || "";

  return {
    id: tab.id,
    tabKey: url + "::" + title,
    windowId: tab.windowId,
    groupId: tab.groupId,
    index: tab.index,
    title,
    url,
    active: tab.active,
    pinned: tab.pinned
  };
}

function updateWorkspaceTabFromBrowserTab(workspaceTab, browserTab, extraFields = {}) {
  Object.assign(workspaceTab, {
    ...workspaceTab,
    tabId: browserTab.id,
    tabKey: browserTab.tabKey,
    windowId: browserTab.windowId,
    groupId: browserTab.groupId,
    url: browserTab.url,
    displayUrl: createDisplayUrl(browserTab.url || ""),
    originalTitle: browserTab.title || workspaceTab.originalTitle,
    ...extraFields
  });
}

function findWorkspaceTabById(workspace, workspaceTabId) {
  return workspace.tabs.find((tab) => tab.workspaceTabId === workspaceTabId);
}

function findExistingWorkspaceTab(workspace, tabSnapshot) {
  if (tabSnapshot.workspaceTabId) {
    const byWorkspaceTabId = workspace.tabs.find((tab) => tab.workspaceTabId === tabSnapshot.workspaceTabId);

    if (byWorkspaceTabId) {
      return byWorkspaceTabId;
    }
  }

  if (Number.isInteger(tabSnapshot.tabId)) {
    const byTabId = workspace.tabs.find((tab) => tab.tabId === tabSnapshot.tabId);

    if (byTabId) {
      return byTabId;
    }
  }

  return null;
}

function findExactWorkspaceTabMatch(workspace, browserTab) {
  return workspace.tabs.find((workspaceTab) =>
    Number.isInteger(browserTab.id) && workspaceTab.tabId === browserTab.id
  );
}

function findSameUrlWorkspaceTabMatch(workspace, browserTab) {
  return workspace.tabs.find((workspaceTab) =>
    workspaceTab.url && browserTab.url && workspaceTab.url === browserTab.url && workspaceTab.tabId !== browserTab.id
  );
}

function createChromeGroupTitle(workspace, roleLabel) {
  const role = roleLabel || "Unassigned";
  const suffix = " · " + getWorkspaceGroupToken(workspace);
  const maxLength = 32;
  const availableRoleLength = maxLength - suffix.length;

  if (availableRoleLength <= 3) {
    return (role + suffix).slice(0, maxLength - 3) + "...";
  }

  const trimmedRole = role.length <= availableRoleLength ? role : role.slice(0, availableRoleLength - 3) + "...";
  return trimmedRole + suffix;
}

function getWorkspaceGroupToken(workspace) {
  const rawName = (workspace.name || "").trim();

  if (!rawName) {
    return "CF";
  }

  const words = rawName.split(/\s+/).filter(Boolean);
  const initials = words
    .map((word) => word.replace(/[^a-zA-Z0-9]/g, ""))
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

  if (initials) {
    return initials.slice(0, 4);
  }

  const compactName = rawName.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return compactName ? compactName.slice(0, 4) : "CF";
}

function getTabName(tab) {
  return tab.alias || tab.originalTitle || tab.displayUrl || "Untitled tab";
}

function snapshotName(tabSnapshot) {
  return tabSnapshot.alias || tabSnapshot.originalTitle || tabSnapshot.displayUrl || "Untitled tab";
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

function createBadge(text, extraClassName) {
  const badge = document.createElement("span");
  badge.className = "badge " + extraClassName;
  badge.textContent = text;
  return badge;
}

function createTabActionButton(text, className, workspaceTabId, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.dataset.workspaceTabId = workspaceTabId || "";
  button.textContent = text;
  button.addEventListener("click", () => handler(workspaceTabId));
  return button;
}

function createRoleActionButton(text, className, roleId, roleLabel, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.dataset.roleId = roleId;
  button.dataset.roleLabel = roleLabel;
  button.textContent = text;
  button.addEventListener("click", () => handler(roleId, roleLabel));
  return button;
}

function createRecoveryButton(text, className, eventId, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.dataset.eventId = eventId;
  button.textContent = text;
  button.addEventListener("click", () => handler(eventId));
  return button;
}

function compareLiveTabResults(left, right) {
  if (left.liveTab.windowId !== right.liveTab.windowId) {
    return left.liveTab.windowId - right.liveTab.windowId;
  }

  return left.liveTab.index - right.liveTab.index;
}

function isValidChromeGroupId(groupId) {
  return Number.isInteger(groupId) && groupId >= 0;
}

function setElementText(id, value) {
  const element = document.getElementById(id);

  if (element) {
    element.textContent = String(value);
  }
}

function setStatus(message) {
  if (intakeStatus) {
    intakeStatus.textContent = message;
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
