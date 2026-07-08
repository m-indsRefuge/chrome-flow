import { listRecentResumableWorkspaceMemoryRecords } from "../core/workspace-memory-store.js";

import {
  evaluateSavedWorkspaceResumeGate,
  formatSavedWorkspaceResumeGateForUser
} from "./workspace-library-resume-gate.js";

installWorkspaceRecentResumeSurface();

function installWorkspaceRecentResumeSurface() {
  const librarySection = document.getElementById("savedWorkspaceRegistrySection");
  if (!librarySection || document.getElementById("workspaceRecentResumeSection")) return;

  const section = document.createElement("section");
  section.id = "workspaceRecentResumeSection";
  section.className = "workspace-recent-resume-section";
  section.dataset.productSurface = "recent-resume";

  section.innerHTML = `
    <h2>Recent Workspaces</h2>
    <p class="section-help">Quickly continue one of your last three resumable saved workspaces. Resume execution is still gated; preview is safe and read-only.</p>
    <div class="workspace-session-actions">
      <button id="refreshRecentResumeButton" type="button" class="secondary-button">Refresh Recent Workspaces</button>
      <button id="previewRecentResumeButton" type="button" class="secondary-button" disabled>Preview Selected Recent Workspace</button>
      <button id="resumeRecentWorkspaceButton" type="button" class="secondary-button" disabled>Resume Recent Workspace</button>
    </div>
    <p id="workspaceRecentResumeStatus" class="status-message">Recent resumable workspaces will appear here.</p>
    <div id="workspaceRecentResumeList" class="workspace-recent-resume-list"></div>
  `;

  librarySection.insertAdjacentElement("beforebegin", section);

  document.getElementById("refreshRecentResumeButton")?.addEventListener("click", refreshRecentResumeSurface);
  document.getElementById("previewRecentResumeButton")?.addEventListener("click", previewSelectedRecentWorkspace);
  document.getElementById("resumeRecentWorkspaceButton")?.addEventListener("click", () => {
    setRecentResumeStatus("Resume is intentionally gated. The next execution slice will connect this button to precheck, confirmation, execution, and verification.");
  });

  void refreshRecentResumeSurface();
}

async function refreshRecentResumeSurface() {
  const list = document.getElementById("workspaceRecentResumeList");
  const previewButton = document.getElementById("previewRecentResumeButton");
  const resumeButton = document.getElementById("resumeRecentWorkspaceButton");

  if (!list) return;

  clearElement(list);
  previewButton?.setAttribute("disabled", "disabled");
  resumeButton?.setAttribute("disabled", "disabled");

  try {
    const records = await listRecentResumableWorkspaceMemoryRecords(3);

    if (!records.length) {
      list.appendChild(createEmptyRecentResumeState());
      setRecentResumeStatus("No recent resumable workspaces found in long-term memory.");
      return;
    }

    records.forEach((record, index) => {
      list.appendChild(createRecentWorkspaceCard(record, index));
    });

    selectRecentWorkspace(records[0].workspace.workspaceId);
    setRecentResumeStatus("Recent Workspaces loaded: " + records.length + ". Preview is available; Resume remains gated.");
  } catch (error) {
    setRecentResumeStatus("Could not load recent resumable workspaces. Check Developer Diagnostics.");
    list.appendChild(createErrorState(error));
  }
}

function createRecentWorkspaceCard(record, index) {
  const detail = createGateDetailFromMemoryRecord(record);
  const gate = evaluateSavedWorkspaceResumeGate(detail);
  const card = document.createElement("article");
  card.className = "workspace-recent-card";
  card.dataset.workspaceId = record.workspace.workspaceId;
  card.tabIndex = 0;

  const title = document.createElement("h3");
  title.textContent = (index + 1) + ". " + (record.workspace.name || "Untitled Workspace");
  card.appendChild(title);

  const meta = document.createElement("p");
  meta.className = "workspace-recent-meta";
  meta.textContent = [
    record.workspace.workspaceType || "workspace",
    record.workspace.lifecycleState || "unknown",
    record.counts.tabs + " tabs",
    record.counts.timelineEvents + " events"
  ].join(" · ");
  card.appendChild(meta);

  const readiness = document.createElement("p");
  readiness.className = "workspace-recent-readiness";
  readiness.textContent = formatSavedWorkspaceResumeGateForUser(gate);
  card.appendChild(readiness);

  const status = document.createElement("p");
  status.className = "workspace-recent-gate-status";
  status.textContent = "Gate: " + gate.status + " | Target: " + gate.restoreTargetMode;
  card.appendChild(status);

  card.addEventListener("click", () => selectRecentWorkspace(record.workspace.workspaceId));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectRecentWorkspace(record.workspace.workspaceId);
    }
  });

  return card;
}

function selectRecentWorkspace(workspaceId) {
  const cards = Array.from(document.querySelectorAll(".workspace-recent-card"));

  for (const card of cards) {
    const isSelected = card.dataset.workspaceId === workspaceId;
    card.classList.toggle("selected", isSelected);
    card.setAttribute("aria-selected", String(isSelected));
  }

  const previewButton = document.getElementById("previewRecentResumeButton");
  if (workspaceId) {
    previewButton?.removeAttribute("disabled");
  } else {
    previewButton?.setAttribute("disabled", "disabled");
  }

  const selectedCard = cards.find((card) => card.dataset.workspaceId === workspaceId);
  const gateStatus = selectedCard?.querySelector(".workspace-recent-gate-status")?.textContent || "Gate status unavailable.";
  setRecentResumeStatus("Selected recent workspace. " + gateStatus + " Resume execution remains gated.");
}

function previewSelectedRecentWorkspace() {
  const selectedCard = document.querySelector(".workspace-recent-card.selected");
  const workspaceId = selectedCard?.dataset?.workspaceId || "";

  if (!workspaceId) {
    setRecentResumeStatus("Select a recent workspace before previewing.");
    return;
  }

  const select = document.getElementById("savedWorkspaceSelect");
  const inspectButton = document.getElementById("inspectSavedWorkspaceButton") || document.getElementById("workspaceLibraryPreviewButton");

  if (!select || !Array.from(select.options).some((option) => option.value === workspaceId)) {
    setRecentResumeStatus("Selected recent workspace is not currently available in the Workspace Library selector. Refresh Library and try again.");
    return;
  }

  select.value = workspaceId;
  inspectButton?.click();
  document.getElementById("savedWorkspaceRegistrySection")?.scrollIntoView({ behavior: "smooth", block: "start" });
  setRecentResumeStatus("Recent workspace preview opened in Workspace Library. No tabs or windows were changed.");
}

function createGateDetailFromMemoryRecord(record) {
  const projection = record.projections[0] || {};
  const summary = record.summaryCard || {};

  return {
    Workspace: record.workspace.name || "Untitled Workspace",
    Type: record.workspace.workspaceType || "workspace",
    Lifecycle: record.workspace.lifecycleState || "unknown",
    Projection: [projection.projectionState || "none", projection.projectionMode || "none"].join(" / "),
    Tabs: String(record.counts.tabs || 0),
    Sessions: String(record.counts.sessions || 0),
    "Timeline events": String(record.counts.timelineEvents || 0),
    "Journal entries": String(record.counts.journalEntries || 0),
    Aim: record.workspace.aim || summary.workspaceAim || "No aim recorded",
    Summary: summary.deterministicSummary || "No summary available yet.",
    Continuation: summary.continuationSummary || "No continuation note recorded."
  };
}

function createEmptyRecentResumeState() {
  const empty = document.createElement("p");
  empty.className = "workspace-recent-empty-state";
  empty.textContent = "No recent resumable workspaces are available yet.";
  return empty;
}

function createErrorState(error) {
  const state = document.createElement("p");
  state.className = "workspace-recent-error-state";
  state.textContent = "Recent resume failed to load: " + (error?.message || String(error));
  return state;
}

function setRecentResumeStatus(message) {
  const status = document.getElementById("workspaceRecentResumeStatus");
  if (status) status.textContent = message;
}

function clearElement(element) {
  if (!element) return;

  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}
