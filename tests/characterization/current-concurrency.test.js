import test from "node:test";
import assert from "node:assert/strict";
import {
  NamedLockModel,
  ProcessLocalSchedulerModel,
  appendFromSnapshot,
  applyProjectionFromSnapshot,
  clone,
  executeUnversionedPanelCommand,
  replaceWorkerProcess,
  resolveWorkspaceTabs,
  wholeObjectWrite
} from "./current-concurrency-model.js";

const baseline = () => ({
  workspaceId: "workspace-a",
  name: "A",
  journal: [],
  timeline: [],
  tabs: [{ workspaceTabId: "record-1", tabId: 10, url: "https://example.test", isOpen: true }]
});

test("characterization model: reconciler latest reread can precede and discard a journal append", () => {
  const store = { workspace: baseline() };
  const reconcilerBaseline = clone(store.workspace);
  const calculatedPatch = { workspaceTabId: reconcilerBaseline.tabs[0].workspaceTabId, isOpen: false };
  const reconcilerLatestRead = clone(store.workspace);
  const interveningPanelRead = clone(store.workspace);
  wholeObjectWrite(store, appendFromSnapshot(interveningPanelRead, "journal", { entryId: "journal-1" }));
  wholeObjectWrite(store, applyProjectionFromSnapshot(reconcilerLatestRead, calculatedPatch.workspaceTabId, calculatedPatch));
  assert.equal(store.workspace.tabs[0].isOpen, false);
  assert.deepEqual(store.workspace.journal, []);
});

for (const field of ["journal", "timeline"]) {
  test(`current behavior: concurrent ${field} appends can lose the earlier append`, () => {
    const store = { workspace: baseline() };
    const left = appendFromSnapshot(clone(store.workspace), field, { id: "left" });
    const right = appendFromSnapshot(clone(store.workspace), field, { id: "right" });
    wholeObjectWrite(store, left);
    wholeObjectWrite(store, right);
    assert.deepEqual(store.workspace[field], [{ id: "right" }]);
  });
}

test("characterization model: reconciler latest reread can precede and discard a metadata edit", () => {
  const store = { workspace: baseline() };
  const reconcilerBaseline = clone(store.workspace);
  const calculatedPatch = { workspaceTabId: reconcilerBaseline.tabs[0].workspaceTabId, isOpen: false };
  const reconcilerLatestRead = clone(store.workspace);
  const interveningPanelRead = clone(store.workspace);
  interveningPanelRead.name = "Operator metadata edit";
  wholeObjectWrite(store, interveningPanelRead);
  wholeObjectWrite(store, applyProjectionFromSnapshot(reconcilerLatestRead, calculatedPatch.workspaceTabId, calculatedPatch));
  assert.equal(store.workspace.name, "A");
  assert.equal(store.workspace.tabs[0].isOpen, false);
});

test("current behavior: one global activeWorkspaceId cannot represent independent window selections", () => {
  const settings = new Map();
  settings.set("activeWorkspaceId", "workspace-a");
  settings.set("activeWorkspaceId", "workspace-b");
  assert.equal(settings.size, 1);
  assert.equal(settings.get("activeWorkspaceId"), "workspace-b");
});

test("current lock evidence: distinct operation lock names do not mutually exclude", () => {
  const locks = new NamedLockModel();
  const names = [
    "chrome-flow-workspace-library-save",
    "chrome-flow-workspace-resume-transaction",
    "constellation-data-import-execution-v0.1"
  ];
  assert.deepEqual(names.map((name) => locks.acquire(name)), [true, true, true]);
  assert.equal(locks.acquire(names[0]), false);
});

test("current lock evidence: reconciliation and archive have no represented common lock", () => {
  const protectedClasses = new Map([
    ["save", "chrome-flow-workspace-library-save"],
    ["resume", "chrome-flow-workspace-resume-transaction"],
    ["import", "constellation-data-import-execution-v0.1"],
    ["reconciliation", null],
    ["archive", null]
  ]);
  assert.equal(protectedClasses.get("reconciliation"), null);
  assert.equal(protectedClasses.get("archive"), null);
  assert.equal(new Set([...protectedClasses.values()].filter(Boolean)).size, 3);
});

test("current scheduler model: replacing the worker loses timer, triggers, and queue", () => {
  const first = new ProcessLocalSchedulerModel();
  first.schedule("tab_updated");
  const restarted = replaceWorkerProcess();
  assert.equal(first.timerScheduled, true);
  assert.deepEqual([...first.pendingTriggers], ["tab_updated"]);
  assert.equal(restarted.timerScheduled, false);
  assert.deepEqual([...restarted.pendingTriggers], []);
  assert.deepEqual(restarted.queue, []);
});

test("current command model: an unversioned stale panel command can replace newer state", () => {
  const stale = baseline();
  const current = { ...baseline(), name: "New name from panel B" };
  const result = executeUnversionedPanelCommand(current, stale, (workspace) => {
    workspace.journal.push({ entryId: "from-panel-a" });
    return workspace;
  });
  assert.equal(result.name, "A");
  assert.equal(result.journal.length, 1);
});

test("current operation identity gap: identical untracked commands are both applicable", () => {
  const workspace = baseline();
  const command = (value) => appendFromSnapshot(value, "timeline", { type: "refresh" });
  const once = command(workspace);
  const replayed = command(once);
  assert.equal(replayed.timeline.length, 2);
});

test("intentional safety: exact tab id wins before URL fallback", () => {
  const result = resolveWorkspaceTabs(
    [{ tabId: 22, url: "https://same.test" }],
    [{ id: 11, url: "https://same.test" }, { id: 22, url: "https://same.test" }]
  );
  assert.equal(result[0].liveTab.id, 22);
  assert.equal(result[0].matchStatus, "exact_tab_id");
});

test("intentional safety: ambiguous same-URL matches remain unresolved", () => {
  const result = resolveWorkspaceTabs(
    [{ tabId: null, url: "https://same.test" }],
    [{ id: 11, windowId: 1, url: "https://same.test" }, { id: 22, windowId: 2, url: "https://same.test" }]
  );
  assert.equal(result[0].liveTab, null);
  assert.equal(result[0].matchStatus, "ambiguous_url_matches");
});

test("current representation gap: browser windows do not create independent durable assignments", () => {
  const browserWindows = [{ id: 1 }, { id: 2 }];
  const settings = { activeWorkspaceId: "workspace-a" };
  assert.equal(browserWindows.length, 2);
  assert.equal(Object.keys(settings).length, 1);
  assert.equal("windowAssignments" in settings, false);
});
