import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inventoryPath = path.join(root, "docs/architecture/runtime-authority-inventory.json");
const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));

assert.equal(inventory.schema, "constellation-runtime-authority-inventory-v0.1");
assert.ok(Array.isArray(inventory.items) && inventory.items.length > 0, "inventory.items must be a non-empty array");
assert.ok(Array.isArray(inventory.protectedIdentityRequirements) && inventory.protectedIdentityRequirements.length > 0, "protectedIdentityRequirements must be a non-empty array");

const requiredFields = ["id", "path", "symbol", "context", "responsibility", "reads", "writes", "storage", "mutationType", "writeScope", "lockName", "events", "trigger", "browserMutation", "operatorConfirmation", "compatibilityIdentities", "confidence", "evidenceType", "notes"];
const arrayFields = ["reads", "writes", "storage", "events", "compatibilityIdentities"];
const allowedConfidence = new Set(["high", "medium", "low"]);
const allowedEvidenceTypes = new Set(["direct_observation", "inference"]);
const ids = new Set();

for (const item of inventory.items) {
  for (const field of requiredFields) assert.ok(Object.hasOwn(item, field), `${item.id || "unknown"}: missing required field ${field}`);
  for (const field of ["id", "path", "symbol", "context", "responsibility", "mutationType", "writeScope", "trigger", "notes"]) {
    assert.ok(typeof item[field] === "string" && item[field].trim(), `${item.id || "unknown"}: ${field} must be a non-empty string`);
  }
  if (Object.hasOwn(item, "conceptLabel")) assert.ok(typeof item.conceptLabel === "string" && item.conceptLabel.trim(), `${item.id}: conceptLabel must be a non-empty string when present`);
  for (const field of arrayFields) assert.ok(Array.isArray(item[field]), `${item.id}: ${field} must be an array`);
  assert.equal(typeof item.browserMutation, "boolean", `${item.id}: browserMutation must be boolean`);
  assert.ok(item.lockName === null || (typeof item.lockName === "string" && item.lockName.trim()), `${item.id}: lockName must be null or a non-empty string`);
  assert.ok(["boolean", "string"].includes(typeof item.operatorConfirmation), `${item.id}: operatorConfirmation must be boolean or a classification string`);
  if (typeof item.operatorConfirmation === "string") assert.ok(item.operatorConfirmation.trim(), `${item.id}: operatorConfirmation classification must not be empty`);
  assert.ok(allowedConfidence.has(item.confidence), `${item.id}: unsupported confidence ${item.confidence}`);
  assert.ok(allowedEvidenceTypes.has(item.evidenceType), `${item.id}: unsupported evidenceType ${item.evidenceType}`);
  assert.ok(!ids.has(item.id), `duplicate inventory id: ${item.id}`);
  ids.add(item.id);

  const absolute = path.resolve(root, item.path);
  const relative = path.relative(root, absolute);
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), `${item.id}: referenced path escapes repository root: ${item.path}`);
  await access(absolute);
  const source = await readFile(absolute, "utf8");
  assert.ok(source.includes(item.symbol), `${item.id}: exact source symbol/text not found in ${item.path}: ${item.symbol}`);
  if (item.lockName !== null) {
    const importedConstantReference = item.lockName === "constellation-runtime-state-v0.1" && source.includes("LOCK_NAMES.runtimeState")
      || item.lockName === "constellation-runtime-exclusive-operation-v0.1" && source.includes("LOCK_NAMES.exclusiveOperation");
    assert.ok(source.includes(item.lockName) || importedConstantReference, `${item.id}: lockName not found in referenced source ${item.path}: ${item.lockName}`);
  }
}

const protectedRequirements = inventory.protectedIdentityRequirements;
const protectedSet = new Set();
for (const identity of protectedRequirements) {
  assert.ok(typeof identity === "string" && identity.trim(), "protectedIdentityRequirements entries must be non-empty strings");
  assert.ok(!protectedSet.has(identity), `duplicate protected identity requirement: ${identity}`);
  protectedSet.add(identity);
}

for (const context of ["service_worker", "side_panel", "migration_page", "indexeddb", "browser_projection", "developer_validation"]) {
  assert.ok(inventory.items.some((item) => item.context === context), `missing critical runtime context: ${context}`);
}
for (const operation of ["active_workspace", "active_selection", "journal", "timeline", "diagnostics", "archive", "save", "resume", "import", "reconciliation", "migration", "browser_mutation"]) {
  assert.ok(inventory.items.some((item) => item.responsibility.includes(operation)), `missing critical operation class: ${operation}`);
}

const reconciliation = inventory.items.find((item) => item.id === "operation-reconciliation");
assert.equal(reconciliation?.mutationType, "workspace.projection.reconcile", "reconciliation must use its atomic semantic mutation");
assert.equal(reconciliation?.lockName, "constellation-runtime-state-v0.1", "reconciliation must share journal runtime-state authority");
assert.ok(reconciliation?.compatibilityIdentities.includes("constellationActiveWorkspace"), "reconciliation must name the canonical active-workspace peer");
assert.ok(reconciliation?.compatibilityIdentities.includes("chromeFlowWorkspace"), "reconciliation must name the legacy active-workspace peer");

const sessionAuthority = inventory.items.find((item) => item.id === "runtime-session-authority");
assert.equal(sessionAuthority?.mutationType, "serialized_single_key_transition", "runtime session authority must describe its bounded transition");
assert.equal(sessionAuthority?.lockName, "constellation-runtime-state-v0.1", "runtime session authority must use the shared runtime-state lock");
assert.deepEqual(sessionAuthority?.storage, ["chrome.storage.session"], "runtime session authority must remain session-scoped");
assert.ok(sessionAuthority?.compatibilityIdentities.includes("constellationRuntimeSessionAuthority"), "runtime session authority key must be inventoried");

const structuredEvidence = new Set();
for (const item of inventory.items) collectStrings(item, structuredEvidence);
for (const identity of protectedRequirements) {
  assert.ok(structuredEvidence.has(identity), `protected identity missing from structured inventory-item evidence: ${identity}`);
}

console.log(`Runtime inventory valid: ${inventory.items.length} unique items.`);

function collectStrings(value, output) {
  if (typeof value === "string") {
    output.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, output);
    return;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) collectStrings(entry, output);
  }
}
