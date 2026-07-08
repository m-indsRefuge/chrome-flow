import { registerDeveloperSurface } from "./developer-mode.js";

installWorkspaceLibraryProductSurface();

function installWorkspaceLibraryProductSurface() {
  const section = document.getElementById("savedWorkspaceRegistrySection");
  if (!section) return;

  section.dataset.productSurface = "workspace-library";

  renameWorkspaceLibrary(section);
  hideRawInspectionControls();
  hideCleanupControls();
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

  const card = document.getElementById("savedWorkspaceInspectionCard");
  if (card && card.textContent.includes("Select a saved workspace")) {
    card.textContent = "Select a saved workspace and view its details here.";
  }

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

function rewriteSummaryText() {
  const summary = document.getElementById("savedWorkspaceRegistrySummary");
  if (!summary) return;

  summary.textContent = summary.textContent
    .replaceAll("Saved workspaces", "Saved workspaces")
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
    .replaceAll("inspection packet", "workspace details");
}

function setButtonText(id, text) {
  const button = document.getElementById(id);
  if (button) button.textContent = text;
}
