import {
  validateSidePanelSender
} from "../runtime-session-authority/contract.js";
import {
  createRuntimeWorkspaceMutationChromeAdapters
} from "./chrome-adapter.js";
import {
  createRuntimeWorkspaceMutationResult,
  isRuntimeWorkspaceMutationMessage,
  snapshotAndValidateRuntimeWorkspaceMutationCommand,
  validateRuntimeWorkspaceMutationResult
} from "./contract.js";
import {
  coordinateRuntimeWorkspaceMutation
} from "./coordinator.js";

export { isRuntimeWorkspaceMutationMessage };

export function handleRuntimeWorkspaceMutationMessage(
  message,
  sender,
  sendResponse,
  options = {}
) {
  if (!isRuntimeWorkspaceMutationMessage(message)) {
    return false;
  }

  const resolvedOptions = options || {};
  const respond = respondOnce(sendResponse);
  const requestValidation =
    snapshotAndValidateRuntimeWorkspaceMutationCommand(message);
  const senderValidation = validateSender(
    sender,
    resolvedOptions.runtimeId,
    resolvedOptions.sidePanelUrl
  );

  if (!senderValidation.valid || !requestValidation.valid) {
    respond(
      failureResult(requestValidation.command || message, {
        status: "rejected",
        reason: senderValidation.valid
          ? "invalid_command"
          : senderValidation.reason,
        phase: "route_validation",
        errors: [
          ...(senderValidation.valid ? [] : [senderValidation.reason]),
          ...(requestValidation.errors || [])
        ]
      })
    );
    return false;
  }

  const command = requestValidation.command;
  let adapters;

  try {
    const createAdapters =
      resolvedOptions.createAdapters ||
      createRuntimeWorkspaceMutationChromeAdapters;
    adapters = createAdapters(resolvedOptions.chromeApi);
  } catch (error) {
    respond(
      failureResult(command, {
        status: "failed",
        reason: "adapter_creation_failed",
        phase: "route_setup",
        retrySafe: true,
        errors: [safeError(error)]
      })
    );
    return false;
  }

  const coordinate =
    resolvedOptions.coordinate || coordinateRuntimeWorkspaceMutation;

  Promise.resolve()
    .then(() => coordinate(command, adapters))
    .then(
      (candidate) => {
        const resultValidation = validateRuntimeWorkspaceMutationResult(
          candidate,
          command
        );

        respond(
          resultValidation.valid
            ? resultValidation.result
            : failureResult(command, {
                status: "failed",
                reason: "coordination_result_invalid",
                phase: "result_validation",
                retrySafe: true,
                errors: resultValidation.errors
              })
        );
      },
      (error) => {
        respond(
          failureResult(command, {
            status: "failed",
            reason: "unhandled_coordination_failure",
            phase: "coordination",
            retrySafe: true,
            errors: [safeError(error)]
          })
        );
      }
    );

  return true;
}

function validateSender(sender, runtimeId, sidePanelUrl) {
  try {
    return validateSidePanelSender(sender, runtimeId, sidePanelUrl);
  } catch {
    return { valid: false, reason: "sender_not_authorized" };
  }
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

function respondOnce(sendResponse) {
  let responded = false;

  return (result) => {
    if (responded) return;
    responded = true;
    sendResponse(result);
  };
}

function safeError(error) {
  return String(error?.message || error || "unknown_error");
}
