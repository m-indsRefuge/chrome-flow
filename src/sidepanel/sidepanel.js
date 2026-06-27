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
const loadTabsButton = document.getElementById("loadTabsButton");
const tabsList = document.getElementById("tabsList");
const journalEntryInput = document.getElementById("journalEntry");
const addJournalButton = document.getElementById("addJournalButton");
const journalList = document.getElementById("journalList");
const timelineList = document.getElementById("timelineList");

let workspace = await getWorkspace();

renderWorkspace();

saveWorkspaceButton.addEventListener("click", async () => {
  workspace.name = workspaceNameInput.value.trim();
  workspace.aim = workspaceAimInput.value.trim();
  workspace.updatedAt = new Date().toISOString();

  await saveWorkspace(workspace);
  await addTimelineEvent("workspace_saved", "Workspace saved.");

  workspace = await getWorkspace();
  renderWorkspace();
});

loadTabsButton.addEventListener("click", async () => {
  const tabs = await getCurrentWindowTabs();

  workspace.tabs = tabs.map((tab) => {
    const existing = workspace.tabs.find((item) =>
      item.tabId === tab.id ||
      item.tabKey === tab.tabKey ||
      item.url === tab.url
    );

    return {
      tabId: tab.id,
      tabKey: tab.tabKey,
      windowId: tab.windowId,
      groupId: tab.groupId,
      url: tab.url,
      originalTitle: tab.title,
      alias: existing ? existing.alias : "",
      role: existing ? existing.role : "unassigned",
      firstSeenAt: existing ? existing.firstSeenAt : new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    };
  });

  workspace.updatedAt = new Date().toISOString();

  await saveWorkspace(workspace);
  await addTimelineEvent("tabs_loaded", "Loaded " + tabs.length + " tabs from current window.");

  workspace = await getWorkspace();
  renderWorkspace();
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

function renderTabs() {
  clearElement(tabsList);

  if (!workspace.tabs.length) {
    const empty = document.createElement("p");
    empty.textContent = "No tabs loaded yet.";
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
    url.textContent = tab.url || "";
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

function clearElement(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}
