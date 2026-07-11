# Layer 2.2C — Storage, Database, Event, and Packet Compatibility

## Status

Implementation and live-validation phase.

This document defines the migration inventory and classification policy used while the product identity changes from Chrome Flow to Constellation.

## Governing rule

Presentation may be renamed immediately. Persisted identity, durable memory, event contracts, and published packet schemas must move only through explicit compatibility boundaries.

No migration in Layer 2.2C may:

- delete a legacy storage key;
- silently choose between conflicting workspace values;
- rename the physical IndexedDB database in place;
- duplicate Workspace Library records;
- alter workspace, tab, journal, timeline, session, projection, link, constellation, summary-card, or settings identities;
- rewrite published historical packet schemas;
- perform an import without a validated package and an explicit later Operator gate.

## Classification model

### Canonical

New Constellation identity used by new implementation work.

### Legacy-compatible

Former-name identity that remains readable and writable during the migration window because current data or current modules depend on it.

### Historical-only

Published evidence identifier whose meaning is fixed. It remains readable and reproducible but is not used as a new product name.

## chrome.storage identities

| Authority | Canonical | Legacy-compatible | Area | Transition |
|---|---|---|---|---|
| Active runtime workspace | `constellationActiveWorkspace` | `chromeFlowWorkspace` | local | canonical-first read, legacy fallback, atomic write-through |
| Developer diagnostic ring | `constellationDiagnostics` | `chromeFlowDiagnostics` | local | merge by diagnostic identity, write-through |
| Diagnostic event shards | `constellationDiagnosticEvent:<id>` | `chromeFlowDiagnosticEvent:<id>` | local | read both, dual-write, deduplicate by `diagnosticId` |
| Legacy runtime archive | `constellationWorkspaceArchive` | `chromeFlowWorkspaceArchive` | local | canonical-first read, legacy fallback, write-through |
| Workspace Library save coordinator | `constellationWorkspaceLibrarySaveCoordinator` | `chromeFlowWorkspaceLibrarySaveCoordinator` | session preferred | read both, newest revision on conflict, write-through |
| Migration evidence | `constellationStorageIdentityMigration` | none | local | canonical-only marker |

The live migration package also inventories every additional extension-owned local and session key. Unregistered keys are classified as `inventory_required` rather than ignored.

## IndexedDB identity

| Property | Value | Classification |
|---|---|---|
| Logical canonical name | `constellation-session-db` | canonical |
| Physical continuity name | `chrome-flow-session-db` | legacy-compatible |
| Version | `1` | current physical schema |

The physical database remains `chrome-flow-session-db` until a complete export/import package has been validated against the live durable dataset. Layer 2.2C does not create a second database.

### Object stores

1. `workspaces`
2. `workspaceTabs`
3. `sessions`
4. `projections`
5. `workspaceLinks`
6. `constellations`
7. `journalEntries`
8. `timelineEvents`
9. `summaryCards`
10. `settings`

Primary identities are preserved exactly:

- `workspaceId`
- `workspaceTabId`
- `sessionId`
- `projectionId`
- `linkId`
- `constellationId`
- `journalEntryId`
- `eventId`
- `summaryCardId`
- settings `key`

The settings keys `activeWorkspaceId` and `dedicatedWindowThreshold` are semantic data contracts and are not product-brand identifiers.

## Event and message identities

| Contract | Canonical | Legacy-compatible | Transition |
|---|---|---|---|
| Workspace Library save completed | `constellation-workspace-library-save-completed` | `chrome-flow-workspace-library-save-completed` | emit and accept both |
| Reconcile workspace projection | `constellation-reconcile-workspace-projection` | `chrome-flow-reconcile-workspace-projection` | service worker accepts both |

Brand-neutral timeline and diagnostic event types, such as `workspace_tabs_refreshed`, are semantic contracts. They are not renamed merely because the product name changed.

## Packet envelopes

New canonical envelope:

- `CONSTELLATION_PACKET_START`
- `CONSTELLATION_PACKET_END`
- `constellation_packet_envelope_v0.1`

Legacy-compatible envelope:

- `CHROME_FLOW_PACKET_START`
- `CHROME_FLOW_PACKET_END`
- `chrome_flow_packet_envelope_v0.1`

New packet-envelope readers accept both forms. Existing historical formatters remain reproducible.

## Packet schema policy

Versioned packet schemas are historical evidence contracts. They are not renamed in place.

Examples include:

- `diagnostic-packet-v0.3`
- Layer 2 lifecycle, memory, persistence, projection, threshold, resume, and hardening validation schemas
- summary, reconciliation, and gate schemas

A structural change requires a new schema version. Product display identity may say Constellation while the schema remains `diagnostic-packet-v0.3`.

## Inventory evidence sources

### Registered contract inventory

`src/core/constellation-identity-contract.js` records known canonical, legacy-compatible, and historical policies.

### Runtime storage inventory

The migration data package exports every key from:

- `chrome.storage.local`
- `chrome.storage.session`, when available

### Reachable-source inventory

`src/core/constellation-source-contract-inventory.js` begins from the manifest and side-panel entry points, follows relative ES-module imports, and extracts:

- persisted identity literals;
- database names;
- branded event/message tokens;
- semantic snake-case contract candidates;
- packet/schema tokens;
- packet-envelope markers.

This source scanner is read-only and reports failed or truncated paths explicitly.

## Migration execution

The migration engine:

1. reads canonical and legacy peers;
2. compares deterministic fingerprints;
3. copies a missing peer;
4. merges diagnostics by diagnostic identity;
5. chooses the newest save coordinator when required;
6. blocks silent workspace/archive conflict resolution;
7. writes a migration marker;
8. performs a second pass;
9. proves the second pass changes no data identity;
10. performs no destructive deletion or physical database rename.

## Export and import safety

The migration package contains:

- complete local and session extension storage;
- all records from all ten IndexedDB stores;
- deterministic counts;
- primary-key uniqueness checks;
- workspace-reference checks;
- a stable JSON SHA-256 payload digest;
- source extension and database identities.

The current import implementation is a dry-run planner only. It classifies records as create, identical, or conflict and plans no deletion. Actual writes remain a later Operator-gated action after live validation and local-path migration readiness.

## Live completion requirement

Layer 2.2C closes only when live evidence proves:

- ten Workspace Library workspace records exist before and after migration;
- every IndexedDB store count and content fingerprint is unchanged;
- the active runtime workspace identity and counts are unchanged;
- the durable `activeWorkspaceId` is unchanged;
- canonical and legacy storage peers are equivalent;
- the second migration pass is idempotent;
- the export digest validates;
- the import dry run reports no conflicts and performs no writes;
- no compatibility conflict, runtime error, or unhandled rejection is present.
