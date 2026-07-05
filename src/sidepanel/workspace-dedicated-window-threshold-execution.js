import { getWorkspace } from "../core/workspace-store.js";

const DEDICATED_WINDOW_THRESHOLD = 4;
const TARGET_MODE = "new_window";
const EXECUTION_PHRASE = "MOVE WORKSPACE TO DEDICATED WINDOW";
const PACKET_ENVELOPE_START = "CHROME_FLOW_PACKET_START";
const PACKET_ENVELOPE_END = "CHROME_FLOW_PACKET_END";
const PACKET_CLIPBOARD_FORMAT = "chrome_flow_packet_envelope_v0.1";
const PACKET_CONTENT_TYPE = "application/json";
const EXECUTION_SETTLE_DELAY_MS = 450;

let lastExecutionGatePacket = null;
let lastExecutionPacket = null;
let executionInProgress = false;

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
    <p class="section-help">Moves active workspace-owned tabs into one dedicated Chrome window after all threshold gates pass. This is a live browser action.</p>
    <div id="dedicatedWindowThresholdExecutionSummary" class="workspace-session-summary">Threshold execution surface loaded.</div>
    <div class="workspace-session-options">
      <p><strong>Target mode:</strong> ${TARGET_MODE}</p>
      <p><strong>Required execution phrase:</strong> ${EXECUTION_PHRASE}</p>
      <label for="dedicatedWindowThresholdExecutionPhrase">Type execution phrase</label>
      <input id="dedicatedWindowThresholdExecutionPhrase" type="text" placeholder="${EXECUTION_PHRASE}" />
      <label class="checkbox-label"><input id="dedicatedWindowThresholdExecutionAcknowledgement" type="checkbox" /> I understand this will move active workspace-owned tabs into a dedicated/new Chrome window.</label>
    </div>
    <div class="workspace-session-actions">
      <button id="prepareDedicatedWindowThresholdExecutionButton" type="button" class="secondary-button">Prepare Threshold Execution Gate Packet</button>
      <button id="runDedicatedWindowThresholdExecutionButton" type="button" class="danger-button" disabled>Run Dedicated Window Move</button>
      <button id="copyDedicatedWindowThresholdExecutionPacketButton" type="button" class="secondary-button">Copy Latest Threshold Execution Packet</button>
    </div>
    <p id="dedicatedWindowThresholdExecutionStatus" class="status-message"></p>
    <pre id="dedicatedWindowThresholdExecutionOutput" class="diagnostics-output">Dedicated window threshold execution output will appear here.</pre>
  `;

  anchor.insertAdjacentElement("afterend", section);

  document.getElementById("prepareDedicatedWindowThresholdExecutionButton")?.addEventListener("click", prepareExecutionGatePacket);
  document.getElementById("runDedicatedWindowThresholdExecutionButton")?.addEventListener("click", runDedicatedWindowExecution);
  document.getElementById("copyDedicatedWindowThresholdExecutionPacketButton")?.addEventListener("click", copyExecutionPacket);

  setSummary("Threshold execution ready. Prepare a gate packet before running live browser action.");
  setStatus("Threshold execution loaded. No live action has run.");
}

async function prepareExecutionGatePacket() {
  try {
    const packet = await buildExecutionGatePacket();
    lastExecutionGatePacket = packet;
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Threshold execution gate packet prepared: " + packet.executionGate.status + ".");
    updateRunButton(packet);
  } catch (error) {
    setError("Could not prepare threshold execution gate packet.", error);
  }
}

async function copyExecutionPacket() {
  try {
    const packet = lastExecutionPacket || lastExecutionGatePacket || await buildExecutionGatePacket();
    await navigator.clipboard.writeText(formatPacket(packet));
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Threshold execution packet copied: " + getPacketStatus(packet) + ".");
  } catch (error) {
    setError("Could not copy threshold execution packet.", error);
  }
}

async function runDedicatedWindowExecution() {
  if (executionInProgress) {
    setStatus("Threshold execution is already running.");
    return;
  }

  executionInProgress = true;
  const runButton = document.getElementById("runDedicatedWindowThresholdExecutionButton");
  if (runButton) runButton.disabled = true;

  let runtimeActionStarted = false;
  let browserProjectionChanged = false;

  try {
    const gatePacket = await buildExecutionGatePacket();
    lastExecutionGatePacket = gatePacket;

    if (gatePacket.executionGate.status !== "ready_for_live_threshold_execution") {
      setSummary(createSummary(gatePacket));
      setOutput(gatePacket);
      setStatus("Threshold execution blocked: " + gatePacket.executionGate.status + ".");
      return;
    }

    setStatus("Running threshold execution. Moving workspace tabs into one dedicated Chrome window...");
    const executionPacket = await executeDedicatedWindowMove(gatePacket, {
      markRuntimeStarted: () => { runtimeActionStarted = true; },
      markBrowserChanged: () => { browserProjectionChanged = true; }
    });

    lastExecutionPacket = executionPacket;
    setSummary(createSummary(executionPacket));
    setOutput(executionPacket);
    setStatus("Threshold execution complete: " + executionPacket.execution.status + ".");
  } catch (error) {
    const failurePacket = await buildExecutionFailurePacket({ error, runtimeActionStarted, browserProjectionChanged });
    lastExecutionPacket = failurePacket;
    setSummary(createSummary(failurePacket));
    setOutput(failurePacket);
    setStatus("Threshold execution failed. Copy the execution packet for review.");
  } finally {
    executionInProgress = false;
    const nextGatePacket = await safeBuildExecutionGatePacket();
    updateRunButton(nextGatePacket);
  }
}

async function buildExecutionGatePacket(overrides = null) {
  const workspace = overrides?.workspace || await getWorkspace();
  const tabs = sortTabsByRuntimeOrder(Array.isArray(overrides?.tabs) ? overrides.tabs : Array.isArray(workspace?.tabs) ? workspace.tabs : []);
  const tabStatus = buildTabStatus(tabs);
  const plannedGroups = createPlannedGroups(tabs);
  const policy = classifyWorkspace(tabStatus.totalTabs);
  const phrase = overrides?.phrase ?? getExecutionPhrase();
  const acknowledgementChecked = overrides?.acknowledgementChecked ?? Boolean(document.getElementById("dedicatedWindowThresholdExecutionAcknowledgement")?.checked);
  const phraseMatches = phrase === EXECUTION_PHRASE;
  const operatorConfirmed = phraseMatches && acknowledgementChecked;
  const checks = createExecutionGateChecks({ workspace, tabs, tabStatus, plannedGroups, policy, phraseMatches, acknowledgementChecked });
  const failedChecks = checks.filter((check) => check.status === "fail");
  const ready = failedChecks.length === 0;

  return {
    packetType: "Chrome Flow Dedicated Window Threshold Execution Gate Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "dedicated-window-threshold-execution-gate-packet-v0.1"
    },
    clipboard: createClipboardBlock(),
    source: {
      type: "workspace_dedicated_window_threshold_execution_gate",
      readOnly: true,
      executionGateOnly: true,
      liveActionAvailable: ready,
      runtimeActionExecuted: false,
      browserProjectionChanged: false,
      sessionDbChanged: false,
      chromeStorageRuntimeChanged: false,
      runButtonShouldBeEnabled: ready
    },
    workspace: createWorkspaceBlock(workspace),
    thresholdPolicy: {
      thresholdTabCount: DEDICATED_WINDOW_THRESHOLD,
      targetMode: TARGET_MODE,
      policyStatus: policy.status,
      dedicatedWindowPolicyActive: policy.dedicatedWindowPolicyActive,
      currentWindowStillValid: policy.currentWindowStillValid
    },
    tabStatus,
    browserPlan: {
      targetMode: TARGET_MODE,
      action: "move_workspace_tabs_to_new_window",
      expectedWindowCount: ready ? 1 : 0,
      plannedTabCount: tabs.length,
      plannedTabIds: tabs.map((tab) => tab.tabId).filter(Number.isInteger),
      plannedGroupCount: plannedGroups.length,
      plannedGroups
    },
    operatorExecution: {
      requiredPhrase: EXECUTION_PHRASE,
      phraseMatches,
      acknowledgementChecked,
      operatorConfirmed
    },
    executionGate: {
      status: ready ? "ready_for_live_threshold_execution" : "blocked_before_live_threshold_execution",
      readyForLiveAction: ready,
      availableInThisSlice: ready,
      checks,
      failedChecks,
      blockedReasons: failedChecks.map((check) => check.message),
      notes: [
        "This packet is a live execution gate packet.",
        "The live action may move only active workspace-owned tabs into one dedicated/new Chrome window.",
        "No unrelated tabs may be moved.",
        "No existing tabs or windows may be closed by this command.",
        "Session DB is not written by this command.",
        "chrome.storage.local active workspace is not replaced by this command."
      ]
    }
  };
}

async function executeDedicatedWindowMove(gatePacket, hooks = {}) {
  const commandId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const workspaceBefore = await getWorkspace();
  const tabs = sortTabsByRuntimeOrder(Array.isArray(workspaceBefore?.tabs) ? workspaceBefore.tabs : []);
  const plannedGroups = createPlannedGroups(tabs);
  const snapshotBefore = await captureBrowserSnapshot();

  hooks.markRuntimeStarted?.();
  const browserResult = await moveWorkspaceTabsToDedicatedWindow({ tabs, plannedGroups });
  hooks.markBrowserChanged?.();
  await delay(EXECUTION_SETTLE_DELAY_MS);

  const snapshotAfter = await captureBrowserSnapshot();
  const workspaceAfter = await getWorkspace();
  const verification = verifyExecution({
    tabs,
    plannedGroups,
    browserResult,
    snapshotBefore,
    snapshotAfter,
    workspaceBefore,
    workspaceAfter
  });
  const status = verification.failedChecks.length ? "completed_with_verification_failures" : "completed_verified";

  return {
    packetType: "Chrome Flow Dedicated Window Threshold Execution Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "dedicated-window-threshold-execution-packet-v0.1"
    },
    clipboard: gatePacket.clipboard,
    commandEnvelope: {
      command: "projection.workspace_dedicated_window_threshold_execution",
      commandId,
      authorityClass: "live_browser_action_operator_confirmed",
      targetMode: TARGET_MODE,
      startedAt,
      finishedAt: new Date().toISOString()
    },
    source: {
      type: "workspace_dedicated_window_threshold_execution",
      runtimeActionExecuted: true,
      browserProjectionChanged: true,
      sessionDbChanged: false,
      chromeStorageRuntimeChanged: false,
      existingTabsOrWindowsClosed: false,
      unrelatedTabsMoved: false
    },
    workspace: gatePacket.workspace,
    operatorExecution: gatePacket.operatorExecution,
    browserPlan: gatePacket.browserPlan,
    browserResult,
    snapshotBefore,
    snapshotAfter,
    runtimeReview: {
      activeRuntimeWorkspaceIdBefore: workspaceBefore?.workspaceId || "",
      activeRuntimeWorkspaceIdAfter: workspaceAfter?.workspaceId || "",
      chromeStorageRuntimeAuthorityPreserved: workspaceBefore?.workspaceId === workspaceAfter?.workspaceId
    },
    verification,
    execution: {
      status,
      notes: [
        "Active workspace-owned tabs were moved into one dedicated/new Chrome window.",
        "Chrome groups were recreated from active workspace role evidence.",
        "No existing tabs or windows were intentionally closed.",
        "No Session DB records were intentionally mutated.",
        "chrome.storage.local active workspace was not intentionally replaced."
      ]
    }
  };
}

async function moveWorkspaceTabsToDedicatedWindow({ tabs, plannedGroups }) {
  const [firstTab, ...remainingTabs] = tabs;
  if (!Number.isInteger(firstTab?.tabId)) {
    throw new Error("Cannot move workspace tabs: first workspace tab does not have a live tab id.");
  }

  const createdWindow = await chrome.windows.create({ tabId: firstTab.tabId, focused: false, state: "normal" });
  const createdWindowId = createdWindow.id;
  if (!Number.isInteger(createdWindowId)) throw new Error("Chrome did not return a dedicated window id.");

  const movedTabs = [createMovedTabEvidence(firstTab, createdWindowId, 0)];

  for (let index = 0; index < remainingTabs.length; index += 1) {
    const workspaceTab = remainingTabs[index];
    if (!Number.isInteger(workspaceTab.tabId)) {
      throw new Error("Cannot move workspace tab without live tab id: " + (workspaceTab.workspaceTabId || workspaceTab.url || "unknown"));
    }
    const movedTab = await chrome.tabs.move(workspaceTab.tabId, { windowId: createdWindowId, index: index + 1 });
    movedTabs.push(createMovedTabEvidence(workspaceTab, createdWindowId, index + 1, movedTab));
  }

  const createdGroups = [];
  const movedTabIdByWorkspaceTabId = new Map(movedTabs.map((item) => [item.workspaceTabId, item.movedTabId]));

  for (const plannedGroup of plannedGroups) {
    const tabIds = plannedGroup.workspaceTabIds.map((workspaceTabId) => movedTabIdByWorkspaceTabId.get(workspaceTabId)).filter(Number.isInteger);
    if (tabIds.length !== plannedGroup.workspaceTabIds.length) {
      createdGroups.push({ role: plannedGroup.role, roleLabel: plannedGroup.roleLabel, status: "failed_missing_moved_tabs", workspaceTabIds: plannedGroup.workspaceTabIds, tabIds });
      continue;
    }
    const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId: createdWindowId } });
    await chrome.tabGroups.update(groupId, { title: plannedGroup.roleLabel, collapsed: false });
    createdGroups.push({ role: plannedGroup.role, roleLabel: plannedGroup.roleLabel, groupId, windowId: createdWindowId, tabIds, workspaceTabIds: plannedGroup.workspaceTabIds, status: "created" });
  }

  await chrome.windows.update(createdWindowId, { focused: true });

  return {
    createdWindowId,
    movedTabs,
    movedTabIds: movedTabs.map((item) => item.movedTabId),
    createdGroups,
    createdGroupIds: createdGroups.filter((item) => Number.isInteger(item.groupId)).map((item) => item.groupId),
    focusAfterMove: true
  };
}

function createMovedTabEvidence(workspaceTab, createdWindowId, savedOrder, movedTab = null) {
  return {
    workspaceTabId: workspaceTab.workspaceTabId,
    savedOrder,
    savedRole: workspaceTab.role || "unassigned",
    savedUrl: workspaceTab.url,
    movedTabId: workspaceTab.tabId,
    movedWindowId: movedTab?.windowId || createdWindowId,
    status: "moved"
  };
}

function verifyExecution(context) {
  const checks = [];
  const createdWindowId = context.browserResult.createdWindowId;
  const movedTabIds = context.browserResult.movedTabIds;
  const createdGroupIds = context.browserResult.createdGroupIds;
  const beforeWindowIds = new Set(context.snapshotBefore.windowIds);
  const afterWindowIds = new Set(context.snapshotAfter.windowIds);
  const beforeTabIds = new Set(context.snapshotBefore.tabIds);
  const afterTabIds = new Set(context.snapshotAfter.tabIds);
  const afterTabsById = new Map(context.snapshotAfter.tabs.map((tab) => [tab.tabId, tab]));
  const movedTabSet = new Set(movedTabIds);

  checks.push(createVerificationCheck("created_window_exists", Number.isInteger(createdWindowId) && afterWindowIds.has(createdWindowId), "Dedicated window exists after execution."));
  checks.push(createVerificationCheck("created_window_not_present_before", Number.isInteger(createdWindowId) && !beforeWindowIds.has(createdWindowId), "Dedicated window was not present before execution."));
  checks.push(createVerificationCheck("moved_tab_count_matches_workspace", movedTabIds.length === context.tabs.length, "Moved tab count matches active workspace tab count."));
  checks.push(createVerificationCheck("moved_tabs_preserve_tab_ids", movedTabIds.every((tabId) => beforeTabIds.has(tabId) && afterTabIds.has(tabId)), "Moved tabs preserve their existing tab ids."));
  checks.push(createVerificationCheck("moved_tabs_in_dedicated_window", movedTabIds.every((tabId) => afterTabsById.get(tabId)?.windowId === createdWindowId), "Moved tabs are in the dedicated window."));
  checks.push(createVerificationCheck("created_group_count_matches_plan", createdGroupIds.length === context.plannedGroups.length, "Created group count matches planned group count."));
  checks.push(createVerificationCheck("created_groups_only_contain_moved_tabs", createdGroupsOnlyContainMovedTabs(context.browserResult.createdGroups, movedTabSet), "Created groups contain only moved workspace tabs."));
  checks.push(createVerificationCheck("before_windows_preserved_or_source_window_adjusted", [...beforeWindowIds].every((windowId) => afterWindowIds.has(windowId) || windowId === context.snapshotBefore.activeWindowId), "No unrelated before-run windows disappeared."));
  checks.push(createVerificationCheck("before_tabs_preserved", [...beforeTabIds].every((tabId) => afterTabIds.has(tabId)), "No before-run tabs disappeared."));
  checks.push(createVerificationCheck("chrome_storage_runtime_workspace_unchanged", context.workspaceBefore?.workspaceId === context.workspaceAfter?.workspaceId, "chrome.storage.local active workspace id is unchanged."));

  const failedChecks = checks.filter((check) => check.status === "fail");
  return {
    status: failedChecks.length ? "verification_failed" : "verified",
    checks,
    failedChecks
  };
}

async function captureBrowserSnapshot() {
  const windows = await chrome.windows.getAll({ populate: true });
  const focusedWindow = windows.find((window) => window.focused) || null;
  const tabs = windows.flatMap((window) => (window.tabs || []).map((tab) => ({
    tabId: tab.id,
    windowId: tab.windowId,
    groupId: tab.groupId,
    url: tab.url || "",
    title: tab.title || "",
    index: tab.index
  })));

  return {
    capturedAt: new Date().toISOString(),
    activeWindowId: focusedWindow?.id || null,
    windowIds: windows.map((window) => window.id).filter(Number.isInteger),
    tabIds: tabs.map((tab) => tab.tabId).filter(Number.isInteger),
    windows: windows.map((window) => ({ windowId: window.id, focused: Boolean(window.focused), tabCount: window.tabs?.length || 0 })),
    tabs
  };
}

function buildTabStatus(tabs) {
  const totalTabs = tabs.length;
  const tabsWithUrls = tabs.filter((tab) => Boolean(tab.url)).length;
  const assignedTabs = tabs.filter((tab) => tab.role && tab.role !== "unassigned").length;
  const tabIdsAvailable = tabs.filter((tab) => Number.isInteger(tab.tabId)).length;
  const unassignedTabs = totalTabs - assignedTabs;
  const roleCounts = tabs.reduce((counts, tab) => {
    const role = tab.role || "unassigned";
    counts[role] = (counts[role] || 0) + 1;
    return counts;
  }, {});
  return { totalTabs, tabsWithUrls, missingUrlCount: totalTabs - tabsWithUrls, assignedTabs, unassignedTabs, tabIdsAvailable, missingTabIdCount: totalTabs - tabIdsAvailable, roleCounts };
}

function classifyWorkspace(totalTabs) {
  if (totalTabs <= 0) return { status: "no_workspace_tabs_detected", dedicatedWindowPolicyActive: false, currentWindowStillValid: true };
  if (totalTabs < DEDICATED_WINDOW_THRESHOLD) return { status: "current_window_valid", dedicatedWindowPolicyActive: false, currentWindowStillValid: true };
  return { status: "dedicated_window_policy_active", dedicatedWindowPolicyActive: true, currentWindowStillValid: false };
}

function createExecutionGateChecks({ workspace, tabs, tabStatus, plannedGroups, policy, phraseMatches, acknowledgementChecked }) {
  return [
    createCheck("runtime_workspace_exists", Boolean(workspace?.workspaceId), "Active runtime workspace exists."),
    createCheck("dedicated_window_policy_active", policy.dedicatedWindowPolicyActive === true, "Active workspace is in the 4+ tab dedicated-window policy range."),
    createCheck("minimum_tab_threshold_met", tabStatus.totalTabs >= DEDICATED_WINDOW_THRESHOLD, "Active workspace has at least 4 tabs."),
    createCheck("workspace_tabs_have_live_tab_ids", tabStatus.totalTabs > 0 && tabStatus.missingTabIdCount === 0, "All active workspace tabs have live tab ids."),
    createCheck("workspace_tabs_have_urls", tabStatus.totalTabs > 0 && tabStatus.missingUrlCount === 0, "All active workspace tabs have URLs."),
    createCheck("workspace_tabs_have_roles", tabStatus.totalTabs > 0 && tabStatus.unassignedTabs === 0, "All active workspace tabs have assigned roles."),
    createCheck("planned_groups_available", plannedGroups.length > 0, "Planned role groups are available."),
    createCheck("target_mode_new_window", TARGET_MODE === "new_window", "Target mode is new_window."),
    createCheck("operator_phrase_matches", phraseMatches, "Operator typed the required execution phrase."),
    createCheck("operator_acknowledgement_checked", acknowledgementChecked, "Operator checked the threshold execution acknowledgement."),
    createCheck("no_runtime_action_executed_yet", true, "Gate packet does not execute runtime action."),
    createCheck("no_browser_projection_changed_yet", true, "Gate packet does not change browser projection."),
    createCheck("no_session_db_changed", true, "Gate packet does not write Session DB."),
    createCheck("no_chrome_storage_runtime_changed", true, "Gate packet does not replace chrome.storage.local runtime workspace.")
  ];
}

function createPlannedGroups(tabs) {
  const roles = new Map();
  for (const tab of tabs) {
    const role = tab.role || "unassigned";
    if (role === "unassigned") continue;
    if (!roles.has(role)) roles.set(role, []);
    roles.get(role).push(tab.workspaceTabId || String(tab.tabId || tab.url));
  }
  return Array.from(roles.entries()).map(([role, workspaceTabIds]) => ({ role, roleLabel: createRoleLabel(role), workspaceTabIds, plannedTabCount: workspaceTabIds.length, requiredForProjection: true }));
}

function createRoleLabel(role) {
  return String(role || "unassigned").replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sortTabsByRuntimeOrder(tabs) {
  return [...tabs].sort((left, right) => {
    const leftIndex = Number.isInteger(left.index) ? left.index : Number.MAX_SAFE_INTEGER;
    const rightIndex = Number.isInteger(right.index) ? right.index : Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return String(left.workspaceTabId || left.tabId || left.url || "").localeCompare(String(right.workspaceTabId || right.tabId || right.url || ""));
  });
}

function createWorkspaceBlock(workspace) {
  return { workspaceId: workspace?.workspaceId || "", name: workspace?.name || "", workspaceType: workspace?.workspaceType || workspace?.type || "", aim: workspace?.aim || "" };
}

function createdGroupsOnlyContainMovedTabs(groups, movedTabSet) {
  return groups.filter((group) => Number.isInteger(group.groupId)).every((group) => group.tabIds.every((tabId) => movedTabSet.has(tabId)));
}

function createCheck(check, passed, message) {
  return { check, status: passed ? "pass" : "fail", severity: "block", message };
}

function createVerificationCheck(check, passed, message) {
  return { check, status: passed ? "pass" : "fail", severity: "verify", message };
}

async function buildExecutionFailurePacket({ error, runtimeActionStarted, browserProjectionChanged }) {
  const snapshotAfterFailure = await captureBrowserSnapshot().catch(() => null);
  return {
    packetType: "Chrome Flow Dedicated Window Threshold Execution Packet",
    createdAt: new Date().toISOString(),
    extension: { name: "Chrome Flow", schema: "dedicated-window-threshold-execution-packet-v0.1" },
    clipboard: createClipboardBlock(),
    source: { type: "workspace_dedicated_window_threshold_execution_failure", runtimeActionExecuted: runtimeActionStarted, browserProjectionChanged, sessionDbChanged: false, chromeStorageRuntimeChanged: false },
    error: summarizeError(error),
    snapshotAfterFailure,
    execution: { status: runtimeActionStarted ? "failed_after_runtime_action_started" : "failed_before_runtime_action_started" }
  };
}

async function safeBuildExecutionGatePacket() {
  try { return await buildExecutionGatePacket(); } catch { return null; }
}

function updateRunButton(packet) {
  const button = document.getElementById("runDedicatedWindowThresholdExecutionButton");
  if (!button) return;
  button.disabled = packet?.executionGate?.status !== "ready_for_live_threshold_execution";
}

function getExecutionPhrase() {
  return document.getElementById("dedicatedWindowThresholdExecutionPhrase")?.value.trim() || "";
}

function createClipboardBlock() {
  return { format: PACKET_CLIPBOARD_FORMAT, contentType: PACKET_CONTENT_TYPE, copyMode: "text_envelope", envelopeStart: PACKET_ENVELOPE_START, envelopeEnd: PACKET_ENVELOPE_END };
}

function formatPacket(packet) {
  return [packet.clipboard.envelopeStart, "packetType: " + packet.packetType, "schema: " + packet.extension.schema, "clipboardFormat: " + packet.clipboard.format, "createdAt: " + packet.createdAt, "contentType: " + packet.clipboard.contentType, "", JSON.stringify(packet, null, 2), "", packet.clipboard.envelopeEnd].join("\n");
}

function getPacketStatus(packet) {
  return packet.execution?.status || packet.executionGate?.status || "unknown";
}

function createSummary(packet) {
  const status = getPacketStatus(packet);
  const tabs = packet.tabStatus?.totalTabs || packet.browserPlan?.plannedTabCount || 0;
  return "Threshold execution: " + status + " | Tabs: " + tabs + " | Live action: " + Boolean(packet.source?.runtimeActionExecuted) + ".";
}

function summarizeError(error) {
  return { message: error?.message || String(error), name: error?.name || "Error" };
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

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export { buildExecutionGatePacket, EXECUTION_PHRASE };
