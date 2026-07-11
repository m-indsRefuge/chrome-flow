import { registerDeveloperSurface } from "./developer-mode.js";

const WORKSPACE_KEY = "chromeFlowWorkspace";
const WORKSPACE_ARCHIVE_KEY = "chromeFlowWorkspaceArchive";
const DIAGNOSTICS_KEY = "chromeFlowDiagnostics";
const VALIDATION_SURFACE_STORAGE_KEY = "chromeFlowValidationSurfacesVisible";
const DEVELOPER_MODE_STORAGE_KEY = "chromeFlowDeveloperModeEnabled";
const DEDICATED_WINDOW_THRESHOLD_TAB_COUNT = 4;
const MAX_DIAGNOSTICS_TO_SCAN = 200;

installLayer2LifecycleValidationPacketSurface();

function installLayer2LifecycleValidationPacketSurface() {
  const anchor = document.getElementById("developerDiagnosticsSection")
    || document.getElementById("workspaceSessionControlSection")
    || document.querySelector(".workspace-section");

  if (!anchor || document.getElementById("layer2LifecycleValidationPacketSection")) return;

  const section = document.createElement("section");
  section.id = "layer2LifecycleValidationPacketSection";
  section.className = "layer2-lifecycle-validation-packet-section";
  section.innerHTML = `
    <h2>Layer 2 Lifecycle Validation Packet</h2>
    <p class="section-help">Developer-only readout for the workspace archive, restore, grouping, window policy, and developer-surface separation lifecycle. This does not execute browser actions.</p>
    <div class="workspace-session-actions">
      <button id="prepareLayer2LifecyclePacketButton" type="button" class="secondary-button">Prepare Layer 2 Packet</button>
      <button id="copyLayer2LifecyclePacketButton" type="button" class="secondary-button" disabled>Copy Layer 2 Packet</button>
    </div>
    <p id="layer2LifecyclePacketStatus" class="status-message">Prepare a packet after running archive and restore validation.</p>
    <pre id="layer2LifecyclePacketOutput" class="diagnostic-output"></pre>
  `;

  anchor.insertAdjacentElement("afterend", section);
  registerDeveloperSurface(section);

  document.getElementById("prepareLayer2LifecyclePacketButton")?.addEventListener("click", prepareLayer2LifecyclePacket);
  document.getElementById("copyLayer2LifecyclePacketButton")?.addEventListener("click", copyLayer2LifecyclePacket);
}

async function prepareLayer2LifecyclePacket() {
  const packet = await buildLayer2LifecyclePacket();
  const output = document.getElementById("layer2LifecyclePacketOutput");
  const status = document.getElementById("layer2LifecyclePacketStatus");
  const copyButton = document.getElementById("copyLayer2LifecyclePacketButton");

  if (output) output.textContent = JSON.stringify(packet, null, 2);
  if (status) status.textContent = "Layer 2 packet prepared: " + packet.lifecycle.status + ".";
  if (copyButton) copyButton.removeAttribute("disabled");

  await recordDiagnostic("info", "layer2_lifecycle_packet_prepared", "Layer 2 lifecycle validation packet prepared.", {
    status: packet.lifecycle.status,
    passedCheckCount: packet.lifecycle.passedCheckCount,
    warningCheckCount: packet.lifecycle.warningCheckCount,
    failedCheckCount: packet.lifecycle.failedCheckCount,
    schema: packet.extension.schema
  });
}

async function copyLayer2LifecyclePacket() {
  const output = document.getElementById("layer2LifecyclePacketOutput");
  const status = document.getElementById("layer2LifecyclePacketStatus");

  if (!output?.textContent?.trim()) {
    if (status) status.textContent = "Prepare the Layer 2 packet before copying.";
    return;
  }

  const envelope = buildClipboardEnvelope(output.textContent);
  await navigator.clipboard.writeText(envelope);

  if (status) status.textContent = "Layer 2 packet copied.";
  await recordDiagnostic("info", "layer2_lifecycle_packet_copied", "Layer 2 lifecycle validation packet copied.", {
    envelopeFormat: "chrome_flow_packet_envelope_v0.1"
  });
}

async function buildLayer2LifecyclePacket() {
  const [workspace, archives, diagnostics] = await Promise.all([
    getActiveWorkspace(),
    getArchivedWorkspaces(),
    getDiagnostics()
  ]);

  const recentDiagnostics = diagnostics.slice(-MAX_DIAGNOSTICS_TO_SCAN);
  const latestRestore = findLatestDiagnostic(recentDiagnostics, "archive_restored");
  const latestGroupRestore = findLatestDiagnostic(recentDiagnostics, "archive_restore_groups_recreated");
  const latestArchiveClose = findLatestDiagnostic(recentDiagnostics, "workspace_archive_browser_close_completed");
  const latestArchivePlan = findLatestDiagnostic(recentDiagnostics, "workspace_archive_browser_close_plan_prepared");
  const latestFocus = findLatestDiagnostic(recentDiagnostics, "archive_restore_window_focused");
  const latestFocusFailure = findLatestDiagnostic(recentDiagnostics, "archive_restore_window_focus_failed");

  const checks = [
    createCheck("active_workspace_exists", Boolean(workspace?.workspaceId), "Active workspace exists in chrome.storage.local."),
    createCheck("archive_records_exist", archives.length > 0, "Workspace archive contains one or more archived workspace records."),
    createCheck("archive_close_plan_recorded", Boolean(latestArchivePlan), "Archive close plan evidence exists."),
    createCheck("archive_close_completed", Boolean(latestArchiveClose), "Archive close completion evidence exists."),
    createCheck("restore_recorded", Boolean(latestRestore), "Archive restore evidence exists."),
    createCheck("restore_group_recreation_recorded", Boolean(latestGroupRestore), "Restore group recreation evidence exists."),
    createCheck("restore_group_count_positive", Number(latestGroupRestore?.details?.recreatedGroupCount || 0) > 0, "At least one restored Chrome group was recreated."),
    createCheck("restore_ungrouped_zero_when_status_available", isUngroupedRestoreStateAcceptable(workspace), "Restored active workspace has no ungrouped tabs when tab status is available."),
    createCheck("restore_window_focus_success", Boolean(latestFocus), "Restored window focus success evidence exists."),
    createCheck("dedicated_restore_policy_evidence", hasDedicatedRestoreEvidence(latestRestore), "Dedicated/current-window restore policy evidence exists."),
    createCheck("developer_mode_surface_gate_present", Boolean(document.getElementById("developerModeGateSection")), "Developer Mode gate exists."),
    createCheck("validation_toggle_developer_scoped", isValidationToggleDeveloperScoped(), "Validation Surfaces control is hidden unless Developer Mode is enabled."),
    createCheck("developer_diagnostics_developer_only", isDeveloperSurface("developerDiagnosticsSection"), "Developer Diagnostics is marked developer-only."),
    createCheck("session_db_diagnostics_developer_only", isDeveloperSurface("sessionDbDiagnosticsSection"), "Session DB Diagnostics is marked developer-only."),
    createCheck("workspace_library_product_surface_present", Boolean(document.querySelector("[data-product-surface='workspace-library']")), "Workspace Library product surface exists."),
    createCheck("workspace_controls_product_surface_present", Boolean(document.querySelector("[data-product-surface='workspace-controls']")), "Workspace Controls product surface exists.")
  ];

  const failedChecks = checks.filter((check) => check.status === "fail");
  const warningChecks = checks.filter((check) => check.status === "warn");
  const passedChecks = checks.filter((check) => check.status === "pass");

  return {
    packetType: "Chrome Flow Layer 2 Lifecycle Validation Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "layer2-lifecycle-validation-packet-v0.1"
    },
    source: {
      type: "layer2_lifecycle_validation_packet",
      developerOnly: true,
      readOnly: true,
      validationOnly: true,
      runtimeActionExecuted: false,
      browserProjectionChanged: false,
      sessionDbChanged: false,
      chromeStorageRuntimeChanged: false
    },
    lifecycle: {
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
    archiveStore: summarizeArchiveStore(archives),
    latestEvidence: {
      archiveClosePlan: summarizeDiagnostic(latestArchivePlan),
      archiveCloseCompleted: summarizeDiagnostic(latestArchiveClose),
      archiveRestore: summarizeDiagnostic(latestRestore),
      archiveRestoreGroups: summarizeDiagnostic(latestGroupRestore),
      archiveRestoreWindowFocused: summarizeDiagnostic(latestFocus),
      latestFocusFailure: summarizeDiagnostic(latestFocusFailure)
    },
    developerSurfaceState: summarizeDeveloperSurfaceState(),
    nextDecision: {
      recommendation: failedChecks.length ? "repair_failed_lifecycle_checks" : "proceed_to_workspace_library_action_alignment",
      notes: [
        "This packet is read-only and does not execute archive, restore, tab, group, or window actions.",
        "Layer 2 completion requires both policy evidence and live Operator validation.",
        "The next slice should align Workspace Library actions with the proven archive/restore lifecycle."
      ]
    }
  };
}

function createCheck(check, condition, message, severity = "validation") {
  return {
    check,
    status: condition ? "pass" : "fail",
    severity,
    message
  };
}

function isUngroupedRestoreStateAcceptable(workspace) {
  const tabs = Array.isArray(workspace?.tabs) ? workspace.tabs : [];
  if (!tabs.length) return true;

  const openTabs = tabs.filter((tab) => Number.isInteger(Number(tab?.tabId)) && Number(tab.tabId) > 0);
  if (!openTabs.length) return true;

  return openTabs.every((tab) => Number.isInteger(Number(tab?.groupId)) && Number(tab.groupId) >= 0);
}

function hasDedicatedRestoreEvidence(latestRestore) {
  const mode = latestRestore?.details?.restoreTargetMode;
  const policy = latestRestore?.details?.restorePolicy || {};

  return mode === "current_window"
    || mode === "dedicated_window"
    || Number(policy.archivedWorkspaceTabCount || 0) >= DEDICATED_WINDOW_THRESHOLD_TAB_COUNT
    || Boolean(policy.dedicatedWindowEvidence);
}

function isValidationToggleDeveloperScoped() {
  const section = document.getElementById("validationSurfaceDebugModeSection");
  if (!section) return true;

  const developerEnabled = readLocalStorageFlag(DEVELOPER_MODE_STORAGE_KEY);
  const validationEnabled = readLocalStorageFlag(VALIDATION_SURFACE_STORAGE_KEY);

  if (!developerEnabled && !section.hidden) return false;
  if (!developerEnabled && validationEnabled) return section.hidden;
  return true;
}

function isDeveloperSurface(id) {
  const element = document.getElementById(id);
  return Boolean(element?.dataset?.developerSurface === "true");
}

function summarizeWorkspace(workspace) {
  const tabs = Array.isArray(workspace?.tabs) ? workspace.tabs : [];
  const openTabs = tabs.filter((tab) => Number.isInteger(Number(tab?.tabId)) && Number(tab.tabId) > 0);
  const groupedTabs = openTabs.filter((tab) => Number.isInteger(Number(tab?.groupId)) && Number(tab.groupId) >= 0);

  return {
    workspaceId: workspace?.workspaceId || "",
    name: workspace?.name || "Untitled Workspace",
    workspaceType: workspace?.workspaceType || "unknown",
    tabCount: tabs.length,
    openTabCount: openTabs.length,
    groupedTabCount: groupedTabs.length,
    ungroupedOpenTabCount: Math.max(openTabs.length - groupedTabs.length, 0),
    journalCount: Array.isArray(workspace?.journal) ? workspace.journal.length : 0,
    timelineCount: Array.isArray(workspace?.timeline) ? workspace.timeline.length : 0,
    restoredAt: workspace?.restoredAt || "",
    restoredFromArchiveId: workspace?.restoredFromArchiveId || ""
  };
}

function summarizeArchiveStore(archives) {
  return {
    archiveCount: archives.length,
    latestArchive: archives.length ? {
      archiveId: archives[0].archiveId || "",
      archiveName: archives[0].archiveName || "",
      reason: archives[0].reason || "",
      tabCount: archives[0].summary?.tabCount || 0,
      timelineCount: archives[0].summary?.timelineCount || 0
    } : null
  };
}

function summarizeDeveloperSurfaceState() {
  return {
    developerModeEnabled: readLocalStorageFlag(DEVELOPER_MODE_STORAGE_KEY),
    validationSurfacesVisible: readLocalStorageFlag(VALIDATION_SURFACE_STORAGE_KEY),
    developerDiagnosticsDeveloperOnly: isDeveloperSurface("developerDiagnosticsSection"),
    sessionDbDiagnosticsDeveloperOnly: isDeveloperSurface("sessionDbDiagnosticsSection"),
    validationTogglePresent: Boolean(document.getElementById("validationSurfaceDebugModeSection")),
    workspaceLibraryProductSurfacePresent: Boolean(document.querySelector("[data-product-surface='workspace-library']")),
    workspaceControlsProductSurfacePresent: Boolean(document.querySelector("[data-product-surface='workspace-controls']"))
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

function buildClipboardEnvelope(jsonText) {
  return [
    "CHROME_FLOW_PACKET_START",
    "packetType: Chrome Flow Layer 2 Lifecycle Validation Packet",
    "schema: layer2-lifecycle-validation-packet-v0.1",
    "clipboardFormat: chrome_flow_packet_envelope_v0.1",
    "createdAt: " + new Date().toISOString(),
    "contentType: application/json",
    "",
    jsonText,
    "",
    "CHROME_FLOW_PACKET_END"
  ].join("\n");
}

async function getActiveWorkspace() {
  const result = await chrome.storage.local.get(WORKSPACE_KEY);
  return result[WORKSPACE_KEY] || null;
}

async function getArchivedWorkspaces() {
  const result = await chrome.storage.local.get(WORKSPACE_ARCHIVE_KEY);
  return Array.isArray(result[WORKSPACE_ARCHIVE_KEY]) ? result[WORKSPACE_ARCHIVE_KEY] : [];
}

async function getDiagnostics() {
  const result = await chrome.storage.local.get(DIAGNOSTICS_KEY);
  return Array.isArray(result[DIAGNOSTICS_KEY]) ? result[DIAGNOSTICS_KEY] : [];
}

async function recordDiagnostic(level, action, message, details = {}) {
  try {
    const diagnostics = await getDiagnostics();
    diagnostics.push({
      diagnosticId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      level,
      action,
      message,
      details
    });
    await chrome.storage.local.set({ [DIAGNOSTICS_KEY]: diagnostics.slice(-MAX_DIAGNOSTICS_TO_SCAN) });
  } catch (error) {
    console.warn("Chrome Flow Layer 2 lifecycle diagnostics failed:", error);
  }
}

function readLocalStorageFlag(key) {
  try {
    return window.localStorage?.getItem(key) === "true";
  } catch (_error) {
    return false;
  }
}
