import { registerDeveloperSurface } from "./developer-mode.js";

installWorkspaceSessionProductSurface();

function installWorkspaceSessionProductSurface() {
  const section = document.getElementById("workspaceSessionControlSection");
  if (!section) return;

  section.dataset.productSurface = "workspace-controls";

  renameWorkspaceSessionControl(section);
  hideWorkspaceSessionPacketControls();
  ensureArchivedWorkspaceActionSkeleton(section);
  attachWorkspaceSessionProductLanguageRefresh();
}

function renameWorkspaceSessionControl(section) {
  const heading = section.querySelector("h2");
  if (heading) heading.textContent = "Workspace Controls";

  const help = section.querySelector(".section-help");
  if (help) {
    help.textContent = "Save, archive, and manage the current workspace without clearing your browser tabs.";
  }

  setButtonText("archiveWorkspaceButton", "Archive Current Workspace");
  setButtonText("archiveAndStartFreshButton", "Archive + Start Fresh Workspace");

  const archiveLabel = document.querySelector("label[for='archiveWorkspaceSelect']");
  if (archiveLabel) archiveLabel.textContent = "Archived Workspaces";

  rewriteWorkspaceSessionSummaryText();
  rewriteWorkspaceSessionStatusText();
}

function hideWorkspaceSessionPacketControls() {
  const activePacketButton = document.getElementById("copyWorkspaceSnapshotButton");
  if (activePacketButton) {
    activePacketButton.textContent = "Copy Active Workspace Packet";
    registerDeveloperSurface(activePacketButton);
  }

  const archivePacketButton = document.getElementById("copySelectedArchiveSnapshotButton");
  if (archivePacketButton) {
    archivePacketButton.textContent = "Copy Selected Archive Packet";
    registerDeveloperSurface(archivePacketButton);
  }
}

function ensureArchivedWorkspaceActionSkeleton(section) {
  if (document.getElementById("workspaceArchiveActionSkeleton")) return;

  const archiveSelect = document.getElementById("archiveWorkspaceSelect");
  if (!archiveSelect) return;

  const panel = document.createElement("div");
  panel.id = "workspaceArchiveActionSkeleton";
  panel.className = "workspace-archive-action-skeleton workspace-session-actions";

  const viewButton = createActionButton("workspaceArchiveViewButton", "View Archive", false);
  const restoreButton = createActionButton("workspaceArchiveRestoreButton", "Restore Archive", true);

  viewButton.addEventListener("click", () => {
    archiveSelect.dispatchEvent(new Event("change"));
    setWorkspaceSessionStatus("Archive details refreshed. Restore is available for the selected archive.");
    reapplyWorkspaceSessionProductLanguageSoon();
  });

  panel.appendChild(viewButton);
  panel.appendChild(restoreButton);

  const archiveBrowser = archiveSelect.closest(".archive-browser-panel") || section;
  const selectedArchiveSummary = document.getElementById("selectedArchiveSummary");
  const anchor = selectedArchiveSummary || archiveBrowser;
  anchor.insertAdjacentElement("afterend", panel);
}

function attachWorkspaceSessionProductLanguageRefresh() {
  const archiveButton = document.getElementById("archiveWorkspaceButton");
  const freshButton = document.getElementById("archiveAndStartFreshButton");
  const archiveSelect = document.getElementById("archiveWorkspaceSelect");

  archiveButton?.addEventListener("click", reapplyWorkspaceSessionProductLanguageSoon);
  freshButton?.addEventListener("click", reapplyWorkspaceSessionProductLanguageSoon);
  archiveSelect?.addEventListener("change", reapplyWorkspaceSessionProductLanguageSoon);
}

function reapplyWorkspaceSessionProductLanguageSoon() {
  window.setTimeout(() => {
    const section = document.getElementById("workspaceSessionControlSection");
    if (!section) return;

    renameWorkspaceSessionControl(section);
    hideWorkspaceSessionPacketControls();
    ensureArchivedWorkspaceActionSkeleton(section);
    rewriteArchiveOptionLabels();
  }, 250);
}

function rewriteWorkspaceSessionSummaryText() {
  const summary = document.getElementById("workspaceSessionSummary");
  if (!summary) return;

  summary.textContent = summary.textContent
    .replaceAll("Active:", "Current workspace:")
    .replaceAll("User notes", "Notes")
    .replaceAll("System events", "Activity")
    .replaceAll("Archived workspaces", "Archives");
}

function rewriteWorkspaceSessionStatusText() {
  const status = document.getElementById("workspaceSessionStatus");
  if (!status) return;

  status.textContent = status.textContent
    .replaceAll("Active workspace packet", "Developer workspace packet")
    .replaceAll("Archive packet", "Developer archive packet")
    .replaceAll("Developer Diagnostics", "developer diagnostics")
    .replaceAll("Restore is defined but not wired yet", "Restore is available for the selected archive");
}

function rewriteArchiveOptionLabels() {
  const archiveSelect = document.getElementById("archiveWorkspaceSelect");
  if (!archiveSelect) return;

  for (const option of Array.from(archiveSelect.options)) {
    option.textContent = option.textContent
      .replaceAll(" | Tabs: ", " · ")
      .replaceAll(" | Events: ", " tabs · ") + (option.textContent.includes("Events:") ? " events" : "");
  }
}

function createActionButton(id, text, disabled) {
  const button = document.createElement("button");
  button.id = id;
  button.type = "button";
  button.className = "secondary-button";
  button.textContent = text;
  button.disabled = disabled;
  if (disabled) button.title = "Defined for the next end-user action slice.";
  return button;
}

function setWorkspaceSessionStatus(message) {
  const status = document.getElementById("workspaceSessionStatus");
  if (status) status.textContent = message;
}

function setButtonText(id, text) {
  const button = document.getElementById(id);
  if (button) button.textContent = text;
}
