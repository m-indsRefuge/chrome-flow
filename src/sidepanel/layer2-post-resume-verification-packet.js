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
    <p class="section-help">Developer-only readout that verifies a resumed workspace across Chrome windows and the target resume window. This is read-only and does not open, close, move, group, or restore tabs.</p>
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
  const [workspace, diagnostics] = await Promise.all([
    getActiveWorkspaceRuntime(),
    getRuntimeDiagnostics()
  ]);

  const recentDiagnostics = diagnostics.slice(-MAX_DIAGNOSTICS_TO_SCAN);
  const latestResume = findLatestDiagnostic(recentDiagnostics, "workspace_library_resume_executed");
  const latestGroups = findLatestDiagnostic(recentDiagnostics, "workspace_resume_groups_recreated");
  const latestFocus = findLatestDiagnostic(recentDiagnostics, "workspace_resume_window_focused");
  const latestFocusFailure = findLatestDiagnostic(recentDiagnostics, "workspace_resume_window_focus_failed");
  const projectionQuery = await queryChromeProjection(latestResume?.details?.windowId || null);
  const liveProjection = buildLiveProjectionSummary(workspace, projectionQuery.tabs, projectionQuery.groups, latestResume, latestGroups, projectionQuery);
  const checks = buildVerificationChecks(workspace, latestResume, latestGroups, latestFocus, latestFocusFailure, liveProjection);
  const failedChecks = checks.filter((check) => check.status === "fail");
  const warningChecks = checks.filter((check) => check.status === "warn");
  const passedChecks = checks.filter((check) => check.status === "pass");

  return {
    packetType: "Chrome Flow Layer 2 Post-Resume Verification Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "layer2-post-resume-verification-packet-v0.2"
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
        "This packet verifies resumed tabs by querying all Chrome tabs, the target resume window, and target-window tab groups.",
        "If live Chrome projection lookup is unavailable but terminal resume diagnostics fully match, the packet records a warning rather than hiding the limitation.",
        "This packet does not open, close, move, group, or restore tabs."
      ]
    }
  };
}

function buildVerificationChecks(workspace, latestResume, latestGroups, latestFocus, latestFocusFailure, liveProjection) {
  const checks = [
    createCheck("active_workspace_exists", Boolean(workspace?.workspaceId), "Active runtime workspace exists."),
    createCheck("latest_resume_diagnostic_exists", Boolean(latestResume), "Latest Workspace Library resume execution diagnostic exists."),
    createCheck("active_workspace_matches_latest_resume", Boolean(workspace?.workspaceId && latestResume?.details?.workspaceId === workspace.workspaceId), "Active runtime workspace matches latest resume diagnostic."),
    createCheck("resume_target_mode_recorded", ["current_window", "dedicated_window"].includes(latestResume?.details?.restoreTargetMode), "Resume target mode is recorded."),
    createCheck("expected_tab_count_matches_resume", liveProjection.expectedTabCount === Number(latestResume?.details?.reopenedTabCount || 0), "Expected workspace tab count matches reopened tab count from resume diagnostic."),
    createCheck("workspace_tabs_verified", liveProjection.missingVerifiedTabCount === 0 && liveProjection.verifiedWorkspaceTabCount === liveProjection.expectedTabCount, "All active workspace tab IDs are verified through live Chrome projection or terminal resume evidence."),
    createCheck("verified_workspace_tabs_grouped", liveProjection.ungroupedVerifiedTabCount === 0, "All verified workspace tabs are assigned to Chrome tab groups."),
    createCheck("group_recreation_diagnostic_exists", Boolean(latestGroups), "Group recreation diagnostic exists."),
    createCheck("recreated_group_count_matches_verified_groups", liveProjection.verifiedGroupCount === Number(latestGroups?.details?.recreatedGroupCount || 0), "Verified group count matches recreated group count diagnostic."),
    createCheck("group_labels_match_workspace_initials", liveProjection.groupLabelMismatchCount === 0, "Verified group titles match role label plus workspace initials."),
    createCheck("window_focus_success", Boolean(latestFocus), "Window focus success diagnostic exists."),
    createCheck("no_later_window_focus_failure", !latestFocusFailure || new Date(latestFocusFailure.createdAt) < new Date(latestFocus?.createdAt || 0), "No unresolved post-resume window focus failure exists."),
    createCheck("target_window_policy_verified", verifyTargetWindowPolicy(latestResume, liveProjection), "Verified tabs satisfy current-window or dedicated-window target policy."),
    createCheck("resume_policy_threshold_preserved", Number(latestResume?.details?.restorePolicy?.thresholdTabCount || 0) === DEDICATED_WINDOW_THRESHOLD_TAB_COUNT, "Resume policy preserves the 4-tab dedicated-window threshold.")
  ];

  if (liveProjection.diagnosticFallbackUsed) {
    checks.push(createWarning("live_chrome_projection_incomplete", "Live Chrome tab lookup did not see every resumed tab; terminal resume diagnostics were used as fallback evidence."));
  }

  if (liveProjection.queryEvidence.queryErrorCount > 0) {
    checks.push(createWarning("chrome_projection_query_errors_recorded", "One or more Chrome projection queries returned an error. See liveProjection.queryEvidence."));
  }

  return checks;
}

function buildLiveProjectionSummary(workspace, liveTabs, liveGroups, latestResume, latestGroups, projectionQuery) {
  const workspaceTabs = Array.isArray(workspace?.tabs) ? workspace.tabs : [];
  const liveTabById = new Map(liveTabs.map((tab) => [tab.id, tab]));
  const liveGroupById = new Map(liveGroups.map((group) => [group.id, group]));
  const diagnosticEvidenceByWorkspaceTabId = buildDiagnosticEvidenceByWorkspaceTabId(latestGroups);
  const expectedInitials = createWorkspaceInitials(workspace?.name || "Chrome Flow");
  const tabRecords = workspaceTabs.map((workspaceTab) => buildWorkspaceTabVerificationRecord(workspaceTab, liveTabById, liveGroupById, diagnosticEvidenceByWorkspaceTabId, expectedInitials));
  const liveWorkspaceTabs = tabRecords.filter((record) => record.liveTabFound);
  const verifiedWorkspaceTabs = tabRecords.filter((record) => record.verifiedTabFound);
  const missingLiveTabs = tabRecords.filter((record) => !record.liveTabFound);
  const missingVerifiedTabs = tabRecords.filter((record) => !record.verifiedTabFound);
  const ungroupedLiveTabs = liveWorkspaceTabs.filter((record) => !record.liveGroupFound);
  const ungroupedVerifiedTabs = verifiedWorkspaceTabs.filter((record) => !record.verifiedGroupFound);
  const liveGroupsById = new Map();
  const verifiedGroupsById = new Map();

  for (const record of liveWorkspaceTabs) {
    if (Number.isInteger(record.liveGroupId) && record.liveGroupId >= 0 && record.liveGroupFound) {
      liveGroupsById.set(record.liveGroupId, {
        groupId: record.liveGroupId,
        title: record.liveGroupTitle,
        windowId: record.liveWindowId,
        role: record.role,
        roleLabel: record.roleLabel,
        expectedTitle: record.expectedGroupTitle,
        evidenceSource: "live_chrome_api"
      });
    }
  }

  for (const record of verifiedWorkspaceTabs) {
    const groupKey = Number.isInteger(record.verifiedGroupId) ? record.verifiedGroupId : record.expectedGroupTitle;
    if (record.verifiedGroupFound) {
      verifiedGroupsById.set(groupKey, {
        groupId: record.verifiedGroupId,
        title: record.verifiedGroupTitle,
        windowId: record.verifiedWindowId,
        role: record.role,
        roleLabel: record.roleLabel,
        expectedTitle: record.expectedGroupTitle,
        evidenceSource: record.liveGroupFound ? "live_chrome_api" : "diagnostic_resume_evidence"
      });
    }
  }

  const liveWindowIds = Array.from(new Set(liveWorkspaceTabs.map((record) => record.liveWindowId).filter((windowId) => Number.isInteger(windowId))));
  const verifiedWindowIds = Array.from(new Set(verifiedWorkspaceTabs.map((record) => record.verifiedWindowId).filter((windowId) => Number.isInteger(windowId))));
  const targetWindowId = latestResume?.details?.windowId || null;
  const liveGroupSummaries = Array.from(liveGroupsById.values()).sort((a, b) => String(a.title).localeCompare(String(b.title)));
  const verifiedGroupSummaries = Array.from(verifiedGroupsById.values()).sort((a, b) => String(a.title).localeCompare(String(b.title)));
  const labelMismatches = verifiedGroupSummaries.filter((group) => group.title !== group.expectedTitle);
  const diagnosticFallbackUsed = liveWorkspaceTabs.length < workspaceTabs.length && verifiedWorkspaceTabs.length === workspaceTabs.length;

  return {
    expectedTabCount: workspaceTabs.length,
    liveWorkspaceTabCount: liveWorkspaceTabs.length,
    verifiedWorkspaceTabCount: verifiedWorkspaceTabs.length,
    missingLiveTabCount: missingLiveTabs.length,
    missingVerifiedTabCount: missingVerifiedTabs.length,
    groupedLiveTabCount: liveWorkspaceTabs.length - ungroupedLiveTabs.length,
    groupedVerifiedTabCount: verifiedWorkspaceTabs.length - ungroupedVerifiedTabs.length,
    ungroupedLiveTabCount: ungroupedLiveTabs.length,
    ungroupedVerifiedTabCount: ungroupedVerifiedTabs.length,
    liveGroupCount: liveGroupSummaries.length,
    verifiedGroupCount: verifiedGroupSummaries.length,
    groupLabelMismatchCount: labelMismatches.length,
    expectedWorkspaceInitials: expectedInitials,
    targetWindowId,
    liveWindowIds,
    verifiedWindowIds,
    allLiveTabsInTargetWindow: Number.isInteger(targetWindowId) && liveWorkspaceTabs.every((record) => record.liveWindowId === targetWindowId),
    allVerifiedTabsInTargetWindow: Number.isInteger(targetWindowId) && verifiedWorkspaceTabs.every((record) => record.verifiedWindowId === targetWindowId),
    diagnosticFallbackUsed,
    verificationMode: diagnosticFallbackUsed ? "diagnostic_resume_evidence_fallback" : "live_chrome_api",
    queryEvidence: projectionQuery.queryEvidence,
    tabRecords,
    missingLiveTabs,
    missingVerifiedTabs,
    ungroupedLiveTabs,
    ungroupedVerifiedTabs,
    liveGroups: liveGroupSummaries,
    verifiedGroups: verifiedGroupSummaries,
    labelMismatches
  };
}

function buildWorkspaceTabVerificationRecord(workspaceTab, liveTabById, liveGroupById, diagnosticEvidenceByWorkspaceTabId, expectedInitials) {
  const tabId = Number(workspaceTab?.tabId);
  const liveTab = Number.isInteger(tabId) ? liveTabById.get(tabId) : null;
  const diagnosticEvidence = diagnosticEvidenceByWorkspaceTabId.get(workspaceTab?.workspaceTabId || "") || null;
  const liveGroupId = liveTab ? Number(liveTab.groupId) : Number(workspaceTab?.groupId);
  const liveGroup = Number.isInteger(liveGroupId) && liveGroupId >= 0 ? liveGroupById.get(liveGroupId) : null;
  const role = normalizeRole(workspaceTab?.role);
  const roleLabel = getRoleLabel(role);
  const expectedGroupTitle = buildExpectedGroupTitle(roleLabel, expectedInitials);
  const diagnosticTabFound = Boolean(diagnosticEvidence?.tabId && Number(diagnosticEvidence.tabId) === tabId);
  const diagnosticGroupFound = Boolean(diagnosticEvidence?.groupId && diagnosticEvidence?.title);
  const verifiedTabFound = Boolean(liveTab) || diagnosticTabFound;
  const verifiedGroupFound = Boolean(liveGroup) || diagnosticGroupFound;
  const verifiedGroupTitle = liveGroup?.title || diagnosticEvidence?.title || "";

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
    diagnosticTabFound,
    diagnosticGroupFound,
    diagnosticTabId: diagnosticEvidence?.tabId || null,
    diagnosticWindowId: diagnosticEvidence?.windowId || null,
    diagnosticGroupId: diagnosticEvidence?.groupId || null,
    diagnosticGroupTitle: diagnosticEvidence?.title || "",
    verifiedTabFound,
    verifiedTabId: liveTab?.id || diagnosticEvidence?.tabId || null,
    verifiedWindowId: liveTab?.windowId || diagnosticEvidence?.windowId || null,
    verifiedGroupId: Number.isInteger(liveGroupId) ? liveGroupId : diagnosticEvidence?.groupId || null,
    verifiedGroupFound,
    verifiedGroupTitle,
    expectedGroupTitle,
    groupTitleMatches: verifiedGroupTitle === expectedGroupTitle,
    evidenceSource: liveTab ? "live_chrome_api" : diagnosticTabFound ? "diagnostic_resume_evidence" : "missing"
  };
}

function buildDiagnosticEvidenceByWorkspaceTabId(latestGroups) {
  const evidence = new Map();
  const groups = Array.isArray(latestGroups?.details?.groups) ? latestGroups.details.groups : [];
  const windowId = latestGroups?.details?.windowId || null;

  for (const group of groups) {
    const workspaceTabIds = Array.isArray(group.workspaceTabIds) ? group.workspaceTabIds : [];
    const tabIds = Array.isArray(group.tabIds) ? group.tabIds : [];

    workspaceTabIds.forEach((workspaceTabId, index) => {
      if (!workspaceTabId) return;

      evidence.set(workspaceTabId, {
        workspaceTabId,
        tabId: tabIds[index] || null,
        groupId: group.groupId || null,
        title: group.title || "",
        role: group.role || "",
        roleLabel: group.roleLabel || "",
        windowId
      });
    });
  }

  return evidence;
}

function verifyTargetWindowPolicy(latestResume, liveProjection) {
  const targetMode = latestResume?.details?.restoreTargetMode;

  if (targetMode === "dedicated_window") {
    return liveProjection.verifiedWindowIds.length === 1 && liveProjection.allVerifiedTabsInTargetWindow;
  }

  if (targetMode === "current_window") {
    return liveProjection.verifiedWorkspaceTabCount === liveProjection.expectedTabCount;
  }

  return false;
}

async function queryChromeProjection(targetWindowId) {
  const queryEvidence = {
    apiAvailable: {
      tabsQuery: Boolean(globalThis.chrome?.tabs?.query),
      windowsGet: Boolean(globalThis.chrome?.windows?.get),
      tabGroupsQuery: Boolean(globalThis.chrome?.tabGroups?.query)
    },
    targetWindowId: Number.isInteger(Number(targetWindowId)) ? Number(targetWindowId) : null,
    allTabsQuery: { attempted: false, count: 0, error: null },
    targetWindowTabsQuery: { attempted: false, count: 0, error: null },
    targetWindowGetPopulate: { attempted: false, count: 0, error: null },
    allGroupsQuery: { attempted: false, count: 0, error: null },
    targetGroupsQuery: { attempted: false, count: 0, error: null },
    queryErrorCount: 0
  };

  const allTabs = await queryTabsSafe({}, queryEvidence.allTabsQuery);
  const targetTabs = Number.isInteger(queryEvidence.targetWindowId)
    ? await queryTabsSafe({ windowId: queryEvidence.targetWindowId }, queryEvidence.targetWindowTabsQuery)
    : [];
  const targetWindowTabs = Number.isInteger(queryEvidence.targetWindowId)
    ? await queryWindowTabsSafe(queryEvidence.targetWindowId, queryEvidence.targetWindowGetPopulate)
    : [];
  const allGroups = await queryTabGroupsSafe({}, queryEvidence.allGroupsQuery);
  const targetGroups = Number.isInteger(queryEvidence.targetWindowId)
    ? await queryTabGroupsSafe({ windowId: queryEvidence.targetWindowId }, queryEvidence.targetGroupsQuery)
    : [];

  queryEvidence.queryErrorCount = [
    queryEvidence.allTabsQuery,
    queryEvidence.targetWindowTabsQuery,
    queryEvidence.targetWindowGetPopulate,
    queryEvidence.allGroupsQuery,
    queryEvidence.targetGroupsQuery
  ].filter((entry) => entry.error).length;

  return {
    tabs: uniqueById([...allTabs, ...targetTabs, ...targetWindowTabs]),
    groups: uniqueById([...allGroups, ...targetGroups]),
    queryEvidence
  };
}

async function queryTabsSafe(query, evidence) {
  evidence.attempted = true;

  if (!globalThis.chrome?.tabs?.query) {
    evidence.error = "chrome.tabs.query unavailable";
    return [];
  }

  try {
    const tabs = await chrome.tabs.query(query);
    evidence.count = Array.isArray(tabs) ? tabs.length : 0;
    return Array.isArray(tabs) ? tabs : [];
  } catch (error) {
    evidence.error = summarizeError(error).message;
    return [];
  }
}

async function queryWindowTabsSafe(windowId, evidence) {
  evidence.attempted = true;

  if (!globalThis.chrome?.windows?.get) {
    evidence.error = "chrome.windows.get unavailable";
    return [];
  }

  try {
    const windowRecord = await chrome.windows.get(windowId, { populate: true });
    const tabs = Array.isArray(windowRecord?.tabs) ? windowRecord.tabs : [];
    evidence.count = tabs.length;
    return tabs;
  } catch (error) {
    evidence.error = summarizeError(error).message;
    return [];
  }
}

async function queryTabGroupsSafe(query, evidence) {
  evidence.attempted = true;

  if (!globalThis.chrome?.tabGroups?.query) {
    evidence.error = "chrome.tabGroups.query unavailable";
    return [];
  }

  try {
    const groups = await chrome.tabGroups.query(query);
    evidence.count = Array.isArray(groups) ? groups.length : 0;
    return Array.isArray(groups) ? groups : [];
  } catch (error) {
    evidence.error = summarizeError(error).message;
    return [];
  }
}

function uniqueById(records) {
  const byId = new Map();

  for (const record of records) {
    if (!record || !Number.isInteger(record.id)) continue;
    byId.set(record.id, record);
  }

  return Array.from(byId.values());
}

function createCheck(check, condition, message, severity = "post_resume_verification") {
  return {
    check,
    status: condition ? "pass" : "fail",
    severity,
    message
  };
}

function createWarning(check, message, severity = "post_resume_verification") {
  return {
    check,
    status: "warn",
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

function summarizeError(error) {
  if (!error) return { message: "Unknown error" };

  return {
    name: error.name || "Error",
    message: error.message || String(error),
    stack: typeof error.stack === "string" ? error.stack.slice(0, 2000) : ""
  };
}

function buildClipboardEnvelope(jsonText) {
  return [
    "CHROME_FLOW_PACKET_START",
    "packetType: Chrome Flow Layer 2 Post-Resume Verification Packet",
    "schema: layer2-post-resume-verification-packet-v0.2",
    "clipboardFormat: chrome_flow_packet_envelope_v0.1",
    "createdAt: " + new Date().toISOString(),
    "contentType: application/json",
    "",
    jsonText,
    "",
    "CHROME_FLOW_PACKET_END"
  ].join("\n");
}
