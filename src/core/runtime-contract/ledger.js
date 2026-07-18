import { SCHEMAS } from "./constants.js";
import { clone } from "./value-utils.js";
export function createOperationLedger(maxEntries = 1000) {
  if (!Number.isInteger(maxEntries) || maxEntries <= 0) throw new TypeError("maxEntries must be a positive integer");
  return { schema: SCHEMAS.ledger, maxEntries, nextSequence: 1, entries: [] };
}
export function inspectOperation(ledger, operationId, requestFingerprint) {
  const entry = ledger.entries.find((candidate) => candidate.operationId === operationId);
  if (!entry) return { status: "missing" };
  return entry.requestFingerprint === requestFingerprint ? { status: "replay", entry: clone(entry) } : { status: "conflict", entry: clone(entry) };
}
export function recordOperation(ledger, record) {
  if (ledger.entries.some((entry) => entry.operationId === record.operationId)) return { status: "exists", ledger: clone(ledger) };
  const next = clone(ledger);
  next.entries.push({ ...clone(record), sequence: next.nextSequence++ });
  next.entries.sort((a, b) => a.sequence - b.sequence);
  while (next.entries.length > next.maxEntries) next.entries.shift();
  return { status: "recorded", ledger: next };
}
