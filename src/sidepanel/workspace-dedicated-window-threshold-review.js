import { getWorkspace } from "../core/workspace-store.js";

const DEDICATED_WINDOW_THRESHOLD = 4;
const TARGET_MODE = "new_window";
const REVIEW_PHRASE = "PREPARE DEDICATED WINDOW PROJECTION";
const PACKET_ENVELOPE_START = "CHROME_FLOW_PACKET_START";
const PACKET_ENVELOPE_END = "CHROME_FLOW_PACKET_END";
const PACKET_CLIPBOARD_FORMAT = "chrome_flow_packet_envelope_v0.1";
const PACKET_CONTENT_TYPE = "application/json";

let lastReviewPacket = null;

installDedicatedWindowThresholdReview();

function installDedicatedWindowThresholdReview() {
  if (document.getElementById("dedicatedWindowThresholdReviewSection")) return;

  const anchor = document.getElementById("dedicatedWindowThresholdPreflightValidationSuiteSection") || document.getElementById("dedicatedWindowThresholdPreflightSection") || document.getElementById("dedicatedWindowThresholdPolicySection") || document.querySelector(".workspace-section");
  if (!anchor) return;

  const section = document.createElement("section");
  section.id = "dedicatedWindowThresholdReviewSection";
  section.className = "dedicated-window-threshold-review-section";
  section.innerHTML = `
    <h2>Dedicated Window Threshold Review</h2>
    <p class="section-help">Creates an Operator review packet before a future dedicated/new-window projection can execute. This review surface does not execute browser actions.</p>
    <div id="dedicatedWindowThresholdReviewSummary" class="workspace-session-summary">Threshold review surface loaded.</div>
    <div class="workspace-session-options">
      <p><strong>Target mode:</strong> ${TARGET_MODE}</p>
      <p><strong>Required review phrase:</strong> ${REVIEW_PHRASE}</p>
      <label for="dedicatedWindowThresholdReviewPhrase">Type review phrase</label>
      <input id="dedicatedWindowThresholdReviewPhrase" type="text" placeholder="${REVIEW_PHRASE}" />
      <label class="checkbox-label"><input id="dedicatedWindowThresholdReviewAcknowledgement" type="checkbox" /> I understand this review prepares a future dedicated/new-window projection for 4+ tab workspaces only.</label>
    </div>
    <div class="workspace-session-actions">
      <button id="prepareDedicatedWindowThresholdReviewButton" type="button" class="secondary-button">Prepare Threshold Review Packet</button>
      <button id="copyDedicatedWindowThresholdReviewPacketButton" type="button" class="secondary-button">Copy Threshold Review Packet</button>
    </div>
    <p id="dedicatedWindowThresholdReviewStatus" class="status-message"></p>
    <pre id="dedicatedWindowThresholdReviewOutput" class="diagnostics-output">Dedicated window threshold review output will appear here.</pre>
  `;

  anchor.insertAdjacentElement("afterend", section);

  document.getElementById("prepareDedicatedWindowThresholdReviewButton")?.addEventListener("click", prepareReviewPacket);
  document.getElementById("copyDedicatedWindowThresholdReviewPacketButton")?.addEventListener("click", copyReviewPacket);

  setSummary("Threshold review ready. Prepare a packet to read current runtime state and Operator confirmation.");
  setStatus("Threshold review loaded. No packet has been prepared yet.");
}

async function prepareReviewPacket() {
  try {
    const packet = await buildReviewPacket();
    lastReviewPacket = packet;
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Threshold review packet prepared: " + packet.review.status + ".");
  } catch (error) {
    setError("Could not prepare threshold review packet.", error);
  }
}

async function copyReviewPacket() {
  try {
    const packet = await buildReviewPacket();
    await navigator.clipboard.writeText(formatPacket(packet));
    lastReviewPacket = packet;
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Fresh threshold review packet copied: " + packet.review.status + ".");
  } catch (error) {
    setError("Could not copy threshold review packet.", error);
  }
}

async function buildReviewPacket(overrides = null) {
  const workspace = overrides?.workspace || await getWorkspace();
  const tabs = Array.isArray(overrides?.tabs) ? overrides.tabs : Array.isArray(workspace?.tabs) ? workspace.tabs : [];
  const tabStatus = buildTabStatus(tabs);
  const plannedGroups = createPlannedGroups(tabs);
  const policy = classifyWorkspace(tabStatus.totalTabs);
  const phrase = overrides?.phrase ?? getReviewPhrase();
  const acknowledgementChecked = overrides?.acknowledgementChecked ?? Boolean(document.getElementById("dedicatedWindowThresholdReviewAcknowledgement")?.checked);
  const phraseMatches = phrase === REVIEW_PHRASE;
  const operatorConfirmed = phraseMatches && acknowledgementChecked;
  const checks = createReviewChecks({ workspace, tabStatus, plannedGroups, policy, phraseMatches, acknowledgementChecked });
  const failedChecks = checks.filter((check) => check.status === "fail");
  const ready = failedChecks.length === 0;

  return {
    packetType: "Chrome Flow Dedicated Window Threshold Review Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "dedicated-window-threshold-review-packet-v0.1"
    },
    clipboard: createClipboardBlock(),
    source: {
      type: "workspace_dedicated_window_threshold_review",
      readOnly: true,
      reviewOnly: true,
      runtimeActionExecuted: false,
      browserProjectionChanged: false,
      sessionDbChanged: false,
      chromeStorageRuntimeChanged: false,
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
      targetMode: TARGET_MODE,
      policyStatus: policy.status,
      dedicatedWindowPolicyActive: policy.dedicatedWindowPolicyActive,
      currentWindowStillValid: policy.currentWindowStillValid
    },
    tabStatus,
    browserPlan: {
      targetMode: TARGET_MODE,
      expectedWindowCount: ready ? 1 : 0,
      plannedTabCount: tabs.length,
      plannedGroupCount: plannedGroups.length,
      plannedGroups
    },
    operatorReview: {
      requiredPhrase: REVIEW_PHRASE,
      phraseMatches,
      acknowledgementChecked,
      operatorConfirmed
    },
    review: {
      status: ready ? "ready_for_threshold_execution_slice" : "awaiting_or_blocked_before_threshold_execution",
      readyForNextSlice: ready,
      availableInThisSlice: false,
      checks,
      failedChecks,
      blockedReasons: failedChecks.map((check) => check.message),
      notes: [
        "This packet is review-only.",
        "No browser action is performed by this review surface.",
        "This review prepares a future dedicated/new-window projection only when the 4+ tab threshold path is ready.",
        "Future live execution must rebuild its own preflight and must not trust this review packet alone.",
        "The execution slice must still require Operator approval and post-action verification."
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

function createReviewChecks({ workspace, tabStatus, plannedGroups, policy, phraseMatches, acknowledgementChecked }) {
  return [
    createCheck("runtime_workspace_exists", Boolean(workspace?.workspaceId), "Active runtime workspace exists."),
    createCheck("dedicated_window_policy_active", policy.dedicatedWindowPolicyActive === true, "Active workspace is in the 4+ tab dedicated-window policy range."),
    createCheck("minimum_tab_threshold_met", tabStatus.totalTabs >= DEDICATED_WINDOW_THRESHOLD, "Active workspace has at least 4 tabs."),
    createCheck("workspace_tabs_have_urls", tabStatus.totalTabs > 0 && tabStatus.missingUrlCount === 0, "All active workspace tabs have URLs."),
    createCheck("workspace_tabs_have_roles", tabStatus.totalTabs > 0 && tabStatus.unassignedTabs === 0, "All active workspace tabs have assigned roles."),
    createCheck("planned_groups_available", plannedGroups.length > 0, "Planned role groups are available."),
    createCheck("target_mode_new_window", TARGET_MODE === "new_window", "Target mode is new_window."),
    createCheck("operator_phrase_matches", phraseMatches, "Operator typed the required review phrase."),
    createCheck("operator_acknowledgement_checked", acknowledgementChecked, "Operator checked the threshold review acknowledgement."),
    createCheck("no_runtime_action_executed", true, "Review packet does not execute runtime action."),
    createCheck("no_browser_projection_changed", true, "Review packet does not change browser projection."),
    createCheck("no_session_db_changed", true, "Review packet does not write Session DB."),
    createCheck("no_chrome_storage_runtime_changed", true, "Review packet does not replace chrome.storage.local runtime workspace.")
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

function createCheck(check, passed, message) {
  return { check, status: passed ? "pass" : "fail", severity: "block", message };
}

function getReviewPhrase() {
  return document.getElementById("dedicatedWindowThresholdReviewPhrase")?.value.trim() || "";
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
  return "Threshold review: " + packet.review.status + " | Tabs: " + packet.tabStatus.totalTabs + " | Groups: " + packet.browserPlan.plannedGroupCount + " | Operator confirmed: " + packet.operatorReview.operatorConfirmed + " | Ready: " + packet.review.readyForNextSlice + ".";
}

function setSummary(message) {
  const summary = document.getElementById("dedicatedWindowThresholdReviewSummary");
  if (summary) summary.textContent = message;
}

function setStatus(message) {
  const status = document.getElementById("dedicatedWindowThresholdReviewStatus");
  if (status) status.textContent = message;
}

function setOutput(value) {
  const output = document.getElementById("dedicatedWindowThresholdReviewOutput");
  if (output) output.textContent = JSON.stringify(value, null, 2);
}

function setError(message, error) {
  setOutput({ status: "error", message, error: error?.message || String(error) });
  setStatus(message);
}

export { buildReviewPacket, REVIEW_PHRASE };
