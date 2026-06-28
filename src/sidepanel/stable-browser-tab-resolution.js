import {
  DEFAULT_WORKSPACE_TYPE,
  getWorkspaceRoleLabel
} from "../core/workspace-role-sets.js";

const WORKSPACE_KEY = "chromeFlowWorkspace";
const DIAGNOSTICS_KEY = "chromeFlowDiagnostics";
const MAX_DIAGNOSTICS = 200;

installStableBrowserTabResolutionHandlers();

function installStableBrowserTabResolutionHandlers() {
  document.addEventListener("click", async (event) => {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    const button = target.closest("button");

    if (!button) {
      return;
    }

    if (button.id === "createChromeGroupsButton") {
      event.preventDefault();
      event.stopImmediatePropagation();
      await createChromeGroupsWithStableResolution(button);
      return;
    }

    if (button.id === "refreshWorkspaceTabsButton") {
      event.preventDefault();
      event.stopImmediatePropagation();
      await refreshWorkspaceMetadataWithStableResolution(button);
      return;
    }

    if (button.id === "refreshTabStatusButton") {
      event.preventDefault();
      event.stopImmediatePropagation();
      await refreshTabStatusWithStableResolution(button);
    }
  }, true);
}

async function createChromeGroupsWithStableResolution(button) {
  const trace = await recordActionStarted("createChromeTabGroups", button, ["chrome_tab_groups_created"], ["chrome_tab_grouping_skipped"], ["chrome_tab_grouping_failed"]);

  try {
    const workspace = await getWorkspace();
    const resolution = await resolveWorkspaceTabsToLiveTabs(workspace);
    const liveResults = resolution.results.filter((result) => result.liveTab);
    const skippedResults = resolution.results.filter((result) => !result.liveTab);

    if (!liveResults.length) {
      const event = await addTimelineEvent("chrome_tab_grouping_skipped", "No open workspace tabs were found for native Chrome grouping.", {
        resolutionMode: "stable_one_to_one",
        skippedCount: skippedResults.length,
        resolutionResults: summarizeResolutionResults(resolution.results)
      });
      const savedWorkspace = await getWorkspace();
      await recordActionFinished(trace, "skipped", event, savedWorkspace, {
        resolutionMode: "stable_one_to_one",
        skippedCount: skippedResults.length
      });
      setStatus("No open workspace tabs were found for grouping.");
      return;
    }

    const groupRequests = buildRoleWindowGroupRequests(workspace, liveResults);
    const createdGroupDetails = [];

    for (const request of groupRequests) {
      const groupId = await chrome.tabs.group({ tabIds: request.tabIds });
      await chrome.tabGroups.update(groupId, {
        title: createChromeGroupTitle(workspace, request.roleLabel)
      });

      request.items.forEach((item) => {
        updateWorkspaceTabFromBrowserTabInPlace(item.workspaceTab, item.liveTab, {
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

    const groupedTabCount = liveResults.length;
    const event = await addTimelineEvent("chrome_tab_groups_created", "Created " + createdGroupDetails.length + " native Chrome tab group(s) from " + groupedTabCount + " open workspace tab(s). Skipped " + skippedResults.length + " missing or ambiguous tab(s).", {
      resolutionMode: "stable_one_to_one",
      groupedTabCount,
      skippedCount: skippedResults.length,
      groups: createdGroupDetails,
      skippedResolutionResults: summarizeResolutionResults(skippedResults),
      resolutionResults: summarizeResolutionResults(resolution.results)
    });

    const savedWorkspace = await getWorkspace();
    await recordDiagnostic("info", "stable_chrome_grouping_completed", "Native Chrome grouping completed with stable one-to-one browser tab resolution.", {
      groupedTabCount,
      groupCount: createdGroupDetails.length,
      skippedCount: skippedResults.length,
      groups: createdGroupDetails
    });
    await recordActionFinished(trace, "success", event, savedWorkspace, {
      resolutionMode: "stable_one_to_one",
      groupedTabCount,
      groupCount: createdGroupDetails.length,
      skippedCount: skippedResults.length
    });
    setStatus("Created " + createdGroupDetails.length + " native Chrome tab group(s) from " + groupedTabCount + " open workspace tab(s).");
    reloadSoon();
  } catch (error) {
    const event = await addTimelineEvent("chrome_tab_grouping_failed", "Native Chrome grouping failed: " + (error.message || "Unknown error") + ".", {
      resolutionMode: "stable_one_to_one",
      error: summarizeError(error)
    });
    const workspace = await getWorkspace();
    await recordActionFinished(trace, "failed", event, workspace, {
      error: summarizeError(error)
    });
    setStatus("Could not create Chrome tab groups. Check Developer Diagnostics.");
  }
}

async function refreshWorkspaceMetadataWithStableResolution(button) {
  const trace = await recordActionStarted("refreshWorkspaceTabMetadata", button, ["workspace_tabs_refreshed"], [], ["workspace_tabs_refresh_failed"]);

  try {
    const workspace = await getWorkspace();
    const resolution = await resolveWorkspaceTabsToLiveTabs(workspace);
    const foundResults = resolution.results.filter((result) => result.liveTab);
    const missingResults = resolution.results.filter((result) => !result.liveTab);

    foundResults.forEach((result) => {
      updateWorkspaceTabFromBrowserTabInPlace(result.workspaceTab, result.liveTab, {
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

    const event = await addTimelineEvent("workspace_tabs_refreshed", "Refreshed metadata for " + foundResults.length + " workspace tab(s). " + missingResults.length + " tab(s) were not found or were ambiguous in the browser.", {
      resolutionMode: "stable_one_to_one",
      foundCount: foundResults.length,
      missingCount: missingResults.length,
      resolutionResults: summarizeResolutionResults(resolution.results)
    });
    const savedWorkspace = await getWorkspace();
    await recordDiagnostic("info", "stable_workspace_metadata_refreshed", "Workspace tab metadata refreshed with stable one-to-one browser tab resolution.", {
      foundCount: foundResults.length,
      missingCount: missingResults.length,
      resolutionResults: summarizeResolutionResults(resolution.results)
    });
    await recordActionFinished(trace, "success", event, savedWorkspace, {
      resolutionMode: "stable_one_to_one",
      foundCount: foundResults.length,
      missingCount: missingResults.length
    });
    setStatus("Refreshed metadata for " + foundResults.length + " workspace tab(s). " + missingResults.length + " tab(s) were not found or were ambiguous.");
    reloadSoon();
  } catch (error) {
    const event = await addTimelineEvent("workspace_tabs_refresh_failed", "Workspace tab metadata refresh failed: " + (error.message || "Unknown error") + ".", {
      resolutionMode: "stable_one_to_one",
      error: summarizeError(error)
    });
    const workspace = await getWorkspace();
    await recordActionFinished(trace, "failed", event, workspace, {
      error: summarizeError(error)
    });
    setStatus("Could not refresh workspace tab metadata. Check Developer Diagnostics.");
  }
}

async function refreshTabStatusWithStableResolution(button) {
  const trace = await recordActionStarted("refreshTabStatus", button, ["workspace_tab_status_refreshed"], [], ["workspace_tab_status_refresh_failed"]);

  try {
    const workspace = await getWorkspace();
    const resolution = await resolveWorkspaceTabsToLiveTabs(workspace);
    const status = calculateStableTabStatus(workspace, resolution.results);
    renderTabStatus(status);

    const event = await addTimelineEvent("workspace_tab_status_refreshed", "Tab status refreshed: " + status.openTabs + " open, " + status.missingTabs + " missing or ambiguous, " + status.groupedTabs + " grouped, " + status.ungroupedTabs + " ungrouped, " + status.unassignedTabs + " unassigned.", {
      resolutionMode: "stable_one_to_one",
      resolutionResults: summarizeResolutionResults(resolution.results)
    });
    const savedWorkspace = await getWorkspace();
    await recordDiagnostic("info", "stable_tab_status_refreshed", "Workspace tab status refreshed with stable one-to-one browser tab resolution.", {
      status,
      resolutionResults: summarizeResolutionResults(resolution.results)
    });
    await recordActionFinished(trace, "success", event, savedWorkspace, {
      resolutionMode: "stable_one_to_one",
      tabStatus: status
    });
    setStatus("Tab status refreshed: " + status.openTabs + " open, " + status.missingTabs + " missing or ambiguous, " + status.groupedTabs + " grouped.");
  } catch (error) {
    const event = await addTimelineEvent("workspace_tab_status_refresh_failed", "Workspace tab status refresh failed: " + (error.message || "Unknown error") + ".", {
      resolutionMode: "stable_one_to_one",
      error: summarizeError(error)
    });
    const workspace = await getWorkspace();
    await recordActionFinished(trace, "failed", event, workspace, {
      error: summarizeError(error)
    });
    setStatus("Could not refresh tab status. Check Developer Diagnostics.");
  }
}

async function resolveWorkspaceTabsToLiveTabs(workspace) {
  const browserTabs = (await chrome.tabs.query({})).map(createBrowserTabSnapshot);
  const consumedLiveTabIds = new Set();
  const results = [];

  workspace.tabs.forEach((workspaceTab) => {
    if (!workspaceTab.workspaceTabId) {
      workspaceTab.workspaceTabId = crypto.randomUUID();
    }

    const result = resolveSingleWorkspaceTab(workspaceTab, browserTabs, consumedLiveTabIds);

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

function resolveSingleWorkspaceTab(workspaceTab, browserTabs, consumedLiveTabIds) {
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

function setElementText(id, value) {
  const element = document.getElementById(id);

  if (element) {
    element.textContent = String(value);
  }
}

async function recordActionStarted(actionName, button, successTypes, skippedTypes = [], failedTypes = []) {
  const workspace = await getWorkspace();
  const trace = {
    traceId: crypto.randomUUID(),
    actionName,
    buttonId: button.id || "",
    buttonText: (button.textContent || "").trim(),
    successTypes,
    skippedTypes,
    failedTypes,
    terminalTypes: [...successTypes, ...skippedTypes, ...failedTypes],
    timelineLength: Array.isArray(workspace.timeline) ? workspace.timeline.length : 0
  };

  await recordDiagnostic("info", "ui_click", "Button clicked: " + (trace.buttonId || trace.buttonText) + ".", {
    buttonId: trace.buttonId,
    buttonText: trace.buttonText,
    resolutionMode: "stable_one_to_one"
  });
  await recordDiagnostic("info", "action_started", "Action started: " + trace.buttonText + ".", {
    traceId: trace.traceId,
    actionName: trace.actionName,
    buttonId: trace.buttonId,
    buttonText: trace.buttonText,
    intermediateEventTypes: [],
    terminalEventTypes: trace.terminalTypes,
    timelineLength: trace.timelineLength,
    resolutionMode: "stable_one_to_one"
  });

  return trace;
}

async function recordActionFinished(trace, resultType, observedEvent, workspace, extraDetails = {}) {
  const status = calculateStableTabStatus(workspace, (await resolveWorkspaceTabsToLiveTabs(workspace)).results);
  const level = resultType === "failed" ? "error" : resultType === "skipped" ? "warn" : "info";

  await recordDiagnostic(level, "action_" + resultType, "Action " + resultType + ": " + trace.buttonText + ".", {
    traceId: trace.traceId,
    actionName: trace.actionName,
    buttonId: trace.buttonId,
    buttonText: trace.buttonText,
    observedEvent: createObservedEventSummary(observedEvent),
    observedIntermediateEventIds: [],
    tabStatus: status,
    ...extraDetails
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

async function addTimelineEvent(type, message, details = {}) {
  const workspace = await getWorkspace();
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
    console.warn("Chrome Flow stable browser tab resolution diagnostics failed:", error);
  }
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

function isValidChromeGroupId(groupId) {
  return Number.isInteger(groupId) && groupId >= 0;
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

function setStatus(message) {
  const status = document.getElementById("intakeStatus");

  if (status) {
    status.textContent = message;
  }
}

function reloadSoon() {
  window.setTimeout(() => {
    window.location.reload();
  }, 300);
}
