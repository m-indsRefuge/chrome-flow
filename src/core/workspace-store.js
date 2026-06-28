import {
  DEFAULT_WORKSPACE_TYPE
} from "./workspace-role-sets.js";

const WORKSPACE_KEY = "chromeFlowWorkspace";

export async function getWorkspace() {
  const result = await chrome.storage.local.get(WORKSPACE_KEY);

  if (result[WORKSPACE_KEY]) {
    const workspace = normalizeWorkspace(result[WORKSPACE_KEY]);
    await saveWorkspace(workspace);
    return workspace;
  }

  const now = new Date().toISOString();

  const workspace = {
    workspaceId: crypto.randomUUID(),
    name: "",
    aim: "",
    workspaceType: DEFAULT_WORKSPACE_TYPE,
    createdAt: now,
    updatedAt: now,
    tabs: [],
    journal: [],
    timeline: []
  };

  await saveWorkspace(workspace);

  return workspace;
}

export async function saveWorkspace(workspace) {
  await chrome.storage.local.set({
    [WORKSPACE_KEY]: normalizeWorkspace(workspace)
  });
}

export async function addJournalEntry(text, details = {}) {
  const workspace = await getWorkspace();

  workspace.journal.push({
    entryId: crypto.randomUUID(),
    text: text,
    tag: details.tag || "",
    relatedRoleId: details.relatedRoleId || "",
    relatedRoleLabel: details.relatedRoleLabel || "",
    createdAt: new Date().toISOString()
  });

  workspace.updatedAt = new Date().toISOString();

  await saveWorkspace(workspace);
}

export async function addTimelineEvent(type, message, details = {}) {
  const workspace = await getWorkspace();

  workspace.timeline.push({
    eventId: crypto.randomUUID(),
    type: type,
    message: message,
    createdAt: new Date().toISOString(),
    ...details
  });

  workspace.updatedAt = new Date().toISOString();

  await saveWorkspace(workspace);
}

function normalizeWorkspace(workspace) {
  const now = new Date().toISOString();

  return {
    workspaceId: workspace.workspaceId || crypto.randomUUID(),
    name: workspace.name || "",
    aim: workspace.aim || "",
    workspaceType: workspace.workspaceType || DEFAULT_WORKSPACE_TYPE,
    createdAt: workspace.createdAt || now,
    updatedAt: workspace.updatedAt || now,
    tabs: Array.isArray(workspace.tabs) ? workspace.tabs : [],
    journal: Array.isArray(workspace.journal) ? workspace.journal : [],
    timeline: Array.isArray(workspace.timeline) ? workspace.timeline : []
  };
}
