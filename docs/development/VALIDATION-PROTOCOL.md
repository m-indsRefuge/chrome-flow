# Constellation Validation Protocol

## Purpose

This document defines the repository-wide validation discipline. Task prompts may add stricter phase-specific checks but may not silently weaken this protocol.

Validation is evidence. A command is not safe merely because it is familiar.

## Validation classes

### Class A — Read-only repository inspection

Normally safe when used without write flags:

```text
git status --short
git status -sb
git branch --show-current
git branch -vv
git rev-parse HEAD
git rev-parse '@{u}'
git diff
git diff --check
git diff --stat
git diff --name-status
git log
git show
rg
Get-Content
Get-ChildItem
```

Confirm command options before use. Some tools have modes that generate files or update caches.

### Class B — Pure automated validation

Pure tests and static checks must:

- avoid Chrome APIs unless fully replaced by deterministic fakes;
- avoid live `chrome.storage`;
- avoid live IndexedDB;
- avoid browser tabs, windows, groups, extension pages, and profiles;
- avoid network access;
- avoid modifying source files;
- avoid snapshots or generated artifacts unless the task explicitly authorizes and reviews them;
- leave `git status --short` unchanged except for the intended implementation diff.

Layer 2.3B establishes these canonical zero-dependency commands:

```text
npm test
npm run test:characterization
npm run check:inventory
npm run test:runtime-contract
npm run check:runtime-contract-purity
npm run check
```

`npm test` runs the characterization and runtime-contract suites. `npm run test:characterization` runs the Layer 2.3B characterization tests. `npm run test:runtime-contract` runs the dormant Layer 2.3C-A pure foundation tests. `npm run check:inventory` validates the machine-readable runtime authority inventory. `npm run check:runtime-contract-purity` applies a lightweight token-pattern guard to the contained runtime-contract modules; it is not a JavaScript parser. `npm run check` runs both static checks and all pure tests. These commands do not authorize live Chrome, migration, import, resume, archive, recovery, rollback, production-save, or browser-projection actions.

The repository requires Node 24 or newer and uses Node's built-in test runner with `--test-isolation=none`. Tests must remain free of shared mutable process state and must not import listener-heavy extension entry points. No package installation step is required because the harness has zero dependencies.

### Class C — Controlled local repository tooling

Build, lint, format, dependency, generation, coverage, or package commands require inspection before execution.

A task must identify:

- expected writes;
- cache/output directories;
- dependency effects;
- cleanup behavior;
- whether output is tracked;
- how working-tree cleanliness will be verified.

Do not run write-mode formatters across unrelated files.

### Class D — Live extension validation

Live validation can affect:

- Chrome extension runtime;
- service-worker lifecycle;
- side-panel contexts;
- tabs, groups, and windows;
- `chrome.storage.local`;
- `chrome.storage.session`;
- IndexedDB;
- browser projection;
- recovery and diagnostic evidence.

It requires an explicit Operator-approved procedure with:

- starting-state capture;
- extension ID and loaded-path confirmation;
- workspace identity;
- expected browser mutations;
- expected storage and durable mutations;
- stop conditions;
- rollback;
- final inventory and error checks.

A coding agent must not perform live extension validation unless the task explicitly authorizes it.

### Class E — Migration, import, recovery, archive, resume, rollback, and production-save validation

These are state-mutating workflows and require dedicated gates. Do not invoke them as generic tests.

Preserve:

- dry-run freshness;
- digest and schema checks;
- conflict blocking;
- exact confirmation;
- pre-mutation revalidation;
- transaction boundaries;
- created-artifact tracking;
- post-write verification;
- rollback verification;
- no unexpected browser mutation.

## Required task opening

Record:

```text
git status --short
git status -sb
git branch --show-current
git rev-parse HEAD
git rev-parse '@{u}'
```

Also record task-specific baseline commands named in the prompt.

Stop on unexpected repository identity or pre-existing changes unless the task explicitly says how to handle them.

## Required task closing

Run and report:

```text
git status --short
git diff --check
git diff --stat
git diff --name-status
```

Also:

- run every authorized relevant test;
- identify tests not run;
- state why each was skipped;
- report expected versus actual working-tree changes;
- inspect generated and untracked files;
- verify no protected identity changed unintentionally.

## Test quality rules

Tests must:

- assert behavior, not implementation trivia, unless characterizing an implementation boundary;
- distinguish current characterization from desired future behavior;
- reproduce failure paths deterministically;
- control ordering explicitly for concurrency tests;
- avoid sleep-based timing where deterministic gates can be used;
- identify the state baseline and expected final state;
- test conflict, replay, duplicate, stale, abort, and rollback behavior where relevant;
- preserve legacy-only, canonical-only, and dual-identity fixtures when compatibility is touched.

A characterization test may initially prove an unsafe interleaving. Do not “fix” the test to pass by weakening the assertion.

## Concurrency validation requirements

Before multi-window production implementation, establish deterministic tests for:

- two contexts reading one baseline and writing disjoint changes;
- journal append versus projection patch;
- simultaneous timeline appends;
- metadata edit versus reconciliation;
- save during resume;
- archive during save;
- reconciliation during resume finalization;
- duplicate operation IDs;
- replayed operation IDs;
- stale expected revision;
- stale side-panel command;
- service-worker restart between schedule and execution;
- two windows with different intended active workspaces;
- same URL in different windows;
- tab detach/attach;
- window close and recreation;
- stale tab/window/group identifiers;
- rollback after partial browser mutation.

Tests should use pure adapters until a separately approved live phase is designed.

## Validation evidence report

For each command or procedure, record:

```text
Command or procedure
Purpose
Expected side effects
Observed result
Pass, fail, skipped, or not proven
Evidence
Unexpected artifacts
```

Do not represent static inspection as runtime proof.

Do not represent a passing unit test as proof of live Chrome lifecycle behavior.

## Stop conditions

Stop validation when:

- a command writes unexpected files;
- the working tree changes outside the approved map;
- live extension state changes without authorization;
- a compatibility conflict appears;
- durable inventory differs unexpectedly;
- browser mutation exceeds the approved procedure;
- rollback cannot be proven;
- an error is suppressed or evidence becomes ambiguous.
