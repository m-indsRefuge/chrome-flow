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
  const source = workspace && typeof workspace === "object" ? workspace : {};

  return {
    ...source,
    workspaceId: source.workspaceId || crypto.randomUUID(),
    name: source.name || "",
    aim: source.aim || "",
    workspaceType: source.workspaceType || DEFAULT_WORKSPACE_TYPE,
    createdAt: source.createdAt || now,
    updatedAt: source.updatedAt || now,
    tabs: Array.isArray(source.tabs) ? source.tabs : [],
    journal: Array.isArray(source.journal) ? source.journal : [],
    timeline: Array.isArray(source.timeline) ? source.timeline : []
  };
}
