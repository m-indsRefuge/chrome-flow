import "./workspace-dedicated-window-threshold-validation-suite.js";
import "./workspace-dedicated-window-threshold-preflight.js";
import "./workspace-dedicated-window-threshold-preflight-validation-suite.js";
import "./workspace-dedicated-window-threshold-review.js";
import "./workspace-dedicated-window-threshold-review-validation-suite.js";
import "./workspace-dedicated-window-threshold-execution.js";
import "./workspace-dedicated-window-threshold-execution-validation-suite.js";
import "./workspace-control-internal-gate-consolidation-validation-suite.js";
import "./workspace-control-policy-migration-validation-suite.js";
import "./workspace-control-preflight-migration-validation-suite.js";
import "./workspace-control-review-migration-validation-suite.js";
import "./workspace-control-execution-gate-validation-suite.js";
import { getWorkspace } from "../core/workspace-store.js";
import {
  DEDICATED_WINDOW_THRESHOLD,
  buildWorkspaceTabStatus,
  classifyDedicatedWindowThreshold,
  createCheck,
  createClipboardBlock,
  createWorkspaceIdentityBlock,
  failedChecks as collectFailedChecks,
  formatPacketEnvelope
} from "../core/workspace-control/workspace-control-gates.js";

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
  return buildDedicatedWindowThresholdPolicyPacketForValidation({ workspace, tabs });
}

function buildDedicatedWindowThresholdPolicyPacketForValidation({ workspace = {}, tabs = [], createdAt = null } = {}) {
  const safeTabs = Array.isArray(tabs) ? tabs : [];
  const tabStatus = buildWorkspaceTabStatus(safeTabs);
  const classification = classifyDedicatedWindowThreshold(tabStatus.totalTabs);
  const checks = createPolicyChecks({ workspace, tabStatus, classification });
  const failedChecks = collectFailedChecks(checks);

  return {
    packetType: "Chrome Flow Dedicated Window Threshold Policy Packet",
    createdAt: createdAt || new Date().toISOString(),
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
    workspace: createWorkspaceIdentityBlock(workspace),
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

function createPolicyChecks({ workspace, tabStatus, classification }) {
  return [
    createPolicyCheck("runtime_workspace_exists", Boolean(workspace?.workspaceId), "Active runtime workspace exists."),
    createPolicyCheck("tab_status_available", Number.isInteger(tabStatus.totalTabs), "Active runtime tab status is available."),
    createPolicyCheck("threshold_policy_classified", Boolean(classification.status), "Threshold policy classification is available."),
    createPolicyCheck("no_runtime_action_executed", true, "Policy packet does not execute runtime action."),
    createPolicyCheck("no_browser_projection_changed", true, "Policy packet does not change browser projection."),
    createPolicyCheck("no_session_db_changed", true, "Policy packet does not write Session DB."),
    createPolicyCheck("no_chrome_storage_runtime_changed", true, "Policy packet does not replace chrome.storage.local runtime workspace.")
  ];
}

function createPolicyCheck(check, passed, message) {
  return createCheck(check, passed, message, "policy");
}

function formatPacket(packet) {
  return formatPacketEnvelope(packet);
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

export { buildDedicatedWindowThresholdPolicyPacketForValidation };
