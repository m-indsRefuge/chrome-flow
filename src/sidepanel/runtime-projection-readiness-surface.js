import {
  installValidationSurfaceDebugToggle,
  registerValidationSurface
} from "./sidepanel-debug-mode.js";

installRuntimeProjectionReadinessSurface();

function installRuntimeProjectionReadinessSurface() {
  const section = document.getElementById("runtimeProjectionReadinessSection");
  if (!section) return;

  const anchor = document.getElementById("layer2PersistenceValidationSection")
    || document.getElementById("savedWorkspaceRegistrySection")
    || document.querySelector(".workspace-section");

  installValidationSurfaceDebugToggle(anchor);
  registerValidationSurface(section);
}
