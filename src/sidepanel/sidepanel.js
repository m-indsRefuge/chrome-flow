import {
  getWorkspace,
  saveWorkspace,
  addTimelineEvent
} from "../core/workspace-store.js";
import {
  ASSIGNED_WORKSPACE_REFRESH_EVENT,
  createAssignedWorkspaceRuntimeMutationGateway,
  readAssignedWorkspaceRuntime
} from "../core/workspace-runtime-store.js";
import { createJournalAppendClient } from "../core/journal-append-coordination/client.js";
import { readActiveWorkspaceReadonly } from "../core/journal-append-coordination/readonly-workspace.js";
import { readCompatibleStorageValue, writeCompatibleStorageValue } from "../core/constellation-storage-compatibility.js";
import { LOCK_NAMES } from "../core/runtime-contract/constants.js";
import { normalizeWorkspaceRevision } from "../core/runtime-contract/revision.js";
import { getSidePanelRuntimeWorkspaceAuthority } from "../core/runtime-workspace-activation/side-panel-runtime.js";
import { getSidePanelAssignedWorkspaceAuthority } from "../core/runtime-window-binding/side-panel-authority.js";
import { createRuntimeWorkspaceMutationClient } from "../core/runtime-workspace-mutation/client.js";
import { RUNTIME_SESSION_AUTHORITY_KEY } from "../core/runtime-session-authority/contract.js";
import { createWorkspaceManualPlacementClient } from "../core/workspace-manual-placement-transaction/client.js";
import {
  classifyExistingRecoveryMembership,
  createBrowserTabMembershipFailureEvidence,
  createWorkspaceMembershipPromotionSequencer,
  findExactBrowserMembership,
  planSelectedMembershipBatch
} from "./workspace-membership-promotion-sequencer.js";
import {
  getAssignedWorkspaceMetadataMutationGateway,
  runWithWorkspaceMetadataBarrier,
  runWithWorkspaceMetadataWriter
} from "./workspace-metadata-autosave.js";
import { createWorkspacePromotionNoticeController } from "./workspace-promotion-notice.js";
import { MOVE_REQUEST_SCHEMA } from "../core/workspace-existing-tab-move-engine/contract.js";

import {
  createBrowserTabSnapshot,
  getAllBrowserTabs,
  getCurrentWindowTabs
} from "../core/tab-state.js";

import {
  DEFAULT_WORKSPACE_TYPE,
  WORKSPACE_TYPES,
  getWorkspaceRoleLabel,
  getWorkspaceTypeDescription,
  getWorkspaceTypeLabel,
  getWorkspaceRoles,
  isValidWorkspaceRole
} from "../core/workspace-role-sets.js";

const workspaceNameInput = document.getElementById("workspaceName");
const workspaceAimInput = document.getElementById("workspaceAim");
const workspaceTypeSelect = document.getElementById("workspaceType");
const workspaceTypeDescription = document.getElementById("workspaceTypeDescription");
const saveWorkspaceButton = document.getElementById("saveWorkspaceButton");
const scanTabsButton = document.getElementById("scanTabsButton");
const addActiveTabButton = document.getElementById("addActiveTabButton");
const selectAllScannedTabsButton = document.getElementById("selectAllScannedTabsButton");
const deselectAllScannedTabsButton = document.getElementById("deselectAllScannedTabsButton");
const addSelectedTabsButton = document.getElementById("addSelectedTabsButton");
const clearScannedTabsButton = document.getElementById("clearScannedTabsButton");
const intakeStatus = document.getElementById("intakeStatus");
const workspacePromotionNoticeController = createWorkspacePromotionNoticeController(document.getElementById("workspacePromotionNotice"));
const availableTabsList = document.getElementById("availableTabsList");
const searchQueryInput = document.getElementById("searchQuery");
const openSearchTabButton = document.getElementById("openSearchTabButton");
const createChromeGroupsButton = document.getElementById("createChromeGroupsButton");
const removeChromeGroupsButton = document.getElementById("removeChromeGroupsButton");
const refreshWorkspaceTabsButton = document.getElementById("refreshWorkspaceTabsButton");
const clearWorkspaceTabsButton = document.getElementById("clearWorkspaceTabsButton");
const refreshTabStatusButton = document.getElementById("refreshTabStatusButton");
const tabsList = document.getElementById("tabsList");
const statusTotalTabs = document.getElementById("statusTotalTabs");
const statusOpenTabs = document.getElementById("statusOpenTabs");
const statusMissingTabs = document.getElementById("statusMissingTabs");
const statusGroupedTabs = document.getElementById("statusGroupedTabs");
const statusUngroupedTabs = document.getElementById("statusUngroupedTabs");
const statusUnassignedTabs = document.getElementById("statusUnassignedTabs");
const journalEntryInput = document.getElementById("journalEntry");
const journalTagInput = document.getElementById("journalTag");
const journalRelatedRoleSelect = document.getElementById("journalRelatedRole");
const addJournalButton = document.getElementById("addJournalButton");
const journalList = document.getElementById("journalList");
const recoveryList = document.getElementById("recoveryList");
const systemTimelineList = document.getElementById("systemTimelineList");

const WINDOW_SETTLE_DELAY_MS = 600;
const MISSING_REOPEN_STATUSES = new Set(["not_found", "exact_tab_id_consumed", "no_reopened_url_tab_found"]);
let availableTabs = [];
let moveWorkspaceIntoNewWindowInProgress = false;
const runtimeAuthorityReadOnlyControlIds = new Set(["journalTabUser", "journalTabRecovery", "journalTabSystem"]);
const runtimeAuthorityIndependentControlIds = new Set([
  "toggleDeveloperModeButton",
  "refreshDiagnosticsButton",
  "copyDiagnosticPacketButton",
  "clearDiagnosticsButton",
  "copyAutomaticPromotionScenarioChecklistButton",
  "prepareAutomaticPromotionEvidencePacketButton",
  "copyAutomaticPromotionEvidencePacketButton"
]);
const runtimeAuthorityEnableWhenActiveControlIds = new Set(["addSelectedTabsButton", "addActiveTabButton", "openSearchTabButton", "moveWorkspaceTabsToNewWindowButton"]);
const assignedWorkspaceAuthority = getSidePanelAssignedWorkspaceAuthority();
const assignedOrdinaryMutationGateway = createAssignedWorkspaceRuntimeMutationGateway({
  resolveAuthority: () => assignedWorkspaceAuthority.resolve(),
  mutationClient: createRuntimeWorkspaceMutationClient({
    createId: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
    send: (command) => chrome.runtime.sendMessage(command)
  })
});
const journalAppendClient = createJournalAppendClient({ createId: () => crypto.randomUUID(), now: () => new Date().toISOString(), send: (request) => chrome.runtime.sendMessage(request), refresh: refreshJournalReadonly, clear: () => { if (journalEntryInput) journalEntryInput.value = ""; if (journalTagInput) journalTagInput.value = ""; }, status: (result) => { const success=["committed","replayed","no_change"].includes(result.status)&&result.workspaceVerified===true; setIntakeStatus(success ? "Journal entry saved and verified." : "Journal entry not saved or verified: " + (result.reason || result.status || "unknown_result")); } });
const runtimeWorkspaceAuthority = getSidePanelRuntimeWorkspaceAuthority();
const assignedWorkspaceMetadataMutationGateway = getAssignedWorkspaceMetadataMutationGateway();
const workspaceManualPlacementClient = createWorkspaceManualPlacementClient({ createId: () => crypto.randomUUID(), now: () => new Date().toISOString(), send: (request) => chrome.runtime.sendMessage(request) });
const workspaceMembershipPromotionSequencer = createWorkspaceMembershipPromotionSequencer({
  createId: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
  sendMembership: (request) => chrome.runtime.sendMessage(request),
  sendPromotion: (request) => chrome.runtime.sendMessage(request),
  activateWorkspace: (workspace) => runtimeWorkspaceAuthority.bootstrapExisting({ workspace, force: true }),
  runMetadataBarrier: runWithWorkspaceMetadataBarrier,
  onPromotionStarting: async (details) => {
    workspacePromotionNoticeController.showPending(details);
    setIntakeStatus("This workspace reached the dedicated-window threshold. Moving it now; keep this panel open until verification completes.");
    await waitForPromotionNoticePaint();
  }
});
let runtimeWorkspaceReadOnly = true;
let runtimeWorkspaceIdentityValidated = false;
runtimeWorkspaceAuthority.subscribe(applyRuntimeWorkspaceAuthorityState);
new MutationObserver(() => {
  if (runtimeWorkspaceReadOnly) setAuthoritySensitiveControlsDisabled(true);
}).observe(document.documentElement, { childList: true, subtree: true });

await initializeSidePanel();
installRuntimeWorkspaceAuthorityRefreshListener();
window.addEventListener(ASSIGNED_WORKSPACE_REFRESH_EVENT, () => {
  void refreshAssignedWorkspaceAfterVerifiedMutation();
});

async function initializeSidePanel() {
  setAuthoritySensitiveControlsDisabled(true);
  populateWorkspaceTypeSelect();
  renderAdvancedTabControls();
  setAuthoritySensitiveControlsDisabled(true);
  attachEventHandlers();
  const activationState = await runtimeWorkspaceAuthority.bootstrapExisting({ force: true });
  if (activationState.status === "active") {
    const assignedRead = await migrateWorkspaceTabIds();
    if (!assignedRead.ok) return;
    runtimeWorkspaceIdentityValidated = true;
    applyRuntimeWorkspaceAuthorityState(activationState);
    await renderWorkspace(assignedRead.workspace);
    return;
  }
  applyRuntimeWorkspaceAuthorityState(activationState);
}

async function requireRuntimeWorkspaceAuthority(workspace = null) {
  runtimeWorkspaceIdentityValidated = false;
  const activationState = await runtimeWorkspaceAuthority.bootstrapExisting({ workspace, force: true });
  if (activationState.status !== "active") {
    applyRuntimeWorkspaceAuthorityState(activationState);
    return false;
  }
  const assignedRead = await migrateWorkspaceTabIds();
  if (!assignedRead.ok) return false;
  runtimeWorkspaceIdentityValidated = true;
  applyRuntimeWorkspaceAuthorityState(activationState);
  return true;
}

function applyRuntimeWorkspaceAuthorityState(state) {
  const active = state?.status === "active" && runtimeWorkspaceIdentityValidated;
  runtimeWorkspaceReadOnly = !active;
  document.documentElement.dataset.runtimeWorkspaceAuthority = active ? "active" : state?.status || "blocked";
  setAuthoritySensitiveControlsDisabled(runtimeWorkspaceReadOnly);
  if (state?.status === "active" && !runtimeWorkspaceIdentityValidated) return;
  if (state?.status === "read_only") setIntakeStatus("This workspace is active in another Chrome window. This panel is read-only; open the panel in the assigned window to make changes.");
  else if (state?.status === "unbound") setIntakeStatus("This Chrome window is not bound to a workspace. Workspace reads and authority-sensitive actions remain disabled.");
  else if (state?.status === "blocked") setIntakeStatus("Workspace authority is not verified. Authority-sensitive actions remain disabled: " + (state.reason || "unknown_reason") + ".");
}

let runtimeWorkspaceAuthorityRefreshTimer = null;

function installRuntimeWorkspaceAuthorityRefreshListener() {
  chrome.storage.onChanged?.addListener((changes, areaName) => {
    if (
      areaName !== "session"
      || !changes
      || !Object.hasOwn(changes, RUNTIME_SESSION_AUTHORITY_KEY)
    ) return;

    queueRuntimeWorkspaceAuthorityRefresh();
  });
}

function queueRuntimeWorkspaceAuthorityRefresh() {
  if (runtimeWorkspaceAuthorityRefreshTimer !== null) return;

  runtimeWorkspaceAuthorityRefreshTimer = window.setTimeout(async () => {
      runtimeWorkspaceAuthorityRefreshTimer = null;

      try {
        runtimeWorkspaceIdentityValidated = false;
        const state = await runtimeWorkspaceAuthority.bootstrapExisting({ force: true });
        if (state.status === "active") {
          const assignedRead = await migrateWorkspaceTabIds();
          if (!assignedRead.ok) return;
          runtimeWorkspaceIdentityValidated = true;
          applyRuntimeWorkspaceAuthorityState(state);
          // The direct validator has refreshed the shared assigned-authority snapshot.
          await renderWorkspace();
          return;
        }
        applyRuntimeWorkspaceAuthorityState(state);
      } catch (_error) {
      applyRuntimeWorkspaceAuthorityState({
        status: "blocked",
        reason: "runtime_authority_change_refresh_failed",
        result: null
      });
    }
  }, 75);
}

function setAuthoritySensitiveControlsDisabled(disabled) {
  for (const control of document.querySelectorAll("button, input, select, textarea")) {
    if (runtimeAuthorityReadOnlyControlIds.has(control.id) || runtimeAuthorityIndependentControlIds.has(control.id)) {
      restoreRuntimeAuthorityControlState(control);
      continue;
    }
    if (disabled) {
      if (control.dataset.runtimeAuthorityDisabled !== "true") {
        control.dataset.runtimeAuthorityDisabled = "true";
        control.dataset.runtimeAuthorityPreviouslyDisabled = control.disabled && !runtimeAuthorityEnableWhenActiveControlIds.has(control.id) ? "true" : "false";
      }
      control.disabled = true;
    } else {
      restoreRuntimeAuthorityControlState(control);
    }
  }
}

function restoreRuntimeAuthorityControlState(control) {
  if (control.dataset.runtimeAuthorityDisabled !== "true") return;
  control.disabled = control.dataset.runtimeAuthorityPreviouslyDisabled === "true";
  delete control.dataset.runtimeAuthorityDisabled;
  delete control.dataset.runtimeAuthorityPreviouslyDisabled;
}

function guardRuntimeWorkspaceMutation(handler) {
  return async (...args) => {
    if (!await requireRuntimeWorkspaceAuthority()) {
      setIntakeStatus("This action is disabled because this panel does not own active workspace authority.");
      return undefined;
    }
    return handler(...args);
  };
}

function attachEventHandlers() {
  saveWorkspaceButton?.addEventListener("click", guardRuntimeWorkspaceMutation(saveWorkspaceDetails));
  workspaceTypeSelect?.addEventListener("change", guardRuntimeWorkspaceMutation(updateWorkspaceType));
  scanTabsButton?.addEventListener("click", guardRuntimeWorkspaceMutation(scanCurrentWindowTabs));
  addActiveTabButton?.addEventListener("click", guardRuntimeWorkspaceMutation(addActiveTabToWorkspace));
  selectAllScannedTabsButton?.addEventListener("click", selectAllScannedTabs);
  deselectAllScannedTabsButton?.addEventListener("click", deselectAllScannedTabs);
  addSelectedTabsButton?.addEventListener("click", guardRuntimeWorkspaceMutation(addSelectedTabsToWorkspace));
  clearScannedTabsButton?.addEventListener("click", clearScannedTabs);
  openSearchTabButton?.addEventListener("click", guardRuntimeWorkspaceMutation(openSearchTab));
  createChromeGroupsButton?.addEventListener("click", guardRuntimeWorkspaceMutation(createChromeTabGroupsFromWorkspace));
  removeChromeGroupsButton?.addEventListener("click", guardRuntimeWorkspaceMutation(removeAllChromeTabGroupsForWorkspace));
  refreshWorkspaceTabsButton?.addEventListener("click", guardRuntimeWorkspaceMutation(refreshWorkspaceTabMetadata));
  clearWorkspaceTabsButton?.addEventListener("click", guardRuntimeWorkspaceMutation(clearWorkspaceTabs));
  refreshTabStatusButton?.addEventListener("click", guardRuntimeWorkspaceMutation(refreshTabStatus));
  addJournalButton?.addEventListener("click", guardRuntimeWorkspaceMutation(saveJournalEntry));
  tabsList?.addEventListener("click", guardRuntimeWorkspaceMutation(handleTabsListClick));
  tabsList?.addEventListener("change", guardRuntimeWorkspaceMutation(handleTabsListChange));
  recoveryList?.addEventListener("click", guardRuntimeWorkspaceMutation(handleRecoveryClick));
  document.getElementById("collapseWorkspaceGroupsButton")?.addEventListener("click", guardRuntimeWorkspaceMutation(() => setWorkspaceChromeGroupsCollapsed(true)));
  document.getElementById("expandWorkspaceGroupsButton")?.addEventListener("click", guardRuntimeWorkspaceMutation(() => setWorkspaceChromeGroupsCollapsed(false)));
  document.getElementById("moveWorkspaceTabsToNewWindowButton")?.addEventListener("click", guardRuntimeWorkspaceMutation(moveWorkspaceTabsIntoNewWindow));
  document.getElementById("arrangeWorkspaceTabsByRoleButton")?.addEventListener("click", guardRuntimeWorkspaceMutation(arrangeWorkspaceTabsByRoleOrder));
  document.getElementById("reopenMissingWorkspaceTabsButton")?.addEventListener("click", guardRuntimeWorkspaceMutation(reopenAllMissingWorkspaceTabs));
  document.getElementById("copyWorkspaceUrlListButton")?.addEventListener("click", guardRuntimeWorkspaceMutation(copyWorkspaceUrlList));
  document.getElementById("refreshDuplicateUrlReviewButton")?.addEventListener("click", renderDuplicateUrlReview);
}

function populateWorkspaceTypeSelect() {
  if (!workspaceTypeSelect) return;
  clearElement(workspaceTypeSelect);
  WORKSPACE_TYPES.forEach((workspaceType) => {
    const option = document.createElement("option");
    option.value = workspaceType.id;
    option.textContent = workspaceType.label;
    workspaceTypeSelect.appendChild(option);
  });
}

async function migrateWorkspaceTabIds({ legacyCompatibilityRoute = false } = {}) {
  if (!legacyCompatibilityRoute) return validateAssignedWorkspaceTabIdsForStartup();

  // Retained only for an explicit legacy compatibility route. D3D-05 assigned
  // startup always takes the no-write validator above.
  if (!await requireRuntimeWorkspaceAuthority()) return false;
  const workspace = await getWorkspace();
  let changed = false;
  workspace.tabs.forEach((tab) => {
    if (!tab.workspaceTabId) {
      tab.workspaceTabId = crypto.randomUUID();
      changed = true;
    }
  });
  if (!changed) return false;
  if (!await requireRuntimeWorkspaceAuthority()) return false;
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  return true;
}

async function validateAssignedWorkspaceTabIdsForStartup() {
  const assignedRead = await assignedOrdinaryMutationGateway.resolveAssignedWorkspace();
  if (assignedRead.ok) return assignedRead;
  runtimeWorkspaceIdentityValidated = false;
  document.documentElement.dataset.runtimeWorkspaceAuthority = "blocked";
  document.documentElement.dataset.runtimeWorkspaceAuthorityReason = assignedRead.reason || "assigned_authority_unavailable";
  setAuthoritySensitiveControlsDisabled(true);
  if (assignedRead.reason === "runtime_workspace_identity_migration_required") {
    setIntakeStatus("Workspace authority is not verified. Authority-sensitive actions remain disabled: runtime_workspace_identity_migration_required.");
  } else {
    setIntakeStatus("Workspace authority is not verified. Authority-sensitive actions remain disabled: " + (assignedRead.reason || "assigned_authority_unavailable") + ".");
  }
  return assignedRead;
}

async function renderWorkspace(explicitAssignedWorkspace = null) {
  // Layer 2.3C readActiveWorkspaceReadonly remains available to old routes; assigned rendering intentionally does not call it.
  const workspace = explicitAssignedWorkspace || runtimeWorkspaceAuthority.assignedWorkspace;
  if (!workspace || typeof workspace !== "object" || Array.isArray(workspace) || !Array.isArray(workspace.tabs)) {
    setIntakeStatus("Workspace display is unavailable until this panel has exact verified assigned scoped state.");
    return;
  }
  if (workspaceNameInput) workspaceNameInput.value = workspace.name || "";
  if (workspaceAimInput) workspaceAimInput.value = workspace.aim || "";
  if (workspaceTypeSelect) workspaceTypeSelect.value = workspace.workspaceType || DEFAULT_WORKSPACE_TYPE;
  if (workspaceTypeDescription) workspaceTypeDescription.textContent = getWorkspaceTypeDescription(workspace.workspaceType || DEFAULT_WORKSPACE_TYPE);
  populateJournalRoleSelect(workspace.workspaceType || DEFAULT_WORKSPACE_TYPE);
  const resolution = await resolveWorkspaceTabsToLiveTabs(workspace);
  renderWorkspaceTabStatus(workspace, resolution.results);
  renderWorkspaceTabs(workspace, resolution.results);
  renderJournal(workspace);
  renderRecoveryJournal(workspace);
  renderSystemTimeline(workspace);
  await renderDuplicateUrlReview(workspace);
}

function populateJournalRoleSelect(workspaceType) {
  if (!journalRelatedRoleSelect) return;
  const currentValue = journalRelatedRoleSelect.value || "";
  clearElement(journalRelatedRoleSelect);
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "No specific group";
  journalRelatedRoleSelect.appendChild(allOption);
  getWorkspaceRoles(workspaceType).forEach((role) => {
    const option = document.createElement("option");
    option.value = role.id;
    option.textContent = role.label;
    journalRelatedRoleSelect.appendChild(option);
  });
  journalRelatedRoleSelect.value = currentValue;
}

async function saveWorkspaceDetails() {
  let submission = null;
  try {
    submission = await runWithWorkspaceMetadataWriter((snapshot) =>
      assignedWorkspaceMetadataMutationGateway.submitCommit({
        mode: "save",
        name: snapshot.name,
        aim: snapshot.aim,
        workspaceType: snapshot.workspaceType,
        eventId: crypto.randomUUID()
      })
    );
    if (!submission?.ok) {
      applyAssignedMetadataAuthorityState(submission?.authorityState);
      throw new Error(submission?.reason || submission?.status || "assigned metadata mutation failed");
    }
    setIntakeStatus("Workspace saved.");
  } catch (error) {
    setIntakeStatus("Workspace was not saved or verified: " + (error?.message || "metadata writer failed") + ".");
  }
  if (submission?.ok) await renderAssignedMetadataWorkspace(submission.authorityState);
}

async function updateWorkspaceType() {
  let submission = null;
  try {
    submission = await runWithWorkspaceMetadataWriter((snapshot) =>
      assignedWorkspaceMetadataMutationGateway.submitCommit({
        mode: "type_change",
        name: snapshot.name,
        aim: snapshot.aim,
        workspaceType: snapshot.workspaceType,
        eventId: crypto.randomUUID()
      })
    );
    if (!submission?.ok) {
      applyAssignedMetadataAuthorityState(submission?.authorityState);
      throw new Error(submission?.reason || submission?.status || "assigned metadata mutation failed");
    }
    setIntakeStatus(
      submission.result.status === "no_change"
        ? "Workspace metadata is already current."
        : "Workspace type changed."
    );
  } catch (error) {
    setIntakeStatus("Workspace type was not changed or verified: " + (error?.message || "metadata writer failed") + ".");
  }
  if (submission?.ok) await renderAssignedMetadataWorkspace(submission.authorityState);
}

async function renderAssignedMetadataWorkspace(authorityState) {
  const read = applyAssignedMetadataAuthorityState(authorityState);
  if (!read) return;
  await renderWorkspace(read.workspace);
}

function applyAssignedMetadataAuthorityState(authorityState) {
  const status = authorityState?.status || "blocked";
  document.documentElement.dataset.assignedWorkspaceMetadataAuthority = status;
  if (
    status !== "assigned" ||
    authorityState?.authority?.lifecycleState !== "available"
  ) {
    setAuthoritySensitiveControlsDisabled(true);
    setIntakeStatus(
      "Assigned workspace metadata is unavailable: " +
      (authorityState?.reason || status) + "."
    );
    return null;
  }

  const read = readAssignedWorkspaceRuntime(authorityState.authority);
  if (!read.ok) {
    setAuthoritySensitiveControlsDisabled(true);
    setIntakeStatus("Assigned workspace metadata is unavailable: invalid_assigned_authority.");
    return null;
  }

  return read;
}

async function appendAssignedOrdinaryTimelineEvent(type, message, details = {}) {
  const submission = await assignedOrdinaryMutationGateway.appendTimeline(type, message, details);
  if (!submission.ok) {
    applyAssignedOrdinaryMutationFailure(submission, "Timeline evidence was not saved or verified");
    return submission;
  }
  await renderAssignedOrdinaryMutationResult(submission);
  return submission;
}

async function readAssignedWorkspaceForOrdinaryAction() {
  const assignedRead = await assignedOrdinaryMutationGateway.resolveAssignedWorkspace();
  if (!assignedRead.ok) {
    applyAssignedOrdinaryMutationFailure(assignedRead, "Assigned workspace is unavailable");
    return null;
  }
  return assignedRead;
}

async function renderAssignedOrdinaryMutationResult(submission) {
  if (!submission?.ok) {
    applyAssignedOrdinaryMutationFailure(submission, "Assigned workspace mutation was not verified");
    return false;
  }
  if (!submission.refreshed || !submission.workspace) {
    runtimeWorkspaceIdentityValidated = false;
    setAuthoritySensitiveControlsDisabled(true);
    setIntakeStatus("Workspace mutation is verified, but refreshed assigned workspace state is unavailable: " + (submission.refreshReason || "assigned_workspace_refresh_failed") + ".");
    return true;
  }
  runtimeWorkspaceIdentityValidated = true;
  await renderWorkspace(submission.workspace);
  return true;
}

function applyAssignedOrdinaryMutationFailure(submission, prefix) {
  runtimeWorkspaceIdentityValidated = false;
  runtimeWorkspaceReadOnly = true;
  document.documentElement.dataset.runtimeWorkspaceAuthority = submission?.status || "blocked";
  document.documentElement.dataset.runtimeWorkspaceAuthorityReason = submission?.reason || "assigned_authority_unavailable";
  setAuthoritySensitiveControlsDisabled(true);
  setIntakeStatus(prefix + ": " + (submission?.reason || submission?.status || "assigned_authority_unavailable") + ".");
}

async function refreshAssignedWorkspaceAfterVerifiedMutation() {
  const assignedRead = await assignedOrdinaryMutationGateway.resolveAssignedWorkspace();
  if (!assignedRead.ok) {
    applyAssignedOrdinaryMutationFailure(assignedRead, "Assigned workspace refresh is unavailable");
    return;
  }
  runtimeWorkspaceIdentityValidated = true;
  await renderWorkspace(assignedRead.workspace);
}

async function scanCurrentWindowTabs() {
  availableTabs = await getCurrentWindowTabs();
  const submission = await appendAssignedOrdinaryTimelineEvent("tabs_scanned", "Scanned " + availableTabs.length + " tabs from current window.");
  if (!submission.ok) return;
  if (!submission.workspace) return;
  setIntakeStatus("Scanned " + availableTabs.length + " tabs from the current window.");
  await renderAvailableTabs(submission.workspace);
}

async function renderAvailableTabs(explicitAssignedWorkspace = null) {
  if (!availableTabsList) return;
  clearElement(availableTabsList);
  let workspace = explicitAssignedWorkspace;
  if (!workspace) {
    const workspaceRead = await readActiveWorkspaceReadonly();
    if (!workspaceRead.ok) { setIntakeStatus("Scanned-tab display refresh failed: " + workspaceRead.reason + "."); return; }
    workspace = workspaceRead.workspace;
  }
  if (!availableTabs.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No scanned tabs. Scan the current window to begin.";
    availableTabsList.appendChild(empty);
    return;
  }
  availableTabs.forEach((tab) => {
    const exactMatch = workspace.tabs.some((workspaceTab) => workspaceTab.tabId === tab.id);
    const sameUrlMatch = !exactMatch && workspace.tabs.some((workspaceTab) => workspaceTab.url && tab.url && workspaceTab.url === tab.url);
    const row = document.createElement("label");
    row.className = "available-tab-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "available-tab-checkbox";
    checkbox.value = String(tab.id);
    checkbox.disabled = exactMatch;
    row.appendChild(checkbox);
    const content = document.createElement("span");
    content.className = "available-tab-content";
    const title = document.createElement("span");
    title.className = "available-tab-title";
    title.textContent = tab.title || "Untitled tab";
    content.appendChild(title);
    const url = document.createElement("span");
    url.className = "available-tab-url";
    url.textContent = createDisplayUrl(tab.url || "");
    content.appendChild(url);
    const meta = document.createElement("span");
    meta.className = "tab-meta";
    meta.textContent = exactMatch ? "Already in workspace" : sameUrlMatch ? "Same URL already in workspace" : "Available";
    content.appendChild(meta);
    row.appendChild(content);
    availableTabsList.appendChild(row);
  });
}

function selectAllScannedTabs() {
  document.querySelectorAll(".available-tab-checkbox:not(:disabled)").forEach((checkbox) => { checkbox.checked = true; });
}

function deselectAllScannedTabs() {
  document.querySelectorAll(".available-tab-checkbox").forEach((checkbox) => { checkbox.checked = false; });
}

async function addSelectedTabsToWorkspace() {
  const selectedIds = Array.from(document.querySelectorAll(".available-tab-checkbox:checked")).map((checkbox) => Number(checkbox.value)).filter(Number.isInteger);
  if (!selectedIds.length) {
    await addTimelineEvent("selected_tabs_add_skipped", "No scanned tabs were selected for workspace intake.");
    setIntakeStatus("No scanned tabs selected.");
    return;
  }
  const workspaceRead = await readActiveWorkspaceReadonly();
  if (!workspaceRead.ok) { setIntakeStatus("Selected tabs were not added: " + workspaceRead.reason + "."); return; }
  const workspace = workspaceRead.workspace;
  const { added, exactSkippedCount, duplicateUrlAddedCount, missingCount } = planSelectedMembershipBatch({ workspaceTabs: workspace.tabs, availableTabs, selectedIds, createWorkspaceTab: createWorkspaceTabFromBrowserTab });
  if (!added.length) {
    await addTimelineEvent("selected_tabs_add_skipped", "No genuinely new scanned tabs required workspace membership mutation.", { exactSkippedCount, missingCount });
    setIntakeStatus("No genuinely new scanned tabs were added.");
    return;
  }
  setAuthoritySensitiveControlsDisabled(true);
  const sequence = await workspaceMembershipPromotionSequencer.sequenceWorkspaceMembershipPromotion({
    mutationKind: "selected_tab_batch",
    workspaceId: workspace.workspaceId,
    workspace,
    workspaceTabsToAdd: added,
    afterMembership: async () => addTimelineEvent("selected_tabs_added", "Added " + added.length + " selected tab(s) to workspace. Skipped " + exactSkippedCount + " exact existing tab(s). Allowed " + duplicateUrlAddedCount + " same-URL duplicate tab(s).", { addedCount: added.length, exactSkippedCount, duplicateUrlAddedCount, missingCount, intakeMatchingMode: "instance_aware" })
  });
  if (hasVerifiedMembership(sequence)) {
    availableTabs = [];
    await renderAvailableTabs();
  }
  const mayRenderSourceWorkspace = await setMembershipSequenceIntakeStatus(sequence, "selected scanned tab(s)");
  if (mayRenderSourceWorkspace) await renderWorkspace();
}

function clearScannedTabs() {
  availableTabs = [];
  setIntakeStatus("Cleared scanned tabs.");
  void renderAvailableTabs();
}

async function addActiveTabToWorkspace() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab) { setIntakeStatus("No active tab found."); return; }
  const browserTab = createBrowserTabSnapshot(activeTab);
  const workspaceRead = await readActiveWorkspaceReadonly();
  if (!workspaceRead.ok) { setIntakeStatus("Active tab was not added: " + workspaceRead.reason + "."); return; }
  const workspace = workspaceRead.workspace;
  const exactMatch = findExactBrowserMembership(workspace.tabs, browserTab.id);
  if (exactMatch) {
    await addTimelineEvent("active_tab_add_skipped", "Active tab is already in the workspace: " + getTabName(exactMatch) + ".", { tabId: browserTab.id, url: browserTab.url, workspaceTabId: exactMatch.workspaceTabId });
    setIntakeStatus("Active tab is already in the workspace.");
    return;
  }
  const sameUrlDuplicate = workspace.tabs.some((tab) => tab.url && browserTab.url && tab.url === browserTab.url);
  const workspaceTab = createWorkspaceTabFromBrowserTab(browserTab, { sameUrlDuplicate });
  setAuthoritySensitiveControlsDisabled(true);
  const sequence = await workspaceMembershipPromotionSequencer.sequenceWorkspaceMembershipPromotion({
    mutationKind: "active_tab",
    workspaceId: workspace.workspaceId,
    workspace,
    workspaceTabsToAdd: [workspaceTab],
    afterMembership: async () => addTimelineEvent("active_tab_added", "Added active tab to workspace: " + getTabName(workspaceTab) + ".", { tabId: workspaceTab.tabId, url: workspaceTab.url, workspaceTabId: workspaceTab.workspaceTabId, sameUrlDuplicate })
  });
  const mayRenderSourceWorkspace = await setMembershipSequenceIntakeStatus(sequence, "active tab");
  if (mayRenderSourceWorkspace) await renderWorkspace();
}

async function openSearchTab() {
  const query = searchQueryInput?.value?.trim() || "";
  if (!query) { setIntakeStatus("Enter a search query first."); return; }
  if (!await requireRuntimeWorkspaceAuthority()) { setIntakeStatus("Search intake is disabled until workspace authority is verified."); return; }
  const url = "https://www.google.com/search?q=" + encodeURIComponent(query);
  const createdTab = await chrome.tabs.create({ url, active: true });
  const browserTab = createBrowserTabSnapshot(createdTab);
  const workspaceRead = await readActiveWorkspaceReadonly();
  if (!workspaceRead.ok) {
    if (await requireRuntimeWorkspaceAuthority()) await addTimelineEvent("browser_search_tab_membership_failed", "Opened a search tab, but the active workspace could not be read for membership verification.", createBrowserTabMembershipFailureEvidence({ query, url, tabId: browserTab.id, reason: workspaceRead.reason }));
    setIntakeStatus("Search opened, but the tab was not added to the workspace. The browser tab remains open.");
    return;
  }
  const workspace = workspaceRead.workspace;
  const exactMatch = workspace.tabs.find((tab) => tab.tabId === browserTab.id);
  if (exactMatch) { setIntakeStatus("Search opened. Search tab is already in the workspace."); return; }
  const sameUrlDuplicate = workspace.tabs.some((tab) => tab.url && tab.url === url);
  const workspaceTab = createWorkspaceTabFromBrowserTab(browserTab, { originalTitle: browserTab.title || "Search: " + query, searchLaunchAutoIntake: true, searchQuery: query, sameUrlDuplicate });
  setAuthoritySensitiveControlsDisabled(true);
  const sequence = await workspaceMembershipPromotionSequencer.sequenceWorkspaceMembershipPromotion({
    mutationKind: "search_tab",
    workspaceId: workspace.workspaceId,
    workspace,
    workspaceTabsToAdd: [workspaceTab],
    afterMembership: async () => {
      await addTimelineEvent("browser_search_tab_opened", "Opened search tab for: " + query + ".", { query, url, tabId: browserTab.id });
      await addTimelineEvent("browser_search_tab_added_to_workspace", "Opened search tab and added it to the workspace: " + getTabName(workspaceTab) + ".", { query, tabId: workspaceTab.tabId, url: workspaceTab.url, workspaceTabId: workspaceTab.workspaceTabId, sameUrlDuplicate, searchLaunchAutoIntake: true });
    }
  });
  if (!hasVerifiedMembership(sequence)) {
    if (await requireRuntimeWorkspaceAuthority()) await addTimelineEvent("browser_search_tab_membership_failed", "Opened a search tab, but workspace membership was not verified. The browser tab remains open for recovery.", createBrowserTabMembershipFailureEvidence({ query, url, tabId: browserTab.id, reason: sequence.reason }));
  } else {
    window.setTimeout(() => void refreshWorkspaceTabMetadata({ silent: true }), 900);
  }
  const mayRenderSourceWorkspace = await setMembershipSequenceIntakeStatus(sequence, "search tab");
  if (mayRenderSourceWorkspace) await renderWorkspace();
}

function createWorkspaceTabFromBrowserTab(tab, extra = {}) {
  const now = new Date().toISOString();
  const title = extra.originalTitle || tab.title || "Untitled tab";
  const url = tab.url || "";
  return { workspaceTabId: crypto.randomUUID(), tabId: tab.id, tabKey: tab.tabKey || createTabKey(tab), windowId: tab.windowId, groupId: Number.isInteger(tab.groupId) ? tab.groupId : -1, url, displayUrl: createDisplayUrl(url), originalTitle: title, alias: "", role: "unassigned", isOpen: true, firstSeenAt: now, lastSeenAt: now, ...extra };
}

async function handleTabsListClick(event) {
  const button = event.target?.closest?.("button");
  if (!button) return;
  const workspaceTabId = button.dataset.workspaceTabId || "";
  const roleId = button.dataset.roleId || "";
  if (button.classList.contains("focus-tab-button")) await focusWorkspaceTab(workspaceTabId);
  else if (button.classList.contains("close-browser-tab-button")) await closeBrowserTabAndRemoveFromWorkspace(workspaceTabId);
  else if (button.classList.contains("remove-tab-button")) await removeWorkspaceTabAndCloseBrowserTab(workspaceTabId);
  else if (button.classList.contains("focus-group-button")) await focusWorkspaceRoleGroup(roleId);
  else if (button.classList.contains("remove-chrome-group-button")) await removeChromeGroupForRole(roleId);
}

async function handleTabsListChange(event) {
  const target = event.target;
  const workspaceTabId = target?.dataset?.workspaceTabId || "";
  if (!workspaceTabId) return;
  if (target.classList.contains("tab-alias-input")) await updateWorkspaceTabAlias(workspaceTabId, target.value);
  else if (target.classList.contains("tab-role-select")) await updateWorkspaceTabRole(workspaceTabId, target.value);
}

async function updateWorkspaceTabAlias(workspaceTabId, alias) {
  if (typeof workspaceTabId !== "string" || !workspaceTabId.trim()) {
    setIntakeStatus("Tab alias was not saved: runtime_workspace_identity_migration_required.");
    return;
  }
  const submission = await assignedOrdinaryMutationGateway.submit({
    mutationKind: "workspace.tab.metadata.commit",
    payload: {
      workspaceTabId,
      field: "alias",
      value: alias.trim(),
      eventId: crypto.randomUUID()
    }
  });
  if (!submission.ok) {
    applyAssignedOrdinaryMutationFailure(submission, "Tab alias was not saved or verified");
    return;
  }
  await renderAssignedOrdinaryMutationResult(submission);
}

async function updateWorkspaceTabRole(workspaceTabId, role) {
  if (typeof workspaceTabId !== "string" || !workspaceTabId.trim()) {
    setIntakeStatus("Tab role was not saved: runtime_workspace_identity_migration_required.");
    return;
  }
  const submission = await assignedOrdinaryMutationGateway.submit({
    mutationKind: "workspace.tab.metadata.commit",
    payload: {
      workspaceTabId,
      field: "role",
      value: role,
      eventId: crypto.randomUUID()
    }
  });
  if (!submission.ok) {
    applyAssignedOrdinaryMutationFailure(submission, "Tab role was not saved or verified");
    return;
  }
  await renderAssignedOrdinaryMutationResult(submission);
}

async function focusWorkspaceTab(workspaceTabId) {
  const workspace = await getWorkspace();
  const tab = workspace.tabs.find((item) => item.workspaceTabId === workspaceTabId);
  if (!tab) return;
  const result = await resolveSingleWorkspaceTabForAction(tab);
  if (!result.liveTab) {
    await addTimelineEvent("workspace_tab_focus_failed", "Could not focus tab because Chrome Flow could not safely find it in the browser.", { workspaceTabId, matchStatus: result.matchStatus, candidateCount: result.candidateCount });
    setIntakeStatus("Could not safely focus tab. Match status: " + result.matchStatus + ".");
    return;
  }
  await chrome.windows.update(result.liveTab.windowId, { focused: true });
  await chrome.tabs.update(result.liveTab.id, { active: true });
  await addTimelineEvent("workspace_tab_focused", "Focused workspace tab: " + getTabName(tab) + ".", { workspaceTabId, tabId: result.liveTab.id, windowId: result.liveTab.windowId, matchStatus: result.matchStatus });
}

async function closeBrowserTabAndRemoveFromWorkspace(workspaceTabId) {
  const workspace = await getWorkspace();
  const tabIndex = workspace.tabs.findIndex((tab) => tab.workspaceTabId === workspaceTabId);
  if (tabIndex < 0) return;
  const tab = workspace.tabs[tabIndex];
  const result = await resolveSingleWorkspaceTabForAction(tab);
  if (!result.liveTab) {
    await addTimelineEvent("browser_tab_close_failed", "Could not close browser tab because Chrome Flow could not safely find it.", { workspaceTabId, matchStatus: result.matchStatus, candidateCount: result.candidateCount });
    setIntakeStatus("Could not safely close tab. Match status: " + result.matchStatus + ".");
    return;
  }
  const confirmed = window.confirm("Close this browser tab and remove it from the workspace? Recovery will be available from the Recovery Journal.");
  if (!confirmed) return;
  const reason = window.prompt("Reason for closing this browser tab?", "");
  if (reason === null) return;
  const snapshot = createTabSnapshot(tab, workspace);
  await chrome.tabs.remove(result.liveTab.id);
  workspace.tabs.splice(tabIndex, 1);
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  await addTimelineEvent("browser_tab_closed_and_removed", "Closed browser tab and removed from workspace: " + snapshotName(snapshot) + ".", { workspaceTabId, reason: reason.trim() || "No reason recorded.", tabSnapshot: snapshot, matchStatus: result.matchStatus, recoveryActions: { canReopenUrl: true, canReaddToWorkspace: true } });
  await renderWorkspace();
}

async function removeWorkspaceTabAndCloseBrowserTab(workspaceTabId) {
  const workspace = await getWorkspace();
  const tabIndex = workspace.tabs.findIndex((tab) => tab.workspaceTabId === workspaceTabId);
  if (tabIndex < 0) return;
  const tab = workspace.tabs[tabIndex];
  const result = await resolveSingleWorkspaceTabForAction(tab);
  const confirmed = window.confirm("Remove this tab from the workspace and close the browser tab? Recovery will be available from the Recovery Journal.");
  if (!confirmed) return;
  const reason = window.prompt("Reason for removing this tab from the workspace and browser?", "");
  if (reason === null) return;
  const snapshot = createTabSnapshot(tab, workspace);
  let browserTabClosed = false;
  let closeError = null;
  if (result.liveTab) {
    try { await chrome.tabs.remove(result.liveTab.id); browserTabClosed = true; }
    catch (error) { closeError = summarizeError(error); }
  }
  workspace.tabs.splice(tabIndex, 1);
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  await addTimelineEvent("workspace_tab_removed", "Removed " + snapshotName(snapshot) + " from workspace" + (browserTabClosed ? " and closed the browser tab." : "."), { workspaceTabId, reason: reason.trim() || "No reason recorded.", tabSnapshot: snapshot, browserTabClosed, browserTabFound: Boolean(result.liveTab), liveTabId: result.liveTab?.id ?? null, liveWindowId: result.liveTab?.windowId ?? null, liveGroupId: result.liveTab?.groupId ?? null, closeError, removeMode: "remove_workspace_and_close_browser_tab", recoveryActions: { canReopenUrl: true, canReaddToWorkspace: true } });
  setIntakeStatus(browserTabClosed ? "Removed from workspace and closed browser tab." : "Removed from workspace. Browser tab was not safely found or could not be closed.");
  await renderWorkspace();
}

async function createChromeTabGroupsFromWorkspace() {
  const workspace = await getWorkspace();
  const resolution = await resolveWorkspaceTabsToLiveTabs(workspace);
  const groupedResults = resolution.results.filter((result) => result.liveTab);
  if (!groupedResults.length) {
    await addTimelineEvent("chrome_tab_grouping_skipped", "No open workspace tabs were found to group.", { resolutionMode: "stable_one_to_one" });
    setIntakeStatus("No open workspace tabs found to group.");
    return;
  }
  const groupSummary = await recreateChromeGroupsForResults(workspace, groupedResults);
  const skippedResolutionResults = resolution.results.filter((result) => !result.liveTab).map(summarizeResolutionResult);
  await refreshWorkspaceTabMetadata({ silent: true });
  await addTimelineEvent("chrome_tab_groups_created", "Created " + groupSummary.groups.length + " native Chrome tab group(s) from " + groupSummary.groupedTabCount + " open workspace tab(s). Skipped " + skippedResolutionResults.length + " missing or ambiguous tab(s).", { groups: groupSummary.groups, groupedTabCount: groupSummary.groupedTabCount, skippedCount: skippedResolutionResults.length, skippedResolutionResults, resolutionMode: "stable_one_to_one", resolutionResults: resolution.results.map(summarizeResolutionResult) });
  await renderWorkspace();
}

async function recreateChromeGroupsForResults(workspace, results) {
  const groupsByRoleAndWindow = groupBy(results, (result) => (result.workspaceTab.role || "unassigned") + "::" + result.liveTab.windowId);
  const roleOrder = createRoleOrderMap(workspace.workspaceType || DEFAULT_WORKSPACE_TYPE);
  const entries = Array.from(groupsByRoleAndWindow.entries()).sort(([, leftResults], [, rightResults]) => {
    const leftRole = leftResults[0]?.workspaceTab.role || "unassigned";
    const rightRole = rightResults[0]?.workspaceTab.role || "unassigned";
    return (roleOrder.get(leftRole) ?? 999) - (roleOrder.get(rightRole) ?? 999);
  });
  const groups = [];
  let groupedTabCount = 0;
  for (const [, roleResults] of entries) {
    const sortedResults = sortResultsByRoleOrder(workspace, roleResults);
    const tabIds = sortedResults.map((result) => result.liveTab.id);
    const roleId = sortedResults[0]?.workspaceTab.role || "unassigned";
    const windowId = sortedResults[0]?.liveTab.windowId;
    const roleLabel = getWorkspaceRoleLabel(workspace.workspaceType || DEFAULT_WORKSPACE_TYPE, roleId);
    if (!tabIds.length || !Number.isInteger(windowId)) continue;
    const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
    await chrome.tabGroups.update(groupId, { title: createChromeGroupTitle(workspace, roleLabel), collapsed: false });
    sortedResults.forEach((result) => {
      result.workspaceTab.groupId = groupId;
      result.workspaceTab.windowId = windowId;
      result.workspaceTab.lastSeenAt = new Date().toISOString();
      result.workspaceTab.lastMatchStatus = "exact_tab_id";
    });
    groupedTabCount += tabIds.length;
    groups.push({ groupId, roleId, roleLabel, tabIds, windowId, workspaceTabIds: sortedResults.map((result) => result.workspaceTab.workspaceTabId) });
  }
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  return { groups, groupedTabCount };
}

async function removeAllChromeTabGroupsForWorkspace() {
  const workspace = await getWorkspace();
  const resolution = await resolveWorkspaceTabsToLiveTabs(workspace);
  const liveTabs = resolution.results.filter((result) => result.liveTab).map((result) => result.liveTab);
  const groupIds = unique(liveTabs.filter((tab) => isValidChromeGroupId(tab.groupId)).map((tab) => tab.groupId));
  const tabIds = liveTabs.filter((tab) => isValidChromeGroupId(tab.groupId)).map((tab) => tab.id);
  if (!groupIds.length || !tabIds.length) {
    await addTimelineEvent("chrome_tab_groups_remove_skipped", "No native Chrome tab groups were found for this workspace.", { resolutionMode: "stable_one_to_one" });
    setIntakeStatus("No Chrome groups found for this workspace.");
    return;
  }
  await chrome.tabs.ungroup(tabIds);
  await refreshWorkspaceTabMetadata({ silent: true });
  await addTimelineEvent("chrome_tab_groups_removed", "Removed " + groupIds.length + " native Chrome tab group(s) for this workspace. Kept " + liveTabs.length + " browser tab(s) open.", { groupIds, tabIds: liveTabs.map((tab) => tab.id), resolutionMode: "stable_one_to_one", recoveryActions: { canRecreateChromeGroups: true } });
  await renderWorkspace();
}

async function setWorkspaceChromeGroupsCollapsed(collapsed) {
  const workspace = await getWorkspace();
  const resolution = await resolveWorkspaceTabsToLiveTabs(workspace);
  const groupIds = unique(resolution.results.filter((result) => result.liveTab && isValidChromeGroupId(result.liveTab.groupId)).map((result) => result.liveTab.groupId));
  if (!groupIds.length) {
    await addTimelineEvent("chrome_tab_groups_collapse_skipped", "No native Chrome tab groups were found for this workspace.", { collapsed, resolutionMode: "stable_one_to_one" });
    setAdvancedStatus("No native Chrome tab groups found for this workspace.");
    return;
  }
  for (const groupId of groupIds) await chrome.tabGroups.update(groupId, { collapsed });
  const eventType = collapsed ? "chrome_tab_groups_collapsed" : "chrome_tab_groups_expanded";
  const actionText = collapsed ? "Collapsed" : "Expanded";
  await addTimelineEvent(eventType, actionText + " " + groupIds.length + " native Chrome tab group(s) for this workspace.", { groupIds, collapsed, resolutionMode: "stable_one_to_one" });
  setAdvancedStatus(actionText + " " + groupIds.length + " workspace Chrome group(s).");
}

async function moveWorkspaceTabsIntoNewWindow() {
  if (moveWorkspaceIntoNewWindowInProgress) { setAdvancedStatus("Move Workspace Into New Window is already running. Please wait for it to finish."); return; }
  moveWorkspaceIntoNewWindowInProgress = true;
  const button = document.getElementById("moveWorkspaceTabsToNewWindowButton");
  if (button) button.disabled = true;
  let sourceAuthorityVerified = false;
  let transactionAttempted = false;
  let result = null;
  try {
    const workspaceRead = await readActiveWorkspaceReadonly();
    if (!workspaceRead.ok) { setAdvancedStatus("Move Workspace Into New Window was not started: " + workspaceRead.reason + "."); return; }
    let workspace = workspaceRead.workspace;
    const activationState = await runtimeWorkspaceAuthority.bootstrapExisting({ workspace, force: true });
    if (activationState.status !== "active") { setAdvancedStatus("Manual placement is disabled until this panel has verified workspace authority: " + (activationState.reason || "unknown_reason") + "."); return; }
    sourceAuthorityVerified = true;
    setAuthoritySensitiveControlsDisabled(true);
    await runWithWorkspaceMetadataBarrier(async () => undefined);
    const latestWorkspaceRead = await readActiveWorkspaceReadonly();
    if (!latestWorkspaceRead.ok) throw new Error("latest compatible workspace unavailable after metadata barrier");
    workspace = latestWorkspaceRead.workspace;
    const revision = normalizeWorkspaceRevision(workspace);
    if (!revision.valid) { setAdvancedStatus("Manual placement is blocked because the workspace revision is invalid."); return; }
    const resolution = await resolveWorkspaceTabsToLiveTabs(workspace);
    const liveResults = resolution.results.filter((result) => result.liveTab);
    if (!liveResults.length) {
      await addTimelineEvent("workspace_tabs_new_window_skipped", "No open workspace tabs were found to move into a new Chrome window.", { resolutionMode: "stable_one_to_one", newWindowCreationMode: "primary_tab_new_window_focus_recovery_v2" });
      setAdvancedStatus("No open workspace tabs found to move into a new window.");
      return;
    }
    const sortedResults = sortResultsByRoleOrder(workspace, liveResults);
    const sourceWindowIds = unique(sortedResults.map((result) => result.liveTab.windowId)).sort((left, right) => left - right);
    const groupsByRole = groupBy(sortedResults.filter((result) => (result.workspaceTab.role || "unassigned") !== "unassigned"), (result) => result.workspaceTab.role);
    const assignedRoleLabels = new Map(Array.from(groupsByRole.keys()).map((role) => [role, createChromeGroupTitle(workspace, getWorkspaceRoleLabel(workspace.workspaceType || DEFAULT_WORKSPACE_TYPE, role))]));
    const request = {
      schema: MOVE_REQUEST_SCHEMA, operationId: "pending-manual-placement", workspaceId: workspace.workspaceId, mode: "create_dedicated_window",
      sourceWindowIds, targetWindowId: null, requestedAt: new Date().toISOString(),
      tabs: sortedResults.map((result, order) => { const role = result.workspaceTab.role || "unassigned"; return { workspaceTabId: result.workspaceTab.workspaceTabId, tabId: result.liveTab.id, sourceWindowId: result.liveTab.windowId, sourceGroupId: Number.isInteger(result.liveTab.groupId) ? result.liveTab.groupId : -1, role, roleLabel: role === "unassigned" ? "Unassigned" : assignedRoleLabels.get(role), order }; }),
      groups: Array.from(groupsByRole.entries()).map(([role, results]) => ({ role, roleLabel: assignedRoleLabels.get(role), workspaceTabIds: results.map((result) => result.workspaceTab.workspaceTabId), collapsed: false }))
    };
    transactionAttempted = true;
    result = await workspaceManualPlacementClient.submit({
        workspaceId: workspace.workspaceId,
        sourceContextId: activationState.result.sourceContextId,
        sourceWindowId: activationState.result.sourceWindowId,
        expectedWorkspaceRevision: revision.revision,
        expectedRuntimeAssignmentId: activationState.result.currentRuntimeAssignmentId,
        expectedAssignmentEpoch: activationState.result.currentAssignmentEpoch,
        moveRequest: request
      });
    await refreshRuntimeAuthorityAfterVerifiedTransfer(result);
    if (["committed", "replayed"].includes(result.status) && result.assignmentVerified && result.workspacePlacementVerified) {
      setAdvancedStatus("Workspace placement, assignment, and tab metadata were verified in the dedicated Chrome window.");
    } else {
      setAdvancedStatus("Move Workspace Into New Window was not verified: " + result.status + " (" + result.reason + ").");
    }
  } catch (error) {
    if (transactionAttempted) await refreshRuntimeAuthorityAfterVerifiedTransfer(result || { status: "indeterminate" });
    if (!transactionAttempted && sourceAuthorityVerified) {
      const retainedAuthority = await runtimeWorkspaceAuthority.bootstrapExisting({ force: true });
      applyRuntimeWorkspaceAuthorityState(retainedAuthority);
      if (retainedAuthority.status === "active") await addTimelineEvent("workspace_tabs_new_window_failed", "Move Workspace Into New Window failed before Chrome Flow could start the private placement transaction.", { error: summarizeError(error), newWindowCreationMode: "primary_tab_new_window_focus_recovery_v2" });
    }
    setAdvancedStatus("Move Workspace Into New Window failed. Copy the diagnostic packet for review.");
  } finally {
    moveWorkspaceIntoNewWindowInProgress = false;
    setAuthoritySensitiveControlsDisabled(runtimeWorkspaceReadOnly);
  }
}

async function arrangeWorkspaceTabsByRoleOrder() {
  const workspace = await getWorkspace();
  const resolution = await resolveWorkspaceTabsToLiveTabs(workspace);
  const liveResults = resolution.results.filter((result) => result.liveTab);
  if (!liveResults.length) {
    await addTimelineEvent("workspace_tabs_arrange_skipped", "No open workspace tabs were found to arrange by role order.", { resolutionMode: "stable_one_to_one" });
    setAdvancedStatus("No open workspace tabs found to arrange.");
    return;
  }
  const resultsByWindow = groupBy(liveResults, (result) => String(result.liveTab.windowId));
  const movedTabIds = [];
  for (const [windowId, results] of resultsByWindow.entries()) {
    const sortedResults = sortResultsByRoleOrder(workspace, results);
    const tabIds = sortedResults.map((result) => result.liveTab.id);
    await chrome.tabs.move(tabIds, { windowId: Number(windowId), index: -1 });
    movedTabIds.push(...tabIds);
  }
  await refreshWorkspaceTabMetadata({ silent: true });
  await addTimelineEvent("workspace_tabs_arranged_by_role", "Arranged " + movedTabIds.length + " open workspace tab(s) by workspace role order.", { tabIds: movedTabIds, windowCount: resultsByWindow.size, resolutionMode: "stable_one_to_one" });
  setAdvancedStatus("Arranged " + movedTabIds.length + " workspace tab(s) by role order.");
  await renderWorkspace();
}

async function reopenAllMissingWorkspaceTabs() {
  const workspace = await getWorkspace();
  const resolution = await resolveWorkspaceTabsToLiveTabs(workspace);
  const missingResults = resolution.results.filter((result) => !result.liveTab && result.workspaceTab.url && isReopenableMissingStatus(result.matchStatus));
  const ambiguousResults = resolution.results.filter((result) => !result.liveTab && result.workspaceTab.url && result.matchStatus.startsWith("ambiguous"));
  if (!missingResults.length) {
    await addTimelineEvent("missing_workspace_tabs_reopen_skipped", "No safely missing workspace tabs were found to reopen. Missing tabs are records that still exist in the workspace while their live browser tab is gone; tabs closed through Chrome Flow are restored from Recovery Journal instead.", { ambiguousSkippedCount: ambiguousResults.length, resolutionMode: "stable_one_to_one", missingTabRule: "Close a workspace tab directly in Chrome, then run Refresh Workspace Tab Metadata before testing Reopen All Missing Tabs." });
    setAdvancedStatus("No safely missing workspace tabs found. To test this, close a workspace tab directly in Chrome, then refresh metadata.");
    return;
  }
  const reopened = [];
  for (const result of missingResults) {
    const createdTab = await chrome.tabs.create({ url: result.workspaceTab.url, active: false });
    const browserTab = createBrowserTabSnapshot(createdTab);
    updateWorkspaceTabFromLiveTab(result.workspaceTab, browserTab, { isOpen: true, lastOpenedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), lastMatchStatus: "reopened_missing_tab" });
    reopened.push({ workspaceTabId: result.workspaceTab.workspaceTabId, tabId: browserTab.id, url: browserTab.url });
  }
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  await addTimelineEvent("missing_workspace_tabs_reopened", "Reopened " + reopened.length + " missing workspace tab(s). Skipped " + ambiguousResults.length + " ambiguous tab(s).", { reopened, ambiguousSkippedCount: ambiguousResults.length, resolutionMode: "stable_one_to_one" });
  setAdvancedStatus("Reopened " + reopened.length + " missing workspace tab(s). Skipped " + ambiguousResults.length + " ambiguous tab(s).");
  await renderWorkspace();
}

async function copyWorkspaceUrlList() {
  const assignedRead = await readAssignedWorkspaceForOrdinaryAction();
  if (!assignedRead) return;
  const markdown = buildWorkspaceUrlListMarkdown(assignedRead.workspace);
  await navigator.clipboard.writeText(markdown);
  const submission = await appendAssignedOrdinaryTimelineEvent("workspace_url_list_copied", "Copied workspace URL list grouped by role.", { tabCount: assignedRead.workspace.tabs.length, format: "markdown" });
  if (!submission.ok) return;
  setAdvancedStatus("Workspace URL list copied as Markdown.");
}

async function refreshWorkspaceTabMetadata(options = {}) {
  if (!await requireRuntimeWorkspaceAuthority()) { setIntakeStatus("Workspace metadata refresh is disabled until active authority is verified."); return; }
  const workspace = await getWorkspace();
  const resolution = await resolveWorkspaceTabsToLiveTabs(workspace);
  let foundCount = 0;
  let missingCount = 0;
  let ambiguousCount = 0;
  resolution.results.forEach((result) => {
    if (result.liveTab) {
      updateWorkspaceTabFromLiveTab(result.workspaceTab, result.liveTab, { isOpen: true, lastSeenAt: new Date().toISOString(), lastMatchStatus: result.matchStatus });
      foundCount += 1;
    } else {
      result.workspaceTab.isOpen = false;
      result.workspaceTab.groupId = -1;
      result.workspaceTab.lastMatchStatus = result.matchStatus;
      if (result.matchStatus.startsWith("ambiguous")) ambiguousCount += 1;
      else missingCount += 1;
    }
  });
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  if (!options.silent) {
    await addTimelineEvent("workspace_tabs_refreshed", "Workspace tab metadata refreshed: " + foundCount + " found, " + missingCount + " missing, " + ambiguousCount + " ambiguous.", { foundCount, missingCount, ambiguousCount, resolutionMode: "stable_one_to_one" });
    setIntakeStatus("Workspace tab metadata refreshed.");
    await renderWorkspace();
  }
}

async function refreshTabStatus() {
  const assignedRead = await readAssignedWorkspaceForOrdinaryAction();
  if (!assignedRead) return;
  const resolution = await resolveWorkspaceTabsToLiveTabs(assignedRead.workspace);
  const status = calculateTabStatus(assignedRead.workspace, resolution.results);
  await appendAssignedOrdinaryTimelineEvent("workspace_tab_status_refreshed", "Tab status refreshed: " + status.openTabs + " open, " + status.missingTabs + " missing or ambiguous, " + status.groupedTabs + " grouped, " + status.ungroupedTabs + " ungrouped, " + status.unassignedTabs + " unassigned.", { ...status, resolutionMode: "stable_one_to_one" });
}

async function clearWorkspaceTabs() {
  const workspace = await getWorkspace();
  if (!workspace.tabs.length) { setIntakeStatus("Workspace has no tabs to clear."); return; }
  const confirmed = window.confirm("Clear all workspace tab records? Browser tabs will remain open.");
  if (!confirmed) return;
  const clearedCount = workspace.tabs.length;
  workspace.tabs = [];
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  await addTimelineEvent("workspace_tabs_cleared", "Cleared " + clearedCount + " workspace tab record(s). Browser tabs were kept open.", { clearedCount });
  setIntakeStatus("Workspace tab records cleared.");
  await renderWorkspace();
}

async function focusWorkspaceRoleGroup(roleId) {
  const workspace = await getWorkspace();
  const resolution = await resolveWorkspaceTabsToLiveTabs(workspace);
  const matchingResults = resolution.results.filter((result) => result.liveTab && (result.workspaceTab.role || "unassigned") === roleId).sort((left, right) => (left.liveTab.index ?? 0) - (right.liveTab.index ?? 0));
  if (!matchingResults.length) { setIntakeStatus("No open tabs found for that group."); return; }
  const target = matchingResults.find((result) => isValidChromeGroupId(result.liveTab.groupId)) || matchingResults[0];
  await chrome.windows.update(target.liveTab.windowId, { focused: true });
  await chrome.tabs.update(target.liveTab.id, { active: true });
  await addTimelineEvent("workspace_group_focused", "Focused " + getWorkspaceRoleLabel(workspace.workspaceType || DEFAULT_WORKSPACE_TYPE, roleId) + " group.", { roleId, tabId: target.liveTab.id, windowId: target.liveTab.windowId, groupId: target.liveTab.groupId });
}

async function removeChromeGroupForRole(roleId) {
  const workspace = await getWorkspace();
  const resolution = await resolveWorkspaceTabsToLiveTabs(workspace);
  const tabIds = resolution.results.filter((result) => result.liveTab && (result.workspaceTab.role || "unassigned") === roleId && isValidChromeGroupId(result.liveTab.groupId)).map((result) => result.liveTab.id);
  if (!tabIds.length) { setIntakeStatus("No Chrome group found for that role."); return; }
  await chrome.tabs.ungroup(tabIds);
  await refreshWorkspaceTabMetadata({ silent: true });
  await addTimelineEvent("chrome_tab_group_removed", "Removed Chrome group for " + getWorkspaceRoleLabel(workspace.workspaceType || DEFAULT_WORKSPACE_TYPE, roleId) + ". Kept browser tab(s) open.", { roleId, tabIds, recoveryActions: { canRecreateChromeGroups: true } });
  await renderWorkspace();
}

async function handleRecoveryClick(event) {
  const button = event.target?.closest?.("button");
  if (!button) return;
  const eventId = button.dataset.eventId || "";
  if (!eventId) return;
  if (button.classList.contains("timeline-reopen-url-button")) await reopenUrlFromTimeline(eventId);
  else if (button.classList.contains("timeline-readd-workspace-button")) await readdWorkspaceTabFromTimeline(eventId);
  else if (button.classList.contains("timeline-recreate-groups-button")) await createChromeTabGroupsFromWorkspace();
}

async function reopenUrlFromTimeline(eventId) {
  const workspace = await getWorkspace();
  if (!await requireRuntimeWorkspaceAuthority(workspace)) { setIntakeStatus("Recovery intake is disabled until workspace authority is verified."); return; }
  const sourceEvent = workspace.timeline.find((event) => event.eventId === eventId);
  const snapshot = sourceEvent?.tabSnapshot;
  const url = snapshot?.url || sourceEvent?.url || "";
  if (!url) { setIntakeStatus("No URL available to reopen."); return; }
  const createdTab = await chrome.tabs.create({ url, active: true });
  await addTimelineEvent("timeline_url_reopened", "Reopened URL from Recovery View: " + (snapshotName(snapshot) || createDisplayUrl(url)) + ".", { recoverySourceEventId: eventId, workspaceTabId: snapshot?.workspaceTabId || sourceEvent?.workspaceTabId || "", tabId: createdTab.id, url });
  await renderWorkspace();
}

async function readdWorkspaceTabFromTimeline(eventId) {
  const workspaceRead = await readActiveWorkspaceReadonly();
  if (!workspaceRead.ok) { setIntakeStatus("Recovery re-add was not started: " + workspaceRead.reason + "."); return; }
  const workspace = workspaceRead.workspace;
  if (!await requireRuntimeWorkspaceAuthority(workspace)) { setIntakeStatus("Recovery intake is disabled until workspace authority is verified."); return; }
  const sourceEvent = workspace.timeline.find((event) => event.eventId === eventId);
  const snapshot = sourceEvent?.tabSnapshot;
  if (!snapshot) { setIntakeStatus("No workspace tab snapshot available to re-add."); return; }
  let workspaceTab = workspace.tabs.find((tab) => tab.workspaceTabId === snapshot.workspaceTabId);
  const restoredExistingWorkspaceRecord = Boolean(workspaceTab);
  const liveTabs = await chrome.tabs.query({});
  const existingRecovery = classifyExistingRecoveryMembership(workspaceTab, liveTabs);
  if (restoredExistingWorkspaceRecord && existingRecovery.decision !== "existing_exact_live") {
    if (existingRecovery.decision === "existing_record_requires_refresh") {
      setIntakeStatus("Recovery re-add stopped: this workspace record already exists, but its saved browser tab is missing and a different live tab matches the URL. Use Refresh Workspace Tab Metadata before retrying.");
    } else if (existingRecovery.decision === "existing_record_ambiguous") {
      setIntakeStatus("Recovery re-add stopped: this workspace record already exists, but its saved browser tab is missing and multiple live tabs match the URL. Resolve the missing-tab state before retrying.");
    } else {
      setIntakeStatus("Recovery re-add stopped: this workspace record already exists, but its saved browser tab is missing. Use the existing missing-tab recovery flow before retrying.");
    }
    return;
  }
  let liveTab = restoredExistingWorkspaceRecord ? existingRecovery.liveTab : resolveLiveTabForSnapshot(snapshot, liveTabs);
  let browserTabAlreadyOpen = Boolean(liveTab);
  let browserTabReopened = false;
  let browserTabReused = false;
  let restoreMode = "readd_workspace_record";
  if (!liveTab) {
    const reopenedTab = findPreviouslyReopenedTabForRecovery(workspace, eventId, snapshot, liveTabs);
    if (reopenedTab) { liveTab = reopenedTab; browserTabReused = true; restoreMode = "readd_reused_reopened_url"; }
    else if (snapshot.url) { liveTab = await chrome.tabs.create({ url: snapshot.url, active: true }); browserTabReopened = true; restoreMode = "readd_reopened_url"; }
  }
  if (!liveTab) { setIntakeStatus("Recovery could not resolve or reopen a browser tab, so workspace membership was not requested."); return; }
  if (!workspaceTab) workspaceTab = createWorkspaceTabFromSnapshot(snapshot);
  if (liveTab && !restoredExistingWorkspaceRecord) updateWorkspaceTabFromLiveTab(workspaceTab, createBrowserTabSnapshot(liveTab), { isOpen: true, recoveredAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString(), lastMatchStatus: "exact_tab_id" });
  const message = browserTabReused ? "Re-added " + getTabName(workspaceTab) + " to workspace and reused the browser tab already reopened from Recovery View." : browserTabAlreadyOpen ? getTabName(workspaceTab) + " was already in the workspace and already open in the browser." : "Re-added " + getTabName(workspaceTab) + " to workspace from Recovery View.";
  setAuthoritySensitiveControlsDisabled(true);
  const sequence = await workspaceMembershipPromotionSequencer.sequenceWorkspaceMembershipPromotion({
    mutationKind: "recovery_readd",
    workspaceId: workspace.workspaceId,
    workspace,
    workspaceTabsToAdd: [workspaceTab],
    afterMembership: async () => {
      await restoreRecoveredTabToRoleGroup(eventId, workspaceTab.workspaceTabId);
      const newestRead = await readActiveWorkspaceReadonly();
      const newestTab = newestRead.ok ? newestRead.workspace.tabs.find((tab) => tab.workspaceTabId === workspaceTab.workspaceTabId) : workspaceTab;
      await addTimelineEvent("workspace_tab_readded", message, { recoverySourceEventId: eventId, workspaceTabId: workspaceTab.workspaceTabId, tabSnapshot: createTabSnapshot(newestTab || workspaceTab, newestRead.ok ? newestRead.workspace : workspace), restoredExistingWorkspaceRecord, browserTabAlreadyOpen, browserTabReopened, browserTabReused, restoreMode });
    }
  });
  if (!hasVerifiedMembership(sequence) && liveTab) {
    if (await requireRuntimeWorkspaceAuthority()) await addTimelineEvent("workspace_tab_readd_membership_failed", "A browser tab was resolved for recovery, but workspace membership was not verified. The browser tab remains open.", createBrowserTabMembershipFailureEvidence({ recoverySourceEventId: eventId, workspaceTabId: workspaceTab.workspaceTabId, tabId: liveTab.id, url: liveTab.url || snapshot.url || "", reason: sequence.reason, browserTabReopened, browserTabReused }));
  }
  const mayRenderSourceWorkspace = await setMembershipSequenceIntakeStatus(sequence, "recovered tab");
  if (mayRenderSourceWorkspace) await renderWorkspace();
}

async function restoreRecoveredTabToRoleGroup(recoverySourceEventId, workspaceTabId) {
  const workspace = await getWorkspace();
  const workspaceTab = workspace.tabs.find((tab) => tab.workspaceTabId === workspaceTabId);
  if (!workspaceTab) return;
  const liveTabs = await chrome.tabs.query({});
  const liveTab = resolveLiveTabForWorkspaceTab(workspaceTab, liveTabs);
  if (!liveTab) {
    await addTimelineEvent("recovered_tab_group_restore_skipped", "Could not restore recovered tab to a Chrome group because the live browser tab was not found.", { recoverySourceEventId, workspaceTabId, role: workspaceTab.role || "unassigned" });
    return;
  }
  const roleId = workspaceTab.role || "unassigned";
  const roleLabel = getWorkspaceRoleLabel(workspace.workspaceType || DEFAULT_WORKSPACE_TYPE, roleId);
  const groupTitle = createChromeGroupTitle(workspace, roleLabel);
  const sameRoleGroupedTabs = workspace.tabs.filter((tab) => tab.workspaceTabId !== workspaceTabId).filter((tab) => (tab.role || "unassigned") === roleId).map((tab) => resolveLiveTabForWorkspaceTab(tab, liveTabs)).filter(Boolean).filter((tab) => tab.windowId === liveTab.windowId && isValidChromeGroupId(tab.groupId));
  let targetGroupId = sameRoleGroupedTabs[0]?.groupId;
  let restoreMode = "added_to_existing_role_group";
  if (isValidChromeGroupId(targetGroupId)) {
    await chrome.tabs.group({ tabIds: [liveTab.id], groupId: targetGroupId });
    await chrome.tabGroups.update(targetGroupId, { title: groupTitle, collapsed: false });
  } else if (isValidChromeGroupId(liveTab.groupId)) {
    targetGroupId = liveTab.groupId;
    await chrome.tabGroups.update(targetGroupId, { title: groupTitle, collapsed: false });
    restoreMode = "already_grouped_title_refreshed";
  } else {
    targetGroupId = await chrome.tabs.group({ tabIds: [liveTab.id], createProperties: { windowId: liveTab.windowId } });
    await chrome.tabGroups.update(targetGroupId, { title: groupTitle, collapsed: false });
    restoreMode = "created_role_group_for_recovered_tab";
  }
  await refreshWorkspaceTabMetadata({ silent: true });
  await addTimelineEvent("recovered_tab_group_restored", "Restored recovered tab to its " + roleLabel + " Chrome group.", { recoverySourceEventId, workspaceTabId, tabId: liveTab.id, roleId, roleLabel, groupTitle, windowId: liveTab.windowId, groupId: targetGroupId, restoreMode });
}

function findPreviouslyReopenedTabForRecovery(workspace, recoverySourceEventId, tabSnapshot, liveTabs) {
  const reopenedEvents = [...workspace.timeline].reverse().filter((event) => event.type === "timeline_url_reopened" && event.recoverySourceEventId === recoverySourceEventId && Number.isInteger(event.tabId));
  for (const reopenedEvent of reopenedEvents) {
    const liveTab = liveTabs.find((tab) => tab.id === reopenedEvent.tabId);
    if (liveTab && (!tabSnapshot?.url || liveTab.url === tabSnapshot.url)) return liveTab;
  }
  return null;
}

async function saveJournalEntry() {
  const text = journalEntryInput?.value?.trim() || "";
  if (!text) return;
  const assignedRead = await readAssignedWorkspaceForOrdinaryAction();
  if (!assignedRead) return;
  const workspace = assignedRead.workspace;
  const relatedRoleId = journalRelatedRoleSelect?.value || "";
  const relatedRoleLabel = relatedRoleId ? getWorkspaceRoleLabel(workspace.workspaceType || DEFAULT_WORKSPACE_TYPE, relatedRoleId) : "";
  await journalAppendClient.submit({ authority: assignedRead.authority, entry: { text, tag: journalTagInput?.value?.trim() || "", relatedRoleId, relatedRoleLabel, createdAt: new Date().toISOString() } });
}

async function refreshJournalReadonly(){const assignedRead=await readAssignedWorkspaceForOrdinaryAction();if(!assignedRead)return;populateJournalRoleSelect(assignedRead.workspace.workspaceType||DEFAULT_WORKSPACE_TYPE);await renderWorkspace(assignedRead.workspace)}

function renderWorkspaceTabs(workspace, resolutionResults) {
  if (!tabsList) return;
  clearElement(tabsList);
  if (!workspace.tabs.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No tabs in this workspace yet.";
    tabsList.appendChild(empty);
    return;
  }
  createTabRoleGroups(workspace).forEach((group) => {
    const groupSection = document.createElement("section");
    groupSection.className = "workspace-role-group";
    const header = document.createElement("div");
    header.className = "workspace-role-group-header";
    const heading = document.createElement("h3");
    heading.textContent = group.label + " (" + group.tabs.length + ")";
    header.appendChild(heading);
    const actions = document.createElement("div");
    actions.className = "workspace-role-group-actions";
    const focusButton = document.createElement("button");
    focusButton.type = "button";
    focusButton.className = "secondary-button focus-group-button";
    focusButton.dataset.roleId = group.roleId;
    focusButton.textContent = "Focus Group";
    actions.appendChild(focusButton);
    const removeGroupButton = document.createElement("button");
    removeGroupButton.type = "button";
    removeGroupButton.className = "secondary-button remove-chrome-group-button";
    removeGroupButton.dataset.roleId = group.roleId;
    removeGroupButton.textContent = "Remove Chrome Group";
    actions.appendChild(removeGroupButton);
    header.appendChild(actions);
    groupSection.appendChild(header);
    group.tabs.forEach((tab) => {
      const resolution = resolutionResults.find((result) => result.workspaceTab.workspaceTabId === tab.workspaceTabId);
      groupSection.appendChild(createWorkspaceTabCard(workspace, tab, resolution));
    });
    tabsList.appendChild(groupSection);
  });
}

function createWorkspaceTabCard(workspace, tab, resolution) {
  const card = document.createElement("article");
  card.className = "workspace-tab-card";
  card.dataset.workspaceTabId = tab.workspaceTabId || "";
  const title = document.createElement("h4");
  title.textContent = getTabName(tab);
  card.appendChild(title);
  const url = document.createElement("p");
  url.className = "tab-url";
  url.textContent = tab.displayUrl || createDisplayUrl(tab.url || "");
  card.appendChild(url);
  const badges = document.createElement("div");
  badges.className = "tab-state-badges";
  createWorkspaceTabStateBadges(tab, resolution).forEach((badge) => badges.appendChild(badge));
  card.appendChild(badges);
  const aliasLabel = document.createElement("label");
  aliasLabel.textContent = "Alias";
  const aliasInput = document.createElement("input");
  aliasInput.type = "text";
  aliasInput.className = "tab-alias-input";
  aliasInput.dataset.workspaceTabId = tab.workspaceTabId || "";
  aliasInput.value = tab.alias || "";
  aliasLabel.appendChild(aliasInput);
  card.appendChild(aliasLabel);
  const roleLabel = document.createElement("label");
  roleLabel.textContent = "Role";
  const roleSelect = document.createElement("select");
  roleSelect.className = "tab-role-select";
  roleSelect.dataset.workspaceTabId = tab.workspaceTabId || "";
  getWorkspaceRoles(workspace.workspaceType || DEFAULT_WORKSPACE_TYPE).forEach((role) => {
    const option = document.createElement("option");
    option.value = role.id;
    option.textContent = role.label;
    roleSelect.appendChild(option);
  });
  roleSelect.value = tab.role || "unassigned";
  roleLabel.appendChild(roleSelect);
  card.appendChild(roleLabel);
  const actions = document.createElement("div");
  actions.className = "tab-actions";
  const focusButton = document.createElement("button");
  focusButton.type = "button";
  focusButton.className = "secondary-button focus-tab-button";
  focusButton.dataset.workspaceTabId = tab.workspaceTabId || "";
  focusButton.textContent = "Focus Tab";
  actions.appendChild(focusButton);
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "danger-button close-browser-tab-button";
  closeButton.dataset.workspaceTabId = tab.workspaceTabId || "";
  closeButton.textContent = "Close Browser Tab";
  actions.appendChild(closeButton);
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "danger-button remove-tab-button";
  removeButton.dataset.workspaceTabId = tab.workspaceTabId || "";
  removeButton.textContent = "Remove + Close Tab";
  actions.appendChild(removeButton);
  card.appendChild(actions);
  return card;
}

function createWorkspaceTabStateBadges(tab, resolution) {
  const badges = [];
  badges.push(createBadge("Record " + (tab.workspaceTabId || "").slice(0, 8), "record-status-badge"));
  if (resolution?.liveTab) badges.push(createBadge("Open", "browser-status-badge open"));
  else if (resolution?.matchStatus?.startsWith("ambiguous")) badges.push(createBadge("Ambiguous", "browser-status-badge ambiguous"));
  else badges.push(createBadge("Missing", "browser-status-badge closed"));
  const groupId = resolution?.liveTab?.groupId ?? tab.groupId;
  badges.push(isValidChromeGroupId(groupId) ? createBadge("Grouped", "group-status-badge grouped") : createBadge("Ungrouped", "group-status-badge ungrouped"));
  if (!tab.role || tab.role === "unassigned") badges.push(createBadge("Unassigned", "role-status-badge unassigned"));
  if (resolution?.matchStatus) badges.push(createBadge(resolution.matchStatus, "match-status-badge"));
  return badges;
}

function createBadge(text, className) {
  const badge = document.createElement("span");
  badge.className = className;
  badge.textContent = text;
  return badge;
}

function renderWorkspaceTabStatus(workspace, resolutionResults) {
  const status = calculateTabStatus(workspace, resolutionResults);
  if (statusTotalTabs) statusTotalTabs.textContent = String(status.totalTabs);
  if (statusOpenTabs) statusOpenTabs.textContent = String(status.openTabs);
  if (statusMissingTabs) statusMissingTabs.textContent = String(status.missingTabs);
  if (statusGroupedTabs) statusGroupedTabs.textContent = String(status.groupedTabs);
  if (statusUngroupedTabs) statusUngroupedTabs.textContent = String(status.ungroupedTabs);
  if (statusUnassignedTabs) statusUnassignedTabs.textContent = String(status.unassignedTabs);
}

function calculateTabStatus(workspace, resolutionResults) {
  const totalTabs = workspace.tabs.length;
  let openTabs = 0, missingTabs = 0, groupedTabs = 0, ungroupedTabs = 0, unassignedTabs = 0;
  resolutionResults.forEach((result) => {
    if (result.liveTab) {
      openTabs += 1;
      if (isValidChromeGroupId(result.liveTab.groupId)) groupedTabs += 1;
      else ungroupedTabs += 1;
    } else missingTabs += 1;
    if (!result.workspaceTab.role || result.workspaceTab.role === "unassigned") unassignedTabs += 1;
  });
  return { totalTabs, openTabs, missingTabs, groupedTabs, ungroupedTabs, unassignedTabs };
}

function renderJournal(workspace) {
  if (!journalList) return;
  clearElement(journalList);
  if (!workspace.journal.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No journal entries yet.";
    journalList.appendChild(empty);
    return;
  }
  [...workspace.journal].reverse().forEach((entry) => {
    const article = document.createElement("article");
    article.className = "journal-entry-card";
    const text = document.createElement("p");
    text.textContent = entry.text;
    article.appendChild(text);
    const meta = document.createElement("p");
    meta.className = "tab-meta";
    meta.textContent = [entry.tag, entry.relatedRoleLabel, entry.createdAt].filter(Boolean).join(" · ");
    article.appendChild(meta);
    journalList.appendChild(article);
  });
}

function renderRecoveryJournal(workspace) {
  if (!recoveryList) return;
  clearElement(recoveryList);
  const recoverableEvents = workspace.timeline.filter(isRecoverableEvent).reverse();
  if (!recoverableEvents.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No recovery events yet.";
    recoveryList.appendChild(empty);
    return;
  }
  recoverableEvents.forEach((event) => {
    const article = document.createElement("article");
    article.className = "timeline-event-card recovery-event-card";
    const title = document.createElement("h4");
    title.textContent = event.message || event.type;
    article.appendChild(title);
    const meta = document.createElement("p");
    meta.className = "tab-meta";
    meta.textContent = event.createdAt || "";
    article.appendChild(meta);
    const actions = document.createElement("div");
    actions.className = "recovery-actions";
    if (event.recoveryActions?.canReopenUrl || event.tabSnapshot?.url) {
      const reopenButton = document.createElement("button");
      reopenButton.type = "button";
      reopenButton.className = "secondary-button timeline-reopen-url-button";
      reopenButton.disabled = runtimeWorkspaceReadOnly;
      reopenButton.dataset.eventId = event.eventId;
      reopenButton.textContent = "Reopen URL";
      actions.appendChild(reopenButton);
    }
    if (event.recoveryActions?.canReaddToWorkspace || event.tabSnapshot) {
      const readdButton = document.createElement("button");
      readdButton.type = "button";
      readdButton.className = "secondary-button timeline-readd-workspace-button";
      readdButton.disabled = runtimeWorkspaceReadOnly;
      readdButton.dataset.eventId = event.eventId;
      readdButton.textContent = "Re-add to Workspace";
      actions.appendChild(readdButton);
    }
    if (event.recoveryActions?.canRecreateChromeGroups) {
      const recreateButton = document.createElement("button");
      recreateButton.type = "button";
      recreateButton.className = "secondary-button timeline-recreate-groups-button";
      recreateButton.dataset.eventId = event.eventId;
      recreateButton.textContent = "Recreate Chrome Groups";
      actions.appendChild(recreateButton);
    }
    article.appendChild(actions);
    recoveryList.appendChild(article);
  });
}

function renderSystemTimeline(workspace) {
  if (!systemTimelineList) return;
  clearElement(systemTimelineList);
  if (!workspace.timeline.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No system events yet.";
    systemTimelineList.appendChild(empty);
    return;
  }
  [...workspace.timeline].reverse().slice(0, 80).forEach((event) => {
    const article = document.createElement("article");
    article.className = "timeline-event-card";
    const title = document.createElement("h4");
    title.textContent = event.type;
    article.appendChild(title);
    const message = document.createElement("p");
    message.textContent = event.message || "";
    article.appendChild(message);
    const meta = document.createElement("p");
    meta.className = "tab-meta";
    meta.textContent = event.createdAt || "";
    article.appendChild(meta);
    systemTimelineList.appendChild(article);
  });
}

function renderAdvancedTabControls() {
  if (document.getElementById("advancedTabControlsSection")) return;
  const tabsSection = document.querySelector(".tabs-section");
  if (!tabsSection) return;
  const section = document.createElement("section");
  section.id = "advancedTabControlsSection";
  section.className = "advanced-tab-controls-section";
  const heading = document.createElement("h2");
  heading.textContent = "Advanced Tab Controls";
  section.appendChild(heading);
  const help = document.createElement("p");
  help.className = "section-help";
  help.textContent = "Deterministic workspace tab operations for group collapse/expand, new-window workspace organisation, role ordering, missing-tab recovery, URL export, and duplicate URL review.";
  section.appendChild(help);
  const actions = document.createElement("div");
  actions.className = "advanced-tab-actions-grid";
  actions.appendChild(createButton("collapseWorkspaceGroupsButton", "Collapse Workspace Chrome Groups", "secondary-button"));
  actions.appendChild(createButton("expandWorkspaceGroupsButton", "Expand Workspace Chrome Groups", "secondary-button"));
  const moveWorkspaceButton = createButton("moveWorkspaceTabsToNewWindowButton", "Move Workspace Into New Window", "secondary-button");
  moveWorkspaceButton.disabled = true;
  actions.appendChild(moveWorkspaceButton);
  actions.appendChild(createButton("arrangeWorkspaceTabsByRoleButton", "Arrange Tabs by Role Order", "secondary-button"));
  actions.appendChild(createButton("reopenMissingWorkspaceTabsButton", "Reopen All Missing Tabs", "secondary-button"));
  actions.appendChild(createButton("copyWorkspaceUrlListButton", "Copy Workspace URL List", "secondary-button"));
  actions.appendChild(createButton("refreshDuplicateUrlReviewButton", "Refresh Duplicate URL Review", "secondary-button"));
  section.appendChild(actions);
  const status = document.createElement("p");
  status.id = "advancedTabControlsStatus";
  status.className = "status-message";
  section.appendChild(status);
  const note = document.createElement("p");
  note.className = "section-help advanced-tab-note";
  note.textContent = "Move Workspace Into New Window creates a focused workspace window and recreates role groups after the move.";
  section.appendChild(note);
  const duplicatePanel = document.createElement("div");
  duplicatePanel.id = "duplicateUrlReviewPanel";
  duplicatePanel.className = "duplicate-url-review-panel";
  const duplicateHeading = document.createElement("h3");
  duplicateHeading.textContent = "Duplicate URL Review";
  duplicatePanel.appendChild(duplicateHeading);
  const duplicateHelp = document.createElement("p");
  duplicateHelp.className = "section-help";
  duplicateHelp.textContent = "Same-URL workspace records are allowed. Review them here deliberately.";
  duplicatePanel.appendChild(duplicateHelp);
  const duplicateList = document.createElement("div");
  duplicateList.id = "duplicateUrlReviewList";
  duplicatePanel.appendChild(duplicateList);
  section.appendChild(duplicatePanel);
  tabsSection.insertAdjacentElement("afterend", section);
}

async function renderDuplicateUrlReview(explicitAssignedWorkspace = null) {
  const list = document.getElementById("duplicateUrlReviewList");
  if (!list) return;
  clearElement(list);
  let workspace = explicitAssignedWorkspace;
  if (!workspace) {
    const assignedRead = await readAssignedWorkspaceForOrdinaryAction();
    if (!assignedRead) { setAdvancedStatus("Duplicate URL review could not read assigned workspace state."); return; }
    workspace = assignedRead.workspace;
  }
  const duplicateGroups = getDuplicateUrlGroups(workspace);
  if (!duplicateGroups.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No duplicate URLs in the current workspace.";
    list.appendChild(empty);
    return;
  }
  duplicateGroups.forEach((group) => {
    const card = document.createElement("article");
    card.className = "duplicate-url-card";
    const title = document.createElement("h4");
    title.textContent = group.displayUrl + " (" + group.tabs.length + ")";
    card.appendChild(title);
    group.tabs.forEach((tab) => {
      const row = document.createElement("div");
      row.className = "duplicate-url-row";
      const summary = document.createElement("p");
      summary.textContent = getTabName(tab) + " | " + getWorkspaceRoleLabel(workspace.workspaceType || DEFAULT_WORKSPACE_TYPE, tab.role || "unassigned") + " | Record " + (tab.workspaceTabId || "").slice(0, 8);
      row.appendChild(summary);
      const aliasInput = document.createElement("input");
      aliasInput.type = "text";
      aliasInput.value = tab.alias || "";
      aliasInput.placeholder = "Alias this duplicate tab...";
      row.appendChild(aliasInput);
      const actions = document.createElement("div");
      actions.className = "duplicate-url-actions";
      actions.appendChild(createActionButton("Apply Alias", "secondary-button", guardRuntimeWorkspaceMutation(() => updateWorkspaceTabAlias(tab.workspaceTabId, aliasInput.value))));
      actions.appendChild(createActionButton("Focus Tab", "secondary-button", guardRuntimeWorkspaceMutation(() => focusWorkspaceTab(tab.workspaceTabId))));
      actions.appendChild(createActionButton("Remove + Close", "danger-button", guardRuntimeWorkspaceMutation(() => removeWorkspaceTabAndCloseBrowserTab(tab.workspaceTabId))));
      row.appendChild(actions);
      card.appendChild(row);
    });
    list.appendChild(card);
  });
}

function buildWorkspaceUrlListMarkdown(workspace) {
  const lines = [];
  lines.push("# " + (workspace.name || "Untitled Workspace") + " — Workspace URL List");
  lines.push("");
  lines.push("Generated by Chrome Flow on " + new Date().toISOString() + ".");
  lines.push("");
  createTabRoleGroups(workspace).forEach((group) => {
    lines.push("## " + group.label);
    lines.push("");
    group.tabs.forEach((tab) => {
      const label = getTabName(tab).replace(/[\[\]]/g, "");
      lines.push("- [" + label + "](" + (tab.url || "") + ")");
    });
    lines.push("");
  });
  return lines.join("\n");
}

function getDuplicateUrlGroups(workspace) {
  const groups = groupBy(workspace.tabs.filter((tab) => tab.url), (tab) => tab.url);
  return Array.from(groups.entries()).filter(([, tabs]) => tabs.length > 1).map(([url, tabs]) => ({ url, displayUrl: createDisplayUrl(url), tabs }));
}

async function resolveWorkspaceTabsToLiveTabs(workspace) {
  const browserTabs = await getAllBrowserTabs();
  const consumedLiveTabIds = new Set();
  const results = [];
  workspace.tabs.forEach((workspaceTab) => {
    const result = resolveWorkspaceTabAgainstBrowserTabs(workspaceTab, browserTabs, consumedLiveTabIds);
    if (result.liveTab) consumedLiveTabIds.add(result.liveTab.id);
    results.push(result);
  });
  return { browserTabs, results };
}

async function resolveSingleWorkspaceTabForAction(workspaceTab) {
  const browserTabs = await getAllBrowserTabs();
  return resolveWorkspaceTabAgainstBrowserTabs(workspaceTab, browserTabs, new Set());
}

function resolveWorkspaceTabAgainstBrowserTabs(workspaceTab, browserTabs, consumedLiveTabIds) {
  if (Number.isInteger(workspaceTab.tabId)) {
    const exactTab = browserTabs.find((tab) => tab.id === workspaceTab.tabId);
    if (exactTab && !consumedLiveTabIds.has(exactTab.id)) return createResolutionResult(workspaceTab, exactTab, "exact_tab_id", 1);
    if (exactTab && consumedLiveTabIds.has(exactTab.id)) {
      const unconsumedUrlMatches = findUnconsumedUrlMatches(workspaceTab, browserTabs, consumedLiveTabIds);
      if (unconsumedUrlMatches.length === 1) return createResolutionResult(workspaceTab, unconsumedUrlMatches[0], "exact_tab_id_consumed_single_url_repair", 1);
      return createResolutionResult(workspaceTab, null, "exact_tab_id_consumed", unconsumedUrlMatches.length);
    }
  }
  const urlMatches = findUnconsumedUrlMatches(workspaceTab, browserTabs, consumedLiveTabIds);
  if (urlMatches.length === 1) return createResolutionResult(workspaceTab, urlMatches[0], "single_url_fallback", 1);
  if (urlMatches.length > 1) return createResolutionResult(workspaceTab, null, "ambiguous_url_matches", urlMatches.length);
  return createResolutionResult(workspaceTab, null, "not_found", 0);
}

function findUnconsumedUrlMatches(workspaceTab, browserTabs, consumedLiveTabIds) {
  return browserTabs.filter((tab) => !consumedLiveTabIds.has(tab.id) && workspaceTab.url && tab.url === workspaceTab.url);
}

function createResolutionResult(workspaceTab, liveTab, matchStatus, candidateCount) {
  return { workspaceTab, liveTab, matchStatus, candidateCount };
}

function resolveLiveTabForWorkspaceTab(workspaceTab, liveTabs) {
  if (Number.isInteger(workspaceTab.tabId)) {
    const exact = liveTabs.find((tab) => tab.id === workspaceTab.tabId);
    if (exact) return exact;
  }
  return resolveLiveTabForSnapshot(workspaceTab, liveTabs);
}

function resolveLiveTabForSnapshot(snapshot, liveTabs) {
  const urlMatches = liveTabs.filter((tab) => snapshot.url && tab.url === snapshot.url);
  return urlMatches.length === 1 ? urlMatches[0] : null;
}

function summarizeResolutionResult(result) {
  return { workspaceTabId: result.workspaceTab.workspaceTabId, savedTabId: result.workspaceTab.tabId, savedUrl: result.workspaceTab.url, role: result.workspaceTab.role || "unassigned", alias: result.workspaceTab.alias || "", matchStatus: result.matchStatus, candidateCount: result.candidateCount, liveTabId: result.liveTab?.id ?? null, liveWindowId: result.liveTab?.windowId ?? null, liveGroupId: result.liveTab?.groupId ?? null };
}

function updateWorkspaceTabFromLiveTab(workspaceTab, liveTab, extra = {}) {
  workspaceTab.tabId = liveTab.id;
  workspaceTab.tabKey = liveTab.tabKey || createTabKey(liveTab);
  workspaceTab.windowId = liveTab.windowId;
  workspaceTab.groupId = Number.isInteger(liveTab.groupId) ? liveTab.groupId : -1;
  workspaceTab.url = liveTab.url || workspaceTab.url;
  workspaceTab.displayUrl = createDisplayUrl(workspaceTab.url || "");
  workspaceTab.originalTitle = liveTab.title || workspaceTab.originalTitle;
  workspaceTab.isOpen = true;
  workspaceTab.lastSeenAt = new Date().toISOString();
  Object.assign(workspaceTab, extra);
}

function createWorkspaceTabFromSnapshot(snapshot) {
  return { workspaceTabId: snapshot.workspaceTabId || crypto.randomUUID(), tabId: snapshot.tabId, tabKey: snapshot.tabKey, windowId: snapshot.windowId, groupId: Number.isInteger(snapshot.groupId) ? snapshot.groupId : -1, url: snapshot.url || "", displayUrl: snapshot.displayUrl || createDisplayUrl(snapshot.url || ""), originalTitle: snapshot.originalTitle || "Untitled tab", alias: snapshot.alias || "", role: snapshot.role || "unassigned", isOpen: false, firstSeenAt: snapshot.firstSeenAt || new Date().toISOString(), lastSeenAt: snapshot.lastSeenAt || "", recoveredAt: new Date().toISOString() };
}

function createTabSnapshot(tab, workspace) {
  return { workspaceTabId: tab.workspaceTabId, tabId: tab.tabId, tabKey: tab.tabKey, windowId: tab.windowId, groupId: tab.groupId, url: tab.url, displayUrl: tab.displayUrl || createDisplayUrl(tab.url || ""), originalTitle: tab.originalTitle, alias: tab.alias || "", role: tab.role || "unassigned", workspaceType: workspace.workspaceType || DEFAULT_WORKSPACE_TYPE, isOpen: tab.isOpen !== false, firstSeenAt: tab.firstSeenAt, lastSeenAt: tab.lastSeenAt, capturedAt: new Date().toISOString() };
}

function createTabRoleGroups(workspace) {
  const workspaceType = workspace.workspaceType || DEFAULT_WORKSPACE_TYPE;
  const roleGroups = getWorkspaceRoles(workspaceType).map((role) => ({ roleId: role.id, label: role.label, tabs: [] }));
  const legacyGroups = [];
  workspace.tabs.forEach((tab) => {
    const roleId = tab.role || "unassigned";
    const group = roleGroups.find((item) => item.roleId === roleId);
    if (group) { group.tabs.push(tab); return; }
    let legacyGroup = legacyGroups.find((item) => item.roleId === roleId);
    if (!legacyGroup) { legacyGroup = { roleId, label: getWorkspaceRoleLabel(workspaceType, roleId), tabs: [] }; legacyGroups.push(legacyGroup); }
    legacyGroup.tabs.push(tab);
  });
  return roleGroups.filter((group) => group.tabs.length > 0).concat(legacyGroups);
}

function sortResultsByRoleOrder(workspace, results) {
  const roleOrder = createRoleOrderMap(workspace.workspaceType || DEFAULT_WORKSPACE_TYPE);
  return [...results].sort((left, right) => {
    const leftRole = roleOrder.get(left.workspaceTab.role || "unassigned") ?? 999;
    const rightRole = roleOrder.get(right.workspaceTab.role || "unassigned") ?? 999;
    if (leftRole !== rightRole) return leftRole - rightRole;
    return (left.liveTab.index ?? 0) - (right.liveTab.index ?? 0);
  });
}

function createRoleOrderMap(workspaceType) {
  const map = new Map();
  getWorkspaceRoles(workspaceType).forEach((role, index) => map.set(role.id, index));
  return map;
}

function isRecoverableEvent(event) {
  return Boolean(event.recoveryActions?.canReopenUrl || event.recoveryActions?.canReaddToWorkspace || event.recoveryActions?.canRecreateChromeGroups || event.tabSnapshot);
}

function isReopenableMissingStatus(matchStatus) {
  return MISSING_REOPEN_STATUSES.has(matchStatus);
}

async function focusNormalWindow(windowId) {
  if (!Number.isInteger(windowId)) return;
  try {
    await chrome.windows.update(windowId, { state: "normal" });
    await chrome.windows.update(windowId, { focused: true });
  } catch (error) { console.warn("Could not focus workspace window", error); }
}

async function getWindowSummary(windowId) {
  try {
    const windowInfo = await chrome.windows.get(windowId, { populate: false });
    return { id: windowInfo.id, focused: Boolean(windowInfo.focused), state: windowInfo.state, type: windowInfo.type, top: windowInfo.top, left: windowInfo.left, width: windowInfo.width, height: windowInfo.height };
  } catch (error) { return { id: windowId, unavailable: true, error: summarizeError(error) }; }
}

function createChromeGroupTitle(workspace, roleLabel) {
  const suffix = " · " + getWorkspaceGroupToken(workspace);
  const role = roleLabel || "Unassigned";
  const maxLength = 32;
  const availableRoleLength = maxLength - suffix.length;
  if (availableRoleLength <= 3) return (role + suffix).slice(0, maxLength - 3) + "...";
  const trimmedRole = role.length <= availableRoleLength ? role : role.slice(0, availableRoleLength - 3) + "...";
  return trimmedRole + suffix;
}

function getWorkspaceGroupToken(workspace) {
  const rawName = (workspace.name || "").trim();
  if (!rawName) return "CF";
  const words = rawName.split(/\s+/).filter(Boolean);
  const initials = words.map((word) => word.replace(/[^a-zA-Z0-9]/g, "")).filter(Boolean).map((word) => word[0]).join("").toUpperCase();
  if (initials) return initials.slice(0, 4);
  const compactName = rawName.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return compactName ? compactName.slice(0, 4) : "CF";
}

function createDisplayUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const parsedUrl = new URL(rawUrl);
    const host = parsedUrl.hostname.replace(/^www\./, "");
    const path = parsedUrl.pathname === "/" ? "" : parsedUrl.pathname;
    const cleanUrl = host + path;
    return cleanUrl.length <= 72 ? cleanUrl : cleanUrl.slice(0, 69) + "...";
  } catch (error) { return rawUrl.length <= 72 ? rawUrl : rawUrl.slice(0, 69) + "..."; }
}

function createTabKey(tab) { return (tab.url || "") + "::" + (tab.title || ""); }
function getTabName(tab) { return tab?.alias || tab?.originalTitle || tab?.displayUrl || "Untitled tab"; }
function snapshotName(snapshot) { return snapshot?.alias || snapshot?.originalTitle || snapshot?.displayUrl || "Untitled tab"; }

function groupBy(items, getKey) {
  const groups = new Map();
  items.forEach((item) => {
    const key = getKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  return groups;
}

function unique(values) { return Array.from(new Set(values)); }
function isValidChromeGroupId(groupId) { return Number.isInteger(groupId) && groupId >= 0; }

function createButton(id, text, className) {
  const button = document.createElement("button");
  button.id = id;
  button.type = "button";
  button.className = className;
  button.textContent = text;
  return button;
}

function createActionButton(text, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.addEventListener("click", handler);
  return button;
}

function clearElement(element) { if (!element) return; while (element.firstChild) element.removeChild(element.firstChild); }
function setIntakeStatus(message) { if (intakeStatus) intakeStatus.textContent = message; }
function hasVerifiedMembership(sequence) { return ["committed", "replayed", "no_change"].includes(sequence?.membershipResult?.status) && sequence.membershipResult.membershipVerified === true && sequence.membershipResult.compatiblePeersVerified === true; }
async function setMembershipSequenceIntakeStatus(sequence, itemLabel) {
  await refreshRuntimeAuthorityAfterVerifiedTransfer(sequence?.promotionResult);
  workspacePromotionNoticeController.showSequence(sequence);
  if (!hasVerifiedMembership(sequence)) setIntakeStatus("The " + itemLabel + " were not added or verified: " + (sequence?.reason || "unknown result") + ".");
  else if (sequence.status === "promotion_verified") setIntakeStatus("Added and verified the " + itemLabel + "; dedicated-window placement was verified.");
  else if (sequence.status === "membership_verified_below_threshold") setIntakeStatus("Added and verified the " + itemLabel + ".");
  else setIntakeStatus("Added and verified the " + itemLabel + ", but dedicated-window placement was not verified.");
  if (!sequence?.promotionResult) setAuthoritySensitiveControlsDisabled(runtimeWorkspaceReadOnly);
  return sequence?.promotionResult == null;
}
async function refreshRuntimeAuthorityAfterVerifiedTransfer(result) {
  if (!result) return null;
  try {
    const state = await runtimeWorkspaceAuthority.bootstrapExisting({ force: true });
    applyRuntimeWorkspaceAuthorityState(state);
    return state;
  } catch {
    const blocked = { status: "blocked", reason: "post_transaction_authority_refresh_failed", result: null };
    applyRuntimeWorkspaceAuthorityState(blocked);
    return blocked;
  }
}
function setAdvancedStatus(message) { const status = document.getElementById("advancedTabControlsStatus"); if (status) status.textContent = message; }
function waitForPromotionNoticePaint() {
  return new Promise((resolve) => {
    if (typeof globalThis.requestAnimationFrame !== "function") {
      window.setTimeout(resolve, 50);
      return;
    }
    globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve));
  });
}
function delay(milliseconds) { return new Promise((resolve) => window.setTimeout(resolve, milliseconds)); }

function summarizeError(error) {
  if (!error) return { message: "Unknown error" };
  return { name: error.name || "Error", message: error.message || String(error), stack: typeof error.stack === "string" ? error.stack.slice(0, 2000) : "" };
}
