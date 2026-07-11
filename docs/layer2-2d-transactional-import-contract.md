# Layer 2.2D — Transactional Import Execution and Post-Import Verification Contract

Status: **Implementation contract committed; live execution not yet enabled**

## Purpose

Provide a deterministic, Operator-authorized recovery path for a validated `constellation-data-migration-package-v0.1` package before any local folder or extension-identity migration occurs.

## Authority boundary

The import system may restore extension-owned data only. It must not:

- open, close, focus, move, or group browser tabs;
- execute page content;
- fetch network resources;
- delete an existing record;
- silently overwrite an existing record;
- rename the physical IndexedDB database;
- infer Operator consent from file selection alone.

## Supported execution policy

Layer 2.2D uses **create-or-identical only** semantics.

For every incoming storage key and IndexedDB record:

- missing in current state → eligible to create;
- present and byte-equivalent under stable canonical JSON → no-op;
- present with different content → block the complete import before writes.

Special compatibility policies remain explicit:

- diagnostic rings may be reconciled by `diagnosticId` only through their registered compatibility policy;
- existing non-diagnostic workspace, archive, settings, and durable-memory records may not be overwritten;
- physical database identity remains `chrome-flow-session-db` during this phase.

## Operator authorization

Execution requires all of the following:

1. package selected through a local file picker;
2. package schema and SHA-256 payload digest validated;
3. dry-run plan completed with zero conflicts;
4. explicit acknowledgement checkbox;
5. exact authorization phrase: `IMPORT CONSTELLATION DATA`;
6. a final confirmation displaying create, identical, conflict, and delete counts.

Selecting or inspecting a package never authorizes writes.

## Transaction model

IndexedDB and `chrome.storage` cannot participate in one native cross-API transaction. Layer 2.2D therefore uses a constrained two-phase write with compensating rollback:

1. acquire an exclusive import lock;
2. revalidate package and dry-run plan immediately before mutation;
3. capture a pre-import recovery snapshot and digest;
4. create all missing IndexedDB records in one multi-store read-write transaction using `add`, never `put`;
5. create missing `chrome.storage.local` keys only after confirming they remain absent;
6. create missing `chrome.storage.session` keys only after confirming they remain absent;
7. verify every incoming record and key;
8. on failure, remove only records and keys created by this execution;
9. verify rollback removed all created identities;
10. emit a structured execution packet.

Because existing values are never overwritten or deleted, rollback never needs to reconstruct an earlier existing value.

## Verification requirements

A successful execution must prove:

- package validation passed;
- pre-mutation plan had zero conflicts;
- no existing record was overwritten;
- no existing key was overwritten;
- no deletion was planned or executed;
- every incoming durable record is present and equivalent;
- every incoming storage key is present and equivalent under its policy;
- all newly created primary keys are unique;
- the physical IndexedDB name is unchanged;
- no browser mutation occurred;
- post-import Workspace Library, journal, timeline, session, projection, and settings counts match the verified package where the destination began empty;
- the import report records the source and destination extension IDs.

## Validation sequence

Layer 2.2D must be validated in this order:

1. valid-package inspection with no writes;
2. invalid-digest rejection;
3. conflict rejection with no writes;
4. exact-authorization rejection with no writes;
5. no-op execution against an identical current-state package;
6. disposable create test using synthetic uniquely identified records;
7. controlled failure after IndexedDB creation to prove rollback;
8. post-cleanup proof that no disposable records remain;
9. real migration rehearsal only after all controlled tests pass.

## Recovery surface

Import and recovery controls belong on a dedicated extension recovery page, not on the ordinary workspace surface. The recovery page must be usable before the side panel is opened in a newly loaded extension identity.

## Phase boundary

The verified production backup at:

`C:\Users\nolan\Documents\Constellation-Migration-Backup-2026-07-10.json`

must remain unchanged during controlled implementation tests.

Local folder rename and extension-identity migration remain blocked until Layer 2.2D is accepted.
