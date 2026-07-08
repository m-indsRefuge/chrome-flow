import {
  installValidationSurfaceDebugToggle,
  registerValidationSurface
} from "./sidepanel-debug-mode.js";

installProjectionPlanPreviewSurface();

function installProjectionPlanPreviewSurface() {
  const section = document.getElementById("projectionPlanPreviewSection");
  if (!section) return;

  const anchor = document.getElementById("runtimeProjectionReadinessSection")
    || document.getElementById("savedWorkspaceRegistrySection")
    || document.querySelector(".workspace-section");

  installValidationSurfaceDebugToggle(anchor);
  registerValidationSurface(section);
}
