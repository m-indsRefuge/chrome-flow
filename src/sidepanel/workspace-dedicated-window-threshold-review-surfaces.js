import {
  installValidationSurfaceDebugToggle,
  registerValidationSurface
} from "./sidepanel-debug-mode.js";

const THRESHOLD_REVIEW_SURFACE_IDS = [
  "dedicatedWindowThresholdValidationSuiteSection",
  "dedicatedWindowThresholdPreflightSection",
  "dedicatedWindowThresholdPreflightValidationSuiteSection",
  "dedicatedWindowThresholdReviewSection",
  "dedicatedWindowThresholdReviewValidationSuiteSection",
  "workspaceControlPreflightMigrationValidationSuiteSection",
  "workspaceControlReviewMigrationValidationSuiteSection"
];

installDedicatedWindowThresholdReviewSurfaces();

function installDedicatedWindowThresholdReviewSurfaces() {
  const sections = THRESHOLD_REVIEW_SURFACE_IDS
    .map((id) => document.getElementById(id))
    .filter(Boolean);

  if (!sections.length) return;

  const anchor = document.getElementById("dedicatedWindowThresholdPolicySection")
    || document.getElementById("projectionResumeValidationSuiteSection")
    || document.querySelector(".workspace-section");

  installValidationSurfaceDebugToggle(anchor);

  for (const section of sections) {
    registerValidationSurface(section);
  }
}
