import { getAllBrowserTabs } from "../core/tab-state.js";
import { addTimelineEvent, getWorkspace, saveWorkspace } from "../core/workspace-store.js";
import {
  DEFAULT_WORKSPACE_TYPE,
  getWorkspaceRoleLabel,
  getWorkspaceRoles
} from "../core/workspace-role-sets.js";
import {
  EXECUTION_PHRASE,
  buildThresholdExecutionGatePacket,
  formatThresholdExecutionGatePacket
} from "./workspace-dedicated-window-threshold-execution-gate.js";

const DEDICATED_WINDOW_THRESHOLD = 4;
const TARGET_MODE = "new_window";
const PACKET_ENVELOPE_START = "CHROME_FLOW_PACKET_START";
const PACKET_ENVELOPE_END = "CHROME_FLOW_PACKET_END";
const PACKET_CLIPBOARD_FORMAT = "chrome_flow_packet_envelope_v0.1";
const PACKET_CONTENT_TYPE = "application/json";
const WINDOW_SETTLE_DELAY_MS = 650;

let lastThresholdExecutionPacket = null;
let liveThresholdExecutionInProgress = false;

installDedicatedWindowThresholdExecution();

function installDedicatedWindowThresholdExecution() {
  if (document.getElementById("dedicatedWindowThresholdExecutionSection")) return;

  const anchor = document.getElementById("dedicatedWindowThresholdReviewValidationSuiteSection") || document.getElementById("dedicatedWindowThresholdReviewSection") || document.getElementById("dedicatedWindowThresholdPolicySection") || document.querySelector(".workspace-section");
  if (!anchor) return;

  const section = document.createElement("section");
  section.id = "dedicatedWindowThresholdExecutionSection";
  section.className = "dedicated-window-threshold-execution-section";
  section.innerHTML = `
    <h2>Dedicated Window Threshold Execution</h2>
    <p class="section-help">Moves a 4+ tab active runtime workspace into one dedicated Chrome window after all gates pass. This is a live browser action.</p>
    <div id="dedicatedWindowThresholdExecutionSummary" class="workspace-session-summary">Threshold execution surface loaded.</div>
    <div class="workspace-session-options">
      <p><strong>Target mode:</strong> ${TARGET_MODE}</p>
      <p><strong>Required execution phrase:</strong> ${EXECUTION_PHRASE}</p>
      <label for="dedicatedWindowThresholdExecutionPhrase">Type execution phrase</label>
      <input id="dedicatedWindowThresholdExecutionPhrase" type="text" placeholder="${EXECUTION_PHRASE}" />
      <label class="checkbox-label"><input id="dedicatedWindowThresholdExecutionAcknowledgement" type="checkbox" /> I understand this will move open workspace tabs into a dedicated/new Chrome window.</label>
    </div>
    <div class="workspace-session-actions">
      <button id="prepareDedicatedWindowThresholdExecutionButton" type="button" class="secondary-button">Prepare Threshold Execution Packet</button>
      <button id="runDedicatedWindowThresholdExecutionButton" type="button" class="danger-button" disabled>Run Dedicated Window Move Disabled</button>
      <button id="copyDedicatedWindowThresholdExecutionPacketButton" type="button" class="secondary-button">Copy Threshold Execution Packet</button>
    </div>
    <p id="dedicatedWindowThresholdExecutionStatus" class="status-message"></p>
    <pre id="dedicatedWindowThresholdExecutionOutput" class="diagnostics-output">Dedicated window threshold execution output will appear here.</pre>
  `;

  anchor.insertAdjacentElement("afterend", section);

  document.getElementById("prepareDedicatedWindowThresholdExecutionButton")?.addEventListener("click", prepareExecutionPacket);
  document.getElementById("runDedicatedWindowThresholdExecutionButton")?.addEventListener("click", runThresholdExecution);
  document.getElementById("copyDedicatedWindowThresholdExecutionPacketButton")?.addEventListener("click", copyExecutionPacket);

  setSummary("Threshold execution ready. Prepare a packet to read current runtime state and Operator confirmation.");
  setStatus("Threshold execution loaded. No packet has been prepared yet.");
}

async function prepareExecutionPacket() {
  try {
    const packet = await buildThresholdExecutionPrecheckPacket();
    lastThresholdExecutionPacket = packet;
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Threshold execution packet prepared: " + getPacketStatus(packet) + ".");
    updateExecutionButton(packet);
  } catch (error) {
    setError("Could not prepare threshold execution packet.", error);
  }
}

async function copyExecutionPacket() {
  try {
    const packet = lastThresholdExecutionPacket || await buildThresholdExecutionPrecheckPacket();
    await navigator.clipboard.writeText(formatPacket(packet));
    lastThresholdExecutionPacket = packet;
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Threshold execution packet copied: " + getPacketStatus(packet) + ".");
    updateExecutionButton(packet);
  } catch (error) {
    setError("Could not copy threshold execution packet.", error);
  }
}

async function runThresholdExecution() {
  if (liveThresholdExecutionInProgress) {
    setStatus("Dedicated-window threshold execution is already running.");
    return;
  }

  liveThresholdExecutionInProgress = true;
  const runButton = document.getElementById("runDedicatedWindowThresholdExecutionButton");
  if (runButton) runButton.disabled = true;

  let runtimeActionStarted = false;
  let browserProjectionChanged = false;

  try {
    const precheckPacket = await buildThresholdExecutionPrecheckPacket();
    lastThresholdExecutionPacket = precheckPacket;

    if (precheckPacket.executionGate.status !== "ready_for_live_threshold_execution") {
      setSummary(createSummary(precheckPacket));
      setOutput(precheckPacket);
      setStatus("Threshold execution blocked: " + precheckPacket.executionGate.status + ".");
      return;
    }

    setStatus("Running dedicated-window threshold execution. Moving workspace tabs into one dedicated window...");
    const executionPacket = await executeDedicatedWindowThresholdMove(precheckPacket, {
      markRuntimeStarted: () => { runtimeActionStarted = true; },
      markBrowserChanged: () => { browserProjectionChanged = true; }
    });
    lastThresholdExecutionPacket = executionPacket;
    setSummary(createSummary(executionPacket));
    setOutput(executionPacket);
    setStatus("Dedicated-window threshold execution complete: " + executionPacket.execution.status + ".");
  } catch (error) {
    const failurePacket = await buildExecutionFailurePacket({ error, runtimeActionStarted, browserProjectionChanged });
    lastThresholdExecutionPacket = failurePacket;
    setSummary(createSummary(failurePacket));
    setOutput(failurePacket);
    setStatus("Dedicated-window threshold execution failed. Copy the execution packet for review.");
  } finally {
    liveThresholdExecutionInProgress = false;
    const nextPacket = await safeBuildThresholdExecutionPrecheckPacket();
    updateExecutionButton(nextPacket);
  }
}

async function buildThresholdExecutionPrecheckPacket(overrides = null) {
  const workspace = overrides?.workspace || await getWorkspace();
  const tabs = Array.isArray(overrides?.tabs) ? overrides.tabs : Array.isArray(workspace?.tabs) ? workspace.tabs : [];
  const resolution = overrides?.resolution || await resolveWorkspaceTabsToLiveTabs(tabs);
  const phrase = overrides?.phrase ?? getExecutionPhrase();
  const acknowledgementChecked = overrides?.acknowledgementChecked ?? Boolean(document.getElementById("dedicatedWindowThresholdExecutionAcknowledgement")?.checked);

  return buildThresholdExecutionGatePacket({
    workspace,
    tabs,
    resolution,
    phrase,
    acknowledgementChecked,
    createdAt: overrides?.createdAt || null,
    roleLabeler: (role) => createRoleLabel(workspace, role),
    sortResolvedResults: (results) => sortResultsByRoleOrder(workspace, results)
  });
}

async function executeDedicatedWindowThresholdMove(precheckPacket, hooks = {}) {
  const commandId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const workspaceBefore = await getWorkspace();
  const preActionWorkspaceId = workspaceBefore?.workspaceId || "";
  const tabs = Array.isArray(workspaceBefore?.tabs) ? workspaceBefore.tabs : [];
  const resolution = await resolveWorkspaceTabsToLiveTabs(tabs);
  const resolvedResults = sortResultsByRoleOrder(workspaceBefore, resolution.results.filter((result) => result.liveTab));
  const plannedGroups = createPlannedGroupsFromResults(workspaceBefore, resolvedResults);
  const snapshotBefore = await captureBrowserSnapshot();
  const sourceWindowIds = unique(resolvedResults.map((result) => result.liveTab.windowId).filter(Number.isInteger));

  hooks.markRuntimeStarted?.();
  const browserResult = await moveResolvedResultsIntoDedicatedWindow({ workspace: workspaceBefore, resolvedResults, plannedGroups });
  hooks.markBrowserChanged?.();
  await delay(WINDOW_SETTLE_DELAY_MS);

  const snapshotAfter = await captureBrowserSnapshot();
  const workspaceAfter = await getWorkspace();
  const verification = verifyExecution({
    precheckPacket,
    workspaceBefore,
    workspaceAfter,
    resolvedResults,
    plannedGroups,
    browserResult,
    snapshotBefore,
    snapshotAfter,
    sourceWindowIds,
    preActionWorkspaceId
  });
  const status = verification.failedChecks.length ? "completed_with_verification_failures" : "completed_verified";

  return {
    packetType: "Chrome Flow Dedicated Window Threshold Execution Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "dedicated-window-threshold-execution-packet-v0.1"
    },
    clipboard: precheckPacket.clipboard,
    commandEnvelope: {
      command: "projection.workspace_dedicated_window_threshold_execution",
      commandId,
      authorityClass: "live_browser_action_operator_confirmed",
      targetMode: TARGET_MODE,
      action: "move_existing_workspace_tabs_to_dedicated_window",
      startedAt,
      finishedAt: new Date().toISOString()
    },
    source: {
      type: "workspace_dedicated_window_threshold_execution",
      runtimeActionExecuted: true,
      browserProjectionChanged: true,
      sessionDbChanged: false,
      chromeStorageRuntimeChanged: true,
      chromeStorageChangeScope: "active_workspace_tab_metadata_and_timeline_only",
      chromeStorageActiveWorkspaceReplaced: false,
      existingTabsClosed: false,
      unrelatedTabsMoved: false
    },
    precheck: precheckPacket.executionGate,
    workspace: precheckPacket.workspace,
    operatorConfirmation: precheckPacket.operatorConfirmation,
    browserPlan: precheckPacket.browserPlan,
    browserResult,
    snapshotBefore,
    snapshotAfter,
    verification,
    execution: {
      status,
      notes: [
        "Existing open workspace tabs were moved into one dedicated Chrome window.",
        "Chrome groups were recreated in the dedicated window from workspace roles.",
        "No Session DB records were intentionally mutated.",
        "chrome.storage.local active workspace metadata/timeline was updated to reflect the live browser move.",
        "The active runtime workspace id was not intentionally replaced."
      ]
    }
  };
}

async function moveResolvedResultsIntoDedicatedWindow({ workspace, resolvedResults, plannedGroups }) {
  if (!resolvedResults.length) throw new Error("No resolved workspace tabs are available to move.");

  const primaryResult = resolvedResults[0];
  const remainingResults = resolvedResults.slice(1);
  const movedTabIds = resolvedResults.map((result) => result.liveTab.id);
  const workspaceTabIds = resolvedResults.map((result) => result.workspaceTab.workspaceTabId);

  const createdWindow = await chrome.windows.create({ tabId: primaryResult.liveTab.id, focused: true, state: "normal" });
  const dedicatedWindowId = createdWindow.id;
  if (!Number.isInteger(dedicatedWindowId)) throw new Error("Chrome did not return a usable dedicated window id.");

  await focusNormalWindow(dedicatedWindowId);
  await delay(WINDOW_SETTLE_DELAY_MS);

  if (remainingResults.length) {
    await chrome.tabs.move(remainingResults.map((result) => result.liveTab.id), { windowId: dedicatedWindowId, index: -1 });
  }

  await delay(WINDOW_SETTLE_DELAY_MS);
  await focusNormalWindow(dedicatedWindowId);

  const groupSummary = await recreateGroupsInDedicatedWindow({ workspace, resolvedResults, plannedGroups, dedicatedWindowId });
  await delay(WINDOW_SETTLE_DELAY_MS);

  const refreshedTabs = await readMovedTabRuntimeMetadata(movedTabIds);
  const refreshedByTabId = new Map(refreshedTabs.map((tab) => [tab.tabId, tab]));
  await updateWorkspaceMetadataAfterMove({ workspace, resolvedResults, refreshedByTabId, groupSummary, dedicatedWindowId });
  await focusNormalWindow(dedicatedWindowId);

  return {
    dedicatedWindowId,
    movedTabIds,
    workspaceTabIds,
    movedTabCount: movedTabIds.length,
    sourceWindowIds: unique(resolvedResults.map((result) => result.liveTab.windowId).filter(Number.isInteger)),
    recreatedChromeGroups: true,
    recreatedGroupCount: groupSummary.groups.length,
    groupedTabCount: groupSummary.groupedTabCount,
    groups: groupSummary.groups,
    refreshedTabs
  };
}

async function recreateGroupsInDedicatedWindow({ workspace, resolvedResults, plannedGroups, dedicatedWindowId }) {
  const movedTabIdsByWorkspaceTabId = new Map(resolvedResults.map((result) => [result.workspaceTab.workspaceTabId, result.liveTab.id]));
  const groups = [];
  let groupedTabCount = 0;

  for (const plannedGroup of plannedGroups) {
    const tabIds = plannedGroup.workspaceTabIds.map((workspaceTabId) => movedTabIdsByWorkspaceTabId.get(workspaceTabId)).filter(Number.isInteger);
    const title = createChromeGroupTitle(workspace, plannedGroup.role, plannedGroup.roleLabel);
    if (tabIds.length !== plannedGroup.workspaceTabIds.length) {
      groups.push({ role: plannedGroup.role, roleLabel: plannedGroup.roleLabel, title, status: "failed_missing_moved_tabs", tabIds, workspaceTabIds: plannedGroup.workspaceTabIds });
      continue;
    }
    const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId: dedicatedWindowId } });
    await chrome.tabGroups.update(groupId, { title, collapsed: false });
    groupedTabCount += tabIds.length;
    groups.push({ role: plannedGroup.role, roleLabel: plannedGroup.roleLabel, title, groupId, windowId: dedicatedWindowId, tabIds, workspaceTabIds: plannedGroup.workspaceTabIds, status: "created" });
  }

  return { groups, groupedTabCount };
}

async function updateWorkspaceMetadataAfterMove({ workspace, resolvedResults, refreshedByTabId, groupSummary, dedicatedWindowId }) {
  const groupByWorkspaceTabId = new Map();
  for (const group of groupSummary.groups) {
    if (!Number.isInteger(group.groupId)) continue;
    group.workspaceTabIds.forEach((workspaceTabId) => groupByWorkspaceTabId.set(workspaceTabId, group.groupId));
  }

  const updatedAt = new Date().toISOString();
  for (const result of resolvedResults) {
    const refreshed = refreshedByTabId.get(result.liveTab.id);
    result.workspaceTab.tabId = result.liveTab.id;
    result.workspaceTab.windowId = dedicatedWindowId;
    result.workspaceTab.groupId = groupByWorkspaceTabId.get(result.workspaceTab.workspaceTabId) ?? refreshed?.groupId ?? -1;
    result.workspaceTab.url = refreshed?.url || result.workspaceTab.url;
    result.workspaceTab.originalTitle = refreshed?.title || result.workspaceTab.originalTitle;
    result.workspaceTab.isOpen = true;
    result.workspaceTab.lastSeenAt = updatedAt;
    result.workspaceTab.lastMatchStatus = "exact_tab_id";
  }

  workspace.updatedAt = updatedAt;
  await saveWorkspace(workspace);
  await addTimelineEvent("workspace_threshold_dedicated_window_executed", "Moved " + resolvedResults.length + " workspace tab(s) into a dedicated Chrome window and recreated " + groupSummary.groups.length + " role group(s).", {
    dedicatedWindowId,
    movedTabIds: resolvedResults.map((result) => result.liveTab.id),
    workspaceTabIds: resolvedResults.map((result) => result.workspaceTab.workspaceTabId),
    recreatedGroupCount: groupSummary.groups.length,
    groupedTabCount: groupSummary.groupedTabCount,
    groups: groupSummary.groups,
    thresholdPolicy: "4+ tabs dedicated-window execution",
    storageMutationScope: "active_workspace_tab_metadata_and_timeline_only"
  });
}

async function readMovedTabRuntimeMetadata(tabIds) {
  const records = [];
  for (const tabId of tabIds) {
    try {
      const tab = await chrome.tabs.get(tabId);
      records.push({ tabId, windowId: tab.windowId, groupId: tab.groupId, url: tab.url || "", title: tab.title || "", status: "observed" });
    } catch (error) {
      records.push({ tabId, windowId: null, groupId: -1, url: "", title: "", status: "read_failed", error: summarizeError(error) });
    }
  }
  return records;
}

function verifyExecution(context) {
  const checks = [];
  const beforeTabIds = new Set(context.snapshotBefore.tabIds);
  const afterTabIds = new Set(context.snapshotAfter.tabIds);
  const beforeWindowIds = new Set(context.snapshotBefore.windowIds);
  const afterWindowIds = new Set(context.snapshotAfter.windowIds);
  const afterTabsById = new Map(context.snapshotAfter.tabs.map((tab) => [tab.tabId, tab]));
  const movedTabIdSet = new Set(context.browserResult.movedTabIds);
  const sourceWindowIdSet = new Set(context.sourceWindowIds);
  const unaffectedBeforeWindowIds = [...beforeWindowIds].filter((windowId) => !sourceWindowIdSet.has(windowId));
  const createdGroups = context.browserResult.groups.filter((group) => Number.isInteger(group.groupId));
  const refreshedTabsById = new Map((context.browserResult.refreshedTabs || []).map((tab) => [tab.tabId, tab]));
  const workspaceAfterTabsById = new Map((context.workspaceAfter?.tabs || []).map((tab) => [tab.workspaceTabId, tab]));

  checks.push(createVerificationCheck("dedicated_window_exists", Number.isInteger(context.browserResult.dedicatedWindowId) && afterWindowIds.has(context.browserResult.dedicatedWindowId), "Dedicated window exists after execution."));
  checks.push(createVerificationCheck("dedicated_window_not_present_before", Number.isInteger(context.browserResult.dedicatedWindowId) && !beforeWindowIds.has(context.browserResult.dedicatedWindowId), "Dedicated window was not present before execution."));
  checks.push(createVerificationCheck("moved_tab_count_matches_plan", context.browserResult.movedTabIds.length === context.resolvedResults.length, "Moved tab count matches resolved workspace tab count."));
  checks.push(createVerificationCheck("moved_tabs_exist_after", context.browserResult.movedTabIds.every((tabId) => afterTabIds.has(tabId)), "All moved tabs exist after execution."));
  checks.push(createVerificationCheck("moved_tabs_in_dedicated_window", context.browserResult.movedTabIds.every((tabId) => afterTabsById.get(tabId)?.windowId === context.browserResult.dedicatedWindowId), "All moved tabs are in the dedicated window."));
  checks.push(createVerificationCheck("before_tabs_preserved", [...beforeTabIds].every((tabId) => afterTabIds.has(tabId)), "No before-action browser tabs disappeared."));
  checks.push(createVerificationCheck("unaffected_windows_preserved", unaffectedBeforeWindowIds.every((windowId) => afterWindowIds.has(windowId)), "No unaffected before-action windows disappeared."));
  checks.push(createVerificationCheck("created_group_count_matches_plan", createdGroups.length === context.plannedGroups.length, "Created group count matches planned group count."));
  checks.push(createVerificationCheck("groups_only_contain_moved_tabs", createdGroups.every((group) => group.tabIds.every((tabId) => movedTabIdSet.has(tabId))), "Created groups contain only moved workspace tabs."));
  checks.push(createVerificationCheck("created_group_ids_present_in_final_snapshot", createdGroups.every((group) => group.tabIds.every((tabId) => afterTabsById.get(tabId)?.groupId === group.groupId)), "Created group IDs are present on moved tabs in the final browser snapshot."));
  checks.push(createVerificationCheck("refreshed_tabs_match_final_snapshot", context.browserResult.movedTabIds.every((tabId) => {
    const refreshed = refreshedTabsById.get(tabId);
    const after = afterTabsById.get(tabId);
    return refreshed && after && refreshed.windowId === after.windowId && refreshed.groupId === after.groupId;
  }), "Refreshed moved-tab metadata matches the final browser snapshot."));
  checks.push(createVerificationCheck("workspace_metadata_matches_final_snapshot", context.resolvedResults.every((result) => {
    const workspaceTab = workspaceAfterTabsById.get(result.workspaceTab.workspaceTabId);
    const after = afterTabsById.get(result.liveTab.id);
    return workspaceTab && after && workspaceTab.windowId === after.windowId && workspaceTab.groupId === after.groupId;
  }), "Workspace tab metadata matches final browser window and group IDs."));
  checks.push(createVerificationCheck("chrome_group_titles_are_compact", createdGroups.every((group) => typeof group.title === "string" && group.title.length <= 32 && !/^legacy:/i.test(group.title)), "Chrome group titles are compact and do not use Legacy-prefixed labels."));
  checks.push(createVerificationCheck("active_workspace_id_preserved", context.workspaceAfter?.workspaceId === context.preActionWorkspaceId, "Active runtime workspace id is preserved."));
  checks.push(createVerificationCheck("session_db_not_changed_by_execution", true, "Session DB is not changed by this command."));

  const failedChecks = checks.filter((check) => check.status === "fail");
  return {
    status: failedChecks.length ? "verification_failed" : "verified",
    checks,
    failedChecks
  };
}

async function buildExecutionFailurePacket({ error, runtimeActionStarted, browserProjectionChanged }) {
  const snapshotAfterFailure = await captureBrowserSnapshot().catch(() => null);
  return {
    packetType: "Chrome Flow Dedicated Window Threshold Execution Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "dedicated-window-threshold-execution-packet-v0.1"
    },
    clipboard: createClipboardBlock(),
    source: {
      type: "workspace_dedicated_window_threshold_execution_failure",
      runtimeActionExecuted: runtimeActionStarted,
      browserProjectionChanged,
      sessionDbChanged: false,
      chromeStorageRuntimeChanged: runtimeActionStarted,
      chromeStorageChangeScope: runtimeActionStarted ? "unknown_or_partial_after_failure" : "none"
    },
    execution: {
      status: runtimeActionStarted ? "failed_after_runtime_action_started" : "failed_before_runtime_action_started",
      error: summarizeError(error),
      note: "Automatic cleanup is intentionally out of scope for this threshold execution slice."
    },
    snapshotAfterFailure
  };
}

async function resolveWorkspaceTabsToLiveTabs(tabs) {
  const browserTabs = await getAllBrowserTabs();
  const consumedLiveTabIds = new Set();
  const results = [];

  for (const workspaceTab of tabs) {
    const result = resolveWorkspaceTabAgainstBrowserTabs(workspaceTab, browserTabs, consumedLiveTabIds);
    if (result.liveTab) consumedLiveTabIds.add(result.liveTab.id);
    results.push(result);
  }

  return { browserTabs, results };
}

function resolveWorkspaceTabAgainstBrowserTabs(workspaceTab, browserTabs, consumedLiveTabIds) {
  if (Number.isInteger(workspaceTab.tabId)) {
    const exactTab = browserTabs.find((tab) => tab.id === workspaceTab.tabId);
    if (exactTab && !consumedLiveTabIds.has(exactTab.id)) return createResolutionResult(workspaceTab, exactTab, "exact_tab_id", 1);
    if (exactTab && consumedLiveTabIds.has(exactTab.id)) return createResolutionResult(workspaceTab, null, "exact_tab_id_consumed", 0);
  }
  const urlMatches = browserTabs.filter((tab) => !consumedLiveTabIds.has(tab.id) && workspaceTab.url && tab.url === workspaceTab.url);
  if (urlMatches.length === 1) return createResolutionResult(workspaceTab, urlMatches[0], "single_url_fallback", 1);
  if (urlMatches.length > 1) return createResolutionResult(workspaceTab, null, "ambiguous_url_matches", urlMatches.length);
  return createResolutionResult(workspaceTab, null, "not_found", 0);
}

function createResolutionResult(workspaceTab, liveTab, matchStatus, candidateCount) {
  return { workspaceTab, liveTab, matchStatus, candidateCount };
}

function summarizeResolution(resolution) {
  const results = resolution.results.map((result) => ({
    workspaceTabId: result.workspaceTab.workspaceTabId,
    savedTabId: result.workspaceTab.tabId,
    savedUrl: result.workspaceTab.url,
    role: result.workspaceTab.role || "unassigned",
    matchStatus: result.matchStatus,
    candidateCount: result.candidateCount,
    liveTabId: result.liveTab?.id ?? null,
    liveWindowId: result.liveTab?.windowId ?? null,
    liveGroupId: result.liveTab?.groupId ?? null
  }));
  return {
    browserTabCount: resolution.browserTabs.length,
    workspaceTabCount: resolution.results.length,
    resolvedCount: results.filter((result) => Number.isInteger(result.liveTabId)).length,
    unresolvedCount: results.filter((result) => !Number.isInteger(result.liveTabId)).length,
    results
  };
}

function createExecutionGateChecks({ workspace, tabStatus, plannedGroups, policy, phraseMatches, acknowledgementChecked, resolution }) {
  const summary = summarizeResolution(resolution);
  return [
    createCheck("runtime_workspace_exists", Boolean(workspace?.workspaceId), "Active runtime workspace exists."),
    createCheck("dedicated_window_policy_active", policy.dedicatedWindowPolicyActive === true, "Active workspace is in the 4+ tab dedicated-window policy range."),
    createCheck("minimum_tab_threshold_met", tabStatus.totalTabs >= DEDICATED_WINDOW_THRESHOLD, "Active workspace has at least 4 tabs."),
    createCheck("workspace_tabs_have_urls", tabStatus.totalTabs > 0 && tabStatus.missingUrlCount === 0, "All active workspace tabs have URLs."),
    createCheck("workspace_tabs_have_roles", tabStatus.totalTabs > 0 && tabStatus.unassignedTabs === 0, "All active workspace tabs have assigned roles."),
    createCheck("planned_groups_available", plannedGroups.length > 0, "Planned role groups are available."),
    createCheck("live_workspace_tabs_resolved", summary.workspaceTabCount > 0 && summary.resolvedCount === summary.workspaceTabCount, "All workspace tab records resolve to live browser tabs."),
    createCheck("target_mode_new_window", TARGET_MODE === "new_window", "Target mode is new_window."),
    createCheck("operator_phrase_matches", phraseMatches, "Operator typed the required execution phrase."),
    createCheck("operator_acknowledgement_checked", acknowledgementChecked, "Operator checked the threshold execution acknowledgement."),
    createCheck("no_runtime_action_executed_yet", true, "Precheck packet does not execute runtime action."),
    createCheck("no_browser_projection_changed_yet", true, "Precheck packet does not change browser projection."),
    createCheck("no_session_db_changed", true, "Precheck packet does not write Session DB."),
    createCheck("no_chrome_storage_runtime_changed_yet", true, "Precheck packet does not change chrome.storage.local before execution.")
  ];
}

function buildTabStatus(tabs, resolutionResults = []) {
  const totalTabs = tabs.length;
  const tabsWithUrls = tabs.filter((tab) => Boolean(tab.url)).length;
  const assignedTabs = tabs.filter((tab) => tab.role && tab.role !== "unassigned").length;
  const openTabs = resolutionResults.filter((result) => result.liveTab).length;
  const missingTabs = totalTabs - openTabs;
  const unassignedTabs = totalTabs - assignedTabs;
  const roleCounts = tabs.reduce((counts, tab) => {
    const role = tab.role || "unassigned";
    counts[role] = (counts[role] || 0) + 1;
    return counts;
  }, {});
  return { totalTabs, openTabs, missingTabs, tabsWithUrls, missingUrlCount: totalTabs - tabsWithUrls, assignedTabs, unassignedTabs, roleCounts };
}

function classifyWorkspace(totalTabs) {
  if (totalTabs <= 0) return { status: "no_workspace_tabs_detected", dedicatedWindowPolicyActive: false, currentWindowStillValid: true };
  if (totalTabs < DEDICATED_WINDOW_THRESHOLD) return { status: "current_window_valid", dedicatedWindowPolicyActive: false, currentWindowStillValid: true };
  return { status: "dedicated_window_policy_active", dedicatedWindowPolicyActive: true, currentWindowStillValid: false };
}

function createPlannedGroupsFromResults(workspace, results) {
  const roles = new Map();
  for (const result of results) {
    const role = result.workspaceTab.role || "unassigned";
    if (role === "unassigned") continue;
    if (!roles.has(role)) roles.set(role, []);
    roles.get(role).push(result.workspaceTab.workspaceTabId);
  }
  return Array.from(roles.entries()).map(([role, workspaceTabIds]) => ({
    role,
    roleLabel: createRoleLabel(workspace, role),
    workspaceTabIds,
    plannedTabCount: workspaceTabIds.length,
    requiredForProjection: true
  }));
}

function sortResultsByRoleOrder(workspace, results) {
  const roleOrder = createRoleOrderMap(workspace?.workspaceType || DEFAULT_WORKSPACE_TYPE);
  return [...results].sort((left, right) => {
    const leftRole = roleOrder.get(left.workspaceTab.role || "unassigned") ?? 999;
    const rightRole = roleOrder.get(right.workspaceTab.role || "unassigned") ?? 999;
    if (leftRole !== rightRole) return leftRole - rightRole;
    return (left.liveTab.index ?? 0) - (right.liveTab.index ?? 0);
  });
}

function createRoleOrderMap(workspaceType) {
  const map = new Map();
  getWorkspaceRoles(workspaceType).forEach((role, index) => map.set(role.id, index));
  return map;
}

function createRoleLabel(workspace, role) {
  const workspaceType = workspace?.workspaceType || workspace?.type || DEFAULT_WORKSPACE_TYPE;
  const configuredLabel = getWorkspaceRoleLabel(workspaceType, role) || getWorkspaceRoleLabel(DEFAULT_WORKSPACE_TYPE, role);
  return removeLegacyPrefix(configuredLabel || humanizeRole(role));
}

function createChromeGroupTitle(workspace, role, roleLabel = "") {
  const suffix = " · " + getWorkspaceGroupToken(workspace);
  const roleTitle = compactRoleLabel(role, roleLabel);
  const maxLength = 32;
  const availableRoleLength = maxLength - suffix.length;
  if (availableRoleLength <= 3) return (roleTitle + suffix).slice(0, maxLength - 3) + "...";
  const trimmedRole = roleTitle.length <= availableRoleLength ? roleTitle : roleTitle.slice(0, availableRoleLength - 3) + "...";
  return trimmedRole + suffix;
}

function compactRoleLabel(role, roleLabel = "") {
  const normalizedRole = String(role || "").toLowerCase();
  const cleanedLabel = removeLegacyPrefix(roleLabel || humanizeRole(role));
  const compactByRole = {
    api_reference: "API Ref",
    bug_reference: "Bug Ref",
    documentation: "Docs",
    reference: "Ref",
    counterpoint: "Counter",
    source: "Source",
    question: "Question"
  };
  return compactByRole[normalizedRole] || cleanedLabel;
}

function removeLegacyPrefix(value = "") {
  return String(value || "").replace(/^legacy:\s*/i, "").trim();
}

function humanizeRole(role) {
  return String(role || "unassigned").replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getWorkspaceGroupToken(workspace) {
  const rawName = (workspace?.name || "").trim();
  if (!rawName) return "CF";
  const initials = rawName.split(/\s+/).filter(Boolean).map((word) => word.replace(/[^a-zA-Z0-9]/g, "")).filter(Boolean).map((word) => word[0]).join("").toUpperCase();
  return initials ? initials.slice(0, 4) : "CF";
}

async function captureBrowserSnapshot() {
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  const windowSummaries = windows.map((window) => ({ windowId: window.id, focused: Boolean(window.focused), state: window.state || "unknown", tabIds: (window.tabs || []).map((tab) => tab.id).filter(Number.isInteger) }));
  const tabs = windows.flatMap((window) => (window.tabs || []).map((tab) => ({ tabId: tab.id, windowId: tab.windowId, groupId: Number.isInteger(tab.groupId) ? tab.groupId : -1, url: tab.url || "", title: tab.title || "" })));
  return { capturedAt: new Date().toISOString(), windowIds: windowSummaries.map((window) => window.windowId).filter(Number.isInteger), tabIds: tabs.map((tab) => tab.tabId).filter(Number.isInteger), windows: windowSummaries, tabs };
}

async function focusNormalWindow(windowId) {
  if (!Number.isInteger(windowId)) return;
  await chrome.windows.update(windowId, { state: "normal" });
  await chrome.windows.update(windowId, { focused: true });
}

function createVerificationCheck(check, passed, message) {
  return { check, status: passed ? "pass" : "fail", severity: "verify", message };
}

function createCheck(check, passed, message) {
  return { check, status: passed ? "pass" : "fail", severity: "block", message };
}

function createWorkspaceBlock(workspace) {
  return { workspaceId: workspace?.workspaceId || "", name: workspace?.name || "", workspaceType: workspace?.workspaceType || workspace?.type || "", aim: workspace?.aim || "" };
}

function getExecutionPhrase() {
  return document.getElementById("dedicatedWindowThresholdExecutionPhrase")?.value.trim() || "";
}

function updateExecutionButton(packet) {
  const button = document.getElementById("runDedicatedWindowThresholdExecutionButton");
  if (!button) return;
  const shouldEnable = packet?.executionGate?.status === "ready_for_live_threshold_execution" && packet?.executionGate?.availableInThisSlice === true && !liveThresholdExecutionInProgress;
  button.disabled = !shouldEnable;
  button.textContent = shouldEnable ? "Run Dedicated Window Move" : "Run Dedicated Window Move Disabled";
}

async function safeBuildThresholdExecutionPrecheckPacket() {
  try { return await buildThresholdExecutionPrecheckPacket(); }
  catch { return null; }
}

function formatPacket(packet) {
  return formatThresholdExecutionGatePacket(packet);
}


function createClipboardBlock() {
  return {
    format: PACKET_CLIPBOARD_FORMAT,
    contentType: PACKET_CONTENT_TYPE,
    copyMode: "text_envelope",
    envelopeStart: PACKET_ENVELOPE_START,
    envelopeEnd: PACKET_ENVELOPE_END
  };
}
function createSummary(packet) {
  if (packet?.packetType === "Chrome Flow Dedicated Window Threshold Execution Packet") return "Threshold execution: " + packet.execution.status + " | Window: " + (packet.browserResult?.dedicatedWindowId || "none") + " | Moved tabs: " + (packet.browserResult?.movedTabCount || 0) + " | Groups: " + (packet.browserResult?.recreatedGroupCount || 0) + ".";
  return "Threshold execution gate: " + packet.executionGate.status + " | Tabs: " + packet.tabStatus.totalTabs + " | Open: " + packet.tabStatus.openTabs + " | Groups: " + packet.browserPlan.plannedGroupCount + " | Available: " + packet.executionGate.availableInThisSlice + ".";
}

function getPacketStatus(packet) {
  return packet?.execution?.status || packet?.executionGate?.status || "unknown";
}

function setSummary(message) {
  const summary = document.getElementById("dedicatedWindowThresholdExecutionSummary");
  if (summary) summary.textContent = message;
}

function setStatus(message) {
  const status = document.getElementById("dedicatedWindowThresholdExecutionStatus");
  if (status) status.textContent = message;
}

function setOutput(value) {
  const output = document.getElementById("dedicatedWindowThresholdExecutionOutput");
  if (output) output.textContent = JSON.stringify(value, null, 2);
}

function setError(message, error) {
  setOutput({ status: "error", message, error: summarizeError(error) });
  setStatus(message);
}

function summarizeError(error) {
  return { name: error?.name || "Error", message: error?.message || String(error) };
}

function unique(values) {
  return Array.from(new Set(values));
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export { buildThresholdExecutionPrecheckPacket, createChromeGroupTitle, EXECUTION_PHRASE };
