import { normalizeWorkspaceRevision } from "../runtime-contract/revision.js";
import {
  clone,
  isPlainObject,
  nonEmptyString,
  serializableErrors
} from "../runtime-contract/value-utils.js";
import { isValidRuntimeWorkspaceId } from "../runtime-workspace-record/contract.js";
import {
  SIDE_PANEL_ASSIGNED_WORKSPACE_AUTHORITY_SCHEMA
} from "../runtime-window-binding/side-panel-authority.js";
import {
  RUNTIME_WORKSPACE_MUTATION_COMMAND_SCHEMA,
  RUNTIME_WORKSPACE_MUTATION_TYPE,
  createRuntimeWorkspaceMutationResult,
  snapshotAndValidateRuntimeWorkspaceMutationCommand,
  validateRuntimeWorkspaceMutationResult
} from "./contract.js";

export function createRuntimeWorkspaceMutationClient({ createId, now, send }) {
  return {
    submit
  };

  async function submit(input = {}) {
    const authority = readField(input, "authority");
    const authorityValidation = snapshotAndValidateAssignedAuthority(authority);
    const hasOperationId = hasOwn(input, "operationId");
    const suppliedOperationId = hasOperationId
      ? readField(input, "operationId")
      : undefined;

    if (!authorityValidation.valid) {
      return failureResult(
        commandFromAuthority(authority, { operationId: suppliedOperationId }),
        {
          status: "rejected",
          reason: "invalid_assigned_authority",
          phase: "authority_validation",
          errors: authorityValidation.errors
        }
      );
    }

    let operationId;
    let requestedAt;

    try {
      operationId = hasOperationId ? suppliedOperationId : createId();
      requestedAt = now();
    } catch (error) {
      return failureResult(
        commandFromAuthority(authorityValidation.authority, { operationId }),
        {
          status: "failed",
          reason: "command_generation_failed",
          phase: "command_construction",
          retrySafe: true,
          errors: [safeError(error)]
        }
      );
    }

    const commandCandidate = commandFromAuthority(authorityValidation.authority, {
      operationId,
      mutationKind: readField(input, "mutationKind"),
      payload: readField(input, "payload"),
      requestedAt
    });
    const commandValidation =
      snapshotAndValidateRuntimeWorkspaceMutationCommand(commandCandidate);

    if (!commandValidation.valid) {
      return failureResult(commandCandidate, {
        status: "rejected",
        reason: "invalid_command",
        phase: "command_validation",
        errors: commandValidation.errors
      });
    }

    const command = commandValidation.command;

    try {
      const response = await send(command);
      const responseValidation = validateRuntimeWorkspaceMutationResult(
        response,
        command
      );

      if (responseValidation.valid) {
        return responseValidation.result;
      }

      return failureResult(command, {
        status: "failed",
        reason: "transport_result_invalid",
        phase: "transport_response_validation",
        retrySafe: true,
        errors: responseValidation.errors
      });
    } catch (error) {
      return failureResult(command, {
        status: "failed",
        reason: "transport_failed",
        phase: "transport",
        retrySafe: true,
        errors: [safeError(error)]
      });
    }
  }
}

function snapshotAndValidateAssignedAuthority(value) {
  const errors = [];
  let authority;

  try {
    if (!isPlainObject(value)) {
      return {
        valid: false,
        errors: ["assigned authority must be a plain object"],
        authority: null
      };
    }

    errors.push(...serializableErrors(value, "assignedAuthority"));

    if (errors.length) {
      return {
        valid: false,
        errors,
        authority: null
      };
    }

    authority = clone(value);
  } catch (error) {
    return {
      valid: false,
      errors: ["assigned authority snapshot failed: " + safeError(error)],
      authority: null
    };
  }

  if (authority.schema !== SIDE_PANEL_ASSIGNED_WORKSPACE_AUTHORITY_SCHEMA) {
    errors.push("assigned authority schema is invalid");
  }

  for (const field of [
    "runtimeSessionId",
    "sourceContextId",
    "runtimeAssignmentId"
  ]) {
    if (!nonEmptyString(authority[field])) {
      errors.push("assigned authority " + field + " is invalid");
    }
  }

  if (
    !Number.isSafeInteger(authority.sourceWindowId) ||
    authority.sourceWindowId < 0
  ) {
    errors.push("assigned authority sourceWindowId is invalid");
  }

  if (!isValidRuntimeWorkspaceId(authority.workspaceId)) {
    errors.push("assigned authority workspaceId is invalid");
  }

  if (
    !Number.isSafeInteger(authority.workspaceRevision) ||
    authority.workspaceRevision < 0
  ) {
    errors.push("assigned authority workspaceRevision is invalid");
  }

  if (
    !Number.isSafeInteger(authority.assignmentEpoch) ||
    authority.assignmentEpoch <= 0
  ) {
    errors.push("assigned authority assignmentEpoch is invalid");
  }

  if (
    !Number.isSafeInteger(authority.authorityRevision) ||
    authority.authorityRevision < 0
  ) {
    errors.push("assigned authority authorityRevision is invalid");
  }

  if (authority.lifecycleState !== "available") {
    errors.push("assigned authority lifecycleState is not writable");
  }

  if (!isPlainObject(authority.workspace)) {
    errors.push("assigned authority workspace is invalid");
  } else {
    if (authority.workspace.workspaceId !== authority.workspaceId) {
      errors.push("assigned authority workspace identity does not match workspaceId");
    }

    const revision = normalizeWorkspaceRevision(authority.workspace);
    if (
      !revision.valid ||
      revision.revision !== authority.workspaceRevision
    ) {
      errors.push("assigned authority workspace revision does not match");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    authority: errors.length ? null : authority
  };
}

function commandFromAuthority(authority, fields = {}) {
  return {
    type: RUNTIME_WORKSPACE_MUTATION_TYPE,
    schema: RUNTIME_WORKSPACE_MUTATION_COMMAND_SCHEMA,
    operationId: fields.operationId,
    runtimeSessionId: readField(authority, "runtimeSessionId"),
    sourceContextId: readField(authority, "sourceContextId"),
    sourceWindowId: readField(authority, "sourceWindowId"),
    workspaceId: readField(authority, "workspaceId"),
    expectedWorkspaceRevision: readField(authority, "workspaceRevision"),
    runtimeAssignmentId: readField(authority, "runtimeAssignmentId"),
    assignmentEpoch: readField(authority, "assignmentEpoch"),
    mutationKind: fields.mutationKind,
    payload: fields.payload,
    requestedAt: fields.requestedAt
  };
}

function failureResult(command, fields) {
  return createRuntimeWorkspaceMutationResult(command, {
    status: fields.status,
    reason: fields.reason,
    phase: fields.phase,
    retrySafe: fields.retrySafe === true,
    errors: fields.errors
  });
}

function hasOwn(value, field) {
  try {
    return value !== null && typeof value === "object" && Object.hasOwn(value, field);
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

function safeError(error) {
  return String(error?.message || error || "unknown_error");
}
