import {
  assignRuntime,
  resolveAssignmentByWindow,
  resolveAssignmentByWorkspace,
  transferRuntime
} from "../runtime-contract/assignments.js";
import { inspectOperation, recordOperation } from "../runtime-contract/ledger.js";
import { nonEmptyString } from "../runtime-contract/value-utils.js";
import {
  PROMOTION_PHASES,
  PROMOTION_REQUEST_SCHEMA,
  PROMOTION_RESULT_SCHEMA,
  PROMOTION_STATUSES,
  PROMOTION_THRESHOLD,
  createPromotionPendingRecord,
  createPromotionResult,
  normalizePromotionIdentities,
  snapshotAdapters,
  snapshotAndValidateMoveResult,
  snapshotAndValidatePendingRecord,
  snapshotAndValidatePromotionRequest,
  snapshotAndValidatePromotionState,
  snapshotAndValidateRuntimeAuthority,
  snapshotSerializable,
  validatePromotionResult
} from "./contract.js";
import { createPromotionRequestFingerprint } from "./fingerprint.js";

const LEDGER_SCHEMA = "constellation-runtime-operation-ledger-v0.1";
const LEDGER_READ_FIELDS = Object.freeze(["status", "ledger", "error"]);
const WRITE_FIELDS = Object.freeze(["status", "error"]);
const AUTHORITY_WRITE_FIELDS = Object.freeze([
  "status",
  "runtimeSessionId",
  "authorityRevision",
  "error"
]);
const PLACEMENT_WRITE_FIELDS = Object.freeze([
  "status",
  "workspaceRevision",
  "error"
]);

export async function coordinateAutomaticWorkspacePromotion(input, adapterInput) {
  const requestSnapshot = snapshotAndValidatePromotionRequest(input);
  const identities = normalizePromotionIdentities(requestSnapshot.ok ? requestSnapshot.value : input);
  let requestFingerprint = "";

  if (!requestSnapshot.ok) {
    return result(identities, {
      status: "invalid",
      reason: "invalid_promotion_request",
      decision: "reject_request",
      phase: "request_validation",
      errors: requestSnapshot.errors || [requestSnapshot.reason]
    });
  }

  const request = requestSnapshot.value;

  try {
    requestFingerprint = createPromotionRequestFingerprint(request);
    const adapterSnapshot = snapshotAdapters(adapterInput);
    if (!adapterSnapshot.ok) {
      return result(identities, {
        status: "invalid",
        reason: "invalid_promotion_adapters",
        decision: "reject_request",
        phase: "request_validation",
        requestFingerprint,
        errors: [adapterSnapshot.reason]
      });
    }
    const adapters = adapterSnapshot.value;

    const prior = await readAndInspectLedger(adapters, request, requestFingerprint);
    if (!prior.valid) {
      return failure(identities, requestFingerprint, "operation_inspection", prior.reason, true);
    }
    if (prior.inspection.status === "conflict") {
      return conflict(identities, requestFingerprint, "operation_inspection", prior.inspection.reason);
    }
    if (prior.inspection.status === "replay") {
      return replayStored(identities, requestFingerprint, prior.inspection.entry);
    }

    let callbackCount = 0;
    let callbackResult;
    let callbackOpen = true;

    try {
      await adapters.runExclusiveOperation(async () => {
        callbackCount += 1;
        if (!callbackOpen) {
          callbackResult = failure(
            identities,
            requestFingerprint,
            "lock_acquisition",
            "exclusive_callback_after_completion",
            true
          );
          return callbackResult;
        }
        if (callbackCount !== 1) {
          callbackResult = failure(
            identities,
            requestFingerprint,
            "lock_acquisition",
            "exclusive_callback_reused",
            true
          );
          return callbackResult;
        }
        callbackResult = await executeLocked(request, identities, requestFingerprint, adapters);
        return callbackResult;
      });
    } catch {
      callbackOpen = false;
      return callbackCount > 0
        ? indeterminate(
            identities,
            requestFingerprint,
            "lock_acquisition",
            "exclusive_operation_completion_uncertain"
          )
        : failure(
            identities,
            requestFingerprint,
            "lock_acquisition",
            "exclusive_operation_failed",
            true
          );
    }

    callbackOpen = false;
    if (callbackCount === 0) {
      return failure(
        identities,
        requestFingerprint,
        "lock_acquisition",
        "exclusive_callback_not_invoked",
        true
      );
    }
    if (callbackCount !== 1 || callbackResult === undefined) {
      return indeterminate(
        identities,
        requestFingerprint,
        "lock_acquisition",
        "exclusive_callback_count_invalid"
      );
    }
    return ensureResult(identities, requestFingerprint, callbackResult);
  } catch {
    return result(identities, {
      status: "failed",
      reason: "promotion_coordination_failed",
      decision: "retry_transaction",
      phase: "result_serialization",
      requestFingerprint,
      retrySafe: true,
      errors: ["unexpected_coordination_failure"]
    });
  }
}

async function executeLocked(request, identities, fingerprint, adapters) {
  const warnings = [];
  let ledgerRead = await readAndInspectLedger(adapters, request, fingerprint);
  if (!ledgerRead.valid) {
    return failure(identities, fingerprint, "operation_inspection", ledgerRead.reason, true);
  }
  if (ledgerRead.inspection.status === "conflict") {
    return conflict(identities, fingerprint, "operation_inspection", ledgerRead.inspection.reason);
  }
  if (ledgerRead.inspection.status === "replay") {
    return replayStored(identities, fingerprint, ledgerRead.inspection.entry);
  }

  let pending = ledgerRead.inspection.status === "pending"
    ? ledgerRead.inspection.pending
    : null;

  const stateRead = await readPromotionState(adapters, request.workspaceId);
  if (!stateRead.valid) {
    return failure(identities, fingerprint, "state_reread", stateRead.reason, true);
  }
  if (stateRead.state.status === "absent") {
    return conflict(identities, fingerprint, "state_reread", "workspace_absent");
  }
  const state = stateRead.state;
  if (state.workspaceId !== request.workspaceId) {
    return conflict(identities, fingerprint, "state_reread", "workspace_identity_mismatch");
  }

  const authorityRead = await readAuthority(
    adapters,
    request,
    pending === null
  );
  if (!authorityRead.valid) {
    return failure(identities, fingerprint, "authority_validation", authorityRead.reason, true);
  }
  const authority = authorityRead.authority;

  if (pending === null && authority.sourceContextVerified !== true) {
    return conflict(
      identities,
      fingerprint,
      "authority_validation",
      "source_context_not_verified"
    );
  }
  if (pending !== null && authority.runtimeSessionId !== pending.runtimeSessionId) {
    return conflict(
      identities,
      fingerprint,
      "authority_validation",
      "runtime_session_changed"
    );
  }

  const activeAssignment = resolveAssignmentByWorkspace(
    authority.assignmentRegistry,
    request.workspaceId
  );

  if (pending !== null) {
    const pendingValidation = validatePendingMatchesRequest(pending, request, fingerprint);
    if (!pendingValidation.valid) {
      return conflict(
        identities,
        fingerprint,
        "operation_inspection",
        pendingValidation.reason
      );
    }
    if (state.eligibleTabCount !== request.currentEligibleTabCount) {
      return conflict(
        identities,
        fingerprint,
        "state_reread",
        "pending_workspace_tab_count_changed",
        {
          workspaceRevisionBefore: state.workspaceRevision,
          runtimeSessionId: authority.runtimeSessionId,
          authorityRevisionBefore: authority.authorityRevision,
          previousRuntimeAssignmentId: pending.previousRuntimeAssignmentId,
          previousAssignmentEpoch: pending.previousAssignmentEpoch
        }
      );
    }
  }

  if (state.eligibleTabCount < request.threshold) {
    const noChange = result(identities, {
      status: "no_change",
      reason: "promotion_no_longer_required",
      decision: "retain_current_placement",
      phase: "complete",
      requestFingerprint: fingerprint,
      workspaceRevisionBefore: state.workspaceRevision,
      workspaceRevisionAfter: state.workspaceRevision,
      runtimeSessionId: authority.runtimeSessionId,
      authorityRevisionBefore: authority.authorityRevision,
      authorityRevisionAfter: authority.authorityRevision,
      previousRuntimeAssignmentId: activeAssignment?.runtimeAssignmentId || "",
      previousAssignmentEpoch: activeAssignment?.assignmentEpoch,
      nextRuntimeAssignmentId: activeAssignment?.runtimeAssignmentId || "",
      nextAssignmentEpoch: activeAssignment?.assignmentEpoch,
      assignmentVerified: assignmentMatchesState(activeAssignment, state, request),
      workspacePlacementVerified: true,
      retrySafe: true
    });
    return recordTerminalWithoutPending(
      adapters,
      ledgerRead.ledger,
      request,
      fingerprint,
      identities,
      noChange
    );
  }

  if (pending === null) {
    if (state.workspaceRevision !== request.expectedWorkspaceRevision) {
      return conflict(
        identities,
        fingerprint,
        "state_reread",
        "workspace_revision_changed",
        {
          workspaceRevisionBefore: state.workspaceRevision,
          runtimeSessionId: authority.runtimeSessionId,
          authorityRevisionBefore: authority.authorityRevision
        }
      );
    }
    if (state.eligibleTabCount !== request.currentEligibleTabCount) {
      return conflict(
        identities,
        fingerprint,
        "state_reread",
        "workspace_tab_count_changed",
        {
          workspaceRevisionBefore: state.workspaceRevision,
          runtimeSessionId: authority.runtimeSessionId,
          authorityRevisionBefore: authority.authorityRevision
        }
      );
    }
  }

  let classification;
  if (pending === null) {
    classification = classifyInitialPlacement(request, state, activeAssignment);
    if (classification.status !== "ready") {
      return conflict(
        identities,
        fingerprint,
        "promotion_classification",
        classification.reason,
        {
          workspaceRevisionBefore: state.workspaceRevision,
          runtimeSessionId: authority.runtimeSessionId,
          authorityRevisionBefore: authority.authorityRevision,
          previousRuntimeAssignmentId: activeAssignment?.runtimeAssignmentId || "",
          previousAssignmentEpoch: activeAssignment?.assignmentEpoch
        }
      );
    }

    pending = createPromotionPendingRecord(request, fingerprint, {
      moveMode: classification.moveMode,
      targetWindowId: classification.targetWindowId,
      baselineSourceWindowIds: state.sourceWindowIds,
      previousRuntimeAssignmentId: activeAssignment.runtimeAssignmentId,
      previousAssignmentEpoch: activeAssignment.assignmentEpoch,
      runtimeSessionId: authority.runtimeSessionId,
      authorityRevisionBefore: authority.authorityRevision
    });

    const pendingWrite = await persistPending(
      adapters,
      ledgerRead.ledger,
      request,
      fingerprint,
      pending
    );
    if (!pendingWrite.valid) {
      return failure(
        identities,
        fingerprint,
        "operation_recording",
        pendingWrite.reason,
        true,
        {
          workspaceRevisionBefore: state.workspaceRevision,
          runtimeSessionId: authority.runtimeSessionId,
          authorityRevisionBefore: authority.authorityRevision,
          previousRuntimeAssignmentId: activeAssignment.runtimeAssignmentId,
          previousAssignmentEpoch: activeAssignment.assignmentEpoch
        }
      );
    }
    ledgerRead = pendingWrite.ledgerRead;
  } else {
    classification = classifyPendingRecovery(state, pending);
    if (classification.status !== "ready") {
      return indeterminate(
        identities,
        fingerprint,
        "promotion_classification",
        classification.reason,
        {
          workspaceRevisionBefore: state.workspaceRevision,
          runtimeSessionId: authority.runtimeSessionId,
          authorityRevisionBefore: authority.authorityRevision,
          previousRuntimeAssignmentId: pending.previousRuntimeAssignmentId,
          previousAssignmentEpoch: pending.previousAssignmentEpoch
        }
      );
    }
    warnings.push("pending_operation_recovered");
  }

  const moveRequest = createMoveRequest(
    request,
    state,
    classification.moveMode,
    classification.targetWindowId,
    pending.requestedAt
  );
  const moved = await invokeSerializable(adapters.executeExistingTabMove, moveRequest);
  if (!moved.ok) {
    return indeterminate(
      identities,
      fingerprint,
      "browser_move",
      "browser_move_result_unavailable",
      commonFields(request, state, authority, pending, classification, {
        moveOperationId: moveRequest.operationId,
        errors: [moved.reason]
      })
    );
  }

  const moveSnapshot = snapshotAndValidateMoveResult(moved.value);
  if (!moveSnapshot.ok) {
    return indeterminate(
      identities,
      fingerprint,
      "browser_move",
      "browser_move_result_invalid",
      commonFields(request, state, authority, pending, classification, {
        moveOperationId: moveRequest.operationId,
        errors: [moveSnapshot.reason]
      })
    );
  }
  const moveResult = moveSnapshot.value;

  if (
    moveResult.operationId !== moveRequest.operationId ||
    moveResult.workspaceId !== request.workspaceId ||
    moveResult.mode !== classification.moveMode
  ) {
    return indeterminate(
      identities,
      fingerprint,
      "browser_move",
      "browser_move_identity_mismatch",
      commonFields(request, state, authority, pending, classification, {
        moveOperationId: moveRequest.operationId,
        moveStatus: moveResult.status,
        browserMutationStarted: moveResult.browserMutationStarted,
        browserMutationVerified: moveResult.browserMutationVerified
      })
    );
  }

  if (!["completed_verified", "no_change"].includes(moveResult.status)) {
    const fields = commonFields(request, state, authority, pending, classification, {
      moveOperationId: moveRequest.operationId,
      moveStatus: moveResult.status,
      targetWindowId: moveResult.targetWindowId,
      browserMutationStarted: moveResult.browserMutationStarted,
      browserMutationVerified: moveResult.browserMutationVerified,
      warnings: [...warnings, ...moveResult.warnings],
      errors: moveResult.errors
    });
    if (moveResult.status === "conflict") {
      return conflict(identities, fingerprint, "browser_move", "browser_move_conflict", fields);
    }
    if (moveResult.status === "invalid") {
      return failure(
        identities,
        fingerprint,
        "browser_move",
        "browser_move_rejected",
        moveResult.retrySafe,
        fields
      );
    }
    return moveResult.retrySafe && !moveResult.browserMutationStarted
      ? failure(
          identities,
          fingerprint,
          "browser_move",
          "browser_move_failed",
          true,
          fields
        )
      : indeterminate(
          identities,
          fingerprint,
          "browser_move",
          "browser_move_indeterminate",
          fields
        );
  }

  const targetWindowId = moveResult.targetWindowId;
  if (
    !Number.isSafeInteger(targetWindowId) ||
    targetWindowId < 0 ||
    (
      classification.moveMode === "create_dedicated_window" &&
      moveResult.createdWindow !== true
    ) ||
    (
      classification.moveMode === "attach_to_existing_dedicated_window" &&
      moveResult.createdWindow !== false
    )
  ) {
    return indeterminate(
      identities,
      fingerprint,
      "browser_move",
      "browser_move_target_invalid",
      commonFields(request, state, authority, pending, classification, {
        moveOperationId: moveRequest.operationId,
        moveStatus: moveResult.status,
        targetWindowId,
        browserMutationStarted: moveResult.browserMutationStarted,
        browserMutationVerified: moveResult.browserMutationVerified
      })
    );
  }

  const assignmentOutcome = await ensureTargetAssignment(
    adapters,
    request,
    pending,
    targetWindowId,
    pending.moveMode,
    warnings
  );
  if (!assignmentOutcome.valid) {
    const fields = commonFields(
      request,
      state,
      assignmentOutcome.authority || authority,
      pending,
      classification,
      {
        moveOperationId: moveRequest.operationId,
        moveStatus: moveResult.status,
        targetWindowId,
        browserMutationStarted: moveResult.browserMutationStarted,
        browserMutationVerified: moveResult.browserMutationVerified,
        assignmentTransferred: assignmentOutcome.assignmentTransferred,
        assignmentVerified: assignmentOutcome.assignmentVerified,
        authorityRevisionBefore: assignmentOutcome.authorityRevisionBefore,
        authorityRevisionAfter: assignmentOutcome.authorityRevisionAfter,
        nextAssignmentEpoch: assignmentOutcome.nextAssignmentEpoch,
        warnings: [...warnings, ...(assignmentOutcome.warnings || [])],
        errors: assignmentOutcome.errors || []
      }
    );
    return assignmentOutcome.conflict
      ? conflict(
          identities,
          fingerprint,
          "runtime_assignment_verification",
          assignmentOutcome.reason,
          fields
        )
      : indeterminate(
          identities,
          fingerprint,
          "runtime_assignment_verification",
          assignmentOutcome.reason,
          fields
        );
  }

  const postMoveStateRead = await readPromotionState(adapters, request.workspaceId);
  if (!postMoveStateRead.valid || postMoveStateRead.state.status !== "present") {
    return indeterminate(
      identities,
      fingerprint,
      "workspace_placement_verification",
      "post_move_state_unavailable",
      commonFields(request, state, assignmentOutcome.authority, pending, classification, {
        moveOperationId: moveRequest.operationId,
        moveStatus: moveResult.status,
        targetWindowId,
        browserMutationStarted: moveResult.browserMutationStarted,
        browserMutationVerified: moveResult.browserMutationVerified,
        assignmentTransferred: assignmentOutcome.assignmentTransferred,
        assignmentVerified: true,
        authorityRevisionBefore: assignmentOutcome.authorityRevisionBefore,
        authorityRevisionAfter: assignmentOutcome.authorityRevisionAfter,
        nextAssignmentEpoch: assignmentOutcome.assignment.assignmentEpoch,
        warnings
      })
    );
  }

  let placementState = postMoveStateRead.state;
  let workspacePlacementWritten = false;
  let workspacePlacementVerified = placementMatches(
    placementState,
    request,
    targetWindowId
  );
  let workspaceRevisionBefore = placementState.workspaceRevision;
  let workspaceRevisionAfter = placementState.workspaceRevision;
  const placementWriteRequired =
    moveResult.status === "completed_verified" || !workspacePlacementVerified;

  if (placementWriteRequired) {
    const placementWrite = await writePlacement(
      adapters,
      request,
      placementState.workspaceRevision,
      targetWindowId,
      moveResult
    );
    const verificationRead = await readPromotionState(adapters, request.workspaceId);
    if (verificationRead.valid && verificationRead.state.status === "present") {
      placementState = verificationRead.state;
      workspaceRevisionAfter = placementState.workspaceRevision;
      workspacePlacementVerified = placementMatches(
        placementState,
        request,
        targetWindowId
      );
    }

    if (!workspacePlacementVerified) {
      return indeterminate(
        identities,
        fingerprint,
        "workspace_placement_verification",
        "workspace_placement_outcome_unverified",
        commonFields(request, state, assignmentOutcome.authority, pending, classification, {
          moveOperationId: moveRequest.operationId,
          moveStatus: moveResult.status,
          targetWindowId,
          browserMutationStarted: moveResult.browserMutationStarted,
          browserMutationVerified: moveResult.browserMutationVerified,
          assignmentTransferred: assignmentOutcome.assignmentTransferred,
          assignmentVerified: true,
          authorityRevisionBefore: assignmentOutcome.authorityRevisionBefore,
          authorityRevisionAfter: assignmentOutcome.authorityRevisionAfter,
          nextAssignmentEpoch: assignmentOutcome.assignment.assignmentEpoch,
          workspaceRevisionBefore,
          workspaceRevisionAfter,
          workspacePlacementWritten: placementWrite.valid && placementWrite.status === "written",
          warnings,
          errors: placementWrite.errors || []
        })
      );
    }
    workspacePlacementWritten = placementWrite.valid && placementWrite.status === "written";
    if (!workspacePlacementWritten) warnings.push("workspace_placement_verified_by_reread");
  }

  const finalAuthorityRead = await readAuthority(adapters, request, false);
  if (!finalAuthorityRead.valid) {
    return indeterminate(
      identities,
      fingerprint,
      "final_verification",
      "final_authority_unavailable",
      commonFields(request, state, assignmentOutcome.authority, pending, classification, {
        moveOperationId: moveRequest.operationId,
        moveStatus: moveResult.status,
        targetWindowId,
        browserMutationStarted: moveResult.browserMutationStarted,
        browserMutationVerified: moveResult.browserMutationVerified,
        assignmentTransferred: assignmentOutcome.assignmentTransferred,
        assignmentVerified: true,
        workspaceRevisionBefore,
        workspaceRevisionAfter,
        workspacePlacementWritten,
        workspacePlacementVerified: true,
        authorityRevisionBefore: assignmentOutcome.authorityRevisionBefore,
        authorityRevisionAfter: assignmentOutcome.authorityRevisionAfter,
        nextAssignmentEpoch: assignmentOutcome.assignment.assignmentEpoch,
        warnings
      })
    );
  }

  const finalAssignment = resolveAssignmentByWorkspace(
    finalAuthorityRead.authority.assignmentRegistry,
    request.workspaceId
  );
  const finalAssignmentVerified =
    finalAssignment !== null &&
    finalAssignment.windowId === targetWindowId &&
    (
      classification.moveMode === "attach_to_existing_dedicated_window"
        ? finalAssignment.runtimeAssignmentId === assignmentOutcome.assignment.runtimeAssignmentId
        : finalAssignment.runtimeAssignmentId === request.nextRuntimeAssignmentId
    );

  if (!finalAssignmentVerified || !placementMatches(placementState, request, targetWindowId)) {
    return indeterminate(
      identities,
      fingerprint,
      "final_verification",
      "final_promotion_verification_failed",
      commonFields(request, state, finalAuthorityRead.authority, pending, classification, {
        moveOperationId: moveRequest.operationId,
        moveStatus: moveResult.status,
        targetWindowId,
        browserMutationStarted: moveResult.browserMutationStarted,
        browserMutationVerified: moveResult.browserMutationVerified,
        assignmentTransferred: assignmentOutcome.assignmentTransferred,
        assignmentVerified: finalAssignmentVerified,
        workspaceRevisionBefore,
        workspaceRevisionAfter,
        workspacePlacementWritten,
        workspacePlacementVerified: placementMatches(placementState, request, targetWindowId),
        authorityRevisionBefore: assignmentOutcome.authorityRevisionBefore,
        authorityRevisionAfter: finalAuthorityRead.authority.authorityRevision,
        nextAssignmentEpoch: finalAssignment?.assignmentEpoch,
        warnings
      })
    );
  }

  const semanticNoChange =
    moveResult.status === "no_change" &&
    !assignmentOutcome.assignmentTransferred &&
    !workspacePlacementWritten;

  const successful = result(identities, {
    status: semanticNoChange ? "no_change" : "committed",
    reason: semanticNoChange
      ? "dedicated_placement_already_verified"
      : "automatic_promotion_committed",
    decision: "use_dedicated_window",
    phase: "complete",
    requestFingerprint: fingerprint,
    workspaceRevisionBefore,
    workspaceRevisionAfter,
    moveMode: classification.moveMode,
    moveOperationId: moveRequest.operationId,
    moveStatus: moveResult.status,
    targetWindowId,
    browserMutationStarted: moveResult.browserMutationStarted,
    browserMutationVerified: moveResult.browserMutationVerified,
    runtimeSessionId: finalAuthorityRead.authority.runtimeSessionId,
    authorityRevisionBefore: assignmentOutcome.authorityRevisionBefore,
    authorityRevisionAfter: finalAuthorityRead.authority.authorityRevision,
    previousRuntimeAssignmentId: pending.previousRuntimeAssignmentId,
    previousAssignmentEpoch: pending.previousAssignmentEpoch,
    nextRuntimeAssignmentId: finalAssignment.runtimeAssignmentId,
    nextAssignmentEpoch: finalAssignment.assignmentEpoch,
    assignmentTransferred: assignmentOutcome.assignmentTransferred,
    assignmentVerified: true,
    workspacePlacementWritten,
    workspacePlacementVerified: true,
    warnings: [...warnings, ...moveResult.warnings]
  });

  return finalizePendingOperation(
    adapters,
    ledgerRead.ledger,
    request,
    fingerprint,
    identities,
    successful
  );
}

function assignmentMatchesState(assignment, state, request) {
  if (!assignment) return false;
  if (state.placementMode === "current_window") {
    return (
      assignment.windowId === request.sourceWindowId &&
      state.sourceWindowIds.includes(assignment.windowId)
    );
  }
  return (
    state.placementMode === "dedicated_window" &&
    state.dedicatedWindowId === assignment.windowId
  );
}

function classifyInitialPlacement(request, state, assignment) {
  if (!assignment) return { status: "conflict", reason: "workspace_assignment_missing" };
  if (state.placementMode === "current_window") {
    if (
      assignment.windowId !== request.sourceWindowId ||
      !state.sourceWindowIds.includes(assignment.windowId)
    ) {
      return { status: "conflict", reason: "source_assignment_mismatch" };
    }
    return {
      status: "ready",
      moveMode: "create_dedicated_window",
      targetWindowId: null
    };
  }
  if (
    state.placementMode === "dedicated_window" &&
    state.dedicatedWindowId === assignment.windowId
  ) {
    return {
      status: "ready",
      moveMode: "attach_to_existing_dedicated_window",
      targetWindowId: state.dedicatedWindowId
    };
  }
  return { status: "conflict", reason: "dedicated_assignment_mismatch" };
}

function classifyPendingRecovery(state, pending) {
  if (state.eligibleTabCount < pending.threshold) {
    return { status: "conflict", reason: "pending_promotion_no_longer_required" };
  }
  if (pending.moveMode === "attach_to_existing_dedicated_window") {
    return {
      status: "ready",
      moveMode: "attach_to_existing_dedicated_window",
      targetWindowId: pending.targetWindowId
    };
  }

  const baseline = new Set(pending.baselineSourceWindowIds);
  const newWindowIds = state.sourceWindowIds.filter((windowId) => !baseline.has(windowId));

  if (newWindowIds.length === 0) {
    const unchanged =
      state.sourceWindowIds.length === pending.baselineSourceWindowIds.length &&
      state.sourceWindowIds.every(
        (windowId, index) => windowId === pending.baselineSourceWindowIds[index]
      );
    return unchanged
      ? { status: "ready", moveMode: "create_dedicated_window", targetWindowId: null }
      : { status: "indeterminate", reason: "pending_source_windows_changed" };
  }

  if (newWindowIds.length === 1) {
    return {
      status: "ready",
      moveMode: "attach_to_existing_dedicated_window",
      targetWindowId: newWindowIds[0]
    };
  }

  return { status: "indeterminate", reason: "multiple_recovery_targets_observed" };
}

function createMoveRequest(request, state, moveMode, targetWindowId, requestedAt) {
  return {
    schema: "constellation-workspace-existing-tab-move-request-v0.1",
    operationId: request.operationId + ":browser-move",
    workspaceId: request.workspaceId,
    mode: moveMode,
    sourceWindowIds: [...state.sourceWindowIds],
    targetWindowId,
    tabs: state.tabs.map((tab) => ({ ...tab })),
    groups: state.groups.map((group) => ({
      ...group,
      workspaceTabIds: [...group.workspaceTabIds]
    })),
    requestedAt
  };
}

async function ensureTargetAssignment(
  adapters,
  request,
  pending,
  targetWindowId,
  moveMode,
  warnings
) {
  const read = await readAuthority(adapters, request, false);
  if (!read.valid) {
    return {
      valid: false,
      reason: "runtime_authority_reread_failed",
      conflict: false,
      assignmentTransferred: false,
      assignmentVerified: false,
      errors: [read.reason]
    };
  }
  const authority = read.authority;
  if (authority.runtimeSessionId !== pending.runtimeSessionId) {
    return {
      valid: false,
      reason: "runtime_session_changed",
      conflict: true,
      authority,
      assignmentTransferred: false,
      assignmentVerified: false
    };
  }

  const active = resolveAssignmentByWorkspace(
    authority.assignmentRegistry,
    request.workspaceId
  );
  const destination = resolveAssignmentByWindow(
    authority.assignmentRegistry,
    targetWindowId
  );

  if (moveMode === "attach_to_existing_dedicated_window") {
    if (!active || active.windowId !== targetWindowId) {
      return {
        valid: false,
        reason: "dedicated_assignment_missing",
        conflict: true,
        authority,
        assignmentTransferred: false,
        assignmentVerified: false,
        authorityRevisionBefore: authority.authorityRevision,
        authorityRevisionAfter: authority.authorityRevision
      };
    }
    return {
      valid: true,
      authority,
      assignment: active,
      assignmentTransferred: false,
      assignmentVerified: true,
      authorityRevisionBefore: authority.authorityRevision,
      authorityRevisionAfter: authority.authorityRevision,
      warnings: []
    };
  }

  if (
    active &&
    active.windowId === targetWindowId &&
    active.runtimeAssignmentId === request.nextRuntimeAssignmentId
  ) {
    return {
      valid: true,
      authority,
      assignment: active,
      assignmentTransferred: true,
      assignmentVerified: true,
      authorityRevisionBefore: pending.authorityRevisionBefore,
      authorityRevisionAfter: authority.authorityRevision,
      warnings: ["runtime_assignment_verified_from_prior_attempt"]
    };
  }

  if (destination && destination.workspaceId !== request.workspaceId) {
    return {
      valid: false,
      reason: "destination_window_assignment_conflict",
      conflict: true,
      authority,
      assignmentTransferred: false,
      assignmentVerified: false,
      authorityRevisionBefore: authority.authorityRevision,
      authorityRevisionAfter: authority.authorityRevision
    };
  }

  let transition;
  if (
    active &&
    active.runtimeAssignmentId === pending.previousRuntimeAssignmentId &&
    active.assignmentEpoch === pending.previousAssignmentEpoch
  ) {
    transition = transferRuntime(authority.assignmentRegistry, {
      workspaceId: request.workspaceId,
      windowId: targetWindowId,
      sourceContextId: request.sourceContextId,
      expectedRuntimeAssignmentId: pending.previousRuntimeAssignmentId,
      expectedAssignmentEpoch: pending.previousAssignmentEpoch,
      now: pending.requestedAt,
      id: () => request.nextRuntimeAssignmentId
    });
  } else if (!active) {
    const released = authority.assignmentRegistry.assignments.find(
      (assignment) =>
        assignment.runtimeAssignmentId === pending.previousRuntimeAssignmentId &&
        assignment.assignmentEpoch === pending.previousAssignmentEpoch &&
        assignment.workspaceId === request.workspaceId &&
        assignment.state === "released"
    );
    if (!released) {
      return {
        valid: false,
        reason: "source_assignment_not_recoverable",
        conflict: true,
        authority,
        assignmentTransferred: false,
        assignmentVerified: false,
        authorityRevisionBefore: authority.authorityRevision,
        authorityRevisionAfter: authority.authorityRevision
      };
    }
    transition = assignRuntime(authority.assignmentRegistry, {
      workspaceId: request.workspaceId,
      windowId: targetWindowId,
      sourceContextId: request.sourceContextId,
      now: pending.requestedAt,
      id: () => request.nextRuntimeAssignmentId
    });
    warnings.push("source_assignment_released_before_transfer");
  } else {
    return {
      valid: false,
      reason: "workspace_assignment_changed",
      conflict: true,
      authority,
      assignmentTransferred: false,
      assignmentVerified: false,
      authorityRevisionBefore: authority.authorityRevision,
      authorityRevisionAfter: authority.authorityRevision
    };
  }

  if (transition.status !== "assigned") {
    return {
      valid: false,
      reason: transition.reason || transition.status,
      conflict: true,
      authority,
      assignmentTransferred: false,
      assignmentVerified: false,
      authorityRevisionBefore: authority.authorityRevision,
      authorityRevisionAfter: authority.authorityRevision
    };
  }

  const expectedRevision = authority.authorityRevision + 1;
  const write = await writeAuthority(adapters, authority, transition.registry);
  const verification = await readAuthority(adapters, request, false);
  if (!verification.valid) {
    return {
      valid: false,
      reason: "assignment_write_outcome_unverified",
      conflict: false,
      authority,
      assignmentTransferred: write.valid && write.status === "written",
      assignmentVerified: false,
      authorityRevisionBefore: authority.authorityRevision,
      authorityRevisionAfter: null,
      nextAssignmentEpoch: transition.assignment.assignmentEpoch,
      errors: write.errors || []
    };
  }

  const verified = resolveAssignmentByWorkspace(
    verification.authority.assignmentRegistry,
    request.workspaceId
  );
  const exact =
    verification.authority.runtimeSessionId === authority.runtimeSessionId &&
    verification.authority.authorityRevision === expectedRevision &&
    verified !== null &&
    verified.runtimeAssignmentId === request.nextRuntimeAssignmentId &&
    verified.assignmentEpoch === transition.assignment.assignmentEpoch &&
    verified.windowId === targetWindowId;

  if (!exact) {
    const unchanged =
      verification.authority.runtimeSessionId === authority.runtimeSessionId &&
      verification.authority.authorityRevision === authority.authorityRevision &&
      resolveAssignmentByWorkspace(
        verification.authority.assignmentRegistry,
        request.workspaceId
      )?.runtimeAssignmentId === active?.runtimeAssignmentId;

    return {
      valid: false,
      reason: unchanged && (!write.valid || write.status !== "written")
        ? "assignment_write_failed"
        : "assignment_verification_failed",
      conflict: false,
      authority: verification.authority,
      assignmentTransferred: false,
      assignmentVerified: false,
      authorityRevisionBefore: authority.authorityRevision,
      authorityRevisionAfter: verification.authority.authorityRevision,
      nextAssignmentEpoch: transition.assignment.assignmentEpoch,
      errors: write.errors || []
    };
  }

  if (!write.valid || write.status !== "written") {
    warnings.push("runtime_assignment_verified_by_reread");
  }

  return {
    valid: true,
    authority: verification.authority,
    assignment: verified,
    assignmentTransferred: true,
    assignmentVerified: true,
    authorityRevisionBefore: authority.authorityRevision,
    authorityRevisionAfter: verification.authority.authorityRevision,
    warnings: []
  };
}

function placementMatches(state, request, targetWindowId) {
  return (
    state.status === "present" &&
    state.workspaceId === request.workspaceId &&
    state.eligibleTabCount === request.currentEligibleTabCount &&
    state.placementMode === "dedicated_window" &&
    state.dedicatedWindowId === targetWindowId &&
    state.sourceWindowIds.length === 1 &&
    state.sourceWindowIds[0] === targetWindowId &&
    state.tabs.every((tab) => tab.sourceWindowId === targetWindowId)
  );
}

async function readPromotionState(adapters, workspaceId) {
  const invoked = await invokeSerializable(adapters.readPromotionState, { workspaceId });
  if (!invoked.ok) return { valid: false, reason: "promotion_state_read_failed" };
  const snapshot = snapshotAndValidatePromotionState(invoked.value);
  return snapshot.ok
    ? { valid: true, state: snapshot.value }
    : { valid: false, reason: snapshot.reason };
}

async function readAuthority(adapters, request, requireSourceContext) {
  const invoked = await invokeSerializable(adapters.readRuntimeAuthority, {
    workspaceId: request.workspaceId,
    sourceContextId: request.sourceContextId,
    sourceWindowId: request.sourceWindowId,
    requireSourceContext
  });
  if (!invoked.ok) return { valid: false, reason: "runtime_authority_read_failed" };
  const snapshot = snapshotAndValidateRuntimeAuthority(invoked.value);
  return snapshot.ok
    ? { valid: true, authority: snapshot.value }
    : { valid: false, reason: snapshot.reason };
}

async function writeAuthority(adapters, authority, nextAssignmentRegistry) {
  const invoked = await invokeSerializable(adapters.writeRuntimeAuthority, {
    expectedRuntimeSessionId: authority.runtimeSessionId,
    expectedAuthorityRevision: authority.authorityRevision,
    nextAssignmentRegistry
  });
  if (!invoked.ok) {
    return { valid: false, status: "failed", errors: [invoked.reason] };
  }
  const value = invoked.value;
  if (
    !exactObjectFields(value, AUTHORITY_WRITE_FIELDS) ||
    !["written", "conflict", "failed"].includes(value.status) ||
    typeof value.error !== "string" ||
    !nonEmptyString(value.runtimeSessionId) ||
    !Number.isSafeInteger(value.authorityRevision) ||
    value.authorityRevision < 0
  ) {
    return { valid: false, status: "failed", errors: ["runtime_authority_write_result_invalid"] };
  }
  if (
    value.status === "written" &&
    (
      value.runtimeSessionId !== authority.runtimeSessionId ||
      value.authorityRevision !== authority.authorityRevision + 1 ||
      value.error !== ""
    )
  ) {
    return { valid: false, status: "failed", errors: ["runtime_authority_write_result_mismatch"] };
  }
  return { valid: true, status: value.status, errors: value.error ? [value.error] : [] };
}

async function writePlacement(adapters, request, expectedRevision, targetWindowId, moveResult) {
  const invoked = await invokeSerializable(adapters.writeWorkspacePlacement, {
    workspaceId: request.workspaceId,
    expectedWorkspaceRevision: expectedRevision,
    nextWorkspaceRevision: expectedRevision + 1,
    placementMode: "dedicated_window",
    dedicatedWindowId: targetWindowId,
    moveResult
  });
  if (!invoked.ok) {
    return { valid: false, status: "failed", errors: [invoked.reason] };
  }
  const value = invoked.value;
  if (
    !exactObjectFields(value, PLACEMENT_WRITE_FIELDS) ||
    !["written", "conflict", "failed"].includes(value.status) ||
    typeof value.error !== "string" ||
    !(
      value.workspaceRevision === null ||
      (Number.isSafeInteger(value.workspaceRevision) && value.workspaceRevision >= 0)
    )
  ) {
    return { valid: false, status: "failed", errors: ["workspace_placement_write_result_invalid"] };
  }
  if (
    value.status === "written" &&
    (value.workspaceRevision !== expectedRevision + 1 || value.error !== "")
  ) {
    return { valid: false, status: "failed", errors: ["workspace_placement_write_result_mismatch"] };
  }
  return { valid: true, status: value.status, errors: value.error ? [value.error] : [] };
}

async function readAndInspectLedger(adapters, request, fingerprint) {
  const invoked = await invokeSerializable(adapters.readOperationLedger);
  if (!invoked.ok || !validLedgerRead(invoked.value)) {
    return { valid: false, reason: "operation_ledger_read_failed" };
  }
  if (invoked.value.status === "failed") {
    return { valid: false, reason: "operation_ledger_read_failed" };
  }
  const ledger = invoked.value.ledger;
  const inspection = inspectOperation(ledger, request.operationId, fingerprint);
  if (inspection.status === "missing") {
    return { valid: true, ledger, inspection: { status: "missing" } };
  }
  if (inspection.status === "conflict") {
    return {
      valid: true,
      ledger,
      inspection: { status: "conflict", reason: "operation_id_fingerprint_conflict" }
    };
  }

  const pending = snapshotAndValidatePendingRecord(inspection.entry.result);
  if (pending.ok) {
    return {
      valid: true,
      ledger,
      inspection: {
        status: "pending",
        pending: pending.value,
        entry: inspection.entry
      }
    };
  }

  if (
    validatePromotionResult(inspection.entry.result) &&
    resultMatchesRequest(inspection.entry.result, request, fingerprint) &&
    ["committed", "no_change"].includes(inspection.entry.result.status)
  ) {
    return {
      valid: true,
      ledger,
      inspection: { status: "replay", entry: inspection.entry }
    };
  }

  return {
    valid: true,
    ledger,
    inspection: { status: "conflict", reason: "operation_replay_result_invalid" }
  };
}

async function persistPending(adapters, ledger, request, fingerprint, pending) {
  const recorded = recordOperation(ledger, {
    operationId: request.operationId,
    requestFingerprint: fingerprint,
    result: pending,
    recordedAt: request.requestedAt
  });
  if (recorded.status !== "recorded") {
    return { valid: false, reason: "pending_operation_record_conflict" };
  }
  const written = await writeLedger(adapters, recorded.ledger);
  const reread = await readAndInspectLedger(adapters, request, fingerprint);
  if (
    reread.valid &&
    reread.inspection.status === "pending" &&
    validatePendingMatchesRequest(reread.inspection.pending, request, fingerprint).valid
  ) {
    return { valid: true, ledgerRead: reread };
  }
  return {
    valid: false,
    reason: written.valid && written.status === "written"
      ? "pending_operation_verification_failed"
      : "pending_operation_recording_failed"
  };
}

async function recordTerminalWithoutPending(
  adapters,
  ledger,
  request,
  fingerprint,
  identities,
  terminal
) {
  const recorded = recordOperation(ledger, {
    operationId: request.operationId,
    requestFingerprint: fingerprint,
    result: terminal,
    recordedAt: request.requestedAt
  });
  if (recorded.status !== "recorded") {
    return conflict(
      identities,
      fingerprint,
      "operation_recording",
      "operation_record_conflict",
      terminal
    );
  }
  const written = await writeLedger(adapters, recorded.ledger);
  const reread = await readAndInspectLedger(adapters, request, fingerprint);
  if (reread.valid && reread.inspection.status === "replay") return terminal;
  return indeterminate(
    identities,
    fingerprint,
    "operation_recording",
    written.valid && written.status === "written"
      ? "operation_record_verification_failed"
      : "operation_recording_failed",
    terminal
  );
}

async function finalizePendingOperation(
  adapters,
  ledger,
  request,
  fingerprint,
  identities,
  terminal
) {
  const next = replaceLedgerResult(ledger, request.operationId, fingerprint, terminal);
  if (!next.valid) {
    return conflict(
      identities,
      fingerprint,
      "operation_recording",
      next.reason,
      terminal
    );
  }
  const written = await writeLedger(adapters, next.ledger);
  const reread = await readAndInspectLedger(adapters, request, fingerprint);
  if (reread.valid && reread.inspection.status === "replay") return terminal;
  return indeterminate(
    identities,
    fingerprint,
    "operation_recording",
    written.valid && written.status === "written"
      ? "terminal_operation_verification_failed"
      : "terminal_operation_recording_failed",
    terminal
  );
}

function replaceLedgerResult(ledger, operationId, fingerprint, terminal) {
  const snapshot = snapshotSerializable(ledger);
  if (!snapshot.ok) return { valid: false, reason: "operation_ledger_invalid" };
  const next = snapshot.value;
  const entry = next.entries.find((candidate) => candidate.operationId === operationId);
  if (!entry || entry.requestFingerprint !== fingerprint) {
    return { valid: false, reason: "pending_operation_missing" };
  }
  const pending = snapshotAndValidatePendingRecord(entry.result);
  if (!pending.ok) return { valid: false, reason: "pending_operation_invalid" };
  entry.result = terminal;
  return { valid: true, ledger: next };
}

async function writeLedger(adapters, ledger) {
  const invoked = await invokeSerializable(adapters.writeOperationLedger, ledger);
  if (!invoked.ok) return { valid: false, status: "failed" };
  const value = invoked.value;
  if (
    !exactObjectFields(value, WRITE_FIELDS) ||
    !["written", "conflict", "failed"].includes(value.status) ||
    typeof value.error !== "string" ||
    (value.status === "written" && value.error !== "")
  ) {
    return { valid: false, status: "failed" };
  }
  return { valid: true, status: value.status };
}

function validLedgerRead(value) {
  if (
    !exactObjectFields(value, LEDGER_READ_FIELDS) ||
    !["present", "failed"].includes(value.status) ||
    typeof value.error !== "string"
  ) {
    return false;
  }
  if (value.status === "failed") return value.ledger === null && nonEmptyString(value.error);
  const ledger = value.ledger;
  if (
    !ledger ||
    typeof ledger !== "object" ||
    Array.isArray(ledger) ||
    ledger.schema !== LEDGER_SCHEMA ||
    !Number.isSafeInteger(ledger.maxEntries) ||
    ledger.maxEntries <= 0 ||
    !Number.isSafeInteger(ledger.nextSequence) ||
    ledger.nextSequence <= 0 ||
    !Array.isArray(ledger.entries) ||
    value.error !== ""
  ) {
    return false;
  }
  const operationIds = new Set();
  const sequences = new Set();
  let maximum = 0;
  for (const entry of ledger.entries) {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      !exactObjectFields(entry, [
        "operationId",
        "requestFingerprint",
        "result",
        "recordedAt",
        "sequence"
      ]) ||
      !nonEmptyString(entry.operationId) ||
      typeof entry.requestFingerprint !== "string" ||
      !nonEmptyString(entry.recordedAt) ||
      !Number.isSafeInteger(entry.sequence) ||
      entry.sequence <= 0 ||
      operationIds.has(entry.operationId) ||
      sequences.has(entry.sequence)
    ) {
      return false;
    }
    operationIds.add(entry.operationId);
    sequences.add(entry.sequence);
    maximum = Math.max(maximum, entry.sequence);
  }
  return ledger.entries.length <= ledger.maxEntries && ledger.nextSequence > maximum;
}

function validatePendingMatchesRequest(pending, request, fingerprint) {
  const valid =
    pending.operationId === request.operationId &&
    pending.requestFingerprint === fingerprint &&
    pending.workspaceId === request.workspaceId &&
    pending.sourceContextId === request.sourceContextId &&
    pending.sourceWindowId === request.sourceWindowId &&
    pending.expectedWorkspaceRevision === request.expectedWorkspaceRevision &&
    pending.previousEligibleTabCount === request.previousEligibleTabCount &&
    pending.currentEligibleTabCount === request.currentEligibleTabCount &&
    pending.threshold === request.threshold &&
    pending.nextRuntimeAssignmentId === request.nextRuntimeAssignmentId;
  return valid
    ? { valid: true }
    : { valid: false, reason: "pending_operation_identity_mismatch" };
}

function resultMatchesRequest(value, request, fingerprint) {
  return (
    value.schema === PROMOTION_RESULT_SCHEMA &&
    value.operationId === request.operationId &&
    value.triggerOperationId === request.triggerOperationId &&
    value.workspaceId === request.workspaceId &&
    value.sourceContextId === request.sourceContextId &&
    value.sourceWindowId === request.sourceWindowId &&
    value.requestFingerprint === fingerprint &&
    value.threshold === request.threshold &&
    value.previousEligibleTabCount === request.previousEligibleTabCount &&
    value.currentEligibleTabCount === request.currentEligibleTabCount
  );
}

function replayStored(identities, fingerprint, entry) {
  try {
    const stored = entry.result;
    if (
      !validatePromotionResult(stored) ||
      !["committed", "no_change"].includes(stored.status)
    ) {
      return conflict(
        identities,
        fingerprint,
        "operation_inspection",
        "operation_replay_result_invalid"
      );
    }
    return ensureResult(identities, fingerprint, {
      ...stored,
      status: "replayed",
      reason: "operation_replayed",
      phase: "complete",
      replayed: true
    });
  } catch {
    return conflict(
      identities,
      fingerprint,
      "operation_inspection",
      "operation_replay_result_invalid"
    );
  }
}

function commonFields(request, state, authority, pending, classification, patch = {}) {
  return {
    workspaceRevisionBefore: state.workspaceRevision,
    moveMode: classification.moveMode,
    targetWindowId: classification.targetWindowId,
    runtimeSessionId: authority?.runtimeSessionId || pending.runtimeSessionId,
    authorityRevisionBefore: authority?.authorityRevision ?? pending.authorityRevisionBefore,
    authorityRevisionAfter: authority?.authorityRevision ?? pending.authorityRevisionBefore,
    previousRuntimeAssignmentId: pending.previousRuntimeAssignmentId,
    previousAssignmentEpoch: pending.previousAssignmentEpoch,
    nextRuntimeAssignmentId: request.nextRuntimeAssignmentId,
    warnings: [],
    errors: [],
    ...patch
  };
}

async function invokeSerializable(fn, ...args) {
  try {
    const value = await fn(...args);
    const snapshot = snapshotSerializable(value);
    return snapshot.ok
      ? { ok: true, value: snapshot.value }
      : { ok: false, reason: snapshot.reason };
  } catch {
    return { ok: false, reason: "adapter_invocation_failed" };
  }
}

function exactObjectFields(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const keys = Reflect.ownKeys(value);
    return (
      keys.every((key) => typeof key === "string") &&
      keys.length === fields.length &&
      keys.every((key) => fields.includes(key))
    );
  } catch {
    return false;
  }
}

function result(identities, patch) {
  return createPromotionResult(identities, patch);
}

function failure(identities, fingerprint, phase, reason, retrySafe, patch = {}) {
  return result(identities, {
    ...patch,
    status: "failed",
    reason,
    decision: "retry_transaction",
    phase,
    requestFingerprint: fingerprint,
    retrySafe
  });
}

function conflict(identities, fingerprint, phase, reason, patch = {}) {
  return result(identities, {
    ...patch,
    status: "conflict",
    reason,
    decision: "manual_resolution_required",
    phase,
    requestFingerprint: fingerprint,
    retrySafe: false
  });
}

function indeterminate(identities, fingerprint, phase, reason, patch = {}) {
  return result(identities, {
    ...patch,
    status: "indeterminate",
    reason,
    decision: "retry_transaction",
    phase,
    requestFingerprint: fingerprint,
    retrySafe: false,
    indeterminate: true
  });
}

function ensureResult(identities, fingerprint, candidate) {
  try {
    if (validatePromotionResult(candidate)) return candidate;
  } catch {
  }
  return result(identities, {
    status: "failed",
    reason: "promotion_result_invalid",
    decision: "retry_transaction",
    phase: "result_serialization",
    requestFingerprint: fingerprint,
    retrySafe: false,
    errors: ["result_contract_violation"]
  });
}
