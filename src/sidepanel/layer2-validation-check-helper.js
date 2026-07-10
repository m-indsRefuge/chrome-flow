const DEFAULT_LAYER2_VALIDATION_SEVERITY = "layer2_1g_legacy_cleanup";
const LEGACY_VALIDATION_FILE_MARKER = "layer2-legacy-archive-projection-validation.js";

installLayer2ValidationCheckHelper();
installLegacyValidationFailureBoundary();

function installLayer2ValidationCheckHelper() {
  if (typeof globalThis.createCheck === "function") return;

  globalThis.createCheck = function createCheck(
    check,
    condition,
    message,
    severity = DEFAULT_LAYER2_VALIDATION_SEVERITY
  ) {
    return {
      check,
      status: condition ? "pass" : severity === "warning" ? "warn" : "fail",
      severity,
      message
    };
  };
}

function installLegacyValidationFailureBoundary() {
  if (!globalThis.window?.addEventListener) return;

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event?.reason;
    const stack = typeof reason?.stack === "string" ? reason.stack : "";
    if (!stack.includes(LEGACY_VALIDATION_FILE_MARKER)) return;

    const status = document.getElementById("layer2LegacyProjectionCleanupStatus");
    const copyButton = document.getElementById("copyLayer2LegacyProjectionCleanupPacketButton");
    if (copyButton) copyButton.disabled = true;
    if (status) {
      status.textContent = "Could not prepare the legacy cleanup packet. Inspect Developer Diagnostics.";
    }
  });
}
