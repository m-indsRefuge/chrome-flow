import {
  installValidationSurfaceDebugToggle,
  registerValidationSurface
} from "./sidepanel-debug-mode.js";

installProjectionResumeValidationSuiteValidationSurface();

function installProjectionResumeValidationSuiteValidationSurface() {
  const section = document.getElementById("projectionResumeValidationSuiteSection");
  if (!section) return;

  const anchor = document.getElementById("projectionResumeRunSection")
    || document.getElementById("projectionResumeReviewSection")
    || document.querySelector(".workspace-section");

  installValidationSurfaceDebugToggle(anchor);
  registerValidationSurface(section);
}
