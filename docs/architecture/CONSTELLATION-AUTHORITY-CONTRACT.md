# Constellation Authority Contract

## Status

Authoritative repository contract for current and future Constellation development.

This document records established product and state-authority doctrine. It does not by itself authorize multi-window implementation or change existing persistence behavior.

## Product identity

Constellation is a local-first browser cognitive workspace and Chrome extension.

The former product name was Chrome Flow. Legacy names may remain active where they preserve persisted identity, compatibility, published evidence, migration, recovery, or rollback.

The Cognitive Workspace Core is the product. Optional future algorithmic and AI layers sit above the deterministic system.

## Operator authority

Nolan is the Operator and final authority for:

- product intent;
- meaningful browser or workspace mutation;
- privacy and consent;
- architectural acceptance;
- compatibility retirement;
- live validation;
- release and merge decisions.

A model or algorithm may propose, classify, infer, summarize, or explain. It does not receive implicit authority to mutate state, change identity, operate the browser, or publish data.

## State-authority hierarchy

### Durable workspace memory

IndexedDB / Session DB is durable workspace memory.

It stores durable workspace entities, snapshots, sessions, projections, journal records, timeline records, summary cards, settings, and related relationships.

Durable memory must not be silently reconstructed from browser state when authoritative records already exist.

### Active runtime state

`chrome.storage.local` is active runtime state.

It represents the currently active workspace and related runtime surfaces needed across extension contexts. Active runtime state is not a substitute for durable workspace memory.

Changes to active runtime state must preserve Operator-authored fields, compatibility peers, and downstream durable-save behavior.

### Browser projection

Chrome tabs, windows, and tab groups are live projections.

Browser identifiers are ephemeral evidence, not durable identity. Tab IDs, window IDs, and group IDs must be revalidated before browser mutation or durable attachment.

The browser projection may reflect a workspace incompletely. Missing tabs are not equivalent to deleted durable workspace records.

### Derived and diagnostic state

UI views, counters, previews, diagnostics, validation packets, and summary surfaces are derived evidence.

A derived surface may describe state but must not silently become state authority.

## Deterministic ownership

The deterministic core owns:

- workspace and record identity;
- authority boundaries;
- storage and persistence contracts;
- browser projection matching;
- validation and conflict handling;
- permission gates;
- rollback and recovery;
- durable recall;
- operation evidence.

Algorithms may infer relationships, relevance, priority, similarity, staleness, or likely intent only inside explicit contracts.

Future AI providers may interpret structured state and return suggestions only through validated adapter contracts. They do not own workspace state, browser authority, persistence, memory policy, tool permissions, or mutation.

## Runtime contexts

Current execution contexts include:

- Manifest V3 background service worker;
- side-panel documents;
- migration/options extension page;
- browser-owned tabs, windows, and groups;
- developer and validation surfaces loaded within extension pages.

There are currently no content-script or host-permission runtime surfaces in the accepted Layer 2 baseline.

Each context may be destroyed and recreated. Context-local memory, timers, listener guards, queues, caches, and in-flight ownership are not durable.

Future concurrent architecture must explicitly distinguish:

- extension context identity;
- workspace identity;
- runtime assignment identity;
- projection identity;
- browser window binding;
- projection epoch;
- workspace revision;
- operation identity.

These identities are design requirements for the upcoming concurrency foundation. Their exact schemas are not committed by this document.

## Mutation doctrine

Meaningful mutation must be:

- explicitly authorized by product policy or Operator action;
- scoped to an identified workspace, projection, context, and operation;
- validated against current state;
- conflict-aware;
- observable;
- idempotent where replay is possible;
- rollback-aware where browser or durable state can be partially changed;
- verified after completion.

Full-object read-modify-write paths are acceptable only where single-writer behavior is proven or conflict semantics are defined. Concurrent multi-window work must not rely on unstated last-writer-wins behavior.

Append-like semantic operations, metadata edits, projection patches, snapshot replacement, resume, archive, import, and recovery are distinct operation classes. A future coordinator must preserve these meanings rather than flattening all mutations into an untyped generic write.

## Projection matching doctrine

Projection matching remains conservative:

1. prefer exact validated browser identifiers;
2. use deterministic fallback only when unique and safe;
3. preserve one-to-one record-to-tab matching;
4. refuse ambiguous matches;
5. mark projection records missing rather than deleting durable membership;
6. revalidate before browser mutation.

Future window-aware ownership must strengthen this doctrine, not weaken ambiguity blocking.

## Persistence and transaction doctrine

Principal durable changes should use the narrowest atomic IndexedDB transaction that preserves the operation contract.

Import remains create-or-identical:

- validate schema and digest;
- run a fresh dry run;
- block conflicts;
- require exact Operator confirmation;
- revalidate immediately before mutation;
- use one multi-store transaction;
- use `add`, not overwrite;
- create absent storage identities only;
- verify after write;
- roll back only artifacts created by that execution.

Existing resume, archive, migration, recovery, and rollback contracts remain protected until separately reviewed.

## Compatibility doctrine

Compatibility mechanisms are active architecture, not disposable clutter.

Retirement requires proof that:

1. every reader has migrated;
2. every writer has migrated;
3. persisted state remains protected;
4. export/import recovery exists;
5. rollback remains possible;
6. a dedicated retirement validation phase exists;
7. the Operator authorizes the change.

See `PROTECTED-IDENTITIES.md`.

## Current concurrency boundary

The accepted Layer 2 runtime is a validated single-window foundation.

It is not yet authorized as a concurrent multi-window implementation because current evidence identifies unresolved questions around:

- global active runtime state;
- global active workspace selection;
- cross-context read-modify-write;
- operation-specific lock domains;
- service-worker restart convergence;
- side-panel context ownership;
- browser projection ownership;
- automated concurrency characterization.

Layer 2.3B must characterize and document these boundaries before production concurrency semantics are changed.

## Architectural change rule

A production change that alters authority, identity, persistence, mutation ordering, rollback, browser ownership, or compatibility requires:

- an explicit architecture proposal;
- affected reader/writer inventory;
- failure-mode analysis;
- validation plan;
- rollback plan;
- Byte–Nolan approval before implementation.

A coding agent may suggest such a change but may not silently commit the doctrine through implementation.
