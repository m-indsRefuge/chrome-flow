chrome.runtime.onInstalled.addListener(() => {
  console.log("Chrome Flow installed.");

  chrome.sidePanel
    .setPanelBehavior({
      openPanelOnActionClick: true
    })
    .catch((error) => {
      console.error("Side panel behavior error:", error);
    });
});

chrome.tabs.onCreated.addListener((tab) => {
  console.log("Tab created:", tab.id);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    console.log("Tab updated:", tabId, tab.title);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  console.log("Tab removed:", tabId);
});
