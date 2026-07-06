import "./workspace-dedicated-window-threshold-validation-suite.js";
import "./workspace-dedicated-window-threshold-preflight.js";
import "./workspace-dedicated-window-threshold-preflight-validation-suite.js";
import "./workspace-dedicated-window-threshold-review.js";
import "./workspace-dedicated-window-threshold-review-validation-suite.js";
import "./workspace-dedicated-window-threshold-execution.js";
import "./workspace-dedicated-window-threshold-execution-validation-suite.js";
import "./workspace-control-internal-gate-consolidation-validation-suite.js";
import { getWorkspace } from "../core/workspace-store.js";

const DEDICATED_WINDOW_THRESHOLD = 4;
const PACKET_ENVELOPE_START = "CHROME_FLOW_PACKET_START";
const PACKET_ENVELOPE_END = "CHROME_FLOW_PACKET_END";
const PACKET_CLIPBOARD_FORMAT = "chrome_flow_packet_envelope_v0.1";
const PACKET_CONTENT_TYPE = "application/json";

let lastPolicyPacket = null;

installDedicatedWindowThresholdPolicy();

function installDedicatedWindowThresholdPolicy() {
  if (document.getElementById("dedicatedWindowThresholdPolicySection")) return;

  const anchor = document.getElementById("projectionResumeValidationSuiteSection") || document.getElementById("projectionResumeRunSection") || document.querySelector(".workspace-section");
  if (!anchor) return;

  const section = document.createElement("section");
  section.id = "dedicatedWindowThresholdPolicySection";
  section.className = "dedicated-window-threshold-policy-section";
  section.innerHTML = `
    <h2>Dedicated Window Threshold Policy</h2>
    <p class="section-help">Classifies whether the active runtime workspace can remain in the current window or should move toward a dedicated/new-window projection. This policy surface does not execute browser actions.</p>
    <div id="dedicatedWindowThresholdPolicySummary" class="workspace-session-summary">Threshold policy surface loaded.</div>
    <div class="workspace-session-actions">
      <button id="prepareDedicatedWindowThresholdPolicyButton" type="button" class="secondary-button">Prepare Threshold Policy Packet</button>
      <button id="copyDedicatedWindowThresholdPolicyPacketButton" type="button" class="secondary-button">Copy Threshold Policy Packet</button>
    </div>
    <p id="dedicatedWindowThresholdPolicyStatus" class="status-message"></p>
    <pre id="dedicatedWindowThresholdPolicyOutput" class="diagnostics-output">Dedicated window threshold policy output will appear here.</pre>
  `;

  anchor.insertAdjacentElement("afterend", section);

  document.getElementById("prepareDedicatedWindowThresholdPolicyButton")?.addEventListener("click", preparePolicyPacket);
  document.getElementById("copyDedicatedWindowThresholdPolicyPacketButton")?.addEventListener("click", copyPolicyPacket);

  preparePolicyPacket();
}

async function preparePolicyPacket() {
  try {
    const packet = await buildPolicyPacket();
    lastPolicyPacket = packet;
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Threshold policy packet prepared: " + packet.policy.status + ".");
  } catch (error) {
    setError("Could not prepare threshold policy packet.", error);
  }
}

async function copyPolicyPacket() {
  try {
    const packet = lastPolicyPacket || await buildPolicyPacket();
    await navigator.clipboard.writeText(formatPacket(packet));
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Threshold policy packet copied: " + packet.policy.status + ".");
  } catch (error) {
    setError("Could not copy threshold policy packet.", error);
  }
}

async function buildPolicyPacket() {
  const workspace = await getWorkspace();
  const tabs = Array.isArray(workspace?.tabs) ? workspace.tabs : [];
  const tabStatus = buildTabStatus(tabs);
  const classification = classifyWorkspace(tabStatus.totalTabs);
  const checks = createPolicyChecks({ workspace, tabStatus, classification });
  const failedChecks = checks.filter((check) => check.status === "fail");

  return {
    packetType: "Chrome Flow Dedicated Window Threshold Policy Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "dedicated-window-threshold-policy-packet-v0.1"
    },
    clipboard: createClipboardBlock(),
    source: {
      type: "workspace_dedicated_window_threshold_policy",
      readOnly: true,
      policyOnly: true,
      preflightOnly: false,
      runtimeActionExecuted: false,
      browserProjectionChanged: false,
      sessionDbChanged: false,
      chromeStorageRuntimeChanged: false
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
      productRule: "0-3 tabs can remain current-window valid; 4+ tabs activates dedicated/new-window workspace policy."
    },
    tabStatus,
    policy: {
      status: failedChecks.length ? "policy_blocked_missing_runtime_workspace" : classification.status,
      classification: classification.classification,
      recommendedAction: classification.recommendedAction,
      operatorMessage: classification.operatorMessage,
      dedicatedWindowPolicyActive: classification.dedicatedWindowPolicyActive,
      currentWindowStillValid: classification.currentWindowStillValid,
      checks,
      failedChecks,
      notes: [
        "This packet is policy-only.",
        "No browser action is performed by this policy surface.",
        "The 4+ tab threshold is a product policy, not a minimal technical fixture.",
        "Future live execution must use a separate preflight, validation suite, Operator approval, and post-action verification."
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
      classification: "empty_or_uninitialized_workspace",
      recommendedAction: "continue_workspace_intake",
      operatorMessage: "No workspace tabs are currently recorded. Continue workspace intake before dedicated-window policy activates.",
      dedicatedWindowPolicyActive: false,
      currentWindowStillValid: true
    };
  }

  if (totalTabs < DEDICATED_WINDOW_THRESHOLD) {
    return {
      status: "current_window_valid",
      classification: "small_workspace",
      recommendedAction: "remain_in_current_window",
      operatorMessage: "This workspace has fewer than 4 tabs. It can remain valid in the current window.",
      dedicatedWindowPolicyActive: false,
      currentWindowStillValid: true
    };
  }

  return {
    status: "dedicated_window_policy_active",
    classification: "dedicated_window_recommended",
    recommendedAction: "prepare_dedicated_window_projection",
    operatorMessage: "This workspace has 4 or more tabs. Dedicated/new-window projection policy is active to preserve organisational integrity.",
    dedicatedWindowPolicyActive: true,
    currentWindowStillValid: false
  };
}

function createPolicyChecks({ workspace, tabStatus, classification }) {
  return [
    createCheck("runtime_workspace_exists", Boolean(workspace?.workspaceId), "Active runtime workspace exists."),
    createCheck("tab_status_available", Number.isInteger(tabStatus.totalTabs), "Active runtime tab status is available."),
    createCheck("threshold_policy_classified", Boolean(classification.status), "Threshold policy classification is available."),
    createCheck("no_runtime_action_executed", true, "Policy packet does not execute runtime action."),
    createCheck("no_browser_projection_changed", true, "Policy packet does not change browser projection."),
    createCheck("no_session_db_changed", true, "Policy packet does not write Session DB."),
    createCheck("no_chrome_storage_runtime_changed", true, "Policy packet does not replace chrome.storage.local runtime workspace.")
  ];
}

function createCheck(check, passed, message) {
  return { check, status: passed ? "pass" : "fail", severity: "policy", message };
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
  return "Threshold policy: " + packet.policy.status + " | Tabs: " + packet.tabStatus.totalTabs + " | Dedicated active: " + packet.policy.dedicatedWindowPolicyActive + " | Recommended: " + packet.policy.recommendedAction + ".";
}

function setSummary(message) {
  const summary = document.getElementById("dedicatedWindowThresholdPolicySummary");
  if (summary) summary.textContent = message;
}

function setStatus(message) {
  const status = document.getElementById("dedicatedWindowThresholdPolicyStatus");
  if (status) status.textContent = message;
}

function setOutput(value) {
  const output = document.getElementById("dedicatedWindowThresholdPolicyOutput");
  if (output) output.textContent = JSON.stringify(value, null, 2);
}

function setError(message, error) {
  setOutput({ status: "error", message, error: error?.message || String(error) });
  setStatus(message);
}
