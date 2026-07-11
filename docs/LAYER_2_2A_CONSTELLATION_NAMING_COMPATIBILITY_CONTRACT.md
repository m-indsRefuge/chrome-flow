# Layer 2.2A — Constellation Naming and Compatibility Contract

## Status

Committed migration contract.

This contract governs the project-wide transition from the former product name **Chrome Flow** to the canonical product name **Constellation**.

The GitHub repository has already been renamed to:

```text
m-indsRefuge/constellation
```

The local unpacked-extension folder remains temporarily at its legacy path until deterministic export/import and extension-identity validation are available.

## Canonical identity

The canonical product name is:

```text
Constellation
```

The product name does not include `Browsing Agent`, `Browser Agent`, or another functional suffix.

Functional descriptions belong in the manifest description, README, GitHub description, release notes, and product documentation.

Recommended concise description:

> A local-first browser cognitive workspace for organising live research, durable workspace memory, recovery, and future deterministic, algorithmic, and AI-assisted workflows.

## Core migration rule

> Rename presentation and new implementation identities immediately where safe. Migrate persisted identities through explicit, versioned, idempotent compatibility pathways. Never trade existing workspace continuity for cosmetic naming consistency.

## Identity categories

Every occurrence of the former name must be classified before it is changed.

### 1. Product presentation identity

Examples:

- manifest name and description;
- side-panel headings and help text;
- Operator-facing confirmation dialogs;
- current README and release notes;
- current diagnostic descriptions;
- current packet product names.

Policy:

```text
Rename to Constellation.
```

### 2. Source-code terminology

Examples:

- new module names;
- new exported function names;
- new constants;
- new internal events;
- new schemas;
- new test fixtures.

Policy:

```text
Use Constellation terminology for all new work.
Migrate existing identifiers incrementally when doing so does not create storage or protocol ambiguity.
```

### 3. Persisted runtime keys

Examples:

```text
chromeFlowWorkspace
chromeFlowDiagnostics
chromeFlowWorkspaceLibrarySaveCoordinator
```

Policy:

```text
Do not blindly rename.
Introduce canonical Constellation keys through a versioned compatibility adapter.
Read canonical first.
Read legacy only as fallback.
Migrate once after validation.
Prevent duplicate state.
Retain legacy read compatibility through the declared migration window.
```

### 4. IndexedDB / Session DB identity

Examples:

- database name;
- object-store names;
- index names;
- record schema identifiers.

Policy:

```text
Do not rename the database merely for branding.
Preserve the existing database identity unless a schema migration requires a new version.
Where names change, migrate transactionally and verify record parity before activation.
```

### 5. Packet and clipboard protocol identity

Legacy examples:

```text
CHROME_FLOW_PACKET_START
CHROME_FLOW_PACKET_END
chrome_flow_packet_envelope_v0.1
```

Canonical new examples:

```text
CONSTELLATION_PACKET_START
CONSTELLATION_PACKET_END
constellation_packet_envelope_v0.1
```

Policy:

```text
Newly generated packets use the Constellation envelope after the packet migration slice activates.
Readers accept both canonical and declared legacy envelopes during compatibility.
Existing packet schemas remain readable.
A product rename alone must not invalidate old diagnostic or migration evidence.
```

### 6. Internal event identity

Legacy example:

```text
chrome-flow-workspace-library-save-completed
```

Canonical example:

```text
constellation-workspace-library-save-completed
```

Policy:

```text
New event producers should publish the canonical event.
During migration, consumers may listen to both names where needed.
Avoid double processing when both aliases are emitted.
Retire a legacy event only after repository search and live validation prove no remaining consumer depends on it.
```

### 7. Historical evidence

Examples:

- Git history;
- merged pull requests;
- old validation packets;
- archived screenshots;
- previous release notes;
- historical documentation whose purpose is to record an earlier state.

Policy:

```text
Do not rewrite history.
The former name remains valid historical evidence.
Add a short former-name note only where current readers would otherwise be confused.
```

## Canonical namespace policy

New implementation work should prefer:

```text
constellation...
Constellation...
CONSTELLATION_...
constellation-...
```

Examples:

```text
constellationRuntimeRegistry
ConstellationMigrationPacket
CONSTELLATION_PACKET_START
constellation-workspace-library-save-completed
```

Legacy identifiers may remain temporarily only when they are:

- persisted storage contracts;
- protocol compatibility aliases;
- historical evidence;
- migration inputs;
- explicitly documented compatibility shims.

No new feature may introduce an additional `chromeFlow...` identifier.

## Storage compatibility contract

For every migrated persisted key, the adapter must implement this order:

```text
1. Read canonical Constellation key.
2. If canonical state is valid, use it and do not merge legacy state blindly.
3. If canonical state is absent, inspect the declared legacy key.
4. Validate legacy schema and identity.
5. Write canonical state once.
6. Read canonical state back.
7. Compare workspace IDs, record counts, and integrity fields.
8. Record migration evidence.
9. Keep legacy state unchanged until post-migration verification passes.
10. Never create a second workspace merely because both key names exist.
```

Required migration metadata:

```text
migrationId
migrationSchema
sourceKey
canonicalKey
sourceRecordCount
canonicalRecordCount
workspaceIdsBefore
workspaceIdsAfter
startedAt
completedAt
verificationStatus
legacyFallbackStillEnabled
```

## Durable database compatibility contract

The Workspace Library / Session DB remains durable authority for saved workspace identity and history.

A naming migration must preserve:

- workspace IDs;
- workspace-tab IDs;
- lifecycle state;
- archive/resume provenance;
- user journals;
- system timeline events;
- recovery records;
- sessions;
- projections;
- summary cards;
- explicit links;
- Constellation membership records;
- active durable workspace identity.

Required invariant:

```text
Brand migration must not create, delete, merge, split, activate, pause, archive, or resume a workspace.
```

## Runtime compatibility contract

The current singleton runtime and the forthcoming multi-workspace registry must remain readable during migration.

The rename may change labels and exported names, but it may not alter:

- runtime workspace identity;
- live tab ownership;
- window/group projection fields;
- action locks;
- reconciliation state;
- current browser projection;
- Workspace Library snapshot contents.

The Layer 2.1J multi-workspace implementation will use canonical Constellation names from its first schema version.

The legacy singleton key becomes a compatibility projection and must not be deleted until the multi-workspace adapter has passed live parity validation.

## Extension identity and local-path contract

The current unpacked extension remains loaded from the legacy local path until deterministic migration protection exists:

```text
C:\Users\nolan\AIProjects\chrome-flow
```

Target path:

```text
C:\Users\nolan\AIProjects\constellation
```

The folder rename is deferred because a changed unpacked-extension identity may expose a new storage origin.

Before local-path migration:

1. Build deterministic export.
2. Build transactional import.
3. Export current runtime and durable state.
4. Verify export counts and integrity hashes.
5. Record the current extension ID.
6. Rename the local folder.
7. Load the renamed unpacked extension.
8. Compare the resulting extension ID.
9. Import only if required.
10. Verify state parity before removing the former installation.

No arbitrary manifest `key` may be introduced merely to force identity continuity. A manifest-key decision requires a separate identity review.

## Git and repository contract

Canonical repository:

```text
https://github.com/m-indsRefuge/constellation.git
```

The local Git remote should use the canonical URL while the local folder may temporarily retain the old name.

Renaming the repository does not require rewriting branches, commits, tags, issues, or pull requests.

Future branch and document names should use `constellation` where product identity is part of the name. Existing active branches may complete under their current names to preserve continuity.

## Product branding migration boundaries

The branding sweep must be reviewed by category rather than performed as an unrestricted global replacement.

Allowed immediate replacements:

- manifest product name;
- visible side-panel product name;
- current README title and description;
- current confirmation-dialog product language;
- current packet display names;
- new console messages;
- new diagnostics descriptions.

Requires compatibility handling:

- storage keys;
- event names;
- IndexedDB names;
- packet envelope markers;
- schema identifiers;
- exported APIs used across modules;
- test fixtures that validate legacy packet shapes.

Historical-only occurrences remain unchanged.

## Direct Workspace Library refresh boundary

The automatic Workspace Library surface must call an internal refresh function directly.

It must not simulate an Operator button click or dispatch a click event to a hidden compatibility control.

Required diagnostic result:

```text
invocationMode: direct_internal_function
operatorClickRecorded: false
manualRefreshRequired: false
```

The hidden manual button may remain temporarily as a legacy compatibility control, but it is not part of automatic execution and is not an end-user responsibility.

## Migration evidence package

Before the local folder is renamed, Constellation must produce an export package containing:

- extension ID and manifest version;
- export schema and timestamp;
- active runtime state;
- all Workspace Library records;
- tabs, sessions, projections, journals, timeline and recovery records;
- summary cards, links, and Constellation records;
- relevant runtime settings;
- per-store record counts;
- stable workspace-ID sets;
- integrity hashes;
- explicit exclusions.

Explicit exclusions include:

- page body content;
- unrelated browser history;
- unrelated Chrome tabs;
- credentials, cookies, and authentication material;
- diagnostic data not required for continuity, unless explicitly selected.

## Validation gates

Layer 2.2A is complete only when the contract is committed and the direct-refresh boundary is implemented.

Later naming slices must prove:

```text
manifest displays Constellation
normal product surfaces display Constellation
new packets use canonical identity where activated
legacy packets remain readable
canonical storage migration is idempotent
Workspace Library record counts remain equal
workspace ID sets remain equal
journal and timeline counts remain equal
no duplicate workspaces appear
extension reload preserves or verified import restores state
browser tabs and groups are not mutated by branding migration
```

## Planned Layer 2.2 sequence

```text
Layer 2.2A — Naming and compatibility contract
Layer 2.2B — Product and code branding migration
Layer 2.2C — Storage, database, event, and packet compatibility
Layer 2.2D — Deterministic export/import safety package
Layer 2.2E — Local path and extension identity migration
Layer 2.2F — Post-rename live validation
```

The GitHub repository rename has already been completed and is recorded as part of Layer 2.2A context.

## Relationship to Layer 2.1J

Layer 2.2 completes the naming and continuity foundation before the multi-workspace runtime becomes substantially larger.

Layer 2.1J schemas must use canonical Constellation terminology from inception while retaining declared adapters for the legacy singleton runtime and persisted keys.

The naming migration must not weaken the deterministic authority boundaries already committed for runtime, browser projection, durable memory, relationships, algorithms, or future AI interpretation.
