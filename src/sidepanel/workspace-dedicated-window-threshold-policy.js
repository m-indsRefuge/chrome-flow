import { readActiveWorkspaceReadonly } from "../core/journal-append-coordination/readonly-workspace.js";
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
    <h2>Historical Dedicated Window Threshold Validation</h2>
    <div class="historical-validation-banner" role="note">
      <strong>Historical validation artifact.</strong>
      <span>This surface records the earlier policy-only threshold phase.</span>
      <span>It is not current runtime authority.</span>
      <span>Current automatic dedicated-window execution is owned by the verified automatic-promotion transaction.</span>
    </div>
    <p class="section-help">Preserves the earlier read-only threshold policy packet for evidence and regression comparison. This historical surface performs no workspace membership or automatic-promotion action.</p>
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

}

async function preparePolicyPacket() {
  try {
    const packet = await buildPolicyPacket();
    lastPolicyPacket = packet;
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Historical threshold policy packet prepared: " + packet.policy.status + ".");
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
    setStatus("Historical threshold policy packet copied: " + packet.policy.status + ".");
  } catch (error) {
    setError("Could not copy threshold policy packet.", error);
  }
}

async function buildPolicyPacket() {
  const read = await readActiveWorkspaceReadonly();
  if (!read.ok) throw new Error("Historical threshold policy workspace read failed: " + read.reason);
  const workspace = read.workspace;
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
