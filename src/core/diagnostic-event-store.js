const LEGACY_DIAGNOSTICS_KEY = "chromeFlowDiagnostics";
const DIAGNOSTIC_EVENT_PREFIX = "chromeFlowDiagnosticEvent:";
const MAX_DIAGNOSTICS = 200;

let diagnosticWriteQueue = Promise.resolve();

function appendDiagnosticEvent(level, action, message, details = {}) {
  const operation = diagnosticWriteQueue.then(async () => {
    const diagnostic = createDiagnosticEvent(level, action, message, details);
    await chrome.storage.local.set({
      [DIAGNOSTIC_EVENT_PREFIX + diagnostic.diagnosticId]: diagnostic
    });
    await pruneDiagnosticEventShards();
    return diagnostic;
  });

  diagnosticWriteQueue = operation.catch(() => undefined);
  return operation;
}

async function getDiagnosticEvents() {
  const result = await chrome.storage.local.get(null);
  const legacyDiagnostics = Array.isArray(result[LEGACY_DIAGNOSTICS_KEY])
    ? result[LEGACY_DIAGNOSTICS_KEY]
    : [];
  const shardDiagnostics = Object.entries(result)
    .filter(([key, value]) => key.startsWith(DIAGNOSTIC_EVENT_PREFIX) && isDiagnosticEvent(value))
    .map(([, value]) => value);

  return mergeDiagnosticEvents(legacyDiagnostics, shardDiagnostics).slice(-MAX_DIAGNOSTICS);
}

function clearDiagnosticEvents() {
  const operation = diagnosticWriteQueue.then(async () => {
    const result = await chrome.storage.local.get(null);
    const shardKeys = Object.keys(result).filter((key) => key.startsWith(DIAGNOSTIC_EVENT_PREFIX));

    if (shardKeys.length) {
      await chrome.storage.local.remove(shardKeys);
    }

    await chrome.storage.local.set({ [LEGACY_DIAGNOSTICS_KEY]: [] });
    return [];
  });

  diagnosticWriteQueue = operation.catch(() => undefined);
  return operation;
}

async function reconcileDiagnosticEventRing() {
  const diagnostics = await getDiagnosticEvents();
  const result = await chrome.storage.local.get(LEGACY_DIAGNOSTICS_KEY);
  const current = Array.isArray(result[LEGACY_DIAGNOSTICS_KEY]) ? result[LEGACY_DIAGNOSTICS_KEY] : [];

  if (diagnosticSequenceSignature(current) !== diagnosticSequenceSignature(diagnostics)) {
    await chrome.storage.local.set({ [LEGACY_DIAGNOSTICS_KEY]: diagnostics });
  }

  return diagnostics;
}

async function pruneDiagnosticEventShards() {
  const result = await chrome.storage.local.get(null);
  const shardEntries = Object.entries(result)
    .filter(([key, value]) => key.startsWith(DIAGNOSTIC_EVENT_PREFIX) && isDiagnosticEvent(value))
    .sort((left, right) => compareDiagnostics(left[1], right[1]));

  if (shardEntries.length <= MAX_DIAGNOSTICS) return;

  const obsoleteKeys = shardEntries
    .slice(0, shardEntries.length - MAX_DIAGNOSTICS)
    .map(([key]) => key);

  if (obsoleteKeys.length) {
    await chrome.storage.local.remove(obsoleteKeys);
  }
}

function createDiagnosticEvent(level, action, message, details) {
  const normalizedDetails = sanitizeValue(details) || {};
  const correlationId = String(
    normalizedDetails.correlationId
    || normalizedDetails.regressionRunId
    || normalizedDetails.operationId
    || normalizedDetails.traceId
    || ""
  );

  return {
    diagnosticId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    level: String(level || "info"),
    action: String(action || "diagnostic_event"),
    message: String(message || "Diagnostic event recorded."),
    correlationId,
    details: normalizedDetails
  };
}

function mergeDiagnosticEvents(...collections) {
  const byId = new Map();

  for (const collection of collections) {
    for (const diagnostic of Array.isArray(collection) ? collection : []) {
      if (!isDiagnosticEvent(diagnostic)) continue;
      const diagnosticId = diagnostic.diagnosticId || createLegacyDiagnosticIdentity(diagnostic);
      byId.set(diagnosticId, { ...diagnostic, diagnosticId });
    }
  }

  return Array.from(byId.values()).sort(compareDiagnostics);
}

function compareDiagnostics(left, right) {
  const createdComparison = String(left?.createdAt || "").localeCompare(String(right?.createdAt || ""));
  if (createdComparison !== 0) return createdComparison;
  return String(left?.diagnosticId || "").localeCompare(String(right?.diagnosticId || ""));
}

function diagnosticSequenceSignature(diagnostics) {
  return (Array.isArray(diagnostics) ? diagnostics : [])
    .map((diagnostic) => diagnostic?.diagnosticId || createLegacyDiagnosticIdentity(diagnostic))
    .join("|");
}

function createLegacyDiagnosticIdentity(diagnostic) {
  return [
    diagnostic?.createdAt || "",
    diagnostic?.level || "",
    diagnostic?.action || "",
    diagnostic?.message || "",
    stableStringify(diagnostic?.details || {})
  ].join("::");
}

function isDiagnosticEvent(value) {
  return Boolean(value && typeof value === "object" && value.action && value.createdAt);
}

function sanitizeValue(value, depth = 0) {
  if (depth > 8) return "[depth-limited]";
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return {
      name: value.name || "Error",
      message: value.message || String(value),
      stack: typeof value.stack === "string" ? value.stack.slice(0, 2000) : ""
    };
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeValue(item, depth + 1)])
    );
  }
  return String(value);
}

function stableStringify(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stableStringify(value[key])).join(",") + "}";
}

export {
  DIAGNOSTIC_EVENT_PREFIX,
  LEGACY_DIAGNOSTICS_KEY,
  MAX_DIAGNOSTICS,
  appendDiagnosticEvent,
  clearDiagnosticEvents,
  getDiagnosticEvents,
  mergeDiagnosticEvents,
  reconcileDiagnosticEventRing
};