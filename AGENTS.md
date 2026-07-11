# Constellation Agent Instructions

## Purpose

This file is the repository-level operating contract for coding agents working on Constellation.

Constellation is a local-first browser cognitive workspace implemented as a Chrome extension. Its deterministic core owns workspace identity, active runtime state, durable memory, browser projection, recovery, permissions, and recall. Algorithms may infer and future AI providers may interpret, but neither may silently replace deterministic authority or Operator control.

Read these linked contracts before modifying the repository:

- `docs/architecture/CONSTELLATION-AUTHORITY-CONTRACT.md`
- `docs/architecture/PROTECTED-IDENTITIES.md`
- `docs/development/VALIDATION-PROTOCOL.md`
- `docs/development/DEFINITION-OF-DONE.md`
- `docs/development/CODEX-WORKFLOW.md`

When a task prompt conflicts with these repository contracts, stop and report the conflict. Do not silently choose the more permissive interpretation.

## Authority

- Nolan is the Operator and final authority for product intent, consent, release, and meaningful mutation.
- Byte and Nolan own architecture, phase boundaries, compatibility doctrine, acceptance criteria, and final review.
- A coding agent may investigate, plan, implement, and validate only inside the explicitly authorized task boundary.
- Repository evidence outranks assumptions.
- Inference must be labelled as inference.
- Recommendations are advisory until accepted.

Do not redesign product doctrine, retire compatibility mechanisms, or broaden scope merely because a different design appears cleaner.

## Core state doctrine

Treat these boundaries as architectural invariants:

```text
Browser tabs, windows, and groups are live projections.
They are not durable authority.

chrome.storage.local is active runtime state.

IndexedDB / Session DB is durable workspace memory.

The Operator authorizes meaningful mutations.
```

The current runtime may contain transitional or legacy-compatible identities. Their presence is not evidence of dead code or stale branding.

## Current phase

The active phase is:

```text
Layer 2.3B — Concurrency Characterization and Engineering Foundation
```

The objective is to establish the documentation, tooling, pure tests, writer inventories, and controlled evidence needed before concurrent multi-window runtime implementation.

Unless a later task explicitly authorizes production runtime changes, do not:

- implement multi-window product behavior;
- change active workspace semantics;
- change persistence semantics;
- change resume, archive, recovery, import, migration, or rollback behavior;
- introduce new production mutation paths;
- rename protected identities;
- delete historical or validation artifacts.

Characterization tests may demonstrate current hazards. A failing characterization test is evidence, not permission to redesign production behavior.

## Required starting gate

Before work, report:

```text
git status --short
git status -sb
git branch --show-current
git rev-parse HEAD
git rev-parse '@{u}'
```

Stop if:

- the working tree is not in the expected state;
- the branch differs from the task prompt;
- HEAD or upstream identity differs from the task prompt;
- the task would require changing a protected contract without explicit authorization.

Do not switch branches, reset, rebase, merge, pull, push, force-push, or rewrite history unless the task explicitly authorizes that exact operation.

## Modification rules

Before editing:

1. Inspect the relevant entry points, imports, readers, writers, listeners, storage keys, event names, tests, and documentation.
2. State the intended change map.
3. Identify production files, test files, documentation files, and generated files separately.
4. Identify protected contracts touched directly or indirectly.
5. Prefer the smallest coherent change that satisfies the approved objective.

During implementation:

- preserve observable behavior unless behavior change is explicitly authorized;
- avoid broad formatting or unrelated cleanup;
- avoid opportunistic renames;
- avoid dependency additions unless justified and authorized;
- keep deterministic logic explicit and testable;
- preserve rollback and evidence paths;
- use semantic operation boundaries rather than generic object replacement where architecture requires meaning;
- keep browser-derived identifiers subject to revalidation;
- do not treat module count or file size alone as defects.

A suspicious file is not dead until static imports, dynamic imports, manifest references, HTML references, event registration, runtime messaging, documentation, validation, migration, recovery, and compatibility roles have been traced.

## Protected contracts

The authoritative register is `docs/architecture/PROTECTED-IDENTITIES.md`.

At minimum, preserve:

- physical IndexedDB name `chrome-flow-session-db`;
- logical canonical identity `constellation-session-db`;
- current durable store names;
- legacy and canonical storage identities;
- legacy and canonical event identities;
- published versioned packet schemas and envelopes;
- migration markers;
- import, export, recovery, and rollback evidence;
- historical validation documents.

Do not globally rename `chromeFlow*` identities. Do not rename a published schema in place. Do not change the physical database name as housekeeping.

## Safety and privacy

Constellation handles sensitive local browsing context, including URLs, titles, aliases, notes, journal entries, timelines, diagnostic evidence, and exported packets.

Do not:

- add network access, telemetry, external services, host permissions, content scripts, or secret handling without explicit authorization;
- send repository, browser, workspace, or user data to external services;
- load or operate the live extension unless explicitly authorized;
- mutate live Chrome storage, IndexedDB, tabs, groups, or windows unless explicitly authorized;
- run import, migration, resume, archive, recovery, rollback, production-save, or projection actions against live data unless explicitly authorized.

Trace untrusted input to a sensitive sink before reporting a security vulnerability. A risky API name alone is not proof of exploitability.

## Validation

Follow `docs/development/VALIDATION-PROTOCOL.md`.

Use only commands whose effects are understood. When uncertain whether a command writes files, caches, snapshots, browser state, storage, or generated output, do not run it. Report the limitation.

Every task must end with:

```text
git status --short
git diff --check
git diff --stat
git diff --name-status
```

Run the task-specific automated checks named in the prompt. Do not invent a passing result. Do not conceal skipped checks.

Live extension validation remains Operator-controlled unless a prompt explicitly authorizes it.

## Definition of done

Follow `docs/development/DEFINITION-OF-DONE.md`.

Completion requires more than code generation. The final report must identify:

- files created, modified, deleted, or intentionally untouched;
- production behavior changed or preserved;
- commands run;
- tests and outcomes;
- skipped validation and why;
- protected identities checked;
- architectural choices and alternatives;
- known risks and unproven assumptions;
- rollback path;
- any deviation from the authorized scope.

Do not commit, push, open a pull request, or merge unless the task explicitly authorizes those actions.

## Stop conditions

Stop and request Byte–Nolan review when:

- the approved architecture is ambiguous;
- two protected contracts appear to conflict;
- a safe solution requires a production behavior change outside scope;
- a migration or persisted identity appears removable but reader/writer coverage is incomplete;
- a test requires live browser or durable-state mutation not authorized by the prompt;
- the repository state changes unexpectedly;
- the task would benefit from broad cleanup rather than the bounded objective;
- a failure could strand data or weaken rollback without an approved recovery plan.

Do not hide uncertainty by making a plausible architectural decision on behalf of the Operator.
