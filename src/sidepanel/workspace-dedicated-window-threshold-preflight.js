import { getWorkspace } from "../core/workspace-store.js";

const DEDICATED_WINDOW_THRESHOLD = 4;
const TARGET_MODE = "new_window";
const PACKET_ENVELOPE_START = "CHROME_FLOW_PACKET_START";
const PACKET_ENVELOPE_END = "CHROME_FLOW_PACKET_END";
const PACKET_CLIPBOARD_FORMAT = "chrome_flow_packet_envelope_v0.1";
const PACKET_CONTENT_TYPE = "application/json";

let lastPreflightPacket = null;

installDedicatedWindowThresholdPreflight();

function installDedicatedWindowThresholdPreflight() {
  if (document.getElementById("dedicatedWindowThresholdPreflightSection")) return;

  const anchor = document.getElementById("dedicatedWindowThresholdValidationSuiteSection") || document.getElementById("dedicatedWindowThresholdPolicySection") || document.querySelector(".workspace-section");
  if (!anchor) return;

  const section = document.createElement("section");
  section.id = "dedicatedWindowThresholdPreflightSection";
  section.className = "dedicated-window-threshold-preflight-section";
  section.innerHTML = `
    <h2>Dedicated Window Threshold Preflight</h2>
    <p class="section-help">Checks whether the active runtime workspace is ready for a future dedicated/new-window projection. This preflight does not execute browser actions.</p>
    <div id="dedicatedWindowThresholdPreflightSummary" class="workspace-session-summary">Threshold preflight surface loaded.</div>
    <div class="workspace-session-actions">
      <button id="prepareDedicatedWindowThresholdPreflightButton" type="button" class="secondary-button">Prepare Threshold Preflight Packet</button>
      <button id="copyDedicatedWindowThresholdPreflightPacketButton" type="button" class="secondary-button">Copy Threshold Preflight Packet</button>
    </div>
    <p id="dedicatedWindowThresholdPreflightStatus" class="status-message"></p>
    <pre id="dedicatedWindowThresholdPreflightOutput" class="diagnostics-output">Dedicated window threshold preflight output will appear here.</pre>
  `;

  anchor.insertAdjacentElement("afterend", section);

  document.getElementById("prepareDedicatedWindowThresholdPreflightButton")?.addEventListener("click", preparePreflightPacket);
  document.getElementById("copyDedicatedWindowThresholdPreflightPacketButton")?.addEventListener("click", copyPreflightPacket);

  setSummary("Threshold preflight ready. Prepare a packet to read current runtime state.");
  setStatus("Threshold preflight loaded. No packet has been prepared yet.");
}

async function preparePreflightPacket() {
  try {
    const packet = await buildPreflightPacket();
    lastPreflightPacket = packet;
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Threshold preflight packet prepared: " + packet.preflight.status + ".");
  } catch (error) {
    setError("Could not prepare threshold preflight packet.", error);
  }
}

async function copyPreflightPacket() {
  try {
    const packet = await buildPreflightPacket();
    await navigator.clipboard.writeText(formatPacket(packet));
    lastPreflightPacket = packet;
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Fresh threshold preflight packet copied: " + packet.preflight.status + ".");
  } catch (error) {
    setError("Could not copy threshold preflight packet.", error);
  }
}

async function buildPreflightPacket() {
  const workspace = await getWorkspace();
  const tabs = sortTabsByRuntimeOrder(Array.isArray(workspace?.tabs) ? workspace.tabs : []);
  const tabStatus = buildTabStatus(tabs);
  const plannedGroups = createPlannedGroups(tabs);
  const policy = classifyWorkspace(tabStatus.totalTabs);
  const checks = createPreflightChecks({ workspace, tabStatus, plannedGroups, policy });
  const failedChecks = checks.filter((check) => check.status === "fail");
  const ready = failedChecks.length === 0;

  return {
    packetType: "Chrome Flow Dedicated Window Threshold Preflight Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "dedicated-window-threshold-preflight-packet-v0.1"
    },
    clipboard: createClipboardBlock(),
    source: {
      type: "workspace_dedicated_window_threshold_preflight",
      readOnly: true,
      preflightOnly: true,
      policyOnly: false,
      runtimeActionExecuted: false,
      browserProjectionChanged: false,
      sessionDbChanged: false,
      chromeStorageRuntimeChanged: false,
      packetPreparedOnDemand: true,
      copyRebuildsFromRuntimeState: true
    },
    workspace: {
      workspaceId: workspace?.workspaceId || "",
      name: workspace?.name || "",
      workspaceType: workspace?.workspaceType || workspace?.type || "",
      aim: workspace?.aim || ""
    },
    thresholdPolicy: {
      thresholdTabCount: DEDICATED_WINDOW_THRESHOLD,
      currentWindowValidRange: "0-3 tabs",
      dedicatedWindowActivationRange: "4+ tabs",
      policyStatus: policy.status,
      dedicatedWindowPolicyActive: policy.dedicatedWindowPolicyActive,
      currentWindowStillValid: policy.currentWindowStillValid
    },
    tabStatus,
    browserPlan: {
      targetMode: TARGET_MODE,
      expectedWindowCount: ready ? 1 : 0,
      plannedTabCount: tabs.length,
      missingUrlCount: tabStatus.missingUrlCount,
      plannedGroupCount: plannedGroups.length,
      plannedGroups
    },
    preflight: {
      status: ready ? "ready_for_threshold_review" : "blocked_before_threshold_projection",
      readyForNextSlice: ready,
      availableInThisSlice: false,
      checks,
      failedChecks,
      blockedReasons: failedChecks.map((check) => check.message),
      notes: [
        "This packet is preflight-only.",
        "No browser action is performed by this preflight surface.",
        "A 4+ tab active runtime workspace is required before dedicated-window projection can proceed.",
        "All tabs must have URLs and assigned roles for this first threshold preflight.",
        "The copy action rebuilds the packet from current runtime state to avoid stale load-time packets.",
        "Future live execution must use a separate validation suite, Operator approval, live action, and post-action verification."
      ]
    }
  };
}

function buildTabStatus(tabs) {
  const totalTabs = tabs.length;
  const tabsWithUrls = tabs.filter((tab) => Boolean(tab.url)).length;
  const assignedTabs = tabs.filter((tab) => tab.role && tab.role !== "unassigned").length;
  const unassignedTabs = totalTabs - assignedTabs;
  const roleCounts = tabs.reduce((counts, tab) => {
    const role = tab.role || "unassigned";
    counts[role] = (counts[role] || 0) + 1;
    return counts;
  }, {});

  return {
    totalTabs,
    tabsWithUrls,
    missingUrlCount: totalTabs - tabsWithUrls,
    assignedTabs,
    unassignedTabs,
    roleCounts
  };
}

function classifyWorkspace(totalTabs) {
  if (totalTabs <= 0) {
    return {
      status: "no_workspace_tabs_detected",
      dedicatedWindowPolicyActive: false,
      currentWindowStillValid: true
    };
  }

  if (totalTabs < DEDICATED_WINDOW_THRESHOLD) {
    return {
      status: "current_window_valid",
      dedicatedWindowPolicyActive: false,
      currentWindowStillValid: true
    };
  }

  return {
    status: "dedicated_window_policy_active",
    dedicatedWindowPolicyActive: true,
    currentWindowStillValid: false
  };
}

function createPreflightChecks({ workspace, tabStatus, plannedGroups, policy }) {
  return [
    createCheck("runtime_workspace_exists", Boolean(workspace?.workspaceId), "Active runtime workspace exists."),
    createCheck("dedicated_window_policy_active", policy.dedicatedWindowPolicyActive === true, "Active workspace is in the 4+ tab dedicated-window policy range."),
    createCheck("minimum_tab_threshold_met", tabStatus.totalTabs >= DEDICATED_WINDOW_THRESHOLD, "Active workspace has at least 4 tabs."),
    createCheck("workspace_tabs_have_urls", tabStatus.missingUrlCount === 0, "All active workspace tabs have URLs."),
    createCheck("workspace_tabs_have_roles", tabStatus.totalTabs > 0 && tabStatus.unassignedTabs === 0, "All active workspace tabs have assigned roles."),
    createCheck("planned_groups_available", plannedGroups.length > 0, "Planned role groups are available."),
    createCheck("target_mode_new_window", TARGET_MODE === "new_window", "Target mode is new_window."),
    createCheck("no_runtime_action_executed", true, "Preflight packet does not execute runtime action."),
    createCheck("no_browser_projection_changed", true, "Preflight packet does not change browser projection."),
    createCheck("no_session_db_changed", true, "Preflight packet does not write Session DB."),
    createCheck("no_chrome_storage_runtime_changed", true, "Preflight packet does not replace chrome.storage.local runtime workspace.")
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

  return Array.from(roles.entries()).map(([role, workspaceTabIds]) => ({
    role,
    roleLabel: createRoleLabel(role),
    workspaceTabIds,
    plannedTabCount: workspaceTabIds.length,
    requiredForProjection: true
  }));
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

function createCheck(check, passed, message) {
  return { check, status: passed ? "pass" : "fail", severity: "block", message };
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

function formatPacket(packet) {
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

function createSummary(packet) {
  return "Threshold preflight: " + packet.preflight.status + " | Tabs: " + packet.tabStatus.totalTabs + " | Groups: " + packet.browserPlan.plannedGroupCount + " | Ready: " + packet.preflight.readyForNextSlice + ".";
}

function setSummary(message) {
  const summary = document.getElementById("dedicatedWindowThresholdPreflightSummary");
  if (summary) summary.textContent = message;
}

function setStatus(message) {
  const status = document.getElementById("dedicatedWindowThresholdPreflightStatus");
  if (status) status.textContent = message;
}

function setOutput(value) {
  const output = document.getElementById("dedicatedWindowThresholdPreflightOutput");
  if (output) output.textContent = JSON.stringify(value, null, 2);
}

function setError(message, error) {
  setOutput({ status: "error", message, error: error?.message || String(error) });
  setStatus(message);
}
