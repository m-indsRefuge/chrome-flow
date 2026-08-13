import {
  clone,
  isPlainObject,
  nonEmptyString,
  serializableErrors,
  stableStringify,
  validDateTime
} from "../runtime-contract/value-utils.js";
import {
  isValidRuntimeWorkspaceId
} from "../runtime-workspace-record/contract.js";

export const RUNTIME_WORKSPACE_MUTATION_TYPE =
  "constellation-runtime-workspace-mutation";

export const RUNTIME_WORKSPACE_MUTATION_COMMAND_SCHEMA =
  "constellation-runtime-workspace-mutation-command-v0.1";

export const RUNTIME_WORKSPACE_MUTATION_RESULT_SCHEMA =
  "constellation-runtime-workspace-mutation-result-v0.1";

export const RUNTIME_WORKSPACE_MUTATION_KINDS = Object.freeze([
  "journal.append",
  "timeline.append",
  "workspace.metadata.autosave",
  "workspace.metadata.commit",
  "workspace.tab.metadata.commit",
  "search.intake.add"
]);

const COMMAND_FIELDS = Object.freeze([
  "type",
  "schema",
  "operationId",
  "runtimeSessionId",
  "sourceContextId",
  "sourceWindowId",
  "workspaceId",
  "expectedWorkspaceRevision",
  "runtimeAssignmentId",
  "assignmentEpoch",
  "mutationKind",
  "payload",
  "requestedAt"
]);

const RESULT_FIELDS = Object.freeze([
  "schema",
  "status",
  "reason",
  "operationId",
  "runtimeSessionId",
  "sourceContextId",
  "sourceWindowId",
  "workspaceId",
  "runtimeAssignmentId",
  "assignmentEpoch",
  "previousRevision",
  "committedRevision",
  "recordFingerprint",
  "phase",
  "mutationCommitted",
  "authorityVerified",
  "workspaceVerified",
  "ledgerRecorded",
  "retrySafe",
  "indeterminate",
  "warnings",
  "errors"
]);

const RESULT_AUTHORITY_FIELDS = Object.freeze([
  "operationId",
  "runtimeSessionId",
  "sourceContextId",
  "sourceWindowId",
  "workspaceId",
  "runtimeAssignmentId",
  "assignmentEpoch"
]);

export function snapshotAndValidateRuntimeWorkspaceMutationCommand(value) {
  const errors = [];
  let command;

  try {
    if (!isPlainObject(value)) {
      return {
        valid: false,
        errors: ["mutation command must be a plain object"],
        command: null
      };
    }

           errors.push(...serializableErrors(value, "mutationCommand"));

    if (errors.length) {
      return {
        valid: false,
        errors,
        command: null
      };
    }

    command = clone(value);
  } catch (error) {
    return {
      valid: false,
      errors: [
        "mutation command snapshot failed: " +
          String(error?.message || error || "unknown_error")
      ],
      command: null
    };
  }

  if (
    stableStringify(Object.keys(command).sort()) !==
    stableStringify([...COMMAND_FIELDS].sort())
  ) {
    errors.push("mutation command fields must match the exact v0.1 contract");
  }

  if (command.type !== RUNTIME_WORKSPACE_MUTATION_TYPE) {
    errors.push("mutation command type is invalid");
  }

  if (command.schema !== RUNTIME_WORKSPACE_MUTATION_COMMAND_SCHEMA) {
    errors.push("mutation command schema is invalid");
  }

  for (const field of [
    "operationId",
    "runtimeSessionId",
    "sourceContextId",
    "runtimeAssignmentId"
  ]) {
    if (!nonEmptyString(command[field])) {
      errors.push("mutation command " + field + " is invalid");
    }
  }

  if (!isValidRuntimeWorkspaceId(command.workspaceId)) {
    errors.push("mutation command workspaceId is invalid");
  }

  if (
    !Number.isSafeInteger(command.sourceWindowId) ||
    command.sourceWindowId < 0
  ) {
    errors.push("mutation command sourceWindowId is invalid");
  }

  if (
    !Number.isSafeInteger(command.expectedWorkspaceRevision) ||
    command.expectedWorkspaceRevision < 0
  ) {
    errors.push("mutation command expectedWorkspaceRevision is invalid");
  }

  if (
    !Number.isSafeInteger(command.assignmentEpoch) ||
    command.assignmentEpoch <= 0
  ) {
    errors.push("mutation command assignmentEpoch is invalid");
  }

  if (!RUNTIME_WORKSPACE_MUTATION_KINDS.includes(command.mutationKind)) {
    errors.push("mutation command mutationKind is invalid");
  }

  if (!isPlainObject(command.payload)) {
    errors.push("mutation command payload must be a plain object");
  } else {
    errors.push(...validateMutationPayload(command.mutationKind, command.payload));
  }

  if (!validDateTime(command.requestedAt)) {
    errors.push("mutation command requestedAt is invalid");
  }

  return {
    valid: errors.length === 0,
    errors,
    command: errors.length ? null : command
  };
}

function validateMutationPayload(mutationKind, payload) {
  if (mutationKind === "journal.append") {
    return validateJournalAppendPayload(payload);
  }

  if (mutationKind === "timeline.append") {
    return validateTimelineAppendPayload(payload);
  }

  if (mutationKind === "workspace.metadata.autosave") {
    return validateWorkspaceMetadataAutosavePayload(payload);
  }

  if (mutationKind === "workspace.metadata.commit") {
    return validateWorkspaceMetadataCommitPayload(payload);
  }

  if (mutationKind === "workspace.tab.metadata.commit") {
    return validateWorkspaceTabMetadataCommitPayload(payload);
  }

  if (mutationKind === "search.intake.add") {
    return validateSearchIntakeAddPayload(payload);
  }

  return [];
}

function validateJournalAppendPayload(payload) {
  const errors = [];

  exactFields(
    payload,
    ["record"],
    "mutation command journal.append payload",
    errors
  );

  const record = payload.record;

  if (!isPlainObject(record)) {
    errors.push("journal.append record must be a plain object");
    return errors;
  }

  exactFields(
    record,
    [
      "entryId",
      "text",
      "tag",
      "relatedRoleId",
      "relatedRoleLabel",
      "createdAt"
    ],
    "journal.append record",
    errors
  );

  if (!nonEmptyString(record.entryId)) {
    errors.push("journal.append entryId is invalid");
  }

  if (!nonEmptyString(record.text)) {
    errors.push("journal.append text is invalid");
  }

  for (const field of ["tag", "relatedRoleId", "relatedRoleLabel"]) {
    if (typeof record[field] !== "string") {
      errors.push("journal.append " + field + " must be a string");
    }
  }

  if (!validDateTime(record.createdAt)) {
    errors.push("journal.append createdAt is invalid");
  }

  return errors;
}

function validateTimelineAppendPayload(payload) {
  const errors = [];

  exactFields(
    payload,
    ["record"],
    "mutation command timeline.append payload",
    errors
  );

  const record = payload.record;

  if (!isPlainObject(record)) {
    errors.push("timeline.append record must be a plain object");
    return errors;
  }

  if (!nonEmptyString(record.eventId)) {
    errors.push("timeline.append eventId is invalid");
  }

  if (!nonEmptyString(record.type)) {
    errors.push("timeline.append type is invalid");
  }

  if (!nonEmptyString(record.message)) {
    errors.push("timeline.append message is invalid");
  }

  if (!validDateTime(record.createdAt)) {
    errors.push("timeline.append createdAt is invalid");
  }

  return errors;
}

function validateWorkspaceMetadataAutosavePayload(payload) {
  const errors = [];

  exactFields(
    payload,
    ["name", "aim"],
    "mutation command workspace.metadata.autosave payload",
    errors
  );

  if (typeof payload.name !== "string") {
    errors.push("workspace.metadata.autosave name must be a string");
  }

  if (typeof payload.aim !== "string") {
    errors.push("workspace.metadata.autosave aim must be a string");
  }

  return errors;
}

function validateWorkspaceMetadataCommitPayload(payload) {
  const errors = [];

  exactFields(
    payload,
    ["mode", "name", "aim", "workspaceType", "eventId"],
    "mutation command workspace.metadata.commit payload",
    errors
  );

  if (!["save", "type_change"].includes(payload.mode)) {
    errors.push("workspace.metadata.commit mode is invalid");
  }

  if (typeof payload.name !== "string") {
    errors.push("workspace.metadata.commit name must be a string");
  }

  if (typeof payload.aim !== "string") {
    errors.push("workspace.metadata.commit aim must be a string");
  }

  if (!nonEmptyString(payload.workspaceType)) {
    errors.push("workspace.metadata.commit workspaceType is invalid");
  }

  if (!nonEmptyString(payload.eventId)) {
    errors.push("workspace.metadata.commit eventId is invalid");
  }

  return errors;
}

function validateWorkspaceTabMetadataCommitPayload(payload) {
  const errors = [];

  exactFields(
    payload,
    ["workspaceTabId", "field", "value", "eventId"],
    "mutation command workspace.tab.metadata.commit payload",
    errors
  );

  if (!nonEmptyString(payload.workspaceTabId)) {
    errors.push("workspace.tab.metadata.commit workspaceTabId is invalid");
  }

  if (!["alias", "role"].includes(payload.field)) {
    errors.push("workspace.tab.metadata.commit field is invalid");
  }

  if (typeof payload.value !== "string") {
    errors.push("workspace.tab.metadata.commit value must be a string");
  }

  if (!nonEmptyString(payload.eventId)) {
    errors.push("workspace.tab.metadata.commit eventId is invalid");
  }

  return errors;
}

function validateSearchIntakeAddPayload(payload) {
  const errors = [];

  exactFields(
    payload,
    ["tab", "query", "eventId", "sameUrlDuplicate"],
    "mutation command search.intake.add payload",
    errors
  );

  const tab = payload.tab;

  if (!isPlainObject(tab)) {
    errors.push("search.intake.add tab must be a plain object");
  } else {
    if (!nonEmptyString(tab.workspaceTabId)) {
      errors.push("search.intake.add workspaceTabId is invalid");
    }

    if (!Number.isSafeInteger(tab.tabId) || tab.tabId < 0) {
      errors.push("search.intake.add tabId is invalid");
    }

    if (!Number.isSafeInteger(tab.windowId) || tab.windowId < 0) {
      errors.push("search.intake.add windowId is invalid");
    }
  }

  if (typeof payload.query !== "string") {
    errors.push("search.intake.add query must be a string");
  }

  if (!nonEmptyString(payload.eventId)) {
    errors.push("search.intake.add eventId is invalid");
  }

  if (typeof payload.sameUrlDuplicate !== "boolean") {
    errors.push("search.intake.add sameUrlDuplicate must be boolean");
  }

  return errors;
}

function exactFields(value, expectedFields, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(path + " must be a plain object");
    return;
  }

  if (
    stableStringify(Object.keys(value).sort()) !==
    stableStringify([...expectedFields].sort())
  ) {
    errors.push(path + " fields must match the exact contract");
  }
}

export function createRuntimeWorkspaceMutationResult(command, fields = {}) {
  return {
    schema: RUNTIME_WORKSPACE_MUTATION_RESULT_SCHEMA,
    status: safeStatus(readField(fields, "status")),
    reason: safeString(readField(fields, "reason")),
    operationId: safeNonEmptyString(readField(command, "operationId")),
    runtimeSessionId: safeNonEmptyString(readField(command, "runtimeSessionId")),
    sourceContextId: safeNonEmptyString(readField(command, "sourceContextId")),
    sourceWindowId: safeWindow(readField(command, "sourceWindowId")),
    workspaceId: safeWorkspaceId(readField(command, "workspaceId")),
    runtimeAssignmentId: safeNonEmptyString(
      readField(command, "runtimeAssignmentId")
    ),
    assignmentEpoch: safePositiveInteger(readField(command, "assignmentEpoch")),
    previousRevision: safeRevision(readField(fields, "previousRevision")),
    committedRevision: safeRevision(readField(fields, "committedRevision")),
    recordFingerprint: safeString(readField(fields, "recordFingerprint")),
    phase: safePhase(readField(fields, "phase")),
    mutationCommitted: readField(fields, "mutationCommitted") === true,
    authorityVerified: readField(fields, "authorityVerified") === true,
    workspaceVerified: readField(fields, "workspaceVerified") === true,
    ledgerRecorded: readField(fields, "ledgerRecorded") === true,
    retrySafe: readField(fields, "retrySafe") === true,
    indeterminate: readField(fields, "indeterminate") === true,
    warnings: stringArray(readField(fields, "warnings")),
    errors: stringArray(readField(fields, "errors"))
  };
}

export function validateRuntimeWorkspaceMutationResult(value, expected = {}) {
  const errors = [];
  let result;

  try {
    if (!isPlainObject(value)) {
      return {
        valid: false,
        errors: ["mutation result must be a plain object"],
        result: null
      };
    }

    errors.push(...serializableErrors(value, "mutationResult"));

    if (errors.length) {
      return {
        valid: false,
        errors,
        result: null
      };
    }

    result = clone(value);

    exactFields(result, RESULT_FIELDS, "mutation result", errors);

    if (result.schema !== RUNTIME_WORKSPACE_MUTATION_RESULT_SCHEMA) {
      errors.push("mutation result schema is invalid");
    }

    if (!nonEmptyString(result.status)) {
      errors.push("mutation result status is invalid");
    }

    if (typeof result.reason !== "string") {
      errors.push("mutation result reason is invalid");
    }

    if (!nonEmptyString(result.operationId)) {
      errors.push("mutation result operationId is invalid");
    }

    if (!nonEmptyString(result.runtimeSessionId)) {
      errors.push("mutation result runtimeSessionId is invalid");
    }

    if (!nonEmptyString(result.sourceContextId)) {
      errors.push("mutation result sourceContextId is invalid");
    }

    if (!Number.isSafeInteger(result.sourceWindowId) || result.sourceWindowId < 0) {
      errors.push("mutation result sourceWindowId is invalid");
    }

    if (!isValidRuntimeWorkspaceId(result.workspaceId)) {
      errors.push("mutation result workspaceId is invalid");
    }

    if (!nonEmptyString(result.runtimeAssignmentId)) {
      errors.push("mutation result runtimeAssignmentId is invalid");
    }

    if (
      !Number.isSafeInteger(result.assignmentEpoch) ||
      result.assignmentEpoch <= 0
    ) {
      errors.push("mutation result assignmentEpoch is invalid");
    }

    for (const field of ["previousRevision", "committedRevision"]) {
      if (!isRevisionEvidence(result[field])) {
        errors.push("mutation result " + field + " is invalid");
      }
    }

    if (typeof result.recordFingerprint !== "string") {
      errors.push("mutation result recordFingerprint is invalid");
    }

    if (!nonEmptyString(result.phase)) {
      errors.push("mutation result phase is invalid");
    }

    for (const field of [
      "mutationCommitted",
      "authorityVerified",
      "workspaceVerified",
      "ledgerRecorded",
      "retrySafe",
      "indeterminate"
    ]) {
      if (typeof result[field] !== "boolean") {
        errors.push("mutation result " + field + " is invalid");
      }
    }

    if (!stringArrayIsValid(result.warnings)) {
      errors.push("mutation result warnings are invalid");
    }

    if (!stringArrayIsValid(result.errors)) {
      errors.push("mutation result errors are invalid");
    }

    if (!isPlainObject(expected)) {
      errors.push("mutation result expected authority must be a plain object");
    } else {
      for (const field of RESULT_AUTHORITY_FIELDS) {
        if (Object.hasOwn(expected, field) && result[field] !== expected[field]) {
          errors.push("mutation result authority does not match expected " + field);
        }
      }
    }
  } catch (error) {
    return {
      valid: false,
      errors: [
        "mutation result snapshot failed: " +
          String(error?.message || error || "unknown_error")
      ],
      result: null
    };
  }

  return {
    valid: errors.length === 0,
    errors,
    result: errors.length ? null : result
  };
}

export function runtimeWorkspaceMutationFingerprint(command) {
  const validation = snapshotAndValidateRuntimeWorkspaceMutationCommand(command);

  if (!validation.valid) {
    throw new TypeError(validation.errors.join("; "));
  }

  const { requestedAt, ...semanticCommand } = validation.command;
  return fingerprintText(stableStringify(semanticCommand));
}

export function isRuntimeWorkspaceMutationMessage(message) {
  try {
    return (
      message?.type === RUNTIME_WORKSPACE_MUTATION_TYPE ||
      message?.schema === RUNTIME_WORKSPACE_MUTATION_COMMAND_SCHEMA
    );
  } catch {
    return false;
  }
}

function readField(value, field) {
  try {
    return value?.[field];
  } catch {
    return undefined;
  }
}

function safeString(value) {
  return typeof value === "string" ? value : "";
}

function safeNonEmptyString(value) {
  return nonEmptyString(value) ? value : "";
}

function safeStatus(value) {
  return nonEmptyString(value) ? value : "failed";
}

function safePhase(value) {
  return nonEmptyString(value) ? value : "none";
}

function safeWindow(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : -1;
}

function safeWorkspaceId(value) {
  return isValidRuntimeWorkspaceId(value) ? value : "";
}

function safePositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : -1;
}

function safeRevision(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isRevisionEvidence(value) {
  return value === null || (Number.isSafeInteger(value) && value >= 0);
}

function stringArray(value) {
  try {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function stringArrayIsValid(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function fingerprintText(text) {
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return "fnv1a32:" + (hash >>> 0).toString(16).padStart(8, "0") + ":" + text.length;
}
