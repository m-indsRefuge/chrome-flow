import {
  EVENT_IDENTITIES,
  STORAGE_IDENTITIES
} from "../core/constellation-identity-contract.js";

import {
  runStorageMigrationPass
} from "../core/constellation-storage-migration-engine.js";

import {
  stableStringify
} from "../core/constellation-storage-compatibility.js";

const MIRRORED_LOCAL_IDENTITIES = Object.freeze([
  STORAGE_IDENTITIES.activeWorkspace,
  STORAGE_IDENTITIES.diagnostics,
  STORAGE_IDENTITIES.workspaceArchive
]);
const MIRRORED_SESSION_IDENTITIES = Object.freeze([
  STORAGE_IDENTITIES.workspaceLibrarySaveCoordinator
]);
const EVENT_BRIDGE_MARKER = "__constellationCompatibilityBridge";
const conflictRecords = [];
let storageMirrorQueue = Promise.resolve();

installConstellationCompatibilityBootstrap();

function installConstellationCompatibilityBootstrap() {
  installStorageWriteThroughBridge();
  installWorkspaceLibraryCompletionEventBridge();
  void runStartupMigration();
}

async function runStartupMigration() {
  try {
    const result = await runStorageMigrationPass();
    globalThis.__constellationCompatibilityMigration = result;
  } catch (error) {
    recordCompatibilityConflict("startup_migration_failed", {
      name: error?.name || "Error",
      message: error?.message || String(error)
    });
  }
}

function installStorageWriteThroughBridge() {
  if (!globalThis.chrome?.storage?.onChanged?.addListener) return;

  chrome.storage.onChanged.addListener((changes, areaName) => {
    const identities = areaName === "local"
      ? MIRRORED_LOCAL_IDENTITIES
      : areaName === "session"
        ? MIRRORED_SESSION_IDENTITIES
        : [];

    for (const identity of identities) {
      if (!changes?.[identity.canonicalKey] && !changes?.[identity.legacyKey]) continue;
      queueIdentityMirror(identity, changes, areaName);
    }
  });
}

function queueIdentityMirror(identity, changes, areaName) {
  const operation = storageMirrorQueue.then(() => mirrorChangedIdentity(identity, changes, areaName));
  storageMirrorQueue = operation.catch(() => undefined);
}

async function mirrorChangedIdentity(identity, changes, areaName) {
  const storageArea = areaName === "session"
    ? chrome.storage.session
    : chrome.storage.local;
  if (!storageArea) return;

  const canonicalChange = changes?.[identity.canonicalKey] || null;
  const legacyChange = changes?.[identity.legacyKey] || null;

  if (canonicalChange && legacyChange) {
    if (!valuesEquivalent(canonicalChange.newValue, legacyChange.newValue)) {
      recordCompatibilityConflict("simultaneous_peer_write_conflict", {
        identityId: identity.id,
        areaName,
        canonicalFingerprint: fingerprint(canonicalChange.newValue),
        legacyFingerprint: fingerprint(legacyChange.newValue)
      });
    }
    return;
  }

  const changedKey = canonicalChange ? identity.canonicalKey : identity.legacyKey;
  const peerKey = canonicalChange ? identity.legacyKey : identity.canonicalKey;
  const change = canonicalChange || legacyChange;
  if (!changedKey || !peerKey || !change) return;

  const peerResult = await storageArea.get(peerKey);
  const peerPresent = Object.prototype.hasOwnProperty.call(peerResult || {}, peerKey);
  const peerValue = peerPresent ? peerResult[peerKey] : undefined;
  const newValue = change.newValue;
  const oldValue = change.oldValue;

  if (typeof newValue === "undefined") {
    recordCompatibilityConflict("peer_deletion_not_mirrored", {
      identityId: identity.id,
      areaName,
      changedKey,
      peerKey
    });
    return;
  }

  const safeToMirror = !peerPresent
    || valuesEquivalent(peerValue, oldValue)
    || valuesEquivalent(peerValue, newValue);

  if (!safeToMirror) {
    recordCompatibilityConflict("independent_peer_value_detected", {
      identityId: identity.id,
      areaName,
      changedKey,
      peerKey,
      oldFingerprint: fingerprint(oldValue),
      newFingerprint: fingerprint(newValue),
      peerFingerprint: fingerprint(peerValue)
    });
    return;
  }

  if (!valuesEquivalent(peerValue, newValue)) {
    await storageArea.set({ [peerKey]: cloneSerializable(newValue) });
  }
}

function installWorkspaceLibraryCompletionEventBridge() {
  const identity = EVENT_IDENTITIES.workspaceLibrarySaveCompleted;
  bridgeWindowEvent(identity.legacy, identity.canonical);
  bridgeWindowEvent(identity.canonical, identity.legacy);
}

function bridgeWindowEvent(sourceType, targetType) {
  window.addEventListener(sourceType, (event) => {
    if (event?.detail?.[EVENT_BRIDGE_MARKER]) return;

    window.dispatchEvent(new CustomEvent(targetType, {
      detail: {
        ...(event?.detail || {}),
        [EVENT_BRIDGE_MARKER]: true,
        bridgedFrom: sourceType
      }
    }));
  });
}

function recordCompatibilityConflict(type, details = {}) {
  const record = {
    conflictId: crypto.randomUUID(),
    type,
    createdAt: new Date().toISOString(),
    details: cloneSerializable(details)
  };
  conflictRecords.push(record);
  if (conflictRecords.length > 50) conflictRecords.splice(0, conflictRecords.length - 50);
  globalThis.__constellationCompatibilityConflicts = [...conflictRecords];
  console.warn("Constellation compatibility conflict:", record);
}

function valuesEquivalent(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function fingerprint(value) {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return "fnv1a32:" + (hash >>> 0).toString(16).padStart(8, "0") + ":" + text.length;
}

function cloneSerializable(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export {
  installConstellationCompatibilityBootstrap
};
