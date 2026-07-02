import { getWorkspace } from "../core/workspace-store.js";

import {
  getActiveWorkspaceId,
  getWorkspaceProjections,
  getWorkspaceRecord,
  getWorkspaceSessions,
  getWorkspaceTabs,
  listWorkspaceRecords
} from "../core/session-repository.js";

const DEFAULT_TARGET_WORKSPACE_ID = "c22b5a00-c68d-4b64-8bba-01172a0dd818";
const DEFAULT_TARGET_WORKSPACE_NAME = "Layer 2 Rehydration Candidate Test";
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
    <p class="section-help">Precheck a selected Session DB resume candidate. This panel does not call live browser-action APIs.</p>
    <div id="projectionResumeRunSummary" class="workspace-session-summary">Run precheck surface loaded.</div>
    <div class="workspace-session-options">
      <p><strong>Default target:</strong> ${DEFAULT_TARGET_WORKSPACE_NAME}</p>
      <p><strong>Target mode:</strong> new_window only</p>
      <p><strong>Required run phrase:</strong> ${RUN_PHRASE}</p>
      <label for="projectionResumeCandidateSelect">Resume candidate</label>
      <select id="projectionResumeCandidateSelect">
        <option value="${DEFAULT_TARGET_WORKSPACE_ID}">${DEFAULT_TARGET_WORKSPACE_NAME}</option>
      </select>
      <label for="projectionResumeRunPhrase">Type run phrase</label>
      <input id="projectionResumeRunPhrase" type="text" placeholder="OPEN NEW WINDOW FOR SAVED WORKSPACE" />
      <label class="checkbox-label"><input id="projectionResumeRunAcknowledgement" type="checkbox" /> I understand this precheck is preparing a future one-window resume path only.</label>
    </div>
    <div class="workspace-session-actions">
      <button id="refreshProjectionResumeRunCandidateButton" type="button" class="secondary-button">Refresh Run Candidates</button>
      <button id="prepareProjectionResumeRunPrecheckButton" type="button" class="secondary-button">Prepare Run Precheck</button>
      <button id="runProjectionResumePrototypeButton" type="button" class="danger-button" disabled>Run Projection Prototype Disabled</button>
      <button id="copyProjectionResumeRunPacketButton" type="button" class="secondary-button">Copy Run Packet</button>
    </div>
    <p id="projectionResumeRunStatus" class="status-message"></p>
    <pre id="projectionResumeRunOutput" class="diagnostics-output">Projection resume run precheck output will appear here.</pre>
  `;

  anchor.insertAdjacentElement("afterend", section);

  document.getElementById("refreshProjectionResumeRunCandidateButton")?.addEventListener("click", refreshCandidates);
  document.getElementById("prepareProjectionResumeRunPrecheckButton")?.addEventListener("click", preparePacket);
  document.getElementById("copyProjectionResumeRunPacketButton")?.addEventListener("click", copyPacket);

  refreshCandidates();
}

async function refreshCandidates() {
  try {
    const candidates = await buildCandidateSummaries();
    renderCandidateOptions(candidates);
    const packet = await buildPacket(candidates);
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Run candidates refreshed: " + candidates.length + " Session DB workspace records inspected.");
  } catch (error) {
    setError("Could not refresh run candidates.", error);
  }
}

async function preparePacket() {
  try {
    const candidates = await buildCandidateSummaries();
    renderCandidateOptions(candidates);
    const packet = await buildPacket(candidates);
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Run precheck packet prepared: " + packet.preRun.status + ".");
  } catch (error) {
    setError("Could not prepare run precheck packet.", error);
  }
}

async function copyPacket() {
  try {
    const candidates = await buildCandidateSummaries();
    renderCandidateOptions(candidates);
    const packet = await buildPacket(candidates);
    await navigator.clipboard.writeText(formatPacket(packet));
    setSummary(createSummary(packet));
    setOutput(packet);
    setStatus("Run precheck packet copied: " + packet.preRun.status + ".");
  } catch (error) {
    setError("Could not copy run precheck packet.", error);
  }
}

async function buildCandidateSummaries() {
  const workspaces = await listWorkspaceRecords();
  const summaries = [];

  for (const workspace of workspaces) {
    const tabs = await getWorkspaceTabs(workspace.workspaceId);
    const sessions = await getWorkspaceSessions(workspace.workspaceId);
    const projections = await getWorkspaceProjections(workspace.workspaceId);
    const plannedGroups = createPlannedGroups(tabs);
    const missingUrlCount = tabs.filter((tab) => !tab.url).length;
    const latestProjection = projections[0] || null;
    const eligibility = createCandidateEligibility({ workspace, tabs, sessions, plannedGroups, missingUrlCount, latestProjection });

    summaries.push({
      workspaceId: workspace.workspaceId,
      name: workspace.name,
      lifecycleState: workspace.lifecycleState,
      savedTabCount: tabs.length,
      missingUrlCount,
      plannedGroupCount: plannedGroups.length,
      sessionCount: sessions.length,
      projectionCount: projections.length,
      latestProjectionState: latestProjection?.projectionState || "missing",
      eligibleForPrecheck: eligibility.every((check) => check.status === "pass"),
      eligibility
    });
  }

  return summaries;
}

function renderCandidateOptions(candidates) {
  const select = document.getElementById("projectionResumeCandidateSelect");
  if (!select) return;

  const selectedBeforeRefresh = getSelectedWorkspaceId();
  const candidateIds = new Set(candidates.map((candidate) => candidate.workspaceId));
  select.innerHTML = "";

  for (const candidate of candidates) {
    const option = document.createElement("option");
    option.value = candidate.workspaceId;
    option.textContent = createCandidateLabel(candidate);
    if (!candidate.eligibleForPrecheck) option.dataset.precheck = "blocked";
    select.appendChild(option);
  }

  if (!candidateIds.has(DEFAULT_TARGET_WORKSPACE_ID)) {
    const option = document.createElement("option");
    option.value = DEFAULT_TARGET_WORKSPACE_ID;
    option.textContent = DEFAULT_TARGET_WORKSPACE_NAME + " — not found in Session DB";
    option.dataset.precheck = "missing";
    select.appendChild(option);
  }

  select.value = candidateIds.has(selectedBeforeRefresh) ? selectedBeforeRefresh : DEFAULT_TARGET_WORKSPACE_ID;
}

function createCandidateLabel(candidate) {
  const status = candidate.eligibleForPrecheck ? "eligible" : "blocked";
  return `${candidate.name} — tabs:${candidate.savedTabCount} groups:${candidate.plannedGroupCount} projection:${candidate.latestProjectionState} ${status}`;
}

async function buildPacket(candidateSummaries = null) {
  const activeRuntimeWorkspace = await getWorkspace();
  const activeDbWorkspaceId = await getActiveWorkspaceId();
  const candidates = candidateSummaries || await buildCandidateSummaries();
  const selectedWorkspaceId = getSelectedWorkspaceId();
  const workspace = await getWorkspaceRecord(selectedWorkspaceId);
  const tabs = await getWorkspaceTabs(selectedWorkspaceId);
  const sessions = await getWorkspaceSessions(selectedWorkspaceId);
  const projections = await getWorkspaceProjections(selectedWorkspaceId);
  const latestProjection = projections[0] || null;
  const missingUrlCount = tabs.filter((tab) => !tab.url).length;
  const plannedGroups = createPlannedGroups(tabs);
  const selectedCandidate = candidates.find((candidate) => candidate.workspaceId === selectedWorkspaceId) || null;
  const phraseMatches = getRunPhrase() === RUN_PHRASE;
  const acknowledgementChecked = Boolean(document.getElementById("projectionResumeRunAcknowledgement")?.checked);
  const runButtonDisabled = Boolean(document.getElementById("runProjectionResumePrototypeButton")?.disabled);

  const checks = createChecks({ workspace, tabs, sessions, missingUrlCount, plannedGroups, latestProjection, phraseMatches, acknowledgementChecked, runButtonDisabled });
  const failedChecks = checks.filter((check) => check.status === "fail");
  const status = failedChecks.length ? "blocked_before_run" : "precheck_passed_run_still_disabled";

  return {
    packetType: "Chrome Flow Projection Resume Run Precheck Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "projection-resume-run-precheck-packet-v0.2"
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
      candidateSelectorEnabled: true,
      runtimeActionExecuted: false,
      browserProjectionChanged: false,
      sessionDbChanged: false,
      chromeStorageRuntimeChanged: false,
      runButtonDisabled
    },
    candidateSelector: {
      mode: "session_db_candidate_selector",
      selectedWorkspaceId,
      defaultWorkspaceId: DEFAULT_TARGET_WORKSPACE_ID,
      candidateCount: candidates.length,
      selectedCandidate,
      candidates
    },
    workspace: {
      expectedWorkspaceId: selectedWorkspaceId,
      expectedWorkspaceName: workspace?.name || "",
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
    sessionDbEvidence: {
      workspaceRecordRead: Boolean(workspace),
      workspaceTabRecordsRead: tabs.length,
      sessionRecordsRead: sessions.length,
      projectionRecordsRead: projections.length,
      latestProjectionState: latestProjection?.projectionState || "missing"
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
        "The selected candidate is read from Session DB records.",
        "Saved group evidence remains mandatory for a clean projection path."
      ]
    }
  };
}

function createCandidateEligibility(context) {
  return [
    createCheck("workspace_exists", Boolean(context.workspace), "Candidate workspace exists."),
    createCheck("workspace_not_archived", context.workspace?.lifecycleState !== "archived", "Candidate workspace is not archived."),
    createCheck("saved_tab_count_is_three", context.tabs.length === 3, "Candidate has exactly 3 saved tabs."),
    createCheck("saved_urls_available", context.missingUrlCount === 0, "Candidate saved tabs have URLs."),
    createCheck("role_group_evidence_exists", context.plannedGroups.length > 0, "Candidate has saved role/group evidence."),
    createCheck("planned_group_count_is_three", context.plannedGroups.length === 3, "Candidate has exactly 3 planned groups."),
    createCheck("session_record_available", context.sessions.length > 0, "Candidate has at least one Session DB session record."),
    createCheck("projection_record_available", Boolean(context.latestProjection), "Candidate has at least one projection record."),
    createCheck("projection_is_dehydrated", context.latestProjection?.projectionState === "dehydrated", "Candidate projection is dehydrated.")
  ];
}

function createChecks(context) {
  return [
    createCheck("candidate_selected", Boolean(getSelectedWorkspaceId()), "A Session DB candidate is selected."),
    createCheck("workspace_exists", Boolean(context.workspace), "Selected workspace exists."),
    createCheck("workspace_not_archived", context.workspace?.lifecycleState !== "archived", "Selected workspace is not archived."),
    createCheck("saved_tab_count_is_three", context.tabs.length === 3, "Saved tab count is exactly 3 for initial validation."),
    createCheck("saved_urls_available", context.missingUrlCount === 0, "Saved tab records have URLs."),
    createCheck("role_group_evidence_exists", context.plannedGroups.length > 0, "Saved role/group evidence exists."),
    createCheck("planned_group_count_is_three", context.plannedGroups.length === 3, "Planned group count is exactly 3 for initial validation."),
    createCheck("session_record_available", context.sessions.length > 0, "Session record is available."),
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

function getSelectedWorkspaceId() {
  return document.getElementById("projectionResumeCandidateSelect")?.value || DEFAULT_TARGET_WORKSPACE_ID;
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
  return "Run precheck: " + packet.preRun.status + " | Candidate: " + (packet.workspace.name || "missing") + " | Saved tabs: " + packet.browserPlan.savedTabCount + " | Planned groups: " + packet.browserPlan.plannedGroupCount + " | Run disabled: " + packet.source.runButtonDisabled + ".";
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
