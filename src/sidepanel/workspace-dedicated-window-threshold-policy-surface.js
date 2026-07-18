import {
  installValidationSurfaceDebugToggle,
  registerValidationSurface
} from "./sidepanel-debug-mode.js";
import { registerDeveloperSurface } from "./developer-mode.js";

installDedicatedWindowThresholdPolicySurface();

function installDedicatedWindowThresholdPolicySurface() {
  const section = document.getElementById("dedicatedWindowThresholdPolicySection");
  if (!section) return;

  const anchor = document.getElementById("projectionResumeValidationSuiteSection")
    || document.getElementById("projectionResumeRunSection")
    || document.querySelector(".workspace-section");

  installValidationSurfaceDebugToggle(anchor);
  registerDeveloperSurface(section);
  registerValidationSurface(section);
}
