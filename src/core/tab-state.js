export async function getCurrentWindowTabs() {
  const tabs = await chrome.tabs.query({
    currentWindow: true
  });

  return tabs.map((tab) => ({
    id: tab.id,
    tabKey: createTabKey(tab),
    windowId: tab.windowId,
    groupId: tab.groupId,
    title: tab.title,
    url: tab.url,
    active: tab.active,
    pinned: tab.pinned
  }));
}

function createTabKey(tab) {
  const url = tab.url || "";
  const title = tab.title || "";
  return url + "::" + title;
}
