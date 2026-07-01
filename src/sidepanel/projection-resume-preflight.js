import {
  getWorkspace
} from "../core/workspace-store.js";

import {
  getActiveWorkspaceId,
  getDedicatedWindowThreshold,
  getWorkspaceProjections,
  getWorkspaceRecord,
  getWorkspaceSessions,
  getWorkspaceTabs,
  listWorkspaceRecords
} from "../core/session-repository.js";

const DIAGNOSTICS_KEY = "chromeFlowDiagnostics";
const MAX_DIAGNOSTICS = 200;
const PACKET_ENVELOPE_START = "CHROME_FLOW_PACKET_START";
const PACKET_ENVELOPE_END = "CHROME_FLOW_PACKET_END";
const PACKET_CLIPBOARD_FORMAT = "chrome_flow_packet_envelope_v0.1";
const PACKET_CONTENT_TYPE = "application/json";
const DEFAULT_TARGET_MODE = "operator_selects";
const DEFAULT_INCLUDE_CHROME_GROUPS = true;
const DEFAULT_FOCUS_AFTER_RESUME = true;
const DEFAULT_DECISION_STATE = "pending_operator_decision";

installProjectionResumePreflight();

async function installProjectionResumePreflight() {
  renderProjectionResumePreflight();
  attachProjectionResumePreflightHandlers();
  await refreshProjectionResumePreflightSummary();
}

function renderProjectionResumePreflight() {
  if (document.getElementById("projectionResumePreflightSection")) return;

  const anchor = document.getElementById("projectionConfirmationPacketSection") || document.getElementById("projectionPlanPreviewSection") || document.querySelector(".workspace-section");
  if (!anchor) return;

  const section = document.createElement("section");
  section.id = "projectionResumePreflightSection";
  section.className = "projection-resume-preflight-section";

  const heading = document.createElement("h2");
  heading.textContent = "Projection Resume Preflight";
  section.appendChild(heading);

  const help = document.createElement("p");
  help.className = "section-help";
  help.textContent = "Validate that a pending resume confirmation remains safe immediately before future execution. This preflight does not open tabs, create windows, create groups, or change runtime authority.";
  section.appendChild(help);

  const summary = document.createElement("div");
  summary.id = "projectionResumePreflightSummary";
  summary.className = "workspace-session-summary";
  section.appendChild(summary);

  const selectorPanel = document.createElement("div");
  selectorPanel.className = "archive-browser-panel";

  const workspaceLabel = document.createElement("label");
  workspaceLabel.htmlFor = "projectionResumePreflightWorkspaceSelect";
  workspaceLabel.textContent = "Workspace for resume preflight";
  selectorPanel.appendChild(workspaceLabel);

  const workspaceSelect = document.createElement("select");
  workspaceSelect.id = "projectionResumePreflightWorkspaceSelect";
  selectorPanel.appendChild(workspaceSelect);
  section.appendChild(selectorPanel);

  const optionsPanel = document.createElement("div");
  optionsPanel.className = "workspace-session-options";

  const targetLabel = document.createElement("label");
  targetLabel.htmlFor = "projectionResumePreflightTargetMode";
  targetLabel.textContent = "Target mode";
  optionsPanel.appendChild(targetLabel);

  const targetSelect = document.createElement("select");
  targetSelect.id = "projectionResumePreflightTargetMode";
  addOption(targetSelect, "operator_selects", "Operator selects at execution time");
  addOption(targetSelect, "current_window", "Current window");
  addOption(targetSelect, "new_window", "New window");
  addOption(targetSelect, "dedicated_window", "Dedicated window");
  targetSelect.value = DEFAULT_TARGET_MODE;
  optionsPanel.appendChild(targetSelect);

  const decisionLabel = document.createElement("label");
  decisionLabel.htmlFor = "projectionResumePreflightDecisionState";
  decisionLabel.textContent = "Confirmation decision state";
  optionsPanel.appendChild(decisionLabel);

  const decisionSelect = document.createElement("select");
  decisionSelect.id = "projectionResumePreflightDecisionState";
  addOption(decisionSelect, "pending_operator_decision", "Pending Operator decision");
  addOption(decisionSelect, "cancelled_by_operator", "Cancelled by Operator");
  addOption(decisionSelect, "blocked_no_decision_available", "Blocked / no decision available");
  decisionSelect.value = DEFAULT_DECISION_STATE;
  optionsPanel.appendChild(decisionSelect);

  optionsPanel.appendChild(createCheckbox("projectionResumePreflightIncludeChromeGroups", "Include Chrome group intent", DEFAULT_INCLUDE_CHROME_GROUPS));
  optionsPanel.appendChild(createCheckbox("projectionResumePreflightFocusAfterResume", "Focus after future execution", DEFAULT_FOCUS_AFTER_RESUME));
  section.appendChild(optionsPanel);

  const actions = document.createElement("div");
  actions.className = "workspace-session-actions";
  actions.appendChild(createButton("refreshProjectionResumePreflightWorkspacesButton", "Refresh Preflight Workspaces", "secondary-button"));
  actions.appendChild(createButton("runProjectionResumePreflightButton", "Run Resume Preflight", "secondary-button"));
  actions.appendChild(createButton("copyProjectionResumePreflightPacketButton", "Copy Preflight Packet", "secondary-button"));
  section.appendChild(actions);

  const status = document.createElement("p");
  status.id = "projectionResumePreflightStatus";
  status.className = "status-message";
  section.appendChild(status);

  const output = document.createElement("pre");
  output.id = "projectionResumePreflightOutput";
  output.className = "diagnostics-output";
  output.textContent = "Projection resume preflight output will appear here.";
  section.appendChild(output);

  anchor.insertAdjacentElement("afterend", section);
}

function attachProjectionResumePreflightHandlers() {
  document.getElementById("refreshProjectionResumePreflightWorkspacesButton")?.addEventListener("click", refreshProjectionResumePreflightSummary);
  document.getElementById("runProjectionResumePreflightButton")?.addEventListener("click", runProjectionResumePreflight);
  document.getElementById("copyProjectionResumePreflightPacketButton")?.addEventListener("click", copyProjectionResumePreflightPacket);
}

async function refreshProjectionResumePreflightSummary() {
  try {
    const workspaces = await listWorkspaceRecords();
    const activeWorkspaceId = await getActiveWorkspaceId();
    const select = document.getElementById("projectionResumePreflightWorkspaceSelect");

    if (!select) return;

    const previousValue = select.value;
    clearElement(select);

    if (!workspaces.length) {
      addOption(select, "", "No saved Session DB workspaces yet");
      select.disabled = true;
      setSummary("Projection resume preflight: no saved workspaces available.");
      setStatus("No saved workspaces available for resume preflight.");
      return;
    }

    select.disabled = false;
    for (const workspace of workspaces) {
      addOption(select, workspace.workspaceId, createWorkspaceOptionLabel(workspace, activeWorkspaceId));
    }

    if (previousValue && workspaces.some((workspace) => workspace.workspaceId === previousValue)) {
      select.value = previousValue;
    } else if (activeWorkspaceId && workspaces.some((workspace) => workspace.workspaceId === activeWorkspaceId)) {
      select.value = activeWorkspaceId;
    }

    const candidateCount = await countPreflightCandidates(workspaces);
    setSummary("Projection resume preflight: saved workspaces " + workspaces.length + " | preflight candidates " + candidateCount + " | selected " + (select.value || "none") + ".");
    setStatus("Projection resume preflight workspace list refreshed.");
    await recordDiagnostic("info", "projection_resume_preflight_workspaces_refreshed", "Projection resume preflight workspace list refreshed.", {
      workspaceCount: workspaces.length,
      candidateCount,
      selectedWorkspaceId: select.value || ""
    });
  } catch (error) {
    await handlePreflightError("projection_resume_preflight_workspace_refresh_failed", "Could not refresh projection resume preflight workspaces.", error);
  }
}

async function runProjectionResumePreflight() {
  try {
    const packet = await buildPreflightPacket();
    setOutput(packet);
    setSummary(createSummaryText(packet));
    setStatus("Resume preflight completed: " + packet.preflight.status + ".");
    await recordDiagnostic("info", "projection_resume_preflight_run", "Projection resume preflight completed.", {
      status: packet.preflight.status,
      workspaceId: packet.workspace.workspaceId,
      workspaceName: packet.workspace.name,
      checkCount: packet.preflight.checks.length,
      blockingCheckCount: packet.preflight.blockingChecks.length,
      warningCheckCount: packet.preflight.warningChecks.length,
      executionAvailableInThisSlice: packet.preflight.executionAvailableInThisSlice
    });
  } catch (error) {
    await handlePreflightError("projection_resume_preflight_failed", "Could not run projection resume preflight.", error);
  }
}

async function copyProjectionResumePreflightPacket() {
  try {
    const packet = await buildPreflightPacket();
    await navigator.clipboard.writeText(formatPacketForClipboard(packet));
    setOutput(packet);
    setSummary(createSummaryText(packet));
    setStatus("Projection resume preflight packet copied: " + packet.preflight.status + ".");
    await recordDiagnostic("info", "projection_resume_preflight_packet_copied", "Projection resume preflight packet copied.", {
      schema: packet.extension.schema,
      status: packet.preflight.status,
      workspaceId: packet.workspace.workspaceId,
      blockingCheckCount: packet.preflight.blockingChecks.length,
      warningCheckCount: packet.preflight.warningChecks.length,
      executionAvailableInThisSlice: packet.preflight.executionAvailableInThisSlice
    });
  } catch (error) {
    await handlePreflightError("projection_resume_preflight_packet_copy_failed", "Could not copy projection resume preflight packet.", error);
  }
}

async function buildPreflightPacket() {
  const workspaceId = getSelectedWorkspaceId();
  if (!workspaceId) throw new Error("No saved workspace selected for projection resume preflight.");

  const context = await buildPreflightContext(workspaceId);
  const createdAt = new Date().toISOString();
  const checks = createPreflightChecks(context);
  const blockingChecks = checks.filter((check) => check.severity === "block" && check.status === "fail");
  const warningChecks = checks.filter((check) => check.severity === "warn" && check.status === "fail");
  const status = blockingChecks.length ? "blocked" : warningChecks.length ? "warn" : "pass";

  return {
    packetType: "Chrome Flow Projection Resume Preflight Packet",
    createdAt,
    extension: {
      name: "Chrome Flow",
      schema: "projection-resume-preflight-packet-v0.1"
    },
    clipboard: {
      format: PACKET_CLIPBOARD_FORMAT,
      contentType: PACKET_CONTENT_TYPE,
      copyMode: "text_envelope",
      envelopeStart: PACKET_ENVELOPE_START,
      envelopeEnd: PACKET_ENVELOPE_END
    },
    source: {
      type: "projection_resume_preflight_validation",
      readOnly: true,
      preflightOnly: true,
      runtimeActionExecuted: false,
      browserProjectionChanged: false,
      sessionDbChanged: false,
      chromeStorageRuntimeChanged: false,
      approvalExecutesAction: false
    },
    workspace: context.workspace,
    latestSession: context.latestSession,
    latestProjection: context.latestProjection,
    confirmationInput: context.confirmationInput,
    preflightPlan: context.preflightPlan,
    runtimeReview: context.runtimeReview,
    preflight: {
      status,
      executionAvailableInThisSlice: false,
      readyForFutureExecutionPrototype: status === "pass",
      requiresFutureExecutionImplementation: true,
      requiresPostActionVerification: true,
      checks,
      blockingChecks,
      warningChecks,
      blockedReasons: blockingChecks.map((check) => check.message),
      warningReasons: warningChecks.map((check) => check.message),
      reviewSummary: createReviewSummary(status, context, blockingChecks, warningChecks)
    },
    commandEnvelope: createPreflightCommandEnvelope(context, status, checks, blockingChecks, warningChecks),
    notes: [
      "This packet is generated locally by Chrome Flow.",
      "This is a preflight validation packet only and does not execute a resume action.",
      "This slice does not open tabs, create windows, create Chrome groups, mark projections hydrated, or change runtime authority.",
      "A pass result means the pending confirmation remains eligible for a future explicitly confirmed execution prototype.",
      "Future execution must be implemented in a separate slice and must include post-action verification.",
      "Review before sharing because preflight packets include workspace names, tab titles, URLs, and roles."
    ]
  };
}

async function buildPreflightContext(workspaceId) {
  const activeRuntimeWorkspace = await getWorkspace();
  const activeDbWorkspaceId = await getActiveWorkspaceId();
  const dedicatedWindowThreshold = await getDedicatedWindowThreshold();
  const workspace = await getWorkspaceRecord(workspaceId);
  if (!workspace) throw new Error("Selected saved workspace does not exist in Session DB.");

  const tabs = await getWorkspaceTabs(workspaceId);
  const sessions = await getWorkspaceSessions(workspaceId);
  const projections = await getWorkspaceProjections(workspaceId);
  const latestSession = sessions[0] || null;
  const latestProjection = projections[0] || null;
  const targetMode = getTargetMode(tabs.length, dedicatedWindowThreshold);
  const includeChromeGroups = getCheckedValue("projectionResumePreflightIncludeChromeGroups", DEFAULT_INCLUDE_CHROME_GROUPS);
  const focusAfterResume = getCheckedValue("projectionResumePreflightFocusAfterResume", DEFAULT_FOCUS_AFTER_RESUME);
  const decisionState = getDecisionState();
  const missingUrlCount = tabs.filter((tab) => !tab.url).length;
  const plannedTabCreates = tabs.map((tab, index) => createPlannedTabCreate(tab, index));
  const plannedGroupCreates = includeChromeGroups ? createPlannedGroupCreates(createRoleGroups(tabs)) : [];
  const blockedReasons = createPlanBlockedReasons(workspace, tabs, missingUrlCount);
  const previewStatus = blockedReasons.length ? "blocked" : "ready";
  const confirmationStatus = createConfirmationStatus(previewStatus, decisionState);

  return {
    activeRuntimeWorkspaceId: activeRuntimeWorkspace?.workspaceId || "",
    activeRuntimeWorkspaceName: activeRuntimeWorkspace?.name || "",
    activeDbWorkspaceId,
    workspace: {
      workspaceId: workspace.workspaceId,
      name: workspace.name,
      aim: workspace.aim,
      workspaceType: workspace.workspaceType,
      lifecycleState: workspace.lifecycleState,
      summaryCardId: workspace.summaryCardId
    },
    latestSession: latestSession ? {
      sessionId: latestSession.sessionId,
      sessionState: latestSession.sessionState,
      pausedAt: latestSession.pausedAt,
      endedAt: latestSession.endedAt
    } : null,
    latestProjection: latestProjection ? {
      projectionId: latestProjection.projectionId,
      projectionState: latestProjection.projectionState,
      projectionMode: latestProjection.projectionMode,
      runtimeWindowId: latestProjection.runtimeWindowId,
      runtimeTabIdsCount: latestProjection.runtimeTabIds.length,
      runtimeGroupIdsCount: latestProjection.runtimeGroupIds.length,
      lastVerifiedAt: latestProjection.lastVerifiedAt
    } : null,
    confirmationInput: {
      commandName: "projection.resume_confirmation_packet",
      decisionState,
      confirmationStatus,
      readyForOperatorDecision: previewStatus === "ready",
      executionAvailableInConfirmationSlice: false,
      approvalExecutesAction: false
    },
    preflightPlan: {
      previewStatus,
      workspaceId,
      workspaceName: workspace.name,
      savedTabCount: tabs.length,
      missingUrlCount,
      targetMode,
      dedicatedWindowThreshold,
      includeChromeGroups,
      focusAfterResume,
      plannedTabCreates,
      plannedGroupCreates,
      blockedReasons,
      riskSummary: createRiskSummary(blockedReasons, tabs.length, targetMode, includeChromeGroups)
    },
    runtimeReview: {
      runtimeSource: "mixed",
      activeRuntimeWorkspaceId: activeRuntimeWorkspace?.workspaceId || "",
      activeRuntimeWorkspaceName: activeRuntimeWorkspace?.name || "",
      activeDbWorkspaceId,
      runtimeAndDbSelectionMatch: Boolean(activeRuntimeWorkspace?.workspaceId && activeRuntimeWorkspace.workspaceId === workspaceId),
      activeDbSelectionMatchesWorkspace: activeDbWorkspaceId === workspaceId,
      sessionDbRuntimeSourceOfTruth: false,
      chromeStorageRuntimeAuthorityPreserved: true
    }
  };
}

function createPreflightChecks(context) {
  const plan = context.preflightPlan;
  const confirmation = context.confirmationInput;
  const runtime = context.runtimeReview;

  return [
    createCheck("saved_workspace_exists", true, "Saved workspace exists.", "block"),
    createCheck("saved_workspace_not_archived", context.workspace.lifecycleState !== "archived", "Saved workspace is not archived.", "block"),
    createCheck("saved_tab_records_available", plan.savedTabCount > 0, "Saved workspace has tab records.", "block"),
    createCheck("saved_tab_urls_available", plan.missingUrlCount === 0, "Saved tab records have URLs.", "block"),
    createCheck("planned_tab_count_matches_saved_tab_count", plan.plannedTabCreates.length === plan.savedTabCount, "Planned tab count matches saved tab count.", "block"),
    createCheck("planned_tabs_are_creatable", plan.plannedTabCreates.every((tab) => tab.canCreate), "Every planned tab has enough evidence to be recreated later.", "block"),
    createCheck("session_record_available", Boolean(context.latestSession), "A session record is available.", "block"),
    createCheck("projection_record_available", Boolean(context.latestProjection), "A projection record is available.", "block"),
    createCheck("projection_is_dehydrated", context.latestProjection?.projectionState === "dehydrated", "Saved projection is dehydrated before future resume.", "block"),
    createCheck("confirmation_is_pending", confirmation.decisionState === "pending_operator_decision", "Operator decision is pending, not cancelled or blocked.", "block"),
    createCheck("confirmation_status_allows_preflight", confirmation.confirmationStatus === "pending_operator_decision", "Confirmation status allows preflight.", "block"),
    createCheck("confirmation_does_not_execute", confirmation.executionAvailableInConfirmationSlice === false && confirmation.approvalExecutesAction === false, "Confirmation packet does not execute actions.", "block"),
    createCheck("target_mode_resolved", ["current_window", "new_window", "dedicated_window"].includes(plan.targetMode), "Target mode is resolved.", "block"),
    createCheck("group_plan_safe", plan.plannedGroupCreates.every((group) => group.canCreate), "Every planned Chrome group is backed by creatable tabs.", "block"),
    createCheck("runtime_authority_preserved", runtime.chromeStorageRuntimeAuthorityPreserved && runtime.sessionDbRuntimeSourceOfTruth === false, "chrome.storage.local remains runtime authority for this slice.", "block"),
    createCheck("preflight_only_boundary", true, "This preflight does not execute browser actions.", "block"),
    createCheck("active_db_selection_matches_workspace", runtime.activeDbSelectionMatchesWorkspace, "Active DB workspace selection matches the preflight workspace.", "warn"),
    createCheck("runtime_selection_matches_workspace", runtime.runtimeAndDbSelectionMatch, "Active runtime workspace id matches the preflight workspace id.", "warn")
  ];
}

function createCheck(check, passed, message, severity) {
  return {
    check,
    status: passed ? "pass" : "fail",
    severity,
    message
  };
}

function createPreflightCommandEnvelope(context, status, checks, blockingChecks, warningChecks) {
  return {
    commandId: crypto.randomUUID(),
    commandName: "projection.resume_preflight_validation",
    authorityClass: "projection_plan",
    requestedBy: "operator",
    requiresConfirmation: false,
    confirmationState: context.confirmationInput.decisionState,
    workspaceId: context.workspace.workspaceId,
    sessionId: context.latestSession?.sessionId || null,
    projectionId: context.latestProjection?.projectionId || null,
    sourceState: {
      runtimeSource: "mixed",
      savedWorkspaceExists: true,
      activeRuntimeWorkspaceId: context.runtimeReview.activeRuntimeWorkspaceId,
      activeDbWorkspaceId: context.runtimeReview.activeDbWorkspaceId,
      runtimeAndDbSelectionMatch: context.runtimeReview.runtimeAndDbSelectionMatch,
      sessionDbRuntimeSourceOfTruth: false
    },
    inputs: {
      workspaceId: context.workspace.workspaceId,
      targetMode: context.preflightPlan.targetMode,
      includeChromeGroups: context.preflightPlan.includeChromeGroups,
      focusAfterResume: context.preflightPlan.focusAfterResume,
      decisionState: context.confirmationInput.decisionState
    },
    preconditions: checks,
    expectedEffects: [
      "No browser state changes in this preflight slice.",
      "No Session DB state changes in this preflight slice.",
      "No chrome.storage.local runtime changes in this preflight slice.",
      "Future execution remains unavailable until implemented in a separate slice."
    ],
    riskSummary: context.preflightPlan.riskSummary,
    operatorReview: {
      summary: createReviewSummary(status, context, blockingChecks, warningChecks),
      willChangeBrowserState: false,
      willChangeSessionDbState: false,
      willChangeChromeStorageRuntime: false,
      estimatedTabCount: status === "blocked" ? 0 : context.preflightPlan.savedTabCount,
      estimatedWindowCount: status === "blocked" ? 0 : createEstimatedWindowCount(context.preflightPlan),
      cancellationAvailable: context.confirmationInput.decisionState === "pending_operator_decision"
    },
    execution: {
      status: "not_available_in_this_slice",
      startedAt: "",
      completedAt: "",
      timelineEventTypes: [],
      diagnosticAction: "projection_resume_preflight_run",
      evidence: {
        preflightOnly: true,
        executionAvailableInThisSlice: false,
        preflightStatus: status,
        checkCount: checks.length,
        blockingCheckCount: blockingChecks.length,
        warningCheckCount: warningChecks.length
      },
      error: null
    },
    verification: {
      required: false,
      status: "not_started",
      checks: [],
      verifiedAt: "",
      evidence: {
        preflightOnly: true,
        verificationDeferredUntilFutureExecution: true
      }
    }
  };
}

function createReviewSummary(status, context, blockingChecks, warningChecks) {
  if (status === "blocked") {
    return "Resume preflight is blocked for " + context.workspace.name + ": " + blockingChecks.map((check) => check.message).join(" ");
  }

  if (status === "warn") {
    return "Resume preflight passed with warnings for " + context.workspace.name + ": " + warningChecks.map((check) => check.message).join(" ");
  }

  return "Resume preflight passed for " + context.workspace.name + ": " + context.preflightPlan.savedTabCount + " saved tab(s), " + context.preflightPlan.plannedGroupCreates.length + " planned group(s), target mode " + context.preflightPlan.targetMode + ". Execution is still unavailable in this slice.";
}

function createConfirmationStatus(previewStatus, decisionState) {
  if (previewStatus !== "ready") return "blocked";
  if (decisionState === "cancelled_by_operator") return "cancelled";
  if (decisionState === "blocked_no_decision_available") return "blocked";
  return "pending_operator_decision";
}

function createEstimatedWindowCount(plan) {
  if (plan.previewStatus !== "ready") return 0;
  return plan.targetMode === "current_window" ? 0 : 1;
}

function createPlannedTabCreate(tab, index) {
  return {
    order: index + 1,
    workspaceTabId: tab.workspaceTabId,
    alias: tab.alias || tab.originalTitle || "Untitled tab",
    role: tab.role || "unassigned",
    url: tab.url || "",
    displayUrl: tab.displayUrl || "",
    originalTitle: tab.originalTitle || "Untitled tab",
    lastKnownProjectionState: tab.lastKnownProjectionState || "unknown",
    canCreate: Boolean(tab.url),
    blockedReason: tab.url ? "" : "Saved tab record is missing URL."
  };
}

function createRoleGroups(tabs) {
  const groups = new Map();

  for (const tab of tabs) {
    const role = tab.role || "unassigned";
    if (!groups.has(role)) groups.set(role, []);
    groups.get(role).push(tab);
  }

  return Array.from(groups.entries()).map(([role, roleTabs]) => ({ role, tabs: roleTabs }));
}

function createPlannedGroupCreates(roleGroups) {
  return roleGroups
    .filter((group) => group.role !== "unassigned" && group.tabs.length > 0)
    .map((group) => ({
      role: group.role,
      tabCount: group.tabs.length,
      workspaceTabIds: group.tabs.map((tab) => tab.workspaceTabId),
      label: createRoleLabel(group.role),
      canCreate: group.tabs.every((tab) => Boolean(tab.url))
    }));
}

function createPlanBlockedReasons(workspace, tabs, missingUrlCount) {
  const reasons = [];

  if (!workspace) reasons.push("Saved workspace does not exist.");
  if (workspace?.lifecycleState === "archived") reasons.push("Saved workspace is archived.");
  if (!tabs.length) reasons.push("Saved workspace has no tab records to plan.");
  if (missingUrlCount > 0) reasons.push("One or more saved tab records are missing URLs.");

  return reasons;
}

function createRiskSummary(blockedReasons, tabCount, targetMode, includeChromeGroups) {
  if (blockedReasons.length) return "Plan is blocked: " + blockedReasons.join(" ");

  return "Future execution would affect browser state if implemented later: " + tabCount + " tab(s), target mode " + targetMode + (includeChromeGroups ? ", with Chrome groups." : ", without Chrome groups.");
}

async function countPreflightCandidates(workspaces) {
  let count = 0;

  for (const workspace of workspaces) {
    const tabs = await getWorkspaceTabs(workspace.workspaceId);
    const missingUrlCount = tabs.filter((tab) => !tab.url).length;
    if (workspace.lifecycleState !== "archived" && tabs.length > 0 && missingUrlCount === 0) count += 1;
  }

  return count;
}

function getTargetMode(tabCount, dedicatedWindowThreshold) {
  const selected = document.getElementById("projectionResumePreflightTargetMode")?.value || DEFAULT_TARGET_MODE;
  if (selected === "operator_selects") {
    return tabCount >= dedicatedWindowThreshold ? "dedicated_window" : "new_window";
  }

  return selected;
}

function getDecisionState() {
  return document.getElementById("projectionResumePreflightDecisionState")?.value || DEFAULT_DECISION_STATE;
}

function getSelectedWorkspaceId() {
  const localSelect = document.getElementById("projectionResumePreflightWorkspaceSelect");
  if (localSelect?.value) return localSelect.value;

  const confirmationSelect = document.getElementById("projectionConfirmationWorkspaceSelect");
  if (confirmationSelect?.value) return confirmationSelect.value;

  const previewSelect = document.getElementById("projectionPlanWorkspaceSelect");
  if (previewSelect?.value) return previewSelect.value;

  const savedRegistrySelect = document.getElementById("savedWorkspaceSelect");
  return savedRegistrySelect?.value || "";
}

function getCheckedValue(id, fallback) {
  const element = document.getElementById(id);
  return element ? Boolean(element.checked) : fallback;
}

function createWorkspaceOptionLabel(workspace, activeWorkspaceId) {
  const marker = workspace.workspaceId === activeWorkspaceId ? " [active DB]" : "";
  return (workspace.name || "Untitled Workspace") + " — " + (workspace.lifecycleState || "unknown") + marker;
}

function createSummaryText(packet) {
  return "Resume preflight: " + packet.preflight.status + " | Workspace: " + packet.workspace.name + " | Checks: " + packet.preflight.checks.length + " | Blockers: " + packet.preflight.blockingChecks.length + " | Warnings: " + packet.preflight.warningChecks.length + ".";
}

function formatPacketForClipboard(packet) {
  return [
    packet.clipboard.envelopeStart,
    "packetType: " + packet.packetType,
    "schema: " + packet.extension.schema,
    "clipboardFormat: " + packet.clipboard.format,
    "createdAt: " + packet.createdAt,
    "contentType: " + packet.clipboard.contentType,
    "",
    JSON.stringify(packet, null, 2),
    "",
    packet.clipboard.envelopeEnd
  ].join("\n");
}

function addOption(select, value, text) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = text;
  select.appendChild(option);
}

function createButton(id, text, className) {
  const button = document.createElement("button");
  button.id = id;
  button.type = "button";
  button.className = className;
  button.textContent = text;
  return button;
}

function createCheckbox(id, text, checked) {
  const label = document.createElement("label");
  label.className = "checkbox-label";

  const checkbox = document.createElement("input");
  checkbox.id = id;
  checkbox.type = "checkbox";
  checkbox.checked = checked;

  label.appendChild(checkbox);
  label.appendChild(document.createTextNode(" " + text));
  return label;
}

function createRoleLabel(role) {
  return String(role || "unassigned")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function clearElement(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
}

function setSummary(message) {
  const summary = document.getElementById("projectionResumePreflightSummary");
  if (summary) summary.textContent = message;
}

function setStatus(message) {
  const status = document.getElementById("projectionResumePreflightStatus");
  if (status) status.textContent = message;
}

function setOutput(value) {
  const output = document.getElementById("projectionResumePreflightOutput");
  if (output) output.textContent = JSON.stringify(value, null, 2);
}

async function handlePreflightError(action, message, error) {
  const details = { error: summarizeError(error) };
  setOutput({ status: "error", action, message, ...details });
  setStatus(message + " Check the output or browser console.");
  await recordDiagnostic("error", action, message, details);
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
    console.warn("Chrome Flow projection resume preflight diagnostic record failed:", error);
  }
}

function summarizeError(error) {
  if (!error) return { message: "Unknown error" };

  return {
    name: error.name || "Error",
    message: error.message || String(error),
    stack: typeof error.stack === "string" ? error.stack.slice(0, 2000) : ""
  };
}
