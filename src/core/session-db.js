const DB_NAME = "chrome-flow-session-db";
const DB_VERSION = 1;

export const SESSION_DB_SCHEMA = Object.freeze({
  dbName: DB_NAME,
  version: DB_VERSION,
  stores: Object.freeze({
    workspaces: "workspaces",
    workspaceTabs: "workspaceTabs",
    sessions: "sessions",
    projections: "projections",
    workspaceLinks: "workspaceLinks",
    constellations: "constellations",
    journalEntries: "journalEntries",
    timelineEvents: "timelineEvents",
    summaryCards: "summaryCards",
    settings: "settings"
  })
});

let dbPromise = null;

export function openSessionDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        createSchema(db);
      };

      request.onsuccess = () => {
        const db = request.result;

        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };

        resolve(db);
      };

      request.onerror = () => {
        reject(request.error || new Error("Could not open Chrome Flow Session DB."));
      };

      request.onblocked = () => {
        reject(new Error("Chrome Flow Session DB upgrade was blocked by another open extension context."));
      };
    });
  }

  return dbPromise;
}

export async function getFromStore(storeName, key) {
  const db = await openSessionDb();

  return runRequest(db, storeName, "readonly", (store) => store.get(key));
}

export async function putInStore(storeName, value) {
  const db = await openSessionDb();

  await runRequest(db, storeName, "readwrite", (store) => store.put(value));

  return value;
}

export async function deleteFromStore(storeName, key) {
  const db = await openSessionDb();

  await runRequest(db, storeName, "readwrite", (store) => store.delete(key));
}

export async function getAllFromStore(storeName) {
  const db = await openSessionDb();

  return runRequest(db, storeName, "readonly", (store) => store.getAll());
}

export async function getAllFromIndex(storeName, indexName, query) {
  const db = await openSessionDb();

  return runRequest(db, storeName, "readonly", (store) => store.index(indexName).getAll(query));
}

export async function clearStore(storeName) {
  const db = await openSessionDb();

  await runRequest(db, storeName, "readwrite", (store) => store.clear());
}

export async function runSessionDbTransaction(storeNames, mode, callback) {
  const db = await openSessionDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeNames, mode);
    const stores = new Map(storeNames.map((storeName) => [storeName, transaction.objectStore(storeName)]));
    let callbackResult;

    transaction.oncomplete = () => resolve(callbackResult);
    transaction.onerror = () => reject(transaction.error || new Error("Chrome Flow Session DB transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("Chrome Flow Session DB transaction was aborted."));

    try {
      callbackResult = callback(stores, transaction);
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  });
}

function createSchema(db) {
  createWorkspacesStore(db);
  createWorkspaceTabsStore(db);
  createSessionsStore(db);
  createProjectionsStore(db);
  createWorkspaceLinksStore(db);
  createConstellationsStore(db);
  createJournalEntriesStore(db);
  createTimelineEventsStore(db);
  createSummaryCardsStore(db);
  createSettingsStore(db);
}

function createWorkspacesStore(db) {
  if (db.objectStoreNames.contains(SESSION_DB_SCHEMA.stores.workspaces)) return;

  const store = db.createObjectStore(SESSION_DB_SCHEMA.stores.workspaces, { keyPath: "workspaceId" });
  store.createIndex("lifecycleState", "lifecycleState", { unique: false });
  store.createIndex("updatedAt", "updatedAt", { unique: false });
  store.createIndex("lastActivatedAt", "lastActivatedAt", { unique: false });
}

function createWorkspaceTabsStore(db) {
  if (db.objectStoreNames.contains(SESSION_DB_SCHEMA.stores.workspaceTabs)) return;

  const store = db.createObjectStore(SESSION_DB_SCHEMA.stores.workspaceTabs, { keyPath: "workspaceTabId" });
  store.createIndex("workspaceId", "workspaceId", { unique: false });
  store.createIndex("role", "role", { unique: false });
  store.createIndex("url", "url", { unique: false });
}

function createSessionsStore(db) {
  if (db.objectStoreNames.contains(SESSION_DB_SCHEMA.stores.sessions)) return;

  const store = db.createObjectStore(SESSION_DB_SCHEMA.stores.sessions, { keyPath: "sessionId" });
  store.createIndex("workspaceId", "workspaceId", { unique: false });
  store.createIndex("sessionState", "sessionState", { unique: false });
  store.createIndex("startedAt", "startedAt", { unique: false });
}

function createProjectionsStore(db) {
  if (db.objectStoreNames.contains(SESSION_DB_SCHEMA.stores.projections)) return;

  const store = db.createObjectStore(SESSION_DB_SCHEMA.stores.projections, { keyPath: "projectionId" });
  store.createIndex("workspaceId", "workspaceId", { unique: false });
  store.createIndex("sessionId", "sessionId", { unique: false });
  store.createIndex("projectionState", "projectionState", { unique: false });
  store.createIndex("runtimeWindowId", "runtimeWindowId", { unique: false });
}

function createWorkspaceLinksStore(db) {
  if (db.objectStoreNames.contains(SESSION_DB_SCHEMA.stores.workspaceLinks)) return;

  const store = db.createObjectStore(SESSION_DB_SCHEMA.stores.workspaceLinks, { keyPath: "linkId" });
  store.createIndex("fromWorkspaceId", "fromWorkspaceId", { unique: false });
  store.createIndex("toWorkspaceId", "toWorkspaceId", { unique: false });
  store.createIndex("linkType", "linkType", { unique: false });
}

function createConstellationsStore(db) {
  if (db.objectStoreNames.contains(SESSION_DB_SCHEMA.stores.constellations)) return;

  const store = db.createObjectStore(SESSION_DB_SCHEMA.stores.constellations, { keyPath: "constellationId" });
  store.createIndex("rootWorkspaceId", "rootWorkspaceId", { unique: false });
  store.createIndex("updatedAt", "updatedAt", { unique: false });
}

function createJournalEntriesStore(db) {
  if (db.objectStoreNames.contains(SESSION_DB_SCHEMA.stores.journalEntries)) return;

  const store = db.createObjectStore(SESSION_DB_SCHEMA.stores.journalEntries, { keyPath: "journalEntryId" });
  store.createIndex("workspaceId", "workspaceId", { unique: false });
  store.createIndex("sessionId", "sessionId", { unique: false });
  store.createIndex("createdAt", "createdAt", { unique: false });
}

function createTimelineEventsStore(db) {
  if (db.objectStoreNames.contains(SESSION_DB_SCHEMA.stores.timelineEvents)) return;

  const store = db.createObjectStore(SESSION_DB_SCHEMA.stores.timelineEvents, { keyPath: "eventId" });
  store.createIndex("workspaceId", "workspaceId", { unique: false });
  store.createIndex("sessionId", "sessionId", { unique: false });
  store.createIndex("type", "type", { unique: false });
  store.createIndex("createdAt", "createdAt", { unique: false });
}

function createSummaryCardsStore(db) {
  if (db.objectStoreNames.contains(SESSION_DB_SCHEMA.stores.summaryCards)) return;

  const store = db.createObjectStore(SESSION_DB_SCHEMA.stores.summaryCards, { keyPath: "summaryCardId" });
  store.createIndex("workspaceId", "workspaceId", { unique: true });
  store.createIndex("updatedAt", "updatedAt", { unique: false });
}

function createSettingsStore(db) {
  if (db.objectStoreNames.contains(SESSION_DB_SCHEMA.stores.settings)) return;

  db.createObjectStore(SESSION_DB_SCHEMA.stores.settings, { keyPath: "key" });
}

function runRequest(db, storeName, mode, makeRequest) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const request = makeRequest(store);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Chrome Flow Session DB request failed."));
    transaction.onerror = () => reject(transaction.error || new Error("Chrome Flow Session DB transaction failed."));
  });
}
