import { appendRuntimeDiagnostic } from "../core/workspace-runtime-store.js";

const WORKSPACE_STORAGE_KEY = "chromeFlowWorkspace";
const JOURNAL_BUTTON_ID = "addJournalButton";
const JOURNAL_BUTTON_TEXT = "Add Journal Entry";
const TRACE_POLL_MS = 100;
const TRACE_TIMEOUT_MS = 5000;

const activeJournalTraces = new Map();

installUserJournalActionObservability();

function installUserJournalActionObservability() {
  const button = document.getElementById(JOURNAL_BUTTON_ID);
  if (!button) return;

  // sidepanel.js is loaded first, so its product handler runs before this
  // target-phase observer. The product action begins normally, then this
  // observer suppresses only the legacy document-level timeline tracer.
  button.addEventListener("click", handleJournalButtonAtTarget);
}

function handleJournalButtonAtTarget(event) {
  const button = event.currentTarget;
  if (!(button instanceof HTMLButtonElement)) return;

  const noteInput = document.getElementById("journalEntry");
  const noteHasContent = Boolean(noteInput?.value?.trim());
  const journalCountBefore = document.querySelectorAll("#journalList .journal-entry-card").length;
  const traceId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  temporarilySuppressLegacyDocumentTracer(button);

  void appendRuntimeDiagnostic(
    "info",
    "ui_click",
    "Button clicked: " + JOURNAL_BUTTON_ID + ".",
    {
      buttonId: JOURNAL_BUTTON_ID,
      buttonText: JOURNAL_BUTTON_TEXT
    }
  );

  if (!noteHasContent) {
    void appendRuntimeDiagnostic(
      "warn",
      "action_skipped",
      "Action skipped: Add User Journal Entry.",
      {
        traceId,
        actionName: "addUserJournalEntry",
        buttonId: JOURNAL_BUTTON_ID,
        buttonText: JOURNAL_BUTTON_TEXT,
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
      buttonText: JOURNAL_BUTTON_TEXT,
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

function temporarilySuppressLegacyDocumentTracer(button) {
  const originalId = button.id;
  const originalText = button.textContent;

  // The legacy diagnostics listener is delegated from document and runs after
  // this target listener. Blank identity suppresses only that legacy trace.
  button.id = "";
  button.textContent = "";

  queueMicrotask(() => {
    button.id = originalId;
    button.textContent = originalText;
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
        buttonText: JOURNAL_BUTTON_TEXT,
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
        buttonText: JOURNAL_BUTTON_TEXT,
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
