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
  "lastSeenAt",
  "lastMatchStatus"
];

let reconcileTimer = null;
let reconcileQueue = Promise.resolve();
const pendingTriggers = new Set();
const pendingTriggerDetails = [];

function scheduleWorkspaceProjectionReconciliation(trigger = "unspecified", details = {}) {
  pendingTriggers.add(String(trigger || "unspecified"));
  pendingTriggerDetails.push(sanitizeTriggerDetails(details));

  if (reconcileTimer) clearTimeout(reconcileTimer);
  reconcileTimer = setTimeout(() => {
    reconcileTimer = null;
    const triggers = Array.from(pendingTriggers);
    const triggerDetails = pendingTriggerDetails.splice(0, pendingTriggerDetails.length);
    pendingTriggers.clear();

    reconcileQueue = reconcileQueue
      .then(() => reconcileActiveWorkspaceProjection({ triggers, triggerDetails }))
      .catch(async (error) => {
        await appendRuntimeDiagnostic(
          "error",
          "workspace_projection_reconciliation_failed",
          "Automatic browser projection reconciliation failed.",
          {
            triggers,
            error: summarizeError(error)
          }
        );
      });
  }, RECONCILE_DEBOUNCE_MS);
}

async function reconcileActiveWorkspaceProjection(context = {}) {
  const startedAtMs = Date.now();
  const baselineWorkspace = await readActiveWorkspace();
  const baselineTabs = Array.isArray(baselineWorkspace?.tabs) ? baselineWorkspace.tabs : [];

  if (!baselineWorkspace?.workspaceId || baselineTabs.length === 0) {
    return createSummary({
      workspaceId: baselineWorkspace?.workspaceId || "",
      recordsExamined: baselineTabs.length,
      recordsChanged: 0,
      openCount: 0,
      missingCount: 0,
      ambiguousCount: 0,
      transitions: [],
      triggers: context.triggers || [],
      durationMs: Date.now() - startedAtMs,
      status: "no_workspace_tabs"
    });
  }

  const browserTabs = await chrome.tabs.query({});
  const resolution = resolveWorkspaceTabs(baselineTabs, browserTabs);
  const patches = createProjectionPatches(resolution.results);
  const latestWorkspace = await readActiveWorkspace();

  if (!latestWorkspace?.workspaceId || latestWorkspace.workspaceId !== baselineWorkspace.workspaceId) {
    const summary = createSummary({
      workspaceId: baselineWorkspace.workspaceId,
      recordsExamined: baselineTabs.length,
      recordsChanged: 0,
      openCount: 0,
      missingCount: 0,
      ambiguousCount: 0,
      transitions: [],
      triggers: context.triggers || [],
      durationMs: Date.now() - startedAtMs,
      status: "aborted_workspace_identity_changed"
    });

    await appendRuntimeDiagnostic(
      "warn",
      "workspace_projection_reconciliation_aborted",
      "Automatic reconciliation stopped because the active workspace changed during the browser read.",
      summary
    );

    return summary;
  }

  const mergeResult = mergeProjectionPatches(latestWorkspace, patches);
  const status = calculateProjectionStatus(latestWorkspace.tabs || []);
  const summary = createSummary({
    workspaceId: latestWorkspace.workspaceId,
    recordsExamined: baselineTabs.length,
    recordsChanged: mergeResult.changedRecordCount,
    openCount: status.openCount,
    missingCount: status.missingCount,
    ambiguousCount: status.ambiguousCount,
    transitions: mergeResult.transitions,
    triggers: context.triggers || [],
    durationMs: Date.now() - startedAtMs,
    status: mergeResult.changedRecordCount > 0 ? "projection_updated" : "projection_current"
  });

  if (mergeResult.changedRecordCount > 0 || mergeResult.transitions.length > 0) {
    const now = new Date().toISOString();
    latestWorkspace.timeline = Array.isArray(latestWorkspace.timeline) ? latestWorkspace.timeline : [];
    latestWorkspace.timeline.push(...createTransitionEvents(mergeResult.transitions, now, context.triggers || []));
    latestWorkspace.updatedAt = now;
    latestWorkspace.projectionReconciliation = {
      schema: "workspace-projection-reconciliation-v0.1",
      reconciledAt: now,
      triggers: context.triggers || [],
      recordsExamined: summary.recordsExamined,
      recordsChanged: summary.recordsChanged,
      openCount: summary.openCount,
      missingCount: summary.missingCount,
      ambiguousCount: summary.ambiguousCount
    };

    await chrome.storage.local.set({
      [WORKSPACE_STORAGE_KEY]: latestWorkspace
    });

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
      // No open product surface is a normal background-state condition.
    }
  } else if ((context.triggers || []).some(isStartupTrigger)) {
    await appendRuntimeDiagnostic(
      "info",
      "workspace_projection_reconciliation_verified",
      "Automatic browser projection reconciliation verified that the active workspace was current.",
      summary
    );
  }

  return summary;
}

function resolveWorkspaceTabs(workspaceTabs, browserTabs) {
  const consumedLiveTabIds = new Set();
  const results = [];

  for (const workspaceTab of workspaceTabs) {
    const exactTab = Number.isInteger(workspaceTab.tabId)
      ? browserTabs.find((tab) => tab.id === workspaceTab.tabId)
      : null;

    if (exactTab && !consumedLiveTabIds.has(exactTab.id)) {
      consumedLiveTabIds.add(exactTab.id);
      results.push(createResolutionResult(workspaceTab, exactTab, "exact_tab_id", 1));
      continue;
    }

    const urlMatches = browserTabs.filter((tab) => (
      !consumedLiveTabIds.has(tab.id)
      && Boolean(workspaceTab.url)
      && Boolean(tab.url)
      && workspaceTab.url === tab.url
    ));

    if (urlMatches.length === 1) {
      consumedLiveTabIds.add(urlMatches[0].id);
      results.push(createResolutionResult(workspaceTab, urlMatches[0], "single_url_fallback", 1));
      continue;
    }

    if (urlMatches.length > 1) {
      results.push(createResolutionResult(workspaceTab, null, "ambiguous_url_matches", urlMatches.length));
      continue;
    }

    results.push(createResolutionResult(workspaceTab, null, "not_found", 0));
  }

  return { browserTabs, results };
}

function createResolutionResult(workspaceTab, liveTab, matchStatus, candidateCount) {
  return {
    workspaceTab,
    liveTab,
    matchStatus,
    candidateCount
  };
}

function createProjectionPatches(results) {
  const now = new Date().toISOString();
  const patches = new Map();

  for (const result of results) {
    const workspaceTabId = result.workspaceTab?.workspaceTabId || "";
    if (!workspaceTabId) continue;

    if (result.liveTab) {
      const liveTab = result.liveTab;
      const url = liveTab.url || result.workspaceTab.url || "";
      const title = liveTab.title || result.workspaceTab.originalTitle || "Untitled tab";
      patches.set(workspaceTabId, {
        workspaceTabId,
        tabId: liveTab.id,
        tabKey: createTabKey(url, title),
        windowId: liveTab.windowId,
        groupId: Number.isInteger(liveTab.groupId) ? liveTab.groupId : -1,
        index: Number.isInteger(liveTab.index) ? liveTab.index : null,
        url,
        displayUrl: createDisplayUrl(url),
        originalTitle: title,
        isOpen: true,
        lastSeenAt: now,
        lastMatchStatus: result.matchStatus,
        candidateCount: result.candidateCount
      });
      continue;
    }

    patches.set(workspaceTabId, {
      workspaceTabId,
      isOpen: false,
      groupId: -1,
      lastMatchStatus: result.matchStatus,
      candidateCount: result.candidateCount
    });
  }

  return patches;
}

function mergeProjectionPatches(workspace, patches) {
  const transitions = [];
  let changedRecordCount = 0;
  const tabs = Array.isArray(workspace.tabs) ? workspace.tabs : [];

  for (const tab of tabs) {
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
    changedRecordCount += 1;
    transitions.push(...detectTransitions(tab, previous, patch));
  }

  return { changedRecordCount, transitions };
}

function captureProjection(tab) {
  return {
    tabId: tab.tabId,
    windowId: tab.windowId,
    groupId: Number.isInteger(tab.groupId) ? tab.groupId : -1,
    url: tab.url || "",
    originalTitle: tab.originalTitle || tab.title || "",
    isOpen: tab.isOpen !== false,
    lastMatchStatus: tab.lastMatchStatus || ""
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

  if (
    Number.isInteger(previous.windowId)
    && Number.isInteger(tab.windowId)
    && previous.windowId !== tab.windowId
  ) {
    transitions.push({
      type: "workspace_tab_window_changed",
      ...base,
      previousWindowId: previous.windowId,
      windowId: tab.windowId
    });
  }

  const currentGroupId = Number.isInteger(tab.groupId) ? tab.groupId : -1;
  if (previous.groupId !== currentGroupId) {
    transitions.push({
      type: "workspace_tab_group_changed",
      ...base,
      previousGroupId: previous.groupId,
      groupId: currentGroupId
    });
  }

  if (previous.url && tab.url && previous.url !== tab.url) {
    transitions.push({
      type: "workspace_tab_url_changed",
      ...base,
      previousUrl: previous.url,
      url: tab.url
    });
  }

  return transitions;
}

function createTransitionEvents(transitions, createdAt, triggers) {
  return transitions.map((transition) => ({
    eventId: crypto.randomUUID(),
    type: transition.type,
    message: createTransitionMessage(transition),
    createdAt,
    reconciliationMode: "automatic_browser_projection",
    reconciliationTriggers: triggers,
    ...transition
  }));
}

function createTransitionMessage(transition) {
  const name = transition.title || "Workspace tab";
  switch (transition.type) {
    case "workspace_tab_became_missing":
      return name + " is no longer open in Chrome and remains available as a missing workspace record.";
    case "workspace_tab_reconnected":
      return name + " reconnected to a live Chrome tab.";
    case "workspace_tab_window_changed":
      return name + " moved to a different Chrome window.";
    case "workspace_tab_group_changed":
      return name + " changed Chrome group state.";
    case "workspace_tab_url_changed":
      return name + " navigated to a different URL.";
    default:
      return name + " browser projection changed.";
  }
}

function calculateProjectionStatus(tabs) {
  const safeTabs = Array.isArray(tabs) ? tabs : [];
  const openCount = safeTabs.filter((tab) => tab.isOpen !== false).length;
  const ambiguousCount = safeTabs.filter((tab) => String(tab.lastMatchStatus || "").startsWith("ambiguous")).length;
  return {
    openCount,
    missingCount: safeTabs.length - openCount,
    ambiguousCount
  };
}

function createSummary(details) {
  return {
    schema: "workspace-projection-reconciliation-summary-v0.1",
    ...details
  };
}

async function readActiveWorkspace() {
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

function createTabKey(url, title) {
  return String(url || "") + "::" + String(title || "");
}

function valuesEqual(left, right) {
  return left === right || (left == null && right == null);
}

function sanitizeTriggerDetails(details) {
  if (!details || typeof details !== "object") return {};
  const output = {};
  for (const [key, value] of Object.entries(details)) {
    if (["string", "number", "boolean"].includes(typeof value) || value === null) {
      output[key] = value;
    }
  }
  return output;
}

function isStartupTrigger(trigger) {
  return ["extension_installed", "extension_startup", "sidepanel_startup"].includes(trigger);
}

function summarizeError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error)
  };
}

export {
  reconcileActiveWorkspaceProjection,
  scheduleWorkspaceProjectionReconciliation
};
