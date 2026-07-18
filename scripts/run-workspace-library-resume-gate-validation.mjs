import assert from "node:assert/strict";
import { evaluateSavedWorkspaceResumeGate } from "../src/sidepanel/workspace-library-resume-gate.js";

const fixtures = {
  paused_three_tabs: evaluate("paused", "dehydrated / production_workspace_snapshot", 3),
  archived_three_tabs: evaluate("archived", "dehydrated / production_workspace_snapshot", 3),
  archived_four_tabs: evaluate("archived", "dehydrated / production_workspace_snapshot", 4),
  active_blocked: evaluate("active", "dehydrated / production_workspace_snapshot", 3),
  archived_hydrated_projection_blocked: evaluate("archived", "hydrated / live_projection", 3)
};

assert.equal(fixtures.paused_three_tabs.status, "ready_for_precheck");
assert.equal(fixtures.paused_three_tabs.restoreTargetMode, "current_window");
assert.equal(fixtures.archived_three_tabs.status, "ready_for_precheck");
assert.equal(fixtures.archived_three_tabs.restoreTargetMode, "current_window");
assert.equal(fixtures.archived_four_tabs.status, "ready_for_precheck");
assert.equal(fixtures.archived_four_tabs.restoreTargetMode, "dedicated_window");
assert.equal(fixtures.active_blocked.status, "blocked");
assert.equal(fixtures.archived_hydrated_projection_blocked.status, "blocked");


const malformedInputs = [
  null,
  {
    Workspace: "Validation workspace",
    Lifecycle: "archived",
    Projection: "dehydrated",
    Tabs: true
  },
  {
    Workspace: "Validation workspace",
    Lifecycle: { toString() { return "archived"; } },
    Projection: "dehydrated",
    Tabs: "3"
  }
];

for (const input of malformedInputs) {
  const result = evaluateSavedWorkspaceResumeGate(input);
  assert.equal(result.status, "blocked");
  assert.doesNotThrow(() => JSON.stringify(result));
}

let projectionReads = 0;
const statefulResult = evaluateSavedWorkspaceResumeGate({
  Workspace: "Validation workspace",
  Lifecycle: "archived",
  get Projection() {
    projectionReads += 1;
    return projectionReads === 1 ? "dehydrated / saved" : "hydrated / live";
  },
  Tabs: "3"
});
assert.equal(projectionReads, 1);
assert.equal(statefulResult.status, "ready_for_precheck");
assert.equal(statefulResult.projection, "dehydrated / saved");

console.log(JSON.stringify({
  schema: "constellation-workspace-library-resume-gate-validation-v0.1",
  pausedThreeTabs: summarize(fixtures.paused_three_tabs),
  archivedThreeTabs: summarize(fixtures.archived_three_tabs),
  archivedFourTabs: summarize(fixtures.archived_four_tabs),
  activeBlocked: summarize(fixtures.active_blocked),
  archivedHydratedBlocked: summarize(fixtures.archived_hydrated_projection_blocked)
}));

function evaluate(lifecycle, projection, tabs) { return evaluateSavedWorkspaceResumeGate({ Workspace: "Validation workspace", Lifecycle: lifecycle, Projection: projection, Tabs: String(tabs), Summary: "Saved summary", Continuation: "Continue" }); }
function summarize(result) { return { status: result.status, restoreTargetMode: result.restoreTargetMode, normalizedLifecycle: result.normalizedLifecycle, normalizedProjectionState: result.normalizedProjectionState }; }
