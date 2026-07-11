import {
  installValidationSurfaceDebugToggle,
  registerValidationSurface
} from "./sidepanel-debug-mode.js";

installProjectionResumeRunSurface();

function installProjectionResumeRunSurface() {
  const section = document.getElementById("projectionResumeRunSection");
  if (!section) return;

  const anchor = document.getElementById("projectionResumeReviewSection")
    || document.querySelector(".workspace-section");

  installValidationSurfaceDebugToggle(anchor);
  registerValidationSurface(section);
}
