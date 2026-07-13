import { clone, isPlainObject, nonEmptyString, serializableErrors, stableStringify } from "./value-utils.js";
export const WORKSPACE_METADATA_FIELDS = Object.freeze(["name", "aim", "workspaceType"]);
export const TAB_METADATA_FIELDS = Object.freeze(["alias", "role"]);
export const TAB_PROJECTION_FIELDS = Object.freeze(["tabId", "tabKey", "windowId", "groupId", "url", "displayUrl", "originalTitle", "isOpen", "firstSeenAt", "lastSeenAt", "lastMatchStatus", "pinned", "index"]);
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
  const supported = ["journal.append", "timeline.append", "workspace.metadata.patch", "workspace.tab.add", "workspace.tab.remove", "workspace.tab.metadata.patch", "workspace.tab.projection.patch"];
  if (!supported.includes(mutationType)) return reject("unsupported_mutation_type");
  const next = clone(workspace);
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
