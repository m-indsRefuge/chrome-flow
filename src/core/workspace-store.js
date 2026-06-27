const WORKSPACE_KEY = "chromeFlowWorkspace";

export async function getWorkspace() {
  const result = await chrome.storage.local.get(WORKSPACE_KEY);

  if (result[WORKSPACE_KEY]) {
    return result[WORKSPACE_KEY];
  }

  const now = new Date().toISOString();

  const workspace = {
    workspaceId: crypto.randomUUID(),
    name: "",
    aim: "",
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
    [WORKSPACE_KEY]: workspace
  });
}

export async function addJournalEntry(text) {
  const workspace = await getWorkspace();

  workspace.journal.push({
    entryId: crypto.randomUUID(),
    text: text,
    createdAt: new Date().toISOString()
  });

  workspace.updatedAt = new Date().toISOString();

  await saveWorkspace(workspace);
}

export async function addTimelineEvent(type, message) {
  const workspace = await getWorkspace();

  workspace.timeline.push({
    eventId: crypto.randomUUID(),
    type: type,
    message: message,
    createdAt: new Date().toISOString()
  });

  workspace.updatedAt = new Date().toISOString();

  await saveWorkspace(workspace);
}
