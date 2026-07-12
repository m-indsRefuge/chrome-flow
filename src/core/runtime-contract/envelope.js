import { CONTEXT_TYPES, MUTATION_TYPES, SCHEMAS } from "./constants.js";
import { isPlainObject, nonEmptyString, serializableErrors, stableStringify, validDateTime } from "./value-utils.js";
export function validateMutationEnvelope(value) {
  const errors = [];
  if (!isPlainObject(value)) return { valid: false, errors: ["envelope must be a plain object"] };
  if (value.schema !== SCHEMAS.mutation) errors.push("schema must match mutation schema");
  for (const field of ["operationId", "contextId", "workspaceId"]) if (!nonEmptyString(value[field])) errors.push(field + " must be a non-empty string");
  if (!CONTEXT_TYPES.includes(value.contextType)) errors.push("contextType is unsupported");
  if (!Number.isInteger(value.expectedRevision) || value.expectedRevision < 0) errors.push("expectedRevision must be a non-negative integer");
  if (!MUTATION_TYPES.includes(value.mutationType)) errors.push("mutationType is unsupported");
  if (!isPlainObject(value.payload)) errors.push("payload must be a plain object"); else errors.push(...serializableErrors(value.payload));
  if (!validDateTime(value.requestedAt)) errors.push("requestedAt must be a valid date-time string");
  if (!isPlainObject(value.authorization) || !nonEmptyString(value.authorization.mode)) errors.push("authorization.mode must be a non-empty string");
  else errors.push(...serializableErrors(value.authorization, "authorization"));
  const hasId = nonEmptyString(value.runtimeAssignmentId);
  const hasEpoch = Number.isInteger(value.assignmentEpoch) && value.assignmentEpoch > 0;
  if (value.runtimeAssignmentId != null && value.runtimeAssignmentId !== "" && !hasId) errors.push("runtimeAssignmentId must be a non-empty string when supplied");
  if (value.assignmentEpoch != null && !hasEpoch) errors.push("assignmentEpoch must be a positive integer when supplied");
  if (hasId !== hasEpoch) errors.push("runtimeAssignmentId and assignmentEpoch must be supplied together");
  return { valid: errors.length === 0, errors };
}
export function createRequestFingerprint(envelope) {
  const semantic = {};
  for (const key of ["schema", "operationId", "contextId", "contextType", "runtimeAssignmentId", "assignmentEpoch", "workspaceId", "expectedRevision", "mutationType", "payload", "authorization"]) if (envelope[key] !== undefined) semantic[key] = envelope[key];
  const canonical = stableStringify(semantic);
  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index += 1) { hash ^= canonical.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return "fnv1a32:" + (hash >>> 0).toString(16).padStart(8, "0") + ":" + canonical.length;
}
