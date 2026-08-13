import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  WORKSPACE_OPERATION_COMMAND_SCHEMAS
} from "../../src/core/runtime-workspace-operation-ledger/contract.js";
import { assignRuntime } from "../../src/core/runtime-contract/assignments.js";
import {
  createContextResult,
  createSessionAuthority,
  registerContext
} from "../../src/core/runtime-session-authority/contract.js";
import {
  RUNTIME_WORKSPACE_SCHEMA,
  deriveRuntimeWorkspaceKey
} from "../../src/core/runtime-workspace-record/contract.js";
import {
  createWindowBindingResolveResult,
  WINDOW_BINDING_RESOLVE_TYPE
} from "../../src/core/runtime-window-binding/contract.js";
import {
  SIDE_PANEL_ASSIGNED_WORKSPACE_AUTHORITY_SCHEMA
} from "../../src/core/runtime-window-binding/side-panel-authority.js";
import {
  createWorkspaceOperationLedger
} from "../../src/core/runtime-workspace-operation-ledger/contract.js";

const mutationContract = await import(
  "../../src/core/runtime-workspace-mutation/contract.js"
).catch(() => null);

const mutationCoordinator = await import(
  "../../src/core/runtime-workspace-mutation/coordinator.js"
).catch(() => null);

const mutationChromeAdapter = await import(
  "../../src/core/runtime-workspace-mutation/chrome-adapter.js"
).catch(() => null);

const mutationClient = await import(
  "../../src/core/runtime-workspace-mutation/client.js"
).catch(() => null);

const mutationServiceWorkerHandler = await import(
  "../../src/core/runtime-workspace-mutation/service-worker-handler.js"
).catch(() => null);

const assignedJournalContract = await import(
  "../../src/core/journal-append-coordination/contract.js"
).catch(() => null);

const assignedJournalCoordinator = await import(
  "../../src/core/journal-append-coordination/coordinator.js"
).catch(() => null);

const assignedJournalClient = await import(
  "../../src/core/journal-append-coordination/client.js"
).catch(() => null);

const assignedJournalChromeAdapter = await import(
  "../../src/core/journal-append-coordination/chrome-adapter.js"
).catch(() => null);

const assignedJournalReadonlyWorkspace = await import(
  "../../src/core/journal-append-coordination/readonly-workspace.js"
).catch(() => null);

test("D3D-05 runtime workspace mutation contract module exists with the versioned public surface", () => {
  assert.ok(
    mutationContract,
    "D3D-05 runtime-workspace-mutation/contract.js must exist"
  );

  assert.equal(
    mutationContract.RUNTIME_WORKSPACE_MUTATION_TYPE,
    "constellation-runtime-workspace-mutation"
  );

  assert.equal(
    mutationContract.RUNTIME_WORKSPACE_MUTATION_COMMAND_SCHEMA,
    "constellation-runtime-workspace-mutation-command-v0.1"
  );

  assert.equal(
    mutationContract.RUNTIME_WORKSPACE_MUTATION_RESULT_SCHEMA,
    "constellation-runtime-workspace-mutation-result-v0.1"
  );

  assert.equal(
    typeof mutationContract.snapshotAndValidateRuntimeWorkspaceMutationCommand,
    "function"
  );

  assert.equal(
    typeof mutationContract.createRuntimeWorkspaceMutationResult,
    "function"
  );

  assert.equal(
    typeof mutationContract.validateRuntimeWorkspaceMutationResult,
    "function"
  );

  assert.equal(
    typeof mutationContract.runtimeWorkspaceMutationFingerprint,
    "function"
  );

  assert.equal(
    typeof mutationContract.isRuntimeWorkspaceMutationMessage,
    "function"
  );
});

test("D3D-05 extends the workspace operation ledger registry additively with ordinary_mutation", () => {
  assert.equal(
    WORKSPACE_OPERATION_COMMAND_SCHEMAS.ordinary_mutation,
    "constellation-runtime-workspace-mutation-command-v0.1"
  );

  assert.deepEqual(
    WORKSPACE_OPERATION_COMMAND_SCHEMAS,
    {
      create_and_bind:
        "constellation-runtime-workspace-create-bind-command-v0.1",
      resume_and_bind:
        "constellation-runtime-workspace-resume-bind-command-v0.1",
      transfer:
        "constellation-runtime-workspace-transfer-command-v0.1",
      release:
        "constellation-runtime-workspace-release-command-v0.1",
      archive_and_release:
        "constellation-runtime-workspace-archive-release-command-v0.1",
      replacement:
        "constellation-runtime-workspace-replace-command-v0.1",
      trusted_window_close:
        "constellation-runtime-window-close-lifecycle-command-v0.1",
      ordinary_mutation:
        "constellation-runtime-workspace-mutation-command-v0.1"
    }
  );
});

const NOW = "2026-08-08T15:45:00.000Z";

function mutationCommandFixture(overrides = {}) {
  return {
    type: "constellation-runtime-workspace-mutation",
    schema: "constellation-runtime-workspace-mutation-command-v0.1",
    operationId: "operation-1",
    runtimeSessionId: "runtime-session-1",
    sourceContextId: "context-10",
    sourceWindowId: 10,
    workspaceId: "workspace-alpha",
    expectedWorkspaceRevision: 7,
    runtimeAssignmentId: "assignment-alpha",
    assignmentEpoch: 1,
    mutationKind: "journal.append",
    payload: {
      record: {
        entryId: "journal-1",
        text: "hello",
        tag: "",
        relatedRoleId: "",
        relatedRoleLabel: "",
        createdAt: NOW
      }
    },
    requestedAt: NOW,
    ...overrides
  };
}

test("D3D-05 mutation-kind registry is closed to the six approved ordinary mutations", () => {
  assert.deepEqual(
    mutationContract.RUNTIME_WORKSPACE_MUTATION_KINDS,
    [
      "journal.append",
      "timeline.append",
      "workspace.metadata.autosave",
      "workspace.metadata.commit",
      "workspace.tab.metadata.commit",
      "search.intake.add"
    ]
  );
});

test("D3D-05 accepts one complete exact assigned-workspace mutation command", () => {
  const command = mutationCommandFixture();
  const validation =
    mutationContract.snapshotAndValidateRuntimeWorkspaceMutationCommand(command);

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.errors, []);
  assert.deepEqual(validation.command, command);
});

test("D3D-05 rejects every missing assigned-authority identity", () => {
  const required = [
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
  ];

  for (const field of required) {
    const command = mutationCommandFixture();
    delete command[field];

    const validation =
      mutationContract.snapshotAndValidateRuntimeWorkspaceMutationCommand(command);

    assert.equal(validation.valid, false, field);
    assert.equal(validation.command, null, field);
    assert.ok(validation.errors.length > 0, field);
  }
});

test("D3D-05 rejects invalid revision epoch window and timestamp evidence", () => {
  const cases = [
    { sourceWindowId: -1 },
    { sourceWindowId: 1.5 },
    { expectedWorkspaceRevision: -1 },
    { expectedWorkspaceRevision: 1.5 },
    { assignmentEpoch: 0 },
    { assignmentEpoch: -1 },
    { assignmentEpoch: 1.5 },
    { requestedAt: "not-a-date" }
  ];

  for (const overrides of cases) {
    const validation =
      mutationContract.snapshotAndValidateRuntimeWorkspaceMutationCommand(
        mutationCommandFixture(overrides)
      );

    assert.equal(validation.valid, false, JSON.stringify(overrides));
    assert.equal(validation.command, null, JSON.stringify(overrides));
  }
});

test("D3D-05 rejects unknown command fields and unknown mutation kinds", () => {
  const unknownField =
    mutationContract.snapshotAndValidateRuntimeWorkspaceMutationCommand({
      ...mutationCommandFixture(),
      compatibilityWorkspace: {}
    });

  assert.equal(unknownField.valid, false);
  assert.equal(unknownField.command, null);

  const unknownKind =
    mutationContract.snapshotAndValidateRuntimeWorkspaceMutationCommand(
      mutationCommandFixture({
        mutationKind: "workspace.replace"
      })
    );

  assert.equal(unknownKind.valid, false);
  assert.equal(unknownKind.command, null);
});

test("D3D-05 rejects a cyclic payload fail closed", () => {
  const detail = {};
  detail.self = detail;

  const validation =
    mutationContract.snapshotAndValidateRuntimeWorkspaceMutationCommand(
      mutationCommandFixture({
        mutationKind: "timeline.append",
        payload: {
          record: {
            eventId: "event-cycle-1",
            type: "workspace_saved",
            message: "Cyclic payload must fail.",
            createdAt: NOW,
            detail
          }
        }
      })
    );

  assert.equal(validation.valid, false);
  assert.equal(validation.command, null);
  assert.ok(validation.errors.length > 0);
});

test("D3D-05 journal.append payload is exact and identity-complete", () => {
  const valid = mutationCommandFixture({
    mutationKind: "journal.append",
    payload: {
      record: {
        entryId: "journal-2",
        text: "note",
        tag: "",
        relatedRoleId: "",
        relatedRoleLabel: "",
        createdAt: NOW
      }
    }
  });

  assert.equal(
    mutationContract.snapshotAndValidateRuntimeWorkspaceMutationCommand(valid).valid,
    true
  );

  const cases = [
    { payload: {} },
    {
      payload: {
        record: {
          entryId: "",
          text: "note",
          tag: "",
          relatedRoleId: "",
          relatedRoleLabel: "",
          createdAt: NOW
        }
      }
    },
    {
      payload: {
        record: {
          entryId: "journal-2",
          text: "",
          tag: "",
          relatedRoleId: "",
          relatedRoleLabel: "",
          createdAt: NOW
        }
      }
    },
    {
      payload: {
        record: {
          entryId: "journal-2",
          text: "note",
          tag: "",
          relatedRoleId: "",
          relatedRoleLabel: "",
          createdAt: "bad-date"
        }
      }
    },
    {
      payload: {
        record: {
          entryId: "journal-2",
          text: "note",
          tag: "",
          relatedRoleId: "",
          relatedRoleLabel: "",
          createdAt: NOW,
          extra: true
        }
      }
    },
    {
      payload: {
        record: {
          entryId: "journal-2",
          text: "note",
          tag: 1,
          relatedRoleId: "",
          relatedRoleLabel: "",
          createdAt: NOW
        }
      }
    }
  ];

  for (const overrides of cases) {
    const result =
      mutationContract.snapshotAndValidateRuntimeWorkspaceMutationCommand(
        mutationCommandFixture({
          mutationKind: "journal.append",
          ...overrides
        })
      );

    assert.equal(result.valid, false, JSON.stringify(overrides));
  }
});

test("D3D-05 timeline.append requires event identity but preserves serializable event detail", () => {
  const valid = mutationCommandFixture({
    mutationKind: "timeline.append",
    payload: {
      record: {
        eventId: "event-1",
        type: "workspace_saved",
        message: "Workspace saved.",
        createdAt: NOW,
        detail: {
          reason: "explicit_save"
        }
      }
    }
  });

  assert.equal(
    mutationContract.snapshotAndValidateRuntimeWorkspaceMutationCommand(valid).valid,
    true
  );

  const invalidRecords = [
    {},
    {
      eventId: "",
      type: "workspace_saved",
      message: "Workspace saved.",
      createdAt: NOW
    },
    {
      eventId: "event-1",
      type: "",
      message: "Workspace saved.",
      createdAt: NOW
    },
    {
      eventId: "event-1",
      type: "workspace_saved",
      message: "",
      createdAt: NOW
    },
    {
      eventId: "event-1",
      type: "workspace_saved",
      message: "Workspace saved.",
      createdAt: "bad-date"
    }
  ];

  for (const record of invalidRecords) {
    const result =
      mutationContract.snapshotAndValidateRuntimeWorkspaceMutationCommand(
        mutationCommandFixture({
          mutationKind: "timeline.append",
          payload: { record }
        })
      );

    assert.equal(result.valid, false, JSON.stringify(record));
  }

  const unknownPayloadField =
    mutationContract.snapshotAndValidateRuntimeWorkspaceMutationCommand(
      mutationCommandFixture({
        mutationKind: "timeline.append",
        payload: {
          record: {
            eventId: "event-1",
            type: "workspace_saved",
            message: "Workspace saved.",
            createdAt: NOW
          },
          extra: true
        }
      })
    );

  assert.equal(unknownPayloadField.valid, false);
});

test("D3D-05 workspace.metadata.autosave accepts only name and aim strings", () => {
  const valid = mutationCommandFixture({
    mutationKind: "workspace.metadata.autosave",
    payload: {
      name: "Alpha",
      aim: "Investigate multi-window behavior"
    }
  });

  assert.equal(
    mutationContract.snapshotAndValidateRuntimeWorkspaceMutationCommand(valid).valid,
    true
  );

  for (const payload of [
    { name: "Alpha" },
    { aim: "Aim" },
    { name: 1, aim: "Aim" },
    { name: "Alpha", aim: false },
    { name: "Alpha", aim: "Aim", workspaceType: "research" }
  ]) {
    const result =
      mutationContract.snapshotAndValidateRuntimeWorkspaceMutationCommand(
        mutationCommandFixture({
          mutationKind: "workspace.metadata.autosave",
          payload
        })
      );

    assert.equal(result.valid, false, JSON.stringify(payload));
  }
});

test("D3D-05 workspace.metadata.commit has one exact semantic payload", () => {
  for (const mode of ["save", "type_change"]) {
    const valid = mutationCommandFixture({
      mutationKind: "workspace.metadata.commit",
      payload: {
        mode,
        name: "Alpha",
        aim: "Aim",
        workspaceType: "research",
        eventId: "event-metadata-1"
      }
    });

    assert.equal(
      mutationContract.snapshotAndValidateRuntimeWorkspaceMutationCommand(valid).valid,
      true,
      mode
    );
  }

  for (const payload of [
    {
      mode: "replace",
      name: "Alpha",
      aim: "Aim",
      workspaceType: "research",
      eventId: "event-1"
    },
    {
      mode: "save",
      name: "Alpha",
      aim: "Aim",
      workspaceType: "",
      eventId: "event-1"
    },
    {
      mode: "save",
      name: "Alpha",
      aim: "Aim",
      workspaceType: "research",
      eventId: ""
    },
    {
      mode: "save",
      name: "Alpha",
      aim: "Aim",
      workspaceType: "research",
      eventId: "event-1",
      extra: true
    }
  ]) {
    const result =
      mutationContract.snapshotAndValidateRuntimeWorkspaceMutationCommand(
        mutationCommandFixture({
          mutationKind: "workspace.metadata.commit",
          payload
        })
      );

    assert.equal(result.valid, false, JSON.stringify(payload));
  }
});

test("D3D-05 workspace.tab.metadata.commit accepts only alias or role semantic updates", () => {
  for (const field of ["alias", "role"]) {
    const valid = mutationCommandFixture({
      mutationKind: "workspace.tab.metadata.commit",
      payload: {
        workspaceTabId: "workspace-tab-1",
        field,
        value: "Reference",
        eventId: "event-tab-1"
      }
    });

    assert.equal(
      mutationContract.snapshotAndValidateRuntimeWorkspaceMutationCommand(valid).valid,
      true,
      field
    );
  }

  for (const payload of [
    {
      workspaceTabId: "",
      field: "alias",
      value: "Reference",
      eventId: "event-1"
    },
    {
      workspaceTabId: "workspace-tab-1",
      field: "projection",
      value: "Reference",
      eventId: "event-1"
    },
    {
      workspaceTabId: "workspace-tab-1",
      field: "alias",
      value: 1,
      eventId: "event-1"
    },
    {
      workspaceTabId: "workspace-tab-1",
      field: "alias",
      value: "Reference",
      eventId: ""
    },
    {
      workspaceTabId: "workspace-tab-1",
      field: "alias",
      value: "Reference",
      eventId: "event-1",
      extra: true
    }
  ]) {
    const result =
      mutationContract.snapshotAndValidateRuntimeWorkspaceMutationCommand(
        mutationCommandFixture({
          mutationKind: "workspace.tab.metadata.commit",
          payload
        })
      );

    assert.equal(result.valid, false, JSON.stringify(payload));
  }
});

test("D3D-05 search.intake.add requires exact operation fields and valid browser tab identity", () => {
  const valid = mutationCommandFixture({
    mutationKind: "search.intake.add",
    payload: {
      tab: {
        workspaceTabId: "workspace-tab-search-1",
        tabId: 41,
        windowId: 10,
        url: "https://example.com/",
        originalTitle: "Example"
      },
      query: "multi window browser workspace",
      eventId: "event-search-1",
      sameUrlDuplicate: false
    }
  });

  assert.equal(
    mutationContract.snapshotAndValidateRuntimeWorkspaceMutationCommand(valid).valid,
    true
  );

  for (const payload of [
    {
      tab: {
        workspaceTabId: "",
        tabId: 41,
        windowId: 10
      },
      query: "query",
      eventId: "event-1",
      sameUrlDuplicate: false
    },
    {
      tab: {
        workspaceTabId: "workspace-tab-1",
        tabId: -1,
        windowId: 10
      },
      query: "query",
      eventId: "event-1",
      sameUrlDuplicate: false
    },
    {
      tab: {
        workspaceTabId: "workspace-tab-1",
        tabId: 41,
        windowId: -1
      },
      query: "query",
      eventId: "event-1",
      sameUrlDuplicate: false
    },
    {
      tab: {
        workspaceTabId: "workspace-tab-1",
        tabId: 41,
        windowId: 10
      },
      query: 1,
      eventId: "event-1",
      sameUrlDuplicate: false
    },
    {
      tab: {
        workspaceTabId: "workspace-tab-1",
        tabId: 41,
        windowId: 10
      },
      query: "query",
      eventId: "",
      sameUrlDuplicate: false
    },
    {
      tab: {
        workspaceTabId: "workspace-tab-1",
        tabId: 41,
        windowId: 10
      },
      query: "query",
      eventId: "event-1",
      sameUrlDuplicate: "false"
    },
    {
      tab: {
        workspaceTabId: "workspace-tab-1",
        tabId: 41,
        windowId: 10
      },
      query: "query",
      eventId: "event-1",
      sameUrlDuplicate: false,
      extra: true
    }
  ]) {
    const result =
      mutationContract.snapshotAndValidateRuntimeWorkspaceMutationCommand(
        mutationCommandFixture({
          mutationKind: "search.intake.add",
          payload
        })
      );

    assert.equal(result.valid, false, JSON.stringify(payload));
  }
});

function mutationResultExpectation(command) {
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

test("D3D-05 fingerprint excludes only retry time evidence", () => {
  const original = mutationCommandFixture();

  const laterRetry = mutationCommandFixture({
    requestedAt: "2026-08-08T16:45:00.000Z"
  });

  const changedPayload = mutationCommandFixture({
    payload: {
      record: {
        entryId: "journal-1",
        text: "different semantic payload",
        tag: "",
        relatedRoleId: "",
        relatedRoleLabel: "",
        createdAt: NOW
      }
    }
  });

  const changedEpoch = mutationCommandFixture({
    assignmentEpoch: 2
  });

  const originalFingerprint =
    mutationContract.runtimeWorkspaceMutationFingerprint(original);

  assert.equal(
    originalFingerprint,
    mutationContract.runtimeWorkspaceMutationFingerprint(laterRetry)
  );

  assert.notEqual(
    originalFingerprint,
    mutationContract.runtimeWorkspaceMutationFingerprint(changedPayload)
  );

  assert.notEqual(
    originalFingerprint,
    mutationContract.runtimeWorkspaceMutationFingerprint(changedEpoch)
  );
});

test("D3D-05 mutation message classifier recognizes only the additive route identity", () => {
  assert.equal(
    mutationContract.isRuntimeWorkspaceMutationMessage({
      type: "constellation-runtime-workspace-mutation"
    }),
    true
  );

  assert.equal(
    mutationContract.isRuntimeWorkspaceMutationMessage({
      schema: "constellation-runtime-workspace-mutation-command-v0.1"
    }),
    true
  );

  assert.equal(
    mutationContract.isRuntimeWorkspaceMutationMessage({
      type: "other-message",
      schema: "other-schema"
    }),
    false
  );

  assert.equal(
    mutationContract.isRuntimeWorkspaceMutationMessage(null),
    false
  );
});

test("D3D-05 result creation preserves exact command authority and total evidence fields", () => {
  const command = mutationCommandFixture();

  const result =
    mutationContract.createRuntimeWorkspaceMutationResult(command, {
      status: "committed",
      reason: "",
      previousRevision: 7,
      committedRevision: 8,
      recordFingerprint: "record-fingerprint-8",
      phase: "complete",
      mutationCommitted: true,
      authorityVerified: true,
      workspaceVerified: true,
      ledgerRecorded: true,
      retrySafe: true,
      indeterminate: false,
      warnings: [],
      errors: []
    });

  assert.deepEqual(
    result,
    {
      schema: "constellation-runtime-workspace-mutation-result-v0.1",
      status: "committed",
      reason: "",
      operationId: "operation-1",
      runtimeSessionId: "runtime-session-1",
      sourceContextId: "context-10",
      sourceWindowId: 10,
      workspaceId: "workspace-alpha",
      runtimeAssignmentId: "assignment-alpha",
      assignmentEpoch: 1,
      previousRevision: 7,
      committedRevision: 8,
      recordFingerprint: "record-fingerprint-8",
      phase: "complete",
      mutationCommitted: true,
      authorityVerified: true,
      workspaceVerified: true,
      ledgerRecorded: true,
      retrySafe: true,
      indeterminate: false,
      warnings: [],
      errors: []
    }
  );

  const validation =
    mutationContract.validateRuntimeWorkspaceMutationResult(
      result,
      mutationResultExpectation(command)
    );

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.errors, []);
  assert.deepEqual(validation.result, result);
});

test("D3D-05 result validation fails closed on malformed evidence or authority drift", () => {
  const command = mutationCommandFixture();

  const result =
    mutationContract.createRuntimeWorkspaceMutationResult(command, {
      status: "committed",
      reason: "",
      previousRevision: 7,
      committedRevision: 8,
      recordFingerprint: "record-fingerprint-8",
      phase: "complete",
      mutationCommitted: true,
      authorityVerified: true,
      workspaceVerified: true,
      ledgerRecorded: true,
      retrySafe: true,
      indeterminate: false,
      warnings: [],
      errors: []
    });

  const expected = mutationResultExpectation(command);

  const cases = [
    {
      ...structuredClone(result),
      unexpected: true
    },
    {
      ...structuredClone(result),
      operationId: "different-operation"
    },
    {
      ...structuredClone(result),
      runtimeAssignmentId: "different-assignment"
    },
    {
      ...structuredClone(result),
      assignmentEpoch: 0
    },
    {
      ...structuredClone(result),
      previousRevision: -2
    },
    {
      ...structuredClone(result),
      committedRevision: 1.5
    },
    {
      ...structuredClone(result),
      mutationCommitted: "true"
    },
    {
      ...structuredClone(result),
      authorityVerified: 1
    },
    {
      ...structuredClone(result),
      indeterminate: null
    },
    {
      ...structuredClone(result),
      warnings: "warning"
    },
    {
      ...structuredClone(result),
      errors: [1]
    }
  ];

  for (const value of cases) {
    const validation =
      mutationContract.validateRuntimeWorkspaceMutationResult(
        value,
        expected
      );

    assert.equal(
      validation.valid,
      false,
      JSON.stringify(value)
    );

    assert.equal(
      validation.result,
      null,
      JSON.stringify(value)
    );
  }
});

const LATER = "2026-08-08T15:46:00.000Z";
const SIDE_PANEL_URL = "chrome-extension://constellation/sidepanel.html";

function coordinateMutation(command, adapters) {
  assert.ok(
    mutationCoordinator,
    "D3D-05 runtime-workspace-mutation/coordinator.js must exist"
  );
  assert.equal(
    typeof mutationCoordinator.coordinateRuntimeWorkspaceMutation,
    "function",
    "D3D-05 coordinator must export coordinateRuntimeWorkspaceMutation"
  );
  return mutationCoordinator.coordinateRuntimeWorkspaceMutation(command, adapters);
}

function createMutationChromeAdapters(chromeApi, options = {}) {
  assert.ok(
    mutationChromeAdapter,
    "D3D-05 runtime-workspace-mutation/chrome-adapter.js must exist"
  );
  assert.equal(
    typeof mutationChromeAdapter.createRuntimeWorkspaceMutationChromeAdapters,
    "function",
    "D3D-05 chrome adapter must export createRuntimeWorkspaceMutationChromeAdapters"
  );
  return mutationChromeAdapter.createRuntimeWorkspaceMutationChromeAdapters(
    chromeApi,
    options
  );
}

function assertCoordinatorResult(result, command) {
  const validation = mutationContract.validateRuntimeWorkspaceMutationResult(
    result,
    mutationResultExpectation(command)
  );

  assert.equal(validation.valid, true, validation.errors.join("; "));
}

function runtimeMutationWorkspaceFixture(overrides = {}) {
  return structuredClone({
    workspaceId: "workspace-alpha",
    workspaceRevision: 7,
    name: "Alpha",
    aim: "Initial aim",
    workspaceType: "research",
    updatedAt: NOW,
    tabs: [
      {
        workspaceTabId: "workspace-tab-1",
        tabId: 41,
        windowId: 10,
        groupId: -1,
        tabKey: "tab-key-41",
        url: "https://example.test/source",
        displayUrl: "example.test/source",
        originalTitle: "Source tab",
        alias: "",
        role: "source",
        isOpen: true,
        firstSeenAt: NOW,
        lastSeenAt: NOW
      }
    ],
    journal: [],
    timeline: [],
    unknownWorkspaceField: { preserved: true },
    ...overrides
  });
}

function runtimeMutationRecordFixture(overrides = {}) {
  const providedWorkspace = overrides.workspace
    ? structuredClone(overrides.workspace)
    : runtimeMutationWorkspaceFixture();
  const workspaceId = overrides.workspaceId || providedWorkspace.workspaceId;
  const workspaceRevision =
    overrides.workspaceRevision ?? providedWorkspace.workspaceRevision;
  const workspace = {
    ...providedWorkspace,
    workspaceId,
    workspaceRevision
  };
  const {
    workspace: ignoredWorkspace,
    workspaceId: ignoredWorkspaceId,
    workspaceRevision: ignoredWorkspaceRevision,
    ...recordOverrides
  } = overrides;

  return structuredClone({
    schema: RUNTIME_WORKSPACE_SCHEMA,
    workspaceId,
    workspaceRevision,
    workspace,
    lifecycleState: "available",
    provenance: {
      kind: "explicit_create",
      operationId: "runtime-record-create-1",
      compatibilitySource: "none"
    },
    lastVerifiedAt: NOW,
    ...recordOverrides
  });
}

function runtimeMutationAuthorityFixture(options = {}) {
  const assignments = options.assignments || [
    {
      workspaceId: "workspace-alpha",
      windowId: 10,
      runtimeAssignmentId: "assignment-alpha",
      sourceContextId: "context-10"
    }
  ];
  const contexts = options.contexts || assignments.map((assignment) => ({
    contextId: assignment.sourceContextId || "context-" + assignment.windowId,
    windowId: assignment.windowId
  }));
  let authority = createSessionAuthority(
    options.runtimeSessionId || "runtime-session-1"
  );

  for (const context of contexts) {
    const registered = registerContext(
      authority,
      {
        contextId: context.contextId,
        windowId: context.windowId,
        createdAt: NOW,
        sourceUrl: SIDE_PANEL_URL
      },
      { genesis: true }
    );
    assert.ok(registered.root, "authority fixture context must register");
    authority = registered.root;
  }

  for (const assignment of assignments) {
    const assigned = assignRuntime(authority.assignmentRegistry, {
      workspaceId: assignment.workspaceId,
      windowId: assignment.windowId,
      sourceContextId: assignment.sourceContextId,
      id: () => assignment.runtimeAssignmentId,
      now: NOW
    });
    assert.equal(assigned.status, "assigned", "authority fixture assignment");
    authority = {
      ...authority,
      assignmentRegistry: assigned.registry,
      authorityRevision: authority.authorityRevision + 1
    };
  }

  return authority;
}

function occurrenceMatches(value, occurrence) {
  return Array.isArray(value) ? value.includes(occurrence) : value === occurrence;
}

function mutationAdaptersFixture(options = {}) {
  let authority = structuredClone(
    options.authority || runtimeMutationAuthorityFixture()
  );
  let record = options.record === undefined
    ? runtimeMutationRecordFixture()
    : structuredClone(options.record);
  let ledger = options.ledgerAbsent === true
    ? undefined
    : structuredClone(
      options.ledger || createWorkspaceOperationLedger("workspace-alpha")
    );
  let authorityReads = 0;
  let recordReads = 0;
  let recordWrites = 0;
  let ledgerReads = 0;
  let ledgerWrites = 0;
  let nowReads = 0;
  const lockPlans = [];
  const events = [];
  const faults = { ...(options.faults || {}) };

  const adapters = {
    async withScopedLocks(plan, callback) {
      lockPlans.push([...plan]);
      events.push("lock:" + plan.join(","));
      if (occurrenceMatches(faults.lockFailureAt, lockPlans.length)) {
        throw new Error("scoped lock unavailable");
      }
      return callback();
    },
    async readAuthority() {
      authorityReads += 1;
      events.push("read-authority:" + authorityReads);
      if (occurrenceMatches(faults.authorityReadFailureAt, authorityReads)) {
        throw new Error("authority read failed");
      }
      return structuredClone(authority);
    },
    async readRuntimeWorkspaceRecord() {
      recordReads += 1;
      events.push("read-record:" + recordReads);
      if (occurrenceMatches(faults.recordReadFailureAt, recordReads)) {
        throw new Error("runtime record read failed");
      }
      const value = record === undefined ? undefined : structuredClone(record);
      const transform = faults.recordReadTransformAt?.[recordReads];
      return typeof transform === "function" ? transform(value) : value;
    },
    async writeRuntimeWorkspaceRecord(workspaceId, value) {
      recordWrites += 1;
      events.push("write-record:" + recordWrites + ":" + workspaceId);
      if (occurrenceMatches(faults.recordWriteFailureAt, recordWrites)) {
        throw new Error("runtime record write failed");
      }
      record = structuredClone(value);
      if (typeof faults.mutateRecordAfterWrite === "function") {
        record = faults.mutateRecordAfterWrite(structuredClone(record));
      }
    },
    async readWorkspaceOperationLedger() {
      ledgerReads += 1;
      events.push("read-ledger:" + ledgerReads);
      if (occurrenceMatches(faults.ledgerReadFailureAt, ledgerReads)) {
        throw new Error("workspace ledger read failed");
      }
      return ledger === undefined ? undefined : structuredClone(ledger);
    },
    async writeWorkspaceOperationLedger(workspaceId, value) {
      ledgerWrites += 1;
      events.push("write-ledger:" + ledgerWrites + ":" + workspaceId);
      if (occurrenceMatches(faults.ledgerWriteFailureAt, ledgerWrites)) {
        throw new Error("workspace ledger write failed");
      }
      ledger = structuredClone(value);
    },
    now() {
      nowReads += 1;
      events.push("now:" + nowReads);
      if (occurrenceMatches(faults.nowFailureAt, nowReads)) {
        throw new Error("clock unavailable");
      }
      return faults.now || LATER;
    }
  };

  return {
    adapters,
    events,
    faults,
    lockPlans,
    get authority() {
      return structuredClone(authority);
    },
    set authority(value) {
      authority = structuredClone(value);
    },
    get record() {
      return record === undefined ? undefined : structuredClone(record);
    },
    set record(value) {
      record = value === undefined ? undefined : structuredClone(value);
    },
    get ledger() {
      return ledger === undefined ? undefined : structuredClone(ledger);
    },
    set ledger(value) {
      ledger = value === undefined ? undefined : structuredClone(value);
    },
    get authorityReads() {
      return authorityReads;
    },
    get recordReads() {
      return recordReads;
    },
    get recordWrites() {
      return recordWrites;
    },
    get ledgerReads() {
      return ledgerReads;
    },
    get ledgerWrites() {
      return ledgerWrites;
    },
    get nowReads() {
      return nowReads;
    }
  };
}

test("D3D-05 coordinator module exists with the pure public mutation entry point", () => {
  assert.ok(
    mutationCoordinator,
    "D3D-05 runtime-workspace-mutation/coordinator.js must exist"
  );
  assert.equal(
    typeof mutationCoordinator.coordinateRuntimeWorkspaceMutation,
    "function"
  );
});

test("D3D-05 ordinary mutation holds only exact window binding and content locks", async () => {
  const fake = mutationAdaptersFixture();
  const command = mutationCommandFixture({ operationId: "lock-plan-1" });

  const result = await coordinateMutation(command, fake.adapters);

  assert.equal(result.status, "committed");
  assert.deepEqual(fake.lockPlans, [[
    "constellation-runtime-window:10",
    "constellation-runtime-workspace-binding:workspace-alpha",
    "constellation-runtime-workspace:workspace-alpha"
  ]]);
  assert.equal(
    fake.lockPlans[0].includes("constellation-runtime-state-v0.1"),
    false
  );
  assert.equal(
    fake.lockPlans[0].some((name) => name.includes("compatibility")),
    false
  );
  assert.equal(fake.recordWrites, 1);
  assertCoordinatorResult(result, command);
});

test("D3D-05 rejects stale authority and record preconditions without runtime-record writes", async () => {
  const reassignedAuthority = runtimeMutationAuthorityFixture({
    assignments: [
      {
        workspaceId: "workspace-beta",
        windowId: 10,
        runtimeAssignmentId: "assignment-beta",
        sourceContextId: "context-10"
      },
      {
        workspaceId: "workspace-alpha",
        windowId: 20,
        runtimeAssignmentId: "assignment-alpha",
        sourceContextId: "context-20"
      }
    ]
  });
  const cases = [
    {
      name: "stale runtime session",
      authority: runtimeMutationAuthorityFixture({
        runtimeSessionId: "runtime-session-2"
      })
    },
    {
      name: "stale current context",
      authority: runtimeMutationAuthorityFixture({
        contexts: [{ contextId: "context-new-10", windowId: 10 }]
      })
    },
    {
      name: "source-window assignment mismatch",
      authority: runtimeMutationAuthorityFixture({
        assignments: [
          {
            workspaceId: "workspace-beta",
            windowId: 10,
            runtimeAssignmentId: "assignment-beta",
            sourceContextId: "context-10"
          }
        ]
      })
    },
    {
      name: "workspace assignment mismatch",
      authority: reassignedAuthority
    },
    {
      name: "assignment identity drift",
      command: mutationCommandFixture({
        operationId: "assignment-id-drift-1",
        runtimeAssignmentId: "assignment-stale"
      })
    },
    {
      name: "assignment epoch drift",
      command: mutationCommandFixture({
        operationId: "assignment-epoch-drift-1",
        assignmentEpoch: 2
      })
    },
    {
      name: "scoped key/workspace mismatch",
      record: runtimeMutationRecordFixture({ workspaceId: "workspace-beta" })
    },
    {
      name: "malformed runtime record",
      record: { schema: "malformed" }
    },
    {
      name: "paused runtime record",
      record: runtimeMutationRecordFixture({ lifecycleState: "paused" })
    },
    {
      name: "expected revision conflict",
      record: runtimeMutationRecordFixture({ workspaceRevision: 8 })
    }
  ];

  for (const item of cases) {
    const command = item.command || mutationCommandFixture({
      operationId: "precondition-" + item.name.replaceAll(" ", "-")
    });
    const fake = mutationAdaptersFixture({
      authority: item.authority,
      record: item.record
    });

    const result = await coordinateMutation(command, fake.adapters);

    assert.notEqual(result.status, "committed", item.name);
    assert.notEqual(result.status, "replayed", item.name);
    assert.equal(fake.recordWrites, 0, item.name);
    assertCoordinatorResult(result, command);
  }
});

test("D3D-05 panel recreation accepts the current context without rewriting assignment provenance", async () => {
  const assignedAuthority = runtimeMutationAuthorityFixture();
  const recreated = registerContext(assignedAuthority, {
    contextId: "context-10-recreated",
    windowId: 10,
    createdAt: LATER,
    sourceUrl: SIDE_PANEL_URL
  });
  const command = mutationCommandFixture({
    operationId: "panel-recreation-1",
    sourceContextId: "context-10-recreated"
  });

  assert.equal(recreated.status, "replaced");
  assert.equal(recreated.root.contexts[0].contextId, "context-10-recreated");
  assert.equal(
    recreated.root.assignmentRegistry.assignments[0].sourceContextId,
    "context-10"
  );

  const fake = mutationAdaptersFixture({ authority: recreated.root });
  const result = await coordinateMutation(command, fake.adapters);

  assert.equal(result.status, "committed");
  assert.equal(result.runtimeAssignmentId, "assignment-alpha");
  assert.equal(result.assignmentEpoch, 1);
  assert.equal(fake.recordWrites, 1);
  assert.equal(
    fake.authority.assignmentRegistry.assignments[0].sourceContextId,
    "context-10"
  );
  assertCoordinatorResult(result, command);
});

test("D3D-05 journal append preserves immutable entry identity and increments revision once", async () => {
  const fake = mutationAdaptersFixture();
  const command = mutationCommandFixture({ operationId: "journal-append-1" });

  const committed = await coordinateMutation(command, fake.adapters);

  assert.equal(committed.status, "committed");
  assert.equal(fake.record.workspaceRevision, 8);
  assert.equal(fake.record.workspace.workspaceRevision, 8);
  assert.deepEqual(fake.record.workspace.journal, [command.payload.record]);
  assert.equal(fake.record.workspace.timeline.length, 0);
  assert.equal(fake.record.workspace.unknownWorkspaceField.preserved, true);
  assertCoordinatorResult(committed, command);

  const duplicate = mutationCommandFixture({
    operationId: "journal-append-same-entry-2",
    expectedWorkspaceRevision: 8
  });
  const noChange = await coordinateMutation(duplicate, fake.adapters);

  assert.equal(noChange.status, "no_change");
  assert.equal(fake.recordWrites, 1);
  assert.equal(fake.record.workspace.workspaceRevision, 8);
  assert.equal(fake.record.workspace.journal.length, 1);
  assertCoordinatorResult(noChange, duplicate);
});

test("D3D-05 timeline append commits once and exact retry replays without duplicate evidence", async () => {
  const fake = mutationAdaptersFixture();
  const command = mutationCommandFixture({
    operationId: "timeline-append-1",
    mutationKind: "timeline.append",
    payload: {
      record: {
        eventId: "timeline-event-1",
        type: "workspace_saved",
        message: "Timeline evidence.",
        createdAt: NOW,
        detail: { source: "test" }
      }
    }
  });

  const committed = await coordinateMutation(command, fake.adapters);
  const replay = await coordinateMutation(
    {
      ...command,
      requestedAt: LATER
    },
    fake.adapters
  );

  assert.equal(committed.status, "committed");
  assert.equal(replay.status, "replayed");
  assert.equal(fake.recordWrites, 1);
  assert.equal(fake.record.workspace.workspaceRevision, 8);
  assert.equal(fake.record.workspace.timeline.length, 1);
  assert.deepEqual(fake.record.workspace.timeline[0], command.payload.record);
  assertCoordinatorResult(committed, command);
  assertCoordinatorResult(replay, { ...command, requestedAt: LATER });
});

test("D3D-05 metadata autosave updates only name aim and timestamp without timeline evidence", async () => {
  const fake = mutationAdaptersFixture();
  const command = mutationCommandFixture({
    operationId: "metadata-autosave-1",
    mutationKind: "workspace.metadata.autosave",
    payload: {
      name: "Autosaved Alpha",
      aim: "Autosaved aim"
    }
  });

  const result = await coordinateMutation(command, fake.adapters);

  assert.equal(result.status, "committed");
  assert.equal(fake.record.workspace.workspaceRevision, 8);
  assert.equal(fake.record.workspace.name, "Autosaved Alpha");
  assert.equal(fake.record.workspace.aim, "Autosaved aim");
  assert.equal(fake.record.workspace.updatedAt, NOW);
  assert.equal(fake.record.workspace.workspaceType, "research");
  assert.deepEqual(fake.record.workspace.timeline, []);
  assertCoordinatorResult(result, command);
});

test("D3D-05 metadata save remains semantic when text is unchanged and normalizes roles on type change", async () => {
  const sameMetadata = mutationAdaptersFixture();
  const sameCommand = mutationCommandFixture({
    operationId: "metadata-save-same-1",
    mutationKind: "workspace.metadata.commit",
    payload: {
      mode: "save",
      name: "Alpha",
      aim: "Initial aim",
      workspaceType: "research",
      eventId: "workspace-saved-same-1"
    }
  });

  const sameResult = await coordinateMutation(sameCommand, sameMetadata.adapters);

  assert.equal(sameResult.status, "committed");
  assert.equal(sameMetadata.record.workspace.workspaceRevision, 8);
  assert.equal(
    sameMetadata.record.workspace.timeline.filter(
      (event) => event.type === "workspace_saved"
    ).length,
    1
  );

  const changedType = mutationAdaptersFixture();
  const typeCommand = mutationCommandFixture({
    operationId: "metadata-save-type-1",
    mutationKind: "workspace.metadata.commit",
    payload: {
      mode: "save",
      name: "Design Alpha",
      aim: "Design aim",
      workspaceType: "design",
      eventId: "workspace-saved-type-1"
    }
  });

  const typeResult = await coordinateMutation(typeCommand, changedType.adapters);
  const event = changedType.record.workspace.timeline.find(
    (item) => item.eventId === "workspace-saved-type-1"
  );

  assert.equal(typeResult.status, "committed");
  assert.equal(changedType.record.workspace.workspaceRevision, 8);
  assert.equal(changedType.record.workspace.workspaceType, "design");
  assert.equal(changedType.record.workspace.tabs[0].role, "unassigned");
  assert.deepEqual(event, {
    eventId: "workspace-saved-type-1",
    type: "workspace_saved",
    message: "Workspace saved.",
    createdAt: NOW
  });
  assertCoordinatorResult(sameResult, sameCommand);
  assertCoordinatorResult(typeResult, typeCommand);
});

test("D3D-05 metadata type change returns no_change only for unchanged metadata and emits type evidence only on type changes", async () => {
  const unchanged = mutationAdaptersFixture();
  const noChangeCommand = mutationCommandFixture({
    operationId: "metadata-type-unchanged-1",
    mutationKind: "workspace.metadata.commit",
    payload: {
      mode: "type_change",
      name: "Alpha",
      aim: "Initial aim",
      workspaceType: "research",
      eventId: "workspace-type-unchanged-1"
    }
  });

  const noChange = await coordinateMutation(noChangeCommand, unchanged.adapters);

  assert.equal(noChange.status, "no_change");
  assert.equal(unchanged.recordWrites, 0);
  assert.equal(unchanged.record.workspace.workspaceRevision, 7);
  assert.equal(unchanged.record.workspace.timeline.length, 0);
  assert.equal(unchanged.ledger.entries[0].state, "terminal");
  assert.deepEqual(unchanged.ledger.entries[0].createdArtifacts, []);

  const metadataOnly = mutationAdaptersFixture();
  const metadataOnlyCommand = mutationCommandFixture({
    operationId: "metadata-type-metadata-only-1",
    mutationKind: "workspace.metadata.commit",
    payload: {
      mode: "type_change",
      name: "Renamed Alpha",
      aim: "Updated aim",
      workspaceType: "research",
      eventId: "workspace-type-metadata-only-1"
    }
  });
  const metadataOnlyResult = await coordinateMutation(
    metadataOnlyCommand,
    metadataOnly.adapters
  );

  assert.equal(metadataOnlyResult.status, "committed");
  assert.equal(metadataOnly.record.workspace.workspaceRevision, 8);
  assert.equal(metadataOnly.record.workspace.timeline.length, 0);

  const changed = mutationAdaptersFixture();
  const changedCommand = mutationCommandFixture({
    operationId: "metadata-type-changed-1",
    mutationKind: "workspace.metadata.commit",
    payload: {
      mode: "type_change",
      name: "Design Alpha",
      aim: "Design aim",
      workspaceType: "design",
      eventId: "workspace-type-changed-1"
    }
  });
  const changedResult = await coordinateMutation(changedCommand, changed.adapters);
  const typeEvent = changed.record.workspace.timeline.find(
    (event) => event.eventId === "workspace-type-changed-1"
  );

  assert.equal(changedResult.status, "committed");
  assert.equal(changed.record.workspace.workspaceRevision, 8);
  assert.equal(changed.record.workspace.tabs[0].role, "unassigned");
  assert.equal(
    changed.record.workspace.timeline.filter(
      (event) => event.type === "workspace_type_updated"
    ).length,
    1
  );
  assert.deepEqual(typeEvent, {
    eventId: "workspace-type-changed-1",
    type: "workspace_type_updated",
    message: "Workspace type changed from Research Workspace to Design Workspace.",
    createdAt: NOW,
    previousType: "research",
    nextType: "design"
  });
  assertCoordinatorResult(noChange, noChangeCommand);
  assertCoordinatorResult(metadataOnlyResult, metadataOnlyCommand);
  assertCoordinatorResult(changedResult, changedCommand);
});

test("D3D-05 tab alias commit trims the value and emits one identity-complete event", async () => {
  const fake = mutationAdaptersFixture();
  const command = mutationCommandFixture({
    operationId: "tab-alias-1",
    mutationKind: "workspace.tab.metadata.commit",
    payload: {
      workspaceTabId: "workspace-tab-1",
      field: "alias",
      value: "  Read this first  ",
      eventId: "tab-alias-event-1"
    }
  });

  const result = await coordinateMutation(command, fake.adapters);
  const event = fake.record.workspace.timeline.find(
    (item) => item.eventId === "tab-alias-event-1"
  );

  assert.equal(result.status, "committed");
  assert.equal(fake.record.workspace.workspaceRevision, 8);
  assert.equal(fake.record.workspace.updatedAt, NOW);
  assert.equal(fake.record.workspace.tabs[0].alias, "Read this first");
  assert.equal(event.type, "tab_alias_updated");
  assert.equal(event.workspaceTabId, "workspace-tab-1");
  assert.equal(event.tabId, 41);
  assert.equal(event.alias, "Read this first");
  assertCoordinatorResult(result, command);
});

test("D3D-05 tab role commit maps explicit empty role to unassigned and rejects invalid roles", async () => {
  const fake = mutationAdaptersFixture();
  const command = mutationCommandFixture({
    operationId: "tab-role-empty-1",
    mutationKind: "workspace.tab.metadata.commit",
    payload: {
      workspaceTabId: "workspace-tab-1",
      field: "role",
      value: "",
      eventId: "tab-role-empty-event-1"
    }
  });

  const result = await coordinateMutation(command, fake.adapters);
  const event = fake.record.workspace.timeline.find(
    (item) => item.eventId === "tab-role-empty-event-1"
  );

  assert.equal(result.status, "committed");
  assert.equal(fake.record.workspace.workspaceRevision, 8);
  assert.equal(fake.record.workspace.tabs[0].role, "unassigned");
  assert.equal(event.type, "tab_role_updated");
  assert.equal(event.previousRole, "source");
  assert.equal(event.role, "unassigned");

  const invalid = mutationAdaptersFixture();
  const invalidCommand = mutationCommandFixture({
    operationId: "tab-role-invalid-1",
    mutationKind: "workspace.tab.metadata.commit",
    payload: {
      workspaceTabId: "workspace-tab-1",
      field: "role",
      value: "not-a-research-role",
      eventId: "tab-role-invalid-event-1"
    }
  });
  const invalidResult = await coordinateMutation(
    invalidCommand,
    invalid.adapters
  );

  assert.equal(invalidResult.status, "rejected");
  assert.equal(invalid.recordWrites, 0);
  assert.equal(invalid.record.workspace.workspaceRevision, 7);
  assertCoordinatorResult(result, command);
  assertCoordinatorResult(invalidResult, invalidCommand);
});

test("D3D-05 search intake adds one exact tab and treats existing browser tab identity as no_change", async () => {
  const fake = mutationAdaptersFixture();
  const tab = {
    workspaceTabId: "workspace-tab-search-1",
    tabId: 99,
    windowId: 10,
    groupId: -1,
    tabKey: "tab-key-99",
    url: "https://www.google.com/search?q=constellation",
    displayUrl: "google.com/search",
    originalTitle: "Search: constellation",
    alias: "",
    role: "unassigned",
    isOpen: true,
    firstSeenAt: NOW,
    lastSeenAt: NOW
  };
  const command = mutationCommandFixture({
    operationId: "search-intake-add-1",
    mutationKind: "search.intake.add",
    payload: {
      tab,
      query: "constellation",
      eventId: "search-intake-event-1",
      sameUrlDuplicate: false
    }
  });

  const committed = await coordinateMutation(command, fake.adapters);
  const event = fake.record.workspace.timeline.find(
    (item) => item.eventId === "search-intake-event-1"
  );

  assert.equal(committed.status, "committed");
  assert.equal(fake.record.workspace.workspaceRevision, 8);
  assert.equal(fake.record.workspace.tabs.length, 2);
  assert.equal(event.type, "browser_search_tab_added_to_workspace");
  assert.equal(event.query, "constellation");
  assert.equal(event.tabId, 99);
  assert.equal(event.url, tab.url);
  assert.equal(event.workspaceTabId, "workspace-tab-search-1");
  assert.equal(event.sameUrlDuplicate, false);
  assert.equal(event.searchLaunchAutoIntake, true);

  const duplicate = mutationCommandFixture({
    operationId: "search-intake-existing-browser-tab-2",
    expectedWorkspaceRevision: 8,
    mutationKind: "search.intake.add",
    payload: {
      tab: { ...tab, workspaceTabId: "workspace-tab-search-duplicate" },
      query: "constellation",
      eventId: "search-intake-event-duplicate",
      sameUrlDuplicate: false
    }
  });
  const noChange = await coordinateMutation(duplicate, fake.adapters);

  assert.equal(noChange.status, "no_change");
  assert.equal(fake.recordWrites, 1);
  assert.equal(fake.record.workspace.workspaceRevision, 8);
  assert.equal(fake.record.workspace.tabs.length, 2);
  assert.equal(fake.record.workspace.timeline.length, 1);
  assertCoordinatorResult(committed, command);
  assertCoordinatorResult(noChange, duplicate);
});

test("D3D-05 persists and verifies immutable intent plus candidate evidence before the scoped record write", async () => {
  const fake = mutationAdaptersFixture({ ledgerAbsent: true });
  const command = mutationCommandFixture({ operationId: "pending-order-1" });

  const result = await coordinateMutation(command, fake.adapters);
  const entry = fake.ledger.entries[0];
  const recordWrite = fake.events.findIndex((event) =>
    event.startsWith("write-record:")
  );
  const intentWrite = fake.events.findIndex((event) =>
    event.startsWith("write-ledger:1:")
  );
  const progressWrite = fake.events.findIndex((event) =>
    event.startsWith("write-ledger:2:")
  );

  assert.equal(result.status, "committed");
  assert.equal(fake.ledgerWrites, 3);
  assert.ok(intentWrite >= 0);
  assert.ok(progressWrite >= 0);
  assert.ok(recordWrite > intentWrite);
  assert.ok(recordWrite > progressWrite);
  assert.deepEqual(entry.operationIntent, {
    operationKind: "ordinary_mutation",
    commandSchema:
      "constellation-runtime-workspace-mutation-command-v0.1",
    primaryWorkspaceId: "workspace-alpha",
    affectedWorkspaceIds: ["workspace-alpha"],
    sourceWindowId: 10,
    targetWindowId: null,
    expectedRuntimeSessionId: "runtime-session-1",
    expectedAssignmentId: "assignment-alpha",
    expectedAssignmentEpoch: 1,
    expectedWorkspaceRevisions: { "workspace-alpha": 7 },
    durableSourceIdentity: null,
    durableSnapshotDigest: null,
    browserPlanDigest: null,
    projectionBaselineDigest: null,
    compatibilityPreflightFingerprints: { canonical: null, legacy: null },
    completedPhasesAtIntentWrite: [],
    nextRecoverablePhaseAtIntentWrite: "runtime_record_mutation",
    plannedArtifactIds: [deriveRuntimeWorkspaceKey("workspace-alpha")]
  });
  assert.deepEqual(entry.createdArtifacts, [{
    kind: "runtime_record_candidate",
    key: "constellationRuntimeWorkspace:workspace-alpha",
    recordFingerprint: result.recordFingerprint,
    previousRevision: 7,
    committedRevision: 8
  }]);
  assert.deepEqual(
    Object.keys(entry.createdArtifacts[0]).sort(),
    [
      "committedRevision",
      "key",
      "kind",
      "previousRevision",
      "recordFingerprint"
    ]
  );
  assert.equal(entry.state, "terminal");
  assertCoordinatorResult(result, command);
});

test("D3D-05 exact terminal replay and operation fingerprint conflict perform no additional runtime write", async () => {
  const fake = mutationAdaptersFixture();
  const command = mutationCommandFixture({ operationId: "operation-replay-1" });

  const committed = await coordinateMutation(command, fake.adapters);
  const replay = await coordinateMutation(
    { ...command, requestedAt: LATER },
    fake.adapters
  );
  const conflictCommand = mutationCommandFixture({
    operationId: "operation-replay-1",
    payload: {
      record: {
        entryId: "journal-1",
        text: "different payload",
        tag: "",
        relatedRoleId: "",
        relatedRoleLabel: "",
        createdAt: NOW
      }
    }
  });
  const conflict = await coordinateMutation(conflictCommand, fake.adapters);

  assert.equal(committed.status, "committed");
  assert.equal(replay.status, "replayed");
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.reason, "operation_id_conflict");
  assert.equal(fake.recordWrites, 1);
  assert.equal(fake.record.workspace.journal.length, 1);
  assertCoordinatorResult(committed, command);
  assertCoordinatorResult(replay, { ...command, requestedAt: LATER });
  assertCoordinatorResult(conflict, conflictCommand);
});

test("D3D-05 refuses a stored replayed terminal as recursive replay authority", async () => {
  const fake = mutationAdaptersFixture();
  const command = mutationCommandFixture({ operationId: "replayed-source-1" });
  const committed = await coordinateMutation(command, fake.adapters);
  const storedLedger = fake.ledger;

  assert.equal(committed.status, "committed");
  assert.equal(storedLedger.entries[0].state, "terminal");
  storedLedger.entries[0].result = {
    ...storedLedger.entries[0].result,
    status: "replayed"
  };
  assert.equal(
    mutationContract.validateRuntimeWorkspaceMutationResult(
      storedLedger.entries[0].result,
      mutationResultExpectation(command)
    ).valid,
    true
  );
  fake.ledger = storedLedger;

  const writesBeforeReplay = fake.recordWrites;
  const result = await coordinateMutation(
    { ...command, requestedAt: LATER },
    fake.adapters
  );

  assert.equal(result.status, "failed");
  assert.equal(result.reason, "terminal_replay_source_invalid");
  assert.equal(fake.recordWrites, writesBeforeReplay);
  assertCoordinatorResult(result, { ...command, requestedAt: LATER });
});

test("D3D-05 refuses a stored failed terminal as replay authority", async () => {
  const fake = mutationAdaptersFixture();
  const command = mutationCommandFixture({ operationId: "failed-source-1" });
  const committed = await coordinateMutation(command, fake.adapters);
  const storedLedger = fake.ledger;

  assert.equal(committed.status, "committed");
  assert.equal(storedLedger.entries[0].state, "terminal");
  storedLedger.entries[0].result = {
    ...storedLedger.entries[0].result,
    status: "failed"
  };
  assert.equal(
    mutationContract.validateRuntimeWorkspaceMutationResult(
      storedLedger.entries[0].result,
      mutationResultExpectation(command)
    ).valid,
    true
  );
  fake.ledger = storedLedger;

  const writesBeforeReplay = fake.recordWrites;
  const result = await coordinateMutation(
    { ...command, requestedAt: LATER },
    fake.adapters
  );

  assert.equal(result.status, "failed");
  assert.equal(result.reason, "terminal_replay_source_invalid");
  assert.equal(fake.recordWrites, writesBeforeReplay);
  assertCoordinatorResult(result, { ...command, requestedAt: LATER });
});

test("D3D-05 malformed workspace-local ledger fails closed before any scoped record write", async () => {
  const fake = mutationAdaptersFixture({ ledger: { malformed: true } });
  const command = mutationCommandFixture({ operationId: "ledger-malformed-1" });

  const result = await coordinateMutation(command, fake.adapters);

  assert.equal(result.status, "failed");
  assert.equal(result.reason, "workspace_operation_ledger_invalid");
  assert.equal(fake.recordWrites, 0);
  assertCoordinatorResult(result, command);
});

test("D3D-05 pending intent write and verification failure prevent every scoped record write", async () => {
  const cases = [
    {
      name: "pending intent write failure",
      faults: { ledgerWriteFailureAt: 1 }
    },
    {
      name: "pending intent verification failure",
      faults: { ledgerReadFailureAt: 2 }
    },
    {
      name: "pending intent verification mismatch",
      configure(fake) {
        const readLedger = fake.adapters.readWorkspaceOperationLedger;
        fake.adapters.readWorkspaceOperationLedger = async (...args) => {
          const value = await readLedger(...args);
          return fake.ledgerReads === 2
            ? createWorkspaceOperationLedger("workspace-alpha")
            : value;
        };
      }
    }
  ];

  for (const item of cases) {
    const fake = mutationAdaptersFixture({ faults: item.faults });
    item.configure?.(fake);
    const command = mutationCommandFixture({
      operationId: "pending-failure-" + item.name.replaceAll(" ", "-")
    });

    const result = await coordinateMutation(command, fake.adapters);

    assert.equal(result.status, "failed", item.name);
    assert.equal(fake.recordWrites, 0, item.name);
    assertCoordinatorResult(result, command);
  }
});

test("D3D-05 runtime record write failure leaves pending candidate evidence for deterministic retry", async () => {
  const fake = mutationAdaptersFixture({
    faults: { recordWriteFailureAt: 1 }
  });
  const command = mutationCommandFixture({ operationId: "record-write-failure-1" });

  const result = await coordinateMutation(command, fake.adapters);

  assert.equal(result.status, "failed");
  assert.equal(result.reason, "runtime_record_write_failed");
  assert.equal(result.indeterminate, false);
  assert.equal(fake.recordWrites, 1);
  assert.equal(fake.record.workspace.workspaceRevision, 7);
  assert.equal(fake.ledger.entries[0].state, "pending");
  assert.equal(fake.ledger.entries[0].createdArtifacts.length, 1);
  assertCoordinatorResult(result, command);
});

test("D3D-05 post-write record verification failures are indeterminate and do not roll back", async () => {
  const cases = [
    {
      name: "verification read failure",
      faults: { recordReadFailureAt: 2 }
    },
    {
      name: "fingerprint mismatch",
      faults: {
        mutateRecordAfterWrite(record) {
          return {
            ...record,
            workspace: {
              ...record.workspace,
              name: "unexpected concurrent state"
            }
          };
        }
      }
    }
  ];

  for (const item of cases) {
    const fake = mutationAdaptersFixture({ faults: item.faults });
    const command = mutationCommandFixture({
      operationId: "record-verification-" + item.name.replaceAll(" ", "-")
    });

    const result = await coordinateMutation(command, fake.adapters);

    assert.equal(result.status, "indeterminate", item.name);
    assert.equal(result.indeterminate, true, item.name);
    assert.equal(fake.recordWrites, 1, item.name);
    assert.equal(fake.record.workspace.workspaceRevision, 8, item.name);
    assert.equal(fake.ledger.entries[0].state, "pending", item.name);
    assertCoordinatorResult(result, command);
  }
});

test("D3D-05 terminal ledger failures after verified record are indeterminate and never roll back", async () => {
  const cases = [
    {
      name: "terminal ledger write failure",
      faults: { ledgerWriteFailureAt: 3 }
    },
    {
      name: "terminal ledger verification failure",
      faults: { ledgerReadFailureAt: 4 }
    }
  ];

  for (const item of cases) {
    const fake = mutationAdaptersFixture({ faults: item.faults });
    const command = mutationCommandFixture({
      operationId: "terminal-ledger-" + item.name.replaceAll(" ", "-")
    });

    const result = await coordinateMutation(command, fake.adapters);

    assert.equal(result.status, "indeterminate", item.name);
    assert.equal(result.indeterminate, true, item.name);
    assert.equal(result.mutationCommitted, true, item.name);
    assert.equal(result.workspaceVerified, true, item.name);
    assert.equal(fake.recordWrites, 1, item.name);
    assert.equal(fake.record.workspace.workspaceRevision, 8, item.name);
    assertCoordinatorResult(result, command);
  }
});

test("D3D-05 unresolved retries resume original state, complete verified candidate state, and refuse unexplained state", async () => {
  const command = mutationCommandFixture({ operationId: "retry-case-a-1" });
  const caseA = mutationAdaptersFixture({
    faults: { recordWriteFailureAt: 1 }
  });
  const firstA = await coordinateMutation(command, caseA.adapters);
  const retryA = await coordinateMutation(
    { ...command, requestedAt: LATER },
    caseA.adapters
  );

  assert.equal(firstA.status, "failed");
  assert.equal(retryA.status, "committed");
  assert.equal(caseA.recordWrites, 2);
  assert.equal(caseA.record.workspace.workspaceRevision, 8);
  assert.equal(caseA.ledger.entries[0].state, "terminal");
  assert.equal(caseA.ledger.entries[0].createdArtifacts.length, 1);

  const caseBCommand = mutationCommandFixture({ operationId: "retry-case-b-1" });
  const caseB = mutationAdaptersFixture({
    faults: { ledgerWriteFailureAt: 3 }
  });
  const firstB = await coordinateMutation(caseBCommand, caseB.adapters);
  const retryB = await coordinateMutation(
    { ...caseBCommand, requestedAt: LATER },
    caseB.adapters
  );

  assert.equal(firstB.status, "indeterminate");
  assert.equal(retryB.status, "committed");
  assert.equal(caseB.recordWrites, 1);
  assert.equal(caseB.record.workspace.workspaceRevision, 8);
  assert.equal(caseB.ledger.entries[0].state, "terminal");

  const caseCCommand = mutationCommandFixture({ operationId: "retry-case-c-1" });
  const caseC = mutationAdaptersFixture({
    faults: { ledgerWriteFailureAt: 3 }
  });
  await coordinateMutation(caseCCommand, caseC.adapters);
  caseC.record = runtimeMutationRecordFixture({
    workspaceRevision: 9,
    workspace: {
      ...caseC.record.workspace,
      workspaceRevision: 9,
      name: "unexplained record state"
    },
    lastVerifiedAt: LATER
  });
  const retryC = await coordinateMutation(
    { ...caseCCommand, requestedAt: LATER },
    caseC.adapters
  );

  assert.equal(retryC.status, "indeterminate");
  assert.equal(retryC.indeterminate, true);
  assert.equal(caseC.recordWrites, 1);
  assert.equal(caseC.record.workspace.workspaceRevision, 9);

  const caseDCommand = mutationCommandFixture({ operationId: "retry-case-d-1" });
  const caseD = mutationAdaptersFixture({
    faults: { ledgerWriteFailureAt: 3 }
  });
  await coordinateMutation(caseDCommand, caseD.adapters);
  const tamperedCandidateLedger = caseD.ledger;
  tamperedCandidateLedger.entries[0].createdArtifacts[0].key =
    deriveRuntimeWorkspaceKey("workspace-beta");
  caseD.ledger = tamperedCandidateLedger;
  const retryD = await coordinateMutation(
    { ...caseDCommand, requestedAt: LATER },
    caseD.adapters
  );

  assert.equal(retryD.status, "indeterminate");
  assert.equal(retryD.indeterminate, true);
  assert.equal(caseD.recordWrites, 1);
  assert.equal(caseD.record.workspace.workspaceRevision, 8);
  assertCoordinatorResult(firstA, command);
  assertCoordinatorResult(retryA, { ...command, requestedAt: LATER });
  assertCoordinatorResult(firstB, caseBCommand);
  assertCoordinatorResult(retryB, { ...caseBCommand, requestedAt: LATER });
  assertCoordinatorResult(retryC, { ...caseCCommand, requestedAt: LATER });
  assertCoordinatorResult(retryD, { ...caseDCommand, requestedAt: LATER });
});

function scopedContentLockFixture() {
  const tails = new Map();
  return async function withScopedLocks(plan, callback) {
    const contentLock = plan.at(-1);
    const prior = tails.get(contentLock) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    tails.set(contentLock, prior.then(() => current));
    await prior;
    try {
      return await callback();
    } finally {
      release();
    }
  };
}

test("D3D-05 allows different assigned workspaces to make progress under disjoint scoped content locks", { timeout: 1000 }, async () => {
  const sharedLocks = scopedContentLockFixture();
  const alpha = mutationAdaptersFixture();
  const beta = mutationAdaptersFixture({
    authority: runtimeMutationAuthorityFixture({
      assignments: [{
        workspaceId: "workspace-beta",
        windowId: 20,
        runtimeAssignmentId: "assignment-beta",
        sourceContextId: "context-20"
      }]
    }),
    record: runtimeMutationRecordFixture({
      workspaceId: "workspace-beta",
      workspace: runtimeMutationWorkspaceFixture({
        workspaceId: "workspace-beta"
      })
    }),
    ledger: createWorkspaceOperationLedger("workspace-beta")
  });
  const alphaPlans = [];
  const betaPlans = [];
  alpha.adapters.withScopedLocks = async (plan, callback) => {
    alphaPlans.push([...plan]);
    return sharedLocks(plan, callback);
  };
  beta.adapters.withScopedLocks = async (plan, callback) => {
    betaPlans.push([...plan]);
    return sharedLocks(plan, callback);
  };

  let arrivals = 0;
  let releaseBoth;
  const bothArrived = new Promise((resolve) => {
    releaseBoth = resolve;
  });
  for (const fake of [alpha, beta]) {
    const readAuthority = fake.adapters.readAuthority;
    fake.adapters.readAuthority = async () => {
      arrivals += 1;
      if (arrivals === 2) releaseBoth();
      await bothArrived;
      return readAuthority();
    };
  }

  const alphaCommand = mutationCommandFixture({ operationId: "alpha-concurrent-1" });
  const betaCommand = mutationCommandFixture({
    operationId: "beta-concurrent-1",
    runtimeSessionId: "runtime-session-1",
    sourceContextId: "context-20",
    sourceWindowId: 20,
    workspaceId: "workspace-beta",
    runtimeAssignmentId: "assignment-beta",
    assignmentEpoch: 1,
    payload: {
      record: {
        entryId: "journal-beta-1",
        text: "beta",
        tag: "",
        relatedRoleId: "",
        relatedRoleLabel: "",
        createdAt: NOW
      }
    }
  });

  const [alphaResult, betaResult] = await Promise.all([
    coordinateMutation(alphaCommand, alpha.adapters),
    coordinateMutation(betaCommand, beta.adapters)
  ]);

  assert.equal(arrivals, 2);
  assert.equal(alphaResult.status, "committed");
  assert.equal(betaResult.status, "committed");
  assert.equal(alpha.record.workspace.workspaceRevision, 8);
  assert.equal(beta.record.workspace.workspaceRevision, 8);
  assert.deepEqual(alphaPlans[0], [
    "constellation-runtime-window:10",
    "constellation-runtime-workspace-binding:workspace-alpha",
    "constellation-runtime-workspace:workspace-alpha"
  ]);
  assert.deepEqual(betaPlans[0], [
    "constellation-runtime-window:20",
    "constellation-runtime-workspace-binding:workspace-beta",
    "constellation-runtime-workspace:workspace-beta"
  ]);
  assertCoordinatorResult(alphaResult, alphaCommand);
  assertCoordinatorResult(betaResult, betaCommand);
});

test("D3D-05 serializes same-workspace mutations and fails the stale revision without a second write", async () => {
  const fake = mutationAdaptersFixture();
  const sharedLocks = scopedContentLockFixture();
  let activeCallbacks = 0;
  let maximumActiveCallbacks = 0;
  fake.adapters.withScopedLocks = async (plan, callback) => sharedLocks(
    plan,
    async () => {
      activeCallbacks += 1;
      maximumActiveCallbacks = Math.max(
        maximumActiveCallbacks,
        activeCallbacks
      );
      try {
        return await callback();
      } finally {
        activeCallbacks -= 1;
      }
    }
  );
  const first = mutationCommandFixture({ operationId: "same-workspace-first-1" });
  const second = mutationCommandFixture({
    operationId: "same-workspace-second-1",
    payload: {
      record: {
        entryId: "journal-2",
        text: "second",
        tag: "",
        relatedRoleId: "",
        relatedRoleLabel: "",
        createdAt: NOW
      }
    }
  });

  const [firstResult, secondResult] = await Promise.all([
    coordinateMutation(first, fake.adapters),
    coordinateMutation(second, fake.adapters)
  ]);

  assert.equal(firstResult.status, "committed");
  assert.equal(secondResult.status, "revision_conflict");
  assert.equal(maximumActiveCallbacks, 1);
  assert.equal(fake.recordWrites, 1);
  assert.equal(fake.record.workspace.workspaceRevision, 8);
  assert.equal(fake.record.workspace.journal.length, 1);
  assertCoordinatorResult(firstResult, first);
  assertCoordinatorResult(secondResult, second);
});

function injectedWorkspaceMutationLocks() {
  const tails = new Map();
  const requests = [];
  const activeCallbacks = new Map();
  const maximumCallbacks = new Map();
  let activeContentCallbacks = 0;
  let maximumDifferentWorkspaceContentCallbacks = 0;

  return {
    requests,
    maximumCallbacks,
    get maximumDifferentWorkspaceContentCallbacks() {
      return maximumDifferentWorkspaceContentCallbacks;
    },
    async requestLock(name, callback) {
      const prior = tails.get(name) || Promise.resolve();
      let release;
      const current = new Promise((resolve) => {
        release = resolve;
      });
      tails.set(name, prior.then(() => current));
      requests.push(name);
      await prior;

      const active = (activeCallbacks.get(name) || 0) + 1;
      activeCallbacks.set(name, active);
      maximumCallbacks.set(name, Math.max(maximumCallbacks.get(name) || 0, active));
      const isContentLock = name.startsWith("constellation-runtime-workspace:");
      if (isContentLock) {
        activeContentCallbacks += 1;
        maximumDifferentWorkspaceContentCallbacks = Math.max(
          maximumDifferentWorkspaceContentCallbacks,
          activeContentCallbacks
        );
      }

      try {
        return await callback();
      } finally {
        if (isContentLock) activeContentCallbacks -= 1;
        activeCallbacks.set(name, activeCallbacks.get(name) - 1);
        release();
      }
    }
  };
}

function runtimeMutationChromeFixture(options = {}) {
  const authority = options.authority || runtimeMutationAuthorityFixture();
  const records = options.records || {
    "workspace-alpha": runtimeMutationRecordFixture()
  };
  const ledgers = options.ledgers || {
    "workspace-alpha": createWorkspaceOperationLedger("workspace-alpha")
  };
  const sessionValues = new Map([
    ["constellationRuntimeSessionAuthority", cloneStorageValue(authority)]
  ]);
  const localValues = new Map();
  const storageAccesses = [];
  const locks = injectedWorkspaceMutationLocks();
  const forbiddenKeys = [
    "constellationActiveWorkspace",
    "chromeFlowWorkspace",
    "activeWorkspaceId",
    "constellationRecentOperationLedger"
  ];
  const holdAuthorityReadsUntil = Number.isSafeInteger(
    options.holdAuthorityReadsUntil
  ) ? options.holdAuthorityReadsUntil : 0;
  let authorityReadCount = 0;
  let releaseAuthorityReads;
  const authorityReadsReady = holdAuthorityReadsUntil > 0
    ? new Promise((resolve) => {
      releaseAuthorityReads = resolve;
    })
    : null;

  for (const [workspaceId, record] of Object.entries(records)) {
    localValues.set(
      "constellationRuntimeWorkspace:" + workspaceId,
      cloneStorageValue(record)
    );
  }
  for (const [workspaceId, ledger] of Object.entries(ledgers)) {
    localValues.set(
      "constellationRuntimeWorkspaceOperationLedger:" + workspaceId,
      cloneStorageValue(ledger)
    );
  }
  for (const key of forbiddenKeys) {
    localValues.set(key, { forbiddenStorageSentinel: key });
  }

  function createStorageArea(area, values) {
    return {
      async get(input) {
        const keys = storageKeys(input);
        storageAccesses.push({ area, method: "get", keys });
        if (
          area === "session" &&
          keys.length === 1 &&
          keys[0] === "constellationRuntimeSessionAuthority"
        ) {
          authorityReadCount += 1;
          if (authorityReadsReady) {
            if (authorityReadCount >= holdAuthorityReadsUntil) {
              releaseAuthorityReads();
            }
            await authorityReadsReady;
          }
        }
        const result = {};
        for (const key of keys) {
          if (values.has(key)) result[key] = cloneStorageValue(values.get(key));
        }
        return result;
      },
      async set(items) {
        assert.ok(items && typeof items === "object" && !Array.isArray(items));
        const keys = Object.keys(items);
        storageAccesses.push({ area, method: "set", keys });
        for (const key of keys) values.set(key, cloneStorageValue(items[key]));
      }
    };
  }

  return {
    chromeApi: {
      storage: {
        session: createStorageArea("session", sessionValues),
        local: createStorageArea("local", localValues)
      }
    },
    locks,
    storageAccesses,
    forbiddenKeys,
    get authorityReadCount() {
      return authorityReadCount;
    },
    localValue(key) {
      return localValues.has(key) ? cloneStorageValue(localValues.get(key)) : undefined;
    }
  };
}

function storageKeys(input) {
  if (typeof input === "string") return [input];
  if (Array.isArray(input) && input.every((item) => typeof item === "string")) {
    return [...input];
  }
  throw new TypeError("fake Chrome storage requires exact string keys");
}

function cloneStorageValue(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function assertNoForbiddenMutationStorageAccess(fake) {
  const forbiddenAccesses = fake.storageAccesses.filter((access) =>
    access.keys.some((key) => fake.forbiddenKeys.includes(key))
  );
  assert.deepEqual(forbiddenAccesses, []);
}

test("D3D-05 chrome adapter module exposes the accepted coordinator interface", () => {
  assert.ok(
    mutationChromeAdapter,
    "D3D-05 runtime-workspace-mutation/chrome-adapter.js must exist"
  );
  assert.equal(
    typeof mutationChromeAdapter.createRuntimeWorkspaceMutationChromeAdapters,
    "function"
  );

  const fake = runtimeMutationChromeFixture();
  const adapters = createMutationChromeAdapters(fake.chromeApi, {
    requestLock: fake.locks.requestLock,
    now: () => LATER
  });

  assert.deepEqual(Object.keys(adapters).sort(), [
    "now",
    "readAuthority",
    "readRuntimeWorkspaceRecord",
    "readWorkspaceOperationLedger",
    "withScopedLocks",
    "writeRuntimeWorkspaceRecord",
    "writeWorkspaceOperationLedger"
  ]);
  assert.equal(adapters.now(), LATER);
});

test("D3D-05 chrome adapter performs direct exact session and workspace-local storage access", async () => {
  const authority = runtimeMutationAuthorityFixture({
    assignments: [
      {
        workspaceId: "workspace-alpha",
        windowId: 10,
        runtimeAssignmentId: "assignment-alpha",
        sourceContextId: "context-10"
      },
      {
        workspaceId: "workspace-beta",
        windowId: 20,
        runtimeAssignmentId: "assignment-beta",
        sourceContextId: "context-20"
      }
    ]
  });
  const alphaRecord = runtimeMutationRecordFixture();
  const betaRecord = runtimeMutationRecordFixture({
    workspaceId: "workspace-beta",
    workspace: runtimeMutationWorkspaceFixture({
      workspaceId: "workspace-beta"
    })
  });
  const alphaLedger = createWorkspaceOperationLedger("workspace-alpha");
  const betaLedger = createWorkspaceOperationLedger("workspace-beta");
  const fake = runtimeMutationChromeFixture({
    authority,
    records: {
      "workspace-alpha": alphaRecord,
      "workspace-beta": betaRecord
    },
    ledgers: {
      "workspace-alpha": alphaLedger,
      "workspace-beta": betaLedger
    }
  });
  const adapters = createMutationChromeAdapters(fake.chromeApi, {
    requestLock: fake.locks.requestLock,
    now: () => LATER
  });
  const plan = [
    "constellation-runtime-window:10",
    "constellation-runtime-workspace-binding:workspace-alpha",
    "constellation-runtime-workspace:workspace-alpha"
  ];

  assert.deepEqual(await adapters.readAuthority(), authority);
  assert.deepEqual(
    await adapters.readRuntimeWorkspaceRecord("workspace-alpha"),
    alphaRecord
  );
  await adapters.writeRuntimeWorkspaceRecord("workspace-alpha", alphaRecord);
  assert.deepEqual(
    await adapters.readWorkspaceOperationLedger("workspace-alpha"),
    alphaLedger
  );
  await adapters.writeWorkspaceOperationLedger("workspace-alpha", alphaLedger);
  assert.deepEqual(
    await adapters.readRuntimeWorkspaceRecord("workspace-beta"),
    betaRecord
  );
  await adapters.writeRuntimeWorkspaceRecord("workspace-beta", betaRecord);
  assert.deepEqual(
    await adapters.readWorkspaceOperationLedger("workspace-beta"),
    betaLedger
  );
  await adapters.writeWorkspaceOperationLedger("workspace-beta", betaLedger);

  assert.deepEqual(fake.locks.requests, []);
  assert.equal(await adapters.withScopedLocks(plan, () => "locked"), "locked");
  assert.deepEqual(fake.locks.requests, plan);
  assert.deepEqual(fake.storageAccesses, [
    {
      area: "session",
      method: "get",
      keys: ["constellationRuntimeSessionAuthority"]
    },
    {
      area: "local",
      method: "get",
      keys: ["constellationRuntimeWorkspace:workspace-alpha"]
    },
    {
      area: "local",
      method: "set",
      keys: ["constellationRuntimeWorkspace:workspace-alpha"]
    },
    {
      area: "local",
      method: "get",
      keys: ["constellationRuntimeWorkspaceOperationLedger:workspace-alpha"]
    },
    {
      area: "local",
      method: "set",
      keys: ["constellationRuntimeWorkspaceOperationLedger:workspace-alpha"]
    },
    {
      area: "local",
      method: "get",
      keys: ["constellationRuntimeWorkspace:workspace-beta"]
    },
    {
      area: "local",
      method: "set",
      keys: ["constellationRuntimeWorkspace:workspace-beta"]
    },
    {
      area: "local",
      method: "get",
      keys: ["constellationRuntimeWorkspaceOperationLedger:workspace-beta"]
    },
    {
      area: "local",
      method: "set",
      keys: ["constellationRuntimeWorkspaceOperationLedger:workspace-beta"]
    }
  ]);
  assertNoForbiddenMutationStorageAccess(fake);
  assert.deepEqual(
    fake.localValue("constellationRuntimeWorkspace:workspace-alpha"),
    alphaRecord
  );
  assert.deepEqual(
    fake.localValue("constellationRuntimeWorkspaceOperationLedger:workspace-beta"),
    betaLedger
  );
});

test("D3D-05 chrome adapters demonstrate Alpha and Beta critical-section overlap without global authority", { timeout: 1000 }, async () => {
  const authority = runtimeMutationAuthorityFixture({
    assignments: [
      {
        workspaceId: "workspace-alpha",
        windowId: 10,
        runtimeAssignmentId: "assignment-alpha",
        sourceContextId: "context-10"
      },
      {
        workspaceId: "workspace-beta",
        windowId: 20,
        runtimeAssignmentId: "assignment-beta",
        sourceContextId: "context-20"
      }
    ]
  });
  const fake = runtimeMutationChromeFixture({
    authority,
    records: {
      "workspace-alpha": runtimeMutationRecordFixture(),
      "workspace-beta": runtimeMutationRecordFixture({
        workspaceId: "workspace-beta",
        workspace: runtimeMutationWorkspaceFixture({
          workspaceId: "workspace-beta"
        })
      })
    },
    ledgers: {
      "workspace-alpha": createWorkspaceOperationLedger("workspace-alpha"),
      "workspace-beta": createWorkspaceOperationLedger("workspace-beta")
    },
    holdAuthorityReadsUntil: 2
  });
  const adapterOptions = {
    requestLock: fake.locks.requestLock,
    now: () => LATER
  };
  const alphaAdapters = createMutationChromeAdapters(
    fake.chromeApi,
    adapterOptions
  );
  const betaAdapters = createMutationChromeAdapters(
    fake.chromeApi,
    adapterOptions
  );
  const alphaCommand = mutationCommandFixture({ operationId: "adapter-alpha-1" });
  const betaCommand = mutationCommandFixture({
    operationId: "adapter-beta-1",
    sourceContextId: "context-20",
    sourceWindowId: 20,
    workspaceId: "workspace-beta",
    runtimeAssignmentId: "assignment-beta",
    assignmentEpoch: 2,
    payload: {
      record: {
        entryId: "adapter-beta-journal-1",
        text: "beta",
        tag: "",
        relatedRoleId: "",
        relatedRoleLabel: "",
        createdAt: NOW
      }
    }
  });

  const [alphaResult, betaResult] = await Promise.all([
    coordinateMutation(alphaCommand, alphaAdapters),
    coordinateMutation(betaCommand, betaAdapters)
  ]);

  assert.equal(
    authority.assignmentRegistry.assignments.find((assignment) =>
      assignment.workspaceId === "workspace-beta"
    ).assignmentEpoch,
    2
  );
  assert.equal(alphaResult.status, "committed");
  assert.equal(betaResult.status, "committed");
  assert.equal(fake.authorityReadCount, 2);
  assert.equal(
    fake.localValue("constellationRuntimeWorkspace:workspace-alpha")
      .workspaceRevision,
    8
  );
  assert.equal(
    fake.localValue("constellationRuntimeWorkspace:workspace-beta")
      .workspaceRevision,
    8
  );
  assert.equal(fake.locks.maximumDifferentWorkspaceContentCallbacks >= 2, true);
  assert.deepEqual(
    fake.locks.requests.filter((name) =>
      name.startsWith("constellation-runtime-workspace:")
    ).sort(),
    [
      "constellation-runtime-workspace:workspace-alpha",
      "constellation-runtime-workspace:workspace-beta"
    ]
  );
  assert.equal(
    fake.locks.requests.includes("constellation-runtime-state-v0.1"),
    false
  );
  assert.equal(
    fake.locks.requests.some((name) => name.includes("compatibility")),
    false
  );
  assertNoForbiddenMutationStorageAccess(fake);
  assertCoordinatorResult(alphaResult, alphaCommand);
  assertCoordinatorResult(betaResult, betaCommand);
});

test("D3D-05 chrome adapters serialize same-workspace mutations without a nested content lock", async () => {
  const fake = runtimeMutationChromeFixture();
  const adapterOptions = {
    requestLock: fake.locks.requestLock,
    now: () => LATER
  };
  const firstAdapters = createMutationChromeAdapters(
    fake.chromeApi,
    adapterOptions
  );
  const secondAdapters = createMutationChromeAdapters(
    fake.chromeApi,
    adapterOptions
  );
  const firstCommand = mutationCommandFixture({ operationId: "adapter-same-1" });
  const secondCommand = mutationCommandFixture({
    operationId: "adapter-same-2",
    payload: {
      record: {
        entryId: "adapter-same-journal-2",
        text: "second",
        tag: "",
        relatedRoleId: "",
        relatedRoleLabel: "",
        createdAt: NOW
      }
    }
  });

  const [firstResult, secondResult] = await Promise.all([
    coordinateMutation(firstCommand, firstAdapters),
    coordinateMutation(secondCommand, secondAdapters)
  ]);
  const contentLock = "constellation-runtime-workspace:workspace-alpha";
  const runtimeRecordWrites = fake.storageAccesses.filter((access) =>
    access.area === "local" &&
    access.method === "set" &&
    access.keys.includes("constellationRuntimeWorkspace:workspace-alpha")
  );

  assert.deepEqual(
    [firstResult.status, secondResult.status].sort(),
    ["committed", "revision_conflict"]
  );
  assert.equal(fake.locks.maximumCallbacks.get(contentLock), 1);
  assert.equal(
    fake.locks.requests.filter((name) => name === contentLock).length,
    2
  );
  assert.equal(runtimeRecordWrites.length, 1);
  assert.equal(
    fake.localValue("constellationRuntimeWorkspace:workspace-alpha")
      .workspaceRevision,
    8
  );
  assert.equal(
    fake.locks.requests.includes("constellation-runtime-state-v0.1"),
    false
  );
  assert.equal(
    fake.locks.requests.some((name) => name.includes("compatibility")), false);
  assertNoForbiddenMutationStorageAccess(fake);
  assertCoordinatorResult(firstResult, firstCommand);
  assertCoordinatorResult(secondResult, secondCommand);
});

function assignedMutationAuthorityFixture(overrides = {}) {
  const workspaceId = Object.hasOwn(overrides, "workspaceId")
    ? overrides.workspaceId
    : "workspace-alpha";
  const workspaceRevision = Object.hasOwn(overrides, "workspaceRevision")
    ? overrides.workspaceRevision
    : 7;
  const workspace = Object.hasOwn(overrides, "workspace")
    ? overrides.workspace
    : runtimeMutationWorkspaceFixture({ workspaceId, workspaceRevision });

  return structuredClone({
    schema: SIDE_PANEL_ASSIGNED_WORKSPACE_AUTHORITY_SCHEMA,
    runtimeSessionId: "runtime-session-1",
    sourceContextId: "context-10",
    sourceWindowId: 10,
    workspaceId,
    workspaceRevision,
    runtimeAssignmentId: "assignment-alpha",
    assignmentEpoch: 1,
    authorityRevision: 1,
    lifecycleState: "available",
    workspace,
    ...overrides
  });
}

function createMutationClient(options) {
  assert.ok(
    mutationClient,
    "D3D-05 runtime-workspace-mutation/client.js must exist"
  );
  assert.equal(
    typeof mutationClient.createRuntimeWorkspaceMutationClient,
    "function",
    "D3D-05 client must export createRuntimeWorkspaceMutationClient"
  );
  return mutationClient.createRuntimeWorkspaceMutationClient(options);
}

function mutationResultFixture(command, overrides = {}) {
  return mutationContract.createRuntimeWorkspaceMutationResult(command, {
    status: "committed",
    reason: "",
    previousRevision: command.expectedWorkspaceRevision,
    committedRevision: command.expectedWorkspaceRevision + 1,
    recordFingerprint: "record-fingerprint-8",
    phase: "complete",
    mutationCommitted: true,
    authorityVerified: true,
    workspaceVerified: true,
    ledgerRecorded: true,
    retrySafe: true,
    indeterminate: false,
    warnings: [],
    errors: [],
    ...overrides
  });
}

function createMutationHandler() {
  assert.ok(
    mutationServiceWorkerHandler,
    "D3D-05 runtime-workspace-mutation/service-worker-handler.js must exist"
  );
  assert.equal(
    typeof mutationServiceWorkerHandler.handleRuntimeWorkspaceMutationMessage,
    "function",
    "D3D-05 handler must export handleRuntimeWorkspaceMutationMessage"
  );
  return mutationServiceWorkerHandler.handleRuntimeWorkspaceMutationMessage;
}

function authorizedMutationSender(overrides = {}) {
  return {
    id: "extension-id",
    url: SIDE_PANEL_URL,
    ...overrides
  };
}

test("D3D-05 assigned mutation client module exposes the accepted public interface", () => {
  const client = createMutationClient({
    createId: () => "operation-client-1",
    now: () => LATER,
    send: async () => null
  });

  assert.equal(typeof client.submit, "function");
});

test("D3D-05 client copies one verified assigned authority into one exact command without caller mutation", async () => {
  const authority = assignedMutationAuthorityFixture();
  const payload = structuredClone(mutationCommandFixture().payload);
  const originalAuthority = structuredClone(authority);
  const originalPayload = structuredClone(payload);
  const sent = [];
  let createIdCalls = 0;
  let nowCalls = 0;
  const client = createMutationClient({
    createId: () => {
      createIdCalls += 1;
      return "generated-operation-1";
    },
    now: () => {
      nowCalls += 1;
      return LATER;
    },
    send: async (command) => {
      sent.push(structuredClone(command));
      return mutationResultFixture(command);
    }
  });

  const result = await client.submit({
    authority,
    mutationKind: "journal.append",
    payload
  });

  const expectedCommand = {
    type: mutationContract.RUNTIME_WORKSPACE_MUTATION_TYPE,
    schema: mutationContract.RUNTIME_WORKSPACE_MUTATION_COMMAND_SCHEMA,
    operationId: "generated-operation-1",
    runtimeSessionId: "runtime-session-1",
    sourceContextId: "context-10",
    sourceWindowId: 10,
    workspaceId: "workspace-alpha",
    expectedWorkspaceRevision: 7,
    runtimeAssignmentId: "assignment-alpha",
    assignmentEpoch: 1,
    mutationKind: "journal.append",
    payload: originalPayload,
    requestedAt: LATER
  };

  assert.equal(createIdCalls, 1);
  assert.equal(nowCalls, 1);
  assert.deepEqual(sent, [expectedCommand]);
  assert.equal(
    mutationContract.snapshotAndValidateRuntimeWorkspaceMutationCommand(sent[0])
      .valid,
    true
  );
  assert.deepEqual(authority, originalAuthority);
  assert.deepEqual(payload, originalPayload);
  assert.deepEqual(result, mutationResultFixture(expectedCommand));
});

test("D3D-05 client preserves an explicit operationId without generating a replacement", async () => {
  const sent = [];
  let createIdCalls = 0;
  const client = createMutationClient({
    createId: () => {
      createIdCalls += 1;
      return "unexpected-generated-operation";
    },
    now: () => LATER,
    send: async (command) => {
      sent.push(structuredClone(command));
      return mutationResultFixture(command);
    }
  });

  const result = await client.submit({
    authority: assignedMutationAuthorityFixture(),
    mutationKind: "journal.append",
    payload: structuredClone(mutationCommandFixture().payload),
    operationId: "caller-operation-77"
  });

  assert.equal(createIdCalls, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].operationId, "caller-operation-77");
  assert.equal(result.operationId, "caller-operation-77");
});

test("D3D-05 client rejects every malformed or non-writable assigned authority before send", async () => {
  const sent = [];
  let createIdCalls = 0;
  const client = createMutationClient({
    createId: () => {
      createIdCalls += 1;
      return "generated-invalid-authority-operation";
    },
    now: () => LATER,
    send: async (command) => {
      sent.push(command);
      return mutationResultFixture(command);
    }
  });
  const valid = assignedMutationAuthorityFixture();
  const cases = [
    ["null", null],
    ["wrong schema", { ...valid, schema: "other-authority-schema" }],
    ["missing runtime session", { ...valid, runtimeSessionId: "" }],
    ["missing source context", { ...valid, sourceContextId: "" }],
    ["invalid source window", { ...valid, sourceWindowId: -1 }],
    ["missing workspace", { ...valid, workspaceId: "" }],
    ["invalid workspace revision", { ...valid, workspaceRevision: -1 }],
    ["missing runtime assignment", { ...valid, runtimeAssignmentId: "" }],
    ["non-positive assignment epoch", { ...valid, assignmentEpoch: 0 }],
    ["paused assigned workspace", { ...valid, lifecycleState: "paused" }]
  ];

  for (const [label, authority] of cases) {
    const result = await client.submit({
      authority,
      mutationKind: "journal.append",
      payload: structuredClone(mutationCommandFixture().payload)
    });

    assert.equal(result.schema, mutationContract.RUNTIME_WORKSPACE_MUTATION_RESULT_SCHEMA, label);
    assert.equal(result.status, "rejected", label);
    assert.equal(result.reason, "invalid_assigned_authority", label);
    assert.equal(result.errors.length > 0, true, label);
  }

  assert.equal(createIdCalls, 0);
  assert.deepEqual(sent, []);
});

test("D3D-05 client rejects invalid mutation kind or payload before transport", async () => {
  const sent = [];
  const client = createMutationClient({
    createId: () => "generated-invalid-command-operation",
    now: () => LATER,
    send: async (command) => {
      sent.push(command);
      return mutationResultFixture(command);
    }
  });
  const cases = [
    {
      mutationKind: "unknown.mutation",
      payload: structuredClone(mutationCommandFixture().payload)
    },
    {
      mutationKind: "journal.append",
      payload: { record: { entryId: "journal-1" } }
    }
  ];

  for (const input of cases) {
    const result = await client.submit({
      authority: assignedMutationAuthorityFixture(),
      ...input
    });

    assert.equal(result.status, "rejected");
    assert.equal(result.reason, "invalid_command");
    assert.equal(result.errors.length > 0, true);
  }

  assert.deepEqual(sent, []);
});

test("D3D-05 client fails closed on malformed or authority-mismatched transport results", async () => {
  const cases = [
    ["malformed response", () => ({ malformed: true })],
    ["mismatched assignment", (command) => ({
      ...mutationResultFixture(command),
      runtimeAssignmentId: "assignment-other"
    })]
  ];

  for (const [label, responseFor] of cases) {
    const sent = [];
    const client = createMutationClient({
      createId: () => "generated-transport-operation-" + sent.length,
      now: () => LATER,
      send: async (command) => {
        sent.push(structuredClone(command));
        return responseFor(command);
      }
    });

    const result = await client.submit({
      authority: assignedMutationAuthorityFixture(),
      mutationKind: "journal.append",
      payload: structuredClone(mutationCommandFixture().payload)
    });

    assert.equal(sent.length, 1, label);
    assert.equal(result.status, "failed", label);
    assert.equal(result.reason, "transport_result_invalid", label);
    assert.equal(
      mutationContract.validateRuntimeWorkspaceMutationResult(
        result,
        mutationResultExpectation(sent[0])
      ).valid,
      true,
      label
    );
  }
});

test("D3D-05 authorized handler exposes only the additive mutation route identity", () => {
  createMutationHandler();
  assert.equal(
    typeof mutationServiceWorkerHandler.isRuntimeWorkspaceMutationMessage,
    "function"
  );
  assert.equal(
    mutationServiceWorkerHandler.isRuntimeWorkspaceMutationMessage({
      type: mutationContract.RUNTIME_WORKSPACE_MUTATION_TYPE
    }),
    true
  );
  assert.equal(
    mutationServiceWorkerHandler.isRuntimeWorkspaceMutationMessage({
      schema: mutationContract.RUNTIME_WORKSPACE_MUTATION_COMMAND_SCHEMA
    }),
    true
  );

  for (const legacyRoute of [
    { type: "constellation-runtime-workspace-activation" },
    { type: "constellation-runtime-context-register" },
    { schema: "constellation-journal-append-request-v0.1" },
    { schema: "constellation-workspace-membership-add-request-v0.1" },
    { schema: "constellation-workspace-automatic-promotion-request-v0.1" },
    { type: "constellation-workspace-manual-placement" },
    { type: "constellation-runtime-window-binding-resolve" },
    { type: "constellation-reconcile-workspace-projection" }
  ]) {
    assert.equal(
      mutationServiceWorkerHandler.isRuntimeWorkspaceMutationMessage(legacyRoute),
      false,
      JSON.stringify(legacyRoute)
    );
  }
});

test("D3D-05 handler rejects unauthorized sender and malformed command before adapter or coordinator work", () => {
  const handle = createMutationHandler();
  const command = mutationCommandFixture();
  const malformedCommand = mutationCommandFixture({ payload: {} });
  const responses = [];
  let adapterCalls = 0;
  let coordinatorCalls = 0;
  const options = {
    chromeApi: { marker: "unused" },
    runtimeId: "extension-id",
    sidePanelUrl: SIDE_PANEL_URL,
    createAdapters: () => {
      adapterCalls += 1;
      return {};
    },
    coordinate: () => {
      coordinatorCalls += 1;
      return mutationResultFixture(command);
    }
  };

  const unauthorizedReturn = handle(
    command,
    authorizedMutationSender({ id: "other-extension" }),
    (result) => responses.push(result),
    options
  );
  const malformedReturn = handle(
    malformedCommand,
    authorizedMutationSender(),
    (result) => responses.push(result),
    options
  );

  assert.equal(unauthorizedReturn, false);
  assert.equal(malformedReturn, false);
  assert.equal(adapterCalls, 0);
  assert.equal(coordinatorCalls, 0);
  assert.equal(responses.length, 2);
  for (const result of responses) {
    assert.equal(result.status, "rejected");
    assert.equal(
      mutationContract.validateRuntimeWorkspaceMutationResult(
        result,
        mutationResultExpectation(command)
      ).valid,
      true
    );
  }
});

test("D3D-05 handler builds injected Task-3 adapters, uses the Task-2 coordinator, and responds once", async () => {
  const handle = createMutationHandler();
  const command = mutationCommandFixture({ operationId: "handler-coordination-1" });
  const fixture = mutationAdaptersFixture();
  const chromeApi = { marker: "chrome-api" };
  const adapterInputs = [];
  const responses = [];
  let resolveResponse;
  const responseDone = new Promise((resolve) => {
    resolveResponse = resolve;
  });

  const asynchronous = handle(
    command,
    authorizedMutationSender(),
    (result) => {
      responses.push(result);
      resolveResponse(result);
    },
    {
      chromeApi,
      runtimeId: "extension-id",
      sidePanelUrl: SIDE_PANEL_URL,
      createAdapters: (receivedChromeApi) => {
        adapterInputs.push(receivedChromeApi);
        return fixture.adapters;
      }
    }
  );
  const result = await responseDone;

  assert.equal(asynchronous, true);
  assert.deepEqual(adapterInputs, [chromeApi]);
  assert.equal(responses.length, 1);
  assert.equal(result.status, "committed");
  assertCoordinatorResult(result, command);
});

test("D3D-05 handler fails closed for adapter, coordination, and malformed-result failures without duplicate responses", async () => {
  const handle = createMutationHandler();
  const command = mutationCommandFixture({ operationId: "handler-failures-1" });
  const setupResponses = [];
  const setupReturn = handle(
    command,
    authorizedMutationSender(),
    (result) => setupResponses.push(result),
    {
      chromeApi: {},
      runtimeId: "extension-id",
      sidePanelUrl: SIDE_PANEL_URL,
      createAdapters: () => {
        throw new Error("adapter unavailable");
      }
    }
  );

  assert.equal(setupReturn, false);
  assert.equal(setupResponses.length, 1);
  assert.equal(setupResponses[0].status, "failed");
  assert.equal(setupResponses[0].reason, "adapter_creation_failed");
  assert.equal(
    mutationContract.validateRuntimeWorkspaceMutationResult(
      setupResponses[0],
      mutationResultExpectation(command)
    ).valid,
    true
  );

  for (const [label, coordinate] of [
    ["coordination failure", async () => { throw new Error("coordination failed"); }],
    ["malformed result", async () => ({ malformed: true })]
  ]) {
    const responses = [];
    let resolveResponse;
    const responseDone = new Promise((resolve) => {
      resolveResponse = resolve;
    });
    const asynchronous = handle(
      command,
      authorizedMutationSender(),
      (result) => {
        responses.push(result);
        resolveResponse(result);
      },
      {
        chromeApi: {},
        runtimeId: "extension-id",
        sidePanelUrl: SIDE_PANEL_URL,
        createAdapters: () => ({ marker: "adapters" }),
        coordinate
      }
    );
    const result = await responseDone;

    assert.equal(asynchronous, true, label);
    assert.equal(responses.length, 1, label);
    assert.equal(result.status, "failed", label);
    assert.equal(
      mutationContract.validateRuntimeWorkspaceMutationResult(
        result,
        mutationResultExpectation(command)
      ).valid,
      true,
      label
    );
  }
});

test("D3D-05 service-worker route is additive and precedes legacy journal and reconciliation fallthrough", async () => {
  const source = await readFile(
    new URL("../../src/background/service-worker.js", import.meta.url),
    "utf8"
  );
  const handlerImport = source.indexOf(
    "runtime-workspace-mutation/service-worker-handler.js"
  );
  const route = source.indexOf("if (isRuntimeWorkspaceMutationMessage(message))");
  const handlerCall = source.indexOf(
    "handleRuntimeWorkspaceMutationMessage(message",
    route
  );
  const legacyJournalRoute = source.indexOf(
    "if (message?.schema === JOURNAL_APPEND_REQUEST_SCHEMA)"
  );
  const reconciliationFallthrough = source.indexOf(
    "const messageType = String(message?.type || \"\");"
  );

  assert.ok(handlerImport >= 0);
  assert.ok(route >= 0);
  assert.ok(handlerCall > route);
  assert.ok(legacyJournalRoute > route);
  assert.ok(reconciliationFallthrough > legacyJournalRoute);
});

function assignedJournalRequestFixture(overrides = {}) {
  return structuredClone({
    schema: "constellation-journal-append-request-v0.2",
    operationId: "assigned-journal-operation-1",
    runtimeSessionId: "runtime-session-1",
    sourceContextId: "context-10",
    sourceWindowId: 10,
    workspaceId: "workspace-alpha",
    expectedWorkspaceRevision: 7,
    runtimeAssignmentId: "assignment-alpha",
    assignmentEpoch: 1,
    requestedAt: NOW,
    entry: {
      entryId: "assigned-journal-entry-1",
      text: "Scoped journal note",
      tag: "",
      relatedRoleId: "",
      relatedRoleLabel: "",
      createdAt: NOW
    },
    ...overrides
  });
}

function createAssignedJournalResponse(request, overrides = {}) {
  assert.ok(
    assignedJournalContract,
    "D3D-05 assigned journal contract module must load"
  );
  assert.equal(
    typeof assignedJournalContract.assignedResponse,
    "function",
    "D3D-05 assigned journal contract must create total v0.2 responses"
  );
  return assignedJournalContract.assignedResponse(request, {
    status: "committed",
    reason: "",
    previousRevision: request.expectedWorkspaceRevision,
    committedRevision: request.expectedWorkspaceRevision + 1,
    recordFingerprint: "assigned-record-fingerprint-8",
    phase: "complete",
    mutationCommitted: true,
    authorityVerified: true,
    workspaceVerified: true,
    ledgerRecorded: true,
    retrySafe: false,
    indeterminate: false,
    warnings: [],
    errors: [],
    ...overrides
  });
}

function assertAssignedJournalResponse(result, request) {
  assert.ok(
    assignedJournalContract,
    "D3D-05 assigned journal contract module must load"
  );
  assert.equal(
    typeof assignedJournalContract.validateAssignedJournalAppendResponse,
    "function",
    "D3D-05 assigned journal contract must validate v0.2 responses"
  );
  const validation = assignedJournalContract.validateAssignedJournalAppendResponse(
    result,
    request
  );
  assert.equal(validation.valid, true, validation.errors.join("; "));
}

test("D3D-05 assigned journal v0.2 contract accepts one exact request and total response", () => {
  assert.ok(
    assignedJournalContract,
    "D3D-05 assigned journal contract module must load"
  );
  assert.equal(
    assignedJournalContract.JOURNAL_APPEND_ASSIGNED_REQUEST_SCHEMA,
    "constellation-journal-append-request-v0.2"
  );
  assert.equal(
    assignedJournalContract.JOURNAL_APPEND_ASSIGNED_RESPONSE_SCHEMA,
    "constellation-journal-append-response-v0.2"
  );
  assert.equal(
    typeof assignedJournalContract.validateAssignedJournalAppendRequest,
    "function"
  );

  const request = assignedJournalRequestFixture();
  const validation =
    assignedJournalContract.validateAssignedJournalAppendRequest(request);

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.errors, []);

  const response = createAssignedJournalResponse(request);
  assert.deepEqual(response, {
    schema: "constellation-journal-append-response-v0.2",
    status: "committed",
    reason: "",
    operationId: "assigned-journal-operation-1",
    runtimeSessionId: "runtime-session-1",
    sourceContextId: "context-10",
    sourceWindowId: 10,
    workspaceId: "workspace-alpha",
    runtimeAssignmentId: "assignment-alpha",
    assignmentEpoch: 1,
    entryId: "assigned-journal-entry-1",
    previousRevision: 7,
    committedRevision: 8,
    recordFingerprint: "assigned-record-fingerprint-8",
    phase: "complete",
    mutationCommitted: true,
    authorityVerified: true,
    workspaceVerified: true,
    ledgerRecorded: true,
    retrySafe: false,
    indeterminate: false,
    warnings: [],
    errors: []
  });
  assertAssignedJournalResponse(response, request);
  assert.equal(
    assignedJournalContract.validateAssignedJournalAppendResponse(
      { ...response, unexpected: true },
      request
    ).valid,
    false
  );
});

test("D3D-05 assigned journal v0.2 rejects authority, revision, entry, and field violations", () => {
  assert.ok(
    assignedJournalContract,
    "D3D-05 assigned journal contract module must load"
  );
  assert.equal(
    typeof assignedJournalContract.validateAssignedJournalAppendRequest,
    "function"
  );

  const required = [
    "operationId",
    "runtimeSessionId",
    "sourceContextId",
    "sourceWindowId",
    "workspaceId",
    "expectedWorkspaceRevision",
    "runtimeAssignmentId",
    "assignmentEpoch",
    "requestedAt",
    "entry"
  ];

  for (const field of required) {
    const request = assignedJournalRequestFixture();
    delete request[field];
    assert.equal(
      assignedJournalContract.validateAssignedJournalAppendRequest(request).valid,
      false,
      field
    );
  }

  const invalidCases = [
    assignedJournalRequestFixture({ expectedWorkspaceRevision: -1 }),
    assignedJournalRequestFixture({ expectedWorkspaceRevision: 1.5 }),
    assignedJournalRequestFixture({ assignmentEpoch: 0 }),
    assignedJournalRequestFixture({ assignmentEpoch: 1.5 }),
    assignedJournalRequestFixture({ sourceWindowId: -1 }),
    assignedJournalRequestFixture({ requestedAt: "invalid-date" }),
    assignedJournalRequestFixture({
      entry: {
        entryId: "assigned-journal-entry-1",
        text: "",
        tag: "",
        relatedRoleId: "",
        relatedRoleLabel: "",
        createdAt: NOW
      }
    }),
    assignedJournalRequestFixture({
      entry: {
        entryId: "assigned-journal-entry-1",
        text: "Scoped journal note",
        tag: "",
        relatedRoleId: "",
        relatedRoleLabel: "",
        createdAt: NOW,
        unexpected: true
      }
    }),
    assignedJournalRequestFixture({ unexpected: true })
  ];

  for (const request of invalidCases) {
    assert.equal(
      assignedJournalContract.validateAssignedJournalAppendRequest(request).valid,
      false,
      JSON.stringify(request)
    );
  }
});

test("D3D-05 assigned journal translates one exact request through the scoped journal.append command", async () => {
  assert.ok(
    assignedJournalCoordinator,
    "D3D-05 assigned journal coordinator module must load"
  );
  assert.equal(
    typeof assignedJournalCoordinator.coordinateAssignedJournalAppend,
    "function"
  );

  const request = assignedJournalRequestFixture();
  const fake = mutationAdaptersFixture();
  const result =
    await assignedJournalCoordinator.coordinateAssignedJournalAppend(
      request,
      fake.adapters
    );

  assert.equal(result.schema, "constellation-journal-append-response-v0.2");
  assert.equal(result.status, "committed");
  assert.equal(result.operationId, request.operationId);
  assert.equal(result.runtimeSessionId, request.runtimeSessionId);
  assert.equal(result.sourceContextId, request.sourceContextId);
  assert.equal(result.sourceWindowId, request.sourceWindowId);
  assert.equal(result.workspaceId, request.workspaceId);
  assert.equal(result.runtimeAssignmentId, request.runtimeAssignmentId);
  assert.equal(result.assignmentEpoch, request.assignmentEpoch);
  assert.equal(result.entryId, request.entry.entryId);
  assert.equal(result.previousRevision, request.expectedWorkspaceRevision);
  assert.equal(result.committedRevision, request.expectedWorkspaceRevision + 1);
  assertAssignedJournalResponse(result, request);
  assert.deepEqual(fake.record.workspace.journal, [request.entry]);
  assert.equal(fake.lockPlans.length, 1);
  assert.equal(
    fake.lockPlans[0].includes("constellation-runtime-state-v0.1"),
    false
  );

  const source = await readFile(
    new URL(
      "../../src/core/journal-append-coordination/coordinator.js",
      import.meta.url
    ),
    "utf8"
  );
  const assignedSection = source.slice(
    source.indexOf("export async function coordinateAssignedJournalAppend")
  );
  assert.match(assignedSection, /mutationKind\s*:\s*"journal\.append"/);
  assert.match(
    assignedSection,
    /payload\s*:\s*\{\s*record\s*:\s*request\.entry\s*\}/
  );
  assert.match(
    assignedSection,
    /coordinateRuntimeWorkspaceMutation\s*\(/
  );
  assert.doesNotMatch(assignedSection, /coordinateJournalAppend\s*\(/);
  assert.doesNotMatch(
    assignedSection,
    /withRuntimeStateLock|readLatestActiveWorkspace|compatibility|runtime-state-v0\.1/
  );
});

test("D3D-05 assigned journal fails closed when the scoped mutation result is malformed", async () => {
  assert.ok(
    assignedJournalCoordinator,
    "D3D-05 assigned journal coordinator module must load"
  );
  assert.equal(
    typeof assignedJournalCoordinator.coordinateAssignedJournalAppend,
    "function"
  );

  const request = assignedJournalRequestFixture({
    operationId: "assigned-journal-malformed-result-1"
  });
  const fake = mutationAdaptersFixture();
  const result =
    await assignedJournalCoordinator.coordinateAssignedJournalAppend(request, {
      ...fake.adapters,
      async withScopedLocks() {
        return { malformed: true };
      }
    });

  assert.equal(result.status, "failed");
  assert.equal(result.reason, "mutation_result_invalid");
  assert.equal(result.retrySafe, true);
  assert.equal(result.operationId, request.operationId);
  assert.equal(result.runtimeAssignmentId, request.runtimeAssignmentId);
  assert.equal(result.assignmentEpoch, request.assignmentEpoch);
  assertAssignedJournalResponse(result, request);
  assert.equal(fake.recordWrites, 0);
  assert.equal(fake.ledgerWrites, 0);
});

test("D3D-05 journal client retains legacy construction while sending verified assigned authority as v0.2", async () => {
  assert.ok(
    assignedJournalClient,
    "D3D-05 journal client module must load"
  );
  assert.equal(
    typeof assignedJournalClient.createJournalAppendClient,
    "function"
  );

  const legacySent = [];
  const legacyClient = assignedJournalClient.createJournalAppendClient({
    createId: (() => {
      const ids = ["legacy-context-1", "legacy-operation-1", "legacy-entry-1"];
      return () => ids.shift();
    })(),
    now: () => NOW,
    send: async (request) => {
      legacySent.push(structuredClone(request));
      return assignedJournalContract.response(request, "committed", {
        previousRevision: 7,
        committedRevision: 8,
        workspaceCommitted: true,
        workspaceVerified: true,
        ledgerRecorded: true
      });
    },
    refresh: async () => {},
    clear: () => {},
    status: () => {}
  });
  const legacyResult = await legacyClient.submit({
    workspaceId: "workspace-alpha",
    entry: {
      text: "Legacy journal note",
      tag: "",
      relatedRoleId: "",
      relatedRoleLabel: "",
      createdAt: NOW
    }
  });

  assert.equal(legacyResult.schema, "constellation-journal-append-response-v0.1");
  assert.deepEqual(legacySent, [{
    schema: "constellation-journal-append-request-v0.1",
    operationId: "legacy-operation-1",
    contextId: "legacy-context-1",
    workspaceId: "workspace-alpha",
    requestedAt: NOW,
    entry: {
      entryId: "legacy-entry-1",
      text: "Legacy journal note",
      tag: "",
      relatedRoleId: "",
      relatedRoleLabel: "",
      createdAt: NOW
    }
  }]);

  const authority = assignedMutationAuthorityFixture();
  const authorityBefore = structuredClone(authority);
  const assignedSent = [];
  const assignedClient = assignedJournalClient.createJournalAppendClient({
    createId: (() => {
      const ids = ["assigned-operation-1", "assigned-entry-1"];
      return () => ids.shift();
    })(),
    now: () => LATER,
    send: async (request) => {
      assignedSent.push(structuredClone(request));
      return createAssignedJournalResponse(request);
    },
    refresh: async () => {},
    clear: () => {},
    status: () => {}
  });
  const assignedResult = await assignedClient.submit({
    authority,
    entry: {
      text: "Assigned journal note",
      tag: "",
      relatedRoleId: "",
      relatedRoleLabel: "",
      createdAt: NOW
    }
  });

  assert.deepEqual(authority, authorityBefore);
  assert.deepEqual(assignedSent, [assignedJournalRequestFixture({
    operationId: "assigned-operation-1",
    requestedAt: LATER,
    entry: {
      entryId: "assigned-entry-1",
      text: "Assigned journal note",
      tag: "",
      relatedRoleId: "",
      relatedRoleLabel: "",
      createdAt: NOW
    }
  })]);
  assert.equal(
    assignedResult.schema,
    "constellation-journal-append-response-v0.2"
  );
  assert.equal(assignedResult.runtimeAssignmentId, authority.runtimeAssignmentId);
  assert.equal(assignedResult.assignmentEpoch, authority.assignmentEpoch);
  assertAssignedJournalResponse(assignedResult, assignedSent[0]);
});

test("D3D-05 assigned journal client fails closed on a malformed v0.2 transport result", async () => {
  assert.ok(
    assignedJournalClient,
    "D3D-05 journal client module must load"
  );
  assert.equal(
    typeof assignedJournalClient.createJournalAppendClient,
    "function"
  );

  const sent = [];
  const client = assignedJournalClient.createJournalAppendClient({
    createId: (() => {
      const ids = ["assigned-failure-operation-1", "assigned-failure-entry-1"];
      return () => ids.shift();
    })(),
    now: () => LATER,
    send: async (request) => {
      sent.push(structuredClone(request));
      return { malformed: true };
    },
    refresh: async () => {},
    clear: () => {},
    status: () => {}
  });

  const result = await client.submit({
    authority: assignedMutationAuthorityFixture(),
    entry: {
      text: "Assigned journal failure note",
      tag: "",
      relatedRoleId: "",
      relatedRoleLabel: "",
      createdAt: NOW
    }
  });

  assert.equal(sent.length, 1);
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "malformed_or_mismatched_response");
  assert.equal(result.operationId, sent[0].operationId);
  assert.equal(result.runtimeAssignmentId, sent[0].runtimeAssignmentId);
  assert.equal(result.assignmentEpoch, sent[0].assignmentEpoch);
  assertAssignedJournalResponse(result, sent[0]);
});

test("D3D-05 assigned workspace reader clones only verified supplied authority without storage I/O", async () => {
  assert.ok(
    assignedJournalReadonlyWorkspace,
    "D3D-05 journal read-only workspace module must load"
  );
  assert.equal(
    typeof assignedJournalReadonlyWorkspace.readAssignedWorkspaceReadonly,
    "function"
  );

  const authority = assignedMutationAuthorityFixture();
  const originalWorkspace = structuredClone(authority.workspace);
  const read = assignedJournalReadonlyWorkspace.readAssignedWorkspaceReadonly(
    authority
  );

  assert.equal(read.ok, true);
  assert.deepEqual(read.workspace, originalWorkspace);
  assert.notStrictEqual(read.workspace, authority.workspace);
  read.workspace.name = "Changed cloned value only";
  assert.deepEqual(authority.workspace, originalWorkspace);

  const invalid = assignedJournalReadonlyWorkspace.readAssignedWorkspaceReadonly({
    ...authority,
    lifecycleState: "paused"
  });
  assert.deepEqual(invalid, { ok: false, reason: "invalid_assigned_authority" });

  const source = await readFile(
    new URL(
      "../../src/core/journal-append-coordination/readonly-workspace.js",
      import.meta.url
    ),
    "utf8"
  );
  const assignedSection = source.slice(
    source.indexOf("export function readAssignedWorkspaceReadonly"),
    source.indexOf("export function equivalentWorkspace")
  );
  assert.doesNotMatch(
    assignedSection,
    /readCompatibleStorageValue|writeCompatibleStorageValue|chrome\.storage|\.get\(|\.set\(/
  );
});

test("D3D-05 assigned journal adapter and service-worker route use only the scoped v0.2 path", async () => {
  assert.ok(
    assignedJournalChromeAdapter,
    "D3D-05 journal chrome adapter module must load"
  );
  assert.equal(
    typeof assignedJournalChromeAdapter.createChromeAssignedJournalAdapters,
    "function"
  );

  const adapters =
    assignedJournalChromeAdapter.createChromeAssignedJournalAdapters({});
  assert.equal(typeof adapters.withScopedLocks, "function");
  assert.equal(Object.hasOwn(adapters, "withRuntimeStateLock"), false);
  assert.doesNotMatch(
    String(assignedJournalChromeAdapter.createChromeAssignedJournalAdapters),
    /compatibility|withRuntimeStateLock|readLatestActiveWorkspace/
  );

  const source = await readFile(
    new URL("../../src/background/service-worker.js", import.meta.url),
    "utf8"
  );
  const assignedImport = source.indexOf(
    "JOURNAL_APPEND_ASSIGNED_REQUEST_SCHEMA"
  );
  const assignedRoute = source.indexOf(
    "if (message?.schema === JOURNAL_APPEND_ASSIGNED_REQUEST_SCHEMA)"
  );
  const assignedCoordinator = source.indexOf(
    "coordinateAssignedJournalAppend(message",
    assignedRoute
  );
  const assignedAdapters = source.indexOf(
    "createChromeAssignedJournalAdapters(chrome)",
    assignedRoute
  );
  const mutationRoute = source.indexOf(
    "if (isRuntimeWorkspaceMutationMessage(message))"
  );
  const legacyRoute = source.indexOf(
    "if (message?.schema === JOURNAL_APPEND_REQUEST_SCHEMA)"
  );
  const legacyCoordinator = source.indexOf(
    "coordinateJournalAppend(message, createChromeJournalAdapters(chrome))",
    legacyRoute
  );

  assert.ok(assignedImport >= 0);
  assert.ok(assignedRoute > mutationRoute);
  assert.ok(assignedCoordinator > assignedRoute);
  assert.ok(assignedAdapters > assignedRoute);
  assert.ok(legacyRoute > assignedRoute);
  assert.ok(legacyCoordinator > legacyRoute);
});

test("D3D-05 Task-6 R1 keeps a verified assigned autosave successful when its success diagnostic fails", async () => {
  const originalChrome = globalThis.chrome;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const stored = new Map();
  const persistedDiagnosticActions = [];
  const mutationCommands = [];
  const bindingRevisions = [];
  let resolveFirstDiagnosticFailure;
  const firstDiagnosticFailure = new Promise((resolve) => {
    resolveFirstDiagnosticFailure = resolve;
  });
  let rejectFirstDiagnosticWrite = true;

  const createInput = (value) => {
    const listeners = new Map();
    return {
      value,
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      dispatch(type) {
        const listener = listeners.get(type);
        if (typeof listener !== "function") throw new Error("Missing input listener: " + type);
        return listener();
      }
    };
  };

  const workspaceNameInput = createInput("Verified metadata name");
  const workspaceAimInput = createInput("Verified metadata aim");
  const workspaceTypeSelect = createInput("research");

  globalThis.document = {
    getElementById(id) {
      return {
        workspaceName: workspaceNameInput,
        workspaceAim: workspaceAimInput,
        workspaceType: workspaceTypeSelect
      }[id] || null;
    }
  };
  globalThis.window = { addEventListener: () => undefined };
  globalThis.chrome = {
    windows: {
      getCurrent: async () => ({ id: 10 })
    },
    runtime: {
      sendMessage: async (request) => {
        if (request.type === "constellation-runtime-context-register") {
          return createContextResult({
            ...request,
            status: "no_change",
            runtimeSessionId: "runtime-session-1",
            authorityRevision: 1,
            authorityCommitted: false,
            authorityVerified: true,
            context: {
              contextId: request.contextId,
              contextType: "side_panel",
              windowId: request.windowId,
              createdAt: NOW,
              sourceUrl: SIDE_PANEL_URL
            }
          });
        }

        if (request.type === WINDOW_BINDING_RESOLVE_TYPE) {
          const workspaceRevision = bindingRevisions.length === 0 ? 7 : 8;
          bindingRevisions.push(workspaceRevision);
          return createWindowBindingResolveResult(request, {
            status: "assigned",
            phase: "complete",
            workspaceId: "workspace-alpha",
            workspaceRevision,
            runtimeAssignmentId: "assignment-alpha",
            assignmentEpoch: 1,
            authorityRevision: workspaceRevision === 7 ? 1 : 2,
            workspace: runtimeMutationWorkspaceFixture({ workspaceRevision }),
            lifecycleState: "available",
            authorityVerified: true,
            workspaceVerified: true
          });
        }

        if (request.type === mutationContract.RUNTIME_WORKSPACE_MUTATION_TYPE) {
          mutationCommands.push(structuredClone(request));
          return mutationResultFixture(request);
        }

        throw new Error("Unexpected runtime request: " + request.type);
      }
    },
    storage: {
      local: {
        async get(keys) {
          if (keys == null) return Object.fromEntries(stored.entries());
          const requestedKeys = Array.isArray(keys)
            ? keys
            : typeof keys === "string"
              ? [keys]
              : Object.keys(keys);
          return Object.fromEntries(
            requestedKeys
              .filter((key) => stored.has(key))
              .map((key) => [key, structuredClone(stored.get(key))])
          );
        },
        async set(values) {
          const entries = Object.entries(values);
          const diagnosticEntries = entries.filter(([key]) =>
            key.startsWith("constellationDiagnosticEvent:") ||
            key.startsWith("chromeFlowDiagnosticEvent:")
          );
          if (diagnosticEntries.length && rejectFirstDiagnosticWrite) {
            rejectFirstDiagnosticWrite = false;
            resolveFirstDiagnosticFailure();
            throw new Error("diagnostic sink unavailable");
          }

          for (const [key, value] of entries) stored.set(key, structuredClone(value));
          for (const [key, value] of diagnosticEntries) {
            if (key.startsWith("constellationDiagnosticEvent:")) {
              persistedDiagnosticActions.push(value.action);
            }
          }
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) stored.delete(key);
        }
      }
    }
  };

  try {
    const metadataAutosave = await import(
      "../../src/sidepanel/workspace-metadata-autosave.js"
    );

    workspaceNameInput.dispatch("blur");
    await firstDiagnosticFailure;
    await metadataAutosave.runWithWorkspaceMetadataWriter(async () => ({
      ok: true,
      status: "barrier_drained"
    }));

    assert.deepEqual(bindingRevisions, [7, 8]);
    assert.deepEqual(mutationCommands.map((command) => ({
      expectedWorkspaceRevision: command.expectedWorkspaceRevision,
      mutationKind: command.mutationKind,
      payload: command.payload
    })), [{
      expectedWorkspaceRevision: 7,
      mutationKind: "workspace.metadata.autosave",
      payload: {
        name: "Verified metadata name",
        aim: "Verified metadata aim"
      }
    }]);
    assert.deepEqual(
      persistedDiagnosticActions,
      [],
      "a failed success diagnostic must not turn a verified autosave into barrier failure evidence"
    );
  } finally {
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("D3D-05 Task-6 explicit assigned runtime read clones only exact writable D3D-04 authority", async () => {
  const runtimeStore = await import(
    "../../src/core/workspace-runtime-store.js"
  );

  assert.equal(
    typeof runtimeStore.readAssignedWorkspaceRuntime,
    "function",
    "Task-6 must expose one explicit assigned runtime reader"
  );
  for (const legacyExport of [
    "getActiveWorkspaceRuntime",
    "saveActiveWorkspaceRuntime",
    "appendActiveWorkspaceJournalEntry",
    "appendActiveWorkspaceTimelineEvent"
  ]) {
    assert.equal(typeof runtimeStore[legacyExport], "function", legacyExport);
  }

  const authority = assignedMutationAuthorityFixture();
  const authorityBefore = structuredClone(authority);
  const read = runtimeStore.readAssignedWorkspaceRuntime(authority);

  assert.deepEqual(read, {
    ok: true,
    workspaceId: "workspace-alpha",
    workspaceRevision: 7,
    workspace: authorityBefore.workspace
  });
  assert.notStrictEqual(read.workspace, authority.workspace);
  read.workspace.name = "Detached assigned snapshot";
  assert.deepEqual(authority, authorityBefore);

  const mismatchWorkspace = structuredClone(authority);
  mismatchWorkspace.workspace.workspaceId = "workspace-beta";
  const mismatchRevision = structuredClone(authority);
  mismatchRevision.workspace.workspaceRevision = 8;
  for (const invalidAuthority of [
    null,
    { ...authority, schema: "wrong-assigned-authority-schema" },
    { ...authority, lifecycleState: "paused" },
    mismatchWorkspace,
    mismatchRevision,
    { ...authority, assignmentEpoch: 0 }
  ]) {
    assert.deepEqual(
      runtimeStore.readAssignedWorkspaceRuntime(invalidAuthority),
      { ok: false, reason: "invalid_assigned_authority" }
    );
  }
});

test("D3D-05 Task-6 assigned metadata gateway resolves fresh authority for each semantic mutation", async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  globalThis.document = { getElementById: () => null };
  globalThis.window = { addEventListener: () => undefined };

  let metadataAutosave;
  try {
    metadataAutosave = await import(
      "../../src/sidepanel/workspace-metadata-autosave.js"
    );
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }

  assert.equal(
    typeof metadataAutosave.createAssignedWorkspaceMetadataMutationGateway,
    "function",
    "Task-6 must provide the assigned metadata mutation gateway"
  );

  const authority7 = assignedMutationAuthorityFixture();
  const authority8 = assignedMutationAuthorityFixture({
    workspaceRevision: 8,
    workspace: runtimeMutationWorkspaceFixture({ workspaceRevision: 8 })
  });
  const authority9 = assignedMutationAuthorityFixture({
    workspaceRevision: 9,
    workspace: runtimeMutationWorkspaceFixture({ workspaceRevision: 9 })
  });
  const authorityStates = [
    { status: "assigned", reason: "", authority: authority7 },
    { status: "assigned", reason: "", authority: authority8 },
    { status: "assigned", reason: "", authority: authority8 },
    { status: "assigned", reason: "", authority: authority9 }
  ];
  const sent = [];
  const mutationClient = createMutationClient({
    createId: (() => {
      const values = ["autosave-operation-1", "save-operation-2"];
      return () => values.shift();
    })(),
    now: () => LATER,
    send: async (command) => {
      sent.push(structuredClone(command));
      return mutationResultFixture(command);
    }
  });
  let resolveCalls = 0;
  const gateway = metadataAutosave.createAssignedWorkspaceMetadataMutationGateway({
    resolveAuthority: async () => structuredClone(authorityStates[resolveCalls++]),
    mutationClient
  });

  const autosave = await gateway.submitAutosave({
    name: "Latest typed name",
    aim: "Latest typed aim"
  });
  const save = await gateway.submitCommit({
    mode: "save",
    name: "Latest typed name",
    aim: "Latest typed aim",
    workspaceType: "research",
    eventId: "workspace-save-event-1"
  });

  assert.equal(autosave.ok, true);
  assert.equal(save.ok, true);
  assert.equal(resolveCalls, 4);
  assert.deepEqual(sent.map((command) => ({
    expectedWorkspaceRevision: command.expectedWorkspaceRevision,
    mutationKind: command.mutationKind,
    payload: command.payload
  })), [
    {
      expectedWorkspaceRevision: 7,
      mutationKind: "workspace.metadata.autosave",
      payload: { name: "Latest typed name", aim: "Latest typed aim" }
    },
    {
      expectedWorkspaceRevision: 8,
      mutationKind: "workspace.metadata.commit",
      payload: {
        mode: "save",
        name: "Latest typed name",
        aim: "Latest typed aim",
        workspaceType: "research",
        eventId: "workspace-save-event-1"
      }
    }
  ]);
  assert.equal(authority7.workspaceRevision, 7);
  assert.equal(authority8.workspaceRevision, 8);
});

test("D3D-05 Task-6 metadata gateway fails closed without sends when fresh authority is not assigned writable", async () => {
  const metadataAutosave = await import(
    "../../src/sidepanel/workspace-metadata-autosave.js"
  );
  assert.equal(
    typeof metadataAutosave.createAssignedWorkspaceMetadataMutationGateway,
    "function"
  );

  for (const state of [
    { status: "unbound", reason: "window_unbound", authority: null },
    { status: "read_only", reason: "assigned_elsewhere", authority: null },
    { status: "blocked", reason: "authority_invalid", authority: null }
  ]) {
    let sends = 0;
    const gateway = metadataAutosave.createAssignedWorkspaceMetadataMutationGateway({
      resolveAuthority: async () => structuredClone(state),
      mutationClient: {
        submit: async () => {
          sends += 1;
          throw new Error("unreachable mutation send");
        }
      }
    });

    const result = await gateway.submitAutosave({ name: "Blocked", aim: "No send" });
    assert.equal(result.ok, false, state.status);
    assert.equal(result.status, state.status, state.status);
    assert.equal(sends, 0, state.status);
  }
});

test("D3D-05 Task-6 assigned metadata gateway submits semantic type change without local role or timeline work", async () => {
  const metadataAutosave = await import(
    "../../src/sidepanel/workspace-metadata-autosave.js"
  );
  assert.equal(
    typeof metadataAutosave.createAssignedWorkspaceMetadataMutationGateway,
    "function"
  );

  const authority7 = assignedMutationAuthorityFixture();
  const authority8 = assignedMutationAuthorityFixture({
    workspaceRevision: 8,
    workspace: runtimeMutationWorkspaceFixture({ workspaceRevision: 8 })
  });
  const sent = [];
  const mutationClient = createMutationClient({
    createId: () => "type-change-operation-1",
    now: () => LATER,
    send: async (command) => {
      sent.push(structuredClone(command));
      return mutationResultFixture(command);
    }
  });
  const authorityStates = [
    { status: "assigned", reason: "", authority: authority7 },
    { status: "assigned", reason: "", authority: authority8 }
  ];
  const gateway = metadataAutosave.createAssignedWorkspaceMetadataMutationGateway({
    resolveAuthority: async () => structuredClone(authorityStates.shift()),
    mutationClient
  });

  const result = await gateway.submitCommit({
    mode: "type_change",
    name: "Changed type workspace",
    aim: "Retain latest metadata",
    workspaceType: "planning",
    eventId: "workspace-type-event-1"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(sent.map((command) => ({
    expectedWorkspaceRevision: command.expectedWorkspaceRevision,
    mutationKind: command.mutationKind,
    payload: command.payload
  })), [{
    expectedWorkspaceRevision: 7,
    mutationKind: "workspace.metadata.commit",
    payload: {
      mode: "type_change",
      name: "Changed type workspace",
      aim: "Retain latest metadata",
      workspaceType: "planning",
      eventId: "workspace-type-event-1"
    }
  }]);
});

test("D3D-05 Task-6 metadata barrier flushes older autosave before the latest assigned Save command", async () => {
  const metadataAutosave = await import(
    "../../src/sidepanel/workspace-metadata-autosave.js"
  );
  assert.equal(
    typeof metadataAutosave.createAssignedWorkspaceMetadataMutationGateway,
    "function"
  );
  const metadataBarrier = await import(
    "../../src/sidepanel/workspace-metadata-barrier.js"
  );

  const authority7 = assignedMutationAuthorityFixture();
  const authority8 = assignedMutationAuthorityFixture({
    workspaceRevision: 8,
    workspace: runtimeMutationWorkspaceFixture({ workspaceRevision: 8 })
  });
  const authority9 = assignedMutationAuthorityFixture({
    workspaceRevision: 9,
    workspace: runtimeMutationWorkspaceFixture({ workspaceRevision: 9 })
  });
  const authorityStates = [
    { status: "assigned", reason: "", authority: authority7 },
    { status: "assigned", reason: "", authority: authority8 },
    { status: "assigned", reason: "", authority: authority8 },
    { status: "assigned", reason: "", authority: authority9 }
  ];
  const sent = [];
  const mutationClient = createMutationClient({
    createId: (() => {
      const values = ["barrier-autosave-1", "barrier-save-2"];
      return () => values.shift();
    })(),
    now: () => LATER,
    send: async (command) => {
      sent.push(structuredClone(command));
      return mutationResultFixture(command);
    }
  });
  const gateway = metadataAutosave.createAssignedWorkspaceMetadataMutationGateway({
    resolveAuthority: async () => structuredClone(authorityStates.shift()),
    mutationClient
  });
  const barrier = metadataBarrier.createWorkspaceMetadataBarrier({
    commitSnapshot: (snapshot) => gateway.submitAutosave(snapshot)
  });
  let latestSnapshot = {
    name: "Latest Name",
    aim: "Latest Aim",
    workspaceType: "research"
  };

  await barrier.submit({ name: "Older Name", aim: "Older Aim" }, "autosave");
  await metadataBarrier.runWorkspaceMetadataWriterWithLatestSnapshot(
    barrier,
    () => structuredClone(latestSnapshot),
    (snapshot) => gateway.submitCommit({
      mode: "save",
      name: snapshot.name,
      aim: snapshot.aim,
      workspaceType: snapshot.workspaceType,
      eventId: "barrier-save-event-1"
    })
  );

  assert.deepEqual(sent.map((command) => ({
    expectedWorkspaceRevision: command.expectedWorkspaceRevision,
    mutationKind: command.mutationKind,
    payload: command.payload
  })), [
    {
      expectedWorkspaceRevision: 7,
      mutationKind: "workspace.metadata.autosave",
      payload: { name: "Older Name", aim: "Older Aim" }
    },
    {
      expectedWorkspaceRevision: 8,
      mutationKind: "workspace.metadata.commit",
      payload: {
        mode: "save",
        name: "Latest Name",
        aim: "Latest Aim",
        workspaceType: "research",
        eventId: "barrier-save-event-1"
      }
    }
  ]);
});

test("D3D-05 Task-6 assigned metadata production paths contain no compatibility or global-lock primary business", async () => {
  const [runtimeStoreSource, autosaveSource, sidePanelSource] = await Promise.all([
    readFile(new URL("../../src/core/workspace-runtime-store.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/sidepanel/workspace-metadata-autosave.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/sidepanel/sidepanel.js", import.meta.url), "utf8")
  ]);

  const assignedReadSection = runtimeStoreSource.slice(
    runtimeStoreSource.indexOf("function readAssignedWorkspaceRuntime"),
    runtimeStoreSource.indexOf("async function getLegacyRuntimeArchiveRecords")
  );
  assert.doesNotMatch(
    assignedReadSection,
    /getWorkspace\(|saveWorkspace\(|activeWorkspace|chromeFlowWorkspace|constellationActiveWorkspace/
  );
  assert.doesNotMatch(
    autosaveSource,
    /LOCK_NAMES\.runtimeState|constellation-runtime-state-v0\.1|readCompatibleStorageValue|writeCompatibleStorageValue|navigator\.locks\.request/
  );
  assert.match(autosaveSource, /getSidePanelAssignedWorkspaceAuthority/);
  assert.match(autosaveSource, /createRuntimeWorkspaceMutationClient/);

  const metadataSaveSection = sidePanelSource.slice(
    sidePanelSource.indexOf("async function saveWorkspaceDetails"),
    sidePanelSource.indexOf("async function scanCurrentWindowTabs")
  );
  assert.doesNotMatch(
    metadataSaveSection,
    /saveWorkspaceDetailsAgainstLatest|updateWorkspaceTypeAgainstLatest|createWorkspaceMetadataWriterAdapters|withRuntimeStateLock|readCompatibleStorageValue|writeCompatibleStorageValue|normalizeRolesForWorkspaceType|workspace_type_updated|workspace_saved/
  );
  assert.match(metadataSaveSection, /submitCommit/);
});

test("D3D-05 Task-7 assigned ordinary mutations use fresh exact authority and fail closed before any send", async () => {
  const sidePanelSource = await readFile(
    new URL("../../src/sidepanel/sidepanel.js", import.meta.url),
    "utf8"
  );
  const assignedMigrationStart = sidePanelSource.indexOf("async function validateAssignedWorkspaceTabIdsForStartup");
  const assignedMigrationEnd = sidePanelSource.indexOf(
    "async function renderWorkspace",
    assignedMigrationStart
  );
  assert.ok(assignedMigrationStart >= 0);
  assert.ok(assignedMigrationEnd > assignedMigrationStart);
  assert.doesNotMatch(
    sidePanelSource.slice(assignedMigrationStart, assignedMigrationEnd),
    /crypto\.randomUUID\(\)|getWorkspace\(|saveWorkspace\(/
  );

  const runtimeStore = await import(
    "../../src/core/workspace-runtime-store.js"
  );

  assert.equal(
    typeof runtimeStore.createAssignedWorkspaceRuntimeMutationGateway,
    "function",
    "Task 7 must expose the assigned ordinary panel mutation gateway"
  );
  assert.equal(
    typeof runtimeStore.validateAssignedWorkspaceRuntimeTabIds,
    "function",
    "Task 7 must validate immutable assigned workspace tab identities without repair"
  );

  const authority7 = assignedMutationAuthorityFixture();
  const authority8 = assignedMutationAuthorityFixture({
    workspaceRevision: 8,
    workspace: runtimeMutationWorkspaceFixture({ workspaceRevision: 8 })
  });
  const authority9 = assignedMutationAuthorityFixture({
    workspaceRevision: 9,
    workspace: runtimeMutationWorkspaceFixture({ workspaceRevision: 9 })
  });
  const states = [
    { status: "assigned", reason: "", authority: authority7 },
    { status: "assigned", reason: "", authority: authority8 },
    { status: "assigned", reason: "", authority: authority8 },
    { status: "assigned", reason: "", authority: authority9 }
  ];
  const sent = [];
  const gateway = runtimeStore.createAssignedWorkspaceRuntimeMutationGateway({
    resolveAuthority: async () => structuredClone(states.shift()),
    mutationClient: {
      submit: async (input) => {
        sent.push(structuredClone(input));
        return {
          status: "committed",
          reason: "",
          authorityVerified: true,
          workspaceVerified: true
        };
      }
    },
    createEventId: () => "task7-timeline-event-1",
    now: () => LATER
  });

  const timeline = await gateway.appendTimeline(
    "tabs_scanned",
    "Scanned one tab from the current window.",
    { scannedCount: 1 }
  );
  const alias = await gateway.submit({
    mutationKind: "workspace.tab.metadata.commit",
    payload: {
      workspaceTabId: "workspace-tab-1",
      field: "alias",
      value: "Trimmed alias",
      eventId: "task7-alias-event-1"
    }
  });

  assert.equal(timeline.ok, true);
  assert.equal(timeline.refreshed, true);
  assert.equal(timeline.workspace.workspaceRevision, 8);
  assert.equal(alias.ok, true);
  assert.equal(alias.refreshed, true);
  assert.equal(alias.workspace.workspaceRevision, 9);
  assert.equal(authority7.workspaceRevision, 7, "the panel must not increment a local authority revision");
  assert.equal(authority8.workspaceRevision, 8, "the next mutation must use refreshed D3D-04 authority");
  assert.deepEqual(sent, [
    {
      authority: authority7,
      mutationKind: "timeline.append",
      payload: {
        record: {
          eventId: "task7-timeline-event-1",
          type: "tabs_scanned",
          message: "Scanned one tab from the current window.",
          createdAt: LATER,
          scannedCount: 1
        }
      }
    },
    {
      authority: authority8,
      mutationKind: "workspace.tab.metadata.commit",
      payload: {
        workspaceTabId: "workspace-tab-1",
        field: "alias",
        value: "Trimmed alias",
        eventId: "task7-alias-event-1"
      }
    }
  ]);

  for (const state of [
    { status: "unbound", reason: "window_unbound", authority: null },
    { status: "read_only", reason: "assigned_elsewhere", authority: null },
    { status: "blocked", reason: "binding_blocked", authority: null },
    { status: "failed", reason: "binding_failed", authority: null },
    {
      status: "assigned",
      reason: "",
      authority: assignedMutationAuthorityFixture({ lifecycleState: "paused" })
    }
  ]) {
    let sends = 0;
    const unavailableGateway = runtimeStore.createAssignedWorkspaceRuntimeMutationGateway({
      resolveAuthority: async () => structuredClone(state),
      mutationClient: {
        submit: async () => {
          sends += 1;
          throw new Error("unreachable mutation send");
        }
      }
    });
    const result = await unavailableGateway.submit({
      mutationKind: "timeline.append",
      payload: {
        record: {
          eventId: "blocked-event-1",
          type: "blocked",
          message: "No mutation",
          createdAt: LATER
        }
      }
    });
    assert.equal(result.ok, false, state.status);
    assert.equal(sends, 0, state.status);
  }

  const malformedResultGateway = runtimeStore.createAssignedWorkspaceRuntimeMutationGateway({
    resolveAuthority: async () => ({ status: "assigned", reason: "", authority: authority7 }),
    mutationClient: { submit: async () => ({ status: "committed", authorityVerified: true }) }
  });
  const malformedResult = await malformedResultGateway.submit({
    mutationKind: "timeline.append",
    payload: {
      record: {
        eventId: "malformed-result-event-1",
        type: "blocked",
        message: "Malformed result must fail closed",
        createdAt: LATER
      }
    }
  });
  assert.equal(malformedResult.ok, false);

  const missingIdAuthority = assignedMutationAuthorityFixture({
    workspace: runtimeMutationWorkspaceFixture({
      tabs: [{ tabId: 41, windowId: 10, url: "https://example.test/missing-id" }]
    })
  });
  const missingIdBefore = structuredClone(missingIdAuthority);
  const missingIdRead = runtimeStore.validateAssignedWorkspaceRuntimeTabIds(missingIdAuthority);
  assert.equal(missingIdRead.ok, false);
  assert.equal(missingIdRead.reason, "runtime_workspace_identity_migration_required");
  assert.deepEqual(missingIdAuthority, missingIdBefore, "identity validation must not silently generate or write an ID");
  let missingIdSends = 0;
  const missingIdGateway = runtimeStore.createAssignedWorkspaceRuntimeMutationGateway({
    resolveAuthority: async () => ({ status: "assigned", reason: "", authority: missingIdAuthority }),
    mutationClient: { submit: async () => { missingIdSends += 1; } }
  });
  const missingIdResult = await missingIdGateway.submit({
    mutationKind: "timeline.append",
    payload: {
      record: {
        eventId: "missing-id-event-1",
        type: "blocked",
        message: "Missing immutable tab ID",
        createdAt: LATER
      }
    }
  });
  assert.equal(missingIdResult.reason, "runtime_workspace_identity_migration_required");
  assert.equal(missingIdSends, 0);
});

test("D3D-05 Task-7 migrated side-panel regions retain only mapped ordinary timeline routes and never repair assigned tab identities", async () => {
  const source = await readFile(
    new URL("../../src/sidepanel/sidepanel.js", import.meta.url),
    "utf8"
  );
  const section = (start, end) => {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.ok(startIndex >= 0, start);
    assert.ok(endIndex > startIndex, end);
    return source.slice(startIndex, endIndex);
  };
  const assignedMigration = section(
    "async function validateAssignedWorkspaceTabIdsForStartup",
    "async function renderWorkspace"
  );
  const assignedResolution = section(
    "async function resolveWorkspaceTabsToLiveTabs",
    "async function resolveSingleWorkspaceTabForAction"
  );
  const journal = section(
    "async function saveJournalEntry",
    "function renderWorkspaceTabs"
  );
  const scan = section(
    "async function scanCurrentWindowTabs",
    "async function addSelectedTabsToWorkspace"
  );
  const aliasAndRole = section(
    "async function updateWorkspaceTabAlias",
    "async function focusWorkspaceTab"
  );
  const copiedUrls = section(
    "async function copyWorkspaceUrlList",
    "async function refreshWorkspaceTabMetadata"
  );
  const statusRefresh = section(
    "async function refreshTabStatus",
    "async function clearWorkspaceTabs"
  );
  const retainedMembership = section(
    "async function openSearchTab",
    "function createWorkspaceTabFromBrowserTab"
  );

  assert.doesNotMatch(assignedMigration, /crypto\.randomUUID\(\)|getWorkspace\(|saveWorkspace\(/);
  assert.doesNotMatch(assignedResolution, /workspaceTabId\s*=/);
  assert.doesNotMatch(journal, /readActiveWorkspaceReadonly|getWorkspace\(|saveWorkspace\(/);
  for (const migratedRegion of [scan, aliasAndRole, copiedUrls, statusRefresh]) {
    assert.doesNotMatch(migratedRegion, /getWorkspace\(|saveWorkspace\(|addTimelineEvent\(/);
  }
  const ordinaryTimeline = section(
    "async function appendAssignedOrdinaryTimelineEvent",
    "async function scanCurrentWindowTabs"
  );
  assert.match(journal, /journalAppendClient\.submit\(\{\s*authority:/);
  assert.match(ordinaryTimeline, /appendTimeline/);
  assert.match(scan, /appendAssignedOrdinaryTimelineEvent/);
  assert.match(copiedUrls, /appendAssignedOrdinaryTimelineEvent/);
  assert.match(statusRefresh, /appendAssignedOrdinaryTimelineEvent/);
  assert.match(aliasAndRole, /workspace\.tab\.metadata\.commit/);
  assert.match(retainedMembership, /workspaceMembershipPromotionSequencer/);
  assert.match(retainedMembership, /addTimelineEvent\(/);
});

test("D3D-05 Task-7 search intake reads assigned state and submits only exact scoped search or ordinary-skip mutations", async () => {
  const source = await readFile(
    new URL("../../src/sidepanel/search-workspace-intake.js", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /workspace-store|saveWorkspace|getWorkspace|addTimelineEvent/);

  const originalChrome = globalThis.chrome;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  globalThis.document = { getElementById: () => ({ addEventListener: () => undefined }) };
  globalThis.window = { setTimeout: () => 0, dispatchEvent: () => true };
  globalThis.chrome = {
    tabs: { query: async () => [] },
    runtime: { sendMessage: async () => ({}) },
    storage: { local: { get: async () => ({}), set: async () => undefined } }
  };

  try {
    const searchIntake = await import(
      new URL("../../src/sidepanel/search-workspace-intake.js?task7-focused", import.meta.url).href
    );
    assert.equal(
      typeof searchIntake.createSearchWorkspaceIntakeController,
      "function",
      "Task 7 must expose the dedicated search intake controller for assigned-authority behavior"
    );

    const activeTab = {
      id: 55,
      windowId: 10,
      groupId: -1,
      title: "Space cats - Google Search",
      url: "https://www.google.com/search?q=space+cats",
      active: true
    };
    const assignedWorkspace = runtimeMutationWorkspaceFixture();
    const mutationCalls = [];
    const diagnostics = [];
    const statuses = [];
    let refreshes = 0;
    const controller = searchIntake.createSearchWorkspaceIntakeController({
      getActiveSearchTab: async () => structuredClone(activeTab),
      assignedMutationGateway: {
        resolveAssignedWorkspace: async () => ({
          ok: true,
          workspace: structuredClone(assignedWorkspace)
        }),
        submit: async (input) => {
          mutationCalls.push(structuredClone(input));
          return { ok: true, refreshed: true, workspace: structuredClone(assignedWorkspace) };
        },
        appendTimeline: async (...input) => {
          mutationCalls.push({ timeline: structuredClone(input) });
          return { ok: true, refreshed: true, workspace: structuredClone(assignedWorkspace) };
        }
      },
      recordDiagnostic: async (...input) => diagnostics.push(structuredClone(input)),
      setStatus: (message) => statuses.push(message),
      refreshAssignedWorkspace: async () => { refreshes += 1; }
    });

    const added = await controller.autoAddLaunchedSearchTab("space cats");
    assert.equal(added.ok, true);
    assert.equal(mutationCalls.length, 1);
    assert.equal(mutationCalls[0].mutationKind, "search.intake.add");
    assert.equal(mutationCalls[0].payload.query, "space cats");
    assert.equal(typeof mutationCalls[0].payload.tab.workspaceTabId, "string");
    assert.ok(mutationCalls[0].payload.tab.workspaceTabId.length > 0);
    assert.equal(mutationCalls[0].payload.sameUrlDuplicate, false);
    assert.equal(refreshes, 1);
    assert.equal(diagnostics.length, 1);

    const exactWorkspace = runtimeMutationWorkspaceFixture({
      tabs: [{
        ...runtimeMutationWorkspaceFixture().tabs[0],
        workspaceTabId: "workspace-tab-search-existing",
        tabId: activeTab.id,
        url: activeTab.url
      }]
    });
    const duplicateCalls = [];
    const duplicateController = searchIntake.createSearchWorkspaceIntakeController({
      getActiveSearchTab: async () => structuredClone(activeTab),
      assignedMutationGateway: {
        resolveAssignedWorkspace: async () => ({ ok: true, workspace: structuredClone(exactWorkspace) }),
        submit: async (input) => duplicateCalls.push(structuredClone(input)),
        appendTimeline: async (...input) => {
          duplicateCalls.push({ timeline: structuredClone(input) });
          return { ok: true, refreshed: true, workspace: structuredClone(exactWorkspace) };
        }
      },
      recordDiagnostic: async () => undefined,
      setStatus: () => undefined,
      refreshAssignedWorkspace: async () => undefined
    });
    const duplicate = await duplicateController.autoAddLaunchedSearchTab("space cats");
    assert.equal(duplicate.ok, true);
    assert.equal(duplicateCalls.some((call) => call.mutationKind === "search.intake.add"), false);
    assert.equal(duplicateCalls.length, 1);
    assert.equal(duplicateCalls[0].timeline[0], "browser_search_tab_auto_add_skipped");

    const authorityFailureCalls = [];
    const activeTabBefore = structuredClone(activeTab);
    const authorityFailureController = searchIntake.createSearchWorkspaceIntakeController({
      getActiveSearchTab: async () => activeTab,
      assignedMutationGateway: {
        resolveAssignedWorkspace: async () => ({
          ok: false,
          status: "unbound",
          reason: "window_unbound",
          workspace: null
        }),
        submit: async (input) => authorityFailureCalls.push(input),
        appendTimeline: async (input) => authorityFailureCalls.push(input)
      },
      recordDiagnostic: async () => undefined,
      setStatus: () => undefined,
      refreshAssignedWorkspace: async () => undefined
    });
    const denied = await authorityFailureController.autoAddLaunchedSearchTab("space cats");
    assert.equal(denied.ok, false);
    assert.equal(authorityFailureCalls.length, 0);
    assert.deepEqual(activeTab, activeTabBefore, "authority denial must leave the browser tab untouched and open");
  } finally {
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("D3D-05 Task-7 assigned startup validates by default and gates retained legacy ID repair", async () => {
  const source = await readFile(
    new URL("../../src/sidepanel/sidepanel.js", import.meta.url),
    "utf8"
  );
  const initialization = source.slice(
    source.indexOf("async function initializeSidePanel"),
    source.indexOf("async function requireRuntimeWorkspaceAuthority")
  );
  const migration = source.slice(
    source.indexOf("async function migrateWorkspaceTabIds"),
    source.indexOf("async function renderWorkspace")
  );

  assert.match(initialization, /const assignedRead = await migrateWorkspaceTabIds\(\);/);
  assert.match(
    migration,
    /if \(!legacyCompatibilityRoute\) return validateAssignedWorkspaceTabIdsForStartup\(\);/,
    "assigned startup must select no-write validation before any retained legacy repair route"
  );
  assert.equal(
    (migration.match(/requireRuntimeWorkspaceAuthority/g) || []).length,
    2,
    "retained legacy repair must remain authority-bracketed"
  );

  const validationStart = source.indexOf("async function validateAssignedWorkspaceTabIdsForStartup");
  const validationEnd = source.indexOf("async function renderWorkspace", validationStart);
  assert.ok(validationStart >= 0);
  assert.ok(validationEnd > validationStart);
  const validation = source.slice(validationStart, validationEnd);
  assert.doesNotMatch(validation, /crypto\.randomUUID\(\)|getWorkspace\(|saveWorkspace\(/);
});

test("D3D-05 Task-7 R1 duplicate review renders an assigned snapshot without compatibility reread", async () => {
  const source = await readFile(
    new URL("../../src/sidepanel/sidepanel.js", import.meta.url),
    "utf8"
  );
  const start = source.indexOf("async function renderDuplicateUrlReview");
  const end = source.indexOf("function buildWorkspaceUrlListMarkdown", start);
  assert.ok(start >= 0);
  assert.ok(end > start);

  const assignedWorkspace = runtimeMutationWorkspaceFixture({ tabs: [] });
  const list = { children: [], appendChild(node) { this.children.push(node); } };
  const document = {
    getElementById: (id) => id === "duplicateUrlReviewList" ? list : null,
    createElement: () => ({ className: "", textContent: "" })
  };
  let compatibilityReads = 0;
  let assignedReads = 0;
  const createDuplicateReview = new Function(
    "document",
    "clearElement",
    "readActiveWorkspaceReadonly",
    "readAssignedWorkspaceForOrdinaryAction",
    "setAdvancedStatus",
    "getDuplicateUrlGroups",
    source.slice(start, end) + "; return renderDuplicateUrlReview;"
  );
  const renderDuplicateUrlReview = createDuplicateReview(
    document,
    (target) => { target.children = []; },
    async () => {
      compatibilityReads += 1;
      return { ok: true, workspace: { ...assignedWorkspace, workspaceId: "compatibility-workspace" } };
    },
    async () => {
      assignedReads += 1;
      return { ok: true, workspace: assignedWorkspace };
    },
    () => undefined,
    () => []
  );

  await renderDuplicateUrlReview(assignedWorkspace);
  assert.equal(compatibilityReads, 0, "an explicit refreshed assigned snapshot must bypass compatibility reads");

  await renderDuplicateUrlReview();
  assert.equal(assignedReads, 1, "independent duplicate review must resolve through assigned authority");
  assert.equal(compatibilityReads, 0, "independent duplicate review must not fall back to compatibility state");
});

test("D3D-05 Task-7 R1 assigned scan renders membership from its verified refreshed snapshot", async () => {
  const source = await readFile(
    new URL("../../src/sidepanel/sidepanel.js", import.meta.url),
    "utf8"
  );
  const start = source.indexOf("async function scanCurrentWindowTabs");
  const end = source.indexOf("async function addSelectedTabsToWorkspace", start);
  assert.ok(start >= 0);
  assert.ok(end > start);

  const assignedWorkspace = runtimeMutationWorkspaceFixture({
    tabs: [{
      workspaceTabId: "assigned-scanned-tab",
      tabId: 41,
      windowId: 10,
      url: "https://example.test/scanned",
      originalTitle: "Assigned scanned tab"
    }]
  });
  const compatibilityWorkspace = runtimeMutationWorkspaceFixture({ tabs: [] });
  const list = { children: [], appendChild(node) { this.children.push(node); } };
  const document = {
    createElement: () => ({
      children: [],
      appendChild(node) { this.children.push(node); },
      className: "",
      textContent: "",
      type: "",
      value: "",
      disabled: false
    })
  };
  let compatibilityReads = 0;
  const createScanCurrentWindowTabs = new Function(
    "getCurrentWindowTabs",
    "appendAssignedOrdinaryTimelineEvent",
    "setIntakeStatus",
    "readActiveWorkspaceReadonly",
    "availableTabsList",
    "clearElement",
    "document",
    "createDisplayUrl",
    "let availableTabs = []; " + source.slice(start, end) + "; return scanCurrentWindowTabs;"
  );
  const scanCurrentWindowTabs = createScanCurrentWindowTabs(
    async () => [{ id: 41, title: "Scanned tab", url: "https://example.test/scanned" }],
    async () => ({ ok: true, refreshed: true, workspace: assignedWorkspace }),
    () => undefined,
    async () => {
      compatibilityReads += 1;
      return { ok: true, workspace: compatibilityWorkspace };
    },
    list,
    (target) => { target.children = []; },
    document,
    (url) => url
  );

  await scanCurrentWindowTabs();

  assert.equal(compatibilityReads, 0, "successful assigned scan rendering must not reread compatibility workspace state");
  assert.equal(list.children[0].children[0].disabled, true, "scanned membership must come from the verified refreshed assigned workspace");
});
