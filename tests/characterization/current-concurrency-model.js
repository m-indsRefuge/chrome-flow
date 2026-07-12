import assert from "node:assert/strict";

export function clone(value) {
  return structuredClone(value);
}

export function wholeObjectWrite(store, value) {
  store.workspace = clone(value);
}

export function appendFromSnapshot(snapshot, field, value) {
  const next = clone(snapshot);
  next[field] = [...(next[field] || []), value];
  return next;
}

export function applyProjectionFromSnapshot(snapshot, workspaceTabId, patch) {
  const next = clone(snapshot);
  const tab = next.tabs.find((candidate) => candidate.workspaceTabId === workspaceTabId);
  Object.assign(tab, patch);
  return next;
}

export class NamedLockModel {
  #held = new Set();

  acquire(name) {
    if (this.#held.has(name)) return false;
    this.#held.add(name);
    return true;
  }

  release(name) {
    this.#held.delete(name);
  }
}

export class ProcessLocalSchedulerModel {
  constructor() {
    this.timerScheduled = false;
    this.pendingTriggers = new Set();
    this.queue = [];
  }

  schedule(trigger) {
    this.timerScheduled = true;
    this.pendingTriggers.add(trigger);
    this.queue.push(trigger);
  }
}

export function replaceWorkerProcess() {
  return new ProcessLocalSchedulerModel();
}

export function executeUnversionedPanelCommand(current, staleSnapshot, mutation) {
  assert.ok(current.workspaceId);
  return mutation(clone(staleSnapshot));
}

export function resolveWorkspaceTabs(workspaceTabs, browserTabs) {
  const results = new Array(workspaceTabs.length);
  const consumed = new Set();
  const unresolved = [];

  workspaceTabs.forEach((workspaceTab, index) => {
    const exact = Number.isInteger(workspaceTab.tabId)
      ? browserTabs.find((tab) => tab.id === workspaceTab.tabId && !consumed.has(tab.id))
      : null;
    if (exact) {
      consumed.add(exact.id);
      results[index] = { liveTab: exact, matchStatus: "exact_tab_id" };
    } else {
      unresolved.push(index);
    }
  });

  const demand = new Map();
  for (const index of unresolved) {
    const url = workspaceTabs[index].url || "";
    if (url) demand.set(url, (demand.get(url) || 0) + 1);
  }
  for (const index of unresolved) {
    const url = workspaceTabs[index].url || "";
    const matches = browserTabs.filter((tab) => !consumed.has(tab.id) && tab.url === url);
    if (matches.length === 1 && demand.get(url) === 1) {
      consumed.add(matches[0].id);
      results[index] = { liveTab: matches[0], matchStatus: "single_url_fallback" };
    } else {
      results[index] = {
        liveTab: null,
        matchStatus: matches.length ? "ambiguous_url_matches" : "not_found"
      };
    }
  }
  return results;
}
