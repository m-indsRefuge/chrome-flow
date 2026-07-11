# Protected Identities and Compatibility Register

## Status

Authoritative protection register for Constellation persisted identities, compatibility surfaces, and historical evidence contracts.

An item listed here must not be renamed, removed, rewritten, consolidated, or treated as stale without a separately authorized retirement phase.

## IndexedDB identity

Logical canonical identity:

```text
constellation-session-db
```

Physical database name:

```text
chrome-flow-session-db
```

Current physical database version:

```text
1
```

The physical database name is deliberately preserved. Do not rename it as branding cleanup or create a replacement database without an approved export/import, rollback, and retirement design.

## Durable store names

The current physical stores are:

```text
workspaces
workspaceTabs
sessions
projections
workspaceLinks
constellations
journalEntries
timelineEvents
summaryCards
settings
```

Store names and key paths are persisted schema contracts.

## Settings identities

Current known settings keys include:

```text
activeWorkspaceId
dedicatedWindowThreshold
```

`activeWorkspaceId` is a current compatibility and runtime contract even though a future multi-window design may require scoped runtime assignments. Preserve the existing key as a legacy/default pointer unless an approved migration says otherwise.

## Storage identity pairs

### Active workspace

```text
Canonical: constellationActiveWorkspace
Legacy:    chromeFlowWorkspace
Area:      chrome.storage.local
```

Authority: active runtime memory.

### Diagnostics

```text
Canonical: constellationDiagnostics
Legacy:    chromeFlowDiagnostics
Area:      chrome.storage.local
```

Authority: developer evidence ring.

### Diagnostic event shards

```text
Canonical prefix: constellationDiagnosticEvent:
Legacy prefix:    chromeFlowDiagnosticEvent:
Area:             chrome.storage.local
```

Authority: developer evidence shards.

### Workspace archive

```text
Canonical: constellationWorkspaceArchive
Legacy:    chromeFlowWorkspaceArchive
Area:      chrome.storage.local
```

Authority: legacy runtime archive compatibility.

### Workspace Library save coordinator

```text
Canonical: constellationWorkspaceLibrarySaveCoordinator
Legacy:    chromeFlowWorkspaceLibrarySaveCoordinator
Area:      chrome.storage.session when available, local fallback where defined
```

Authority: cross-context save coordination.

### Migration state

```text
Canonical: constellationStorageIdentityMigration
Area:      chrome.storage.local
```

Authority: storage-identity migration evidence.

## Event identities

### Workspace Library save completion

```text
Canonical: constellation-workspace-library-save-completed
Legacy:    chrome-flow-workspace-library-save-completed
Policy:    emit and accept both while compatibility remains active
```

### Workspace projection reconciliation

```text
Canonical: constellation-reconcile-workspace-projection
Legacy:    chrome-flow-reconcile-workspace-projection
Policy:    emit or accept both during transition
```

Do not consolidate event names until every producer, listener, test, packet, documentation reference, persisted marker, and live upgrade path has been traced.

## Packet envelopes

Canonical envelope:

```text
CONSTELLATION_PACKET_START
CONSTELLATION_PACKET_END
constellation_packet_envelope_v0.1
```

Legacy envelope:

```text
CHROME_FLOW_PACKET_START
CHROME_FLOW_PACKET_END
chrome_flow_packet_envelope_v0.1
```

Readers may accept both according to the current compatibility contract.

## Published schemas

Published versioned schema identifiers are immutable historical evidence contracts.

Current examples include:

```text
constellation-identity-contract-v0.1
constellation-storage-identity-migration-v0.1
diagnostic-packet-v0.3
```

Do not rename a published schema in place. A structural change requires a new schema version and an explicit compatibility policy.

This register is not exhaustive of every historical packet schema. A coding agent must trace packet producers, validators, importers, documentation, and historical validation evidence before changing any versioned identifier.

## Protected mechanisms and artifacts

Protect:

- legacy/canonical storage bridges;
- compatibility bootstrap listeners;
- migration markers;
- import/export package formats;
- package digests and sidecars;
- recovery packages;
- rollback tooling;
- path and extension-identity migration scripts;
- historical packet generators;
- historical validation documents;
- accepted audit and retirement evidence;
- former product strings where they identify persisted or published contracts.

Historical validation modules and documents are not dead merely because their runtime phase is complete.

## Prohibited assumptions

Do not assume:

- `chrome-flow` means obsolete;
- canonical and legacy peers are accidental duplication;
- completed migration code is safe to delete;
- a historical packet can be reformatted without consequence;
- a validation-only module has no production value;
- one current reader search proves every historical reader has migrated;
- Git history alone replaces runtime recovery artifacts.

## Retirement evidence gate

Before proposing retirement, produce:

1. complete reader inventory;
2. complete writer inventory;
3. manifest, HTML, static import, dynamic import, event, message, script, documentation, validation, migration, and recovery reference trace;
4. old-key-only fixture;
5. canonical-key-only fixture;
6. dual-key compatible fixture;
7. conflict fixture;
8. export/import recovery proof;
9. rollback proof;
10. live upgrade validation plan;
11. explicit Operator authorization.

Without this evidence, classify the item as `compatibility_contract`, `needs_experiment`, or `possible_false_positive`.

## Change-report requirement

Any authorized task touching a protected identity must report:

- exact identity;
- whether it was read, written, moved, aliased, or versioned;
- compatibility behavior before and after;
- fixtures and live validations used;
- rollback path;
- evidence that no persisted state is stranded.
