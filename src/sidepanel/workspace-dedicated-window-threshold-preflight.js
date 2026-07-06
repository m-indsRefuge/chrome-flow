import { getWorkspace } from "../core/workspace-store.js";
import {
  DEDICATED_WINDOW_THRESHOLD,
  TARGET_MODE_NEW_WINDOW,
  blockedReasons,
  buildWorkspaceTabStatus,
  classifyDedicatedWindowThreshold,
  createCheck,
  createClipboardBlock,
  createPlannedRoleGroups,
  createWorkspaceIdentityBlock,
  failedChecks as collectFailedChecks,
  formatPacketEnvelope,
  humanizeRole
} from "../core/workspace-control/workspace-control-gates.js";

const RUNTIME_TAB_HYDRATION_DELAY_MS = 500;

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
  const runtimeRead = await readRuntimeWorkspaceWithTabHydration();
  return buildDedicatedWindowThresholdPreflightPacketForValidation({ runtimeRead });
}

function buildDedicatedWindowThresholdPreflightPacketForValidation({ runtimeRead, createdAt = null } = {}) {
  const safeRuntimeRead = runtimeRead || createRuntimeReadEvidence({
    status: "validation_runtime_read_missing",
    selectedRead: "second",
    firstWorkspace: null,
    firstTabs: [],
    secondWorkspace: null,
    secondTabs: []
  });
  const workspace = safeRuntimeRead.selectedWorkspace;
  const tabs = sortTabsByRuntimeOrder(safeRuntimeRead.selectedTabs || []);
  const tabStatus = buildWorkspaceTabStatus(tabs);
  const plannedGroups = createPlannedRoleGroups(tabs, { roleLabeler: humanizeRole });
  const policy = classifyDedicatedWindowThreshold(tabStatus.totalTabs);
  const checks = createPreflightChecks({ workspace, tabStatus, plannedGroups, policy, runtimeRead: safeRuntimeRead });
  const failedChecks = collectFailedChecks(checks);
  const ready = failedChecks.length === 0;

  return {
    packetType: "Chrome Flow Dedicated Window Threshold Preflight Packet",
    createdAt: createdAt || new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "dedicated-window-threshold-preflight-packet-v0.2-runtime-hydration"
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
      copyRebuildsFromRuntimeState: true,
      runtimeTabHydrationRead: true
    },
    workspace: createWorkspaceIdentityBlock(workspace),
    runtimeRead: safeRuntimeRead,
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
      targetMode: TARGET_MODE_NEW_WINDOW,
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
      blockedReasons: blockedReasons(checks),
      notes: [
        "This packet is preflight-only.",
        "No browser action is performed by this preflight surface.",
        "A 4+ tab active runtime workspace is required before dedicated-window projection can proceed.",
        "All tabs must have URLs and assigned roles for this first threshold preflight.",
        "The copy action rebuilds the packet from current runtime state to avoid stale load-time packets.",
        "This packet performs a second delayed runtime tab read to detect hydration gaps.",
        "Future live execution must use a separate validation suite, Operator approval, live action, and post-action verification."
      ]
    }
  };
}

async function readRuntimeWorkspaceWithTabHydration() {
  const firstWorkspace = await getWorkspace();
  const firstTabs = Array.isArray(firstWorkspace?.tabs) ? firstWorkspace.tabs : [];

  if (firstTabs.length > 0) {
    return createRuntimeReadEvidence({
      status: "ready_first_read",
      selectedRead: "first",
      firstWorkspace,
      firstTabs,
      secondWorkspace: null,
      secondTabs: []
    });
  }

  await delay(RUNTIME_TAB_HYDRATION_DELAY_MS);
  const secondWorkspace = await getWorkspace();
  const secondTabs = Array.isArray(secondWorkspace?.tabs) ? secondWorkspace.tabs : [];

  if (secondTabs.length > 0) {
    return createRuntimeReadEvidence({
      status: "ready_second_read",
      selectedRead: "second",
      firstWorkspace,
      firstTabs,
      secondWorkspace,
      secondTabs
    });
  }

  return createRuntimeReadEvidence({
    status: "tabs_missing_after_hydration_read",
    selectedRead: "second",
    firstWorkspace,
    firstTabs,
    secondWorkspace,
    secondTabs
  });
}

function createRuntimeReadEvidence({ status, selectedRead, firstWorkspace, firstTabs, secondWorkspace, secondTabs }) {
  const selectedWorkspace = selectedRead === "first" ? firstWorkspace : secondWorkspace || firstWorkspace;
  const selectedTabs = selectedRead === "first" ? firstTabs : secondTabs;
  return {
    status,
    selectedRead,
    hydrationDelayMs: selectedRead === "second" ? RUNTIME_TAB_HYDRATION_DELAY_MS : 0,
    firstRead: {
      workspaceId: firstWorkspace?.workspaceId || "",
      name: firstWorkspace?.name || "",
      tabCount: firstTabs.length,
      tabsArrayPresent: Array.isArray(firstWorkspace?.tabs)
    },
    secondRead: secondWorkspace ? {
      workspaceId: secondWorkspace?.workspaceId || "",
      name: secondWorkspace?.name || "",
      tabCount: secondTabs.length,
      tabsArrayPresent: Array.isArray(secondWorkspace?.tabs)
    } : null,
    selectedWorkspace,
    selectedTabs,
    selectedTabCount: selectedTabs.length
  };
}

function createPreflightChecks({ workspace, tabStatus, plannedGroups, policy, runtimeRead }) {
  return [
    createPreflightCheck("runtime_workspace_exists", Boolean(workspace?.workspaceId), "Active runtime workspace exists."),
    createPreflightCheck("runtime_tabs_hydrated", runtimeRead.selectedTabCount > 0, "Active runtime workspace tabs are available after hydration read."),
    createPreflightCheck("dedicated_window_policy_active", policy.dedicatedWindowPolicyActive === true, "Active workspace is in the 4+ tab dedicated-window policy range."),
    createPreflightCheck("minimum_tab_threshold_met", tabStatus.totalTabs >= DEDICATED_WINDOW_THRESHOLD, "Active workspace has at least 4 tabs."),
    createPreflightCheck("workspace_tabs_have_urls", tabStatus.totalTabs > 0 && tabStatus.missingUrlCount === 0, "All active workspace tabs have URLs."),
    createPreflightCheck("workspace_tabs_have_roles", tabStatus.totalTabs > 0 && tabStatus.unassignedTabs === 0, "All active workspace tabs have assigned roles."),
    createPreflightCheck("planned_groups_available", plannedGroups.length > 0, "Planned role groups are available."),
    createPreflightCheck("target_mode_new_window", TARGET_MODE_NEW_WINDOW === "new_window", "Target mode is new_window."),
    createPreflightCheck("no_runtime_action_executed", true, "Preflight packet does not execute runtime action."),
    createPreflightCheck("no_browser_projection_changed", true, "Preflight packet does not change browser projection."),
    createPreflightCheck("no_session_db_changed", true, "Preflight packet does not write Session DB."),
    createPreflightCheck("no_chrome_storage_runtime_changed", true, "Preflight packet does not replace chrome.storage.local runtime workspace.")
  ];
}

function createPreflightCheck(check, passed, message) {
  return createCheck(check, passed, message, "block");
}

function sortTabsByRuntimeOrder(tabs) {
  return [...tabs].sort((left, right) => {
    const leftIndex = Number.isInteger(left.index) ? left.index : Number.MAX_SAFE_INTEGER;
    const rightIndex = Number.isInteger(right.index) ? right.index : Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return String(left.workspaceTabId || left.tabId || left.url || "").localeCompare(String(right.workspaceTabId || right.tabId || right.url || ""));
  });
}

function formatPacket(packet) {
  return formatPacketEnvelope(packet);
}

function createSummary(packet) {
  return "Threshold preflight: " + packet.preflight.status + " | Tabs: " + packet.tabStatus.totalTabs + " | Planned groups: " + packet.browserPlan.plannedGroupCount + " | Ready for review: " + packet.preflight.readyForNextSlice + ".";
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

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export { buildDedicatedWindowThresholdPreflightPacketForValidation, createRuntimeReadEvidence };
