import { appendRuntimeDiagnostic } from "../core/workspace-runtime-store.js";

const WORKSPACE_STORAGE_KEY = "chromeFlowWorkspace";
const LEGACY_CLOSE_BUTTON_CLASS = "close-browser-tab-button";
const FOCUS_BUTTON_TEXT = "Focus Tab";
const FOCUS_BUTTON_REPLACEMENT_TEXT = "Focus Workspace Tab";
const OBSERVED_FOCUS_EVENT_TYPES = new Set([
  "workspace_tab_focused",
  "workspace_tab_focus_failed"
]);

const knownTimelineEventIds = new Set();
let initialized = false;

installWorkspaceTabActionContractCleanup();

async function installWorkspaceTabActionContractCleanup() {
  cleanProductControls(document);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) cleanProductControls(node);
      }
    }
  });

  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  await seedKnownTimelineEvents();
  installWorkspaceFocusDiagnosticBridge();
  initialized = true;
}

function cleanProductControls(root) {
  if (!(root instanceof Document || root instanceof Element)) return;

  root.querySelectorAll?.("." + LEGACY_CLOSE_BUTTON_CLASS).forEach((button) => {
    button.remove();
  });

  root.querySelectorAll?.("button").forEach((button) => {
    if ((button.textContent || "").trim() !== FOCUS_BUTTON_TEXT) return;
    button.textContent = FOCUS_BUTTON_REPLACEMENT_TEXT;
    button.title = "Focus the live browser tab represented by this workspace record.";
  });
}

async function seedKnownTimelineEvents() {
  const workspace = await readWorkspace();
  const timeline = Array.isArray(workspace?.timeline) ? workspace.timeline : [];

  timeline.forEach((event) => {
    if (event?.eventId) knownTimelineEventIds.add(event.eventId);
  });
}

function installWorkspaceFocusDiagnosticBridge() {
  if (!globalThis.chrome?.storage?.onChanged?.addListener) return;

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (!initialized || areaName !== "local") return;

    const workspace = changes?.[WORKSPACE_STORAGE_KEY]?.newValue;
    const timeline = Array.isArray(workspace?.timeline) ? workspace.timeline : [];

    for (const event of timeline) {
      if (!event?.eventId || knownTimelineEventIds.has(event.eventId)) continue;
      knownTimelineEventIds.add(event.eventId);

      if (!OBSERVED_FOCUS_EVENT_TYPES.has(event.type)) continue;
      void recordFocusEventDiagnostic(event);
    }
  });
}

async function recordFocusEventDiagnostic(event) {
  const succeeded = event.type === "workspace_tab_focused";

  await appendRuntimeDiagnostic(
    succeeded ? "info" : "warn",
    succeeded ? "workspace_tab_focus_verified" : "workspace_tab_focus_failed",
    succeeded
      ? "Workspace tab focus completed and was verified by the System Journal event."
      : "Workspace tab focus did not complete safely.",
    {
      eventId: event.eventId || "",
      eventType: event.type || "",
      workspaceTabId: event.workspaceTabId || "",
      tabId: Number.isInteger(event.tabId) ? event.tabId : null,
      windowId: Number.isInteger(event.windowId) ? event.windowId : null,
      matchStatus: event.matchStatus || "",
      message: event.message || ""
    }
  );
}

async function readWorkspace() {
  const result = await chrome.storage.local.get(WORKSPACE_STORAGE_KEY);
  return result?.[WORKSPACE_STORAGE_KEY] || null;
}
