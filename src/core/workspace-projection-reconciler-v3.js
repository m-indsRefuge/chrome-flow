import { appendRuntimeDiagnostic } from "./workspace-runtime-store.js";

const WORKSPACE_STORAGE_KEY = "chromeFlowWorkspace";
const RECONCILE_DEBOUNCE_MS = 220;
const PROJECTION_FIELDS = [
  "tabId",
  "tabKey",
  "windowId",
  "groupId",
  "index",
  "url",
  "displayUrl",
  "originalTitle",
  "isOpen",
  "lastMatchStatus"
];

let reconcileTimer = null;
let reconcileQueue = Promise.resolve();
const pendingTriggers = new Set();

function scheduleWorkspaceProjectionReconciliation(trigger = "unspecified") {
  pendingTriggers.add(String(trigger || "unspecified"));
  if (reconcileTimer) clearTimeout(reconcileTimer);

  reconcileTimer = setTimeout(() => {
    reconcileTimer = null;
    const triggers = Array.from(pendingTriggers);
    pendingTriggers.clear();

    reconcileQueue = reconcileQueue
      .then(() => reconcileActiveWorkspaceProjection({ triggers }))
      .catch((error) => appendRuntimeDiagnostic(
        "error",
        "workspace_projection_reconciliation_failed",
        "Automatic browser projection reconciliation failed.",
        { triggers, error: summarizeError(error) }
      ));
  }, RECONCILE_DEBOUNCE_MS);
}

async function reconcileActiveWorkspaceProjection(context = {}) {
  const startedAtMs = Date.now();
  const baselineWorkspace = await readWorkspace();
  const baselineTabs = Array.isArray(baselineWorkspace?.tabs) ? baselineWorkspace.tabs : [];

  if (!baselineWorkspace?.workspaceId || baselineTabs.length === 0) {
    return createEmptySummary(baselineWorkspace?.workspaceId || "", baselineTabs.length, context.triggers, startedAtMs, "no_workspace_tabs");
  }

  const browserTabs = await chrome.tabs.query({});
  const patches = createProjectionPatches(resolveWorkspaceTabs(baselineTabs, browserTabs));
  const latestWorkspace = await readWorkspace();

  if (!latestWorkspace?.workspaceId || latestWorkspace.workspaceId !== baselineWorkspace.workspaceId) {
    const summary = createEmptySummary(baselineWorkspace.workspaceId, baselineTabs.length, context.triggers, startedAtMs, "aborted_workspace_identity_changed");
    await appendRuntimeDiagnostic(
      "warn",
      "workspace_projection_reconciliation_aborted",
      "Automatic reconciliation stopped because the active workspace changed during the browser read.",
      summary
    );
    return summary;
  }

  const mergeResult = mergeProjectionPatches(latestWorkspace, patches);
  const status = calculateProjectionStatus(latestWorkspace.tabs);
  const summary = {
    schema: "workspace-projection-reconciliation-summary-v0.3",
    workspaceId: latestWorkspace.workspaceId,
    recordsExamined: baselineTabs.length,
    recordsChanged: mergeResult.changedRecordCount,
    openCount: status.openCount,
    missingCount: status.missingCount,
    ambiguousCount: status.ambiguousCount,
    transitions: mergeResult.transitions,
    triggers: context.triggers || [],
    durationMs: Date.now() - startedAtMs,
    status: mergeResult.changedRecordCount ? "projection_updated" : "projection_current"
  };

  if (!mergeResult.changedRecordCount) {
    if ((context.triggers || []).some(isStartupTrigger)) {
      await appendRuntimeDiagnostic(
        "info",
        "workspace_projection_reconciliation_verified",
        "Automatic browser projection reconciliation verified that the active workspace was current.",
        summary
      );
    }
    return summary;
  }

  const now = new Date().toISOString();
  latestWorkspace.timeline = Array.isArray(latestWorkspace.timeline) ? latestWorkspace.timeline : [];
  latestWorkspace.timeline.push(...createTransitionEvents(mergeResult.transitions, now, context.triggers || []));
  latestWorkspace.updatedAt = now;
  latestWorkspace.projectionReconciliation = {
    schema: "workspace-projection-reconciliation-v0.3",
    reconciledAt: now,
    triggers: context.triggers || [],
    recordsExamined: summary.recordsExamined,
    recordsChanged: summary.recordsChanged,
    openCount: summary.openCount,
    missingCount: summary.missingCount,
    ambiguousCount: summary.ambiguousCount
  };

  await chrome.storage.local.set({ [WORKSPACE_STORAGE_KEY]: latestWorkspace });
  await appendRuntimeDiagnostic(
    "info",
    "workspace_projection_reconciled",
    "Automatic browser projection reconciliation updated the active workspace.",
    summary
  );

  try {
    await chrome.runtime.sendMessage({
      type: "chrome-flow-workspace-projection-reconciled",
      summary
    });
  } catch {
    // A closed side panel is normal; active runtime state is already current.
  }

  return summary;
}

function resolveWorkspaceTabs(workspaceTabs, browserTabs) {
  const results = new Array(workspaceTabs.length);
  const consumedTabIds = new Set();
  const unresolvedIndexes = [];

  workspaceTabs.forEach((workspaceTab, index) => {
    const exact = Number.isInteger(workspaceTab.tabId)
      ? browserTabs.find((tab) => tab.id === workspaceTab.tabId && !consumedTabIds.has(tab.id))
      : null;

    if (exact) {
      consumedTabIds.add(exact.id);
      results[index] = { workspaceTab, liveTab: exact, matchStatus: "exact_tab_id", candidateCount: 1 };
    } else {
      unresolvedIndexes.push(index);
    }
  });

  const unresolvedDemandByUrl = new Map();
  for (const index of unresolvedIndexes) {
    const url = String(workspaceTabs[index]?.url || "");
    if (!url) continue;
    unresolvedDemandByUrl.set(url, (unresolvedDemandByUrl.get(url) || 0) + 1);
  }

  for (const index of unresolvedIndexes) {
    const workspaceTab = workspaceTabs[index];
    const url = String(workspaceTab?.url || "");
    const urlMatches = url
      ? browserTabs.filter((tab) => !consumedTabIds.has(tab.id) && tab.url === url)
      : [];
    const unresolvedDemand = unresolvedDemandByUrl.get(url) || 0;

    if (urlMatches.length === 1 && unresolvedDemand === 1) {
      consumedTabIds.add(urlMatches[0].id);
      results[index] = {
        workspaceTab,
        liveTab: urlMatches[0],
        matchStatus: "single_url_fallback",
        candidateCount: 1
      };
      continue;
    }

    const ambiguous = urlMatches.length > 1 || (urlMatches.length > 0 && unresolvedDemand > 1);
    results[index] = {
      workspaceTab,
      liveTab: null,
      matchStatus: ambiguous ? "ambiguous_url_matches" : "not_found",
      candidateCount: urlMatches.length
    };
  }

  return results;
}

function createProjectionPatches(results) {
  const patches = new Map();

  for (const result of results) {
    const workspaceTabId = result.workspaceTab?.workspaceTabId || "";
    if (!workspaceTabId) continue;

    if (!result.liveTab) {
      patches.set(workspaceTabId, {
        workspaceTabId,
        isOpen: false,
        groupId: -1,
        lastMatchStatus: result.matchStatus,
        candidateCount: result.candidateCount
      });
      continue;
    }

    const liveTab = result.liveTab;
    const url = liveTab.url || result.workspaceTab.url || "";
    const title = liveTab.title || result.workspaceTab.originalTitle || "Untitled tab";
    patches.set(workspaceTabId, {
      workspaceTabId,
      tabId: liveTab.id,
      tabKey: String(url) + "::" + String(title),
      windowId: liveTab.windowId,
      groupId: Number.isInteger(liveTab.groupId) ? liveTab.groupId : -1,
      index: Number.isInteger(liveTab.index) ? liveTab.index : null,
      url,
      displayUrl: createDisplayUrl(url),
      originalTitle: title,
      isOpen: true,
      lastMatchStatus: result.matchStatus,
      candidateCount: result.candidateCount
    });
  }

  return patches;
}

function mergeProjectionPatches(workspace, patches) {
  const transitions = [];
  let changedRecordCount = 0;

  for (const tab of Array.isArray(workspace.tabs) ? workspace.tabs : []) {
    const patch = patches.get(tab.workspaceTabId || "");
    if (!patch) continue;

    const previous = captureProjection(tab);
    let changed = false;

    for (const field of PROJECTION_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
      if (valuesEqual(tab[field], patch[field])) continue;
      tab[field] = patch[field];
      changed = true;
    }

    if (!changed) continue;
    tab.lastSeenAt = new Date().toISOString();
    changedRecordCount += 1;
    transitions.push(...detectTransitions(tab, previous, patch));
  }

  return { changedRecordCount, transitions };
}

function captureProjection(tab) {
  return {
    windowId: tab.windowId,
    groupId: Number.isInteger(tab.groupId) ? tab.groupId : -1,
    url: tab.url || "",
    isOpen: tab.isOpen !== false
  };
}

function detectTransitions(tab, previous, patch) {
  const transitions = [];
  const base = {
    workspaceTabId: tab.workspaceTabId || "",
    tabId: Number.isInteger(tab.tabId) ? tab.tabId : null,
    url: tab.url || "",
    title: tab.alias || tab.originalTitle || tab.displayUrl || tab.url || "workspace tab",
    matchStatus: tab.lastMatchStatus || "",
    candidateCount: patch.candidateCount || 0
  };

  if (previous.isOpen && tab.isOpen === false) {
    transitions.push({ type: "workspace_tab_became_missing", ...base });
  } else if (!previous.isOpen && tab.isOpen !== false) {
    transitions.push({ type: "workspace_tab_reconnected", ...base });
  }

  if (Number.isInteger(previous.windowId) && Number.isInteger(tab.windowId) && previous.windowId !== tab.windowId) {
    transitions.push({ type: "workspace_tab_window_changed", ...base, previousWindowId: previous.windowId, windowId: tab.windowId });
  }

  const currentGroupId = Number.isInteger(tab.groupId) ? tab.groupId : -1;
  if (previous.groupId !== currentGroupId) {
    transitions.push({ type: "workspace_tab_group_changed", ...base, previousGroupId: previous.groupId, groupId: currentGroupId });
  }

  if (previous.url && tab.url && previous.url !== tab.url) {
    transitions.push({ type: "workspace_tab_url_changed", ...base, previousUrl: previous.url, url: tab.url });
  }

  return transitions;
}

function createTransitionEvents(transitions, createdAt, triggers) {
  return transitions.map((transition) => ({
    eventId: crypto.randomUUID(),
    type: transition.type,
    message: transitionMessage(transition),
    createdAt,
    reconciliationMode: "automatic_browser_projection",
    reconciliationTriggers: triggers,
    ...transition
  }));
}

function transitionMessage(transition) {
  const name = transition.title || "Workspace tab";
  if (transition.type === "workspace_tab_became_missing") return name + " is no longer open in Chrome and remains available as a missing workspace record.";
  if (transition.type === "workspace_tab_reconnected") return name + " reconnected to a live Chrome tab.";
  if (transition.type === "workspace_tab_window_changed") return name + " moved to a different Chrome window.";
  if (transition.type === "workspace_tab_group_changed") return name + " changed Chrome group state.";
  if (transition.type === "workspace_tab_url_changed") return name + " navigated to a different URL.";
  return name + " browser projection changed.";
}

function calculateProjectionStatus(tabs = []) {
  const openCount = tabs.filter((tab) => tab.isOpen !== false).length;
  const ambiguousCount = tabs.filter((tab) => String(tab.lastMatchStatus || "").startsWith("ambiguous")).length;
  return { openCount, missingCount: tabs.length - openCount, ambiguousCount };
}

function createEmptySummary(workspaceId, recordsExamined, triggers, startedAtMs, status) {
  return {
    schema: "workspace-projection-reconciliation-summary-v0.3",
    workspaceId,
    recordsExamined,
    recordsChanged: 0,
    openCount: 0,
    missingCount: 0,
    ambiguousCount: 0,
    transitions: [],
    triggers: triggers || [],
    durationMs: Date.now() - startedAtMs,
    status
  };
}

async function readWorkspace() {
  const result = await chrome.storage.local.get(WORKSPACE_STORAGE_KEY);
  return result?.[WORKSPACE_STORAGE_KEY] || null;
}

function createDisplayUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname + parsed.pathname.replace(/\/$/, "");
  } catch {
    return String(url || "");
  }
}

function valuesEqual(left, right) {
  return left === right || (left == null && right == null);
}

function isStartupTrigger(trigger) {
  return ["extension_installed", "extension_startup", "sidepanel_startup"].includes(trigger);
}

function summarizeError(error) {
  return { name: error?.name || "Error", message: error?.message || String(error) };
}

export {
  reconcileActiveWorkspaceProjection,
  scheduleWorkspaceProjectionReconciliation
};
