import {
  installValidationSurfaceDebugToggle,
  registerValidationSurface
} from "./sidepanel-debug-mode.js";

const thresholdPrefix = "dedicatedWindowThreshold";
const workspaceControlPrefix = "workspaceControl";
const THRESHOLD_RUN_SURFACE_IDS = [
  thresholdPrefix + "ExecutionSection",
  thresholdPrefix + "ExecutionValidationSuiteSection",
  workspaceControlPrefix + "ExecutionGateValidationSuiteSection"
];

installDedicatedWindowThresholdRunSurfaces();

function installDedicatedWindowThresholdRunSurfaces() {
  const sections = THRESHOLD_RUN_SURFACE_IDS
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
