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

installProjectionPlanPreview();

async function installProjectionPlanPreview() {
  renderProjectionPlanPreview();
  attachProjectionPlanPreviewHandlers();
  await refreshProjectionPlanPreviewSummary();
}

function renderProjectionPlanPreview() {
  if (document.getElementById("projectionPlanPreviewSection")) return;

  const anchor = document.getElementById("runtimeProjectionReadinessSection") || document.getElementById("savedWorkspaceRegistrySection") || document.querySelector(".workspace-section");
  if (!anchor) return;

  const section = document.createElement("section");
  section.id = "projectionPlanPreviewSection";
  section.className = "projection-plan-preview-section";

  const heading = document.createElement("h2");
  heading.textContent = "Projection Plan Preview";
  section.appendChild(heading);

  const help = document.createElement("p");
  help.className = "section-help";
  help.textContent = "Dry-run plan for a future workspace resume. This preview reads saved Session DB state only and does not open tabs, create windows, create groups, or change projection state.";
  section.appendChild(help);

  const summary = document.createElement("div");
  summary.id = "projectionPlanPreviewSummary";
  summary.className = "workspace-session-summary";
  section.appendChild(summary);

  const selectorPanel = document.createElement("div");
  selectorPanel.className = "archive-browser-panel";

  const label = document.createElement("label");
  label.htmlFor = "projectionPlanWorkspaceSelect";
  label.textContent = "Workspace to preview";
  selectorPanel.appendChild(label);

  const select = document.createElement("select");
  select.id = "projectionPlanWorkspaceSelect";
  selectorPanel.appendChild(select);

  section.appendChild(selectorPanel);

  const optionsPanel = document.createElement("div");
  optionsPanel.className = "workspace-session-options";

  const targetLabel = document.createElement("label");
  targetLabel.htmlFor = "projectionPlanTargetMode";
  targetLabel.textContent = "Target mode";
  optionsPanel.appendChild(targetLabel);

  const targetSelect = document.createElement("select");
  targetSelect.id = "projectionPlanTargetMode";
  addOption(targetSelect, "operator_selects", "Operator selects at execution time");
  addOption(targetSelect, "current_window", "Current window");
  addOption(targetSelect, "new_window", "New window");
  addOption(targetSelect, "dedicated_window", "Dedicated window");
  targetSelect.value = DEFAULT_TARGET_MODE;
  optionsPanel.appendChild(targetSelect);

  optionsPanel.appendChild(createCheckbox("projectionPlanIncludeChromeGroups", "Include Chrome group plan", DEFAULT_INCLUDE_CHROME_GROUPS));
  optionsPanel.appendChild(createCheckbox("projectionPlanFocusAfterResume", "Focus after future resume", DEFAULT_FOCUS_AFTER_RESUME));
  section.appendChild(optionsPanel);

  const actions = document.createElement("div");
  actions.className = "workspace-session-actions";
  actions.appendChild(createButton("refreshProjectionPlanWorkspacesButton", "Refresh Plan Workspaces", "secondary-button"));
  actions.appendChild(createButton("previewResumePlanButton", "Preview Resume Plan", "secondary-button"));
  actions.appendChild(createButton("copyResumePlanPacketButton", "Copy Resume Plan Packet", "secondary-button"));
  section.appendChild(actions);

  const status = document.createElement("p");
  status.id = "projectionPlanPreviewStatus";
  status.className = "status-message";
  section.appendChild(status);

  const output = document.createElement("pre");
  output.id = "projectionPlanPreviewOutput";
  output.className = "diagnostics-output";
  output.textContent = "Projection plan preview output will appear here.";
  section.appendChild(output);

  anchor.insertAdjacentElement("afterend", section);
}

function attachProjectionPlanPreviewHandlers() {
  document.getElementById("refreshProjectionPlanWorkspacesButton")?.addEventListener("click", refreshProjectionPlanPreviewSummary);
  document.getElementById("previewResumePlanButton")?.addEventListener("click", previewResumePlan);
  document.getElementById("copyResumePlanPacketButton")?.addEventListener("click", copyResumePlanPacket);
}

async function refreshProjectionPlanPreviewSummary() {
  try {
    const workspaces = await listWorkspaceRecords();
    const activeWorkspaceId = await getActiveWorkspaceId();
    const select = document.getElementById("projectionPlanWorkspaceSelect");

    if (!select) return;

    const previousValue = select.value;
    clearElement(select);

    if (!workspaces.length) {
      addOption(select, "", "No saved Session DB workspaces yet");
      select.disabled = true;
      setSummary("Projection plan preview: no saved workspaces available.");
      setStatus("No saved workspaces available for projection planning.");
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

    const candidateCount = await countResumeCandidates(workspaces);
    setSummary("Projection plan preview: saved workspaces " + workspaces.length + " | candidate-like workspaces " + candidateCount + " | selected " + (select.value || "none") + ".");
    setStatus("Projection plan workspace list refreshed.");
    await recordDiagnostic("info", "projection_plan_workspaces_refreshed", "Projection plan workspace list refreshed.", {
      workspaceCount: workspaces.length,
      candidateCount,
      selectedWorkspaceId: select.value || ""
    });
  } catch (error) {
    await handleProjectionPlanError("projection_plan_workspace_refresh_failed", "Could not refresh projection plan workspaces.", error);
  }
}

async function previewResumePlan() {
  try {
    const packet = await buildResumePlanPacket();
    setOutput(packet);
    setSummary(createSummaryText(packet));
    setStatus("Resume plan preview completed: " + packet.plan.status + ".");
    await recordDiagnostic("info", "projection_resume_plan_previewed", "Projection resume plan preview completed.", {
      status: packet.plan.status,
      workspaceId: packet.workspace.workspaceId,
      workspaceName: packet.workspace.name,
      savedTabCount: packet.plan.savedTabCount,
      missingUrlCount: packet.plan.missingUrlCount,
      plannedTabCreates: packet.plan.plannedTabCreates.length,
      plannedGroupCreates: packet.plan.plannedGroupCreates.length,
      blockedReasons: packet.plan.blockedReasons.length
    });
  } catch (error) {
    await handleProjectionPlanError("projection_resume_plan_preview_failed", "Could not preview resume plan.", error);
  }
}

async function copyResumePlanPacket() {
  try {
    const packet = await buildResumePlanPacket();
    await navigator.clipboard.writeText(formatPacketForClipboard(packet));
    setOutput(packet);
    setSummary(createSummaryText(packet));
    setStatus("Packaged resume plan preview copied: " + packet.plan.status + ".");
    await recordDiagnostic("info", "projection_resume_plan_packet_copied", "Projection resume plan packet copied.", {
      schema: packet.extension.schema,
      status: packet.plan.status,
      clipboardFormat: packet.clipboard.format,
      workspaceId: packet.workspace.workspaceId,
      savedTabCount: packet.plan.savedTabCount,
      plannedTabCreates: packet.plan.plannedTabCreates.length,
      plannedGroupCreates: packet.plan.plannedGroupCreates.length
    });
  } catch (error) {
    await handleProjectionPlanError("projection_resume_plan_packet_copy_failed", "Could not copy resume plan packet.", error);
  }
}

async function buildResumePlanPacket() {
  const workspaceId = getSelectedWorkspaceId();
  if (!workspaceId) throw new Error("No saved workspace selected for projection plan preview.");

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
  const includeChromeGroups = getCheckedValue("projectionPlanIncludeChromeGroups", DEFAULT_INCLUDE_CHROME_GROUPS);
  const focusAfterResume = getCheckedValue("projectionPlanFocusAfterResume", DEFAULT_FOCUS_AFTER_RESUME);
  const latestSession = sessions[0] || null;
  const latestProjection = projections[0] || null;
  const missingUrlCount = tabs.filter((tab) => !tab.url).length;
  const roleGroups = createRoleGroups(tabs);
  const blockedReasons = createBlockedReasons(workspace, tabs, missingUrlCount);
  const plannedTabCreates = tabs.map((tab, index) => createPlannedTabCreate(tab, index));
  const plannedGroupCreates = includeChromeGroups ? createPlannedGroupCreates(roleGroups) : [];
  const createdAt = new Date().toISOString();
  const status = blockedReasons.length ? "blocked" : "ready";

  const commandEnvelope = {
    commandId: crypto.randomUUID(),
    commandName: "projection.preview_resume_plan",
    authorityClass: "projection_plan",
    requestedBy: "operator",
    requiresConfirmation: false,
    confirmationState: "not_required",
    workspaceId,
    sessionId: latestSession?.sessionId || null,
    projectionId: latestProjection?.projectionId || null,
    sourceState: {
      runtimeSource: "mixed",
      savedWorkspaceExists: true,
      activeRuntimeWorkspaceId: activeRuntimeWorkspace?.workspaceId || "",
      activeDbWorkspaceId,
      runtimeAndDbSelectionMatch: Boolean(activeRuntimeWorkspace?.workspaceId && activeRuntimeWorkspace.workspaceId === workspaceId)
    },
    inputs: {
      workspaceId,
      targetMode,
      includeChromeGroups,
      focusAfterResume
    },
    preconditions: createPreconditionResults(workspace, tabs, sessions, projections, missingUrlCount),
    expectedEffects: [
      "No browser state changes in this preview slice.",
      "No Session DB state changes in this preview slice.",
      "No chrome.storage.local runtime changes in this preview slice.",
      "Future execution would require explicit Operator confirmation."
    ],
    riskSummary: createRiskSummary(blockedReasons, tabs.length, targetMode, includeChromeGroups),
    operatorReview: {
      summary: createOperatorReviewSummary(workspace, tabs.length, missingUrlCount, targetMode, blockedReasons),
      willChangeBrowserState: false,
      willChangeSessionDbState: false,
      willChangeChromeStorageRuntime: false,
      estimatedTabCount: tabs.length,
      estimatedWindowCount: targetMode === "current_window" ? 0 : 1,
      cancellationAvailable: true
    },
    execution: {
      status: "planned",
      startedAt: "",
      completedAt: "",
      timelineEventTypes: [],
      diagnosticAction: "projection_resume_plan_previewed",
      evidence: {
        previewOnly: true,
        plannedTabCount: plannedTabCreates.length,
        plannedGroupCount: plannedGroupCreates.length,
        blockedReasonCount: blockedReasons.length
      },
      error: null
    },
    verification: {
      required: false,
      status: "not_started",
      checks: [],
      verifiedAt: "",
      evidence: {
        previewOnly: true,
        verificationDeferredUntilExecution: true
      }
    }
  };

  return {
    packetType: "Chrome Flow Projection Resume Plan Packet",
    createdAt,
    extension: {
      name: "Chrome Flow",
      schema: "projection-resume-plan-packet-v0.1"
    },
    clipboard: {
      format: PACKET_CLIPBOARD_FORMAT,
      contentType: PACKET_CONTENT_TYPE,
      copyMode: "text_envelope",
      envelopeStart: PACKET_ENVELOPE_START,
      envelopeEnd: PACKET_ENVELOPE_END
    },
    source: {
      type: "projection_preview_resume_plan",
      readOnly: true,
      planOnly: true,
      runtimeActionExecuted: false,
      browserProjectionChanged: false,
      sessionDbChanged: false,
      chromeStorageRuntimeChanged: false
    },
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
    plan: {
      status,
      workspaceId,
      workspaceName: workspace.name,
      savedTabCount: tabs.length,
      missingUrlCount,
      targetMode,
      dedicatedWindowThreshold,
      wouldUseDedicatedWindow: targetMode === "dedicated_window",
      includeChromeGroups,
      focusAfterResume,
      requiresConfirmationForFutureExecution: true,
      plannedTabCreates,
      plannedGroupCreates,
      blockedReasons,
      riskSummary: createRiskSummary(blockedReasons, tabs.length, targetMode, includeChromeGroups)
    },
    commandEnvelope,
    notes: [
      "This packet is generated locally by Chrome Flow.",
      "This is a dry-run resume plan only.",
      "This slice does not open tabs, create windows, create Chrome groups, mark projections hydrated, or change runtime authority.",
      "Future execution must require explicit Operator confirmation and post-action verification.",
      "Review before sharing because saved workspace plans include workspace names, tab titles, URLs, and roles."
    ]
  };
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
    createPrecondition("preview_only_boundary", true, "This command is preview-only and does not execute browser actions."),
    createPrecondition("future_confirmation_required", true, "Future resume execution will require explicit Operator confirmation.")
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
  const selected = document.getElementById("projectionPlanTargetMode")?.value || DEFAULT_TARGET_MODE;
  if (selected === "operator_selects") {
    return tabCount >= dedicatedWindowThreshold ? "dedicated_window" : "new_window";
  }

  return selected;
}

function getSelectedWorkspaceId() {
  const localSelect = document.getElementById("projectionPlanWorkspaceSelect");
  if (localSelect?.value) return localSelect.value;

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

async function countResumeCandidates(workspaces) {
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

  return "Preview is ready. Future execution would plan " + tabCount + " tab(s) using target mode " + targetMode + (includeChromeGroups ? " with Chrome groups." : " without Chrome groups.");
}

function createOperatorReviewSummary(workspace, tabCount, missingUrlCount, targetMode, blockedReasons) {
  if (blockedReasons.length) {
    return "Cannot prepare future resume for " + (workspace?.name || "selected workspace") + ": " + blockedReasons.join(" ");
  }

  return "Future resume plan for " + workspace.name + ": " + tabCount + " saved tab(s), " + missingUrlCount + " missing URL(s), target mode " + targetMode + ".";
}

function createSummaryText(packet) {
  return "Resume plan preview: " + packet.plan.status + " | Workspace: " + packet.workspace.name + " | Saved tabs: " + packet.plan.savedTabCount + " | Planned groups: " + packet.plan.plannedGroupCreates.length + " | Target: " + packet.plan.targetMode + ".";
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
  const summary = document.getElementById("projectionPlanPreviewSummary");
  if (summary) summary.textContent = message;
}

function setStatus(message) {
  const status = document.getElementById("projectionPlanPreviewStatus");
  if (status) status.textContent = message;
}

function setOutput(value) {
  const output = document.getElementById("projectionPlanPreviewOutput");
  if (output) output.textContent = JSON.stringify(value, null, 2);
}

async function handleProjectionPlanError(action, message, error) {
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
    console.warn("Chrome Flow projection plan preview diagnostic record failed:", error);
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
