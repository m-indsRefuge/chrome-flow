const REVIEW_TOKEN = "CONFIRM RESUME REVIEW";

installProjectionResumeReview();

function installProjectionResumeReview() {
  if (document.getElementById("projectionResumeReviewSection")) return;

  const anchor = document.getElementById("projectionResumePreflightSection") || document.querySelector(".workspace-section");
  if (!anchor) return;

  const section = document.createElement("section");
  section.id = "projectionResumeReviewSection";
  section.className = "projection-resume-review-section";
  section.innerHTML = `
    <h2>Projection Resume Review</h2>
    <p class="section-help">Prepare a final Operator review packet for the next projection slice. This panel is review-only.</p>
    <div id="projectionResumeReviewSummary" class="workspace-session-summary">Review surface loaded.</div>
    <div class="workspace-session-options">
      <p><strong>Target mode:</strong> new_window only</p>
      <p><strong>Required review token:</strong> ${REVIEW_TOKEN}</p>
      <label for="projectionResumeReviewToken">Type review token</label>
      <input id="projectionResumeReviewToken" type="text" placeholder="CONFIRM RESUME REVIEW" />
      <label class="checkbox-label"><input id="projectionResumeReviewAcknowledgement" type="checkbox" /> I reviewed the workspace, record count, group count, and safety boundary.</label>
    </div>
    <div class="workspace-session-actions">
      <button id="prepareProjectionResumeReviewPacketButton" type="button" class="secondary-button">Prepare Review Packet</button>
      <button id="copyProjectionResumeReviewPacketButton" type="button" class="secondary-button">Copy Review Packet</button>
    </div>
    <p id="projectionResumeReviewStatus" class="status-message"></p>
    <pre id="projectionResumeReviewOutput" class="diagnostics-output">Projection resume review output will appear here.</pre>
  `;

  anchor.insertAdjacentElement("afterend", section);

  document.getElementById("prepareProjectionResumeReviewPacketButton")?.addEventListener("click", preparePacket);
  document.getElementById("copyProjectionResumeReviewPacketButton")?.addEventListener("click", copyPacket);
}

function buildPacket() {
  const tokenMatches = document.getElementById("projectionResumeReviewToken")?.value.trim() === REVIEW_TOKEN;
  const acknowledgementChecked = Boolean(document.getElementById("projectionResumeReviewAcknowledgement")?.checked);
  const readyForNextSlice = tokenMatches && acknowledgementChecked;

  return {
    packetType: "Chrome Flow Projection Resume Review Packet",
    createdAt: new Date().toISOString(),
    extension: {
      name: "Chrome Flow",
      schema: "projection-resume-review-packet-v0.1"
    },
    source: {
      type: "projection_resume_review_surface",
      readOnly: true,
      reviewOnly: true,
      noStateChange: true
    },
    operatorReview: {
      requiredToken: REVIEW_TOKEN,
      tokenMatches,
      acknowledgementChecked,
      operatorConfirmed: readyForNextSlice
    },
    review: {
      status: readyForNextSlice ? "ready_for_next_slice" : "awaiting_operator_confirmation",
      readyForNextSlice,
      availableInThisSlice: false,
      notes: [
        "This packet is review-only.",
        "The next slice must perform its own pre-run checks.",
        "Saved group evidence remains mandatory for clean projection."
      ]
    }
  };
}

function preparePacket() {
  const packet = buildPacket();
  setOutput(packet);
  setStatus("Resume review packet prepared: " + packet.review.status + ".");
}

async function copyPacket() {
  const packet = buildPacket();
  await navigator.clipboard.writeText(JSON.stringify(packet, null, 2));
  setOutput(packet);
  setStatus("Resume review packet copied: " + packet.review.status + ".");
}

function setStatus(message) {
  const status = document.getElementById("projectionResumeReviewStatus");
  if (status) status.textContent = message;
}

function setOutput(value) {
  const output = document.getElementById("projectionResumeReviewOutput");
  if (output) output.textContent = JSON.stringify(value, null, 2);
}
