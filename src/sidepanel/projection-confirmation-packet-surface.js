import {
  installValidationSurfaceDebugToggle,
  registerValidationSurface
} from "./sidepanel-debug-mode.js";

installProjectionConfirmationPacketSurface();

function installProjectionConfirmationPacketSurface() {
  const section = document.getElementById("projectionConfirmationPacketSection");
  if (!section) return;

  const anchor = document.getElementById("projectionPlanPreviewSection")
    || document.getElementById("runtimeProjectionReadinessSection")
    || document.querySelector(".workspace-section");

  installValidationSurfaceDebugToggle(anchor);
  registerValidationSurface(section);
}
