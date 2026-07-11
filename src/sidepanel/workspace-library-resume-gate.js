const DEDICATED_WINDOW_THRESHOLD_TAB_COUNT = 4;

function evaluateSavedWorkspaceResumeGate(detail = {}) {
  const tabCount = Number(detail.Tabs || 0);
  const lifecycle = normalizeText(detail.Lifecycle || "");
  const projection = normalizeText(detail.Projection || "");
  const summary = normalizeText(detail.Summary || "");
  const continuation = normalizeText(detail.Continuation || "");
  const restoreTargetMode = determineSavedWorkspaceResumeTargetMode(tabCount, projection, summary, continuation);
  const checks = [
    createGateCheck("saved_workspace_selected", Boolean(detail.Workspace), "A saved workspace is selected."),
    createGateCheck("saved_workspace_has_tabs", tabCount > 0, "The saved workspace contains one or more tab records."),
    createGateCheck("saved_workspace_lifecycle_paused", lifecycle.includes("paused") || lifecycle.includes("dehydrated"), "The saved workspace is paused/dehydrated rather than an active runtime replacement."),
    createGateCheck("resume_target_mode_resolved", restoreTargetMode === "current_window" || restoreTargetMode === "dedicated_window", "The resume target mode can be resolved from saved workspace evidence."),
    createGateCheck("operator_confirmation_required", true, "Resume must require Operator confirmation before live browser action."),
    createGateCheck("post_action_verification_required", true, "Resume must be followed by post-action verification.")
  ];

  const failedChecks = checks.filter((check) => check.status === "fail");
  const status = failedChecks.length ? "blocked" : "ready_for_precheck";

  return {
    gateName: "saved_workspace_resume_gate",
    status,
    restoreTargetMode,
    tabCount,
    lifecycle: detail.Lifecycle || "unknown",
    projection: detail.Projection || "unknown",
    checks,
    failedChecks,
    nextSteps: status === "ready_for_precheck" ? [
      "Run saved workspace resume precheck.",
      "Show Operator confirmation with target mode and tab count.",
      "Execute resume only after confirmation.",
      "Verify reopened tabs, groups, labels, and target window policy."
    ] : [
      "Repair failed resume gate checks before enabling resume."
    ]
  };
}

function determineSavedWorkspaceResumeTargetMode(tabCount, projection, summary, continuation) {
  const evidenceText = [projection, summary, continuation].join(" ");

  if (tabCount >= DEDICATED_WINDOW_THRESHOLD_TAB_COUNT) return "dedicated_window";
  if (evidenceText.includes("dedicated")) return "dedicated_window";
  if (evidenceText.includes("new window")) return "dedicated_window";
  return "current_window";
}

function createGateCheck(check, condition, message) {
  return {
    check,
    status: condition ? "pass" : "fail",
    message
  };
}

function normalizeText(value) {
  return String(value || "").toLowerCase();
}

function formatSavedWorkspaceResumeGateForUser(gate) {
  const target = gate.restoreTargetMode === "dedicated_window" ? "dedicated-window resume path" : "current-window resume path";

  if (gate.status === "ready_for_precheck") {
    return "Preview is safe now. Resume will use the " + target + " after precheck, Operator confirmation, execution, and verification. Lifecycle: " + gate.lifecycle + ".";
  }

  const failed = gate.failedChecks.map((check) => check.check).join(", ") || "unknown";
  return "Resume is blocked until these checks are repaired: " + failed + ".";
}

export {
  DEDICATED_WINDOW_THRESHOLD_TAB_COUNT,
  evaluateSavedWorkspaceResumeGate,
  formatSavedWorkspaceResumeGateForUser
};
