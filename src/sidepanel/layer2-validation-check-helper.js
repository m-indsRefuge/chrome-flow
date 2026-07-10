const DEFAULT_LAYER2_VALIDATION_SEVERITY = "layer2_1g_legacy_cleanup";

installLayer2ValidationCheckHelper();

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
