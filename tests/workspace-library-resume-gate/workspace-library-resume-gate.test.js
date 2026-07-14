import test from "node:test";
import assert from "node:assert/strict";
import {
  DEDICATED_WINDOW_THRESHOLD_TAB_COUNT,
  evaluateSavedWorkspaceResumeGate,
  formatSavedWorkspaceResumeGateForUser
} from "../../src/sidepanel/workspace-library-resume-gate.js";

const base = Object.freeze({ Workspace: "Research workspace", Lifecycle: "paused", Projection: "dehydrated / production_workspace_snapshot", Tabs: "3", Summary: "Saved summary", Continuation: "Continue research" });

test("paused and dehydrated with three tabs is current-window ready", () => {
  const result = evaluateSavedWorkspaceResumeGate(base);
  assertReady(result, "current_window", "paused", "dehydrated");
});

test("archived and dehydrated with three tabs is current-window ready", () => {
  const result = evaluateSavedWorkspaceResumeGate(detail({ Lifecycle: "archived" }));
  assertReady(result, "current_window", "archived", "dehydrated");
});

test("archived and dehydrated with four tabs targets dedicated window", () => {
  const result = evaluateSavedWorkspaceResumeGate(detail({ Lifecycle: "archived", Tabs: "4" }));
  assertReady(result, "dedicated_window", "archived", "dehydrated");
});

test("archived and dehydrated with five tabs remains dedicated-window eligible", () => {
  assertReady(evaluateSavedWorkspaceResumeGate(detail({ Lifecycle: "archived", Tabs: "5" })), "dedicated_window", "archived", "dehydrated");
});

test("legacy dehydrated lifecycle is ready", () => {
  assertReady(evaluateSavedWorkspaceResumeGate(detail({ Lifecycle: "dehydrated" })), "current_window", "dehydrated", "dehydrated");
});

test("archived with missing projection remains represented and eligible", () => {
  const input = detail({ Lifecycle: "archived" }); delete input.Projection;
  const result = evaluateSavedWorkspaceResumeGate(input);
  assertReady(result, "current_window", "archived", "missing"); assert.equal(result.projection, "unknown");
});

for (const lifecycle of ["active", "hydrated", "resuming"]) test(lifecycle + " lifecycle is blocked", () => {
  const result = evaluateSavedWorkspaceResumeGate(detail({ Lifecycle: lifecycle }));
  assert.equal(result.status, "blocked"); assert.equal(check(result, "saved_workspace_lifecycle_resumable").status, "fail");
});

for (const projection of ["hydrated / live_projection", "active / live_projection"]) test("archived lifecycle with " + projection.split(" ")[0] + " projection is blocked", () => {
  const result = evaluateSavedWorkspaceResumeGate(detail({ Lifecycle: "archived", Projection: projection }));
  assert.equal(result.status, "blocked"); assert.equal(check(result, "saved_workspace_projection_not_live").status, "fail");
});

test("unknown lifecycle is blocked", () => {
  assert.equal(evaluateSavedWorkspaceResumeGate(detail({ Lifecycle: "unknown" })).status, "blocked");
});

test("blank lifecycle is blocked and represented", () => {
  const result = evaluateSavedWorkspaceResumeGate(detail({ Lifecycle: "   " }));
  assert.equal(result.status, "blocked"); assert.equal(result.normalizedLifecycle, "blank");
});

test("zero tabs is blocked with unresolved target", () => {
  const result = evaluateSavedWorkspaceResumeGate(detail({ Lifecycle: "archived", Tabs: "0" }));
  assert.equal(result.status, "blocked"); assert.equal(result.restoreTargetMode, "blocked"); assert.equal(check(result, "saved_workspace_has_tabs").status, "fail"); assert.equal(check(result, "resume_target_mode_resolved").status, "fail");
});

test("three-to-four tab boundary is exact", () => {
  assert.equal(DEDICATED_WINDOW_THRESHOLD_TAB_COUNT, 4);
  assert.equal(evaluateSavedWorkspaceResumeGate(detail({ Lifecycle: "archived", Tabs: "3" })).restoreTargetMode, "current_window");
  assert.equal(evaluateSavedWorkspaceResumeGate(detail({ Lifecycle: "archived", Tabs: "4" })).restoreTargetMode, "dedicated_window");
});

for (const lifecycle of ["not_archived", "unpaused", "active_archived_copy"]) test("substring lifecycle " + lifecycle + " is blocked", () => {
  const result = evaluateSavedWorkspaceResumeGate(detail({ Lifecycle: lifecycle }));
  assert.equal(result.status, "blocked"); assert.equal(check(result, "saved_workspace_lifecycle_resumable").status, "fail");
});

test("mixed case and surrounding whitespace normalize exactly", () => {
  const result = evaluateSavedWorkspaceResumeGate(detail({ Lifecycle: "  ArChIvEd  ", Projection: "  DeHyDrAtEd  / imported_snapshot" }));
  assertReady(result, "current_window", "archived", "dehydrated");
});

test("projection parsing uses only the first slash-separated component", () => {
  const result = evaluateSavedWorkspaceResumeGate(detail({ Lifecycle: "archived", Projection: "dehydrated / hydrated / live_projection" }));
  assertReady(result, "current_window", "archived", "dehydrated");
});

test("unrecognized projection is blocked", () => {
  const result = evaluateSavedWorkspaceResumeGate(detail({ Lifecycle: "archived", Projection: "mystery / saved_snapshot" }));
  assert.equal(result.status, "blocked"); assert.equal(check(result, "saved_workspace_projection_not_live").status, "fail");
});

test("input object remains unmodified", () => {
  const input = detail({ Lifecycle: "  Archived " }), before = structuredClone(input);
  evaluateSavedWorkspaceResumeGate(input); assert.deepEqual(input, before);
});

test("every result uses one stable serializable shape and seven stable checks", () => {
  const fixtures = [base, detail({ Lifecycle: "archived", Tabs: "4" }), detail({ Lifecycle: "active" }), detail({ Tabs: "0" })];
  const expectedKeys = ["gateName", "status", "restoreTargetMode", "tabCount", "lifecycle", "projection", "normalizedLifecycle", "normalizedProjectionState", "checks", "failedChecks", "nextSteps"];
  const expectedChecks = ["saved_workspace_selected", "saved_workspace_has_tabs", "saved_workspace_lifecycle_resumable", "saved_workspace_projection_not_live", "resume_target_mode_resolved", "operator_confirmation_required", "post_action_verification_required"];
  for (const fixture of fixtures) { const result = evaluateSavedWorkspaceResumeGate(fixture); assert.deepEqual(Object.keys(result), expectedKeys); assert.deepEqual(result.checks.map((item) => item.check), expectedChecks); assert.doesNotThrow(() => structuredClone(result)); assert.doesNotThrow(() => JSON.stringify(result)); }
});

test("eligible archived user message describes safe precheck target and lifecycle", () => {
  const message = formatSavedWorkspaceResumeGateForUser(evaluateSavedWorkspaceResumeGate(detail({ Lifecycle: "archived", Tabs: "4" })));
  assert.match(message, /safe to proceed to precheck/i); assert.match(message, /dedicated-window/i); assert.match(message, /normalized lifecycle: archived/i); assert.doesNotMatch(message, /checks? (?:are |must be )?repaired/i);
});

test("blocked user message contains human-readable reasons rather than internal identifiers", () => {
  const message = formatSavedWorkspaceResumeGateForUser(evaluateSavedWorkspaceResumeGate(detail({ Lifecycle: "active", Projection: "hydrated / live_projection", Tabs: "0" })));
  assert.match(message, /Resume is blocked/); assert.match(message, /lifecycle must be/i); assert.match(message, /projection must not be active/i); assert.doesNotMatch(message, /saved_workspace_|resume_target_mode_resolved/);
});

function detail(overrides = {}) { return { ...base, ...overrides }; }
function check(result, name) { return result.checks.find((item) => item.check === name); }
function assertReady(result, mode, lifecycle, projection) { assert.equal(result.status, "ready_for_precheck"); assert.equal(result.restoreTargetMode, mode); assert.equal(result.normalizedLifecycle, lifecycle); assert.equal(result.normalizedProjectionState, projection); assert.equal(result.failedChecks.length, 0); }


test("null and primitive inputs fail closed with complete serializable results", () => {
  for (const input of [null, undefined, true, 3, "archived", Symbol("detail")]) {
    const result = evaluateSavedWorkspaceResumeGate(input);
    assert.equal(result.status, "blocked");
    assert.equal(result.restoreTargetMode, "blocked");
    assert.doesNotThrow(() => JSON.stringify(result));
  }
});

test("throwing field getters fail closed and never escape", () => {
  for (const field of ["Workspace", "Lifecycle", "Projection", "Tabs"]) {
    const input = detail();
    Object.defineProperty(input, field, {
      configurable: true,
      get() {
        throw new Error(field + " getter failure");
      }
    });

    let result;
    assert.doesNotThrow(() => {
      result = evaluateSavedWorkspaceResumeGate(input);
    });
    assert.equal(result.status, "blocked");

    if (field === "Projection") {
      assert.equal(result.normalizedProjectionState, "invalid");
      assert.equal(check(result, "saved_workspace_projection_not_live").status, "fail");
    }
  }
});

test("stateful getters are snapshotted once and cannot create contradictory evidence", () => {
  const reads = {
    Workspace: 0,
    Lifecycle: 0,
    Projection: 0,
    Tabs: 0
  };
  const input = {
    get Workspace() {
      reads.Workspace += 1;
      return reads.Workspace === 1 ? "Research workspace" : "";
    },
    get Lifecycle() {
      reads.Lifecycle += 1;
      return reads.Lifecycle === 1 ? "archived" : "active";
    },
    get Projection() {
      reads.Projection += 1;
      return reads.Projection === 1 ? "dehydrated / saved" : "hydrated / live";
    },
    get Tabs() {
      reads.Tabs += 1;
      return reads.Tabs === 1 ? "3" : "0";
    }
  };

  const result = evaluateSavedWorkspaceResumeGate(input);

  assert.deepEqual(reads, {
    Workspace: 1,
    Lifecycle: 1,
    Projection: 1,
    Tabs: 1
  });
  assertReady(result, "current_window", "archived", "dehydrated");
  assert.equal(result.lifecycle, "archived");
  assert.equal(result.projection, "dehydrated / saved");
});

test("malformed tab values cannot coerce into resume authority", () => {
  const malformedValues = [
    true,
    false,
    ["4"],
    "0x4",
    "4e0",
    "04",
    Symbol("4"),
    { valueOf() { return 4; } }
  ];

  for (const Tabs of malformedValues) {
    const result = evaluateSavedWorkspaceResumeGate(detail({
      Lifecycle: "archived",
      Tabs
    }));

    assert.equal(result.status, "blocked");
    assert.equal(result.tabCount, 0);
    assert.equal(result.restoreTargetMode, "blocked");
  }
});

test("non-string lifecycle and projection values cannot coerce into resumable states", () => {
  const lifecycleResult = evaluateSavedWorkspaceResumeGate(detail({
    Lifecycle: { toString() { return "archived"; } }
  }));
  assert.equal(lifecycleResult.status, "blocked");
  assert.equal(lifecycleResult.normalizedLifecycle, "invalid");

  const projectionResult = evaluateSavedWorkspaceResumeGate(detail({
    Lifecycle: "archived",
    Projection: { toString() { return "dehydrated"; } }
  }));
  assert.equal(projectionResult.status, "blocked");
  assert.equal(projectionResult.normalizedProjectionState, "invalid");
});

test("cyclic and coercive evidence still returns a serializable blocked result", () => {
  const cyclic = {};
  cyclic.self = cyclic;

  const result = evaluateSavedWorkspaceResumeGate(detail({
    Lifecycle: cyclic,
    Projection: cyclic,
    Tabs: cyclic
  }));

  assert.equal(result.status, "blocked");
  assert.equal(result.lifecycle, "invalid");
  assert.equal(result.projection, "invalid");
  assert.doesNotThrow(() => structuredClone(result));
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("user formatter fails closed for malformed or throwing gate input", () => {
  assert.doesNotThrow(() => formatSavedWorkspaceResumeGateForUser(null));
  assert.match(formatSavedWorkspaceResumeGateForUser(null), /Resume is blocked/);

  const gate = {};
  Object.defineProperty(gate, "status", {
    get() {
      throw new Error("status unavailable");
    }
  });

  const message = formatSavedWorkspaceResumeGateForUser(gate);
  assert.match(message, /Resume is blocked/);
  assert.doesNotMatch(message, /undefined|\[object Object\]/);
});


test("user formatter refuses malformed ready claims and hostile failed-check arrays", () => {
  const malformedReady = {
    status: "ready_for_precheck",
    restoreTargetMode: "mystery_window",
    normalizedLifecycle: "archived",
    failedChecks: []
  };
  assert.match(formatSavedWorkspaceResumeGateForUser(malformedReady), /Resume is blocked/);

  const hostileChecks = new Proxy([], {
    get(target, property, receiver) {
      if (property === Symbol.iterator) {
        throw new Error("iterator unavailable");
      }
      return Reflect.get(target, property, receiver);
    }
  });
  const hostileGate = {
    status: "blocked",
    restoreTargetMode: "blocked",
    normalizedLifecycle: "invalid",
    failedChecks: hostileChecks
  };

  assert.doesNotThrow(() => formatSavedWorkspaceResumeGateForUser(hostileGate));
  assert.match(formatSavedWorkspaceResumeGateForUser(hostileGate), /Resume is blocked/);
});
