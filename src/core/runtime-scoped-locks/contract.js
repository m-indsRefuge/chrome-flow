import { LOCK_NAMES } from "../runtime-contract/constants.js";
import { isValidRuntimeWorkspaceId } from "../runtime-workspace-record/contract.js";

export const COMPATIBILITY_PROJECTION_LOCK = "constellation-runtime-compatibility-projection-v0.1";
export const SCOPED_LOCK_DOMAINS = Object.freeze({
  scopedExclusive: Object.freeze({ rank: 0, prefix: "constellation-runtime-exclusive-operation:", identity: "workspace" }),
  window: Object.freeze({ rank: 1, prefix: "constellation-runtime-window:", identity: "window" }),
  workspaceBinding: Object.freeze({ rank: 2, prefix: "constellation-runtime-workspace-binding:", identity: "workspace" }),
  runtimeState: Object.freeze({ rank: 3, name: LOCK_NAMES.runtimeState, identity: "global" }),
  workspaceContent: Object.freeze({ rank: 4, prefix: "constellation-runtime-workspace:", identity: "workspace" }),
  browserProjection: Object.freeze({ rank: 5, prefix: "constellation-runtime-projection:", identity: "workspace" })
});

export function deriveExclusiveOperationLock(workspaceId) { return workspaceLock("scopedExclusive", workspaceId); }
export function deriveWindowLock(windowId) {
  if (!Number.isSafeInteger(windowId) || windowId < 0) throw new TypeError("windowId is invalid for a scoped lock");
  return SCOPED_LOCK_DOMAINS["window"].prefix + windowId;
}
export function deriveWorkspaceBindingLock(workspaceId) { return workspaceLock("workspaceBinding", workspaceId); }
export function deriveWorkspaceContentLock(workspaceId) { return workspaceLock("workspaceContent", workspaceId); }
export function deriveBrowserProjectionLock(workspaceId) { return workspaceLock("browserProjection", workspaceId); }

export function describeScopedLock(name) {
  if (name === SCOPED_LOCK_DOMAINS.runtimeState.name) return { valid: true, name, domain: "runtimeState", rank: SCOPED_LOCK_DOMAINS.runtimeState.rank, identity: null };
  if (name === COMPATIBILITY_PROJECTION_LOCK) return { valid: true, name, domain: "compatibilityProjection", rank: null, identity: null };
  if (typeof name !== "string") return { valid: false, name: "", reason: "lock_name_invalid" };
  for (const [domain, definition] of Object.entries(SCOPED_LOCK_DOMAINS)) {
    if (!definition.prefix || !name.startsWith(definition.prefix)) continue;
    const suffix = name.slice(definition.prefix.length);
    if (definition.identity === "window") {
      if (!/^(0|[1-9]\d*)$/.test(suffix)) return { valid: false, name, reason: "window_lock_identity_invalid" };
      const identity = Number(suffix);
      if (!Number.isSafeInteger(identity)) return { valid: false, name, reason: "window_lock_identity_invalid" };
      return { valid: true, name, domain, rank: definition.rank, identity };
    }
    if (!isValidRuntimeWorkspaceId(suffix)) return { valid: false, name, reason: "workspace_lock_identity_invalid" };
    return { valid: true, name, domain, rank: definition.rank, identity: suffix };
  }
  return { valid: false, name, reason: "lock_domain_invalid" };
}

function workspaceLock(domain, workspaceId) {
  if (!isValidRuntimeWorkspaceId(workspaceId)) throw new TypeError("workspaceId is invalid for a scoped lock");
  return SCOPED_LOCK_DOMAINS[domain].prefix + workspaceId;
}
