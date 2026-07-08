import { registerDeveloperSurface } from "./developer-mode.js";

installWorkspaceLibraryProductSurface();

function installWorkspaceLibraryProductSurface() {
  const section = document.getElementById("savedWorkspaceRegistrySection");
  if (!section) return;

  section.dataset.productSurface = "workspace-library";

  renameWorkspaceLibrary(section);
  hideRawInspectionControls();
  hideCleanupControls();
  ensureWorkspaceLibraryActionSkeleton(section);
  renderWorkspaceLibraryEmptyState();
  attachWorkspaceLibraryProductLanguageRefresh();
}

function renameWorkspaceLibrary(section) {
  const heading = section.querySelector("h2");
  if (heading) heading.textContent = "Workspace Library";

  const help = section.querySelector(".section-help");
  if (help) {
    help.textContent = "Review saved workspaces without reopening tabs or changing your current browser workspace.";
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
  const archiveButton = createActionButton("workspaceLibraryArchiveButton", "Archive Workspace", true);

  previewButton.addEventListener("click", () => {
    document.getElementById("inspectSavedWorkspaceButton")?.click();
    setLibraryActionStatus("Preview loaded. Resume and Archive actions will be wired in the next end-user action slice.");
  });

  panel.appendChild(previewButton);
  panel.appendChild(resumeButton);
  panel.appendChild(archiveButton);

  const actionStatus = document.createElement("p");
  actionStatus.id = "workspaceLibraryActionStatus";
  actionStatus.className = "status-message";
  actionStatus.textContent = "Preview is available. Resume and Archive are defined but not wired yet.";

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

  setLibraryActionStatus("Workspace preview is ready. Resume and Archive are still intentionally disabled until their gates are wired into product actions.");
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

function createActionButton(id, text, disabled) {
  const button = document.createElement("button");
  button.id = id;
  button.type = "button";
  button.className = disabled ? "secondary-button" : "secondary-button";
  button.textContent = text;
  button.disabled = disabled;
  if (disabled) button.title = "Defined for the next end-user action slice.";
  return button;
}

function attachWorkspaceLibraryProductLanguageRefresh() {
  const refreshButton = document.getElementById("refreshSavedWorkspacesButton");
  const inspectButton = document.getElementById("inspectSavedWorkspaceButton");
  const select = document.getElementById("savedWorkspaceSelect");

  refreshButton?.addEventListener("click", reapplyWorkspaceLibraryLanguageSoon);
  inspectButton?.addEventListener("click", reapplyWorkspaceLibraryLanguageSoon);
  select?.addEventListener("change", reapplyWorkspaceLibraryLanguageSoon);
}

function reapplyWorkspaceLibraryLanguageSoon() {
  window.setTimeout(() => {
    const section = document.getElementById("savedWorkspaceRegistrySection");
    if (!section) return;

    renameWorkspaceLibrary(section);
    hideRawInspectionControls();
    hideCleanupControls();
    ensureWorkspaceLibraryActionSkeleton(section);
    rewriteWorkspaceOptionLabels();
    renderStructuredWorkspaceDetail();
  }, 250);
}

function rewriteSummaryText() {
  const summary = document.getElementById("savedWorkspaceRegistrySummary");
  if (!summary) return;

  summary.textContent = summary.textContent
    .replaceAll("Active DB records", "Active records")
    .replaceAll("Active DB workspace", "Active saved workspace")
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
      .replaceAll(" [active DB]", " [active saved]")
      .replaceAll("Session DB", "saved");
  }
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
