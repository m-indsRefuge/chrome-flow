import { LOCK_NAMES } from "../runtime-contract/constants.js";
import {
  COMPATIBILITY_PROJECTION_LOCK,
  deriveBrowserProjectionLock,
  deriveExclusiveOperationLock,
  deriveWindowLock,
  deriveWorkspaceBindingLock,
  deriveWorkspaceContentLock,
  describeScopedLock
} from "./contract.js";

const PLAN_FIELDS = new Set([
  "exclusiveWorkspaceIds",
  "windowIds",
  "workspaceBindingIds",
  "includeRuntimeState",
  "runtimeStateReason",
  "workspaceContentIds",
  "browserProjectionIds"
]);
const RUNTIME_STATE_REASONS = new Set(["session_root_write", "protected_shared_ledger_write"]);

export function buildScopedLockPlan(request = {}) {
  if (request === null || typeof request !== "object" || Array.isArray(request)) throw new TypeError("scoped lock plan request must be a plain object");
  for (const field of Object.keys(request)) if (!PLAN_FIELDS.has(field)) throw new TypeError("unknown scoped lock plan field: " + field);
  const locks = [];
  for (const workspaceId of unique(request.exclusiveWorkspaceIds, "exclusiveWorkspaceIds")) locks.push(deriveExclusiveOperationLock(workspaceId));
  for (const windowId of unique(request.windowIds, "windowIds")) locks.push(deriveWindowLock(windowId));
  for (const workspaceId of unique(request.workspaceBindingIds, "workspaceBindingIds")) locks.push(deriveWorkspaceBindingLock(workspaceId));
  if (request.includeRuntimeState === true) {
    if (!RUNTIME_STATE_REASONS.has(request.runtimeStateReason)) throw new TypeError("runtimeStateReason must identify a session-root or protected shared-ledger write");
    locks.push(LOCK_NAMES.runtimeState);
  } else if (request.runtimeStateReason !== undefined) throw new TypeError("runtimeStateReason is invalid without includeRuntimeState");
  for (const workspaceId of unique(request.workspaceContentIds, "workspaceContentIds")) locks.push(deriveWorkspaceContentLock(workspaceId));
  for (const workspaceId of unique(request.browserProjectionIds, "browserProjectionIds")) locks.push(deriveBrowserProjectionLock(workspaceId));
  locks.sort(compareScopedLocks);
  return Object.freeze(locks);
}

export function compareScopedLocks(left, right) {
  const a = describeScopedLock(left);
  const b = describeScopedLock(right);
  if (!a.valid || !b.valid || a.domain === "compatibilityProjection" || b.domain === "compatibilityProjection") throw new TypeError("only primary scoped locks can be ordered");
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.identity === null) return 0;
  if (typeof a.identity === "number") return a.identity - b.identity;
  return compareCodeUnits(a.identity, b.identity);
}

export function validateScopedLockPlan(plan, options = {}) {
  const errors = [];
  if (!Array.isArray(plan)) return { valid: false, errors: ["scoped lock plan must be an array"], locks: [] };
  const seen = new Set();
  const locks = [];
  for (const name of plan) {
    const description = describeScopedLock(name);
    if (!description.valid) errors.push(description.reason);
    else if (description.domain === "compatibilityProjection") errors.push("compatibility projection lock is outside every primary plan");
    else locks.push(name);
    if (seen.has(name)) errors.push("scoped lock plan contains a duplicate lock");
    seen.add(name);
  }
  for (let index = 1; index < locks.length; index += 1) {
    try { if (compareScopedLocks(locks[index - 1], locks[index]) > 0) errors.push("scoped lock plan contains an inversion"); }
    catch (error) { errors.push(String(error?.message || error)); }
  }
  const heldLocks = options.heldLocks || [];
  if (!Array.isArray(heldLocks)) errors.push("heldLocks must be an array");
  else if (heldLocks.includes(COMPATIBILITY_PROJECTION_LOCK) && locks.length) errors.push("primary locks cannot be acquired while compatibility projection is held");
  else if (heldLocks.length && locks.length) {
    const heldValidation = validateScopedLockPlan(heldLocks);
    if (!heldValidation.valid) errors.push(...heldValidation.errors.map((error) => "held lock: " + error));
    else {
      const all = [...heldLocks, ...locks];
      if (new Set(all).size !== all.length) errors.push("new scoped plan repeats a held lock");
      try { if (compareScopedLocks(heldLocks.at(-1), locks[0]) > 0) errors.push("scoped lock acquisition would invert held order"); }
      catch (error) { errors.push(String(error?.message || error)); }
    }
  }
  return { valid: errors.length === 0, errors, locks: errors.length ? [] : [...locks] };
}

function unique(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(field + " must be an array");
  return [...new Set(value)];
}
function compareCodeUnits(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
