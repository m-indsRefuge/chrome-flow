import { registerDeveloperSurface } from "./developer-mode.js";
import {
  installValidationSurfaceDebugToggle,
  registerValidationSurface
} from "./sidepanel-debug-mode.js";
import {
  buildAutomaticPromotionValidationPacket,
  formatManualScenarioChecklist
} from "./workspace-automatic-promotion-validation-contract.js";

installAutomaticPromotionValidationSurface();

function installAutomaticPromotionValidationSurface() {
  if (document.getElementById("automaticPromotionLiveValidationSection")) return;
  const anchor = document.getElementById("dedicatedWindowThresholdPolicySection") || document.querySelector(".workspace-section");
  if (!anchor) return;
  const section = document.createElement("section");
  section.id = "automaticPromotionLiveValidationSection";
  section.className = "automatic-promotion-live-validation-section";
  section.innerHTML = `
    <h2>Automatic Promotion Live Validation</h2>
    <div class="historical-validation-banner" role="note">
      <strong>Operator-controlled manual validation only.</strong>
      <span>This surface prepares evidence templates and performs no browser or workspace mutation.</span>
      <span>No live Chrome result is claimed until Nolan records an observation.</span>
    </div>
    <p class="section-help">Use the copyable scenario matrix after separately authorizing a live Chrome validation run. Stop on any unexpected window, tab, group, assignment, placement, or storage mutation.</p>
    <div class="workspace-session-actions">
      <button id="copyAutomaticPromotionScenarioChecklistButton" type="button" class="secondary-button">Copy Manual Scenario Checklist</button>
      <button id="prepareAutomaticPromotionEvidencePacketButton" type="button" class="secondary-button">Prepare Empty Evidence Packet</button>
      <button id="copyAutomaticPromotionEvidencePacketButton" type="button" class="secondary-button">Copy Evidence Packet</button>
    </div>
    <p id="automaticPromotionLiveValidationStatus" class="status-message">No live validation has been run.</p>
    <pre id="automaticPromotionLiveValidationOutput" class="diagnostics-output">Prepare an empty evidence packet or copy the manual checklist.</pre>
  `;
  anchor.insertAdjacentElement("afterend", section);
  installValidationSurfaceDebugToggle(anchor);
  registerDeveloperSurface(section);
  registerValidationSurface(section);
  let lastPacket = null;

  document.getElementById("copyAutomaticPromotionScenarioChecklistButton")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(formatManualScenarioChecklist());
    setStatus("Manual scenario checklist copied. No scenario was executed.");
  });
  document.getElementById("prepareAutomaticPromotionEvidencePacketButton")?.addEventListener("click", () => {
    lastPacket = buildAutomaticPromotionValidationPacket({ createdAt: new Date().toISOString() });
    setOutput(lastPacket);
    setStatus("Empty evidence packet prepared. Live Chrome has not been run.");
  });
  document.getElementById("copyAutomaticPromotionEvidencePacketButton")?.addEventListener("click", async () => {
    lastPacket ||= buildAutomaticPromotionValidationPacket({ createdAt: new Date().toISOString() });
    await navigator.clipboard.writeText(JSON.stringify(lastPacket, null, 2));
    setOutput(lastPacket);
    setStatus("Empty evidence packet copied. Live Chrome has not been run.");
  });
}

function setStatus(message) {
  const status = document.getElementById("automaticPromotionLiveValidationStatus");
  if (status) status.textContent = message;
}
function setOutput(value) {
  const output = document.getElementById("automaticPromotionLiveValidationOutput");
  if (output) output.textContent = JSON.stringify(value, null, 2);
}
