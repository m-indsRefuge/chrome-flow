# Constellation Agent Instructions

## 1. Purpose

This file is the repository-level operating contract for coding agents working on Constellation.

Constellation is a local-first browser cognitive workspace implemented as a Chrome extension. Its deterministic core owns workspace identity, active runtime state, durable memory, browser projection, recovery, permissions, and recall.

Algorithms may infer and future AI providers may interpret, but neither may silently replace deterministic authority or Operator control.

Before modifying the repository, read the relevant authoritative contracts:

- `docs/architecture/CONSTELLATION-AUTHORITY-CONTRACT.md`
- `docs/architecture/PROTECTED-IDENTITIES.md`
- `docs/development/VALIDATION-PROTOCOL.md`
- `docs/development/DEFINITION-OF-DONE.md`
- `docs/development/CODEX-WORKFLOW.md`

When a current task appears to conflict with an authoritative repository contract, stop and report the exact conflict. Do not silently choose the more permissive interpretation.

---

## 2. Authority and task boundary

The global Nolan–Byte authority model applies.

For Constellation specifically:

- Nolan is the Operator and final authority for product intent, consent, release, and meaningful mutation.
- Byte and Nolan own architecture, compatibility doctrine, phase boundaries, acceptance criteria, and final review.
- A coding agent may investigate, plan, implement, and validate only inside the explicitly authorized task boundary.
- Repository evidence outranks assumptions.
- Inference must be labelled as inference.
- Recommendations remain advisory until accepted.

Do not redesign product doctrine, retire compatibility mechanisms, broaden scope, or alter persistence semantics merely because a different design appears cleaner.

### Current task and phase

The current task prompt or approved Byte–Nolan implementation contract defines:

- the active layer, phase, slice, or workstream;
- the expected branch, worktree, and `HEAD`;
- allowed and prohibited scope;
- required invariants;
- required implementation;
- required tests and evidence;
- live-validation boundaries;
- stop conditions;
- completion criteria.

Do not infer the active phase from historical documentation, previous sessions, branch names, or this file.

When the current task conflicts with an authoritative repository contract, stop and report the conflict rather than silently overriding either source.

---

## 3. Core state doctrine

Treat the following as architectural invariants:

```text
Browser tabs, windows, and groups are live projections.
They are not durable authority.

chrome.storage.local is active runtime state.

IndexedDB / Session DB is durable workspace memory.

The Operator authorizes meaningful mutations.
```

The runtime may contain transitional, compatibility, historical, or legacy identities. Their presence is not evidence of dead code, stale branding, or safe removal.

Do not move authority from the deterministic substrate into UI state, browser objects, algorithms, model output, or inferred context without explicit architectural authorization.

---

## 4. Required repository gate

Before work, establish and report:

```text
git rev-parse --show-toplevel
git status --short
git status -sb
git branch --show-current
git rev-parse HEAD
```

Report the upstream with:

```text
git rev-parse '@{u}'
```

when an upstream exists. If no upstream exists, report that fact rather than treating it automatically as failure unless the current task requires an upstream.

Also identify:

- the active worktree, if worktrees are in use;
- applicable repository instructions;
- relevant package and runtime versions;
- required validation commands;
- pre-existing staged, unstaged, and untracked changes.

Stop when:

- the repository or worktree is not the expected target;
- the branch differs from the current task;
- `HEAD` differs from the current task expectation;
- an upstream mismatch matters to the task;
- pre-existing changes cannot be safely separated;
- the task would require changing a protected contract without explicit authority.

Do not switch branches, reset, rebase, merge, pull, push, force-push, rewrite history, stash, clean, or replace the working tree unless the task explicitly authorizes the exact operation.

Treat all pre-existing changes as Operator-owned work.

---

## 5. Investigation and modification rules

Before editing:

1. Inspect the relevant entry points, imports, readers, writers, listeners, storage keys, event names, tests, documentation, manifests, and runtime messages.
2. State the intended change map.
3. Identify production, test, documentation, generated, migration, and validation files separately.
4. Identify protected contracts touched directly or indirectly.
5. Trace authority ownership and side effects.
6. Prefer the smallest coherent change that satisfies the approved objective.

During implementation:

- preserve observable behavior unless behavior change is explicitly authorized;
- avoid broad formatting, cleanup, or opportunistic renames;
- avoid dependency additions unless justified and authorized;
- keep deterministic logic explicit and testable;
- separate pure decision logic from side effects where practical;
- preserve rollback, recovery, and evidence paths;
- use semantic operation boundaries rather than generic object replacement where architecture requires meaning;
- keep browser-derived identifiers subject to revalidation;
- preserve ordering, exclusivity, idempotency, and retry safety;
- do not treat module count or file size alone as defects.

A suspicious file or identity is not dead until its static imports, dynamic imports, manifest references, HTML references, event registration, runtime messaging, persistence roles, migration paths, validation surfaces, recovery paths, and compatibility obligations have been traced.

When additional defects are found, fix them only if they block the authorized objective and remain inside scope. Otherwise report them separately.

---

## 6. Protected contracts and identities

The authoritative register is:

- `docs/architecture/PROTECTED-IDENTITIES.md`

At minimum, preserve unless the current task explicitly authorizes a compatible migration:

- physical IndexedDB name `chrome-flow-session-db`;
- logical canonical identity `constellation-session-db`;
- current durable store names;
- legacy and canonical storage identities;
- legacy and canonical event identities;
- published versioned packet schemas and envelopes;
- migration markers;
- import, export, recovery, and rollback evidence;
- historical validation documents.

Do not globally rename `chromeFlow*` identities.

Do not rename a published schema in place.

Do not change the physical database name as housekeeping.

Do not delete compatibility readers, migration paths, rollback paths, or historical validation artifacts until reader/writer coverage and migration obligations are proven complete and removal is explicitly authorized.

---

## 7. Browser, persistence, privacy, and live-data safety

Constellation handles sensitive local browsing context, including URLs, titles, aliases, notes, journal entries, timelines, diagnostic evidence, and exported packets.

Do not, without explicit authorization:

- add network access, telemetry, analytics, external services, host permissions, content scripts, or secret handling;
- send repository, browser, workspace, or user data to external services;
- load or operate the live extension;
- mutate live Chrome storage, IndexedDB, tabs, groups, or windows;
- execute import, migration, resume, archive, recovery, rollback, production-save, or projection actions against live data;
- use real user data as a test fixture;
- bypass extension permissions or browser safety controls.

Use disposable fixtures, synthetic data, mocks, and isolated test surfaces for automated validation.

Trace untrusted input to a sensitive sink before reporting a security vulnerability. A risky API name alone is not proof of exploitability.

Live extension validation remains Operator-controlled unless the current task explicitly authorizes it.

---

## 8. Validation

Follow:

- `docs/development/VALIDATION-PROTOCOL.md`
- `docs/development/DEFINITION-OF-DONE.md`

Use only commands whose side effects are understood.

When uncertain whether a command writes files, caches, snapshots, browser state, durable storage, generated output, or lockfiles, stop and report the limitation before running it.

Run the task-specific checks named in the current contract.

Add or update tests when behavior changes.

Validation should cover the meaningful contract, including relevant:

- success;
- invalid or malformed input;
- denied preconditions;
- stale authority or revision;
- retries;
- duplicate requests;
- replay and idempotency;
- ordering and exclusivity;
- partial failure;
- interruption and cleanup;
- recovery;
- compatibility;
- browser-derived identifier revalidation.

Every task must end with:

```text
git status --short
git diff --check
git diff --stat
git diff --name-status
```

Also report the final branch and `HEAD`.

Do not invent a passing result, conceal skipped checks, or label an unrun validation as passed.

Separate focused tests, full-suite tests, build checks, static checks, CI, manual validation, and live extension validation.

---

## 9. Completion standard

Completion requires more than code generation.

The final report must identify:

- outcome;
- starting repository, branch, `HEAD`, upstream status, and dirty state;
- files created, modified, deleted, and intentionally untouched;
- production behavior changed or preserved;
- architecture and protected identities checked;
- exact commands run and results;
- tests, counts, warnings, and failures;
- skipped validation and why;
- final diff and Git state;
- important implementation decisions and rejected alternatives;
- known risks and unproven assumptions;
- rollback or recovery path;
- any deviation from authorized scope;
- ordered Operator validation steps when live validation is required.

Do not commit, push, open a pull request, merge, release, or clean up unless the current task explicitly authorizes the exact action.

---

## 10. Constellation-specific stop conditions

Stop and request Byte–Nolan review when:

- the approved architecture or task boundary is ambiguous;
- two authoritative contracts appear to conflict;
- a safe solution requires production behavior outside scope;
- a migration or persisted identity appears removable but reader/writer coverage is incomplete;
- a compatibility mechanism appears obsolete but its persistence, recovery, or rollback role is not proven;
- a test requires unauthorized live-browser or durable-state mutation;
- repository state changes unexpectedly;
- a failure could strand data, duplicate authority, or weaken rollback without an approved recovery plan;
- the task would benefit primarily from broad cleanup rather than the bounded objective;
- required evidence cannot be produced honestly.

Do not hide uncertainty by making a plausible architectural decision on behalf of the Operator.

A stop report must state:

- what was inspected;
- what was discovered;
- the exact contract, identity, or state boundary involved;
- why proceeding would be unsafe or invalid;
- the smallest decision or authority needed;
- any safe partial work completed.
