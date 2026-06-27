/*
Chrome Flow shared object shapes.

Workspace:
{
  workspaceId: string,
  name: string,
  aim: string,
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
  role: string,
  firstSeenAt: string,
  lastSeenAt: string
}
*/
