const DEVELOPER_MODE_STORAGE_KEY = "chromeFlowDeveloperModeEnabled";
const DEVELOPER_MODE_QUERY_PARAM = "chromeFlowDeveloperMode";
const DEVELOPER_MODE_CHANGED_EVENT = "chrome-flow-developer-mode-changed";

installDeveloperModeGate();

function isDeveloperModeEnabled() {
  return readDeveloperModeFromQuery()
    || readDeveloperModeFromStorage()
    || document.body?.dataset?.chromeFlowDeveloperMode === "true";
}

function registerDeveloperSurface(section) {
  if (!section) return section;
  section.dataset.developerSurface = "true";
  applyDeveloperSurfaceVisibility(section, isDeveloperModeEnabled());
  return section;
}

function installDeveloperModeGate(anchor) {
  if (document.getElementById("developerModeGateSection")) {
    refreshDeveloperModeGate();
    return;
  }

  const safeAnchor = anchor || document.querySelector(".workspace-section") || document.body;
  if (!safeAnchor) return;

  const section = document.createElement("section");
  section.id = "developerModeGateSection";
  section.className = "developer-mode-gate-section";
  section.innerHTML = `
    <h2>Developer Mode</h2>
    <p class="section-help">Developer mode reveals internal diagnostics, validation surfaces, and migration tools. Keep it off for normal workspace use.</p>
    <div id="developerModeGateSummary" class="workspace-session-summary">Developer mode is off.</div>
    <div class="workspace-session-actions">
      <button id="toggleDeveloperModeButton" type="button" class="secondary-button">Enable Developer Mode</button>
    </div>
  `;

  safeAnchor.insertAdjacentElement("afterend", section);
  document.getElementById("toggleDeveloperModeButton")?.addEventListener("click", toggleDeveloperMode);
  refreshDeveloperModeGate();
}

function toggleDeveloperMode() {
  setDeveloperModeEnabled(!isDeveloperModeEnabled());
}

function setDeveloperModeEnabled(enabled) {
  try {
    window.localStorage?.setItem(DEVELOPER_MODE_STORAGE_KEY, enabled ? "true" : "false");
  } catch (_error) {
    document.body.dataset.chromeFlowDeveloperMode = enabled ? "true" : "false";
  }

  document.body.dataset.chromeFlowDeveloperMode = enabled ? "true" : "false";
  refreshDeveloperModeGate();
  window.dispatchEvent(new CustomEvent(DEVELOPER_MODE_CHANGED_EVENT, { detail: { enabled } }));
}

function refreshDeveloperModeGate() {
  const enabled = isDeveloperModeEnabled();
  document.querySelectorAll("[data-developer-surface='true']").forEach((section) => applyDeveloperSurfaceVisibility(section, enabled));

  const summary = document.getElementById("developerModeGateSummary");
  if (summary) summary.textContent = enabled ? "Developer mode is on." : "Developer mode is off.";

  const button = document.getElementById("toggleDeveloperModeButton");
  if (button) button.textContent = enabled ? "Disable Developer Mode" : "Enable Developer Mode";
}

function applyDeveloperSurfaceVisibility(section, enabled) {
  section.hidden = !enabled;
  section.setAttribute("aria-hidden", enabled ? "false" : "true");
}

function readDeveloperModeFromQuery() {
  try {
    return new URLSearchParams(window.location.search).get(DEVELOPER_MODE_QUERY_PARAM) === "1";
  } catch (_error) {
    return false;
  }
}

function readDeveloperModeFromStorage() {
  try {
    return window.localStorage?.getItem(DEVELOPER_MODE_STORAGE_KEY) === "true";
  } catch (_error) {
    return false;
  }
}

export {
  DEVELOPER_MODE_CHANGED_EVENT,
  installDeveloperModeGate,
  isDeveloperModeEnabled,
  refreshDeveloperModeGate,
  registerDeveloperSurface,
  setDeveloperModeEnabled
};
