import {
  installValidationSurfaceDebugToggle,
  registerValidationSurface
} from "./sidepanel-debug-mode.js";

installProjectionResumeReviewSurface();

function installProjectionResumeReviewSurface() {
  const section = document.getElementById("projectionResumeReviewSection");
  if (!section) return;

  const anchor = document.getElementById("projectionResumePreflightSection")
    || document.querySelector(".workspace-section");

  installValidationSurfaceDebugToggle(anchor);
  registerValidationSurface(section);
}
