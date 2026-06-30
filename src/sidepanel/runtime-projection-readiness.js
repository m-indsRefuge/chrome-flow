import {
  getWorkspace
} from "../core/workspace-store.js";

import {
  getActiveWorkspaceId,
  getDedicatedWindowThreshold,
  getSummaryCardForWorkspace,
  getWorkspaceProjections,
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

installRuntimeProjectionReadiness();

async function installRuntimeProjectionReadiness() {
  renderRuntimeProjectionReadiness();
  attachRuntimeProjectionReadinessHandlers();
  await refreshRuntimeProjectionReadinessSummary();
}

function renderRuntimeProjectionReadiness() {
  if (document.getElementById("runtimeProjectionReadinessSection")) return;

  const anchor = document.getElementById("layer2PersistenceValidationSection") || document.getElementById("savedWorkspaceRegistrySection") || document.querySelector(".workspace-section");
  if (!anchor) return;

  const section = document.createElement("section");
  section.id = "runtimeProjectionReadinessSection";
  section.className = "runtime-projection-readiness-section";

  const heading = document.createElement("h2");
  heading.textContent = "Runtime Projection Readiness";
  section.appendChild(heading);

  const help = document.createElement("p");
  help.className = "section-help";
  help.textContent = "Read-only preflight check for future pause/dehydrate and resume/rehydrate workspace projection controls. No browser tabs or windows are changed.";
  section.appendChild(help);

  const summary = document.createElement("div");
  summary.id = "runtimeProjectionReadinessSummary";
  summary.className = "workspace-session-summary";
  section.appendChild(summary);

  const actions = document.createElement("div");
  actions.className = "workspace-session-actions";
  actions.appendChild(createButton("validateRuntimeProjectionReadinessButton", "Validate Runtime Projection Readiness", "secondary-button"));
  actions.appendChild(createButton("copyRuntimeProjectionReadinessPacketButton", "Copy Projection Readiness Packet", "secondary-button"));
  section.appendChild(actions);

  const status = document.createElement("p");
  status.id = "runtimeProjectionReadinessStatus";
  status.className = "status-message";
  section.appendChild(status);

  const output = document.createElement("pre");
  output.id = "runtimeProjectionReadinessOutput";
  output.className = "diagnostics-output";
  output.textContent = "Runtime projection readiness output will appear here.";
  section.appendChild(output);

  anchor.insertAdjacentElement("afterend", section);
}

function attachRuntimeProjectionReadinessHandlers() {
  document.getElementById("validateRuntimeProjectionReadinessButton")?.addEventListener("click", validateRuntimeProjectionReadiness);
  document.getElementById("copyRuntimeProjectionReadinessPacketButton")?.addEventListener("click", copyRuntimeProjectionReadinessPacket);
}

async function refreshRuntimeProjectionReadinessSummary() {
  try {
    const packet = await buildRuntimeProjectionReadinessPacket();
    setSummary(createSummaryText(packet));
  } catch (error) {
    setSummary("Runtime projection readiness summary unavailable: " + (error?.message || String(error)));
  }
}

async function validateRuntimeProjectionReadiness() {
  try {
    const packet = await buildRuntimeProjectionReadinessPacket();
    setOutput(packet);
    setSummary(createSummaryText(packet));
    setStatus("Runtime projection readiness completed: " + packet.readiness.status + ".");
    await recordDiagnostic("info", "runtime_projection_readiness_validated", "Runtime projection readiness validated.", {
      status: packet.readiness.status,
      passed: packet.readiness.passedChecks.length,
      warnings: packet.readiness.warningChecks.length,
      blocked: packet.readiness.blockedChecks.length,
      savedWorkspaceCount: packet.savedWorkspaceSummary.workspaceCount,
      rehydrateCandidateCount: packet.savedWorkspaceSummary.rehydrateCandidateCount,
      activeRuntimeTabCount: packet.activeRuntimeWorkspace.tabCount
    });
  } catch (error) {
    await handleReadinessError("runtime_projection_readiness_validation_failed", "Could not validate runtime projection readiness.", error);
  }
}

async function copyRuntimeProjectionReadinessPacket() {
  try {
    const packet = await buildRuntimeProjectionReadinessPacket();
    await navigator.clipboard.writeText(formatPacketForClipboard(packet));
    setOutput(packet);
    setSummary(createSummaryText(packet));
    setStatus("Packaged projection readiness packet copied: " + packet.readiness.status + ".");
    await recordDiagnostic("info", "runtime_projection_readiness_packet_copied", "Runtime projection readiness packet copied.", {
      schema: packet.extension.schema,
      status: packet.readiness.status,
      clipboardFormat: packet.clipboard.format,
      savedWorkspaceCount: packet.savedWorkspaceSummary.workspaceCount,
      rehydrateCandidateCount: packet.savedWorkspaceSummary.rehydrateCandidateCount
    });
  } catch (error) {
    await handleReadinessError("runtime_projection_readiness_packet_copy_failed", "Could not copy runtime projection readiness packet.", error);
  }
}

async function buildRuntimeProjectionReadinessPacket() {
  const activeRuntimeWorkspace = await getWorkspace();
  const savedWorkspaces = await listWorkspaceRecords();
  const activeDbWorkspaceId = await getActiveWorkspaceId();
  const dedicatedWindowThreshold = await getDedicatedWindowThreshold();
  const savedWorkspaceDetails = [];

  for (const workspace of savedWorkspaces) {
    const tabs = await getWorkspaceTabs(workspace.workspaceId);
    const sessions = await getWorkspaceSessions(workspace.workspaceId);
    const projections = await getWorkspaceProjections(workspace.workspaceId);
    const summaryCard = await getSummaryCardForWorkspace(workspace.workspaceId);
    savedWorkspaceDetails.push(createSavedWorkspaceReadinessDetail(workspace, tabs, sessions, projections, summaryCard));
  }

  const activeRuntimeSummary = createActiveRuntimeSummary(activeRuntimeWorkspace, dedicatedWindowThreshold);
  const savedWorkspaceSummary = createSavedWorkspaceSummary(savedWorkspaceDetails, activeDbWorkspaceId);
  const controlBoundary = createControlBoundary();
  const readiness = createReadinessResult(activeRuntimeSummary, savedWorkspaceSummary, controlBoundary);
  const createdAt = new Date().toISOString();

  return {
    packetType: "Chrome Flow Runtime Projection Readiness Packet",
    createdAt,
    extension: {
      name: "Chrome Flow",
      schema: "runtime-projection-readiness-packet-v0.1"
    },
    clipboard: {
      format: PACKET_CLIPBOARD_FORMAT,
      contentType: PACKET_CONTENT_TYPE,
      copyMode: "text_envelope",
      envelopeStart: PACKET_ENVELOPE_START,
      envelopeEnd: PACKET_ENVELOPE_END
    },
    source: {
      type: "runtime_projection_readiness",
      readOnly: true,
      runtimeActionExecuted: false,
      browserProjectionChanged: false
    },
    activeRuntimeWorkspace: activeRuntimeSummary,
    savedWorkspaceSummary,
    savedWorkspaceDetails,
    controlBoundary,
    readiness,
    notes: [
      "This packet is generated locally by Chrome Flow.",
      "This readiness check is read-only and does not open, close, move, or group browser tabs.",
      "This slice prepares future runtime projection controls but does not implement pause/dehydrate or resume/rehydrate actions yet.",
      "Any future runtime projection action must be permission-gated and must operate only on workspace-owned browser projections.",
      "Review before sharing because workspace names, tab titles, URLs, and notes may be sensitive."
    ]
  };
}

function createSavedWorkspaceReadinessDetail(workspace, tabs, sessions, projections, summaryCard) {
  const latestSession = sessions[0] || null;
  const latestProjection = projections[0] || null;
  const tabCount = tabs.length;
  const missingUrlCount = tabs.filter((tab) => !tab.url).length;
  const roleCount = new Set(tabs.map((tab) => tab.role || "unassigned")).size;

  return {
    workspaceId: workspace.workspaceId,
    name: workspace.name || "Untitled Workspace",
    workspaceType: workspace.workspaceType || "research",
    lifecycleState: workspace.lifecycleState || "unknown",
    tabCount,
    roleCount,
    missingUrlCount,
    latestSessionState: latestSession?.sessionState || "none",
    latestProjectionState: latestProjection?.projectionState || "none",
    latestProjectionMode: latestProjection?.projectionMode || "none",
    runtimeWindowId: latestProjection?.runtimeWindowId ?? null,
    runtimeTabIdsCount: Array.isArray(latestProjection?.runtimeTabIds) ? latestProjection.runtimeTabIds.length : 0,
    runtimeGroupIdsCount: Array.isArray(latestProjection?.runtimeGroupIds) ? latestProjection.runtimeGroupIds.length : 0,
    summaryCardId: summaryCard?.summaryCardId || "",
    deterministicSummaryAvailable: Boolean(summaryCard?.deterministicSummary),
    canBeRehydratedLater: tabCount > 0 && missingUrlCount === 0 && workspace.lifecycleState !== "archived",
    rehydrateBlockedReason: createRehydrateBlockedReason(workspace, tabCount, missingUrlCount),
    projectedStateReview: "Saved workspace is inspected as stored state only; no browser projection action was executed."
  };
}

function createRehydrateBlockedReason(workspace, tabCount, missingUrlCount) {
  if (workspace.lifecycleState === "archived") return "Workspace is archived.";
  if (tabCount === 0) return "Workspace has no saved tab records to recreate.";
  if (missingUrlCount > 0) return "One or more saved tab records are missing URLs.";
  return "";
}

function createActiveRuntimeSummary(workspace, dedicatedWindowThreshold) {
  const tabs = Array.isArray(workspace?.tabs) ? workspace.tabs : [];
  const openTabs = tabs.filter((tab) => tab.isOpen !== false);
  const missingTabs = tabs.filter((tab) => tab.isOpen === false);
  const runtimeWindowIds = Array.from(new Set(tabs.map((tab) => tab.windowId).filter(Number.isInteger)));
  const runtimeGroupIds = Array.from(new Set(tabs.map((tab) => tab.groupId).filter((groupId) => Number.isInteger(groupId) && groupId !== -1)));

  return {
    workspaceId: workspace?.workspaceId || "",
    name: workspace?.name || "Untitled Workspace",
    workspaceType: workspace?.workspaceType || "research",
    aim: workspace?.aim || "",
    tabCount: tabs.length,
    openTabCount: openTabs.length,
    missingTabCount: missingTabs.length,
    journalEntryCount: Array.isArray(workspace?.journal) ? workspace.journal.length : 0,
    timelineEventCount: Array.isArray(workspace?.timeline) ? workspace.timeline.length : 0,
    runtimeWindowIds,
    runtimeGroupIds,
    dedicatedWindowThreshold,
    wouldRequireDedicatedWindow: tabs.length >= dedicatedWindowThreshold,
    canPrepareFutureDehydrate: tabs.length > 0,
    dehydrateBlockedReason: tabs.length > 0 ? "" : "Active runtime workspace has no workspace tab records to dehydrate.",
    source: "chrome.storage.local"
  };
}

function createSavedWorkspaceSummary(details, activeDbWorkspaceId) {
  const rehydrateCandidates = details.filter((detail) => detail.canBeRehydratedLater);

  return {
    workspaceCount: details.length,
    activeDbWorkspaceId,
    rehydrateCandidateCount: rehydrateCandidates.length,
    rehydrateCandidateIds: rehydrateCandidates.map((detail) => detail.workspaceId),
    dehydratedWorkspaceCount: details.filter((detail) => detail.latestProjectionState === "dehydrated").length,
    hydratedWorkspaceCount: details.filter((detail) => detail.latestProjectionState === "hydrated").length,
    archivedWorkspaceCount: details.filter((detail) => detail.lifecycleState === "archived").length,
    emptySavedWorkspaceCount: details.filter((detail) => detail.tabCount === 0).length
  };
}

function createControlBoundary() {
  return {
    runtimeControlsImplemented: false,
    readinessOnly: true,
    futureActions: [
      {
        action: "future_pause_dehydrate_active_workspace",
        implementationStatus: "not_implemented",
        requiredOperatorConfirmation: true,
        requiredEvidence: [
          "active runtime workspace id",
          "workspace-owned tab ids",
          "saved workspace tab records",
          "projection snapshot",
          "timeline checkpoint"
        ],
        forbiddenBehavior: "Never act on browser tabs by URL match alone."
      },
      {
        action: "future_resume_rehydrate_saved_workspace",
        implementationStatus: "not_implemented",
        requiredOperatorConfirmation: true,
        requiredEvidence: [
          "saved workspace id",
          "saved workspace tab records with URLs",
          "target projection mode",
          "dedicated window decision",
          "post-rehydrate verification"
        ],
        forbiddenBehavior: "Never recreate a browser projection from incomplete or ambiguous saved state."
      }
    ],
    permissionRule: "Runtime projection actions must be explicit, visible, reversible where possible, and limited to workspace-owned state.",
    currentSliceGuarantee: "This slice performs readiness checks only."
  };
}

function createReadinessResult(activeRuntimeSummary, savedWorkspaceSummary, controlBoundary) {
  const passedChecks = [];
  const warningChecks = [];
  const blockedChecks = [];

  pushCheck(controlBoundary.readinessOnly, passedChecks, blockedChecks, "readiness_only_mode", "Runtime projection readiness is read-only.");
  pushCheck(controlBoundary.runtimeControlsImplemented === false, passedChecks, blockedChecks, "runtime_controls_not_implemented", "No live runtime projection controls are implemented in this slice.");
  pushCheck(activeRuntimeSummary.source === "chrome.storage.local", passedChecks, blockedChecks, "legacy_runtime_source_visible", "Active runtime workspace source is explicitly chrome.storage.local.");
  pushCheck(savedWorkspaceSummary.workspaceCount >= 1, passedChecks, warningChecks, "saved_workspace_available", "At least one saved workspace exists in Session DB.");
  pushCheck(savedWorkspaceSummary.hydratedWorkspaceCount === 0, passedChecks, warningChecks, "no_saved_workspace_hydrated", "No saved workspace is currently marked hydrated.");
  pushCheck(savedWorkspaceSummary.rehydrateCandidateCount >= 1, passedChecks, warningChecks, "rehydrate_candidate_available", "At least one saved workspace has complete tab records for future rehydration.");
  pushCheck(activeRuntimeSummary.canPrepareFutureDehydrate, passedChecks, warningChecks, "active_workspace_has_dehydrate_source", "Active runtime workspace has tab records that could be snapshotted in a future dehydrate flow.");

  return {
    status: blockedChecks.length ? "BLOCKED" : warningChecks.length ? "WARN" : "PASS",
    passedChecks,
    warningChecks,
    blockedChecks
  };
}

function pushCheck(condition, passedChecks, notPassedChecks, check, message) {
  const result = { check, message };
  if (condition) {
    passedChecks.push(result);
  } else {
    notPassedChecks.push(result);
  }
}

function createSummaryText(packet) {
  return "Projection readiness: " + packet.readiness.status + " | Saved workspaces: " + packet.savedWorkspaceSummary.workspaceCount + " | Rehydrate candidates: " + packet.savedWorkspaceSummary.rehydrateCandidateCount + " | Active runtime tabs: " + packet.activeRuntimeWorkspace.tabCount + ".";
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

function createButton(id, text, className) {
  const button = document.createElement("button");
  button.id = id;
  button.type = "button";
  button.className = className;
  button.textContent = text;
  return button;
}

function setSummary(message) {
  const summary = document.getElementById("runtimeProjectionReadinessSummary");
  if (summary) summary.textContent = message;
}

function setStatus(message) {
  const status = document.getElementById("runtimeProjectionReadinessStatus");
  if (status) status.textContent = message;
}

function setOutput(value) {
  const output = document.getElementById("runtimeProjectionReadinessOutput");
  if (output) output.textContent = JSON.stringify(value, null, 2);
}

async function handleReadinessError(action, message, error) {
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
    console.warn("Chrome Flow runtime projection readiness diagnostic record failed:", error);
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
