import {
  DEVELOPER_MODE_CHANGED_EVENT,
  isDeveloperModeEnabled
} from "./developer-mode.js";

const VALIDATION_MODE_STORAGE_KEY = "chromeFlowValidationSurfacesVisible";
const VALIDATION_MODE_QUERY_PARAM = "chromeFlowValidation";

function isValidationSurfaceDebugModeEnabled() {
  return isDeveloperModeEnabled()
    && (readValidationModeFromQuery() || readValidationModeFromStorage() || document.body?.dataset?.chromeFlowValidationMode === "true");
}

function registerValidationSurface(section) {
  if (!section) return section;
  section.dataset.validationSurface = "true";
  applyValidationSurfaceVisibility(section, isValidationSurfaceDebugModeEnabled());
  return section;
}

function installValidationSurfaceDebugToggle(anchor) {
  if (document.getElementById("validationSurfaceDebugModeSection")) {
    refreshValidationSurfaceVisibility();
    return;
  }

  const safeAnchor = anchor || document.querySelector(".workspace-section") || document.body;
  if (!safeAnchor) return;

  const section = document.createElement("section");
  section.id = "validationSurfaceDebugModeSection";
  section.className = "validation-surface-debug-mode-section";
  section.innerHTML = `
    <h2>Validation Surfaces</h2>
    <p class="section-help">Show or hide internal validation panels. Product/runtime surfaces remain available either way.</p>
    <div id="validationSurfaceDebugModeSummary" class="workspace-session-summary">Validation surfaces are hidden by default.</div>
    <div class="workspace-session-actions">
      <button id="toggleValidationSurfaceDebugModeButton" type="button" class="secondary-button">Show Validation Surfaces</button>
    </div>
  `;

  safeAnchor.insertAdjacentElement("afterend", section);
  document.getElementById("toggleValidationSurfaceDebugModeButton")?.addEventListener("click", toggleValidationSurfaceDebugMode);
  window.addEventListener(DEVELOPER_MODE_CHANGED_EVENT, refreshValidationSurfaceVisibility);
  refreshValidationSurfaceVisibility();
}

function toggleValidationSurfaceDebugMode() {
  if (!isDeveloperModeEnabled()) return;
  setValidationSurfaceDebugModeEnabled(!isValidationSurfaceDebugModeEnabled());
}

function setValidationSurfaceDebugModeEnabled(enabled) {
  try {
    window.localStorage?.setItem(VALIDATION_MODE_STORAGE_KEY, enabled ? "true" : "false");
  } catch (_error) {
    document.body.dataset.chromeFlowValidationMode = enabled ? "true" : "false";
  }
  document.body.dataset.chromeFlowValidationMode = enabled ? "true" : "false";
  refreshValidationSurfaceVisibility();
}

function refreshValidationSurfaceVisibility() {
  const developerModeEnabled = isDeveloperModeEnabled();
  const enabled = isValidationSurfaceDebugModeEnabled();

  document.querySelectorAll("[data-validation-surface='true']").forEach((section) => applyValidationSurfaceVisibility(section, enabled));

  const section = document.getElementById("validationSurfaceDebugModeSection");
  if (section) {
    section.hidden = !developerModeEnabled;
    section.setAttribute("aria-hidden", developerModeEnabled ? "false" : "true");
  }

  const summary = document.getElementById("validationSurfaceDebugModeSummary");
  if (summary) summary.textContent = enabled ? "Validation surfaces are visible." : "Validation surfaces are hidden.";

  const button = document.getElementById("toggleValidationSurfaceDebugModeButton");
  if (button) button.textContent = enabled ? "Hide Validation Surfaces" : "Show Validation Surfaces";
}

function applyValidationSurfaceVisibility(section, enabled) {
  section.hidden = !enabled;
  section.setAttribute("aria-hidden", enabled ? "false" : "true");
}

function readValidationModeFromQuery() {
  try {
    return new URLSearchParams(window.location.search).get(VALIDATION_MODE_QUERY_PARAM) === "1";
  } catch (_error) {
    return false;
  }
}

function readValidationModeFromStorage() {
  try {
    return window.localStorage?.getItem(VALIDATION_MODE_STORAGE_KEY) === "true";
  } catch (_error) {
    return false;
  }
}

export {
  installValidationSurfaceDebugToggle,
  isValidationSurfaceDebugModeEnabled,
  refreshValidationSurfaceVisibility,
  registerValidationSurface,
  setValidationSurfaceDebugModeEnabled
};
