import { clone, isPlainObject, nonEmptyString, serializableErrors, stableStringify } from "./value-utils.js";
export const WORKSPACE_METADATA_FIELDS = Object.freeze(["name", "aim", "workspaceType"]);
export const TAB_METADATA_FIELDS = Object.freeze(["alias", "role"]);
export const TAB_PROJECTION_FIELDS = Object.freeze(["tabId", "tabKey", "windowId", "groupId", "url", "displayUrl", "originalTitle", "isOpen", "firstSeenAt", "lastSeenAt", "lastMatchStatus", "pinned", "index"]);
export const RECONCILIATION_PROJECTION_FIELDS = Object.freeze(["tabId", "tabKey", "windowId", "groupId", "index", "url", "displayUrl", "originalTitle", "isOpen", "lastMatchStatus"]);
const RECONCILIATION_SCHEMA = "constellation-workspace-projection-reconcile-v0.1";
const reject = (reason) => ({ outcome: "rejected", reason });
function patchRecord(source, patch, allowed, crossClass = []) {
  if (!isPlainObject(patch)) return reject("patch_must_be_plain_object");
  const keys = Object.keys(patch);
  if (keys.includes("workspaceTabId")) return reject("workspace_tab_id_is_immutable");
  if (keys.some((key) => crossClass.includes(key))) return reject("cross_class_patch_field");
  if (keys.some((key) => !allowed.includes(key))) return reject("unknown_patch_field");
  if (serializableErrors(patch, "patch").length) return reject("patch_not_serializable");
  const next = { ...source, ...clone(patch) };
  return stableStringify(next) === stableStringify(source) ? { outcome: "no_change", value: source } : { outcome: "changed", value: next };
}
export function applyDomainMutation(workspace, mutationType, payload) {
  const supported = ["journal.append", "timeline.append", "workspace.metadata.patch", "workspace.tab.add", "workspace.tab.remove", "workspace.tab.metadata.patch", "workspace.tab.projection.patch", "workspace.projection.reconcile"];
  if (!supported.includes(mutationType)) return reject("unsupported_mutation_type");
  const next = clone(workspace);
  if (mutationType === "workspace.projection.reconcile") return reconcileWorkspaceProjection(next, payload);
  if (mutationType === "journal.append" || mutationType === "timeline.append") {
    const field = mutationType.startsWith("journal") ? "journal" : "timeline";
    if (!isPlainObject(payload.record) || serializableErrors(payload.record, "record").length) return reject("record_must_be_serializable_plain_object");
    if (field === "journal") {
      if (!nonEmptyString(payload.record.entryId)) return reject("journal_entry_id_required");
      const existing = (Array.isArray(next.journal) ? next.journal : []).find((entry) => entry.entryId === payload.record.entryId);
      if (existing) return stableStringify(existing) === stableStringify(payload.record)
        ? { outcome: "no_change", workspace: next, reason: "journal_entry_already_applied" }
        : reject("journal_entry_id_conflict");
    }
    next[field] = [...(Array.isArray(next[field]) ? next[field] : []), clone(payload.record)]; return { outcome: "changed", workspace: next };
  }
  if (mutationType === "workspace.metadata.patch") {
    const result = patchRecord(next, payload.patch, WORKSPACE_METADATA_FIELDS);
    return result.outcome === "changed" ? { outcome: "changed", workspace: result.value } : { ...result, workspace: next };
  }
  if (mutationType === "workspace.tab.add" && Object.hasOwn(payload, "workspaceTabId")) return reject("redundant_workspace_tab_id");
  const id = mutationType === "workspace.tab.add" ? payload.tab?.workspaceTabId : payload.workspaceTabId;
  if (!nonEmptyString(id)) return reject("workspace_tab_id_required");
  const tabs = Array.isArray(next.tabs) ? next.tabs : [];
  const index = tabs.findIndex((tab) => tab.workspaceTabId === id);
  if (mutationType === "workspace.tab.add") {
    if (!isPlainObject(payload.tab) || serializableErrors(payload.tab, "tab").length) return reject("tab_must_be_serializable_plain_object");
    if (index >= 0) return reject("duplicate_workspace_tab_id");
    next.tabs = [...tabs, clone(payload.tab)]; return { outcome: "changed", workspace: next };
  }
  if (mutationType === "workspace.tab.remove") {
    if (index < 0) return { outcome: "no_change", workspace: next };
    next.tabs = tabs.filter((_, candidate) => candidate !== index); return { outcome: "changed", workspace: next };
  }
  if (index < 0) return reject("workspace_tab_not_found");
  const metadata = mutationType === "workspace.tab.metadata.patch";
  const result = patchRecord(tabs[index], payload.patch, metadata ? TAB_METADATA_FIELDS : TAB_PROJECTION_FIELDS, metadata ? TAB_PROJECTION_FIELDS : TAB_METADATA_FIELDS);
  if (result.outcome !== "changed") return { ...result, workspace: next };
  next.tabs = [...tabs]; next.tabs[index] = result.value; return { outcome: "changed", workspace: next };
}

function reconcileWorkspaceProjection(next, payload) {
  if (!isPlainObject(payload) || serializableErrors(payload, "payload").length) return reject("invalid_reconciliation_payload");
  if (!hasExactFields(payload, ["schema", "operationId", "snapshot", "patches", "triggers", "reconciledAt"])) return reject("invalid_reconciliation_payload_fields");
  if (payload.schema !== RECONCILIATION_SCHEMA || !nonEmptyString(payload.operationId) || !validDate(payload.reconciledAt)) return reject("invalid_reconciliation_identity");
  if (!isPlainObject(payload.snapshot) || !hasExactFields(payload.snapshot, ["workspaceId", "observedWorkspaceRevision", "capturedAt", "workspaceTabIds"])) return reject("invalid_reconciliation_snapshot");
  if (!nonEmptyString(payload.snapshot.workspaceId) || payload.snapshot.workspaceId !== next.workspaceId || !Number.isInteger(payload.snapshot.observedWorkspaceRevision) || payload.snapshot.observedWorkspaceRevision < 0 || !validDate(payload.snapshot.capturedAt)) return reject("invalid_reconciliation_snapshot");
  if (!Array.isArray(payload.snapshot.workspaceTabIds) || !uniqueNonEmptyStrings(payload.snapshot.workspaceTabIds)) return reject("invalid_reconciliation_tab_membership");
  if (!Array.isArray(payload.triggers) || !uniqueSortedNonEmptyStrings(payload.triggers)) return reject("invalid_reconciliation_triggers");
  if (!Array.isArray(payload.patches) || payload.patches.length !== payload.snapshot.workspaceTabIds.length) return reject("invalid_reconciliation_patch_set");
  const patches = payload.patches;
  if (!isSortedByWorkspaceTabId(patches)) return reject("nondeterministic_reconciliation_patch_order");
  if (!uniqueNonEmptyStrings(patches.map((item) => item?.workspaceTabId))) return reject("duplicate_reconciliation_workspace_tab_id");
  const membership = new Set(payload.snapshot.workspaceTabIds);
  if (patches.some((item) => !membership.has(item?.workspaceTabId))) return reject("reconciliation_patch_outside_snapshot");
  if (!Array.isArray(next.tabs)) return reject("invalid_workspace_tabs");
  const currentIds = next.tabs.map((tab) => tab?.workspaceTabId);
  if (currentIds.some((id) => !nonEmptyString(id))) return reject("invalid_workspace_tab_identity");
  if (new Set(currentIds).size !== currentIds.length) return reject("duplicate_workspace_tab_id");
  const byId = new Map(next.tabs.map((tab, index) => [tab?.workspaceTabId, { tab, index }]));
  for (const patch of patches) {
    const invalid = validateReconciliationPatch(patch);
    if (invalid) return reject(invalid);
    const current = byId.get(patch.workspaceTabId);
    if (!current) continue;
    if (stableStringify(captureOwnedProjection(current.tab)) !== stableStringify(patch.observedProjection)) return reject("projection_baseline_changed");
  }
  const changedTabs = new Map();
  const transitions = [];
  for (const patch of patches) {
    const current = byId.get(patch.workspaceTabId);
    if (!current) continue;
    const before = current.tab;
    const after = { ...before };
    let changed = false;
    for (const field of RECONCILIATION_PROJECTION_FIELDS) {
      if (!Object.hasOwn(patch.projection, field) || valuesEqual(after[field], patch.projection[field])) continue;
      after[field] = clone(patch.projection[field]); changed = true;
    }
    if (!changed) continue;
    after.lastSeenAt = payload.reconciledAt;
    changedTabs.set(current.index, after);
    transitions.push(...deriveTransitions(before, after, patch.candidateCount));
  }
  if (!changedTabs.size) return { outcome: "no_change", workspace: next, reason: "projection_current" };
  if (Object.hasOwn(next, "timeline") && !Array.isArray(next.timeline)) return reject("invalid_workspace_timeline");
  next.tabs = next.tabs.map((tab, index) => changedTabs.get(index) || tab);
  const orderedTransitions = transitions.sort(compareTransitions);
  const transitionEvents = orderedTransitions.map((transition, index) => createTransitionEvent(transition, payload, index));
  const status = calculateProjectionStatus(next.tabs);
  const summary = {
    recordsExamined: payload.snapshot.workspaceTabIds.length,
    recordsChanged: changedTabs.size,
    openCount: status.openCount,
    missingCount: status.missingCount,
    ambiguousCount: status.ambiguousCount
  };
  next.timeline = [...(Array.isArray(next.timeline) ? next.timeline : []), ...transitionEvents, createSummaryEvent(summary, payload)];
  next.updatedAt = payload.reconciledAt;
  next.projectionReconciliation = { schema: "workspace-projection-reconciliation-v0.4", reconciledAt: payload.reconciledAt, triggers: clone(payload.triggers), ...summary };
  return { outcome: "changed", workspace: next, details: { ...summary, transitionCount: transitionEvents.length } };
}

function validateReconciliationPatch(patch) {
  if (!isPlainObject(patch) || !hasExactFields(patch, ["workspaceTabId", "observedProjection", "projection", "candidateCount"])) return "invalid_reconciliation_patch";
  if (!nonEmptyString(patch.workspaceTabId) || !Number.isInteger(patch.candidateCount) || patch.candidateCount < 0) return "invalid_reconciliation_patch";
  if (!validProjectionObject(patch.observedProjection, [...RECONCILIATION_PROJECTION_FIELDS, "lastSeenAt"]) || !validProjectionObject(patch.projection, RECONCILIATION_PROJECTION_FIELDS)) return "invalid_reconciliation_projection";
  return null;
}
function validProjectionObject(value, allowed) {
  if (!isPlainObject(value) || Object.keys(value).some((key) => !allowed.includes(key))) return false;
  for (const [key, item] of Object.entries(value)) {
    if (["tabId", "windowId", "groupId"].includes(key) && !Number.isInteger(item)) return false;
    if (key === "index" && item !== null && !Number.isInteger(item)) return false;
    if (["tabKey", "url", "displayUrl", "originalTitle", "lastMatchStatus"].includes(key) && typeof item !== "string") return false;
    if (key === "isOpen" && typeof item !== "boolean") return false;
    if (key === "lastSeenAt" && !validDate(item)) return false;
  }
  return serializableErrors(value, "projection").length === 0;
}
function captureOwnedProjection(tab) {
  const projection = {};
  for (const field of [...RECONCILIATION_PROJECTION_FIELDS, "lastSeenAt"]) if (Object.hasOwn(tab, field) && tab[field] !== undefined) projection[field] = clone(tab[field]);
  return projection;
}
function deriveTransitions(before, after, candidateCount) {
  const transitions = []; const base = { workspaceTabId: after.workspaceTabId, tabId: Number.isInteger(after.tabId) ? after.tabId : null, url: after.url || "", title: after.alias || after.originalTitle || after.displayUrl || after.url || "workspace tab", matchStatus: after.lastMatchStatus || "", candidateCount };
  if (before.isOpen !== false && after.isOpen === false) transitions.push({ type: "workspace_tab_became_missing", ...base });
  else if (before.isOpen === false && after.isOpen !== false) transitions.push({ type: "workspace_tab_reconnected", ...base });
  if (Number.isInteger(before.windowId) && Number.isInteger(after.windowId) && before.windowId !== after.windowId) transitions.push({ type: "workspace_tab_window_changed", ...base, previousWindowId: before.windowId, windowId: after.windowId });
  const beforeGroup = Number.isInteger(before.groupId) ? before.groupId : -1; const afterGroup = Number.isInteger(after.groupId) ? after.groupId : -1;
  if (beforeGroup !== afterGroup) transitions.push({ type: "workspace_tab_group_changed", ...base, previousGroupId: beforeGroup, groupId: afterGroup });
  if (before.url && after.url && before.url !== after.url) transitions.push({ type: "workspace_tab_url_changed", ...base, previousUrl: before.url, url: after.url });
  return transitions;
}
const TRANSITION_ORDER = ["workspace_tab_became_missing", "workspace_tab_reconnected", "workspace_tab_window_changed", "workspace_tab_group_changed", "workspace_tab_url_changed"];
function compareTransitions(left, right) { return left.workspaceTabId.localeCompare(right.workspaceTabId) || TRANSITION_ORDER.indexOf(left.type) - TRANSITION_ORDER.indexOf(right.type); }
function createTransitionEvent(transition, payload, index) { return { eventId: payload.operationId + ":transition:" + index + ":" + transition.type, type: transition.type, message: transitionMessage(transition), createdAt: payload.reconciledAt, reconciliationMode: "automatic_browser_projection", reconciliationTriggers: clone(payload.triggers), ...transition }; }
function createSummaryEvent(summary, payload) { return { eventId: payload.operationId + ":summary:workspace_tabs_refreshed", type: "workspace_tabs_refreshed", message: "Workspace browser projection reconciled automatically: " + summary.openCount + " open, " + summary.missingCount + " missing, " + summary.ambiguousCount + " ambiguous.", createdAt: payload.reconciledAt, automaticReconciliation: true, reconciliationMode: "automatic_browser_projection", reconciliationTriggers: clone(payload.triggers), foundCount: summary.openCount, missingCount: summary.missingCount, ambiguousCount: summary.ambiguousCount, recordsChanged: summary.recordsChanged }; }
function transitionMessage(transition) { const name=transition.title||"Workspace tab"; if(transition.type==="workspace_tab_became_missing")return name+" is no longer open in Chrome and remains available as a missing workspace record.";if(transition.type==="workspace_tab_reconnected")return name+" reconnected to a live Chrome tab.";if(transition.type==="workspace_tab_window_changed")return name+" moved to a different Chrome window.";if(transition.type==="workspace_tab_group_changed")return name+" changed Chrome group state.";if(transition.type==="workspace_tab_url_changed")return name+" navigated to a different URL.";return name+" browser projection changed."; }
function calculateProjectionStatus(tabs) { const openCount=tabs.filter((tab)=>tab.isOpen!==false).length;const ambiguousCount=tabs.filter((tab)=>String(tab.lastMatchStatus||"").startsWith("ambiguous")).length;return{openCount,missingCount:tabs.length-openCount,ambiguousCount}; }
function hasExactFields(value, fields) { const keys=Object.keys(value).sort();return keys.length===fields.length&&keys.every((key,index)=>key===fields.slice().sort()[index]); }
function uniqueNonEmptyStrings(values) { return values.every(nonEmptyString) && new Set(values).size === values.length; }
function uniqueSortedNonEmptyStrings(values) { return uniqueNonEmptyStrings(values) && values.every((value,index)=>index===0||values[index-1].localeCompare(value)<0); }
function isSortedByWorkspaceTabId(patches) { return patches.every((patch,index)=>index===0||String(patches[index-1]?.workspaceTabId||"").localeCompare(String(patch?.workspaceTabId||""))<0); }
function validDate(value) { return nonEmptyString(value) && !Number.isNaN(Date.parse(value)); }
function valuesEqual(left, right) { return left === right || (left == null && right == null); }
