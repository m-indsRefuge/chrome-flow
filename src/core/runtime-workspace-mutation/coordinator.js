import {
  resolveAssignmentByWindow,
  resolveAssignmentByWorkspace
} from "../runtime-contract/assignments.js";
import { incrementWorkspaceRevision } from "../runtime-contract/revision.js";
import { applyDomainMutation } from "../runtime-contract/reducers.js";
import {
  clone,
  isPlainObject,
  nonEmptyString,
  stableStringify,
  validDateTime
} from "../runtime-contract/value-utils.js";
import { buildScopedLockPlan } from "../runtime-scoped-locks/ordering.js";
import {
  validateActiveContext,
  validateSessionAuthority
} from "../runtime-session-authority/contract.js";
import {
  deriveRuntimeWorkspaceKey,
  runtimeWorkspaceFingerprint,
  snapshotAndValidateRuntimeWorkspaceRecord
} from "../runtime-workspace-record/contract.js";
import {
  createWorkspaceOperationLedger,
  deriveWorkspaceOperationLedgerKey,
  snapshotAndValidateWorkspaceOperationLedger
} from "../runtime-workspace-operation-ledger/contract.js";
import {
  appendOperationProgress,
  inspectWorkspaceOperation,
  recordImmutableOperationIntent,
  recordWorkspaceOperationTerminal
} from "../runtime-workspace-operation-ledger/ledger.js";
import {
  DEFAULT_WORKSPACE_TYPE,
  getWorkspaceRoleLabel,
  getWorkspaceTypeLabel,
  isValidWorkspaceRole
} from "../workspace-role-sets.js";
import {
  RUNTIME_WORKSPACE_MUTATION_COMMAND_SCHEMA,
  createRuntimeWorkspaceMutationResult,
  runtimeWorkspaceMutationFingerprint,
  snapshotAndValidateRuntimeWorkspaceMutationCommand,
  validateRuntimeWorkspaceMutationResult
} from "./contract.js";

const REQUIRED_ADAPTERS = Object.freeze([
  "withScopedLocks",
  "readAuthority",
  "readRuntimeWorkspaceRecord",
  "writeRuntimeWorkspaceRecord",
  "readWorkspaceOperationLedger",
  "writeWorkspaceOperationLedger",
  "now"
]);

export async function coordinateRuntimeWorkspaceMutation(value, adapters) {
  const validation = snapshotAndValidateRuntimeWorkspaceMutationCommand(value);
  if (!validation.valid) {
    return result(value, {
      status: "rejected",
      reason: "invalid_command",
      phase: "command_validation",
      retrySafe: false,
      errors: validation.errors
    });
  }

  const command = validation.command;
  const adapterErrors = adapterValidationErrors(adapters);
  if (adapterErrors.length) {
    return result(command, {
      status: "failed",
      reason: "mutation_adapters_invalid",
      phase: "adapter_validation",
      retrySafe: false,
      errors: adapterErrors
    });
  }

  let plan;
  try {
    plan = buildScopedLockPlan({
      windowIds: [command.sourceWindowId],
      workspaceBindingIds: [command.workspaceId],
      workspaceContentIds: [command.workspaceId]
    });
  } catch (error) {
    return result(command, {
      status: "failed",
      reason: "scoped_lock_plan_invalid",
      phase: "lock_plan",
      retrySafe: false,
      errors: [safeError(error)]
    });
  }

  try {
    return await adapters.withScopedLocks(plan, async () => {
      try {
        return await coordinateUnderScopedLocks(command, adapters);
      } catch (error) {
        return result(command, {
          status: "failed",
          reason: "mutation_coordination_internal_failure",
          phase: "coordination",
          retrySafe: true,
          errors: [safeError(error)]
        });
      }
    });
  } catch (error) {
    return result(command, {
      status: "failed",
      reason: "scoped_lock_unavailable",
      phase: "lock_acquisition",
      retrySafe: true,
      errors: [safeError(error)]
    });
  }
}

async function coordinateUnderScopedLocks(command, adapters) {
  const authority = await readCurrentAuthority(command, adapters);
  if (authority.result) return authority.result;

  const recordRead = await readScopedRecord(command, adapters);
  if (recordRead.result) return recordRead.result;

  const ledgerRead = await readWorkspaceLedger(command, adapters);
  if (ledgerRead.result) return ledgerRead.result;

  let requestFingerprint;
  try {
    requestFingerprint = runtimeWorkspaceMutationFingerprint(command);
  } catch (error) {
    return result(command, evidenceForRecord(recordRead, {
      status: "failed",
      reason: "mutation_fingerprint_failed",
      phase: "operation_inspection",
      retrySafe: false,
      errors: [safeError(error)]
    }));
  }

  const inspection = inspectWorkspaceOperation(
    ledgerRead.ledger,
    command.operationId,
    requestFingerprint
  );
  if (inspection.status === "malformed_recovery_evidence") {
    return result(command, evidenceForRecord(recordRead, {
      status: "failed",
      reason: "workspace_operation_ledger_invalid",
      phase: "operation_inspection",
      retrySafe: false,
      errors: inspection.errors
    }));
  }
  if (inspection.status === "operation_id_conflict") {
    return result(command, evidenceForRecord(recordRead, {
      status: "conflict",
      reason: "operation_id_conflict",
      phase: "operation_inspection",
      retrySafe: true
    }));
  }
  if (inspection.status === "terminal_replay") {
    return terminalReplay(command, inspection.entry, recordRead);
  }
  if (inspection.status !== "missing" && inspection.status !== "recovery_required") {
    return result(command, evidenceForRecord(recordRead, {
      status: "failed",
      reason: "operation_inspection_failed",
      phase: "operation_inspection",
      retrySafe: false,
      errors: inspection.errors
    }));
  }

  const intent = createOrdinaryMutationIntent(command);
  if (inspection.status === "recovery_required") {
    if (!sameJson(inspection.entry?.operationIntent, intent)) {
      return result(command, evidenceForRecord(recordRead, {
        status: "indeterminate",
        reason: "operation_intent_mismatch",
        phase: "recovery_inspection",
        ledgerRecorded: true,
        retrySafe: false,
        indeterminate: true
      }));
    }
    return resumeUnresolvedMutation({
      command,
      adapters,
      recordRead,
      ledger: ledgerRead.ledger,
      entry: inspection.entry,
      requestFingerprint
    });
  }

  if (recordRead.record.workspaceRevision !== command.expectedWorkspaceRevision) {
    return result(command, evidenceForRecord(recordRead, {
      status: "revision_conflict",
      reason: "expected_workspace_revision_mismatch",
      phase: "revision_validation",
      retrySafe: true
    }));
  }

  return performMutationAtOriginalRevision({
    command,
    adapters,
    recordRead,
    ledger: ledgerRead.ledger,
    entry: null,
    requestFingerprint,
    effectiveRequestedAt: command.requestedAt
  });
}

async function resumeUnresolvedMutation(input) {
  const { command, recordRead, entry } = input;
  const candidateEvidence = readCandidateEvidence(entry);

  if (!candidateEvidence.valid) {
    return result(command, evidenceForRecord(recordRead, {
      status: "indeterminate",
      reason: "candidate_progress_invalid",
      phase: "recovery_inspection",
      ledgerRecorded: true,
      retrySafe: false,
      indeterminate: true,
      errors: candidateEvidence.errors
    }));
  }
  if (
    candidateEvidence.value &&
    !candidateEvidenceMatchesCommand(command, candidateEvidence.value)
  ) {
    return result(command, evidenceForRecord(recordRead, {
      status: "indeterminate",
      reason: "candidate_progress_mismatch",
      phase: "recovery_inspection",
      ledgerRecorded: true,
      retrySafe: false,
      indeterminate: true
    }));
  }

  if (
    candidateEvidence.value &&
    recordRead.record.workspaceRevision === candidateEvidence.value.committedRevision &&
    recordRead.fingerprint === candidateEvidence.value.recordFingerprint
  ) {
    const timing = await readOperationTime(command, input.adapters, recordRead);
    if (timing.result) return timing.result;
    const committed = committedResult(command, candidateEvidence.value, {
      phase: "complete"
    });
    return terminalizeVerifiedMutation({
      ...input,
      ledger: input.ledger,
      terminalResult: committed,
      operationTime: timing.now
    });
  }

  if (recordRead.record.workspaceRevision !== command.expectedWorkspaceRevision) {
    return result(command, evidenceForRecord(recordRead, {
      status: "indeterminate",
      reason: "unresolved_record_state",
      phase: "recovery_inspection",
      ledgerRecorded: true,
      retrySafe: false,
      indeterminate: true
    }));
  }

  return performMutationAtOriginalRevision({
    ...input,
    effectiveRequestedAt: entry.requestedAt,
    candidateEvidence
  });
}

async function performMutationAtOriginalRevision(input) {
  const {
    command,
    adapters,
    recordRead,
    requestFingerprint,
    effectiveRequestedAt
  } = input;
  const semantic = evaluateSemanticMutation(
    recordRead.record.workspace,
    command,
    effectiveRequestedAt
  );
  if (semantic.outcome === "rejected") {
    return result(command, evidenceForRecord(recordRead, {
      status: "rejected",
      reason: semantic.reason,
      phase: "semantic_evaluation",
      retrySafe: true,
      errors: semantic.errors
    }));
  }

  let candidate = null;
  if (semantic.outcome === "changed") {
    const candidateCreation = createCandidateRecord(
      recordRead.record,
      semantic.workspace,
      effectiveRequestedAt
    );
    if (!candidateCreation.valid) {
      return result(command, evidenceForRecord(recordRead, {
        status: "rejected",
        reason: "semantic_candidate_invalid",
        phase: "semantic_evaluation",
        retrySafe: false,
        errors: candidateCreation.errors
      }));
    }
    candidate = candidateCreation;
  }

  const timing = await readOperationTime(command, adapters, recordRead);
  if (timing.result) return timing.result;

  let ledger = input.ledger;
  let entry = input.entry;
  if (!entry) {
    const pending = await persistImmutableIntent({
      command,
      adapters,
      ledger,
      requestFingerprint,
      operationTime: timing.now,
      recordRead
    });
    if (pending.result) return pending.result;
    ledger = pending.ledger;
    entry = pending.entry;
  }

  if (semantic.outcome === "no_change") {
    const noChange = result(command, evidenceForRecord(recordRead, {
      status: "no_change",
      reason: "",
      previousRevision: recordRead.record.workspaceRevision,
      committedRevision: recordRead.record.workspaceRevision,
      phase: "complete",
      mutationCommitted: false,
      authorityVerified: true,
      workspaceVerified: true,
      ledgerRecorded: true,
      retrySafe: true,
      indeterminate: false
    }));
    return terminalizeNoChange({
      command,
      adapters,
      ledger,
      recordRead,
      requestFingerprint,
      terminalResult: noChange,
      operationTime: timing.now
    });
  }

  const candidateProgress = candidateProgressEvidence(candidate);
  const existingCandidate = input.candidateEvidence || readCandidateEvidence(entry);
  if (!existingCandidate.valid) {
    return result(command, evidenceForRecord(recordRead, {
      status: "indeterminate",
      reason: "candidate_progress_invalid",
      phase: "recovery_inspection",
      ledgerRecorded: true,
      retrySafe: false,
      indeterminate: true,
      errors: existingCandidate.errors
    }));
  }
  if (existingCandidate.value && !sameJson(existingCandidate.value, candidateProgress)) {
    return result(command, evidenceForRecord(recordRead, {
      status: "indeterminate",
      reason: "candidate_progress_mismatch",
      phase: "recovery_inspection",
      ledgerRecorded: true,
      retrySafe: false,
      indeterminate: true
    }));
  }
  if (!existingCandidate.value) {
    const progress = await persistCandidateProgress({
      command,
      adapters,
      ledger,
      requestFingerprint,
      operationTime: timing.now,
      candidateProgress,
      recordRead
    });
    if (progress.result) return progress.result;
    ledger = progress.ledger;
  }

  try {
    await adapters.writeRuntimeWorkspaceRecord(command.workspaceId, candidate.record);
  } catch (error) {
    return result(command, evidenceForRecord(recordRead, {
      status: "failed",
      reason: "runtime_record_write_failed",
      phase: "runtime_record_mutation",
      recordFingerprint: candidate.recordFingerprint,
      committedRevision: candidate.committedRevision,
      ledgerRecorded: true,
      retrySafe: true,
      errors: [safeError(error)]
    }));
  }

  const verification = await verifyCandidateRecord(command, adapters, candidate);
  if (verification.result) return verification.result;

  const committed = committedResult(command, candidate, { phase: "complete" });
  return terminalizeVerifiedMutation({
    command,
    adapters,
    ledger,
    recordRead: verification,
    requestFingerprint,
    terminalResult: committed,
    operationTime: timing.now
  });
}

async function readCurrentAuthority(command, adapters) {
  let root;
  try {
    root = await adapters.readAuthority();
  } catch (error) {
    return {
      result: result(command, {
        status: "failed",
        reason: "session_authority_read_failed",
        phase: "authority_validation",
        retrySafe: true,
        errors: [safeError(error)]
      })
    };
  }

  const validation = validateSessionAuthority(root);
  if (!validation.valid) {
    return {
      result: result(command, {
        status: "failed",
        reason: root === undefined
          ? "session_authority_absent"
          : "malformed_session_authority",
        phase: "authority_validation",
        retrySafe: false,
        errors: validation.errors
      })
    };
  }
  if (root.runtimeSessionId !== command.runtimeSessionId) {
    return {
      result: result(command, {
        status: "rejected",
        reason: "runtime_session_mismatch",
        phase: "authority_validation",
        retrySafe: true
      })
    };
  }

  const context = validateActiveContext(
    root,
    command.sourceContextId,
    command.sourceWindowId
  );
  if (!context.valid) {
    return {
      result: result(command, {
        status: "rejected",
        reason: context.reason,
        phase: "authority_validation",
        retrySafe: true
      })
    };
  }

  const byWindow = resolveAssignmentByWindow(
    root.assignmentRegistry,
    command.sourceWindowId
  );
  const byWorkspace = resolveAssignmentByWorkspace(
    root.assignmentRegistry,
    command.workspaceId
  );
  if (!byWindow || byWindow.workspaceId !== command.workspaceId) {
    const reason = byWorkspace && byWorkspace.windowId !== command.sourceWindowId
      ? "workspace_assignment_mismatch"
      : "source_window_assignment_mismatch";
    return {
      result: result(command, {
        status: "rejected",
        reason,
        phase: "authority_validation",
        retrySafe: true
      })
    };
  }
  if (!byWorkspace || byWorkspace.windowId !== command.sourceWindowId) {
    return {
      result: result(command, {
        status: "rejected",
        reason: "workspace_assignment_mismatch",
        phase: "authority_validation",
        retrySafe: true
      })
    };
  }
  if (!sameAssignment(byWindow, byWorkspace)) {
    return {
      result: result(command, {
        status: "rejected",
        reason: "assignment_resolution_mismatch",
        phase: "authority_validation",
        retrySafe: true
      })
    };
  }
  if (byWindow.runtimeAssignmentId !== command.runtimeAssignmentId) {
    return {
      result: result(command, {
        status: "rejected",
        reason: "runtime_assignment_mismatch",
        phase: "authority_validation",
        retrySafe: true
      })
    };
  }
  if (byWindow.assignmentEpoch !== command.assignmentEpoch) {
    return {
      result: result(command, {
        status: "rejected",
        reason: "assignment_epoch_mismatch",
        phase: "authority_validation",
        retrySafe: true
      })
    };
  }
  return { root, assignment: byWindow };
}

async function readScopedRecord(command, adapters) {
  let rawRecord;
  try {
    rawRecord = await adapters.readRuntimeWorkspaceRecord(command.workspaceId);
  } catch (error) {
    return {
      result: result(command, {
        status: "failed",
        reason: "runtime_record_read_failed",
        phase: "runtime_record_read",
        authorityVerified: true,
        retrySafe: true,
        errors: [safeError(error)]
      })
    };
  }

  const validation = snapshotAndValidateRuntimeWorkspaceRecord(rawRecord, {
    workspaceId: command.workspaceId,
    key: deriveRuntimeWorkspaceKey(command.workspaceId)
  });
  if (!validation.valid) {
    return {
      result: result(command, {
        status: "rejected",
        reason: rawRecord === undefined
          ? "runtime_record_absent"
          : "runtime_record_invalid",
        phase: "runtime_record_read",
        authorityVerified: true,
        retrySafe: false,
        errors: validation.errors
      })
    };
  }
  if (validation.record.lifecycleState !== "available") {
    return {
      result: result(command, {
        status: "rejected",
        reason: "workspace_lifecycle_paused",
        phase: "runtime_record_read",
        authorityVerified: true,
        retrySafe: true
      })
    };
  }

  try {
    return {
      record: validation.record,
      fingerprint: runtimeWorkspaceFingerprint(validation.record)
    };
  } catch (error) {
    return {
      result: result(command, {
        status: "failed",
        reason: "runtime_record_fingerprint_failed",
        phase: "runtime_record_read",
        authorityVerified: true,
        retrySafe: false,
        errors: [safeError(error)]
      })
    };
  }
}

async function readWorkspaceLedger(command, adapters) {
  let rawLedger;
  try {
    rawLedger = await adapters.readWorkspaceOperationLedger(command.workspaceId);
  } catch (error) {
    return {
      result: result(command, {
        status: "failed",
        reason: "workspace_operation_ledger_read_failed",
        phase: "ledger_read",
        authorityVerified: true,
        workspaceVerified: true,
        retrySafe: true,
        errors: [safeError(error)]
      })
    };
  }

  if (rawLedger === undefined) {
    return { ledger: createWorkspaceOperationLedger(command.workspaceId) };
  }

  const validation = snapshotAndValidateWorkspaceOperationLedger(rawLedger, {
    workspaceId: command.workspaceId,
    key: deriveWorkspaceOperationLedgerKey(command.workspaceId)
  });
  if (!validation.valid) {
    return {
      result: result(command, {
        status: "failed",
        reason: "workspace_operation_ledger_invalid",
        phase: "ledger_read",
        authorityVerified: true,
        workspaceVerified: true,
        retrySafe: false,
        errors: validation.errors
      })
    };
  }
  return { ledger: validation.ledger };
}

async function persistImmutableIntent(input) {
  const intent = createOrdinaryMutationIntent(input.command);
  const recorded = recordImmutableOperationIntent(input.ledger, {
    operationId: input.command.operationId,
    requestFingerprint: input.requestFingerprint,
    commandSchema: RUNTIME_WORKSPACE_MUTATION_COMMAND_SCHEMA,
    affectedWorkspaceIds: [input.command.workspaceId],
    runtimeSessionId: input.command.runtimeSessionId,
    requestedAt: input.command.requestedAt,
    operationIntent: intent
  });
  if (recorded.status !== "recorded") {
    return {
      result: result(input.command, evidenceForRecord(input.recordRead, {
        status: "failed",
        reason: "pending_intent_invalid",
        phase: "pending_intent",
        retrySafe: false,
        errors: recorded.errors
      }))
    };
  }

  const persisted = await persistLedger(
    input.command,
    input.adapters,
    recorded.ledger,
    input.requestFingerprint,
    (entry) => entry.state === "pending" &&
      entry.phase === "pending_evidence" &&
      sameJson(entry.operationIntent, intent)
  );
  if (!persisted.ok) {
    return {
      result: result(input.command, evidenceForRecord(input.recordRead, {
        status: "failed",
        reason: persisted.stage === "write"
          ? "pending_intent_write_failed"
          : "pending_intent_verification_failed",
        phase: "pending_intent",
        retrySafe: true,
        errors: persisted.errors
      }))
    };
  }
  return { ledger: persisted.ledger, entry: persisted.entry };
}

async function persistCandidateProgress(input) {
  const progress = appendOperationProgress(
    input.ledger,
    input.command.operationId,
    input.requestFingerprint,
    {
      phase: "runtime_record_candidate",
      updatedAt: input.operationTime,
      completedPhases: ["runtime_record_candidate"],
      nextRecoverablePhase: "runtime_record_mutation",
      createdArtifacts: [input.candidateProgress]
    }
  );
  if (progress.status !== "progress_recorded") {
    return {
      result: result(input.command, evidenceForRecord(input.recordRead, {
        status: "failed",
        reason: "candidate_progress_invalid",
        phase: "candidate_progress",
        ledgerRecorded: true,
        retrySafe: false,
        errors: progress.errors
      }))
    };
  }

  const persisted = await persistLedger(
    input.command,
    input.adapters,
    progress.ledger,
    input.requestFingerprint,
    (entry) => entry.state === "pending" &&
      entry.phase === "runtime_record_candidate" &&
      sameJson(readCandidateEvidence(entry).value, input.candidateProgress)
  );
  if (!persisted.ok) {
    return {
      result: result(input.command, evidenceForRecord(input.recordRead, {
        status: "failed",
        reason: persisted.stage === "write"
          ? "candidate_progress_write_failed"
          : "candidate_progress_verification_failed",
        phase: "candidate_progress",
        ledgerRecorded: true,
        retrySafe: true,
        errors: persisted.errors
      }))
    };
  }
  return { ledger: persisted.ledger, entry: persisted.entry };
}

async function verifyCandidateRecord(command, adapters, candidate) {
  let rawRecord;
  try {
    rawRecord = await adapters.readRuntimeWorkspaceRecord(command.workspaceId);
  } catch (error) {
    return {
      result: result(command, {
        status: "indeterminate",
        reason: "runtime_record_verification_read_failed",
        phase: "runtime_record_verification",
        previousRevision: candidate.previousRevision,
        committedRevision: candidate.committedRevision,
        recordFingerprint: candidate.recordFingerprint,
        mutationCommitted: false,
        authorityVerified: true,
        workspaceVerified: false,
        ledgerRecorded: true,
        retrySafe: false,
        indeterminate: true,
        errors: [safeError(error)]
      })
    };
  }
  const validation = snapshotAndValidateRuntimeWorkspaceRecord(rawRecord, {
    workspaceId: command.workspaceId,
    key: deriveRuntimeWorkspaceKey(command.workspaceId)
  });
  if (!validation.valid) {
    return {
      result: result(command, {
        status: "indeterminate",
        reason: "runtime_record_verification_failed",
        phase: "runtime_record_verification",
        previousRevision: candidate.previousRevision,
        committedRevision: candidate.committedRevision,
        recordFingerprint: candidate.recordFingerprint,
        authorityVerified: true,
        workspaceVerified: false,
        ledgerRecorded: true,
        retrySafe: false,
        indeterminate: true,
        errors: validation.errors
      })
    };
  }
  let fingerprint = "";
  try {
    fingerprint = runtimeWorkspaceFingerprint(validation.record);
  } catch (error) {
    return {
      result: result(command, {
        status: "indeterminate",
        reason: "runtime_record_verification_failed",
        phase: "runtime_record_verification",
        previousRevision: candidate.previousRevision,
        committedRevision: candidate.committedRevision,
        recordFingerprint: candidate.recordFingerprint,
        authorityVerified: true,
        workspaceVerified: false,
        ledgerRecorded: true,
        retrySafe: false,
        indeterminate: true,
        errors: [safeError(error)]
      })
    };
  }
  if (
    validation.record.workspaceRevision !== candidate.committedRevision ||
    fingerprint !== candidate.recordFingerprint
  ) {
    return {
      result: result(command, {
        status: "indeterminate",
        reason: "runtime_record_verification_failed",
        phase: "runtime_record_verification",
        previousRevision: candidate.previousRevision,
        committedRevision: candidate.committedRevision,
        recordFingerprint: candidate.recordFingerprint,
        authorityVerified: true,
        workspaceVerified: false,
        ledgerRecorded: true,
        retrySafe: false,
        indeterminate: true
      })
    };
  }
  return { record: validation.record, fingerprint };
}

async function terminalizeNoChange(input) {
  const terminal = recordWorkspaceOperationTerminal(
    input.ledger,
    input.command.operationId,
    input.requestFingerprint,
    {
      phase: "complete",
      updatedAt: input.operationTime,
      completedPhases: ["runtime_record_no_change"],
      result: input.terminalResult
    }
  );
  if (terminal.status !== "terminal_recorded") {
    return result(input.command, evidenceForRecord(input.recordRead, {
      status: "failed",
      reason: "terminal_ledger_invalid",
      phase: "terminal_ledger",
      retrySafe: false,
      errors: terminal.errors
    }));
  }
  const persisted = await persistLedger(
    input.command,
    input.adapters,
    terminal.ledger,
    input.requestFingerprint,
    (entry) => entry.state === "terminal" &&
      sameJson(entry.result, input.terminalResult)
  );
  if (!persisted.ok) {
    return result(input.command, evidenceForRecord(input.recordRead, {
      status: "failed",
      reason: persisted.stage === "write"
        ? "terminal_ledger_write_failed"
        : "terminal_ledger_verification_failed",
      phase: "terminal_ledger",
      retrySafe: true,
      errors: persisted.errors
    }));
  }
  return input.terminalResult;
}

async function terminalizeVerifiedMutation(input) {
  const terminal = recordWorkspaceOperationTerminal(
    input.ledger,
    input.command.operationId,
    input.requestFingerprint,
    {
      phase: "complete",
      updatedAt: input.operationTime,
      completedPhases: [
        "runtime_record_mutation",
        "runtime_record_verification"
      ],
      result: input.terminalResult
    }
  );
  if (terminal.status !== "terminal_recorded") {
    return indeterminateTerminalResult(
      input.command,
      input.recordRead,
      input.terminalResult,
      "terminal_ledger_invalid",
      terminal.errors
    );
  }
  const persisted = await persistLedger(
    input.command,
    input.adapters,
    terminal.ledger,
    input.requestFingerprint,
    (entry) => entry.state === "terminal" &&
      sameJson(entry.result, input.terminalResult)
  );
  if (!persisted.ok) {
    return indeterminateTerminalResult(
      input.command,
      input.recordRead,
      input.terminalResult,
      persisted.stage === "write"
        ? "terminal_ledger_write_failed"
        : "terminal_ledger_verification_failed",
      persisted.errors
    );
  }
  return input.terminalResult;
}

async function persistLedger(command, adapters, ledger, requestFingerprint, expected) {
  try {
    await adapters.writeWorkspaceOperationLedger(command.workspaceId, ledger);
  } catch (error) {
    return { ok: false, stage: "write", errors: [safeError(error)] };
  }
  let rawLedger;
  try {
    rawLedger = await adapters.readWorkspaceOperationLedger(command.workspaceId);
  } catch (error) {
    return { ok: false, stage: "verification", errors: [safeError(error)] };
  }
  const validation = snapshotAndValidateWorkspaceOperationLedger(rawLedger, {
    workspaceId: command.workspaceId,
    key: deriveWorkspaceOperationLedgerKey(command.workspaceId)
  });
  if (!validation.valid) {
    return { ok: false, stage: "verification", errors: validation.errors };
  }
  const entry = validation.ledger.entries.find((candidate) =>
    candidate.operationId === command.operationId &&
    candidate.requestFingerprint === requestFingerprint
  );
  if (!entry || !expected(entry)) {
    return {
      ok: false,
      stage: "verification",
      errors: ["workspace operation ledger did not persist expected evidence"]
    };
  }
  return { ok: true, ledger: validation.ledger, entry };
}

async function readOperationTime(command, adapters, recordRead) {
  let now;
  try {
    now = await adapters.now();
  } catch (error) {
    return {
      result: result(command, evidenceForRecord(recordRead, {
        status: "failed",
        reason: "operation_time_read_failed",
        phase: "operation_timing",
        retrySafe: true,
        errors: [safeError(error)]
      }))
    };
  }
  if (!validDateTime(now)) {
    return {
      result: result(command, evidenceForRecord(recordRead, {
        status: "failed",
        reason: "operation_time_invalid",
        phase: "operation_timing",
        retrySafe: false
      }))
    };
  }
  return { now };
}

function evaluateSemanticMutation(workspace, command, requestedAt) {
  if (!isPlainObject(workspace)) {
    return semanticRejected("workspace_semantic_state_invalid");
  }
  if (command.mutationKind === "journal.append") {
    return reducerOutcome(
      workspace,
      "journal.append",
      { record: command.payload.record }
    );
  }
  if (command.mutationKind === "timeline.append") {
    return reducerOutcome(
      workspace,
      "timeline.append",
      { record: command.payload.record }
    );
  }
  if (command.mutationKind === "workspace.metadata.autosave") {
    return applyAutosave(workspace, command.payload, requestedAt);
  }
  if (command.mutationKind === "workspace.metadata.commit") {
    return applyMetadataCommit(workspace, command.payload, requestedAt);
  }
  if (command.mutationKind === "workspace.tab.metadata.commit") {
    return applyTabMetadataCommit(workspace, command.payload, requestedAt);
  }
  if (command.mutationKind === "search.intake.add") {
    return applySearchIntake(workspace, command.payload, requestedAt);
  }
  return semanticRejected("unsupported_mutation_kind");
}

function applyAutosave(workspace, payload, requestedAt) {
  const patched = reducerOutcome(workspace, "workspace.metadata.patch", {
    patch: { name: payload.name, aim: payload.aim }
  });
  if (patched.outcome === "rejected") return patched;
  const next = { ...patched.workspace, updatedAt: requestedAt };
  return sameJson(next, workspace)
    ? semanticNoChange(workspace, "metadata_current")
    : semanticChanged(next);
}

function applyMetadataCommit(workspace, payload, requestedAt) {
  const previousType = workspace.workspaceType || DEFAULT_WORKSPACE_TYPE;
  const typeChanged = previousType !== payload.workspaceType;
  const metadataChanged = (workspace.name || "") !== payload.name ||
    (workspace.aim || "") !== payload.aim;
  if (payload.mode === "type_change" && !typeChanged && !metadataChanged) {
    return semanticNoChange(workspace, "metadata_current");
  }

  const patched = reducerOutcome(workspace, "workspace.metadata.patch", {
    patch: {
      name: payload.name,
      aim: payload.aim,
      workspaceType: payload.workspaceType
    }
  });
  if (patched.outcome === "rejected") return patched;
  let next = patched.workspace;
  if (typeChanged) {
    const roles = normalizeRolesForWorkspaceType(next.tabs, payload.workspaceType);
    if (!roles.valid) return semanticRejected(roles.reason, roles.errors);
    next = { ...next, tabs: roles.tabs };
  }

  next = { ...next, updatedAt: requestedAt };
  if (payload.mode === "save") {
    return appendSemanticTimeline(next, {
      eventId: payload.eventId,
      type: "workspace_saved",
      message: "Workspace saved.",
      createdAt: requestedAt
    });
  }
  if (typeChanged) {
    return appendSemanticTimeline(next, {
      eventId: payload.eventId,
      type: "workspace_type_updated",
      message: "Workspace type changed from " +
        getWorkspaceTypeLabel(previousType) + " to " +
        getWorkspaceTypeLabel(payload.workspaceType) + ".",
      createdAt: requestedAt,
      previousType,
      nextType: payload.workspaceType
    });
  }
  return semanticChanged(next);
}

function applyTabMetadataCommit(workspace, payload, requestedAt) {
  const tabs = validatedTabs(workspace.tabs);
  if (!tabs.valid) return semanticRejected(tabs.reason, tabs.errors);
  const tab = tabs.tabs.find((item) => item.workspaceTabId === payload.workspaceTabId);
  if (!tab) return semanticRejected("workspace_tab_not_found");

  if (payload.field === "alias") {
    const alias = payload.value.trim();
    const patched = reducerOutcome(workspace, "workspace.tab.metadata.patch", {
      workspaceTabId: payload.workspaceTabId,
      patch: { alias }
    });
    if (patched.outcome === "rejected") return patched;
    const nextTab = patched.workspace.tabs.find(
      (item) => item.workspaceTabId === payload.workspaceTabId
    );
    return appendSemanticTimeline(
      { ...patched.workspace, updatedAt: requestedAt },
      {
        eventId: payload.eventId,
        type: "tab_alias_updated",
        message: "Updated alias for " + tabTitle(nextTab) + ".",
        createdAt: requestedAt,
        workspaceTabId: payload.workspaceTabId,
        tabId: nextTab.tabId,
        alias
      }
    );
  }

  const workspaceType = workspace.workspaceType || DEFAULT_WORKSPACE_TYPE;
  const role = payload.value === "" ? "unassigned" : payload.value;
  if (!isValidWorkspaceRole(workspaceType, role)) {
    return semanticRejected("workspace_role_invalid_for_type");
  }
  const previousRole = tab.role || "unassigned";
  const patched = reducerOutcome(workspace, "workspace.tab.metadata.patch", {
    workspaceTabId: payload.workspaceTabId,
    patch: { role }
  });
  if (patched.outcome === "rejected") return patched;
  const nextTab = patched.workspace.tabs.find(
    (item) => item.workspaceTabId === payload.workspaceTabId
  );
  return appendSemanticTimeline(
    { ...patched.workspace, updatedAt: requestedAt },
    {
      eventId: payload.eventId,
      type: "tab_role_updated",
      message: "Assigned " + tabName(nextTab) + " to " +
        getWorkspaceRoleLabel(workspaceType, role) + " subgroup.",
      createdAt: requestedAt,
      workspaceTabId: payload.workspaceTabId,
      tabId: nextTab.tabId,
      url: nextTab.url || "",
      previousRole,
      role
    }
  );
}

function applySearchIntake(workspace, payload, requestedAt) {
  const tabs = validatedTabs(workspace.tabs);
  if (!tabs.valid) return semanticRejected(tabs.reason, tabs.errors);
  if (tabs.tabs.some((item) => item.tabId === payload.tab.tabId)) {
    return semanticNoChange(workspace, "browser_tab_already_in_workspace");
  }
  const added = reducerOutcome(workspace, "workspace.tab.add", { tab: payload.tab });
  if (added.outcome === "rejected") return added;
  const nextTab = added.workspace.tabs.find(
    (item) => item.workspaceTabId === payload.tab.workspaceTabId
  );
  return appendSemanticTimeline(
    { ...added.workspace, updatedAt: requestedAt },
    {
      eventId: payload.eventId,
      type: "browser_search_tab_added_to_workspace",
      message: "Opened search tab and added it to the workspace: " +
        tabName(nextTab) + ".",
      createdAt: requestedAt,
      query: payload.query,
      tabId: nextTab.tabId,
      url: nextTab.url || "",
      workspaceTabId: nextTab.workspaceTabId,
      sameUrlDuplicate: payload.sameUrlDuplicate,
      searchLaunchAutoIntake: true
    }
  );
}

function reducerOutcome(workspace, mutationType, payload) {
  let reduced;
  try {
    reduced = applyDomainMutation(workspace, mutationType, payload);
  } catch (error) {
    return semanticRejected("domain_mutation_failed", [safeError(error)]);
  }
  if (reduced?.outcome === "changed") return semanticChanged(reduced.workspace);
  if (reduced?.outcome === "no_change") {
    return semanticNoChange(reduced.workspace || workspace, reduced.reason || "semantic_current");
  }
  return semanticRejected(reduced?.reason || "domain_mutation_rejected");
}

function appendSemanticTimeline(workspace, event) {
  if (!Array.isArray(workspace.timeline)) {
    return semanticRejected("workspace_timeline_invalid");
  }
  const appended = reducerOutcome(workspace, "timeline.append", { record: event });
  return appended.outcome === "changed"
    ? semanticChanged(appended.workspace)
    : appended;
}

function normalizeRolesForWorkspaceType(tabs, workspaceType) {
  const validation = validatedTabs(tabs);
  if (!validation.valid) return validation;
  return {
    valid: true,
    tabs: validation.tabs.map((tab) => {
      const role = tab.role || "unassigned";
      return isValidWorkspaceRole(workspaceType, role)
        ? clone(tab)
        : { ...clone(tab), role: "unassigned" };
    })
  };
}

function validatedTabs(value) {
  if (!Array.isArray(value)) {
    return { valid: false, reason: "workspace_tabs_invalid", errors: [] };
  }
  const ids = new Set();
  for (const tab of value) {
    if (!isPlainObject(tab) || !nonEmptyString(tab.workspaceTabId)) {
      return {
        valid: false,
        reason: "workspace_tab_identity_invalid",
        errors: []
      };
    }
    if (ids.has(tab.workspaceTabId)) {
      return {
        valid: false,
        reason: "workspace_tab_identity_duplicate",
        errors: []
      };
    }
    ids.add(tab.workspaceTabId);
  }
  return { valid: true, tabs: value.map((tab) => clone(tab)) };
}

function createCandidateRecord(record, workspace, requestedAt) {
  const incremented = incrementWorkspaceRevision(workspace);
  if (!incremented.valid) return { valid: false, errors: incremented.errors };
  const candidate = {
    ...record,
    workspace: incremented.workspace,
    workspaceRevision: incremented.revision,
    lastVerifiedAt: requestedAt
  };
  const validation = snapshotAndValidateRuntimeWorkspaceRecord(candidate, {
    workspaceId: record.workspaceId,
    key: deriveRuntimeWorkspaceKey(record.workspaceId)
  });
  if (!validation.valid) return { valid: false, errors: validation.errors };
  try {
    return {
      valid: true,
      record: validation.record,
      recordFingerprint: runtimeWorkspaceFingerprint(validation.record),
      previousRevision: record.workspaceRevision,
      committedRevision: validation.record.workspaceRevision
    };
  } catch (error) {
    return { valid: false, errors: [safeError(error)] };
  }
}

function createOrdinaryMutationIntent(command) {
  return {
    operationKind: "ordinary_mutation",
    commandSchema: RUNTIME_WORKSPACE_MUTATION_COMMAND_SCHEMA,
    primaryWorkspaceId: command.workspaceId,
    affectedWorkspaceIds: [command.workspaceId],
    sourceWindowId: command.sourceWindowId,
    targetWindowId: null,
    expectedRuntimeSessionId: command.runtimeSessionId,
    expectedAssignmentId: command.runtimeAssignmentId,
    expectedAssignmentEpoch: command.assignmentEpoch,
    expectedWorkspaceRevisions: {
      [command.workspaceId]: command.expectedWorkspaceRevision
    },
    durableSourceIdentity: null,
    durableSnapshotDigest: null,
    browserPlanDigest: null,
    projectionBaselineDigest: null,
    compatibilityPreflightFingerprints: {
      canonical: null,
      legacy: null
    },
    completedPhasesAtIntentWrite: [],
    nextRecoverablePhaseAtIntentWrite: "runtime_record_mutation",
    plannedArtifactIds: [deriveRuntimeWorkspaceKey(command.workspaceId)]
  };
}

function candidateProgressEvidence(candidate) {
  return {
    kind: "runtime_record_candidate",
    key: deriveRuntimeWorkspaceKey(candidate.record.workspaceId),
    recordFingerprint: candidate.recordFingerprint,
    previousRevision: candidate.previousRevision,
    committedRevision: candidate.committedRevision
  };
}

function readCandidateEvidence(entry) {
  if (!Array.isArray(entry?.createdArtifacts)) {
    return { valid: false, errors: ["candidate progress artifacts are invalid"] };
  }
  if (entry.createdArtifacts.length === 0) return { valid: true, value: null };
  if (entry.createdArtifacts.length !== 1) {
    return { valid: false, errors: ["candidate progress artifacts are ambiguous"] };
  }
  const value = entry.createdArtifacts[0];
  const expectedFields = [
    "kind",
    "key",
    "recordFingerprint",
    "previousRevision",
    "committedRevision"
  ];
  if (!isPlainObject(value) || !sameJson(Object.keys(value).sort(), expectedFields.sort())) {
    return { valid: false, errors: ["candidate progress fields are invalid"] };
  }
  if (
    value.kind !== "runtime_record_candidate" ||
    !nonEmptyString(value.key) ||
    !nonEmptyString(value.recordFingerprint) ||
    !Number.isSafeInteger(value.previousRevision) ||
    value.previousRevision < 0 ||
    !Number.isSafeInteger(value.committedRevision) ||
    value.committedRevision < value.previousRevision
  ) {
    return { valid: false, errors: ["candidate progress values are invalid"] };
  }
  return { valid: true, value: clone(value) };
}

function candidateEvidenceMatchesCommand(command, value) {
  return value.key === deriveRuntimeWorkspaceKey(command.workspaceId) &&
    value.previousRevision === command.expectedWorkspaceRevision &&
    value.committedRevision === value.previousRevision + 1;
}

function terminalReplay(command, entry, recordRead) {
  const stored = validateRuntimeWorkspaceMutationResult(
    entry?.result,
    resultAuthority(command)
  );
  if (!stored.valid) {
    return result(command, evidenceForRecord(recordRead, {
      status: "failed",
      reason: "terminal_result_invalid",
      phase: "operation_inspection",
      retrySafe: false,
      errors: stored.errors
    }));
  }
  if (!["committed", "no_change"].includes(stored.result.status)) {
    return result(command, evidenceForRecord(recordRead, {
      status: "failed",
      reason: "terminal_replay_source_invalid",
      phase: "operation_inspection",
      retrySafe: false,
      errors: [
        "stored terminal result is not an original committed or no_change outcome"
      ]
    }));
  }
  return result(command, {
    status: "replayed",
    reason: "",
    previousRevision: stored.result.previousRevision,
    committedRevision: stored.result.committedRevision,
    recordFingerprint: stored.result.recordFingerprint,
    phase: "complete",
    mutationCommitted: false,
    authorityVerified: true,
    workspaceVerified: true,
    ledgerRecorded: true,
    retrySafe: true,
    indeterminate: false
  });
}

function committedResult(command, candidate, fields = {}) {
  return result(command, {
    status: "committed",
    reason: "",
    previousRevision: candidate.previousRevision,
    committedRevision: candidate.committedRevision,
    recordFingerprint: candidate.recordFingerprint,
    phase: fields.phase || "complete",
    mutationCommitted: true,
    authorityVerified: true,
    workspaceVerified: true,
    ledgerRecorded: true,
    retrySafe: true,
    indeterminate: false
  });
}

function indeterminateTerminalResult(command, recordRead, terminalResult, reason, errors) {
  return result(command, evidenceForRecord(recordRead, {
    status: "indeterminate",
    reason,
    previousRevision: terminalResult.previousRevision,
    committedRevision: terminalResult.committedRevision,
    recordFingerprint: terminalResult.recordFingerprint,
    phase: "terminal_ledger",
    mutationCommitted: true,
    authorityVerified: true,
    workspaceVerified: true,
    ledgerRecorded: false,
    retrySafe: false,
    indeterminate: true,
    errors
  }));
}

function evidenceForRecord(recordRead, fields = {}) {
  return {
    previousRevision: recordRead?.record?.workspaceRevision ?? null,
    recordFingerprint: recordRead?.fingerprint || "",
    authorityVerified: true,
    workspaceVerified: true,
    ...fields
  };
}

function resultAuthority(command) {
  return {
    operationId: command.operationId,
    runtimeSessionId: command.runtimeSessionId,
    sourceContextId: command.sourceContextId,
    sourceWindowId: command.sourceWindowId,
    workspaceId: command.workspaceId,
    runtimeAssignmentId: command.runtimeAssignmentId,
    assignmentEpoch: command.assignmentEpoch
  };
}

function result(command, fields) {
  return createRuntimeWorkspaceMutationResult(command, fields);
}

function semanticChanged(workspace) {
  return { outcome: "changed", workspace: clone(workspace), reason: "", errors: [] };
}

function semanticNoChange(workspace, reason) {
  return {
    outcome: "no_change",
    workspace: clone(workspace),
    reason: reason || "semantic_current",
    errors: []
  };
}

function semanticRejected(reason, errors = []) {
  return {
    outcome: "rejected",
    workspace: null,
    reason,
    errors: Array.isArray(errors) ? errors : []
  };
}

function sameAssignment(left, right) {
  return Boolean(
    left && right &&
    left.runtimeAssignmentId === right.runtimeAssignmentId &&
    left.workspaceId === right.workspaceId &&
    left.windowId === right.windowId &&
    left.assignmentEpoch === right.assignmentEpoch &&
    left.sourceContextId === right.sourceContextId
  );
}

function sameJson(left, right) {
  try {
    return stableStringify(left) === stableStringify(right);
  } catch {
    return false;
  }
}

function tabTitle(tab) {
  return tab?.originalTitle || tab?.displayUrl || "tab";
}

function tabName(tab) {
  return tab?.alias || tab?.originalTitle || tab?.displayUrl || tab?.url || "tab";
}

function adapterValidationErrors(adapters) {
  if (!adapters || typeof adapters !== "object") {
    return ["mutation adapters must be an object"];
  }
  return REQUIRED_ADAPTERS.filter((name) => typeof adapters[name] !== "function")
    .map((name) => "mutation adapter is missing: " + name);
}

function safeError(error) {
  return String(error?.message || error || "unknown_error");
}
