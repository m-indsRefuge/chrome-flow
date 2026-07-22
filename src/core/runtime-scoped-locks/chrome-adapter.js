import { COMPATIBILITY_PROJECTION_LOCK } from "./contract.js";
import { validateScopedLockPlan } from "./ordering.js";

export async function runWithScopedLocks(plan, callback, options = {}) {
  if (typeof callback !== "function") throw lockError("lock_callback_invalid");
  const validation = validateScopedLockPlan(plan, { heldLocks: options.heldLocks || [] });
  if (!validation.valid) throw lockError("scoped_lock_plan_invalid", validation.errors);
  const requestLock = resolveRequestLock(options);
  if (!requestLock) throw lockError("web_locks_unavailable");
  return acquireAt(0);

  async function acquireAt(index) {
    if (index === validation.locks.length) return callback();
    const name = validation.locks[index];
    let invocations = 0;
    const output = await requestLock(name, async () => {
      invocations += 1;
      if (invocations !== 1) throw lockError("lock_callback_reused", [name]);
      return acquireAt(index + 1);
    });
    if (invocations !== 1) throw lockError("lock_callback_not_invoked", [name]);
    return output;
  }
}

export async function runWithCompatibilityProjectionLock(callback, options = {}) {
  if (typeof callback !== "function") throw lockError("lock_callback_invalid");
  if (Array.isArray(options.heldLocks) && options.heldLocks.length) throw lockError("compatibility_lock_must_not_nest");
  const requestLock = resolveRequestLock(options);
  if (!requestLock) throw lockError("web_locks_unavailable");
  let invocations = 0;
  const output = await requestLock(COMPATIBILITY_PROJECTION_LOCK, async () => {
    invocations += 1;
    if (invocations !== 1) throw lockError("lock_callback_reused", [COMPATIBILITY_PROJECTION_LOCK]);
    return callback();
  });
  if (invocations !== 1) throw lockError("lock_callback_not_invoked", [COMPATIBILITY_PROJECTION_LOCK]);
  return output;
}

function resolveRequestLock(options) {
  if (Object.hasOwn(options, "requestLock")) return typeof options.requestLock === "function" ? options.requestLock : null;
  if (globalThis.navigator?.locks?.request) return globalThis.navigator.locks.request.bind(globalThis.navigator.locks);
  return null;
}

function lockError(reason, details = []) {
  const error = new Error(reason + (details.length ? ": " + details.join("; ") : ""));
  error.reason = reason;
  error.details = [...details];
  return error;
}
