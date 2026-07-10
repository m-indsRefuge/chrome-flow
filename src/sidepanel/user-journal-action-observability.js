import { appendRuntimeDiagnostic } from "../core/workspace-runtime-store.js";

const WORKSPACE_STORAGE_KEY = "chromeFlowWorkspace";
const JOURNAL_BUTTON_ID = "addJournalButton";
const TEMPORARY_BYPASS_BUTTON_ID = "addJournalButtonStateVerified";
const TRACE_POLL_MS = 100;
const TRACE_TIMEOUT_MS = 5000;

const activeJournalTraces = new Map();

installUserJournalActionObservability();

function installUserJournalActionObservability() {
  document.addEventListener("click", handleJournalButtonCapture, true);
}

function handleJournalButtonCapture(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const button = target.closest("button");
  if (!button || button.id !== JOURNAL_BUTTON_ID) return;

  const noteInput = document.getElementById("journalEntry");
  const noteHasContent = Boolean(noteInput?.value?.trim());
  const journalCountBefore = document.querySelectorAll("#journalList .journal-entry-card").length;
  const traceId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  temporarilyBypassLegacyTimelineTrace(button);

  if (!noteHasContent) {
    void appendRuntimeDiagnostic(
      "warn",
      "action_skipped",
      "Action skipped: Add User Journal Entry.",
      {
        traceId,
        actionName: "addUserJournalEntry",
        buttonId: JOURNAL_BUTTON_ID,
        buttonText: "Add Journal Entry",
        observedEvent: {
          eventId: "",
          type: "user_journal_add_skipped_empty",
          message: "No User Journal entry was added because the note was empty.",
          createdAt: startedAt
        },
        stateVerification: "empty_note_input",
        systemTimelineEventRequired: false
      }
    );
    return;
  }

  activeJournalTraces.set(traceId, {
    traceId,
    startedAt,
    startedAtMs: Date.now(),
    journalCountBefore
  });

  void appendRuntimeDiagnostic(
    "info",
    "action_started",
    "Action started: Add User Journal Entry.",
    {
      traceId,
      actionName: "addUserJournalEntry",
      buttonId: JOURNAL_BUTTON_ID,
      buttonText: "Add Journal Entry",
      journalCountBefore,
      terminalEventTypes: ["user_journal_added"],
      verificationMode: "isolated_user_journal_state_change",
      systemTimelineEventRequired: false
    }
  );

  window.setTimeout(() => {
    void pollJournalTrace(traceId);
  }, TRACE_POLL_MS);
}

function temporarilyBypassLegacyTimelineTrace(button) {
  button.id = TEMPORARY_BYPASS_BUTTON_ID;

  queueMicrotask(() => {
    if (button.id === TEMPORARY_BYPASS_BUTTON_ID) {
      button.id = JOURNAL_BUTTON_ID;
    }
  });
}

async function pollJournalTrace(traceId) {
  const trace = activeJournalTraces.get(traceId);
  if (!trace) return;

  const workspace = await readWorkspace();
  const journal = Array.isArray(workspace?.journal) ? workspace.journal : [];

  if (journal.length > trace.journalCountBefore) {
    const entry = journal[journal.length - 1] || {};

    await appendRuntimeDiagnostic(
      "info",
      "action_success",
      "Action success: Add User Journal Entry.",
      {
        traceId: trace.traceId,
        actionName: "addUserJournalEntry",
        buttonId: JOURNAL_BUTTON_ID,
        buttonText: "Add Journal Entry",
        observedEvent: {
          eventId: entry.entryId || "",
          type: "user_journal_added",
          message: "User Journal entry added and verified from isolated journal state.",
          createdAt: entry.createdAt || new Date().toISOString()
        },
        journalCountBefore: trace.journalCountBefore,
        journalCountAfter: journal.length,
        verificationMode: "journal_count_increased",
        systemTimelineEventRequired: false,
        humanNoteContentIncludedInDiagnostic: false
      }
    );

    activeJournalTraces.delete(traceId);
    return;
  }

  if (Date.now() - trace.startedAtMs >= TRACE_TIMEOUT_MS) {
    await appendRuntimeDiagnostic(
      "warn",
      "action_no_result_observed",
      "No verified User Journal state change was observed after Add Journal Entry.",
      {
        traceId: trace.traceId,
        actionName: "addUserJournalEntry",
        buttonId: JOURNAL_BUTTON_ID,
        buttonText: "Add Journal Entry",
        expectedTerminalEventTypes: ["user_journal_added"],
        journalCountBefore: trace.journalCountBefore,
        journalCountNow: journal.length,
        verificationMode: "isolated_user_journal_state_change",
        systemTimelineEventRequired: false
      }
    );

    activeJournalTraces.delete(traceId);
    return;
  }

  window.setTimeout(() => {
    void pollJournalTrace(traceId);
  }, TRACE_POLL_MS);
}

async function readWorkspace() {
  const result = await chrome.storage.local.get(WORKSPACE_STORAGE_KEY);
  return result?.[WORKSPACE_STORAGE_KEY] || null;
}
