import {
  getWorkspace
} from "../core/workspace-store.js";

import {
  getActiveWorkspaceId,
  getDedicatedWindowThreshold,
  getSummaryCardForWorkspace,
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

installProjectionResumePreflightValidation();

async function installProjectionResumePreflightValidation() {
  renderProjectionResumePreflightValidation();
  attachProjectionResumePreflightHandlers();
  await refreshProjectionResumePreflightSummary();
}

function renderProjectionResumePreflightValidation() {
  if (document.getElementById("projectionResumePreflightSection")) return;

  const anchor = document.getElementById("projectionConfirmationPacketSection") || document.getElementById("projectionPlanPreviewSection") || document.getElementById("runtimeProjectionReadinessSection") || document.querySelector(".workspace-section");
  if (!anchor) return;

  const section = document.createElement("section");
  section.id = "projectionResumePreflightSection";
  section.className = "projection-resume-preflight-section";

  const heading = document.createElement("h2");
  heading.textContent = "Projection Resume Preflight Validation";
  section.appendChild(heading);

  const help = document.createElement("p");
  help.className = "section-help";
  help.textContent = "Validate that a pending resume confirmation remains safe as a future execution candidate. This check is read-only and does not open tabs, create windows, create groups, or mark projections hydrated.";
  section.appendChild(help);

  const summary = document.createElement("div");
  summary.id = "projectionResumePreflightSummary";
  summary.className = "workspace-session-summary";
  section.appendChild(summary);

  const selectorPanel = document.createElement("div");
  selectorPanel.className = "archive-browser-panel";

  const label = document.createElement("label");
  label.htmlFor = "projectionResumePreflightWorkspaceSelect";
  label.textContent = "Workspace for preflight validation";
  selectorPanel.appendChild(label);

  const select = document.createElement("select");
  select.id = "projectionResumePreflightWorkspaceSelect";
  selectorPanel.appendChild(select);
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

  optionsPanel.appendChild(createCheckbox("projectionResumePreflightIncludeChromeGroups", "Include Chrome group intent", DEFAULT_INCLUDE_CHROME_GROUPS));
  optionsPanel.appendChild(createCheckbox("projectionResumePreflightFocusAfterResume", "Focus after future execution", DEFAULT_FOCUS_AFTER_RESUME));
  section.appendChild(optionsPanel);

  const decisionPanel = document.createElement("div");
  decisionPanel.className = "workspace-session-options";

  const decisionLabel = document.createElement("label");
  decisionLabel.htmlFor = "projectionResumePreflightDecisionState";
  decisionLabel.textContent = "Confirmation decision state";
  decisionPanel.appendChild(decisionLabel);

  const decisionSelect = document.createElement("select");
  decisionSelect.id = "projectionResumePreflightDecisionState";
  addOption(decisionSelect, "pending_operator_decision", "Pending Operator decision");
  addOption(decisionSelect, "cancelled_by_operator", "Cancelled by Operator");
  decisionSelect.value = DEFAULT_DECISION_STATE;
  decisionPanel.appendChild(decisionSelect);
  section.appendChild(decisionPanel);

  const actions = document.createElement("div");
  actions.className = "workspace-session-actions";
  actions.appendChild(createButton("refreshProjectionResumePreflightButton", "Refresh Preflight Workspaces", "secondary-button"));
  actions.appendChild(createButton("validateProjectionResumePreflightButton", "Validate Resume Preflight", "secondary-button"));
  actions.appendChild(createButton("copyProjectionResumePreflightPacketButton", "Copy Preflight Packet", "secondary-button"));
  section.appendChild(actions);

  const status = document.createElement("p");
  status.id = "projectionResumePreflightStatus";
  status.className = "status-message";
  section.appendChild(status);

  const output = document.createElement("pre");
  output.id = "projectionResumePreflightOutput";
  output.className = "diagnostics-output";
  output.textContent = "Projection resume preflight validation output will appear here.";
  section.appendChild(output);

  anchor.insertAdjacentElement("afterend", section);
}

function attachProjectionResumePreflightHandlers() {
  document.getElementById("refreshProjectionResumePreflightButton")?.addEventListener("click", refreshProjectionResumePreflightSummary);
  document.getElementById("validateProjectionResumePreflightButton")?.addEventListener("click", validateProjectionResumePreflight);
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
      setStatus("No saved workspaces available for preflight validation.");
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

async function validateProjectionResumePreflight() {
  try {
    const packet = await buildPreflightPacket();
    setOutput(packet);
    setSummary(createSummaryText(packet));
    setStatus("Projection resume preflight validation completed: " + packet.preflight.status + ".");
    await recordDiagnostic("info", "projection_resume_preflight_validated", "Projection resume preflight validation completed.", {
      status: packet.preflight.status,
      workspaceId: packet.workspace.workspaceId,
      workspaceName: packet.workspace.name,
      decisionState: packet.confirmation.decisionState,
      passedChecks: packet.preflight.passedChecks.length,
      warningChecks: packet.preflight.warningChecks.length,
      blockedChecks: packet.preflight.blockedChecks.length,
      futureExecutionAllowedByPreflight: packet.preflight.futureExecutionAllowedByPreflight
    });
  } catch (error) {
    await handlePreflightError("projection_resume_preflight_validation_failed", "Could not validate projection resume preflight.", error);
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
      decisionState: packet.confirmation.decisionState,
      futureExecutionAllowedByPreflight: packet.preflight.futureExecutionAllowedByPreflight,
      clipboardFormat: packet.clipboard.format
    });
  } catch (error) {
    await handlePreflightError("projection_resume_preflight_packet_copy_failed", "Could not copy projection resume preflight packet.", error);
  }
}

async function buildPreflightPacket() {
  const workspaceId = getSelectedWorkspaceId();
  if (!workspaceId) throw new Error("No saved workspace selected for projection resume preflight validation.");

  const previewPlan = await buildPreviewPlan(workspaceId);
  const decisionState = getDecisionState();
  const confirmation = buildConfirmationState(previewPlan, decisionState);
  const preflight = buildPreflightResult(previewPlan, confirmation);
  const createdAt = new Date().toISOString();

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
      validationOnly: true,
      preflightOnly: true,
      runtimeActionExecuted: false,
      browserProjectionChanged: false,
      sessionDbChanged: false,
      chromeStorageRuntimeChanged: false,
      approvalExecutesAction: false
    },
    workspace: previewPlan.workspace,
    latestSession: previewPlan.latestSession,
    latestProjection: previewPlan.latestProjection,
    previewPlan: {
      status: previewPlan.status,
      workspaceId: previewPlan.workspace.workspaceId,
      workspaceName: previewPlan.workspace.name,
      savedTabCount: previewPlan.savedTabCount,
      missingUrlCount: previewPlan.missingUrlCount,
      targetMode: previewPlan.targetMode,
      dedicatedWindowThreshold: previewPlan.dedicatedWindowThreshold,
      includeChromeGroups: previewPlan.includeChromeGroups,
      focusAfterResume: previewPlan.focusAfterResume,
      plannedTabCreates: previewPlan.plannedTabCreates,
      plannedGroupCreates: previewPlan.plannedGroupCreates,
      blockedReasons: previewPlan.blockedReasons,
      riskSummary: previewPlan.riskSummary
    },
    confirmation,
    preflight,
    commandEnvelope: createPreflightCommandEnvelope(previewPlan, confirmation, preflight),
    notes: [
      "This packet is generated locally by Chrome Flow.",
      "This is a preflight validation packet only and does not execute the resume plan.",
      "Passing preflight does not open tabs, create windows, create Chrome groups, or mark projections hydrated.",
      "Future execution must be implemented as a separate explicitly confirmed action with post-action verification.",
      "Review before sharing because preflight packets include workspace names, tab titles, URLs, roles, and runtime evidence."
    ]
  };
}

async function buildPreviewPlan(workspaceId) {
  const activeRuntimeWorkspace = await getWorkspace();
  const activeDbWorkspaceId = await getActiveWorkspaceId();
  const dedicatedWindowThreshold = await getDedicatedWindowThreshold();
  const workspace = await getWorkspaceRecord(workspaceId);
  if (!workspace) throw new Error("Selected saved workspace does not exist in Session DB.");

  const tabs = await getWorkspaceTabs(workspaceId);
  const sessions = await getWorkspaceSessions(workspaceId);
  const projections = await getWorkspaceProjections(workspaceId);
  const summaryCard = await getSummaryCardForWorkspace(workspaceId);
  const targetMode = getTargetMode(tabs.length, dedicatedWindowThreshold);
  const includeChromeGroups = getCheckedValue("projectionResumePreflightIncludeChromeGroups", DEFAULT_INCLUDE_CHROME_GROUPS);
  const focusAfterResume = getCheckedValue("projectionResumePreflightFocusAfterResume", DEFAULT_FOCUS_AFTER_RESUME);
  const latestSession = sessions[0] || null;
  const latestProjection = projections[0] || null;
  const missingUrlCount = tabs.filter((tab) => !tab.url).length;
  const roleGroups = createRoleGroups(tabs);
  const blockedReasons = createBlockedReasons(workspace, tabs, missingUrlCount);
  const plannedTabCreates = tabs.map((tab, index) => createPlannedTabCreate(tab, index));
  const plannedGroupCreates = includeChromeGroups ? createPlannedGroupCreates(roleGroups) : [];
  const status = blockedReasons.length ? "blocked" : "ready";

  return {
    status,
    activeRuntimeWorkspaceId: activeRuntimeWorkspace?.workspaceId || "",
    activeDbWorkspaceId,
    runtimeAndDbSelectionMatch: Boolean(activeRuntimeWorkspace?.workspaceId && activeRuntimeWorkspace.workspaceId === workspaceId),
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
    summaryCard: summaryCard ? {
      summaryCardId: summaryCard.summaryCardId,
      deterministicSummaryAvailable: Boolean(summaryCard.deterministicSummary),
      continuationSummary: summaryCard.continuationSummary || ""
    } : null,
    savedTabCount: tabs.length,
    missingUrlCount,
    targetMode,
    dedicatedWindowThreshold,
    includeChromeGroups,
    focusAfterResume,
    plannedTabCreates,
    plannedGroupCreates,
    blockedReasons,
    riskSummary: createRiskSummary(blockedReasons, tabs.length, targetMode, includeChromeGroups),
    preconditions: createBasePreconditionResults(workspace, tabs, sessions, projections, missingUrlCount)
  };
}

function buildConfirmationState(previewPlan, decisionState) {
  const readyForConfirmation = previewPlan.status === "ready";
  const normalizedDecisionState = readyForConfirmation ? decisionState : "blocked_no_decision_available";
  const confirmationStatus = createConfirmationStatus(previewPlan.status, normalizedDecisionState);

  return {
    status: confirmationStatus,
    decisionState: normalizedDecisionState,
    readyForOperatorDecision: readyForConfirmation,
    executionAvailableInThisSlice: false,
    approveAvailable: false,
    approvalExecutesAction: false,
    cancelAvailable: readyForConfirmation,
    willChangeBrowserStateIfExecutedLater: readyForConfirmation,
    willChangeSessionDbStateIfExecutedLater: readyForConfirmation,
    willChangeChromeStorageRuntimeIfExecutedLater: false,
    requiresFutureExecutionImplementation: true,
    requiresFuturePostActionVerification: true,
    operatorDecisionPrompt: createOperatorDecisionPrompt(previewPlan, normalizedDecisionState),
    blockedReasons: readyForConfirmation ? [] : previewPlan.blockedReasons
  };
}

function buildPreflightResult(previewPlan, confirmation) {
  const checks = [
    createCheck("preview_plan_ready", previewPlan.status === "ready", "Preview plan is ready for future execution consideration."),
    createCheck("confirmation_pending", confirmation.status === "pending_operator_decision", "Confirmation packet is pending Operator decision."),
    createCheck("operator_has_not_cancelled", confirmation.decisionState !== "cancelled_by_operator", "Operator has not cancelled this future resume decision."),
    createCheck("saved_workspace_not_archived", previewPlan.workspace.lifecycleState !== "archived", "Saved workspace is not archived."),
    createCheck("saved_tab_records_available", previewPlan.savedTabCount > 0, "Saved workspace has tab records."),
    createCheck("saved_tab_urls_available", previewPlan.missingUrlCount === 0, "Saved tab records have URLs."),
    createCheck("session_record_available", Boolean(previewPlan.latestSession?.sessionId), "Saved workspace has a session record."),
    createCheck("projection_record_available", Boolean(previewPlan.latestProjection?.projectionId), "Saved workspace has a projection record."),
    createCheck("planned_tab_count_matches_saved_tab_count", previewPlan.plannedTabCreates.length === previewPlan.savedTabCount, "Planned tab count matches saved tab count."),
    createCheck("all_planned_tabs_creatable", previewPlan.plannedTabCreates.every((tab) => tab.canCreate), "All planned tabs have enough evidence to be recreated later."),
    createCheck("future_confirmation_required", true, "Future execution remains permission-gated."),
    createCheck("execution_unavailable_in_this_slice", true, "This slice validates only and does not execute."),
    createCheck("runtime_authority_preserved", true, "Preflight validation does not change runtime authority."),
    createCheck("post_action_verification_required", true, "Future execution must include post-action verification.")
  ];

  const passedChecks = checks.filter((check) => check.status === "pass");
  const blockedChecks = checks.filter((check) => check.status === "fail");
  const warningChecks = [];
  const status = blockedChecks.length ? "BLOCKED" : "PASS";

  return {
    status,
    futureExecutionAllowedByPreflight: status === "PASS",
    futureExecutionImplemented: false,
    runtimeActionExecuted: false,
    browserProjectionChanged: false,
    sessionDbChanged: false,
    chromeStorageRuntimeChanged: false,
    passedChecks,
    warningChecks,
    blockedChecks,
    review: {
      targetMode: previewPlan.targetMode,
      estimatedTabCount: status === "PASS" ? previewPlan.savedTabCount : 0,
      estimatedWindowCount: status === "PASS" ? createEstimatedWindowCount(previewPlan) : 0,
      plannedGroupCount: status === "PASS" ? previewPlan.plannedGroupCreates.length : 0,
      runtimeAndDbSelectionMatch: previewPlan.runtimeAndDbSelectionMatch,
      activeRuntimeWorkspaceId: previewPlan.activeRuntimeWorkspaceId,
      activeDbWorkspaceId: previewPlan.activeDbWorkspaceId
    }
  };
}

function createPreflightCommandEnvelope(previewPlan, confirmation, preflight) {
  return {
    commandId: crypto.randomUUID(),
    commandName: "projection.resume_preflight_validation",
    authorityClass: "projection_plan",
    requestedBy: "operator",
    requiresConfirmation: false,
    confirmationState: confirmation.decisionState,
    workspaceId: previewPlan.workspace.workspaceId,
    sessionId: previewPlan.latestSession?.sessionId || null,
    projectionId: previewPlan.latestProjection?.projectionId || null,
    sourceState: {
      runtimeSource: "mixed",
      savedWorkspaceExists: true,
      activeRuntimeWorkspaceId: previewPlan.activeRuntimeWorkspaceId,
      activeDbWorkspaceId: previewPlan.activeDbWorkspaceId,
      runtimeAndDbSelectionMatch: previewPlan.runtimeAndDbSelectionMatch
    },
    inputs: {
      workspaceId: previewPlan.workspace.workspaceId,
      targetMode: previewPlan.targetMode,
      includeChromeGroups: previewPlan.includeChromeGroups,
      focusAfterResume: previewPlan.focusAfterResume,
      decisionState: confirmation.decisionState
    },
    preconditions: preflight.passedChecks.concat(preflight.blockedChecks),
    expectedEffects: [
      "No browser state changes in this preflight slice.",
      "No Session DB state changes in this preflight slice.",
      "No chrome.storage.local runtime changes in this preflight slice.",
      "Future execution remains unavailable until implemented in a separate slice."
    ],
    riskSummary: createPreflightRiskSummary(previewPlan, confirmation, preflight),
    operatorReview: {
      summary: createPreflightOperatorSummary(previewPlan, confirmation, preflight),
      willChangeBrowserState: false,
      willChangeSessionDbState: false,
      willChangeChromeStorageRuntime: false,
      estimatedTabCount: preflight.review.estimatedTabCount,
      estimatedWindowCount: preflight.review.estimatedWindowCount,
      cancellationAvailable: confirmation.readyForOperatorDecision
    },
    execution: {
      status: "not_available_in_this_slice",
      startedAt: "",
      completedAt: "",
      timelineEventTypes: [],
      diagnosticAction: "projection_resume_preflight_validated",
      evidence: {
        preflightOnly: true,
        executionAvailableInThisSlice: false,
        futureExecutionAllowedByPreflight: preflight.futureExecutionAllowedByPreflight,
        decisionState: confirmation.decisionState,
        plannedTabCount: previewPlan.plannedTabCreates.length,
        plannedGroupCount: previewPlan.plannedGroupCreates.length,
        blockedReasonCount: preflight.blockedChecks.length,
        preflightStatus: preflight.status
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

function createPreflightRiskSummary(previewPlan, confirmation, preflight) {
  if (preflight.status === "PASS") {
    return "Preflight passes. Future execution would still require a separate explicit command and post-action verification.";
  }

  return "Preflight is blocked: " + preflight.blockedChecks.map((check) => check.message).join(" ");
}

function createPreflightOperatorSummary(previewPlan, confirmation, preflight) {
  if (preflight.status === "PASS") {
    return "Resume preflight passes for " + previewPlan.workspace.name + ": " + previewPlan.savedTabCount + " saved tab(s), " + previewPlan.plannedGroupCreates.length + " planned group(s), target mode " + previewPlan.targetMode + ". No browser action was executed.";
  }

  if (confirmation.decisionState === "cancelled_by_operator") {
    return "Resume preflight blocked because the Operator cancelled the confirmation for " + previewPlan.workspace.name + ".";
  }

  return "Resume preflight blocked for " + previewPlan.workspace.name + ": " + preflight.blockedChecks.map((check) => check.message).join(" ");
}

function createBasePreconditionResults(workspace, tabs, sessions, projections, missingUrlCount) {
  return [
    createCheck("saved_workspace_exists", Boolean(workspace), "Saved workspace exists."),
    createCheck("saved_workspace_not_archived", workspace?.lifecycleState !== "archived", "Saved workspace is not archived."),
    createCheck("saved_tab_records_available", tabs.length > 0, "Saved workspace has tab records."),
    createCheck("saved_tab_urls_available", missingUrlCount === 0, "Saved tab records have URLs."),
    createCheck("session_record_available", sessions.length > 0, "At least one session record is available."),
    createCheck("projection_record_available", projections.length > 0, "At least one projection record is available."),
    createCheck("preflight_only_boundary", true, "This command only validates a future resume action."),
    createCheck("execution_unavailable_in_this_slice", true, "Execution is intentionally unavailable in this slice.")
  ];
}

function createCheck(check, passed, message) {
  return {
    check,
    status: passed ? "pass" : "fail",
    message
  };
}

function createConfirmationStatus(planStatus, decisionState) {
  if (planStatus !== "ready") return "blocked";
  if (decisionState === "cancelled_by_operator") return "cancelled";
  return "pending_operator_decision";
}

function createOperatorDecisionPrompt(previewPlan, decisionState) {
  if (previewPlan.status !== "ready") {
    return "Cannot prepare an executable confirmation decision for " + previewPlan.workspace.name + ": " + previewPlan.blockedReasons.join(" ");
  }

  if (decisionState === "cancelled_by_operator") {
    return "Operator cancelled the future resume decision for " + previewPlan.workspace.name + ". No browser action was executed.";
  }

  return "Review future resume for " + previewPlan.workspace.name + ": " + previewPlan.savedTabCount + " saved tab(s), " + previewPlan.plannedGroupCreates.length + " planned group(s), target mode " + previewPlan.targetMode + ". Execution is not available in this slice.";
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

function createBlockedReasons(workspace, tabs, missingUrlCount) {
  const reasons = [];

  if (!workspace) reasons.push("Saved workspace does not exist.");
  if (workspace?.lifecycleState === "archived") reasons.push("Saved workspace is archived.");
  if (!tabs.length) reasons.push("Saved workspace has no tab records to plan.");
  if (missingUrlCount > 0) reasons.push("One or more saved tab records are missing URLs.");

  return reasons;
}

function getTargetMode(tabCount, dedicatedWindowThreshold) {
  const selected = document.getElementById("projectionResumePreflightTargetMode")?.value || DEFAULT_TARGET_MODE;
  if (selected === "operator_selects") {
    return tabCount >= dedicatedWindowThreshold ? "dedicated_window" : "new_window";
  }

  return selected;
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

function getDecisionState() {
  return document.getElementById("projectionResumePreflightDecisionState")?.value || DEFAULT_DECISION_STATE;
}

function getCheckedValue(id, fallback) {
  const element = document.getElementById(id);
  return element ? Boolean(element.checked) : fallback;
}

function createEstimatedWindowCount(previewPlan) {
  if (previewPlan.status !== "ready") return 0;
  return previewPlan.targetMode === "current_window" ? 0 : 1;
}

function createWorkspaceOptionLabel(workspace, activeWorkspaceId) {
  const marker = workspace.workspaceId === activeWorkspaceId ? " [active DB]" : "";
  return (workspace.name || "Untitled Workspace") + " — " + (workspace.lifecycleState || "unknown") + marker;
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

function createRiskSummary(blockedReasons, tabCount, targetMode, includeChromeGroups) {
  if (blockedReasons.length) {
    return "Plan is blocked: " + blockedReasons.join(" ");
  }

  return "Future execution would affect browser state if implemented later: " + tabCount + " tab(s), target mode " + targetMode + (includeChromeGroups ? ", with Chrome groups." : ", without Chrome groups.");
}

function createSummaryText(packet) {
  return "Resume preflight: " + packet.preflight.status + " | Workspace: " + packet.workspace.name + " | Decision: " + packet.confirmation.decisionState + " | Future allowed: " + packet.preflight.futureExecutionAllowedByPreflight + ".";
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
