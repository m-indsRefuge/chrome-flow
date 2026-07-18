import { getActiveWorkspaceId, listWorkspaceRecords } from "../core/session-repository.js";
import { listRecentResumableWorkspaceMemoryRecords } from "../core/workspace-memory-store.js";

const LIBRARY_VIEWS = new Set(["recent", "all", "archived"]);

async function refreshWorkspaceLibrarySurfaceDirectly() {
  const select = document.getElementById("savedWorkspaceSelect");
  if (!select) {
    return {
      refreshed: false,
      reason: "saved_workspace_select_missing"
    };
  }

  const previousValue = select.value;
  const currentView = getCurrentLibraryView();
  const [workspaces, activeWorkspaceId, recentWorkspaceIds] = await Promise.all([
    listWorkspaceRecords(),
    getActiveWorkspaceId(),
    getRecentWorkspaceIds()
  ]);

  clearElement(select);

  if (!workspaces.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No saved workspaces yet";
    select.appendChild(option);
    select.disabled = true;

    setLibrarySummary("Saved workspaces: 0 | Last saved workspace: none.");
    updateLibraryViewSurface(currentView, select, recentWorkspaceIds, new Map());

    return {
      refreshed: true,
      workspaceCount: 0,
      activeWorkspaceId: "",
      selectedWorkspaceId: "",
      currentView,
      visibleCount: 0
    };
  }

  select.disabled = false;
  const workspacesById = new Map();

  for (const workspace of workspaces) {
    workspacesById.set(workspace.workspaceId, workspace);

    const option = document.createElement("option");
    option.value = workspace.workspaceId;
    option.textContent = createWorkspaceOptionLabel(workspace, activeWorkspaceId);
    select.appendChild(option);
  }

  if (previousValue && workspacesById.has(previousValue)) {
    select.value = previousValue;
  } else if (activeWorkspaceId && workspacesById.has(activeWorkspaceId)) {
    select.value = activeWorkspaceId;
  }

  const pausedCount = workspaces.filter((workspace) => workspace.lifecycleState === "paused").length;
  const activeCount = workspaces.filter((workspace) => workspace.lifecycleState === "active").length;
  const archivedCount = workspaces.filter((workspace) => workspace.lifecycleState === "archived").length;

  setLibrarySummary(
    "Saved workspaces: " + workspaces.length +
    " | Paused: " + pausedCount +
    " | Active records: " + activeCount +
    " | Archived: " + archivedCount +
    " | Last saved workspace: " + (activeWorkspaceId || "none") + "."
  );

  const viewResult = updateLibraryViewSurface(currentView, select, recentWorkspaceIds, workspacesById);

  return {
    refreshed: true,
    workspaceCount: workspaces.length,
    pausedCount,
    activeCount,
    archivedCount,
    activeWorkspaceId: activeWorkspaceId || "",
    selectedWorkspaceId: select.value || "",
    currentView,
    visibleCount: viewResult.visibleCount,
    selectionChanged: viewResult.selectionChanged
  };
}

async function getRecentWorkspaceIds() {
  try {
    const recentRecords = await listRecentResumableWorkspaceMemoryRecords(3);
    return recentRecords.map((record) => record.workspace.workspaceId);
  } catch (_error) {
    return [];
  }
}

function getCurrentLibraryView() {
  const selectedButton = Array.from(document.querySelectorAll("[data-library-view]")).find((button) => {
    return button.getAttribute("aria-pressed") === "true" || button.classList.contains("selected");
  });

  const view = String(selectedButton?.dataset?.libraryView || "all");
  return LIBRARY_VIEWS.has(view) ? view : "all";
}

function updateLibraryViewSurface(currentView, select, recentWorkspaceIds, workspacesById) {
  const previousValue = select.value;
  const options = Array.from(select.options);

  for (const option of options) {
    const workspace = workspacesById.get(option.value);
    const visible = isWorkspaceVisible(currentView, workspace, recentWorkspaceIds, option.value);
    option.hidden = !visible;
    option.disabled = !visible;
  }

  const selectedOption = options.find((option) => option.value === select.value);
  if (!selectedOption || selectedOption.hidden || selectedOption.disabled) {
    const firstVisible = options.find((option) => option.value && !option.hidden && !option.disabled);
    select.value = firstVisible?.value || "";
  }

  for (const button of Array.from(document.querySelectorAll("[data-library-view]"))) {
    const selected = button.dataset.libraryView === currentView;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }

  const visibleCount = options.filter((option) => option.value && !option.hidden && !option.disabled).length;
  updateLibraryViewExplainer(currentView, visibleCount);

  const selectionChanged = previousValue !== select.value;
  if (selectionChanged) {
    select.dispatchEvent(new Event("change", { bubbles: false }));
  }

  return { visibleCount, selectionChanged };
}

function isWorkspaceVisible(currentView, workspace, recentWorkspaceIds, optionValue) {
  if (!optionValue) return true;
  if (!workspace) return currentView === "all";

  if (currentView === "recent") {
    return recentWorkspaceIds.includes(workspace.workspaceId);
  }

  if (currentView === "archived") {
    return workspace.lifecycleState === "archived";
  }

  return true;
}

function updateLibraryViewExplainer(currentView, visibleCount) {
  const explainer = document.getElementById("workspaceLibraryViewExplainer");
  if (!explainer) return;

  if (currentView === "recent") {
    explainer.textContent = "Recent view: showing up to 3 resumable workspaces for quick continuation. Visible: " + visibleCount + ".";
    return;
  }

  if (currentView === "archived") {
    explainer.textContent = "Archived view: showing older archived/recovery workspaces when available. Visible: " + visibleCount + ".";
    return;
  }

  explainer.textContent = "All view: showing the full Workspace Library. Visible: " + visibleCount + ".";
}

function createWorkspaceOptionLabel(workspace, activeWorkspaceId) {
  const activeMarker = workspace.workspaceId === activeWorkspaceId ? " [last saved]" : "";
  const name = workspace.name || "Untitled Workspace";
  const type = workspace.workspaceType || "unknown";
  const state = workspace.lifecycleState || "unknown";
  return name + " | " + type + " | " + state + activeMarker;
}

function setLibrarySummary(message) {
  const summary = document.getElementById("savedWorkspaceRegistrySummary");
  if (summary) summary.textContent = message;
}

function clearElement(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

export { refreshWorkspaceLibrarySurfaceDirectly };
