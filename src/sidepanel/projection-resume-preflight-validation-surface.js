import {
  installValidationSurfaceDebugToggle,
  registerValidationSurface
} from "./sidepanel-debug-mode.js";

installProjectionResumePreflightValidationSurface();

function installProjectionResumePreflightValidationSurface() {
  const section = document.getElementById("projectionResumePreflightSection");
  if (!section) return;

  const anchor = document.getElementById("projectionConfirmationPacketSection")
    || document.getElementById("projectionPlanPreviewSection")
    || document.querySelector(".workspace-section");

  installValidationSurfaceDebugToggle(anchor);
  registerValidationSurface(section);
}
