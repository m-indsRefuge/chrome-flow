import {
  SESSION_DB_SCHEMA,
  deleteFromStore,
  getAllFromIndex,
  getAllFromStore,
  getFromStore,
  putInStore
} from "../core/session-db.js";

const DIAGNOSTICS_KEY = "chromeFlowDiagnostics";
const MAX_DIAGNOSTICS = 200;
const ACTIVE_WORKSPACE_SETTING_KEY = "activeWorkspaceId";
const SMOKE_TEST_WORKSPACE_NAME = "Session DB Smoke Test Workspace";
const SMOKE_TEST_WORKSPACE_AIM = "Validate Session DB v0 workspace/session/projection persistence.";

installSavedWorkspaceCleanupControls();

async function installSavedWorkspaceCleanupControls() {
  renderSavedWorkspaceCleanupControls();
  attachSavedWorkspaceCleanupHandlers();
  await refreshCleanupSummary();
  applySmokeTestVisibilityFilter();
}

function renderSavedWorkspaceCleanupControls() {
  if (document.getElementById("savedWorkspaceCleanupControls")) return;

  const registrySection = document.getElementById("savedWorkspaceRegistrySection");
  const anchor = document.getElementById("savedWorkspaceRegistryStatus") || registrySection;
  if (!registrySection || !anchor) return;

  const panel = document.createElement("div");
  panel.id = "savedWorkspaceCleanupControls";
  panel.className = "workspace-session-actions";

  const hideLabel = document.createElement("label");
  hideLabel.className = "checkbox-row";

  const hideCheckbox = document.createElement("input");
  hideCheckbox.id = "hideSmokeTestWorkspacesCheckbox";
  hideCheckbox.type = "checkbox";
  hideCheckbox.checked = true;

  const hideText = document.createElement("span");
  hideText.textContent = "Hide smoke-test workspaces in selector";

  hideLabel.appendChild(hideCheckbox);
  hideLabel.appendChild(hideText);

  panel.appendChild(hideLabel);
  panel.appendChild(createButton("deleteSmokeTestWorkspacesButton", "Delete Smoke-Test Records", "danger-button"));
  panel.appendChild(createButton("deleteSelectedSavedWorkspaceButton", "Delete Selected Saved Workspace", "danger-button"));

  const summary = document.createElement("p");
  summary.id = "savedWorkspaceCleanupSummary";
  summary.className = "status-message";
  summary.textContent = "Saved workspace cleanup summary will appear here.";

  anchor.insertAdjacentElement("afterend", summary);
  anchor.insertAdjacentElement("afterend", panel);
}

function attachSavedWorkspaceCleanupHandlers() {
  document.getElementById("hideSmokeTestWorkspacesCheckbox")?.addEventListener("change", () => {
    applySmokeTestVisibilityFilter();
  });

  document.getElementById("deleteSmokeTestWorkspacesButton")?.addEventListener("click", deleteSmokeTestWorkspaces);
  document.getElementById("deleteSelectedSavedWorkspaceButton")?.addEventListener("click", deleteSelectedSavedWorkspace);
  document.getElementById("refreshSavedWorkspacesButton")?.addEventListener("click", () => {
    window.setTimeout(() => {
      applySmokeTestVisibilityFilter();
      refreshCleanupSummary();
    }, 200);
  });
}

async function deleteSmokeTestWorkspaces() {
  try {
    const workspaces = await getAllFromStore(SESSION_DB_SCHEMA.stores.workspaces);
    const smokeTestWorkspaces = workspaces.filter(isSmokeTestWorkspace);

    if (!smokeTestWorkspaces.length) {
      setCleanupSummary("No smoke-test Session DB workspace records found.");
      await recordDiagnostic("info", "saved_workspace_cleanup_no_smoke_tests", "No smoke-test Session DB workspace records found.", {});
      return;
    }

    const confirmed = window.confirm("Delete " + smokeTestWorkspaces.length + " smoke-test Session DB workspace record(s)? This only affects Session DB test records and will not close browser tabs.");
    if (!confirmed) {
      setCleanupSummary("Smoke-test cleanup cancelled.");
      await recordDiagnostic("info", "saved_workspace_cleanup_cancelled", "Smoke-test cleanup cancelled by Operator.", {
        candidateCount: smokeTestWorkspaces.length
      });
      return;
    }

    const deleted = [];
    for (const workspace of smokeTestWorkspaces) {
      deleted.push(await deleteWorkspaceCascade(workspace.workspaceId));
    }

    await refreshRegistryAfterCleanup();
    setCleanupSummary("Deleted " + deleted.length + " smoke-test Session DB workspace record(s). Browser runtime unchanged.");
    await recordDiagnostic("info", "saved_workspace_smoke_tests_deleted", "Smoke-test Session DB workspace records deleted.", {
      deletedCount: deleted.length,
      deleted
    });
  } catch (error) {
    await handleCleanupError("saved_workspace_smoke_test_delete_failed", "Could not delete smoke-test Session DB workspace records.", error);
  }
}

async function deleteSelectedSavedWorkspace() {
  try {
    const workspaceId = document.getElementById("savedWorkspaceSelect")?.value || "";

    if (!workspaceId) {
      setCleanupSummary("No saved workspace selected for deletion.");
      return;
    }

    const workspace = await getFromStore(SESSION_DB_SCHEMA.stores.workspaces, workspaceId);
    if (!workspace) {
      setCleanupSummary("Selected saved workspace no longer exists in Session DB.");
      await refreshRegistryAfterCleanup();
      return;
    }

    const confirmed = window.confirm("Delete selected Session DB workspace record: " + (workspace.name || workspace.workspaceId) + "? This will remove the saved Session DB record and related Session DB records only. It will not close browser tabs or change the active chrome.storage.local runtime.");
    if (!confirmed) {
      setCleanupSummary("Selected saved workspace deletion cancelled.");
      await recordDiagnostic("info", "saved_workspace_delete_cancelled", "Selected saved workspace deletion cancelled by Operator.", {
        workspaceId,
        name: workspace.name || ""
      });
      return;
    }

    const deleted = await deleteWorkspaceCascade(workspaceId);
    await refreshRegistryAfterCleanup();
    setCleanupSummary("Deleted selected saved workspace from Session DB: " + (workspace.name || workspaceId) + ". Browser runtime unchanged.");
    await recordDiagnostic("info", "saved_workspace_deleted", "Selected saved workspace deleted from Session DB.", deleted);
  } catch (error) {
    await handleCleanupError("saved_workspace_delete_failed", "Could not delete selected saved workspace from Session DB.", error);
  }
}

async function deleteWorkspaceCascade(workspaceId) {
  const workspace = await getFromStore(SESSION_DB_SCHEMA.stores.workspaces, workspaceId);
  const tabs = await getAllFromIndex(SESSION_DB_SCHEMA.stores.workspaceTabs, "workspaceId", workspaceId);
  const sessions = await getAllFromIndex(SESSION_DB_SCHEMA.stores.sessions, "workspaceId", workspaceId);
  const projections = await getAllFromIndex(SESSION_DB_SCHEMA.stores.projections, "workspaceId", workspaceId);
  const journalEntries = await getAllFromIndex(SESSION_DB_SCHEMA.stores.journalEntries, "workspaceId", workspaceId);
  const timelineEvents = await getAllFromIndex(SESSION_DB_SCHEMA.stores.timelineEvents, "workspaceId", workspaceId);
  const summaryCards = await getAllFromIndex(SESSION_DB_SCHEMA.stores.summaryCards, "workspaceId", workspaceId);
  const outgoingLinks = await getAllFromIndex(SESSION_DB_SCHEMA.stores.workspaceLinks, "fromWorkspaceId", workspaceId);
  const incomingLinks = await getAllFromIndex(SESSION_DB_SCHEMA.stores.workspaceLinks, "toWorkspaceId", workspaceId);
  const linkIds = Array.from(new Set([...outgoingLinks, ...incomingLinks].map((link) => link.linkId)));

  for (const tab of tabs) await deleteFromStore(SESSION_DB_SCHEMA.stores.workspaceTabs, tab.workspaceTabId);
  for (const session of sessions) await deleteFromStore(SESSION_DB_SCHEMA.stores.sessions, session.sessionId);
  for (const projection of projections) await deleteFromStore(SESSION_DB_SCHEMA.stores.projections, projection.projectionId);
  for (const entry of journalEntries) await deleteFromStore(SESSION_DB_SCHEMA.stores.journalEntries, entry.journalEntryId);
  for (const event of timelineEvents) await deleteFromStore(SESSION_DB_SCHEMA.stores.timelineEvents, event.eventId);
  for (const card of summaryCards) await deleteFromStore(SESSION_DB_SCHEMA.stores.summaryCards, card.summaryCardId);
  for (const linkId of linkIds) await deleteFromStore(SESSION_DB_SCHEMA.stores.workspaceLinks, linkId);

  await removeWorkspaceFromConstellations(workspaceId);
  await clearActiveDbWorkspaceIfNeeded(workspaceId);
  await deleteFromStore(SESSION_DB_SCHEMA.stores.workspaces, workspaceId);

  return {
    workspaceId,
    name: workspace?.name || "",
    counts: {
      tabs: tabs.length,
      sessions: sessions.length,
      projections: projections.length,
      journalEntries: journalEntries.length,
      timelineEvents: timelineEvents.length,
      summaryCards: summaryCards.length,
      links: linkIds.length
    },
    safety: {
      sessionDbOnly: true,
      browserTabsClosed: false,
      browserWindowsChanged: false,
      chromeStorageRuntimeChanged: false
    }
  };
}

async function removeWorkspaceFromConstellations(workspaceId) {
  const constellations = await getAllFromStore(SESSION_DB_SCHEMA.stores.constellations);

  for (const constellation of constellations) {
    const workspaceIds = Array.isArray(constellation.workspaceIds) ? constellation.workspaceIds : [];
    if (!workspaceIds.includes(workspaceId) && constellation.rootWorkspaceId !== workspaceId) continue;

    await putInStore(SESSION_DB_SCHEMA.stores.constellations, {
      ...constellation,
      rootWorkspaceId: constellation.rootWorkspaceId === workspaceId ? "" : constellation.rootWorkspaceId,
      workspaceIds: workspaceIds.filter((id) => id !== workspaceId),
      updatedAt: new Date().toISOString()
    });
  }
}

async function clearActiveDbWorkspaceIfNeeded(workspaceId) {
  const activeRecord = await getFromStore(SESSION_DB_SCHEMA.stores.settings, ACTIVE_WORKSPACE_SETTING_KEY);

  if (activeRecord?.value === workspaceId) {
    await putInStore(SESSION_DB_SCHEMA.stores.settings, {
      key: ACTIVE_WORKSPACE_SETTING_KEY,
      value: "",
      updatedAt: new Date().toISOString()
    });
  }
}

async function refreshRegistryAfterCleanup() {
  document.getElementById("refreshSavedWorkspacesButton")?.click();
  await wait(250);
  applySmokeTestVisibilityFilter();
  await refreshCleanupSummary();
}

async function refreshCleanupSummary() {
  try {
    const workspaces = await getAllFromStore(SESSION_DB_SCHEMA.stores.workspaces);
    const smokeTestCount = workspaces.filter(isSmokeTestWorkspace).length;
    const importedCount = workspaces.filter((workspace) => workspace.lifecycleState === "paused" && !isSmokeTestWorkspace(workspace)).length;
    setCleanupSummary("Cleanup: " + smokeTestCount + " smoke-test record(s), " + importedCount + " non-test paused saved workspace record(s), " + workspaces.length + " total Session DB workspace record(s). Browser runtime unchanged.");
  } catch (error) {
    setCleanupSummary("Cleanup summary unavailable: " + (error?.message || String(error)));
  }
}

function applySmokeTestVisibilityFilter() {
  const hide = Boolean(document.getElementById("hideSmokeTestWorkspacesCheckbox")?.checked);
  const select = document.getElementById("savedWorkspaceSelect");
  if (!select) return;

  let firstVisibleValue = "";

  for (const option of Array.from(select.options)) {
    const isSmokeOption = option.textContent.startsWith(SMOKE_TEST_WORKSPACE_NAME + " |") || option.textContent.includes(SMOKE_TEST_WORKSPACE_NAME);
    option.hidden = hide && isSmokeOption;

    if (!option.hidden && option.value && !firstVisibleValue) {
      firstVisibleValue = option.value;
    }
  }

  const currentOption = select.options[select.selectedIndex];
  if (currentOption?.hidden && firstVisibleValue) {
    select.value = firstVisibleValue;
    select.dispatchEvent(new Event("change"));
  }
}

function isSmokeTestWorkspace(workspace = {}) {
  return workspace.name === SMOKE_TEST_WORKSPACE_NAME && workspace.aim === SMOKE_TEST_WORKSPACE_AIM;
}

function createButton(id, text, className) {
  const button = document.createElement("button");
  button.id = id;
  button.type = "button";
  button.className = className;
  button.textContent = text;
  return button;
}

function setCleanupSummary(message) {
  const summary = document.getElementById("savedWorkspaceCleanupSummary");
  if (summary) summary.textContent = message;
}

async function handleCleanupError(action, message, error) {
  setCleanupSummary(message + " " + (error?.message || String(error)));
  await recordDiagnostic("error", action, message, {
    error: summarizeError(error)
  });
}

async function recordDiagnostic(level, action, message, details = {}) {
  try {
    const result = await chrome.storage.local.get(DIAGNOSTICS_KEY);
    const diagnostics = Array.isArray(result[DIAGNOSTICS_KEY]) ? result[DIAGNOSTICS_KEY] : [];

    diagnostics.push({
      diagnosticId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      level,
      action,
      message,
      details
    });

    await chrome.storage.local.set({ [DIAGNOSTICS_KEY]: diagnostics.slice(-MAX_DIAGNOSTICS) });
  } catch (error) {
    console.warn("Chrome Flow saved workspace cleanup diagnostic record failed:", error);
  }
}

function summarizeError(error) {
  if (!error) return { message: "Unknown error" };

  return {
    name: error.name || "Error",
    message: error.message || String(error),
    stack: typeof error.stack === "string" ? error.stack.slice(0, 2000) : ""
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
