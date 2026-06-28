const WORKSPACE_KEY = "chromeFlowWorkspace";
const DIAGNOSTICS_KEY = "chromeFlowDiagnostics";
const MAX_DIAGNOSTICS = 200;

const addSelectedTabsButton = document.getElementById("addSelectedTabsButton");
const availableTabsList = document.getElementById("availableTabsList");
const intakeStatus = document.getElementById("intakeStatus");

installDuplicateUrlStyles();
installIntakeCardObserver();
installInstanceAwareAddSelectedHandler();
void patchIntakeCardsForDuplicateUrls();

function installInstanceAwareAddSelectedHandler() {
  document.addEventListener("click", async (event) => {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    const clickedButton = target.closest("button");

    if (clickedButton !== addSelectedTabsButton) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    await addSelectedTabsWithInstanceMatching();
  }, true);
}

async function addSelectedTabsWithInstanceMatching() {
  const selectedCheckboxes = Array.from(document.querySelectorAll(".available-tab-checkbox:checked"))
    .filter((checkbox) => !checkbox.disabled);

  await recordDiagnostic("info", "ui_click", "Button clicked: addSelectedTabsButton.", {
    buttonId: "addSelectedTabsButton",
    buttonText: "Add Selected Tabs to Workspace",
    intakeMatchingMode: "instance_aware"
  });

  if (!selectedCheckboxes.length) {
    setIntakeStatus("No tabs selected. Tick one or more scanned tabs first.");
    return;
  }

  const traceId = crypto.randomUUID();
  await recordDiagnostic("info", "action_started", "Action started: Add Selected Tabs to Workspace.", {
    traceId: traceId,
    actionName: "addSelectedTabsToWorkspace",
    buttonId: "addSelectedTabsButton",
    buttonText: "Add Selected Tabs to Workspace",
    intakeMatchingMode: "instance_aware"
  });

  const workspace = await getWorkspace();
  const currentTabs = await getCurrentWindowTabSnapshots();
  let addedCount = 0;
  let exactSkippedCount = 0;
  let missingCount = 0;
  let duplicateUrlAddedCount = 0;

  selectedCheckboxes.forEach((checkbox) => {
    const card = checkbox.closest(".available-tab-card");
    const tab = findBrowserTabForCheckbox(checkbox, card, currentTabs);

    if (!tab) {
      missingCount += 1;
      return;
    }

    if (findExactWorkspaceTabMatch(workspace, tab)) {
      exactSkippedCount += 1;
      return;
    }

    if (findSameUrlWorkspaceTabMatch(workspace, tab)) {
      duplicateUrlAddedCount += 1;
    }

    workspace.tabs.push(createWorkspaceTab(tab));
    addedCount += 1;
  });

  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);

  const message = "Added " + addedCount + " selected tab(s) to workspace. Skipped " + exactSkippedCount + " exact existing tab(s). Allowed " + duplicateUrlAddedCount + " same-URL duplicate tab(s)." + (missingCount ? " " + missingCount + " selected tab(s) were no longer found." : "");
  const timelineEvent = await addTimelineEvent(workspace, "selected_tabs_added", message, {
    intakeMatchingMode: "instance_aware",
    addedCount: addedCount,
    exactSkippedCount: exactSkippedCount,
    duplicateUrlAddedCount: duplicateUrlAddedCount,
    missingCount: missingCount
  });

  await recordDiagnostic("info", "action_success", "Action success: Add Selected Tabs to Workspace.", {
    traceId: traceId,
    actionName: "addSelectedTabsToWorkspace",
    buttonId: "addSelectedTabsButton",
    buttonText: "Add Selected Tabs to Workspace",
    observedEvent: createObservedEventSummary(timelineEvent),
    intakeMatchingMode: "instance_aware",
    result: {
      addedCount: addedCount,
      exactSkippedCount: exactSkippedCount,
      duplicateUrlAddedCount: duplicateUrlAddedCount,
      missingCount: missingCount
    }
  });

  setIntakeStatus(message);
  window.setTimeout(() => {
    window.location.reload();
  }, 500);
}

function installIntakeCardObserver() {
  if (!availableTabsList) {
    return;
  }

  const observer = new MutationObserver(() => {
    void patchIntakeCardsForDuplicateUrls();
  });

  observer.observe(availableTabsList, {
    childList: true,
    subtree: true
  });
}

async function patchIntakeCardsForDuplicateUrls() {
  if (!availableTabsList) {
    return;
  }

  const cards = Array.from(availableTabsList.querySelectorAll(".available-tab-card"));

  if (!cards.length) {
    return;
  }

  const workspace = await getWorkspace();
  const currentTabs = await getCurrentWindowTabSnapshots();

  cards.forEach((card, index) => {
    const checkbox = card.querySelector(".available-tab-checkbox");
    const tab = currentTabs[index];

    if (!checkbox || !tab) {
      return;
    }

    card.dataset.tabId = String(tab.id);
    card.dataset.windowId = String(tab.windowId);
    card.dataset.tabUrl = tab.url || "";

    clearInstanceMatchingBadges(card);

    const exactMatch = findExactWorkspaceTabMatch(workspace, tab);
    const sameUrlMatch = findSameUrlWorkspaceTabMatch(workspace, tab);

    if (exactMatch) {
      card.classList.add("disabled");
      checkbox.disabled = true;
      appendBadge(card, "Already in workspace", "exact-instance-badge");
      return;
    }

    if (sameUrlMatch) {
      card.classList.remove("disabled");
      checkbox.disabled = false;
      appendBadge(card, "Same URL already in workspace", "duplicate-url-badge");
      return;
    }

    card.classList.remove("disabled");
    checkbox.disabled = false;
  });
}

function findBrowserTabForCheckbox(checkbox, card, currentTabs) {
  const tabId = Number(card?.dataset?.tabId || "");

  if (Number.isInteger(tabId)) {
    const tabById = currentTabs.find((tab) => tab.id === tabId);

    if (tabById) {
      return tabById;
    }
  }

  const index = Number(checkbox.dataset.tabIndex);

  if (Number.isInteger(index)) {
    return currentTabs[index] || null;
  }

  return null;
}

function findExactWorkspaceTabMatch(workspace, browserTab) {
  return workspace.tabs.find((workspaceTab) =>
    Number.isInteger(browserTab.id) && workspaceTab.tabId === browserTab.id
  );
}

function findSameUrlWorkspaceTabMatch(workspace, browserTab) {
  return workspace.tabs.find((workspaceTab) =>
    workspaceTab.url && browserTab.url && workspaceTab.url === browserTab.url && workspaceTab.tabId !== browserTab.id
  );
}

async function getCurrentWindowTabSnapshots() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs.map((tab) => ({
    id: tab.id,
    tabKey: createTabKey(tab),
    windowId: tab.windowId,
    groupId: tab.groupId,
    index: tab.index,
    title: tab.title,
    url: tab.url,
    active: tab.active,
    pinned: tab.pinned
  }));
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
    isOpen: true,
    firstSeenAt: now,
    lastSeenAt: now
  };
}

async function getWorkspace() {
  const result = await chrome.storage.local.get(WORKSPACE_KEY);
  const workspace = result[WORKSPACE_KEY] || null;

  if (!workspace) {
    return {
      workspaceId: crypto.randomUUID(),
      name: "",
      aim: "",
      workspaceType: "research",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tabs: [],
      journal: [],
      timeline: []
    };
  }

  return {
    ...workspace,
    tabs: Array.isArray(workspace.tabs) ? workspace.tabs : [],
    journal: Array.isArray(workspace.journal) ? workspace.journal : [],
    timeline: Array.isArray(workspace.timeline) ? workspace.timeline : []
  };
}

async function saveWorkspace(workspace) {
  await chrome.storage.local.set({
    [WORKSPACE_KEY]: workspace
  });
}

async function addTimelineEvent(workspace, type, message, details = {}) {
  const event = {
    eventId: crypto.randomUUID(),
    type: type,
    message: message,
    createdAt: new Date().toISOString(),
    ...details
  };

  workspace.timeline.push(event);
  workspace.updatedAt = new Date().toISOString();
  await saveWorkspace(workspace);
  return event;
}

async function recordDiagnostic(level, action, message, details = {}) {
  try {
    const result = await chrome.storage.local.get(DIAGNOSTICS_KEY);
    const diagnostics = Array.isArray(result[DIAGNOSTICS_KEY]) ? result[DIAGNOSTICS_KEY] : [];

    diagnostics.push({
      diagnosticId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      level: level,
      action: action,
      message: message,
      details: details
    });

    await chrome.storage.local.set({
      [DIAGNOSTICS_KEY]: diagnostics.slice(-MAX_DIAGNOSTICS)
    });
  } catch (error) {
    console.warn("Chrome Flow intake diagnostics failed:", error);
  }
}

function createObservedEventSummary(event) {
  return {
    eventId: event.eventId || "",
    type: event.type || "unknown",
    message: event.message || "",
    createdAt: event.createdAt || ""
  };
}

function appendBadge(card, text, extraClassName) {
  const content = card.querySelector("div:last-child") || card;
  const badge = document.createElement("span");
  badge.className = "badge intake-instance-badge " + extraClassName;
  badge.textContent = text;
  content.appendChild(badge);
}

function clearInstanceMatchingBadges(card) {
  card.querySelectorAll(".intake-instance-badge").forEach((badge) => badge.remove());

  card.querySelectorAll(".badge").forEach((badge) => {
    if (badge.textContent === "Already in workspace") {
      badge.remove();
    }
  });
}

function installDuplicateUrlStyles() {
  const style = document.createElement("style");
  style.textContent = `
    .duplicate-url-badge {
      border-color: #d6c48a;
      background: #fffbed;
      color: #6a5314;
    }

    .exact-instance-badge {
      border-color: #ccc;
      background: #fff;
      color: #555;
    }
  `;
  document.head.appendChild(style);
}

function createTabKey(tab) {
  return (tab.url || "") + "::" + (tab.title || "");
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
  if (intakeStatus) {
    intakeStatus.textContent = message;
  }
}
