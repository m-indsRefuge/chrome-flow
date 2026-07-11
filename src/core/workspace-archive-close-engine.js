const ARCHIVE_CLOSE_IDENTITY_POLICY = Object.freeze({
  policyId: "workspace_archive_close_identity_v0.1",
  numericTabIdIsOwnershipProof: false,
  requiredEvidence: [
    "saved numeric tab id equals current live tab id",
    "normalized saved URL equals normalized live URL",
    "saved tabKey or saved original title corroborates the live tab"
  ],
  executionPolicy: "revalidate_immediately_before_individual_tab_removal",
  mismatchPolicy: "skip_never_close"
});

async function buildVerifiedWorkspaceBrowserClosePlan(workspace) {
  const workspaceTabs = Array.isArray(workspace?.tabs) ? workspace.tabs : [];
  const requestedTabs = workspaceTabs.map(summarizeSavedWorkspaceTab);

  if (!globalThis.chrome?.tabs?.get || !globalThis.chrome?.tabs?.query || !globalThis.chrome?.tabs?.remove) {
    return {
      available: false,
      reason: "chrome_tabs_api_unavailable",
      policy: ARCHIVE_CLOSE_IDENTITY_POLICY,
      workspaceId: workspace?.workspaceId || "",
      requestedTabs,
      verifiedTabs: [],
      skippedTabs: requestedTabs.map((tab) => ({ ...tab, reason: "chrome_tabs_api_unavailable" })),
      closeTabIds: [],
      fullyOwnedWindowIds: [],
      partialWindowIds: []
    };
  }

  const verifiedTabs = [];
  const skippedTabs = [];

  for (const workspaceTab of workspaceTabs) {
    const verification = await verifySavedWorkspaceTabAgainstCurrentLiveTab(workspaceTab);

    if (verification.verified) {
      verifiedTabs.push({
        workspaceTab: cloneValue(workspaceTab),
        workspaceTabId: workspaceTab?.workspaceTabId || "",
        savedTabId: Number(workspaceTab?.tabId),
        liveTabId: verification.liveTab.id,
        windowId: verification.liveTab.windowId,
        title: verification.liveTab.title || "",
        url: verification.liveTab.url || "",
        identityEvidence: verification.identityEvidence
      });
    } else {
      skippedTabs.push({
        ...summarizeSavedWorkspaceTab(workspaceTab),
        reason: verification.reason,
        identityEvidence: verification.identityEvidence,
        liveTab: verification.liveTab ? summarizeLiveTab(verification.liveTab) : null
      });
    }
  }

  const closeTabIds = verifiedTabs.map((tab) => tab.liveTabId);
  const windowOwnership = await classifyWindowOwnership(verifiedTabs);

  return {
    available: true,
    reason: "verified_workspace_tab_close_plan_ready",
    policy: ARCHIVE_CLOSE_IDENTITY_POLICY,
    workspaceId: workspace?.workspaceId || "",
    requestedTabs,
    verifiedTabs,
    skippedTabs,
    closeTabIds,
    fullyOwnedWindowIds: windowOwnership.fullyOwnedWindowIds,
    partialWindowIds: windowOwnership.partialWindowIds
  };
}

async function closeVerifiedWorkspaceBrowserProjection(closePlan) {
  const result = {
    startedAt: new Date().toISOString(),
    policy: ARCHIVE_CLOSE_IDENTITY_POLICY,
    requestedCount: Array.isArray(closePlan?.requestedTabs) ? closePlan.requestedTabs.length : 0,
    plannedVerifiedCount: Array.isArray(closePlan?.verifiedTabs) ? closePlan.verifiedTabs.length : 0,
    closedTabs: [],
    skippedTabs: [],
    errors: [],
    completedAt: ""
  };

  if (!closePlan?.available) {
    result.skippedTabs.push({ reason: closePlan?.reason || "close_plan_unavailable" });
    result.completedAt = new Date().toISOString();
    return result;
  }

  for (const candidate of closePlan.verifiedTabs || []) {
    const verification = await verifySavedWorkspaceTabAgainstCurrentLiveTab(candidate.workspaceTab);

    if (!verification.verified) {
      result.skippedTabs.push({
        workspaceTabId: candidate.workspaceTabId,
        savedTabId: candidate.savedTabId,
        reason: "execution_revalidation_" + verification.reason,
        identityEvidence: verification.identityEvidence,
        liveTab: verification.liveTab ? summarizeLiveTab(verification.liveTab) : null
      });
      continue;
    }

    try {
      await chrome.tabs.remove(verification.liveTab.id);
      result.closedTabs.push({
        workspaceTabId: candidate.workspaceTabId,
        tabId: verification.liveTab.id,
        windowId: verification.liveTab.windowId,
        url: verification.liveTab.url || "",
        identityEvidence: verification.identityEvidence
      });
    } catch (error) {
      result.errors.push({
        workspaceTabId: candidate.workspaceTabId,
        tabId: verification.liveTab.id,
        action: "remove_verified_workspace_tab",
        error: summarizeError(error)
      });
    }
  }

  result.completedAt = new Date().toISOString();
  return result;
}

async function verifySavedWorkspaceTabAgainstCurrentLiveTab(workspaceTab) {
  const savedTabId = Number(workspaceTab?.tabId);
  const savedUrl = String(workspaceTab?.url || "");
  const savedTabKey = String(workspaceTab?.tabKey || "");
  const savedTitle = String(workspaceTab?.originalTitle || "");
  const baseEvidence = {
    workspaceTabId: workspaceTab?.workspaceTabId || "",
    savedTabId: Number.isInteger(savedTabId) ? savedTabId : null,
    savedUrl,
    savedNormalizedUrl: normalizeIdentityUrl(savedUrl),
    savedTabKey,
    savedTitle,
    savedIsOpen: workspaceTab?.isOpen !== false
  };

  if (!Number.isInteger(savedTabId) || savedTabId <= 0) {
    return { verified: false, reason: "saved_tab_id_missing", liveTab: null, identityEvidence: baseEvidence };
  }

  if (!savedUrl) {
    return { verified: false, reason: "saved_url_missing", liveTab: null, identityEvidence: baseEvidence };
  }

  if (workspaceTab?.isOpen === false) {
    return { verified: false, reason: "saved_tab_not_marked_open", liveTab: null, identityEvidence: baseEvidence };
  }

  let liveTab = null;

  try {
    liveTab = await chrome.tabs.get(savedTabId);
  } catch (_error) {
    return { verified: false, reason: "saved_tab_id_not_live", liveTab: null, identityEvidence: baseEvidence };
  }

  const liveUrl = String(liveTab?.url || "");
  const liveTitle = String(liveTab?.title || "");
  const liveTabKey = createTabKey(liveUrl, liveTitle);
  const liveNormalizedUrl = normalizeIdentityUrl(liveUrl);
  const idMatches = liveTab?.id === savedTabId;
  const urlMatches = Boolean(baseEvidence.savedNormalizedUrl && baseEvidence.savedNormalizedUrl === liveNormalizedUrl);
  const tabKeyMatches = Boolean(savedTabKey && savedTabKey === liveTabKey);
  const titleMatches = Boolean(savedTitle && savedTitle === liveTitle);
  const corroboratingIdentityMatches = tabKeyMatches || titleMatches;
  const identityEvidence = {
    ...baseEvidence,
    liveTabId: liveTab?.id ?? null,
    liveWindowId: liveTab?.windowId ?? null,
    liveUrl,
    liveNormalizedUrl,
    liveTitle,
    liveTabKey,
    idMatches,
    urlMatches,
    tabKeyMatches,
    titleMatches,
    corroboratingIdentityMatches
  };

  if (!idMatches) {
    return { verified: false, reason: "live_tab_id_mismatch", liveTab, identityEvidence };
  }

  if (!urlMatches) {
    return { verified: false, reason: "live_url_mismatch", liveTab, identityEvidence };
  }

  if (!corroboratingIdentityMatches) {
    return { verified: false, reason: "live_tab_identity_not_corroborated", liveTab, identityEvidence };
  }

  return {
    verified: true,
    reason: "verified_exact_tab_id_url_and_corroborating_identity",
    liveTab,
    identityEvidence
  };
}

async function classifyWindowOwnership(verifiedTabs) {
  const windowIds = Array.from(new Set(
    verifiedTabs.map((tab) => tab.windowId).filter(Number.isInteger)
  ));
  const fullyOwnedWindowIds = [];
  const partialWindowIds = [];

  for (const windowId of windowIds) {
    try {
      const windowTabs = await chrome.tabs.query({ windowId });
      const liveWindowTabIds = windowTabs.map((tab) => tab.id).filter(Number.isInteger);
      const verifiedIdsInWindow = verifiedTabs
        .filter((tab) => tab.windowId === windowId)
        .map((tab) => tab.liveTabId);
      const unrelatedTabIds = liveWindowTabIds.filter((tabId) => !verifiedIdsInWindow.includes(tabId));

      if (unrelatedTabIds.length === 0) fullyOwnedWindowIds.push(windowId);
      else partialWindowIds.push(windowId);
    } catch (_error) {
      partialWindowIds.push(windowId);
    }
  }

  return { fullyOwnedWindowIds, partialWindowIds };
}

function summarizeVerifiedClosePlan(closePlan) {
  return {
    available: Boolean(closePlan?.available),
    reason: closePlan?.reason || "",
    policyId: closePlan?.policy?.policyId || "",
    workspaceId: closePlan?.workspaceId || "",
    requestedTabCount: Array.isArray(closePlan?.requestedTabs) ? closePlan.requestedTabs.length : 0,
    verifiedTabCount: Array.isArray(closePlan?.verifiedTabs) ? closePlan.verifiedTabs.length : 0,
    skippedTabCount: Array.isArray(closePlan?.skippedTabs) ? closePlan.skippedTabs.length : 0,
    closeTabIds: Array.isArray(closePlan?.closeTabIds) ? [...closePlan.closeTabIds] : [],
    fullyOwnedWindowIds: Array.isArray(closePlan?.fullyOwnedWindowIds) ? [...closePlan.fullyOwnedWindowIds] : [],
    partialWindowIds: Array.isArray(closePlan?.partialWindowIds) ? [...closePlan.partialWindowIds] : [],
    verifiedTabs: (closePlan?.verifiedTabs || []).map((tab) => ({
      workspaceTabId: tab.workspaceTabId,
      savedTabId: tab.savedTabId,
      liveTabId: tab.liveTabId,
      windowId: tab.windowId,
      url: tab.url,
      identityEvidence: tab.identityEvidence
    })),
    skippedTabs: (closePlan?.skippedTabs || []).map((tab) => ({
      workspaceTabId: tab.workspaceTabId,
      savedTabId: tab.savedTabId,
      reason: tab.reason,
      identityEvidence: tab.identityEvidence,
      liveTab: tab.liveTab
    }))
  };
}

function summarizeSavedWorkspaceTab(tab) {
  return {
    workspaceTabId: tab?.workspaceTabId || "",
    savedTabId: Number.isInteger(Number(tab?.tabId)) ? Number(tab.tabId) : null,
    url: String(tab?.url || ""),
    normalizedUrl: normalizeIdentityUrl(tab?.url || ""),
    title: String(tab?.originalTitle || ""),
    tabKey: String(tab?.tabKey || ""),
    isOpen: tab?.isOpen !== false
  };
}

function summarizeLiveTab(tab) {
  return {
    tabId: tab?.id ?? null,
    windowId: tab?.windowId ?? null,
    title: tab?.title || "",
    url: tab?.url || "",
    normalizedUrl: normalizeIdentityUrl(tab?.url || "")
  };
}

function normalizeIdentityUrl(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) return "";

  try {
    const parsed = new URL(value);
    parsed.hash = "";
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.href;
  } catch (_error) {
    return value;
  }
}

function createTabKey(url, title) {
  return String(url || "") + "::" + String(title || "");
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function summarizeError(error) {
  if (!error) return { message: "Unknown error" };
  return {
    name: error.name || "Error",
    message: error.message || String(error),
    stack: typeof error.stack === "string" ? error.stack.slice(0, 2000) : ""
  };
}

export {
  ARCHIVE_CLOSE_IDENTITY_POLICY,
  buildVerifiedWorkspaceBrowserClosePlan,
  closeVerifiedWorkspaceBrowserProjection,
  normalizeIdentityUrl,
  summarizeVerifiedClosePlan,
  verifySavedWorkspaceTabAgainstCurrentLiveTab
};
