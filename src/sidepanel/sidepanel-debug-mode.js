const VALIDATION_MODE_STORAGE_KEY = "chromeFlowValidationSurfacesVisible";
const VALIDATION_MODE_QUERY_PARAM = "chromeFlowValidation";
const VALIDATION_SURFACE_SELECTOR = [
  "[data-validation-surface='true']",
  "section[id*='ValidationSuite']",
  "section[class*='validation-suite']"
].join(", ");

let validationSurfaceObserver = null;

function isValidationSurfaceDebugModeEnabled() {
  return readValidationModeFromQuery() || readValidationModeFromStorage() || document.body?.dataset?.chromeFlowValidationMode === "true";
}

function registerValidationSurface(section) {
  if (!section) return section;
  section.dataset.validationSurface = "true";
  applyValidationSurfaceVisibility(section, isValidationSurfaceDebugModeEnabled());
  return section;
}

function installValidationSurfaceDebugToggle(anchor) {
  if (document.getElementById("validationSurfaceDebugModeSection")) {
    ensureValidationSurfaceObserver();
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
  ensureValidationSurfaceObserver();
  refreshValidationSurfaceVisibility();
}

function toggleValidationSurfaceDebugMode() {
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
  const enabled = isValidationSurfaceDebugModeEnabled();
  getValidationSurfaces().forEach((section) => applyValidationSurfaceVisibility(section, enabled));
  const summary = document.getElementById("validationSurfaceDebugModeSummary");
  if (summary) summary.textContent = enabled ? "Validation surfaces are visible." : "Validation surfaces are hidden.";
  const button = document.getElementById("toggleValidationSurfaceDebugModeButton");
  if (button) button.textContent = enabled ? "Hide Validation Surfaces" : "Show Validation Surfaces";
}

function getValidationSurfaces() {
  return Array.from(document.querySelectorAll(VALIDATION_SURFACE_SELECTOR)).filter((section) => section.id !== "validationSurfaceDebugModeSection");
}

function applyValidationSurfaceVisibility(section, enabled) {
  section.dataset.validationSurface = "true";
  section.hidden = !enabled;
  section.setAttribute("aria-hidden", enabled ? "false" : "true");
}

function ensureValidationSurfaceObserver() {
  if (validationSurfaceObserver || !document.body) return;
  validationSurfaceObserver = new MutationObserver((mutations) => {
    if (!mutations.some((mutation) => mutation.addedNodes?.length)) return;
    refreshValidationSurfaceVisibility();
  });
  validationSurfaceObserver.observe(document.body, { childList: true, subtree: true });
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
