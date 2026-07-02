import { getWorkspace } from "../core/workspace-store.js";

import {
  getActiveWorkspaceId,
  getWorkspaceProjections,
  getWorkspaceRecord,
  getWorkspaceTabs
} from "../core/session-repository.js";

const TARGET_WORKSPACE_ID = "c22b5a00-c68d-4b64-8bba-01172a0dd818";
const TARGET_WORKSPACE_NAME = "Layer 2 Rehydration Candidate Test";
const RUN_PHRASE = "OPEN NEW WINDOW FOR SAVED WORKSPACE";
const PACKET_ENVELOPE_START = "CHROME_FLOW_PACKET_START";
const PACKET_ENVELOPE_END = "CHROME_FLOW_PACKET_END";
const PACKET_CLIPBOARD_FORMAT = "chrome_flow_packet_envelope_v0.1";
const PACKET_CONTENT_TYPE = "application/json";

installProjectionResumeRunPrecheck();

function installProjectionResumeRunPrecheck() {
  if (document.getElementById("projectionResumeRunSection")) return;

  const anchor = document.getElementById("projectionResumeReviewSection") || document.querySelector(".workspace-section");
  if (!anchor) return;

  const section = document.createElement("section");
  section.id = "projectionResumeRunSection";
  section.className = "projection-resume-run-section";
  section.innerHTML = `
    <h2>Projection Resume Run Prototype</h2>
    <p class="section-help">Precheck the first mapped resume run path. This panel does not call live browser-action APIs.</p>
    <div id="projectionResumeRunSummary" class="workspace-session-summary">Run precheck surface loaded.</div>
    <div class="workspace-session-options">
      <p><strong>Fixed target:</strong> ${TARGET_WORKSPACE_NAME}</p>
      <p><strong>Target mode:</strong> new_window only</p>
      <p><strong>Required run phrase:</strong> ${RUN_PHRASE}</p>
      <label for="projectionResumeRunPhrase">Type run phrase</label>
      <input id="projectionResumeRunPhrase" type="text" placeholder="OPEN NEW WINDOW FOR SAVED WORKSPACE" />
      <label class="checkbox-label"><input id="projectionResumeRunAcknowledgement" type="checkbox" /> I understand this precheck is preparing a future one-window resume path only.</label>
    </div>
    <div class="workspace-session-actions">
      <button id="refreshProjectionResumeRunCandidateButton" type="button" class="secondary-button">Refresh Run Candidate</button>
      <button id="prepareProjectionResumeRunPrecheckButton" type="button" class="secondary-button">Prepare Run Precheck</button>
      <button id="runProjectionResumePrototypeButton" type="button" class="danger-button" disabled>Run Projection Prototype Disabled</button>
      <button id="copyProjectionResumeRunPacketButton" type="button" class="secondary-button">Copy Run Packet</button>
    </div>
    <p id="projectionResumeRunStatus" class="status-message"></p>
    <pre id="projectionResumeRunOutput" class="diagnostics-output">Projection resume run precheck output will appear here.</pre>
  `;

  anchor.insertAdjacentElement("afterend", section);

  document.getElementById("refreshProjectionResumeRunCandidateButton")?.addEventListener("click", refreshCandidate);
  document.getElementById("prepareProjectionResumeRunPrecheckButton")?.addEventListener("click", preparePacket);
  document.getElementById("copyProjectionResumeRunPacketButton")?.addEventListener("click", copyPacket);
}

async function refreshCandidate() {
  try {
    const packet = await buildPacket();
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Run candidate refreshed: " + packet.preRun.status + ".");
  } catch (error) {
    setError("Could not refresh run candidate.", error);
  }
}

async function preparePacket() {
  try {
    const packet = await buildPacket();
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Run precheck packet prepared: " + packet.preRun.status + ".");
  } catch (error) {
    setError("Could not prepare run precheck packet.", error);
  }
}

async function copyPacket() {
  try {
    const packet = await buildPacket();
    await navigator.clipboard.writeText(formatPacket(packet));
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Run precheck packet copied: " + packet.preRun.status + ".");
  } catch (error) {
    setError("Could not copy run precheck packet.", error);
  }
}

async function buildPacket() {
  const activeRuntimeWorkspace = await getWorkspace();
  const activeDbWorkspaceId = await getActiveWorkspaceId();
  const workspace = await getWorkspaceRecord(TARGET_WORKSPACE_ID);
  const tabs = await getWorkspaceTabs(TARGET_WORKSPACE_ID);
  const projections = await getWorkspaceProjections(TARGET_WORKSPACE_ID);
  const latestProjection = projections[0] || null;
  const missingUrlCount = tabs.filter((tab) => !tab.url).length;
  const plannedGroups = createPlannedGroups(tabs);
  const phraseMatches = getRunPhrase() === RUN_PHRASE;
  const acknowledgementChecked = Boolean(document.getElementById("projectionResumeRunAcknowledgement")?.checked);
  const runButtonDisabled = Boolean(document.getElementById("runProjectionResumePrototypeButton")?.disabled);

  const checks = createChecks({ workspace, tabs, missingUrlCount, plannedGroups, latestProjection, phraseMatches, acknowledgementChecked, runButtonDisabled });
  const failedChecks = checks.filter((check) => check.status === "fail");
  const status = failedChecks.length ? "blocked_before_run" : "precheck_passed_run_still_disabled";

  return {
    packetType: "Chrome Flow Projection Resume Run Precheck Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "projection-resume-run-precheck-packet-v0.1"
    },
    clipboard: {
      format: PACKET_CLIPBOARD_FORMAT,
      contentType: PACKET_CONTENT_TYPE,
      copyMode: "text_envelope",
      envelopeStart: PACKET_ENVELOPE_START,
      envelopeEnd: PACKET_ENVELOPE_END
    },
    source: {
      type: "projection_resume_run_precheck_panel",
      readOnly: true,
      precheckOnly: true,
      runtimeActionExecuted: false,
      browserProjectionChanged: false,
      sessionDbChanged: false,
      chromeStorageRuntimeChanged: false,
      runButtonDisabled
    },
    workspace: {
      expectedWorkspaceId: TARGET_WORKSPACE_ID,
      expectedWorkspaceName: TARGET_WORKSPACE_NAME,
      workspaceId: workspace?.workspaceId || "",
      name: workspace?.name || "",
      lifecycleState: workspace?.lifecycleState || "missing"
    },
    operatorConfirmation: {
      requiredPhrase: RUN_PHRASE,
      phraseMatches,
      acknowledgementChecked,
      operatorConfirmed: phraseMatches && acknowledgementChecked
    },
    browserPlan: {
      targetMode: "new_window",
      expectedWindowCount: 1,
      expectedTabCount: 3,
      savedTabCount: tabs.length,
      missingUrlCount,
      expectedGroupCount: 3,
      plannedGroupCount: plannedGroups.length,
      plannedGroups
    },
    runtimeReview: {
      activeRuntimeWorkspaceId: activeRuntimeWorkspace?.workspaceId || "",
      activeRuntimeWorkspaceName: activeRuntimeWorkspace?.name || "",
      activeDbWorkspaceId,
      sessionDbRuntimeSourceOfTruth: false,
      chromeStorageRuntimeAuthorityPreserved: true,
      runtimeSelectionReviewOnly: true
    },
    preRun: {
      status,
      availableInThisSlice: false,
      checks,
      failedChecks,
      blockedReasons: failedChecks.map((check) => check.message),
      notes: [
        "This packet is precheck-only.",
        "The run button remains disabled in this slice.",
        "No live browser-action APIs are called in this slice.",
        "Saved group evidence remains mandatory for a clean projection path."
      ]
    }
  };
}

function createChecks(context) {
  return [
    createCheck("target_workspace_id_fixed", true, "Target workspace id is fixed for the first prototype."),
    createCheck("workspace_exists", Boolean(context.workspace), "Target workspace exists."),
    createCheck("workspace_not_archived", context.workspace?.lifecycleState !== "archived", "Target workspace is not archived."),
    createCheck("saved_tab_count_is_three", context.tabs.length === 3, "Saved tab count is exactly 3 for initial validation."),
    createCheck("saved_urls_available", context.missingUrlCount === 0, "Saved tab records have URLs."),
    createCheck("role_group_evidence_exists", context.plannedGroups.length > 0, "Saved role/group evidence exists."),
    createCheck("planned_group_count_is_three", context.plannedGroups.length === 3, "Planned group count is exactly 3 for initial validation."),
    createCheck("projection_record_available", Boolean(context.latestProjection), "Projection record is available."),
    createCheck("projection_is_dehydrated", context.latestProjection?.projectionState === "dehydrated", "Projection is dehydrated before future resume."),
    createCheck("operator_phrase_matches", context.phraseMatches, "Operator typed the required run phrase."),
    createCheck("operator_acknowledgement_checked", context.acknowledgementChecked, "Operator checked the run acknowledgement."),
    createCheck("run_button_disabled", context.runButtonDisabled, "Run button is disabled in this precheck slice.")
  ];
}

function createCheck(check, passed, message) {
  return { check, status: passed ? "pass" : "fail", severity: "block", message };
}

function createPlannedGroups(tabs) {
  const roles = new Map();
  for (const tab of tabs) {
    const role = tab.role || "unassigned";
    if (role === "unassigned") continue;
    if (!roles.has(role)) roles.set(role, []);
    roles.get(role).push(tab.workspaceTabId);
  }

  return Array.from(roles.entries()).map(([role, workspaceTabIds]) => ({
    role,
    roleLabel: createRoleLabel(role),
    workspaceTabIds,
    requiredForProjection: true
  }));
}

function createRoleLabel(role) {
  return String(role || "unassigned").replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getRunPhrase() {
  return document.getElementById("projectionResumeRunPhrase")?.value.trim() || "";
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
  return "Run precheck: " + packet.preRun.status + " | Saved tabs: " + packet.browserPlan.savedTabCount + " | Planned groups: " + packet.browserPlan.plannedGroupCount + " | Run disabled: " + packet.source.runButtonDisabled + ".";
}

function setSummary(message) {
  const summary = document.getElementById("projectionResumeRunSummary");
  if (summary) summary.textContent = message;
}

function setStatus(message) {
  const status = document.getElementById("projectionResumeRunStatus");
  if (status) status.textContent = message;
}

function setOutput(value) {
  const output = document.getElementById("projectionResumeRunOutput");
  if (output) output.textContent = JSON.stringify(value, null, 2);
}

function setError(message, error) {
  setOutput({ status: "error", message, error: error?.message || String(error) });
  setStatus(message);
}
