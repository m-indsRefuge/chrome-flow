export const AUTOMATIC_PROMOTION_MANUAL_SCENARIOS = Object.freeze([
  Object.freeze({ id: "zero_to_three_current_window", label: "0→3 remains current-window" }),
  Object.freeze({ id: "three_to_four_one_window", label: "3→4 creates exactly one dedicated window" }),
  Object.freeze({ id: "zero_to_four_batch_one_window", label: "0→4 batch creates exactly one dedicated window" }),
  Object.freeze({ id: "one_to_five_batch_one_window", label: "1→5 batch creates exactly one dedicated window" }),
  Object.freeze({ id: "four_to_five_no_second_window", label: "4→5 creates no second window" }),
  Object.freeze({ id: "five_to_six_no_second_window", label: "5→6 creates no second window" }),
  Object.freeze({ id: "search_crosses_threshold", label: "Search crossing threshold" }),
  Object.freeze({ id: "recovery_crosses_threshold", label: "Recovery crossing threshold" }),
  Object.freeze({ id: "duplicate_intake_no_request", label: "Duplicate intake creates no request" }),
  Object.freeze({ id: "unrelated_tabs_remain", label: "Unrelated tabs remain" }),
  Object.freeze({ id: "groups_and_unassigned_tabs_correct", label: "Groups and unassigned tabs remain correct" }),
  Object.freeze({ id: "source_assignment_transfers", label: "Source assignment transfers" }),
  Object.freeze({ id: "destination_context_not_required", label: "Destination context is not required" }),
  Object.freeze({ id: "worker_restart_after_pending", label: "Worker restart after pending" }),
  Object.freeze({ id: "exact_retry_no_duplicate_window", label: "Exact retry creates no duplicate window" }),
  Object.freeze({ id: "two_workspaces_independent", label: "Two workspaces remain independent" }),
  Object.freeze({ id: "manual_move_still_works", label: "Manual move still works" }),
  Object.freeze({ id: "passive_triggers_do_not_promote", label: "Startup, reload, and render do not promote" }),
  Object.freeze({ id: "notice_informational_only", label: "Notice is informational only" }),
  Object.freeze({ id: "failure_preserves_membership_evidence", label: "Failed or indeterminate promotion preserves membership and evidence" })
]);

export const AUTOMATIC_PROMOTION_EVIDENCE_FIELDS = Object.freeze([
  "workspaceId",
  "membershipOperationId",
  "promotionOperationId",
  "beforeEligibleTabCount",
  "afterEligibleTabCount",
  "beforeWorkspaceRevision",
  "afterWorkspaceRevision",
  "sourceWindowId",
  "targetWindowId",
  "windowCountDelta",
  "moveMode",
  "assignmentResult",
  "placementResult",
  "noticeText",
  "diagnosticResult",
  "unrelatedTabVerification",
  "scenarioTimestamp",
  "operatorObservation"
]);

export function buildAutomaticPromotionValidationPacket({ createdAt }) {
  return {
    schema: "constellation-workspace-automatic-promotion-live-validation-v0.1",
    createdAt,
    developerOnly: true,
    operatorControlled: true,
    automatedBrowserMutation: false,
    liveChromeRun: false,
    liveChromePassed: false,
    evidenceFields: [...AUTOMATIC_PROMOTION_EVIDENCE_FIELDS],
    scenarios: AUTOMATIC_PROMOTION_MANUAL_SCENARIOS.map((scenario) => ({
      id: scenario.id,
      label: scenario.label,
      status: "not_run",
      evidence: Object.fromEntries(AUTOMATIC_PROMOTION_EVIDENCE_FIELDS.map((field) => [field, null]))
    }))
  };
}

export function formatManualScenarioChecklist() {
  return [
    "Automatic Promotion Manual Scenario Checklist",
    "Live Chrome has not been run by this validation surface.",
    "",
    ...AUTOMATIC_PROMOTION_MANUAL_SCENARIOS.map((scenario) => "[ ] " + scenario.label),
    "",
    "Capture every evidence field for each scenario:",
    AUTOMATIC_PROMOTION_EVIDENCE_FIELDS.join(", ")
  ].join("\n");
}
