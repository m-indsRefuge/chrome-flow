import {
  getWorkspaceMemoryRecord,
  listRecentResumableWorkspaceMemoryRecords
} from "../core/workspace-memory-store.js";

import { resumeWorkspaceMemoryRecordSafely } from "../core/workspace-resume-transaction-engine.js";

import { registerDeveloperSurface } from "./developer-mode.js";
import {
  evaluateSavedWorkspaceResumeGate,
  formatSavedWorkspaceResumeGateForUser
} from "./workspace-library-resume-gate.js";

let currentLibraryView = "all";
let recentWorkspaceIds = [];

installWorkspaceLibraryProductSurface();

function installWorkspaceLibraryProductSurface() {
  const section = document.getElementById("savedWorkspaceRegistrySection");
  if (!section) return;

  section.dataset.productSurface = "workspace-library";

  renameWorkspaceLibrary(section);
  hideRawInspectionControls();
  hideCleanupControls();
  ensureWorkspaceLibraryViewControls(section);
  ensureWorkspaceLibraryActionSkeleton(section);
  renderWorkspaceLibraryEmptyState();
  attachWorkspaceLibraryProductLanguageRefresh();
  void refreshWorkspaceLibraryViewState();
}

function renameWorkspaceLibrary(section) {
  const heading = section.querySelector("h2");
  if (heading) heading.textContent = "Workspace Library";

  const help = section.querySelector(".section-help");
  if (help) {
    help.textContent = "Browse saved workspaces, preview their structure, and resume a selected workspace through a checked action.";
  }

  const label = document.querySelector("label[for='savedWorkspaceSelect']");
  if (label) label.textContent = "Saved Workspaces";

  setButtonText("refreshSavedWorkspacesButton", "Refresh Library");
  setButtonText("inspectSavedWorkspaceButton", "View Workspace");

  rewriteSummaryText();
  rewriteStatusText();
}

function hideRawInspectionControls() {
  const copyPacketButton = document.getElementById("copySavedWorkspaceInspectionButton");
  if (copyPacketButton) {
    copyPacketButton.textContent = "Copy Workspace Inspection Packet";
    registerDeveloperSurface(copyPacketButton);
  }

  const output = document.getElementById("savedWorkspaceInspectionOutput");
  if (output) {
    output.textContent = "Developer inspection output will appear here.";
    registerDeveloperSurface(output);
  }
}

function hideCleanupControls() {
  const cleanupControls = document.getElementById("savedWorkspaceCleanupControls");
  if (cleanupControls) registerDeveloperSurface(cleanupControls);

  const cleanupSummary = document.getElementById("savedWorkspaceCleanupSummary");
  if (cleanupSummary) registerDeveloperSurface(cleanupSummary);
}

function ensureWorkspaceLibraryViewControls(section) {
  if (document.getElementById("workspaceLibraryViewControls")) return;

  const selectorPanel = document.getElementById("savedWorkspaceSelect")?.closest(".archive-browser-panel") || section;
  const panel = document.createElement("div");
  panel.id = "workspaceLibraryViewControls";
  panel.className = "workspace-library-view-controls workspace-session-actions";

  panel.appendChild(createLibraryViewButton("recent", "Recent"));
  panel.appendChild(createLibraryViewButton("all", "All"));
  panel.appendChild(createLibraryViewButton("archived", "Archived"));

  const explainer = document.createElement("p");
  explainer.id = "workspaceLibraryViewExplainer";
  explainer.className = "status-message";
  explainer.textContent = "All saved workspaces are visible. Use Recent for quick continuation or Archived for deeper recovery.";

  selectorPanel.insertAdjacentElement("beforebegin", explainer);
  selectorPanel.insertAdjacentElement("beforebegin", panel);
}

function createLibraryViewButton(view, text) {
  const button = document.createElement("button");
  button.id = "workspaceLibraryView" + capitalize(view) + "Button";
  button.type = "button";
  button.className = "secondary-button";
  button.dataset.libraryView = view;
  button.textContent = text;
  button.addEventListener("click", () => {
    currentLibraryView = view;
    setResumeButtonState(null, "Switching library view. Preview a workspace before resuming.");
    void refreshWorkspaceLibraryViewState();
  });
  return button;
}

async function refreshWorkspaceLibraryViewState() {
  await refreshRecentWorkspaceIds();
  applyWorkspaceLibraryViewFilter();
  updateWorkspaceLibraryViewButtons();
  updateWorkspaceLibraryViewExplainer();
}

async function refreshRecentWorkspaceIds() {
  try {
    const recentRecords = await listRecentResumableWorkspaceMemoryRecords(3);
    recentWorkspaceIds = recentRecords.map((record) => record.workspace.workspaceId);
  } catch (_error) {
    recentWorkspaceIds = [];
  }
}

function applyWorkspaceLibraryViewFilter() {
  const select = document.getElementById("savedWorkspaceSelect");
  if (!select) return;

  const options = Array.from(select.options);

  for (const option of options) {
    const visible = isWorkspaceOptionVisibleForCurrentView(option);
    option.hidden = !visible;
    option.disabled = !visible;
  }

  const currentOption = options.find((option) => option.value === select.value);
  if (!currentOption || currentOption.hidden || currentOption.disabled) {
    const firstVisible = options.find((option) => !option.hidden && !option.disabled && option.value);
    if (firstVisible) {
      select.value = firstVisible.value;
      select.dispatchEvent(new Event("change"));
    }
  }
}

function isWorkspaceOptionVisibleForCurrentView(option) {
  if (!option.value) return true;

  const label = option.textContent.toLowerCase();

  if (currentLibraryView === "recent") {
    return recentWorkspaceIds.includes(option.value);
  }

  if (currentLibraryView === "archived") {
    return label.includes("| archived") || label.includes(" archived") || label.includes("archived");
  }

  return true;
}

function updateWorkspaceLibraryViewButtons() {
  for (const button of Array.from(document.querySelectorAll("[data-library-view]"))) {
    const selected = button.dataset.libraryView === currentLibraryView;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
}

function updateWorkspaceLibraryViewExplainer() {
  const explainer = document.getElementById("workspaceLibraryViewExplainer");
  const select = document.getElementById("savedWorkspaceSelect");
  if (!explainer) return;

  const visibleCount = select ? Array.from(select.options).filter((option) => option.value && !option.hidden && !option.disabled).length : 0;

  if (currentLibraryView === "recent") {
    explainer.textContent = "Recent view: showing up to 3 resumable workspaces for quick continuation. Visible: " + visibleCount + ".";
    return;
  }

  if (currentLibraryView === "archived") {
    explainer.textContent = "Archived view: showing older archived/recovery workspaces when available. Visible: " + visibleCount + ".";
    return;
  }

  explainer.textContent = "All view: showing the full Workspace Library. Visible: " + visibleCount + ".";
}

function ensureWorkspaceLibraryActionSkeleton(section) {
  if (document.getElementById("workspaceLibraryActionSkeleton")) return;

  const status = document.getElementById("savedWorkspaceRegistryStatus");
  const anchor = status || section;
  if (!anchor) return;

  const panel = document.createElement("div");
  panel.id = "workspaceLibraryActionSkeleton";
  panel.className = "workspace-library-action-skeleton workspace-session-actions";

  const previewButton = createActionButton("workspaceLibraryPreviewButton", "Preview Workspace", false);
  const resumeButton = createActionButton("workspaceLibraryResumeButton", "Resume Workspace", true);
  const controlsButton = createActionButton("workspaceLibraryOpenControlsButton", "Open Current Workspace Controls", false);

  previewButton.addEventListener("click", () => {
    document.getElementById("inspectSavedWorkspaceButton")?.click();
    setLibraryActionStatus("Preview loaded. This is read-only and does not reopen tabs or change your active browser workspace.");
  });

  resumeButton.addEventListener("click", () => {
    void resumeSelectedWorkspaceFromLibrary();
  });

  controlsButton.addEventListener("click", () => {
    const controls = document.getElementById("workspaceSessionControlSection") || document.querySelector(".workspace-section");
    if (controls) {
      controls.scrollIntoView({ behavior: "smooth", block: "start" });
      setLibraryActionStatus("Current Workspace controls opened. Use that surface to pause/archive the active workspace.");
    } else {
      setLibraryActionStatus("Current Workspace controls are not available in this sidepanel session.");
    }
  });

  panel.appendChild(previewButton);
  panel.appendChild(resumeButton);
  panel.appendChild(controlsButton);

  const actionStatus = document.createElement("p");
  actionStatus.id = "workspaceLibraryActionStatus";
  actionStatus.className = "status-message";
  actionStatus.textContent = "Preview a workspace to run the resume gate. Resume becomes available only when the gate passes.";

  const alignment = document.createElement("div");
  alignment.id = "workspaceLibraryActionAlignment";
  alignment.className = "workspace-library-action-alignment";
  alignment.appendChild(createActionReadinessLine("Recent", "quick resume", "Last 3 resumable workspaces for fast continuation."));
  alignment.appendChild(createActionReadinessLine("All", "library", "Full saved workspace memory."));
  alignment.appendChild(createActionReadinessLine("Archived", "recovery", "Older archived/recovery workspaces."));
  alignment.appendChild(createActionReadinessLine("Resume", "checked action", "One Resume Workspace action handles recent, saved, and archived records through the same gate."));

  anchor.insertAdjacentElement("afterend", alignment);
  anchor.insertAdjacentElement("afterend", actionStatus);
  anchor.insertAdjacentElement("afterend", panel);
}

function renderWorkspaceLibraryEmptyState() {
  const card = document.getElementById("savedWorkspaceInspectionCard");
  if (!card) return;

  if (card.dataset.workspaceLibraryStructured === "true") return;
  if (!card.textContent.includes("Select a saved workspace")) return;

  clearElement(card);
  card.dataset.workspaceLibraryStructured = "true";
  card.classList.add("workspace-library-detail-card");

  const title = document.createElement("h3");
  title.textContent = "No workspace selected";
  card.appendChild(title);

  const body = document.createElement("p");
  body.textContent = "Choose a saved workspace, then view its saved structure, notes, activity, and resume readiness here.";
  card.appendChild(body);
}

function renderStructuredWorkspaceDetail() {
  const card = document.getElementById("savedWorkspaceInspectionCard");
  if (!card) return;

  const detail = parseLegacyDetailLines(card);
  if (!detail.Workspace) return;

  const selectedWorkspaceId = getSelectedWorkspaceId();
  const resumeGate = evaluateSavedWorkspaceResumeGate(detail);

  clearElement(card);
  card.dataset.workspaceLibraryStructured = "true";
  card.classList.add("workspace-library-detail-card");

  const header = document.createElement("div");
  header.className = "workspace-library-detail-header";

  const title = document.createElement("h3");
  title.textContent = detail.Workspace || "Untitled Workspace";
  header.appendChild(title);

  const meta = document.createElement("p");
  meta.className = "workspace-library-detail-meta";
  meta.textContent = [detail.Type || "workspace", detail.Lifecycle || "unknown", detail.Projection || "projection unknown"].filter(Boolean).join(" · ");
  header.appendChild(meta);

  card.appendChild(header);

  const overview = document.createElement("div");
  overview.className = "workspace-library-overview-grid";
  overview.appendChild(createMetricCard("Tabs", detail.Tabs || "0"));
  overview.appendChild(createMetricCard("Sessions", detail.Sessions || "0"));
  overview.appendChild(createMetricCard("Timeline", detail["Timeline events"] || "0"));
  overview.appendChild(createMetricCard("Journal", detail["Journal entries"] || "0"));
  card.appendChild(overview);

  card.appendChild(createDetailSection("Aim", detail.Aim || "No aim recorded"));
  card.appendChild(createDetailSection("Summary", detail.Summary || "No summary available yet."));
  card.appendChild(createDetailSection("Continuation", detail.Continuation || "No continuation note recorded."));
  card.appendChild(createDetailSection("Resume readiness", formatSavedWorkspaceResumeGateForUser(resumeGate)));
  card.appendChild(createDetailSection("Gate status", buildGateStatusText(resumeGate)));

  setResumeButtonState(resumeGate, selectedWorkspaceId);
  setLibraryActionStatus(createResumeStatusMessage(resumeGate));
}

async function resumeSelectedWorkspaceFromLibrary() {
  const workspaceId = getSelectedWorkspaceId();
  const resumeButton = document.getElementById("workspaceLibraryResumeButton");

  if (!workspaceId) {
    setLibraryActionStatus("Select and preview a workspace before resuming.");
    return;
  }

  resumeButton?.setAttribute("disabled", "disabled");
  setLibraryActionStatus("Preparing workspace resume gate...");

  try {
    const record = await getWorkspaceMemoryRecord(workspaceId);
    if (!record) {
      setLibraryActionStatus("Selected workspace could not be found in long-term memory.");
      return;
    }

    const detail = createGateDetailFromMemoryRecord(record);
    const resumeGate = evaluateSavedWorkspaceResumeGate(detail);

    if (resumeGate.status !== "ready_for_precheck") {
      setResumeButtonState(resumeGate, workspaceId);
      setLibraryActionStatus("Resume blocked: " + resumeGate.failedChecks.map((check) => check.check).join(", ") + ".");
      return;
    }

    const confirmed = window.confirm(
      "Resume workspace: " + (record.workspace.name || "Untitled Workspace") + "?\n\n" +
      "Chrome Flow will make this the active workspace, reopen " + record.counts.tabs + " saved tab(s), recreate role groups, and use the " + formatTargetMode(resumeGate.restoreTargetMode) + ".\n\n" +
      "This will not close your current browser tabs. Archive the current workspace first if you want a clean switch."
    );

    if (!confirmed) {
      setResumeButtonState(resumeGate, workspaceId);
      setLibraryActionStatus("Resume cancelled. No tabs or windows were changed.");
      return;
    }

    setLibraryActionStatus("Resuming workspace. Chrome Flow is reopening tabs and recreating groups...");
    const result = await resumeWorkspaceMemoryRecordSafely(record, { source: "workspace_library_resume_button_fallback" });

    setLibraryActionStatus(
      "Workspace resumed: " + result.hydratedWorkspace.name + ". Reopened " + result.restoreResult.openedTabs.length + " tab(s), recreated " + result.groupResult.recreatedGroupCount + " group(s), target: " + result.restoreTargetMode + "."
    );

    window.setTimeout(() => window.location.reload(), 1200);
  } catch (error) {
    setLibraryActionStatus("Resume failed. Check Developer Diagnostics. " + (error?.message || String(error)));
  } finally {
    window.setTimeout(() => {
      if (resumeButton?.dataset?.resumeGateStatus === "ready_for_precheck") {
        resumeButton.removeAttribute("disabled");
      }
    }, 1500);
  }
}

function setResumeButtonState(resumeGate, workspaceIdOrMessage = "") {
  const resumeButton = document.getElementById("workspaceLibraryResumeButton");
  if (!resumeButton) return;

  if (!resumeGate || resumeGate.status !== "ready_for_precheck" || !workspaceIdOrMessage) {
    resumeButton.setAttribute("disabled", "disabled");
    resumeButton.dataset.workspaceId = "";
    resumeButton.dataset.resumeGateStatus = resumeGate?.status || "not_ready";
    resumeButton.title = typeof workspaceIdOrMessage === "string" && workspaceIdOrMessage && !workspaceIdOrMessage.includes("-")
      ? workspaceIdOrMessage
      : "Preview a resumable workspace before resuming.";
    return;
  }

  resumeButton.removeAttribute("disabled");
  resumeButton.dataset.workspaceId = workspaceIdOrMessage;
  resumeButton.dataset.resumeGateStatus = resumeGate.status;
  resumeButton.dataset.resumeTargetMode = resumeGate.restoreTargetMode;
  resumeButton.title = "Resume this workspace after confirmation.";
}

function createResumeStatusMessage(resumeGate) {
  if (resumeGate.status === "ready_for_precheck") {
    return "Workspace preview is ready. Resume Workspace is available after confirmation. Target: " + resumeGate.restoreTargetMode + ".";
  }

  return "Workspace preview is ready. Resume is blocked until checks are repaired: " + resumeGate.failedChecks.map((check) => check.check).join(", ") + ".";
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

function parseLegacyDetailLines(card) {
  const detail = {};

  for (const child of Array.from(card.children)) {
    const text = child.textContent || "";
    const separatorIndex = text.indexOf(":");
    if (separatorIndex <= 0) continue;

    const key = text.slice(0, separatorIndex).trim();
    const value = text.slice(separatorIndex + 1).trim();
    if (key) detail[key] = value;
  }

  return detail;
}

function createMetricCard(label, value) {
  const metric = document.createElement("div");
  metric.className = "workspace-library-metric-card";

  const strong = document.createElement("strong");
  strong.textContent = value;
  metric.appendChild(strong);

  const span = document.createElement("span");
  span.textContent = label;
  metric.appendChild(span);

  return metric;
}

function createDetailSection(label, value) {
  const section = document.createElement("div");
  section.className = "workspace-library-detail-section";

  const heading = document.createElement("h4");
  heading.textContent = label;
  section.appendChild(heading);

  const body = document.createElement("p");
  body.textContent = value;
  section.appendChild(body);

  return section;
}

function createActionReadinessLine(label, state, detail) {
  const line = document.createElement("p");
  line.className = "workspace-library-action-readiness-line";
  line.textContent = label + ": " + state + " — " + detail;
  return line;
}

function buildGateStatusText(gate) {
  const passed = gate.checks.filter((check) => check.status === "pass").length;
  const failed = gate.failedChecks.length;
  return gate.gateName + ": " + gate.status + " | target: " + gate.restoreTargetMode + " | passed: " + passed + " | failed: " + failed + ".";
}

function createActionButton(id, text, disabled) {
  const button = document.createElement("button");
  button.id = id;
  button.type = "button";
  button.className = "secondary-button";
  button.textContent = text;
  button.disabled = disabled;
  if (disabled) button.title = "Preview a resumable workspace before resuming.";
  return button;
}

function attachWorkspaceLibraryProductLanguageRefresh() {
  const refreshButton = document.getElementById("refreshSavedWorkspacesButton");
  const inspectButton = document.getElementById("inspectSavedWorkspaceButton");
  const select = document.getElementById("savedWorkspaceSelect");

  refreshButton?.addEventListener("click", reapplyWorkspaceLibraryLanguageSoon);
  inspectButton?.addEventListener("click", reapplyWorkspaceLibraryLanguageSoon);
  select?.addEventListener("change", () => {
    setResumeButtonState(null, "Preview the selected workspace before resuming.");
    reapplyWorkspaceLibraryLanguageSoon();
  });
}

function reapplyWorkspaceLibraryLanguageSoon() {
  window.setTimeout(() => {
    const section = document.getElementById("savedWorkspaceRegistrySection");
    if (!section) return;

    renameWorkspaceLibrary(section);
    hideRawInspectionControls();
    hideCleanupControls();
    ensureWorkspaceLibraryViewControls(section);
    ensureWorkspaceLibraryActionSkeleton(section);
    rewriteWorkspaceOptionLabels();
    void refreshWorkspaceLibraryViewState();
    renderStructuredWorkspaceDetail();
  }, 250);
}

function rewriteSummaryText() {
  const summary = document.getElementById("savedWorkspaceRegistrySummary");
  if (!summary) return;

  summary.textContent = summary.textContent
    .replaceAll("Session DB", "saved");
}

function rewriteStatusText() {
  const status = document.getElementById("savedWorkspaceRegistryStatus");
  if (!status) return;

  status.textContent = status.textContent
    .replaceAll("Saved workspace registry", "Workspace Library")
    .replaceAll("Session DB", "saved")
    .replaceAll("inspection packet", "workspace details")
    .replaceAll("Inspected saved workspace", "Viewed saved workspace");
}

function rewriteWorkspaceOptionLabels() {
  const select = document.getElementById("savedWorkspaceSelect");
  if (!select) return;

  for (const option of Array.from(select.options)) {
    option.textContent = option.textContent
      .replaceAll("Session DB", "saved");
  }
}

function getSelectedWorkspaceId() {
  const select = document.getElementById("savedWorkspaceSelect");
  return select?.value || "";
}

function formatTargetMode(targetMode) {
  return targetMode === "dedicated_window" ? "dedicated-window path" : "current-window path";
}

function setLibraryActionStatus(message) {
  const status = document.getElementById("workspaceLibraryActionStatus");
  if (status) status.textContent = message;
}

function setButtonText(id, text) {
  const button = document.getElementById(id);
  if (button) button.textContent = text;
}

function clearElement(element) {
  if (!element) return;

  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function capitalize(value) {
  return String(value || "").charAt(0).toUpperCase() + String(value || "").slice(1);
}
