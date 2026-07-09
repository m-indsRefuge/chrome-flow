import { registerDeveloperSurface } from "./developer-mode.js";

import {
  appendRuntimeDiagnostic,
  getActiveWorkspaceRuntime,
  getRuntimeDiagnostics
} from "../core/workspace-runtime-store.js";

const MAX_DIAGNOSTICS_TO_SCAN = 200;
const DEDICATED_WINDOW_THRESHOLD_TAB_COUNT = 4;

installLayer2PostResumeVerificationPacketSurface();

function installLayer2PostResumeVerificationPacketSurface() {
  const anchor = document.getElementById("layer2MemoryContractValidationPacketSection")
    || document.getElementById("layer2LifecycleValidationPacketSection")
    || document.getElementById("developerDiagnosticsSection")
    || document.querySelector(".workspace-section");

  if (!anchor || document.getElementById("layer2PostResumeVerificationPacketSection")) return;

  const section = document.createElement("section");
  section.id = "layer2PostResumeVerificationPacketSection";
  section.className = "layer2-post-resume-verification-packet-section";
  section.innerHTML = `
    <h2>Layer 2 Post-Resume Verification Packet</h2>
    <p class="section-help">Developer-only readout that verifies a resumed workspace across all Chrome windows. This is read-only and does not open, close, move, group, or restore tabs.</p>
    <div class="workspace-session-actions">
      <button id="prepareLayer2PostResumeVerificationPacketButton" type="button" class="secondary-button">Prepare Post-Resume Packet</button>
      <button id="copyLayer2PostResumeVerificationPacketButton" type="button" class="secondary-button" disabled>Copy Post-Resume Packet</button>
    </div>
    <p id="layer2PostResumeVerificationPacketStatus" class="status-message">Resume a workspace, then prepare this packet to verify the live browser projection.</p>
    <pre id="layer2PostResumeVerificationPacketOutput" class="diagnostic-output"></pre>
  `;

  anchor.insertAdjacentElement("afterend", section);
  registerDeveloperSurface(section);

  document.getElementById("prepareLayer2PostResumeVerificationPacketButton")?.addEventListener("click", prepareLayer2PostResumeVerificationPacket);
  document.getElementById("copyLayer2PostResumeVerificationPacketButton")?.addEventListener("click", copyLayer2PostResumeVerificationPacket);
}

async function prepareLayer2PostResumeVerificationPacket() {
  const packet = await buildLayer2PostResumeVerificationPacket();
  const output = document.getElementById("layer2PostResumeVerificationPacketOutput");
  const status = document.getElementById("layer2PostResumeVerificationPacketStatus");
  const copyButton = document.getElementById("copyLayer2PostResumeVerificationPacketButton");

  if (output) output.textContent = JSON.stringify(packet, null, 2);
  if (status) status.textContent = "Post-resume packet prepared: " + packet.verification.status + ".";
  if (copyButton) copyButton.removeAttribute("disabled");

  await appendRuntimeDiagnostic("info", "layer2_post_resume_verification_packet_prepared", "Layer 2 post-resume verification packet prepared.", {
    status: packet.verification.status,
    passedCheckCount: packet.verification.passedCheckCount,
    warningCheckCount: packet.verification.warningCheckCount,
    failedCheckCount: packet.verification.failedCheckCount,
    schema: packet.extension.schema
  });
}

async function copyLayer2PostResumeVerificationPacket() {
  const output = document.getElementById("layer2PostResumeVerificationPacketOutput");
  const status = document.getElementById("layer2PostResumeVerificationPacketStatus");

  if (!output?.textContent?.trim()) {
    if (status) status.textContent = "Prepare the post-resume packet before copying.";
    return;
  }

  await navigator.clipboard.writeText(buildClipboardEnvelope(output.textContent));
  if (status) status.textContent = "Post-resume packet copied.";

  await appendRuntimeDiagnostic("info", "layer2_post_resume_verification_packet_copied", "Layer 2 post-resume verification packet copied.", {
    envelopeFormat: "chrome_flow_packet_envelope_v0.1"
  });
}

async function buildLayer2PostResumeVerificationPacket() {
  const [workspace, diagnostics, liveTabs, liveGroups] = await Promise.all([
    getActiveWorkspaceRuntime(),
    getRuntimeDiagnostics(),
    queryAllChromeTabs(),
    queryAllChromeTabGroups()
  ]);

  const recentDiagnostics = diagnostics.slice(-MAX_DIAGNOSTICS_TO_SCAN);
  const latestResume = findLatestDiagnostic(recentDiagnostics, "workspace_library_resume_executed");
  const latestGroups = findLatestDiagnostic(recentDiagnostics, "workspace_resume_groups_recreated");
  const latestFocus = findLatestDiagnostic(recentDiagnostics, "workspace_resume_window_focused");
  const latestFocusFailure = findLatestDiagnostic(recentDiagnostics, "workspace_resume_window_focus_failed");

  const liveProjection = buildLiveProjectionSummary(workspace, liveTabs, liveGroups, latestResume);
  const checks = buildVerificationChecks(workspace, latestResume, latestGroups, latestFocus, latestFocusFailure, liveProjection);
  const failedChecks = checks.filter((check) => check.status === "fail");
  const warningChecks = checks.filter((check) => check.status === "warn");
  const passedChecks = checks.filter((check) => check.status === "pass");

  return {
    packetType: "Chrome Flow Layer 2 Post-Resume Verification Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "layer2-post-resume-verification-packet-v0.1"
    },
    source: {
      type: "layer2_post_resume_verification_packet",
      developerOnly: true,
      readOnly: true,
      validationOnly: true,
      runtimeActionExecuted: false,
      browserProjectionChanged: false,
      sessionDbChanged: false,
      chromeStorageRuntimeChanged: false
    },
    verification: {
      status: failedChecks.length ? "needs_attention" : warningChecks.length ? "accepted_with_warnings" : "ready_for_layer2_completion_checkpoint",
      passedCheckCount: passedChecks.length,
      warningCheckCount: warningChecks.length,
      failedCheckCount: failedChecks.length,
      checkCount: checks.length,
      checks,
      failedChecks,
      warningChecks
    },
    activeWorkspace: summarizeWorkspace(workspace),
    latestResumeEvidence: {
      resume: summarizeDiagnostic(latestResume),
      groups: summarizeDiagnostic(latestGroups),
      focus: summarizeDiagnostic(latestFocus),
      focusFailure: summarizeDiagnostic(latestFocusFailure)
    },
    liveProjection,
    nextDecision: {
      recommendation: failedChecks.length ? "repair_post_resume_projection_verification" : "proceed_to_layer2_completion_checkpoint",
      notes: [
        "This packet verifies live resumed tabs across all Chrome windows, not only the current sidepanel window.",
        "This packet does not open, close, move, group, or restore tabs.",
        "A clean pass means Workspace Library Resume has live browser projection evidence suitable for Layer 2 completion."
      ]
    }
  };
}

function buildVerificationChecks(workspace, latestResume, latestGroups, latestFocus, latestFocusFailure, liveProjection) {
  return [
    createCheck("active_workspace_exists", Boolean(workspace?.workspaceId), "Active runtime workspace exists."),
    createCheck("latest_resume_diagnostic_exists", Boolean(latestResume), "Latest Workspace Library resume execution diagnostic exists."),
    createCheck("active_workspace_matches_latest_resume", Boolean(workspace?.workspaceId && latestResume?.details?.workspaceId === workspace.workspaceId), "Active runtime workspace matches latest resume diagnostic."),
    createCheck("resume_target_mode_recorded", ["current_window", "dedicated_window"].includes(latestResume?.details?.restoreTargetMode), "Resume target mode is recorded."),
    createCheck("expected_tab_count_matches_resume", liveProjection.expectedTabCount === Number(latestResume?.details?.reopenedTabCount || 0), "Expected workspace tab count matches reopened tab count from resume diagnostic."),
    createCheck("all_workspace_tabs_found_across_chrome", liveProjection.missingLiveTabCount === 0 && liveProjection.liveWorkspaceTabCount === liveProjection.expectedTabCount, "All active workspace tab IDs are found across all Chrome windows."),
    createCheck("all_live_workspace_tabs_grouped", liveProjection.ungroupedLiveTabCount === 0, "All live workspace tabs are assigned to Chrome tab groups."),
    createCheck("group_recreation_diagnostic_exists", Boolean(latestGroups), "Group recreation diagnostic exists."),
    createCheck("recreated_group_count_matches_live_groups", liveProjection.liveGroupCount === Number(latestGroups?.details?.recreatedGroupCount || 0), "Live group count matches recreated group count diagnostic."),
    createCheck("group_labels_match_workspace_initials", liveProjection.groupLabelMismatchCount === 0, "Live group titles match role label plus workspace initials."),
    createCheck("window_focus_success", Boolean(latestFocus), "Window focus success diagnostic exists."),
    createCheck("no_later_window_focus_failure", !latestFocusFailure || new Date(latestFocusFailure.createdAt) < new Date(latestFocus?.createdAt || 0), "No unresolved post-resume window focus failure exists."),
    createCheck("target_window_policy_verified", verifyTargetWindowPolicy(latestResume, liveProjection), "Live tabs satisfy current-window or dedicated-window target policy."),
    createCheck("resume_policy_threshold_preserved", Number(latestResume?.details?.restorePolicy?.thresholdTabCount || 0) === DEDICATED_WINDOW_THRESHOLD_TAB_COUNT, "Resume policy preserves the 4-tab dedicated-window threshold.")
  ];
}

function buildLiveProjectionSummary(workspace, liveTabs, liveGroups, latestResume) {
  const workspaceTabs = Array.isArray(workspace?.tabs) ? workspace.tabs : [];
  const liveTabById = new Map(liveTabs.map((tab) => [tab.id, tab]));
  const liveGroupById = new Map(liveGroups.map((group) => [group.id, group]));
  const expectedInitials = createWorkspaceInitials(workspace?.name || "Chrome Flow");
  const tabRecords = workspaceTabs.map((workspaceTab) => buildWorkspaceTabVerificationRecord(workspaceTab, liveTabById, liveGroupById, expectedInitials));
  const liveWorkspaceTabs = tabRecords.filter((record) => record.liveTabFound);
  const missingTabs = tabRecords.filter((record) => !record.liveTabFound);
  const ungroupedTabs = liveWorkspaceTabs.filter((record) => !record.liveGroupFound);
  const liveGroupsById = new Map();

  for (const record of liveWorkspaceTabs) {
    if (Number.isInteger(record.liveGroupId) && record.liveGroupId >= 0 && record.liveGroupFound) {
      liveGroupsById.set(record.liveGroupId, {
        groupId: record.liveGroupId,
        title: record.liveGroupTitle,
        windowId: record.liveWindowId,
        role: record.role,
        roleLabel: record.roleLabel,
        expectedTitle: record.expectedGroupTitle
      });
    }
  }

  const windowIds = Array.from(new Set(liveWorkspaceTabs.map((record) => record.liveWindowId).filter((windowId) => Number.isInteger(windowId))));
  const targetWindowId = latestResume?.details?.windowId || null;
  const liveGroupSummaries = Array.from(liveGroupsById.values()).sort((a, b) => String(a.title).localeCompare(String(b.title)));
  const labelMismatches = liveGroupSummaries.filter((group) => group.title !== group.expectedTitle);

  return {
    expectedTabCount: workspaceTabs.length,
    liveWorkspaceTabCount: liveWorkspaceTabs.length,
    missingLiveTabCount: missingTabs.length,
    groupedLiveTabCount: liveWorkspaceTabs.length - ungroupedTabs.length,
    ungroupedLiveTabCount: ungroupedTabs.length,
    liveGroupCount: liveGroupSummaries.length,
    groupLabelMismatchCount: labelMismatches.length,
    expectedWorkspaceInitials: expectedInitials,
    targetWindowId,
    liveWindowIds: windowIds,
    allLiveTabsInTargetWindow: Number.isInteger(targetWindowId) && liveWorkspaceTabs.every((record) => record.liveWindowId === targetWindowId),
    tabRecords,
    missingTabs,
    ungroupedTabs,
    liveGroups: liveGroupSummaries,
    labelMismatches
  };
}

function buildWorkspaceTabVerificationRecord(workspaceTab, liveTabById, liveGroupById, expectedInitials) {
  const tabId = Number(workspaceTab?.tabId);
  const liveTab = Number.isInteger(tabId) ? liveTabById.get(tabId) : null;
  const liveGroupId = liveTab ? Number(liveTab.groupId) : Number(workspaceTab?.groupId);
  const liveGroup = Number.isInteger(liveGroupId) && liveGroupId >= 0 ? liveGroupById.get(liveGroupId) : null;
  const role = normalizeRole(workspaceTab?.role);
  const roleLabel = getRoleLabel(role);
  const expectedGroupTitle = buildExpectedGroupTitle(roleLabel, expectedInitials);

  return {
    workspaceTabId: workspaceTab?.workspaceTabId || "",
    savedTabId: Number.isInteger(tabId) ? tabId : null,
    title: workspaceTab?.title || workspaceTab?.originalTitle || workspaceTab?.alias || "Untitled tab",
    url: workspaceTab?.url || "",
    role,
    roleLabel,
    liveTabFound: Boolean(liveTab),
    liveTabId: liveTab?.id || null,
    liveWindowId: liveTab?.windowId || null,
    liveGroupId: Number.isInteger(liveGroupId) ? liveGroupId : null,
    liveGroupFound: Boolean(liveGroup),
    liveGroupTitle: liveGroup?.title || "",
    expectedGroupTitle,
    groupTitleMatches: liveGroup?.title === expectedGroupTitle
  };
}

function verifyTargetWindowPolicy(latestResume, liveProjection) {
  const targetMode = latestResume?.details?.restoreTargetMode;

  if (targetMode === "dedicated_window") {
    return liveProjection.liveWindowIds.length === 1 && liveProjection.allLiveTabsInTargetWindow;
  }

  if (targetMode === "current_window") {
    return liveProjection.liveWorkspaceTabCount === liveProjection.expectedTabCount;
  }

  return false;
}

async function queryAllChromeTabs() {
  if (!globalThis.chrome?.tabs?.query) return [];

  try {
    return await chrome.tabs.query({});
  } catch (_error) {
    return [];
  }
}

async function queryAllChromeTabGroups() {
  if (!globalThis.chrome?.tabGroups?.query) return [];

  try {
    return await chrome.tabGroups.query({});
  } catch (_error) {
    return [];
  }
}

function createCheck(check, condition, message, severity = "post_resume_verification") {
  return {
    check,
    status: condition ? "pass" : "fail",
    severity,
    message
  };
}

function summarizeWorkspace(workspace) {
  const tabs = Array.isArray(workspace?.tabs) ? workspace.tabs : [];
  return {
    workspaceId: workspace?.workspaceId || "",
    name: workspace?.name || "Untitled Workspace",
    workspaceType: workspace?.workspaceType || "unknown",
    tabCount: tabs.length,
    journalCount: Array.isArray(workspace?.journal) ? workspace.journal.length : 0,
    timelineCount: Array.isArray(workspace?.timeline) ? workspace.timeline.length : 0,
    resumedAt: workspace?.resumedAt || "",
    hydratedAt: workspace?.hydratedAt || "",
    resumedFromWorkspaceMemoryId: workspace?.resumedFromWorkspaceMemoryId || ""
  };
}

function summarizeDiagnostic(diagnostic) {
  if (!diagnostic) return null;

  return {
    createdAt: diagnostic.createdAt || "",
    level: diagnostic.level || "",
    action: diagnostic.action || "",
    message: diagnostic.message || "",
    details: diagnostic.details || {}
  };
}

function findLatestDiagnostic(diagnostics, action) {
  return [...diagnostics].reverse().find((diagnostic) => diagnostic?.action === action) || null;
}

function normalizeRole(role) {
  return typeof role === "string" && role.trim() ? role.trim().toLowerCase() : "unassigned";
}

function getRoleLabel(role) {
  const normalizedRole = normalizeRole(role);
  const labels = {
    source: "Source",
    question: "Question",
    reference: "Reference",
    docs: "Docs",
    counterpoint: "Counterpoint",
    revisit: "Revisit",
    discard: "Discard",
    unassigned: "Unassigned"
  };

  return labels[normalizedRole] || normalizedRole.charAt(0).toUpperCase() + normalizedRole.slice(1);
}

function buildExpectedGroupTitle(roleLabel, initials) {
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

function buildClipboardEnvelope(jsonText) {
  return [
    "CHROME_FLOW_PACKET_START",
    "packetType: Chrome Flow Layer 2 Post-Resume Verification Packet",
    "schema: layer2-post-resume-verification-packet-v0.1",
    "clipboardFormat: chrome_flow_packet_envelope_v0.1",
    "createdAt: " + new Date().toISOString(),
    "contentType: application/json",
    "",
    jsonText,
    "",
    "CHROME_FLOW_PACKET_END"
  ].join("\n");
}
