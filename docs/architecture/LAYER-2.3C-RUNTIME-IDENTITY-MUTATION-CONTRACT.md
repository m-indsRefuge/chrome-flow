# Layer 2.3C Runtime Identity and Mutation Contract

## Purpose and boundary

Layer 2.3C-A adds a dormant, deterministic, JSON-serializable foundation. It performs no persistence, browser operation, listener registration, timer scheduling, or production wiring. `workspaceId` remains durable identity; tab, window, and group identifiers remain ephemeral projection evidence; `contextId` identifies one execution-context lifetime; and `runtimeAssignmentId` identifies one session binding between a workspace and a live window.

## Approved identities and locks

The schemas are `constellation-runtime-context-v0.1`, `constellation-runtime-assignment-registry-v0.1`, `constellation-runtime-operation-ledger-v0.1`, `constellation-runtime-dirty-registry-v0.1`, `constellation-runtime-mutation-v0.1`, and `constellation-runtime-mutation-result-v0.1`. Lock names are `constellation-runtime-exclusive-operation-v0.1` and `constellation-runtime-state-v0.1`, acquired in that order. This slice only publishes constants; it does not acquire locks.

## Assignment invariants

At most one active assignment exists per workspace and per window. Initial binding, transfer, and post-release rebinding consume a monotonically increasing registry epoch. Transfers and releases require the current assignment identity and epoch. A transitional envelope may omit assignment identity only while its workspace has no active assignment; once assigned, both the current assignment ID and epoch are mandatory. Assignment operations validate workspace, window, source context, timestamps, generated identity uniqueness, and expected epochs before producing a record. Transfer completes every validation before releasing the current assignment; failure preserves the active assignment and `nextEpoch` exactly. Timestamps are evidence, not ordering authority.

## Revision and mutation contract

A missing `workspaceRevision` normalizes to 0. Valid revisions are non-negative integers. A committed named mutation increments exactly once; no-change, conflict, replay, rejection, and failure do not increment. Envelopes identify operation, writer context, optional assignment, workspace, expected revision, named mutation, payload, request time, and authorization mode. Results preserve status, identity, revision, writer, timestamp, and reason evidence where meaningful. Malformed-envelope rejection results normalize non-string or empty operation, workspace, assignment, and context identities to `""`, keeping the complete result JSON-serializable.

Reducers explicitly dispatch `journal.append`, `timeline.append`, `workspace.metadata.patch`, `workspace.tab.add`, `workspace.tab.remove`, `workspace.tab.metadata.patch`, and `workspace.tab.projection.patch`; unknown types are rejected. Tab-add identity comes exclusively from `payload.tab.workspaceTabId`, and a redundant top-level identity is rejected. Observed workspace metadata allowlist: `name`, `aim`, `workspaceType`. Observed tab metadata allowlist: `alias`, `role`. Observed projection allowlist: `tabId`, `tabKey`, `windowId`, `groupId`, `url`, `displayUrl`, `originalTitle`, `isOpen`, `firstSeenAt`, `lastSeenAt`, `lastMatchStatus`, `pinned`, `index`. `candidateCount` is excluded because it is temporary patch evidence rather than a persisted projection field. Unknown existing fields are preserved; intake-specific fields are not patch-authorized.

## Replay and dirty reconciliation

The canonical fingerprint includes semantic request fields and excludes `requestedAt`. Payload and authorization, including nested values, must be plain JSON-serializable data before fingerprinting. Its local FNV-1a hash plus serialized length is replay identity evidence, not a security signature. A matching operation replays its original evidence; a mismatching reuse conflicts without overwriting the original bounded ledger entry. Pending reconciliation is keyed by workspace and assignment, validates assignment/epoch coherence, trigger, time, and failure evidence, coalesces triggers, rejects epoch disagreement, remains pending after failure, and clears one target only after success.

## Compatibility and future wiring

`activeWorkspaceId`, legacy/canonical storage peers, durable database identities, events, packets, migration, recovery, archive, resume, and rollback remain untouched. Semantic mutation here means a named domain state transition; it does not mean semantic memory, embeddings, inference, or AI.

Future production wiring is separately gated: first wire `journal.append` behind existing authorization and persistence contracts; then validate durable transaction, replay, restart, and live lifecycle behavior; only afterward consider additional mutations, assignment-backed window selection, reconciliation scheduling, and exclusive operations. The purity checker normalizes literal static, export-from, and dynamic import paths and permits only sibling `.js` paths that remain inside the family; it also covers selected direct and computed browser/network globals and obvious top-level global assignment, console, listener, timer, and await actions. It remains parser-light and is not complete static analysis. This pure slice does not prove Chrome lifecycle, cross-context locking, storage atomicity, service-worker restart convergence, migration behavior, or live multi-window behavior.
