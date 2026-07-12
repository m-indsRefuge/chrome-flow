import { CONTEXT_TYPES, SCHEMAS } from "./constants.js";
import { nonEmptyString, validDateTime } from "./value-utils.js";
export function createRuntimeContext(contextType, options = {}) {
  const id = options.id || (() => globalThis.crypto.randomUUID());
  const clock = options.clock || (() => new Date().toISOString());
  return { schema: SCHEMAS.context, contextId: id(), contextType, createdAt: clock() };
}
export function validateRuntimeContext(value) {
  const errors = [];
  if (value?.schema !== SCHEMAS.context) errors.push("schema must match runtime context schema");
  if (!nonEmptyString(value?.contextId)) errors.push("contextId must be a non-empty string");
  if (!CONTEXT_TYPES.includes(value?.contextType)) errors.push("contextType is unsupported");
  if (!validDateTime(value?.createdAt)) errors.push("createdAt must be a valid date-time string");
  return { valid: errors.length === 0, errors };
}
