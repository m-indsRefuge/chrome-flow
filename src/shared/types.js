/*
Chrome Flow shared object shapes.

Workspace:
{
  workspaceId: string,
  name: string,
  aim: string,
  workspaceType: string, // research, design, build, decision, or learning
  createdAt: string,
  updatedAt: string,
  tabs: FlowTab[],
  journal: JournalEntry[],
  timeline: TimelineEvent[]
}

FlowTab:
{
  tabId: number,
  tabKey: string,
  windowId: number,
  groupId: number,
  url: string,        // full original URL for traceability
  displayUrl: string, // shortened URL for side-panel display
  originalTitle: string,
  alias: string,
  role: string,       // selected from the current workspace type role set
  firstSeenAt: string,
  lastSeenAt: string
}
*/
