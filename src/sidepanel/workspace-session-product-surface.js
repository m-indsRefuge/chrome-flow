import { registerDeveloperSurface } from "./developer-mode.js";
import "./diagnostic-ring-reconciler.js";
import "./workspace-archive-close-ownership-controller.js";
import "./layer2-archive-close-ownership-validation.js";
import "./legacy-archive-projection-cleanup.js";
import "./layer2-legacy-archive-projection-validation.js";
import "./layer2-hardening-regression-evidence-guard.js";
import "./layer2-hardening-regression-harness.js";
import "./layer2-hardening-correlation-completeness.js";

installWorkspaceSessionProductSurface();

function installWorkspaceSessionProductSurface() {
  const section = document.getElementById("workspaceSessionControlSection");
  if (!section) return;

  section.dataset.productSurface = "current-workspace-actions";

  composeCurrentWorkspaceSurface(section);
  renameWorkspaceSessionControl(section);
  hideWorkspaceSessionPacketControls();
  demoteLegacyArchiveBrowserToDeveloperSurface(section);
  ensureArchivedWorkspaceActionSkeleton(section);
  attachWorkspaceSessionProductLanguageRefresh();
}

function composeCurrentWorkspaceSurface(section) {
  const currentWorkspaceSection = document.querySelector(".workspace-section");
  if (!currentWorkspaceSection) return;

  currentWorkspaceSection.dataset.productSurface = "current-workspace";
  currentWorkspaceSection.classList.add("current-workspace-section");
  ensureCurrentWorkspaceHeading(currentWorkspaceSection);

  if (section.parentElement !== currentWorkspaceSection) {
    currentWorkspaceSection.appendChild(section);
  }
}

function ensureCurrentWorkspaceHeading(currentWorkspaceSection) {
  if (document.getElementById("currentWorkspaceHeading")) return;

  const heading = document.createElement("h2");
  heading.id = "currentWorkspaceHeading";
  heading.textContent = "Current Workspace";
  currentWorkspaceSection.insertAdjacentElement("afterbegin", heading);

  const help = document.createElement("p");
  help.id = "currentWorkspaceHelp";
  help.className = "section-help";
  help.textContent = "Name, describe, save, pause, or archive the workspace you are actively using.";
  heading.insertAdjacentElement("afterend", help);
}

function renameWorkspaceSessionControl(section) {
  const heading = section.querySelector("h2");
  if (heading) heading.textContent = "Current Workspace Actions";

  const help = section.querySelector(".section-help");
  if (help) {
    help.textContent = "Pause or archive the active workspace. Saved workspaces are resumed from the Workspace Library.";
  }

  setButtonText("archiveWorkspaceButton", "Archive Current Workspace");
  setButtonText("archiveAndStartFreshButton", "Archive + Start Fresh Workspace");

  const archiveLabel = document.querySelector("label[for='archiveWorkspaceSelect']");
  if (archiveLabel) archiveLabel.textContent = "Legacy Archive Restore";

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

function demoteLegacyArchiveBrowserToDeveloperSurface(section) {
  const archiveBrowser = section.querySelector(".archive-browser-panel");
  if (!archiveBrowser) return;

  archiveBrowser.dataset.legacyArchiveRestoreSurface = "true";
  registerDeveloperSurface(archiveBrowser);
}

function ensureArchivedWorkspaceActionSkeleton(section) {
  if (document.getElementById("workspaceArchiveActionSkeleton")) return;

  const archiveSelect = document.getElementById("archiveWorkspaceSelect");
  if (!archiveSelect) return;

  const panel = document.createElement("div");
  panel.id = "workspaceArchiveActionSkeleton";
  panel.className = "workspace-archive-action-skeleton workspace-session-actions";
  panel.dataset.legacyArchiveRestoreActions = "true";

  const viewButton = createActionButton("workspaceArchiveViewButton", "View Legacy Archive", false);
  const restoreButton = createActionButton("workspaceArchiveRestoreButton", "Restore Legacy Archive", true);

  viewButton.addEventListener("click", () => {
    archiveSelect.dispatchEvent(new Event("change"));
    setWorkspaceSessionStatus("Legacy archive details refreshed. Unified Resume will live in Workspace Library.");
    reapplyWorkspaceSessionProductLanguageSoon();
  });

  panel.appendChild(viewButton);
  panel.appendChild(restoreButton);

  const archiveBrowser = archiveSelect.closest(".archive-browser-panel") || section;
  const selectedArchiveSummary = document.getElementById("selectedArchiveSummary");
  const anchor = selectedArchiveSummary || archiveBrowser;
  anchor.insertAdjacentElement("afterend", panel);
  registerDeveloperSurface(panel);
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

    composeCurrentWorkspaceSurface(section);
    renameWorkspaceSessionControl(section);
    hideWorkspaceSessionPacketControls();
    demoteLegacyArchiveBrowserToDeveloperSurface(section);
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
    .replaceAll("Restore is defined but not wired yet", "Restore is available for the selected archive")
    .replaceAll("Archive details refreshed. Restore is available for the selected archive.", "Legacy archive details refreshed. Unified Resume will live in Workspace Library.");
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
  if (disabled) button.title = "Legacy restore remains available in Developer Mode until unified Resume is connected.";
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
