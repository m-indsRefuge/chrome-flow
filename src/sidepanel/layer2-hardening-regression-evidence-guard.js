const EVIDENCE_KEY = "chromeFlowLayer21HRegressionEvidence";
const RUN_BUTTON_ID = "runLayer2HardeningRegressionHarnessButton";
const GUARD_READY_ATTRIBUTE = "data-layer2-hardening-evidence-cleared";

document.addEventListener("click", interceptRegressionRun, true);

async function interceptRegressionRun(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const button = target.closest("button");
  if (!button || button.id !== RUN_BUTTON_ID) return;

  if (button.getAttribute(GUARD_READY_ATTRIBUTE) === "true") {
    button.removeAttribute(GUARD_READY_ATTRIBUTE);
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  button.disabled = true;

  try {
    await chrome.storage.local.remove(EVIDENCE_KEY);
    const output = document.getElementById("layer2HardeningRegressionHarnessOutput");
    const copyButton = document.getElementById("copyLayer2HardeningRegressionPacketButton");
    if (output) output.textContent = "";
    if (copyButton) copyButton.disabled = true;

    button.setAttribute(GUARD_READY_ATTRIBUTE, "true");
    button.disabled = false;
    button.click();
  } catch (error) {
    button.disabled = false;
    const status = document.getElementById("layer2HardeningRegressionHarnessStatus");
    if (status) status.textContent = "Could not clear previous hardening evidence. The regression suite was not started.";
    console.warn("Chrome Flow hardening evidence guard failed:", error);
  }
}
