import { getWorkspace } from "../core/workspace-store.js";

import {
  getActiveWorkspaceId,
  getWorkspaceProjections,
  getWorkspaceRecord,
  getWorkspaceSessions,
  getWorkspaceTabs,
  listWorkspaceRecords
} from "../core/session-repository.js";

const DEFAULT_TARGET_WORKSPACE_ID = "c22b5a00-c68d-4b64-8bba-01172a0dd818";
const DEFAULT_TARGET_WORKSPACE_NAME = "Layer 2 Rehydration Candidate Test";
const RUN_PHRASE = "OPEN NEW WINDOW FOR SAVED WORKSPACE";
const PACKET_ENVELOPE_START = "CHROME_FLOW_PACKET_START";
const PACKET_ENVELOPE_END = "CHROME_FLOW_PACKET_END";
const PACKET_CLIPBOARD_FORMAT = "chrome_flow_packet_envelope_v0.1";
const PACKET_CONTENT_TYPE = "application/json";
const RUN_SETTLE_DELAY_MS = 450;

let lastPreparedPacket = null;
let lastExecutionPacket = null;
let liveResumeInProgress = false;

installProjectionResumeRunPrecheck();

function installProjectionResumeRunPrecheck() {
  if (document.getElementById("projectionResumeRunSection")) return;

  const anchor = document.getElementById("projectionResumeReviewSection") || document.querySelector(".workspace-section");
  if (!anchor) return;

  const section = document.createElement("section");
  section.id = "projectionResumeRunSection";
  section.className = "projection-resume-run-section";
  section.innerHTML = `
    <h2>Projection Resume Run Prototype</h2>
    <p class="section-help">Precheck and run the first controlled known-fixture resume path. This slice can create one new Chrome window only after all gates pass.</p>
    <div id="projectionResumeRunSummary" class="workspace-session-summary">Run surface loaded.</div>
    <div class="workspace-session-options">
      <p><strong>First live fixture:</strong> ${DEFAULT_TARGET_WORKSPACE_NAME}</p>
      <p><strong>Target mode:</strong> new_window only</p>
      <p><strong>Required run phrase:</strong> ${RUN_PHRASE}</p>
      <label for="projectionResumeCandidateSelect">Resume candidate</label>
      <select id="projectionResumeCandidateSelect">
        <option value="${DEFAULT_TARGET_WORKSPACE_ID}">${DEFAULT_TARGET_WORKSPACE_NAME}</option>
      </select>
      <label for="projectionResumeRunPhrase">Type run phrase</label>
      <input id="projectionResumeRunPhrase" type="text" placeholder="OPEN NEW WINDOW FOR SAVED WORKSPACE" />
      <label class="checkbox-label"><input id="projectionResumeRunAcknowledgement" type="checkbox" /> I understand this will create one new Chrome window from the saved workspace records.</label>
    </div>
    <div class="workspace-session-actions">
      <button id="refreshProjectionResumeRunCandidateButton" type="button" class="secondary-button">Refresh Run Candidates</button>
      <button id="prepareProjectionResumeRunPrecheckButton" type="button" class="secondary-button">Prepare Run Precheck</button>
      <button id="runProjectionResumePrototypeButton" type="button" class="danger-button" disabled>Run Known Fixture Resume</button>
      <button id="copyProjectionResumeRunPacketButton" type="button" class="secondary-button">Copy Latest Run Packet</button>
    </div>
    <p id="projectionResumeRunStatus" class="status-message"></p>
    <pre id="projectionResumeRunOutput" class="diagnostics-output">Projection resume run output will appear here.</pre>
  `;

  anchor.insertAdjacentElement("afterend", section);

  document.getElementById("refreshProjectionResumeRunCandidateButton")?.addEventListener("click", refreshCandidates);
  document.getElementById("prepareProjectionResumeRunPrecheckButton")?.addEventListener("click", preparePacket);
  document.getElementById("runProjectionResumePrototypeButton")?.addEventListener("click", runKnownFixtureResume);
  document.getElementById("copyProjectionResumeRunPacketButton")?.addEventListener("click", copyPacket);

  refreshCandidates();
}

async function refreshCandidates() {
  try {
    const candidates = await buildCandidateSummaries();
    renderCandidateOptions(candidates);
    const packet = await buildPreRunPacket(candidates);
    lastPreparedPacket = packet;
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Run candidates refreshed: " + candidates.length + " Session DB workspace records inspected.");
    updateRunButton(packet);
  } catch (error) {
    setError("Could not refresh run candidates.", error);
  }
}

async function preparePacket() {
  try {
    const candidates = await buildCandidateSummaries();
    renderCandidateOptions(candidates);
    const packet = await buildPreRunPacket(candidates);
    lastPreparedPacket = packet;
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Run precheck packet prepared: " + packet.preRun.status + ".");
    updateRunButton(packet);
  } catch (error) {
    setError("Could not prepare run precheck packet.", error);
  }
}

async function copyPacket() {
  try {
    const packet = lastExecutionPacket || lastPreparedPacket || await buildPreRunPacket();
    await navigator.clipboard.writeText(formatPacket(packet));
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Run packet copied: " + getPacketStatus(packet) + ".");
  } catch (error) {
    setError("Could not copy run packet.", error);
  }
}

async function runKnownFixtureResume() {
  if (liveResumeInProgress) {
    setStatus("Known fixture resume is already running.");
    return;
  }

  liveResumeInProgress = true;
  const runButton = document.getElementById("runProjectionResumePrototypeButton");
  if (runButton) runButton.disabled = true;

  let runtimeActionStarted = false;
  let browserProjectionChanged = false;
  try {
    const preRunPacket = await buildPreRunPacket();
    lastPreparedPacket = preRunPacket;

    if (preRunPacket.preRun.status !== "ready_for_operator_run") {
      setSummary(createSummary(preRunPacket));
      setOutput(preRunPacket);
      setStatus("Run blocked: " + preRunPacket.preRun.status + ".");
      return;
    }

    setStatus("Running known fixture resume. Creating one new Chrome window from saved records...");
    const executionPacket = await executeKnownFixtureResume(preRunPacket, {
      markRuntimeStarted: () => { runtimeActionStarted = true; },
      markBrowserChanged: () => { browserProjectionChanged = true; }
    });
    lastExecutionPacket = executionPacket;
    setSummary(createSummary(executionPacket));
    setOutput(executionPacket);
    setStatus("Known fixture resume complete: " + executionPacket.execution.status + ".");
  } catch (error) {
    const failurePacket = await buildExecutionFailurePacket({ error, runtimeActionStarted, browserProjectionChanged });
    lastExecutionPacket = failurePacket;
    setSummary(createSummary(failurePacket));
    setOutput(failurePacket);
    setStatus("Known fixture resume failed. Copy the run packet for review.");
  } finally {
    liveResumeInProgress = false;
    const nextPreRunPacket = await safeBuildPreRunPacket();
    updateRunButton(nextPreRunPacket);
  }
}

async function buildCandidateSummaries() {
  const workspaces = await listWorkspaceRecords();
  const summaries = [];

  for (const workspace of workspaces) {
    const tabs = sortTabsBySavedOrder(await getWorkspaceTabs(workspace.workspaceId));
    const sessions = await getWorkspaceSessions(workspace.workspaceId);
    const projections = await getWorkspaceProjections(workspace.workspaceId);
    const plannedGroups = createPlannedGroups(tabs);
    const missingUrlCount = tabs.filter((tab) => !tab.url).length;
    const latestProjection = projections[0] || null;
    const eligibility = createCandidateEligibility({ workspace, tabs, sessions, plannedGroups, missingUrlCount, latestProjection });

    summaries.push({
      workspaceId: workspace.workspaceId,
      name: workspace.name,
      lifecycleState: workspace.lifecycleState,
      savedTabCount: tabs.length,
      missingUrlCount,
      plannedGroupCount: plannedGroups.length,
      sessionCount: sessions.length,
      projectionCount: projections.length,
      latestProjectionState: latestProjection?.projectionState || "missing",
      eligibleForPrecheck: eligibility.every((check) => check.status === "pass"),
      eligibility
    });
  }

  return summaries;
}

function renderCandidateOptions(candidates) {
  const select = document.getElementById("projectionResumeCandidateSelect");
  if (!select) return;

  const selectedBeforeRefresh = getSelectedWorkspaceId();
  const candidateIds = new Set(candidates.map((candidate) => candidate.workspaceId));
  select.innerHTML = "";

  for (const candidate of candidates) {
    const option = document.createElement("option");
    option.value = candidate.workspaceId;
    option.textContent = createCandidateLabel(candidate);
    if (!candidate.eligibleForPrecheck) option.dataset.precheck = "blocked";
    select.appendChild(option);
  }

  if (!candidateIds.has(DEFAULT_TARGET_WORKSPACE_ID)) {
    const option = document.createElement("option");
    option.value = DEFAULT_TARGET_WORKSPACE_ID;
    option.textContent = DEFAULT_TARGET_WORKSPACE_NAME + " — not found in Session DB";
    option.dataset.precheck = "missing";
    select.appendChild(option);
  }

  select.value = candidateIds.has(selectedBeforeRefresh) ? selectedBeforeRefresh : DEFAULT_TARGET_WORKSPACE_ID;
}

function createCandidateLabel(candidate) {
  const status = candidate.eligibleForPrecheck ? "eligible" : "blocked";
  const fixture = candidate.workspaceId === DEFAULT_TARGET_WORKSPACE_ID ? " first-live-fixture" : "";
  return `${candidate.name} — tabs:${candidate.savedTabCount} groups:${candidate.plannedGroupCount} projection:${candidate.latestProjectionState} ${status}${fixture}`;
}

async function buildPreRunPacket(candidateSummaries = null) {
  const activeRuntimeWorkspace = await getWorkspace();
  const activeDbWorkspaceId = await getActiveWorkspaceId();
  const candidates = candidateSummaries || await buildCandidateSummaries();
  const selectedWorkspaceId = getSelectedWorkspaceId();
  const workspace = await getWorkspaceRecord(selectedWorkspaceId);
  const tabs = sortTabsBySavedOrder(await getWorkspaceTabs(selectedWorkspaceId));
  const sessions = await getWorkspaceSessions(selectedWorkspaceId);
  const projections = await getWorkspaceProjections(selectedWorkspaceId);
  const latestProjection = projections[0] || null;
  const missingUrlCount = tabs.filter((tab) => !tab.url).length;
  const plannedGroups = createPlannedGroups(tabs);
  const selectedCandidate = candidates.find((candidate) => candidate.workspaceId === selectedWorkspaceId) || null;
  const phraseMatches = getRunPhrase() === RUN_PHRASE;
  const acknowledgementChecked = Boolean(document.getElementById("projectionResumeRunAcknowledgement")?.checked);

  const checks = createChecks({ workspace, selectedWorkspaceId, tabs, sessions, missingUrlCount, plannedGroups, latestProjection, phraseMatches, acknowledgementChecked });
  const failedChecks = checks.filter((check) => check.status === "fail");
  const readyForRun = failedChecks.length === 0;
  const status = readyForRun ? "ready_for_operator_run" : "blocked_before_run";

  return {
    packetType: "Chrome Flow Projection Resume Run Precheck Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "projection-resume-run-precheck-packet-v0.3-live-known-fixture"
    },
    clipboard: {
      format: PACKET_CLIPBOARD_FORMAT,
      contentType: PACKET_CONTENT_TYPE,
      copyMode: "text_envelope",
      envelopeStart: PACKET_ENVELOPE_START,
      envelopeEnd: PACKET_ENVELOPE_END
    },
    source: {
      type: "projection_resume_run_live_known_fixture_precheck",
      readOnly: true,
      precheckOnly: true,
      liveActionAvailable: readyForRun,
      candidateSelectorEnabled: true,
      runtimeActionExecuted: false,
      browserProjectionChanged: false,
      sessionDbChanged: false,
      chromeStorageRuntimeChanged: false,
      runButtonShouldBeEnabled: readyForRun
    },
    candidateSelector: {
      mode: "session_db_candidate_selector_first_live_fixture_limited",
      selectedWorkspaceId,
      defaultWorkspaceId: DEFAULT_TARGET_WORKSPACE_ID,
      candidateCount: candidates.length,
      selectedCandidate,
      candidates
    },
    workspace: {
      expectedWorkspaceId: DEFAULT_TARGET_WORKSPACE_ID,
      expectedWorkspaceName: DEFAULT_TARGET_WORKSPACE_NAME,
      workspaceId: workspace?.workspaceId || "",
      name: workspace?.name || "",
      lifecycleState: workspace?.lifecycleState || "missing"
    },
    operatorConfirmation: {
      requiredPhrase: RUN_PHRASE,
      phraseMatches,
      acknowledgementChecked,
      operatorConfirmed: phraseMatches && acknowledgementChecked
    },
    browserPlan: {
      targetMode: "new_window",
      expectedWindowCount: 1,
      expectedTabCount: 3,
      savedTabCount: tabs.length,
      missingUrlCount,
      expectedGroupCount: 3,
      plannedGroupCount: plannedGroups.length,
      plannedGroups
    },
    sessionDbEvidence: {
      workspaceRecordRead: Boolean(workspace),
      workspaceTabRecordsRead: tabs.length,
      sessionRecordsRead: sessions.length,
      projectionRecordsRead: projections.length,
      latestProjectionState: latestProjection?.projectionState || "missing"
    },
    runtimeReview: {
      activeRuntimeWorkspaceId: activeRuntimeWorkspace?.workspaceId || "",
      activeRuntimeWorkspaceName: activeRuntimeWorkspace?.name || "",
      activeDbWorkspaceId,
      sessionDbRuntimeSourceOfTruth: false,
      chromeStorageRuntimeAuthorityPreserved: true,
      runtimeSelectionReviewOnly: true
    },
    preRun: {
      status,
      availableInThisSlice: readyForRun,
      checks,
      failedChecks,
      blockedReasons: failedChecks.map((check) => check.message),
      notes: [
        "This packet is a live-known-fixture pre-run packet.",
        "The run action is limited to the known 3-tab / 3-group fixture.",
        "The action can create one new Chrome window only after all gates pass.",
        "Session DB remains durable memory, not runtime authority.",
        "chrome.storage.local active workspace is not replaced by this command."
      ]
    }
  };
}

async function executeKnownFixtureResume(preRunPacket, hooks = {}) {
  const commandId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const activeRuntimeBefore = await getWorkspace();
  const activeDbWorkspaceIdBefore = await getActiveWorkspaceId();
  const workspace = await getWorkspaceRecord(DEFAULT_TARGET_WORKSPACE_ID);
  const tabs = sortTabsBySavedOrder(await getWorkspaceTabs(DEFAULT_TARGET_WORKSPACE_ID));
  const plannedGroups = createPlannedGroups(tabs);
  const snapshotBefore = await captureBrowserSnapshot();

  hooks.markRuntimeStarted?.();
  const creationResult = await createWindowTabsAndGroups({ tabs, plannedGroups });
  hooks.markBrowserChanged?.();
  await delay(RUN_SETTLE_DELAY_MS);

  const snapshotAfter = await captureBrowserSnapshot();
  const activeRuntimeAfter = await getWorkspace();
  const activeDbWorkspaceIdAfter = await getActiveWorkspaceId();
  const verification = verifyExecution({
    workspace,
    tabs,
    plannedGroups,
    creationResult,
    snapshotBefore,
    snapshotAfter,
    activeRuntimeBefore,
    activeRuntimeAfter,
    activeDbWorkspaceIdBefore,
    activeDbWorkspaceIdAfter
  });

  const status = verification.failedChecks.length ? "completed_with_verification_failures" : "completed_verified";

  return {
    packetType: "Chrome Flow Projection Resume Execution Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "projection-resume-execution-packet-v0.1-known-fixture"
    },
    clipboard: preRunPacket.clipboard,
    commandEnvelope: {
      command: "projection.resume_workspace",
      commandId,
      authorityClass: "live_browser_action_operator_confirmed",
      targetMode: "new_window",
      fixtureMode: "known_3_tab_3_group_fixture",
      startedAt,
      finishedAt: new Date().toISOString()
    },
    source: {
      type: "projection_resume_live_known_fixture_execution",
      runtimeActionExecuted: true,
      browserProjectionChanged: true,
      sessionDbChanged: false,
      chromeStorageRuntimeChanged: false,
      existingTabsOrWindowsClosed: false,
      unrelatedTabsMoved: false
    },
    preRun: preRunPacket.preRun,
    workspace: preRunPacket.workspace,
    operatorConfirmation: preRunPacket.operatorConfirmation,
    browserPlan: preRunPacket.browserPlan,
    browserResult: creationResult,
    snapshotBefore,
    snapshotAfter,
    runtimeReview: {
      activeRuntimeWorkspaceIdBefore: activeRuntimeBefore?.workspaceId || "",
      activeRuntimeWorkspaceIdAfter: activeRuntimeAfter?.workspaceId || "",
      activeDbWorkspaceIdBefore,
      activeDbWorkspaceIdAfter,
      sessionDbRuntimeSourceOfTruth: false,
      chromeStorageRuntimeAuthorityPreserved: activeRuntimeBefore?.workspaceId === activeRuntimeAfter?.workspaceId
    },
    verification,
    execution: {
      status,
      notes: [
        "One new Chrome window was created for the known fixture.",
        "Saved tabs were created from Session DB tab records.",
        "Chrome groups were created only from tabs created by this command.",
        "No existing tabs or windows were intentionally closed.",
        "No Session DB records were intentionally mutated.",
        "chrome.storage.local active workspace was not intentionally replaced."
      ]
    }
  };
}

async function createWindowTabsAndGroups({ tabs, plannedGroups }) {
  const createdTabs = [];
  const createdGroups = [];
  const [firstTab, ...remainingTabs] = tabs;
  const createdWindow = await chrome.windows.create({ url: firstTab.url, focused: false, state: "normal" });
  const createdWindowId = createdWindow.id;
  const firstCreatedTab = await getFirstCreatedTab(createdWindow);

  if (!Number.isInteger(createdWindowId) || !firstCreatedTab?.id) {
    throw new Error("Chrome did not return a usable created window/tab for the first saved record.");
  }

  createdTabs.push(createCreatedTabEvidence(firstTab, firstCreatedTab, 0));

  for (let index = 0; index < remainingTabs.length; index += 1) {
    const savedTab = remainingTabs[index];
    const createdTab = await chrome.tabs.create({ windowId: createdWindowId, url: savedTab.url, active: false, index: index + 1 });
    createdTabs.push(createCreatedTabEvidence(savedTab, createdTab, index + 1));
  }

  const createdTabIdByWorkspaceTabId = new Map(createdTabs.map((item) => [item.workspaceTabId, item.createdTabId]));

  for (const plannedGroup of plannedGroups) {
    const tabIds = plannedGroup.workspaceTabIds.map((workspaceTabId) => createdTabIdByWorkspaceTabId.get(workspaceTabId)).filter(Number.isInteger);
    if (tabIds.length !== plannedGroup.workspaceTabIds.length) {
      createdGroups.push({ role: plannedGroup.role, roleLabel: plannedGroup.roleLabel, status: "failed_missing_created_tabs", workspaceTabIds: plannedGroup.workspaceTabIds, tabIds });
      continue;
    }
    const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId: createdWindowId } });
    await chrome.tabGroups.update(groupId, { title: plannedGroup.roleLabel, collapsed: false });
    createdGroups.push({ role: plannedGroup.role, roleLabel: plannedGroup.roleLabel, groupId, windowId: createdWindowId, tabIds, workspaceTabIds: plannedGroup.workspaceTabIds, status: "created" });
  }

  await chrome.windows.update(createdWindowId, { focused: true });

  return {
    createdWindowId,
    createdTabs,
    createdTabIds: createdTabs.map((item) => item.createdTabId),
    createdGroups,
    createdGroupIds: createdGroups.filter((item) => Number.isInteger(item.groupId)).map((item) => item.groupId),
    focusAfterResume: true
  };
}

async function getFirstCreatedTab(createdWindow) {
  const returnedTab = Array.isArray(createdWindow?.tabs) ? createdWindow.tabs[0] : null;
  if (returnedTab?.id) return returnedTab;
  const tabs = await chrome.tabs.query({ windowId: createdWindow.id });
  return tabs[0] || null;
}

function createCreatedTabEvidence(savedTab, createdTab, savedOrder) {
  return {
    workspaceTabId: savedTab.workspaceTabId,
    savedOrder,
    savedRole: savedTab.role || "unassigned",
    savedUrl: savedTab.url,
    createdTabId: createdTab.id,
    createdWindowId: createdTab.windowId,
    status: "created"
  };
}

function verifyExecution(context) {
  const checks = [];
  const createdWindowId = context.creationResult.createdWindowId;
  const createdTabIds = context.creationResult.createdTabIds;
  const createdGroupIds = context.creationResult.createdGroupIds;
  const afterCreatedWindow = context.snapshotAfter.windows.find((window) => window.windowId === createdWindowId);
  const beforeWindowIds = new Set(context.snapshotBefore.windowIds);
  const afterWindowIds = new Set(context.snapshotAfter.windowIds);
  const beforeTabIds = new Set(context.snapshotBefore.tabIds);
  const afterTabIds = new Set(context.snapshotAfter.tabIds);
  const afterTabsById = new Map(context.snapshotAfter.tabs.map((tab) => [tab.tabId, tab]));
  const createdTabSet = new Set(createdTabIds);

  checks.push(createVerificationCheck("created_window_exists", Number.isInteger(createdWindowId) && afterWindowIds.has(createdWindowId), "Created window exists after execution."));
  checks.push(createVerificationCheck("created_window_not_present_before", Number.isInteger(createdWindowId) && !beforeWindowIds.has(createdWindowId), "Created window was not present before execution."));
  checks.push(createVerificationCheck("created_tab_count_matches_saved", createdTabIds.length === context.tabs.length, "Created tab count matches saved tab count."));
  checks.push(createVerificationCheck("created_tabs_exist_after", createdTabIds.every((tabId) => afterTabIds.has(tabId)), "All created tabs exist after execution."));
  checks.push(createVerificationCheck("created_tabs_in_created_window", createdTabIds.every((tabId) => afterTabsById.get(tabId)?.windowId === createdWindowId), "All created tabs are in the created window."));
  checks.push(createVerificationCheck("created_group_count_matches_plan", createdGroupIds.length === context.plannedGroups.length, "Created group count matches planned group count."));
  checks.push(createVerificationCheck("created_groups_only_contain_created_tabs", createdGroupsOnlyContainCreatedTabs(context.creationResult.createdGroups, createdTabSet), "Created groups contain only tabs created by this command."));
  checks.push(createVerificationCheck("before_windows_preserved", [...beforeWindowIds].every((windowId) => afterWindowIds.has(windowId)), "No before-run windows disappeared."));
  checks.push(createVerificationCheck("before_tabs_preserved", [...beforeTabIds].every((tabId) => afterTabIds.has(tabId)), "No before-run tabs disappeared."));
  checks.push(createVerificationCheck("chrome_storage_runtime_workspace_unchanged", context.activeRuntimeBefore?.workspaceId === context.activeRuntimeAfter?.workspaceId, "chrome.storage.local active workspace id is unchanged."));
  checks.push(createVerificationCheck("session_db_active_workspace_unchanged", context.activeDbWorkspaceIdBefore === context.activeDbWorkspaceIdAfter, "Session DB active workspace setting is unchanged."));

  const failedChecks = checks.filter((check) => check.status === "fail");

  return {
    status: failedChecks.length ? "verification_failed" : "verified",
    checks,
    failedChecks,
    createdWindow: afterCreatedWindow || null
  };
}

function createdGroupsOnlyContainCreatedTabs(groups, createdTabSet) {
  return groups.filter((group) => Number.isInteger(group.groupId)).every((group) => group.tabIds.every((tabId) => createdTabSet.has(tabId)));
}

function createVerificationCheck(check, passed, message) {
  return { check, status: passed ? "pass" : "fail", severity: "verify", message };
}

async function buildExecutionFailurePacket({ error, runtimeActionStarted, browserProjectionChanged }) {
  const snapshotAfterFailure = await captureBrowserSnapshot().catch(() => null);
  return {
    packetType: "Chrome Flow Projection Resume Execution Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "projection-resume-execution-packet-v0.1-known-fixture"
    },
    clipboard: createClipboardBlock(),
    source: {
      type: "projection_resume_live_known_fixture_execution_failure",
      runtimeActionExecuted: runtimeActionStarted,
      browserProjectionChanged,
      sessionDbChanged: false,
      chromeStorageRuntimeChanged: false
    },
    execution: {
      status: runtimeActionStarted ? "failed_after_runtime_action_started" : "failed_before_runtime_action_started",
      error: summarizeError(error),
      note: "Automatic cleanup is intentionally out of scope for this first live prototype."
    },
    snapshotAfterFailure
  };
}

async function captureBrowserSnapshot() {
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  const windowSummaries = windows.map((window) => ({
    windowId: window.id,
    focused: Boolean(window.focused),
    state: window.state || "unknown",
    tabIds: (window.tabs || []).map((tab) => tab.id).filter(Number.isInteger)
  }));
  const tabs = windows.flatMap((window) => (window.tabs || []).map((tab) => ({
    tabId: tab.id,
    windowId: tab.windowId,
    groupId: Number.isInteger(tab.groupId) ? tab.groupId : -1,
    url: tab.url || "",
    title: tab.title || ""
  })));
  return {
    capturedAt: new Date().toISOString(),
    windowIds: windowSummaries.map((window) => window.windowId).filter(Number.isInteger),
    tabIds: tabs.map((tab) => tab.tabId).filter(Number.isInteger),
    windows: windowSummaries,
    tabs
  };
}

function createCandidateEligibility(context) {
  return [
    createCheck("workspace_exists", Boolean(context.workspace), "Candidate workspace exists."),
    createCheck("workspace_not_archived", context.workspace?.lifecycleState !== "archived", "Candidate workspace is not archived."),
    createCheck("saved_tab_count_is_three", context.tabs.length === 3, "Candidate has exactly 3 saved tabs."),
    createCheck("saved_urls_available", context.missingUrlCount === 0, "Candidate saved tabs have URLs."),
    createCheck("role_group_evidence_exists", context.plannedGroups.length > 0, "Candidate has saved role/group evidence."),
    createCheck("planned_group_count_is_three", context.plannedGroups.length === 3, "Candidate has exactly 3 planned groups."),
    createCheck("session_record_available", context.sessions.length > 0, "Candidate has at least one Session DB session record."),
    createCheck("projection_record_available", Boolean(context.latestProjection), "Candidate has at least one projection record."),
    createCheck("projection_is_dehydrated", context.latestProjection?.projectionState === "dehydrated", "Candidate projection is dehydrated.")
  ];
}

function createChecks(context) {
  return [
    createCheck("candidate_selected", Boolean(context.selectedWorkspaceId), "A Session DB candidate is selected."),
    createCheck("target_workspace_is_known_first_live_fixture", context.selectedWorkspaceId === DEFAULT_TARGET_WORKSPACE_ID, "Selected workspace is the known first live fixture."),
    createCheck("workspace_exists", Boolean(context.workspace), "Selected workspace exists."),
    createCheck("workspace_not_archived", context.workspace?.lifecycleState !== "archived", "Selected workspace is not archived."),
    createCheck("saved_tab_count_is_three", context.tabs.length === 3, "Saved tab count is exactly 3 for initial validation."),
    createCheck("saved_urls_available", context.missingUrlCount === 0, "Saved tab records have URLs."),
    createCheck("role_group_evidence_exists", context.plannedGroups.length > 0, "Saved role/group evidence exists."),
    createCheck("planned_group_count_is_three", context.plannedGroups.length === 3, "Planned group count is exactly 3 for initial validation."),
    createCheck("session_record_available", context.sessions.length > 0, "Session record is available."),
    createCheck("projection_record_available", Boolean(context.latestProjection), "Projection record is available."),
    createCheck("projection_is_dehydrated", context.latestProjection?.projectionState === "dehydrated", "Projection is dehydrated before future resume."),
    createCheck("operator_phrase_matches", context.phraseMatches, "Operator typed the required run phrase."),
    createCheck("operator_acknowledgement_checked", context.acknowledgementChecked, "Operator checked the run acknowledgement.")
  ];
}

function createCheck(check, passed, message) {
  return { check, status: passed ? "pass" : "fail", severity: "block", message };
}

function createPlannedGroups(tabs) {
  const roles = new Map();
  for (const tab of tabs) {
    const role = tab.role || "unassigned";
    if (role === "unassigned") continue;
    if (!roles.has(role)) roles.set(role, []);
    roles.get(role).push(tab.workspaceTabId);
  }

  return Array.from(roles.entries()).map(([role, workspaceTabIds]) => ({
    role,
    roleLabel: createRoleLabel(role),
    workspaceTabIds,
    requiredForProjection: true
  }));
}

function createRoleLabel(role) {
  return String(role || "unassigned").replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sortTabsBySavedOrder(tabs) {
  return [...tabs].sort((left, right) => {
    const leftCreatedAt = left.createdAt || left.firstSeenAt || "";
    const rightCreatedAt = right.createdAt || right.firstSeenAt || "";
    if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt.localeCompare(rightCreatedAt);
    return String(left.workspaceTabId || "").localeCompare(String(right.workspaceTabId || ""));
  });
}

function getSelectedWorkspaceId() {
  return document.getElementById("projectionResumeCandidateSelect")?.value || DEFAULT_TARGET_WORKSPACE_ID;
}

function getRunPhrase() {
  return document.getElementById("projectionResumeRunPhrase")?.value.trim() || "";
}

function updateRunButton(packet) {
  const button = document.getElementById("runProjectionResumePrototypeButton");
  if (!button) return;
  const shouldEnable = packet?.preRun?.status === "ready_for_operator_run" && packet?.preRun?.availableInThisSlice === true && !liveResumeInProgress;
  button.disabled = !shouldEnable;
  button.textContent = shouldEnable ? "Run Known Fixture Resume" : "Run Known Fixture Resume Disabled";
}

async function safeBuildPreRunPacket() {
  try { return await buildPreRunPacket(); }
  catch { return null; }
}

function formatPacket(packet) {
  return [
    packet.clipboard?.envelopeStart || PACKET_ENVELOPE_START,
    "packetType: " + packet.packetType,
    "schema: " + packet.extension.schema,
    "clipboardFormat: " + (packet.clipboard?.format || PACKET_CLIPBOARD_FORMAT),
    "createdAt: " + packet.createdAt,
    "contentType: " + (packet.clipboard?.contentType || PACKET_CONTENT_TYPE),
    "",
    JSON.stringify(packet, null, 2),
    "",
    packet.clipboard?.envelopeEnd || PACKET_ENVELOPE_END
  ].join("\n");
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
  if (packet?.packetType === "Chrome Flow Projection Resume Execution Packet") {
    return "Resume execution: " + packet.execution.status + " | Created window: " + (packet.browserResult?.createdWindowId || "none") + " | Created tabs: " + (packet.browserResult?.createdTabIds?.length || 0) + " | Created groups: " + (packet.browserResult?.createdGroupIds?.length || 0) + ".";
  }
  return "Run precheck: " + packet.preRun.status + " | Candidate: " + (packet.workspace.name || "missing") + " | Saved tabs: " + packet.browserPlan.savedTabCount + " | Planned groups: " + packet.browserPlan.plannedGroupCount + " | Live available: " + packet.preRun.availableInThisSlice + ".";
}

function getPacketStatus(packet) {
  return packet?.execution?.status || packet?.preRun?.status || "unknown";
}

function setSummary(message) {
  const summary = document.getElementById("projectionResumeRunSummary");
  if (summary) summary.textContent = message;
}

function setStatus(message) {
  const status = document.getElementById("projectionResumeRunStatus");
  if (status) status.textContent = message;
}

function setOutput(value) {
  const output = document.getElementById("projectionResumeRunOutput");
  if (output) output.textContent = JSON.stringify(value, null, 2);
}

function setError(message, error) {
  setOutput({ status: "error", message, error: error?.message || String(error) });
  setStatus(message);
}

function summarizeError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error)
  };
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
