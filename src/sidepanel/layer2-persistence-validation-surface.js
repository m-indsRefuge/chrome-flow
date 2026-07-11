import {
  installValidationSurfaceDebugToggle,
  registerValidationSurface
} from "./sidepanel-debug-mode.js";

installLayer2PersistenceValidationSurface();

function installLayer2PersistenceValidationSurface() {
  const section = document.getElementById("layer2PersistenceValidationSection");
  if (!section) return;

  const anchor = document.getElementById("savedWorkspaceRegistrySection")
    || document.getElementById("sessionDbDiagnosticsSection")
    || document.querySelector(".workspace-section");

  installValidationSurfaceDebugToggle(anchor);
  registerValidationSurface(section);
}
