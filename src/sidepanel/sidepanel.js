import {
  getWorkspace,
  saveWorkspace,
  addJournalEntry,
  addTimelineEvent
} from "../core/workspace-store.js";

import {
  getCurrentWindowTabs
} from "../core/tab-state.js";

const workspaceNameInput = document.getElementById("workspaceName");
const workspaceAimInput = document.getElementById("workspaceAim");
const saveWorkspaceButton = document.getElementById("saveWorkspaceButton");

const scanTabsButton = document.getElementById("scanTabsButton");
const addSelectedTabsButton = document.getElementById("addSelectedTabsButton");
const clearScannedTabsButton = document.getElementById("clearScannedTabsButton");
const intakeStatus = document.getElementById("intakeStatus");
const availableTabsList = document.getElementById("availableTabsList");

const clearWorkspaceTabsButton = document.getElementById("clearWorkspaceTabsButton");
const tabsList = document.getElementById("tabsList");

const journalEntryInput = document.getElementById("journalEntry");
const addJournalButton = document.getElementById("addJournalButton");
const journalList = document.getElementById("journalList");

const timelineList = document.getElementById("timelineList");

let workspace = await getWorkspace();
let availableTabs = [];

renderWorkspace();
renderAvailableTabs();

saveWorkspaceButton.addEventListener("click", async () => {
  workspace.name = workspaceNameInput.value.trim();
  workspace.aim = workspaceAimInput.value.trim();
  workspace.updatedAt = new Date().toISOString();

  await saveWorkspace(workspace);
  await addTimelineEvent("workspace_saved", "Workspace saved.");

  workspace = await getWorkspace();
  renderWorkspace();
});

scanTabsButton.addEventListener("click", async () => {
  availableTabs = await getCurrentWindowTabs();

  await addTimelineEvent("tabs_scanned", "Scanned " + availableTabs.length + " tabs from current window.");

  workspace = await getWorkspace();
  setIntakeStatus("Scanned " + availableTabs.length + " tabs. Select the tabs you want to add to this workspace.");
  renderAvailableTabs();
  renderTimeline();
});

addSelectedTabsButton.addEventListener("click", async () => {
  const selectedIndexes = getSelectedAvailableTabIndexes();

  if (!selectedIndexes.length) {
    setIntakeStatus("No tabs selected. Tick one or more scanned tabs first.");
    return;
  }

  let addedCount = 0;
  let skippedCount = 0;

  selectedIndexes.forEach((index) => {
    const tab = availableTabs[index];

    if (!tab) {
      return;
    }

    const existing = findWorkspaceTabMatch(tab);

    if (existing) {
      skippedCount += 1;
      return;
    }

    workspace.tabs.push(createWorkspaceTab(tab));
    addedCount += 1;
  });

  workspace.updatedAt = new Date().toISOString();

  await saveWorkspace(workspace);
  await addTimelineEvent(
    "selected_tabs_added",
    "Added " + addedCount + " selected tab(s) to workspace. Skipped " + skippedCount + " existing tab(s)."
  );

  workspace = await getWorkspace();
  setIntakeStatus("Added " + addedCount + " tab(s) to workspace. Skipped " + skippedCount + " existing tab(s).");
  renderWorkspace();
  renderAvailableTabs();
});

clearScannedTabsButton.addEventListener("click", () => {
  availableTabs = [];
  setIntakeStatus("Cleared scanned tabs.");
  renderAvailableTabs();
});

clearWorkspaceTabsButton.addEventListener("click", async () => {
  if (!workspace.tabs.length) {
    setIntakeStatus("Workspace already has no tabs.");
    return;
  }

  const confirmed = window.confirm(
    "Clear all workspace tabs? This will remove tab aliases and roles from this workspace, but it will keep the workspace name, aim, journal, and timeline."
  );

  if (!confirmed) {
    return;
  }

  const clearedCount = workspace.tabs.length;
  workspace.tabs = [];
  workspace.updatedAt = new Date().toISOString();

  await saveWorkspace(workspace);
  await addTimelineEvent("workspace_tabs_cleared", "Cleared " + clearedCount + " tab(s) from workspace.");

  workspace = await getWorkspace();
  setIntakeStatus("Cleared " + clearedCount + " workspace tab(s). Scan again and select only the tabs you want.");
  renderWorkspace();
  renderAvailableTabs();
});

addJournalButton.addEventListener("click", async () => {
  const text = journalEntryInput.value.trim();

  if (!text) {
    return;
  }

  await addJournalEntry(text);
  await addTimelineEvent("journal_added", "Journal entry added.");

  journalEntryInput.value = "";
  workspace = await getWorkspace();
  renderWorkspace();
});

function renderWorkspace() {
  workspaceNameInput.value = workspace.name || "";
  workspaceAimInput.value = workspace.aim || "";

  renderTabs();
  renderJournal();
  renderTimeline();
}

function renderAvailableTabs() {
  clearElement(availableTabsList);

  if (!availableTabs.length) {
    const empty = document.createElement("p");
    empty.textContent = "No scanned tabs yet.";
    availableTabsList.appendChild(empty);
    return;
  }

  availableTabs.forEach((tab, index) => {
    const alreadyInWorkspace = Boolean(findWorkspaceTabMatch(tab));

    const card = document.createElement("div");
    card.className = "available-tab-card";

    if (alreadyInWorkspace) {
      card.classList.add("disabled");
    }

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "available-tab-checkbox";
    checkbox.dataset.tabIndex = String(index);
    checkbox.disabled = alreadyInWorkspace;
    checkbox.checked = false;
    card.appendChild(checkbox);

    const content = document.createElement("div");

    const title = document.createElement("div");
    title.className = "tab-title";
    title.textContent = tab.title || "Untitled tab";
    content.appendChild(title);

    const url = document.createElement("div");
    url.className = "tab-url";
    url.textContent = createDisplayUrl(tab.url || "");
    url.title = tab.url || "";
    content.appendChild(url);

    const meta = document.createElement("div");
    meta.className = "tab-meta";
    meta.textContent = "Window " + tab.windowId + " | Tab " + tab.id;
    content.appendChild(meta);

    if (alreadyInWorkspace) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Already in workspace";
      content.appendChild(badge);
    }

    card.appendChild(content);
    availableTabsList.appendChild(card);
  });
}

function renderTabs() {
  clearElement(tabsList);

  if (!workspace.tabs.length) {
    const empty = document.createElement("p");
    empty.textContent = "No workspace tabs yet. Scan the current window and add selected tabs.";
    tabsList.appendChild(empty);
    return;
  }

  workspace.tabs.forEach((tab) => {
    const card = document.createElement("div");
    card.className = "tab-card";

    const title = document.createElement("div");
    title.className = "tab-title";
    title.textContent = tab.originalTitle || "Untitled tab";
    card.appendChild(title);

    const url = document.createElement("div");
    url.className = "tab-url";
    url.textContent = tab.displayUrl || createDisplayUrl(tab.url || "");
    url.title = tab.url || "";
    card.appendChild(url);

    const aliasLabel = document.createElement("label");
    aliasLabel.textContent = "Custom Alias";
    card.appendChild(aliasLabel);

    const aliasInput = document.createElement("input");
    aliasInput.type = "text";
    aliasInput.className = "alias-input";
    aliasInput.dataset.tabKey = tab.tabKey || "";
    aliasInput.value = tab.alias || "";
    card.appendChild(aliasInput);

    const roleLabel = document.createElement("label");
    roleLabel.textContent = "Role";
    card.appendChild(roleLabel);

    const roleSelect = document.createElement("select");
    roleSelect.className = "role-select";
    roleSelect.dataset.tabKey = tab.tabKey || "";

    const roles = ["unassigned", "source", "question", "docs", "video", "revisit", "discard"];

    roles.forEach((role) => {
      const option = document.createElement("option");
      option.value = role;
      option.textContent = role;
      roleSelect.appendChild(option);
    });

    roleSelect.value = tab.role || "unassigned";
    card.appendChild(roleSelect);

    tabsList.appendChild(card);
  });

  document.querySelectorAll(".alias-input").forEach((input) => {
    input.addEventListener("change", async (event) => {
      const tabKey = event.target.dataset.tabKey;
      const tab = workspace.tabs.find((item) => item.tabKey === tabKey);

      if (!tab) {
        return;
      }

      tab.alias = event.target.value.trim();
      workspace.updatedAt = new Date().toISOString();

      await saveWorkspace(workspace);
      await addTimelineEvent("tab_alias_updated", "Updated alias for: " + (tab.alias || tab.originalTitle || "Untitled tab") + ".");

      workspace = await getWorkspace();
      renderWorkspace();
    });
  });

  document.querySelectorAll(".role-select").forEach((select) => {
    select.addEventListener("change", async (event) => {
      const tabKey = event.target.dataset.tabKey;
      const tab = workspace.tabs.find((item) => item.tabKey === tabKey);

      if (!tab) {
        return;
      }

      tab.role = event.target.value;
      workspace.updatedAt = new Date().toISOString();

      await saveWorkspace(workspace);
      await addTimelineEvent("tab_role_updated", "Updated role for: " + (tab.alias || tab.originalTitle || "Untitled tab") + ".");

      workspace = await getWorkspace();
      renderWorkspace();
    });
  });
}

function renderJournal() {
  clearElement(journalList);

  if (!workspace.journal.length) {
    const empty = document.createElement("p");
    empty.textContent = "No journal entries yet.";
    journalList.appendChild(empty);
    return;
  }

  workspace.journal.forEach((entry) => {
    const card = document.createElement("div");
    card.className = "journal-card";

    const text = document.createElement("p");
    text.textContent = entry.text;
    card.appendChild(text);

    const time = document.createElement("small");
    time.textContent = entry.createdAt;
    card.appendChild(time);

    journalList.appendChild(card);
  });
}

function renderTimeline() {
  clearElement(timelineList);

  if (!workspace.timeline.length) {
    const empty = document.createElement("p");
    empty.textContent = "No timeline events yet.";
    timelineList.appendChild(empty);
    return;
  }

  workspace.timeline.slice().reverse().forEach((event) => {
    const card = document.createElement("div");
    card.className = "timeline-card";

    const type = document.createElement("strong");
    type.textContent = event.type;
    card.appendChild(type);

    const message = document.createElement("p");
    message.textContent = event.message;
    card.appendChild(message);

    const time = document.createElement("small");
    time.textContent = event.createdAt;
    card.appendChild(time);

    timelineList.appendChild(card);
  });
}

function getSelectedAvailableTabIndexes() {
  return Array.from(document.querySelectorAll(".available-tab-checkbox:checked"))
    .filter((checkbox) => !checkbox.disabled)
    .map((checkbox) => Number(checkbox.dataset.tabIndex))
    .filter((index) => Number.isInteger(index));
}

function findWorkspaceTabMatch(tab) {
  return workspace.tabs.find((item) =>
    item.tabId === tab.id ||
    item.tabKey === tab.tabKey ||
    item.url === tab.url
  );
}

function createWorkspaceTab(tab) {
  const now = new Date().toISOString();

  return {
    tabId: tab.id,
    tabKey: tab.tabKey,
    windowId: tab.windowId,
    groupId: tab.groupId,
    url: tab.url,
    displayUrl: createDisplayUrl(tab.url || ""),
    originalTitle: tab.title,
    alias: "",
    role: "unassigned",
    firstSeenAt: now,
    lastSeenAt: now
  };
}

function createDisplayUrl(rawUrl) {
  if (!rawUrl) {
    return "";
  }

  try {
    const parsedUrl = new URL(rawUrl);
    const host = parsedUrl.hostname.replace(/^www\./, "");
    const path = parsedUrl.pathname === "/" ? "" : parsedUrl.pathname;
    const cleanUrl = host + path;

    if (cleanUrl.length <= 72) {
      return cleanUrl;
    }

    return cleanUrl.slice(0, 69) + "...";
  } catch (error) {
    if (rawUrl.length <= 72) {
      return rawUrl;
    }

    return rawUrl.slice(0, 69) + "...";
  }
}

function setIntakeStatus(message) {
  intakeStatus.textContent = message;
}

function clearElement(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}
