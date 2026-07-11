import {
  STORAGE_IDENTITIES
} from "./constellation-identity-contract.js";

import {
  readCompatibleStorageValue,
  writeCompatibleStorageValue
} from "./constellation-storage-compatibility.js";

const LEGACY_DIAGNOSTICS_KEY = STORAGE_IDENTITIES.diagnostics.legacyKey;
const CANONICAL_DIAGNOSTICS_KEY = STORAGE_IDENTITIES.diagnostics.canonicalKey;
const DIAGNOSTIC_EVENT_PREFIX = STORAGE_IDENTITIES.diagnosticEventShard.legacyPrefix;
const CANONICAL_DIAGNOSTIC_EVENT_PREFIX = STORAGE_IDENTITIES.diagnosticEventShard.canonicalPrefix;
const MAX_DIAGNOSTICS = 200;
const HARDENING_SOURCE_PREFIX = "layer2_1h_";
const HARDENING_CORRELATION_WINDOW_MS = 30000;

let diagnosticWriteQueue = Promise.resolve();

function appendDiagnosticEvent(level, action, message, details = {}) {
  const operation = diagnosticWriteQueue.then(async () => {
    const correlatedDetails = await resolveDiagnosticCorrelation(action, details);
    const diagnostic = createDiagnosticEvent(level, action, message, correlatedDetails);
    await chrome.storage.local.set({
      [CANONICAL_DIAGNOSTIC_EVENT_PREFIX + diagnostic.diagnosticId]: diagnostic,
      [DIAGNOSTIC_EVENT_PREFIX + diagnostic.diagnosticId]: diagnostic
    });
    await pruneDiagnosticEventShards();
    return diagnostic;
  });

  diagnosticWriteQueue = operation.catch(() => undefined);
  return operation;
}

async function getDiagnosticEvents() {
  const [result, compatibleDiagnostics] = await Promise.all([
    chrome.storage.local.get(null),
    readCompatibleStorageValue("diagnostics")
  ]);
  const ringDiagnostics = Array.isArray(compatibleDiagnostics.value)
    ? compatibleDiagnostics.value
    : [];
  const shardDiagnostics = Object.entries(result)
    .filter(([key, value]) => isDiagnosticShardKey(key) && isDiagnosticEvent(value))
    .map(([, value]) => value);

  return mergeDiagnosticEvents(ringDiagnostics, shardDiagnostics).slice(-MAX_DIAGNOSTICS);
}

function clearDiagnosticEvents() {
  const operation = diagnosticWriteQueue.then(async () => {
    const result = await chrome.storage.local.get(null);
    const shardKeys = Object.keys(result).filter(isDiagnosticShardKey);

    if (shardKeys.length) {
      await chrome.storage.local.remove(shardKeys);
    }

    await writeCompatibleStorageValue("diagnostics", []);
    return [];
  });

  diagnosticWriteQueue = operation.catch(() => undefined);
  return operation;
}

async function reconcileDiagnosticEventRing() {
  const diagnostics = await getDiagnosticEvents();
  const compatibleRead = await readCompatibleStorageValue("diagnostics");
  const current = Array.isArray(compatibleRead.value) ? compatibleRead.value : [];

  if (
    diagnosticSequenceSignature(current) !== diagnosticSequenceSignature(diagnostics)
    || !compatibleRead.canonicalPresent
    || !compatibleRead.legacyPresent
    || !compatibleRead.equivalent
  ) {
    await writeCompatibleStorageValue("diagnostics", diagnostics);
  }

  return diagnostics;
}

async function pruneDiagnosticEventShards() {
  const result = await chrome.storage.local.get(null);
  const byDiagnosticId = new Map();

  for (const [key, value] of Object.entries(result)) {
    if (!isDiagnosticShardKey(key) || !isDiagnosticEvent(value)) continue;
    const diagnosticId = value.diagnosticId || createLegacyDiagnosticIdentity(value);
    if (!byDiagnosticId.has(diagnosticId)) {
      byDiagnosticId.set(diagnosticId, value);
    }
  }

  const ordered = Array.from(byDiagnosticId.entries())
    .sort((left, right) => compareDiagnostics(left[1], right[1]));
  if (ordered.length <= MAX_DIAGNOSTICS) return;

  const obsoleteDiagnosticIds = ordered
    .slice(0, ordered.length - MAX_DIAGNOSTICS)
    .map(([diagnosticId]) => diagnosticId);
  const obsoleteKeys = [];

  for (const diagnosticId of obsoleteDiagnosticIds) {
    obsoleteKeys.push(
      CANONICAL_DIAGNOSTIC_EVENT_PREFIX + diagnosticId,
      DIAGNOSTIC_EVENT_PREFIX + diagnosticId
    );
  }

  if (obsoleteKeys.length) {
    await chrome.storage.local.remove(obsoleteKeys);
  }
}

async function resolveDiagnosticCorrelation(action, details = {}) {
  const normalizedDetails = sanitizeValue(details) || {};

  if (hasExplicitCorrelation(normalizedDetails)) {
    return normalizedDetails;
  }

  if (
    action !== "workspace_resume_operation_blocked"
    || !String(normalizedDetails.source || "").startsWith(HARDENING_SOURCE_PREFIX)
  ) {
    return normalizedDetails;
  }

  const activeRun = await findRecentHardeningRunCorrelation();
  if (!activeRun) return normalizedDetails;

  return {
    ...normalizedDetails,
    correlationId: activeRun.regressionRunId,
    regressionRunId: activeRun.regressionRunId,
    correlationResolution: "inferred_from_active_layer2_1h_regression_run",
    correlationEvidenceDiagnosticId: activeRun.diagnosticId
  };
}

async function findRecentHardeningRunCorrelation() {
  const diagnostics = await getDiagnosticEvents();
  const cutoff = Date.now() - HARDENING_CORRELATION_WINDOW_MS;

  for (let index = diagnostics.length - 1; index >= 0; index -= 1) {
    const diagnostic = diagnostics[index];
    const createdAtMs = Date.parse(diagnostic?.createdAt || "");
    if (!Number.isFinite(createdAtMs) || createdAtMs < cutoff) continue;

    const regressionRunId = String(diagnostic?.details?.regressionRunId || "");
    if (!regressionRunId) continue;

    const action = String(diagnostic?.action || "");
    if (
      action === "layer2_1h_concurrent_write_probe"
      || action === "layer2_hardening_regression_case_completed"
      || action === "layer2_hardening_regression_case_failed"
    ) {
      return {
        regressionRunId,
        diagnosticId: diagnostic.diagnosticId || ""
      };
    }
  }

  return null;
}

function hasExplicitCorrelation(details = {}) {
  return Boolean(
    details.correlationId
    || details.regressionRunId
    || details.operationId
    || details.traceId
  );
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

function isDiagnosticShardKey(key) {
  return String(key || "").startsWith(DIAGNOSTIC_EVENT_PREFIX)
    || String(key || "").startsWith(CANONICAL_DIAGNOSTIC_EVENT_PREFIX);
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
  CANONICAL_DIAGNOSTIC_EVENT_PREFIX,
  CANONICAL_DIAGNOSTICS_KEY,
  DIAGNOSTIC_EVENT_PREFIX,
  LEGACY_DIAGNOSTICS_KEY,
  MAX_DIAGNOSTICS,
  appendDiagnosticEvent,
  clearDiagnosticEvents,
  getDiagnosticEvents,
  mergeDiagnosticEvents,
  reconcileDiagnosticEventRing
};
