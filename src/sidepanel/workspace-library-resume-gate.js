const DEDICATED_WINDOW_THRESHOLD_TAB_COUNT = 4;

const RESUMABLE_LIFECYCLES = Object.freeze([
  "paused",
  "archived",
  "dehydrated"
]);

const RESUMABLE_PROJECTION_STATES = Object.freeze([
  "dehydrated",
  "paused",
  "archived",
  "none",
  "missing",
  "blank"
]);

function evaluateSavedWorkspaceResumeGate(detail = {}) {
  const snapshot = snapshotGateDetail(detail);
  const tabCount = normalizeTabCount(snapshot.Tabs);
  const normalizedLifecycle = normalizeLifecycle(snapshot.Lifecycle);
  const normalizedProjectionState = normalizeProjectionState(snapshot.Projection);
  const restoreTargetMode = determineSavedWorkspaceResumeTargetMode(tabCount);
  const checks = [
    createGateCheck(
      "saved_workspace_selected",
      normalizeWorkspaceName(snapshot.Workspace).length > 0,
      "Select a saved workspace before resuming."
    ),
    createGateCheck(
      "saved_workspace_has_tabs",
      tabCount > 0,
      "The saved workspace must contain one or more tab records."
    ),
    createGateCheck(
      "saved_workspace_lifecycle_resumable",
      RESUMABLE_LIFECYCLES.includes(normalizedLifecycle),
      "The saved workspace lifecycle must be paused, archived, or dehydrated."
    ),
    createGateCheck(
      "saved_workspace_projection_not_live",
      RESUMABLE_PROJECTION_STATES.includes(normalizedProjectionState),
      "The saved projection must not be active, hydrated, resuming, unreadable, or otherwise unrecognized."
    ),
    createGateCheck(
      "resume_target_mode_resolved",
      restoreTargetMode === "current_window" || restoreTargetMode === "dedicated_window",
      "A current-window or dedicated-window resume target must be available."
    ),
    createGateCheck(
      "operator_confirmation_required",
      true,
      "Resume must require Operator confirmation before live browser action."
    ),
    createGateCheck(
      "post_action_verification_required",
      true,
      "Resume must be followed by post-action verification."
    )
  ];

  const failedChecks = checks.filter((check) => check.status === "fail");
  const status = failedChecks.length ? "blocked" : "ready_for_precheck";

  return {
    gateName: "saved_workspace_resume_gate",
    status,
    restoreTargetMode,
    tabCount,
    lifecycle: normalizeEvidenceLabel(snapshot.Lifecycle),
    projection: normalizeEvidenceLabel(snapshot.Projection),
    normalizedLifecycle,
    normalizedProjectionState,
    checks,
    failedChecks,
    nextSteps: status === "ready_for_precheck" ? [
      "Run saved workspace resume precheck.",
      "Show Operator confirmation with target mode and tab count.",
      "Execute resume only after confirmation.",
      "Verify reopened tabs, groups, labels, and target window policy."
    ] : [
      "Review the saved workspace details shown by the failed checks before enabling resume."
    ]
  };
}

function snapshotGateDetail(detail) {
  const source = isObjectLike(detail) ? detail : null;

  return {
    Workspace: readFieldOnce(source, "Workspace"),
    Lifecycle: readFieldOnce(source, "Lifecycle"),
    Projection: readFieldOnce(source, "Projection"),
    Tabs: readFieldOnce(source, "Tabs")
  };
}

function readFieldOnce(source, key) {
  if (!source) {
    return {
      readStatus: "invalid_source",
      value: undefined
    };
  }

  try {
    return {
      readStatus: "read",
      value: Reflect.get(source, key)
    };
  } catch {
    return {
      readStatus: "unreadable",
      value: undefined
    };
  }
}

function determineSavedWorkspaceResumeTargetMode(tabCount) {
  if (tabCount <= 0) return "blocked";
  if (tabCount >= DEDICATED_WINDOW_THRESHOLD_TAB_COUNT) return "dedicated_window";
  return "current_window";
}

function createGateCheck(check, condition, message) {
  return {
    check,
    status: condition ? "pass" : "fail",
    message
  };
}

function normalizeWorkspaceName(field) {
  if (field.readStatus !== "read" || typeof field.value !== "string") return "";
  return field.value.trim();
}

function normalizeLifecycle(field) {
  if (field.readStatus !== "read") return "invalid";
  if (typeof field.value !== "string") return "invalid";
  const normalized = field.value.trim().toLowerCase();
  return normalized || "blank";
}

function normalizeProjectionState(field) {
  if (field.readStatus !== "read") return "invalid";
  if (field.value === undefined || field.value === null) return "missing";
  if (typeof field.value !== "string") return "invalid";
  const normalized = field.value.trim().toLowerCase().split("/")[0].trim();
  return normalized || "blank";
}

function normalizeTabCount(field) {
  if (field.readStatus !== "read") return 0;

  if (Number.isSafeInteger(field.value) && field.value >= 0) {
    return field.value;
  }

  if (typeof field.value !== "string") return 0;

  const normalized = field.value.trim();
  if (!/^(0|[1-9]\d*)$/.test(normalized)) return 0;

  const count = Number(normalized);
  return Number.isSafeInteger(count) ? count : 0;
}

function normalizeEvidenceLabel(field) {
  if (field.readStatus !== "read") return "unreadable";
  if (typeof field.value !== "string") {
    return field.value === undefined || field.value === null
      ? "unknown"
      : "invalid";
  }

  return field.value || "unknown";
}

function formatSavedWorkspaceResumeGateForUser(gate) {
  const snapshot = snapshotFormattedGate(gate);

  const readyForUserMessage = snapshot.status === "ready_for_precheck"
    && (snapshot.restoreTargetMode === "current_window"
      || snapshot.restoreTargetMode === "dedicated_window")
    && RESUMABLE_LIFECYCLES.includes(snapshot.normalizedLifecycle);

  if (readyForUserMessage) {
    const target = snapshot.restoreTargetMode === "dedicated_window"
      ? "dedicated-window resume path"
      : "current-window resume path";

    return "This saved workspace is safe to proceed to precheck. Resume will use the "
      + target
      + " after Operator confirmation and will be verified afterward. Normalized lifecycle: "
      + snapshot.normalizedLifecycle
      + ".";
  }

  const failed = snapshot.failedMessages.join(" ")
    || "The saved workspace is not currently eligible to resume.";

  return "Resume is blocked. " + failed;
}

function snapshotFormattedGate(gate) {
  const source = isObjectLike(gate) ? gate : null;
  const status = readSafeString(source, "status");
  const restoreTargetMode = readSafeString(source, "restoreTargetMode");
  const normalizedLifecycle = readSafeString(source, "normalizedLifecycle") || "unknown";
  const failedChecks = readFieldOnce(source, "failedChecks");
  const failedMessages = [];

  if (failedChecks.readStatus === "read" && Array.isArray(failedChecks.value)) {
    try {
      for (const check of failedChecks.value) {
        const message = readSafeString(isObjectLike(check) ? check : null, "message");
        if (message) failedMessages.push(message);
      }
    } catch {
      failedMessages.length = 0;
    }
  }

  return {
    status,
    restoreTargetMode,
    normalizedLifecycle,
    failedMessages
  };
}

function readSafeString(source, key) {
  const field = readFieldOnce(source, key);
  return field.readStatus === "read" && typeof field.value === "string"
    ? field.value
    : "";
}

function isObjectLike(value) {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

export {
  DEDICATED_WINDOW_THRESHOLD_TAB_COUNT,
  evaluateSavedWorkspaceResumeGate,
  formatSavedWorkspaceResumeGateForUser
};
