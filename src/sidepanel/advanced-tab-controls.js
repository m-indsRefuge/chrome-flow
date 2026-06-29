import {
  DEFAULT_WORKSPACE_TYPE,
  getWorkspaceRoleLabel,
  getWorkspaceRoles
} from "../core/workspace-role-sets.js";

const WORKSPACE_KEY = "chromeFlowWorkspace";
const DIAGNOSTICS_KEY = "chromeFlowDiagnostics";
const MAX_DIAGNOSTICS = 200;

installAdvancedTabControls();

async function installAdvancedTabControls() {
  renderAdvancedTabControls();
  attachAdvancedTabControlHandlers();
  await renderDuplicateUrlReview();
}

function renderAdvancedTabControls() {
  const existing = document.getElementById("advancedTabControlsSection");

  if (existing) {
    return;
  }

  const tabsSection = document.querySelector(".tabs-section");

  if (!tabsSection) {
    return;
  }

  const section = document.createElement("section");
  section.id = "advancedTabControlsSection";
  section.className = "advanced-tab-controls-section";

  const heading = document.createElement("h2");
  heading.textContent = "Advanced Tab Controls";
  section.appendChild(heading);

  const help = document.createElement("p");
  help.className = "section-help";
  help.textContent = "Deterministic workspace tab operations for group collapse/expand, new-window workspace organisation, role ordering, missing-tab recovery, URL export, and duplicate URL review.";
  section.appendChild(help);

  const actions = document.createElement("div");
  actions.className = "advanced-tab-actions-grid";

  actions.appendChild(createButton("collapseWorkspaceGroupsButton", "Collapse Workspace Chrome Groups", "secondary-button"));
  actions.appendChild(createButton("expandWorkspaceGroupsButton", "Expand Workspace Chrome Groups", "secondary-button"));
  actions.appendChild(createButton("moveWorkspaceTabsToNewWindowButton", "Move Workspace Into New Window", "secondary-button"));
  actions.appendChild(createButton("arrangeWorkspaceTabsByRoleButton", "Arrange Tabs by Role Order", "secondary-button"));
  actions.appendChild(createButton("reopenMissingWorkspaceTabsButton", "Reopen All Missing Tabs", "secondary-button"));
  actions.appendChild(createButton("copyWorkspaceUrlListButton", "Copy Workspace URL List", "secondary-button"));
  actions.appendChild(createButton("refreshDuplicateUrlReviewButton", "Refresh Duplicate URL Review", "secondary-button"));

  section.appendChild(actions);

  const status = document.createElement("p");
  status.id = "advancedTabControlsStatus";
  status.className = "status-message";
  section.appendChild(status);

  const newWindowNote = document.createElement("p");
  newWindowNote.className = "section-help advanced-tab-note";
  newWindowNote.textContent = "Move Workspace Into New Window now recreates workspace Chrome groups in the new window so role grouping is preserved after the move.";
  section.appendChild(newWindowNote);

  const missingNote = document.createElement("p");
  missingNote.className = "section-help advanced-tab-note";
  missingNote.textContent = "Missing tabs are workspace records whose live browser tab is gone. Tabs closed through Chrome Flow are removed from the workspace and restored from Recovery Journal instead.";
  section.appendChild(missingNote);

  const duplicatePanel = document.createElement("div");
  duplicatePanel.id = "duplicateUrlReviewPanel";
  duplicatePanel.className = "duplicate-url-review-panel";

  const duplicateHeading = document.createElement("h3");
  duplicateHeading.textContent = "Duplicate URL Review";
  duplicatePanel.appendChild(duplicateHeading);

  const duplicateHelp = document.createElement("p");
  duplicateHelp.className = "section-help";
  duplicateHelp.textContent = "Same-URL workspace records are allowed. This review surface makes them visible so the Operator can keep, alias, focus, or remove them deliberately.";
  duplicatePanel.appendChild(duplicateHelp);

  const duplicateList = document.createElement("div");
  duplicateList.id = "duplicateUrlReviewList";
  duplicatePanel.appendChild(duplicateList);

  section.appendChild(duplicatePanel);
  tabsSection.insertAdjacentElement("afterend", section);
}

function attachAdvancedTabControlHandlers() {
  document.getElementById("collapseWorkspaceGroupsButton")?.addEventListener("click", () => setWorkspaceChromeGroupsCollapsed(true));
  document.getElementById("expandWorkspaceGroupsButton")?.addEventListener("click", () => setWorkspaceChromeGroupsCollapsed(false));
  document.getElementById("moveWorkspaceTabsToNewWindowButton")?.addEventListener("click", moveWorkspaceTabsIntoNewWindow);
  document.getElementById("arrangeWorkspaceTabsByRoleButton")?.addEventListener("click", arrangeWorkspaceTabsByRoleOrder);
  document.getElementById("reopenMissingWorkspaceTabsButton")?.addEventListener("click", reopenAllMissingWorkspaceTabs);
  document.getElementById("copyWorkspaceUrlListButton")?.addEventListener("click", copyWorkspaceUrlList);
  document.getElementById("refreshDuplicateUrlReviewButton")?.addEventListener("click", renderDuplicateUrlReview);
}

async function setWorkspaceChromeGroupsCollapsed(collapsed) {
  const workspace = await getWorkspace();
  const resolution = await resolveWorkspaceTabsToLiveTabs(workspace);
  const groupIds = unique(
    resolution.results
      .filter((result) => result.liveTab && isValidChromeGroupId(result.liveTab.groupId))
      .map((result) => result.liveTab.groupId)
  );

  if (!groupIds.length) {
    await addTimelineEvent(workspace, "chrome_tab_groups_collapse_skipped", "No native Chrome tab groups were found for this workspace.", {
      collapsed,
      resolutionMode: "stable_one_to_one"
    });
    await recordDiagnostic("warn", "workspace_chrome_groups_collapse_skipped", "No workspace Chrome groups were found to collapse or expand.", {
      collapsed
    });
    setStatus("No native Chrome tab groups found for this workspace.");
    return;
  }

  for (const groupId of groupIds) {
    await chrome.tabGroups.update(groupId, { collapsed });
  }

  const eventType = collapsed ? "chrome_tab_groups_collapsed" : "chrome_tab_groups_expanded";
  const actionText = collapsed ? "Collapsed" : "Expanded";

  await addTimelineEvent(workspace, eventType, actionText + " " + groupIds.length + " native Chrome tab group(s) for this workspace.", {
    groupIds,
    collapsed,
    resolutionMode: "stable_one_to_one"
  });
  await recordDiagnostic("info", eventType, actionText + " workspace Chrome tab groups.", {
    groupIds,
    collapsed
  });
  setStatus(actionText + " " + groupIds.length + " workspace Chrome group(s).");
}

async function moveWorkspaceTabsIntoNewWindow() {
  const workspace = await getWorkspace();
  const resolution = await resolveWorkspaceTabsToLiveTabs(workspace);
  const liveResults = resolution.results.filter((result) => result.liveTab);

  if (!liveResults.length) {
    await addTimelineEvent(workspace, "workspace_tabs_new_window_skipped", "No open workspace tabs were found to move into a new Chrome window.", {
      resolutionMode: "stable_one_to_one"
    });
    await recordDiagnostic("warn", "workspace_tabs_new_window_skipped", "No open workspace tabs were found to move into a new Chrome window.");
    setStatus("No open workspace tabs found to move into a new window.");
    return;
  }

  const sortedResults = sortResultsByRoleOrder(workspace, liveResults);
  const primaryResult = sortedResults[0];
  const remainingResults = sortedResults.slice(1);
  const movedTabIds = sortedResults.map((result) => result.liveTab.id);
  const workspaceTabIds = sortedResults.map((result) => result.workspaceTab.workspaceTabId);

  const newWindow = await chrome.windows.create({
    tabId: primaryResult.liveTab.id,
    focused: true
  });

  const newWindowId = newWindow.id;

  if (remainingResults.length) {
    await chrome.tabs.move(
      remainingResults.map((result) => result.liveTab.id),
      {
        windowId: newWindowId,
        index: -1
      }
    );
  }

  await chrome.windows.update(newWindowId, { focused: true });
  await refreshWorkspaceTabMetadataAfterBrowserAction(workspace);

  const postMoveResolution = await resolveWorkspaceTabsToLiveTabs(workspace);
  const groupSummary = await recreateChromeGroupsInWindow(workspace, postMoveResolution.results, newWindowId);
  await refreshWorkspaceTabMetadataAfterBrowserAction(workspace);

  await addTimelineEvent(workspace, "workspace_tabs_moved_to_new_window", "Moved " + movedTabIds.length + " open workspace tab(s) into a new Chrome window and recreated " + groupSummary.groups.length + " workspace Chrome group(s).", {
    newWindowId,
    primaryTabId: primaryResult.liveTab.id,
    tabIds: movedTabIds,
    workspaceTabIds,
    resolutionMode: "stable_one_to_one",
    recreatedChromeGroups: true,
    recreatedGroupCount: groupSummary.groups.length,
    groupedTabCount: groupSummary.groupedTabCount,
    groups: groupSummary.groups
  });
  await recordDiagnostic("info", "workspace_tabs_moved_to_new_window", "Moved workspace tabs into a new Chrome window and recreated workspace Chrome groups.", {
    newWindowId,
    tabIds: movedTabIds,
    workspaceTabIds,
    recreatedChromeGroups: true,
    recreatedGroupCount: groupSummary.groups.length,
    groupedTabCount: groupSummary.groupedTabCount
  });
  setStatus("Moved " + movedTabIds.length + " workspace tab(s) into a new Chrome window and recreated " + groupSummary.groups.length + " Chrome group(s).");
}

async function arrangeWorkspaceTabsByRoleOrder() {
  const workspace = await getWorkspace();
  const resolution = await resolveWorkspaceTabsToLiveTabs(workspace);
  const liveResults = resolution.results.filter((result) => result.liveTab);

  if (!liveResults.length) {
    await addTimelineEvent(workspace, "workspace_tabs_arrange_skipped", "No open workspace tabs were found to arrange by role order.", {
      resolutionMode: "stable_one_to_one"
    });
    setStatus("No open workspace tabs found to arrange.");
    return;
  }

  const resultsByWindow = groupBy(liveResults, (result) => String(result.liveTab.windowId));
  const movedTabIds = [];

  for (const [windowId, results] of resultsByWindow.entries()) {
    const sortedResults = sortResultsByRoleOrder(workspace, results);
    const tabIds = sortedResults.map((result) => result.liveTab.id);
    await chrome.tabs.move(tabIds, { windowId: Number(windowId), index: -1 });
    movedTabIds.push(...tabIds);
  }

  await refreshWorkspaceTabMetadataAfterBrowserAction(workspace);
  await addTimelineEvent(workspace, "workspace_tabs_arranged_by_role", "Arranged " + movedTabIds.length + " open workspace tab(s) by workspace role order.", {
    tabIds: movedTabIds,
    windowCount: resultsByWindow.size,
    resolutionMode: "stable_one_to_one"
  });
  await recordDiagnostic("info", "workspace_tabs_arranged_by_role", "Arranged workspace tabs by role order.", {
    tabIds: movedTabIds,
    windowCount: resultsByWindow.size
  });
  setStatus("Arranged " + movedTabIds.length + " workspace tab(s) by role order.");
}

async function reopenAllMissingWorkspaceTabs() {
  const workspace = await getWorkspace();
  const resolution = await resolveWorkspaceTabsToLiveTabs(workspace);
  const missingResults = resolution.results.filter((result) =>
    !result.liveTab && result.workspaceTab.url && isReopenableMissingStatus(result.matchStatus)
  );
  const ambiguousResults = resolution.results.filter((result) =>
    !result.liveTab && result.workspaceTab.url && result.matchStatus.startsWith("ambiguous")
  );

  if (!missingResults.length) {
    await addTimelineEvent(workspace, "missing_workspace_tabs_reopen_skipped", "No safely missing workspace tabs were found to reopen. Missing tabs are records that still exist in the workspace while their live browser tab is gone; tabs closed through Chrome Flow are restored from Recovery Journal instead.", {
      ambiguousSkippedCount: ambiguousResults.length,
      resolutionMode: "stable_one_to_one",
      missingTabRule: "Close a workspace tab directly in Chrome, then run Refresh Workspace Tab Metadata before testing Reopen All Missing Tabs."
    });
    setStatus("No safely missing workspace tabs found. To test this, close a workspace tab directly in Chrome, then refresh metadata.");
    return;
  }

  const reopened = [];

  for (const result of missingResults) {
    const createdTab = await chrome.tabs.create({ url: result.workspaceTab.url, active: false });
    const browserTab = createBrowserTabSnapshotWithFallback(createdTab, result.workspaceTab);
    updateWorkspaceTabFromBrowserTab(result.workspaceTab, browserTab, {
      isOpen: true,
      lastOpenedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      lastMatchStatus: "reopened_missing_tab"
    });
    reopened.push({
      workspaceTabId: result.workspaceTab.workspaceTabId,
      tabId: browserTab.id,
      url: browserTab.url
    });
  }

  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  await addTimelineEvent(workspace, "missing_workspace_tabs_reopened", "Reopened " + reopened.length + " missing workspace tab(s). Skipped " + ambiguousResults.length + " ambiguous tab(s).", {
    reopened,
    ambiguousSkippedCount: ambiguousResults.length,
    resolutionMode: "stable_one_to_one"
  });
  await recordDiagnostic("info", "missing_workspace_tabs_reopened", "Reopened missing workspace tabs.", {
    reopenedCount: reopened.length,
    ambiguousSkippedCount: ambiguousResults.length
  });
  setStatus("Reopened " + reopened.length + " missing workspace tab(s). Skipped " + ambiguousResults.length + " ambiguous tab(s).");
  await renderDuplicateUrlReview();
}

async function copyWorkspaceUrlList() {
  const workspace = await getWorkspace();
  const markdown = buildWorkspaceUrlListMarkdown(workspace);
  await navigator.clipboard.writeText(markdown);
  await addTimelineEvent(workspace, "workspace_url_list_copied", "Copied workspace URL list grouped by role.", {
    tabCount: Array.isArray(workspace.tabs) ? workspace.tabs.length : 0,
    format: "markdown"
  });
  await recordDiagnostic("info", "workspace_url_list_copied", "Copied workspace URL list to clipboard.", {
    tabCount: Array.isArray(workspace.tabs) ? workspace.tabs.length : 0,
    format: "markdown"
  });
  setStatus("Workspace URL list copied as Markdown.");
}

async function renderDuplicateUrlReview() {
  const list = document.getElementById("duplicateUrlReviewList");

  if (!list) {
    return;
  }

  clearElement(list);
  const workspace = await getWorkspace();
  const duplicates = getDuplicateUrlGroups(workspace);

  if (!duplicates.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No duplicate URLs in the current workspace.";
    list.appendChild(empty);
    return;
  }

  duplicates.forEach((group) => {
    const card = document.createElement("article");
    card.className = "duplicate-url-card";

    const title = document.createElement("h4");
    title.textContent = group.displayUrl + " (" + group.tabs.length + ")";
    card.appendChild(title);

    group.tabs.forEach((tab) => {
      const row = document.createElement("div");
      row.className = "duplicate-url-row";

      const summary = document.createElement("p");
      summary.textContent = getTabName(tab) + " | " + getWorkspaceRoleLabel(workspace.workspaceType || DEFAULT_WORKSPACE_TYPE, tab.role || "unassigned") + " | Record " + (tab.workspaceTabId || "").slice(0, 8);
      row.appendChild(summary);

      const aliasInput = document.createElement("input");
      aliasInput.type = "text";
      aliasInput.value = tab.alias || "";
      aliasInput.placeholder = "Alias this duplicate tab...";
      aliasInput.dataset.workspaceTabId = tab.workspaceTabId || "";
      row.appendChild(aliasInput);

      const actions = document.createElement("div");
      actions.className = "duplicate-url-actions";
      actions.appendChild(createDuplicateActionButton("Apply Alias", "secondary-button", () => updateDuplicateAlias(tab.workspaceTabId, aliasInput.value)));
      actions.appendChild(createDuplicateActionButton("Focus Tab", "secondary-button", () => focusDuplicateReviewTab(tab.workspaceTabId)));
      actions.appendChild(createDuplicateActionButton("Remove", "danger-button", () => removeDuplicateReviewTab(tab.workspaceTabId)));
      row.appendChild(actions);

      card.appendChild(row);
    });

    list.appendChild(card);
  });
}

async function updateDuplicateAlias(workspaceTabId, aliasValue) {
  const workspace = await getWorkspace();
  const tab = workspace.tabs.find((item) => item.workspaceTabId === workspaceTabId);

  if (!tab) {
    setStatus("Could not find duplicate workspace tab record.");
    return;
  }

  tab.alias = aliasValue.trim();
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  await addTimelineEvent(workspace, "duplicate_tab_alias_updated", "Updated duplicate URL tab alias for: " + getTabName(tab) + ".", {
    workspaceTabId,
    url: tab.url
  });
  await recordDiagnostic("info", "duplicate_tab_alias_updated", "Updated duplicate URL tab alias.", {
    workspaceTabId,
    url: tab.url
  });
  setStatus("Updated duplicate tab alias.");
  await renderDuplicateUrlReview();
}

async function focusDuplicateReviewTab(workspaceTabId) {
  const workspace = await getWorkspace();
  const tab = workspace.tabs.find((item) => item.workspaceTabId === workspaceTabId);

  if (!tab) {
    setStatus("Could not find duplicate workspace tab record.");
    return;
  }

  const result = await resolveSingleWorkspaceTabForAction(tab);

  if (!result.liveTab) {
    await addTimelineEvent(workspace, "duplicate_tab_focus_failed", "Could not focus duplicate URL tab because it was not safely found in the browser.", {
      workspaceTabId,
      matchStatus: result.matchStatus,
      candidateCount: result.candidateCount
    });
    setStatus("Could not safely focus duplicate tab. Match status: " + result.matchStatus + ".");
    return;
  }

  await chrome.windows.update(result.liveTab.windowId, { focused: true });
  await chrome.tabs.update(result.liveTab.id, { active: true });
  await addTimelineEvent(workspace, "duplicate_tab_focused", "Focused duplicate URL tab: " + getTabName(tab) + ".", {
    workspaceTabId,
    tabId: result.liveTab.id,
    matchStatus: result.matchStatus
  });
  setStatus("Focused duplicate tab: " + getTabName(tab) + ".");
}

async function removeDuplicateReviewTab(workspaceTabId) {
  const workspace = await getWorkspace();
  const index = workspace.tabs.findIndex((item) => item.workspaceTabId === workspaceTabId);

  if (index < 0) {
    setStatus("Could not find duplicate workspace tab record.");
    return;
  }

  const tab = workspace.tabs[index];
  const confirmed = window.confirm("Remove this duplicate URL record from the workspace? The browser tab will remain open.");

  if (!confirmed) {
    setStatus("Duplicate removal cancelled.");
    return;
  }

  const reason = window.prompt("Reason for removing this duplicate URL record?", "Duplicate URL review cleanup");

  if (reason === null) {
    setStatus("Duplicate removal cancelled.");
    return;
  }

  const snapshot = createTabSnapshot(tab, workspace);
  workspace.tabs.splice(index, 1);
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  await addTimelineEvent(workspace, "workspace_tab_removed", "Removed duplicate URL record from workspace: " + snapshotName(snapshot) + ".", {
    reason: reason.trim() || "Duplicate URL review cleanup",
    tabSnapshot: snapshot,
    workspaceTabId: snapshot.workspaceTabId,
    duplicateReview: true,
    recoveryActions: {
      canReopenUrl: true,
      canReaddToWorkspace: true
    }
  });
  await recordDiagnostic("info", "duplicate_tab_removed", "Removed duplicate URL record from workspace.", {
    workspaceTabId,
    url: tab.url
  });
  setStatus("Removed duplicate URL record from workspace.");
  await renderDuplicateUrlReview();
}

async function refreshWorkspaceTabMetadataAfterBrowserAction(workspace) {
  const resolution = await resolveWorkspaceTabsToLiveTabs(workspace);

  resolution.results.forEach((result) => {
    if (result.liveTab) {
      updateWorkspaceTabFromBrowserTab(result.workspaceTab, result.liveTab, {
        isOpen: true,
        lastSeenAt: new Date().toISOString(),
        lastMatchStatus: result.matchStatus
      });
    } else {
      result.workspaceTab.isOpen = false;
      result.workspaceTab.lastMatchStatus = result.matchStatus;
    }
  });

  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
}

async function recreateChromeGroupsInWindow(workspace, resolutionResults, windowId) {
  const workspaceType = workspace.workspaceType || DEFAULT_WORKSPACE_TYPE;
  const groupedResults = groupBy(
    resolutionResults.filter((result) => result.liveTab && result.liveTab.windowId === windowId),
    (result) => result.workspaceTab.role || "unassigned"
  );
  const roleOrder = createRoleOrderMap(workspaceType);
  const groups = [];
  let groupedTabCount = 0;

  const orderedEntries = Array.from(groupedResults.entries()).sort(([leftRole], [rightRole]) => {
    const leftIndex = roleOrder.get(leftRole) ?? 999;
    const rightIndex = roleOrder.get(rightRole) ?? 999;
    return leftIndex - rightIndex;
  });

  for (const [roleId, results] of orderedEntries) {
    const sortedResults = sortResultsByRoleOrder(workspace, results);
    const tabIds = sortedResults.map((result) => result.liveTab.id);

    if (!tabIds.length) {
      continue;
    }

    const roleLabel = getWorkspaceRoleLabel(workspaceType, roleId);
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, {
      title: createChromeGroupTitle(workspace, roleLabel),
      collapsed: false
    });

    sortedResults.forEach((result) => {
      result.workspaceTab.groupId = groupId;
      result.workspaceTab.windowId = windowId;
      result.workspaceTab.lastSeenAt = new Date().toISOString();
      result.workspaceTab.lastMatchStatus = "exact_tab_id";
    });

    groupedTabCount += tabIds.length;
    groups.push({
      groupId,
      roleId,
      roleLabel,
      tabIds,
      windowId,
      workspaceTabIds: sortedResults.map((result) => result.workspaceTab.workspaceTabId)
    });
  }

  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  return { groups, groupedTabCount };
}

function buildWorkspaceUrlListMarkdown(workspace) {
  const lines = [];
  const workspaceName = workspace.name || "Untitled Workspace";
  lines.push("# " + workspaceName + " — Workspace URL List");
  lines.push("");
  lines.push("Generated by Chrome Flow on " + new Date().toISOString() + ".");
  lines.push("");

  createTabRoleGroups(workspace).forEach((group) => {
    lines.push("## " + group.label);
    lines.push("");

    group.tabs.forEach((tab) => {
      const label = getTabName(tab).replace(/[\[\]]/g, "");
      const url = tab.url || "";
      lines.push("- [" + label + "](" + url + ")");
    });

    lines.push("");
  });

  return lines.join("\n");
}

function getDuplicateUrlGroups(workspace) {
  const groups = groupBy(
    workspace.tabs.filter((tab) => tab.url),
    (tab) => tab.url
  );

  return Array.from(groups.entries())
    .filter(([, tabs]) => tabs.length > 1)
    .map(([url, tabs]) => ({
      url,
      displayUrl: createDisplayUrl(url),
      tabs
    }));
}

async function getWorkspace() {
  const result = await chrome.storage.local.get(WORKSPACE_KEY);
  const workspace = result[WORKSPACE_KEY] || createFreshWorkspace();

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

async function addTimelineEvent(workspace, type, message, details = {}) {
  const event = {
    eventId: crypto.randomUUID(),
    type,
    message,
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
      level,
      action,
      message,
      details
    });

    await chrome.storage.local.set({ [DIAGNOSTICS_KEY]: diagnostics.slice(-MAX_DIAGNOSTICS) });
  } catch (error) {
    console.warn("Chrome Flow advanced tab controls diagnostics failed:", error);
  }
}

async function resolveWorkspaceTabsToLiveTabs(workspace) {
  const browserTabs = await chrome.tabs.query({});
  const browserTabSnapshots = browserTabs.map(createBrowserTabSnapshotWithFallback);
  const consumedLiveTabIds = new Set();
  const results = [];

  workspace.tabs.forEach((workspaceTab) => {
    if (!workspaceTab.workspaceTabId) {
      workspaceTab.workspaceTabId = crypto.randomUUID();
    }

    const result = resolveWorkspaceTabAgainstBrowserTabs(workspaceTab, browserTabSnapshots, consumedLiveTabIds);

    if (result.liveTab) {
      consumedLiveTabIds.add(result.liveTab.id);
    }

    results.push(result);
  });

  return { browserTabs, results };
}

async function resolveSingleWorkspaceTabForAction(workspaceTab) {
  const browserTabs = (await chrome.tabs.query({})).map(createBrowserTabSnapshotWithFallback);
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

  return createResolutionResult(workspaceTab, null, "not_found", 0);
}

function findUnconsumedUrlMatches(workspaceTab, browserTabs, consumedLiveTabIds) {
  return browserTabs.filter((tab) =>
    !consumedLiveTabIds.has(tab.id) && workspaceTab.url && tab.url === workspaceTab.url
  );
}

function createResolutionResult(workspaceTab, liveTab, matchStatus, candidateCount) {
  return { workspaceTab, liveTab, matchStatus, candidateCount };
}

function sortResultsByRoleOrder(workspace, results) {
  const roleOrder = createRoleOrderMap(workspace.workspaceType || DEFAULT_WORKSPACE_TYPE);

  return [...results].sort((left, right) => {
    const leftRole = roleOrder.get(left.workspaceTab.role || "unassigned") ?? 999;
    const rightRole = roleOrder.get(right.workspaceTab.role || "unassigned") ?? 999;

    if (leftRole !== rightRole) {
      return leftRole - rightRole;
    }

    return (left.liveTab.index ?? 0) - (right.liveTab.index ?? 0);
  });
}

function createRoleOrderMap(workspaceType) {
  const map = new Map();
  getWorkspaceRoles(workspaceType).forEach((role, index) => {
    map.set(role.id, index);
  });
  return map;
}

function createTabRoleGroups(workspace) {
  const workspaceType = workspace.workspaceType || DEFAULT_WORKSPACE_TYPE;
  const roles = getWorkspaceRoles(workspaceType);
  const roleGroups = roles.map((role) => ({
    roleId: role.id,
    label: role.label,
    tabs: []
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
        tabs: []
      };
      legacyGroups.push(legacyGroup);
    }

    legacyGroup.tabs.push(tab);
  });

  return roleGroups.filter((group) => group.tabs.length > 0).concat(legacyGroups);
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

function createFreshWorkspace() {
  const now = new Date().toISOString();
  return {
    workspaceId: crypto.randomUUID(),
    name: "Untitled Workspace",
    aim: "",
    workspaceType: DEFAULT_WORKSPACE_TYPE,
    createdAt: now,
    updatedAt: now,
    tabs: [],
    journal: [],
    timeline: []
  };
}

function createChromeGroupTitle(workspace, roleLabel) {
  const initials = createWorkspaceInitials(workspace.name || "Chrome Flow");
  const title = roleLabel + " · " + initials;
  return title.length <= 32 ? title : title.slice(0, 32);
}

function createWorkspaceInitials(name) {
  const initials = String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("")
    .slice(0, 4);

  return initials || "CF";
}

function createButton(id, text, className) {
  const button = document.createElement("button");
  button.id = id;
  button.type = "button";
  button.className = className;
  button.textContent = text;
  return button;
}

function createDuplicateActionButton(text, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.addEventListener("click", handler);
  return button;
}

function groupBy(items, getKey) {
  const groups = new Map();

  items.forEach((item) => {
    const key = getKey(item);

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(item);
  });

  return groups;
}

function unique(values) {
  return Array.from(new Set(values));
}

function isValidChromeGroupId(groupId) {
  return Number.isInteger(groupId) && groupId >= 0;
}

function isReopenableMissingStatus(matchStatus) {
  return ["not_found", "exact_tab_id_consumed", "no_reopened_url_tab_found"].includes(matchStatus);
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
    return rawUrl.length <= 72 ? rawUrl : rawUrl.slice(0, 69) + "...";
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

function setStatus(message) {
  const status = document.getElementById("advancedTabControlsStatus");

  if (status) {
    status.textContent = message;
  }
}
