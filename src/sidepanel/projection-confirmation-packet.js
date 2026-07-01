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
let lastDecisionState = "pending_operator_decision";

installProjectionConfirmationPacket();

async function installProjectionConfirmationPacket() {
  renderProjectionConfirmationPacket();
  attachProjectionConfirmationHandlers();
  await refreshProjectionConfirmationSummary();
}

function renderProjectionConfirmationPacket() {
  if (document.getElementById("projectionConfirmationPacketSection")) return;

  const anchor = document.getElementById("projectionPlanPreviewSection") || document.getElementById("runtimeProjectionReadinessSection") || document.querySelector(".workspace-section");
  if (!anchor) return;

  const section = document.createElement("section");
  section.id = "projectionConfirmationPacketSection";
  section.className = "projection-confirmation-packet-section";

  const heading = document.createElement("h2");
  heading.textContent = "Projection Confirmation Packet";
  section.appendChild(heading);

  const help = document.createElement("p");
  help.className = "section-help";
  help.textContent = "Prepare an explicit Operator decision packet from a ready resume plan. This surface does not execute the plan, approve live browser changes, or create browser projections.";
  section.appendChild(help);

  const summary = document.createElement("div");
  summary.id = "projectionConfirmationSummary";
  summary.className = "workspace-session-summary";
  section.appendChild(summary);

  const selectorPanel = document.createElement("div");
  selectorPanel.className = "archive-browser-panel";

  const label = document.createElement("label");
  label.htmlFor = "projectionConfirmationWorkspaceSelect";
  label.textContent = "Workspace for confirmation packet";
  selectorPanel.appendChild(label);

  const select = document.createElement("select");
  select.id = "projectionConfirmationWorkspaceSelect";
  selectorPanel.appendChild(select);
  section.appendChild(selectorPanel);

  const optionsPanel = document.createElement("div");
  optionsPanel.className = "workspace-session-options";

  const targetLabel = document.createElement("label");
  targetLabel.htmlFor = "projectionConfirmationTargetMode";
  targetLabel.textContent = "Target mode";
  optionsPanel.appendChild(targetLabel);

  const targetSelect = document.createElement("select");
  targetSelect.id = "projectionConfirmationTargetMode";
  addOption(targetSelect, "operator_selects", "Operator selects at execution time");
  addOption(targetSelect, "current_window", "Current window");
  addOption(targetSelect, "new_window", "New window");
  addOption(targetSelect, "dedicated_window", "Dedicated window");
  targetSelect.value = DEFAULT_TARGET_MODE;
  optionsPanel.appendChild(targetSelect);

  optionsPanel.appendChild(createCheckbox("projectionConfirmationIncludeChromeGroups", "Include Chrome group intent", DEFAULT_INCLUDE_CHROME_GROUPS));
  optionsPanel.appendChild(createCheckbox("projectionConfirmationFocusAfterResume", "Focus after future execution", DEFAULT_FOCUS_AFTER_RESUME));
  section.appendChild(optionsPanel);

  const decisionPanel = document.createElement("div");
  decisionPanel.className = "workspace-session-options";

  const decisionLabel = document.createElement("label");
  decisionLabel.htmlFor = "projectionConfirmationDecisionState";
  decisionLabel.textContent = "Decision state";
  decisionPanel.appendChild(decisionLabel);

  const decisionSelect = document.createElement("select");
  decisionSelect.id = "projectionConfirmationDecisionState";
  addOption(decisionSelect, "pending_operator_decision", "Pending Operator decision");
  addOption(decisionSelect, "cancelled_by_operator", "Cancelled by Operator");
  decisionSelect.value = lastDecisionState;
  decisionPanel.appendChild(decisionSelect);
  section.appendChild(decisionPanel);

  const actions = document.createElement("div");
  actions.className = "workspace-session-actions";
  actions.appendChild(createButton("refreshProjectionConfirmationWorkspacesButton", "Refresh Confirmation Workspaces", "secondary-button"));
  actions.appendChild(createButton("prepareProjectionConfirmationPacketButton", "Prepare Confirmation Packet", "secondary-button"));
  actions.appendChild(createButton("cancelProjectionConfirmationPacketButton", "Mark Packet Cancelled", "secondary-button"));
  actions.appendChild(createButton("copyProjectionConfirmationPacketButton", "Copy Confirmation Packet", "secondary-button"));
  section.appendChild(actions);

  const status = document.createElement("p");
  status.id = "projectionConfirmationStatus";
  status.className = "status-message";
  section.appendChild(status);

  const output = document.createElement("pre");
  output.id = "projectionConfirmationOutput";
  output.className = "diagnostics-output";
  output.textContent = "Projection confirmation packet output will appear here.";
  section.appendChild(output);

  anchor.insertAdjacentElement("afterend", section);
}

function attachProjectionConfirmationHandlers() {
  document.getElementById("refreshProjectionConfirmationWorkspacesButton")?.addEventListener("click", refreshProjectionConfirmationSummary);
  document.getElementById("prepareProjectionConfirmationPacketButton")?.addEventListener("click", prepareProjectionConfirmationPacket);
  document.getElementById("cancelProjectionConfirmationPacketButton")?.addEventListener("click", markProjectionConfirmationCancelled);
  document.getElementById("copyProjectionConfirmationPacketButton")?.addEventListener("click", copyProjectionConfirmationPacket);
  document.getElementById("projectionConfirmationDecisionState")?.addEventListener("change", (event) => {
    lastDecisionState = event.target.value || "pending_operator_decision";
  });
}

async function refreshProjectionConfirmationSummary() {
  try {
    const workspaces = await listWorkspaceRecords();
    const activeWorkspaceId = await getActiveWorkspaceId();
    const select = document.getElementById("projectionConfirmationWorkspaceSelect");

    if (!select) return;

    const previousValue = select.value;
    clearElement(select);

    if (!workspaces.length) {
      addOption(select, "", "No saved Session DB workspaces yet");
      select.disabled = true;
      setSummary("Projection confirmation packet: no saved workspaces available.");
      setStatus("No saved workspaces available for confirmation packet preparation.");
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

    const candidateCount = await countConfirmationCandidates(workspaces);
    setSummary("Projection confirmation packet: saved workspaces " + workspaces.length + " | ready candidates " + candidateCount + " | selected " + (select.value || "none") + ".");
    setStatus("Projection confirmation workspace list refreshed.");
    await recordDiagnostic("info", "projection_confirmation_workspaces_refreshed", "Projection confirmation workspace list refreshed.", {
      workspaceCount: workspaces.length,
      candidateCount,
      selectedWorkspaceId: select.value || ""
    });
  } catch (error) {
    await handleConfirmationError("projection_confirmation_workspace_refresh_failed", "Could not refresh projection confirmation workspaces.", error);
  }
}

async function prepareProjectionConfirmationPacket() {
  lastDecisionState = "pending_operator_decision";
  setDecisionState(lastDecisionState);
  await renderConfirmationPacket("projection_confirmation_packet_prepared", "Projection confirmation packet prepared.");
}

async function markProjectionConfirmationCancelled() {
  lastDecisionState = "cancelled_by_operator";
  setDecisionState(lastDecisionState);
  await renderConfirmationPacket("projection_confirmation_packet_cancelled", "Projection confirmation packet marked cancelled.");
}

async function copyProjectionConfirmationPacket() {
  try {
    const packet = await buildConfirmationPacket(lastDecisionState);
    await navigator.clipboard.writeText(formatPacketForClipboard(packet));
    setOutput(packet);
    setSummary(createSummaryText(packet));
    setStatus("Packaged projection confirmation packet copied: " + packet.confirmation.status + ".");
    await recordDiagnostic("info", "projection_confirmation_packet_copied", "Projection confirmation packet copied.", {
      schema: packet.extension.schema,
      status: packet.confirmation.status,
      decisionState: packet.confirmation.decisionState,
      workspaceId: packet.workspace.workspaceId,
      plannedTabCreates: packet.previewPlan.plannedTabCreates.length,
      plannedGroupCreates: packet.previewPlan.plannedGroupCreates.length,
      executionAvailableInThisSlice: packet.confirmation.executionAvailableInThisSlice
    });
  } catch (error) {
    await handleConfirmationError("projection_confirmation_packet_copy_failed", "Could not copy projection confirmation packet.", error);
  }
}

async function renderConfirmationPacket(action, message) {
  try {
    const packet = await buildConfirmationPacket(lastDecisionState);
    setOutput(packet);
    setSummary(createSummaryText(packet));
    setStatus(message + " Status: " + packet.confirmation.status + ".");
    await recordDiagnostic("info", action, message, {
      status: packet.confirmation.status,
      decisionState: packet.confirmation.decisionState,
      workspaceId: packet.workspace.workspaceId,
      workspaceName: packet.workspace.name,
      previewPlanStatus: packet.previewPlan.status,
      plannedTabCreates: packet.previewPlan.plannedTabCreates.length,
      plannedGroupCreates: packet.previewPlan.plannedGroupCreates.length,
      executionAvailableInThisSlice: packet.confirmation.executionAvailableInThisSlice
    });
  } catch (error) {
    await handleConfirmationError(action + "_failed", "Could not prepare projection confirmation packet.", error);
  }
}

async function buildConfirmationPacket(decisionState = "pending_operator_decision") {
  const workspaceId = getSelectedWorkspaceId();
  if (!workspaceId) throw new Error("No saved workspace selected for projection confirmation packet.");

  const previewPlan = await buildPreviewPlan(workspaceId);
  const createdAt = new Date().toISOString();
  const readyForConfirmation = previewPlan.status === "ready";
  const normalizedDecisionState = readyForConfirmation ? decisionState : "blocked_no_decision_available";
  const confirmationStatus = createConfirmationStatus(previewPlan.status, normalizedDecisionState);

  return {
    packetType: "Chrome Flow Projection Resume Confirmation Packet",
    createdAt,
    extension: {
      name: "Chrome Flow",
      schema: "projection-resume-confirmation-packet-v0.1"
    },
    clipboard: {
      format: PACKET_CLIPBOARD_FORMAT,
      contentType: PACKET_CONTENT_TYPE,
      copyMode: "text_envelope",
      envelopeStart: PACKET_ENVELOPE_START,
      envelopeEnd: PACKET_ENVELOPE_END
    },
    source: {
      type: "projection_resume_confirmation_packet",
      readOnly: true,
      confirmationOnly: true,
      planOnly: true,
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
    confirmation: {
      status: confirmationStatus,
      decisionState: normalizedDecisionState,
      readyForOperatorDecision: readyForConfirmation,
      executionAvailableInThisSlice: false,
      approveAvailable: false,
      approveMeaning: "Approval is not executable in this slice; it can only be represented as a future decision requirement.",
      cancelAvailable: readyForConfirmation,
      cancelMeaning: "Cancellation records that the Operator does not want this future execution plan to proceed.",
      willChangeBrowserStateIfExecutedLater: readyForConfirmation,
      willChangeSessionDbStateIfExecutedLater: readyForConfirmation,
      willChangeChromeStorageRuntimeIfExecutedLater: false,
      requiresFutureExecutionImplementation: true,
      requiresFuturePostActionVerification: true,
      operatorDecisionPrompt: createOperatorDecisionPrompt(previewPlan, normalizedDecisionState),
      blockedReasons: readyForConfirmation ? [] : previewPlan.blockedReasons
    },
    commandEnvelope: createConfirmationCommandEnvelope(previewPlan, normalizedDecisionState, confirmationStatus),
    notes: [
      "This packet is generated locally by Chrome Flow.",
      "This is a confirmation packet only and does not execute the preview plan.",
      "Approval execution is intentionally unavailable in this slice.",
      "This slice does not open tabs, create windows, create Chrome groups, mark projections hydrated, or change runtime authority.",
      "Future execution must be implemented as a separate permission-gated action with post-action verification.",
      "Review before sharing because confirmation packets include workspace names, tab titles, URLs, and roles."
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
  const includeChromeGroups = getCheckedValue("projectionConfirmationIncludeChromeGroups", DEFAULT_INCLUDE_CHROME_GROUPS);
  const focusAfterResume = getCheckedValue("projectionConfirmationFocusAfterResume", DEFAULT_FOCUS_AFTER_RESUME);
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
    preconditions: createPreconditionResults(workspace, tabs, sessions, projections, missingUrlCount)
  };
}

function createConfirmationCommandEnvelope(previewPlan, decisionState, confirmationStatus) {
  return {
    commandId: crypto.randomUUID(),
    commandName: "projection.resume_confirmation_packet",
    authorityClass: "projection_plan",
    requestedBy: "operator",
    requiresConfirmation: false,
    confirmationState: decisionState,
    workspaceId: previewPlan.workspace.workspaceId,
    sessionId: previewPlan.latestSession?.sessionId || null,
    projectionId: previewPlan.latestProjection?.projectionId || null,
    sourceState: {
      runtimeSource: "mixed",
      savedWorkspaceExists: true,
      activeRuntimeWorkspaceId: previewPlan.activeRuntimeWorkspaceId,
      activeDbWorkspaceId: previewPlan.activeDbWorkspaceId,
      runtimeAndDbSelectionMatch: Boolean(previewPlan.activeRuntimeWorkspaceId && previewPlan.activeRuntimeWorkspaceId === previewPlan.workspace.workspaceId)
    },
    inputs: {
      workspaceId: previewPlan.workspace.workspaceId,
      targetMode: previewPlan.targetMode,
      includeChromeGroups: previewPlan.includeChromeGroups,
      focusAfterResume: previewPlan.focusAfterResume,
      decisionState
    },
    preconditions: previewPlan.preconditions,
    expectedEffects: [
      "No browser state changes in this confirmation slice.",
      "No Session DB state changes in this confirmation slice.",
      "No chrome.storage.local runtime changes in this confirmation slice.",
      "Future execution remains unavailable until implemented in a separate slice."
    ],
    riskSummary: previewPlan.riskSummary,
    operatorReview: {
      summary: createOperatorDecisionPrompt(previewPlan, decisionState),
      willChangeBrowserState: false,
      willChangeSessionDbState: false,
      willChangeChromeStorageRuntime: false,
      estimatedTabCount: previewPlan.savedTabCount,
      estimatedWindowCount: previewPlan.targetMode === "current_window" ? 0 : 1,
      cancellationAvailable: previewPlan.status === "ready"
    },
    execution: {
      status: "not_available_in_this_slice",
      startedAt: "",
      completedAt: "",
      timelineEventTypes: [],
      diagnosticAction: "projection_confirmation_packet_prepared",
      evidence: {
        confirmationOnly: true,
        executionAvailableInThisSlice: false,
        decisionState,
        plannedTabCount: previewPlan.plannedTabCreates.length,
        plannedGroupCount: previewPlan.plannedGroupCreates.length,
        blockedReasonCount: previewPlan.blockedReasons.length,
        confirmationStatus
      },
      error: null
    },
    verification: {
      required: false,
      status: "not_started",
      checks: [],
      verifiedAt: "",
      evidence: {
        confirmationOnly: true,
        verificationDeferredUntilFutureExecution: true
      }
    }
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

function createPreconditionResults(workspace, tabs, sessions, projections, missingUrlCount) {
  return [
    createPrecondition("saved_workspace_exists", Boolean(workspace), "Saved workspace exists."),
    createPrecondition("saved_workspace_not_archived", workspace?.lifecycleState !== "archived", "Saved workspace is not archived."),
    createPrecondition("saved_tab_records_available", tabs.length > 0, "Saved workspace has tab records."),
    createPrecondition("saved_tab_urls_available", missingUrlCount === 0, "Saved tab records have URLs."),
    createPrecondition("session_record_available", sessions.length > 0, "At least one session record is available."),
    createPrecondition("projection_record_available", projections.length > 0, "At least one projection record is available."),
    createPrecondition("confirmation_only_boundary", true, "This command only prepares an Operator decision packet."),
    createPrecondition("execution_unavailable_in_this_slice", true, "Execution is intentionally unavailable in this slice.")
  ];
}

function createPrecondition(check, passed, message) {
  return {
    check,
    status: passed ? "pass" : "fail",
    message
  };
}

function getTargetMode(tabCount, dedicatedWindowThreshold) {
  const selected = document.getElementById("projectionConfirmationTargetMode")?.value || DEFAULT_TARGET_MODE;
  if (selected === "operator_selects") {
    return tabCount >= dedicatedWindowThreshold ? "dedicated_window" : "new_window";
  }

  return selected;
}

function getSelectedWorkspaceId() {
  const localSelect = document.getElementById("projectionConfirmationWorkspaceSelect");
  if (localSelect?.value) return localSelect.value;

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

async function countConfirmationCandidates(workspaces) {
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
  return "Confirmation packet: " + packet.confirmation.status + " | Workspace: " + packet.workspace.name + " | Tabs: " + packet.previewPlan.savedTabCount + " | Groups: " + packet.previewPlan.plannedGroupCreates.length + " | Execution available: " + packet.confirmation.executionAvailableInThisSlice + ".";
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

function setDecisionState(value) {
  const select = document.getElementById("projectionConfirmationDecisionState");
  if (select) select.value = value;
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
  const summary = document.getElementById("projectionConfirmationSummary");
  if (summary) summary.textContent = message;
}

function setStatus(message) {
  const status = document.getElementById("projectionConfirmationStatus");
  if (status) status.textContent = message;
}

function setOutput(value) {
  const output = document.getElementById("projectionConfirmationOutput");
  if (output) output.textContent = JSON.stringify(value, null, 2);
}

async function handleConfirmationError(action, message, error) {
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
    console.warn("Chrome Flow projection confirmation diagnostic record failed:", error);
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
