# Codex Workflow for Constellation

## Purpose

This document defines how Codex or another coding agent participates in the Byte–Nolan Constellation workflow.

Codex is an implementation and investigation agent. It is not the product authority, final architect, or release authority.

## Roles

### Nolan — Operator

Owns:

- purpose;
- consent;
- priority;
- final architectural and product authority;
- live validation decisions;
- commit, merge, and release authorization.

### Byte — synthesis and architecture layer

Owns with Nolan:

- prompt construction;
- architecture synthesis;
- compatibility protection;
- finding triage;
- evidence challenge;
- phase design;
- acceptance recommendation.

### Codex — bounded engineering agent

May own, when authorized:

- repository investigation;
- change planning;
- multi-file implementation;
- pure test construction;
- static checks;
- non-live validation;
- evidence reporting;
- correction of review findings.

Codex outputs are proposals until reviewed.

## Trust ladder

### Level 1 — Read-only auditor

May inspect and report. Passed during Layer 2.3A.

### Level 2 — Substantial non-runtime phase implementer

May implement documentation, tooling, pure tests, fixtures, CI, and narrowly necessary testability seams that preserve production behavior.

Layer 2.3B begins at this level.

### Level 3 — Bounded core architecture implementer

May implement one approved runtime identity or mutation-coordination slice after its architecture contract and tests are approved.

### Level 4 — Bounded feature-phase implementer

May carry a larger production phase, with explicit internal gates, tests, diff review, rollback, and live acceptance.

### Level 5 — Parallel implementation agent

May work through multiple isolated tasks or worktrees under one accepted architecture. This level is not currently authorized.

Trust is earned by evidence and can be reduced after scope drift, unsupported claims, unsafe changes, or poor review response.

## Standard task lifecycle

### 1. Identity gate

Verify branch, upstream, HEAD, and working tree against the task prompt.

Stop on mismatch.

### 2. Instruction acknowledgement

Read:

- root `AGENTS.md`;
- linked architecture, identity, validation, definition-of-done, and workflow contracts;
- any more-specific `AGENTS.md` in the target directory;
- the task prompt and attached evidence.

Return a concise instruction summary before changing files.

### 3. Repository investigation

Trace relevant:

- entry points;
- imports and exports;
- manifest and HTML references;
- readers and writers;
- listeners and events;
- storage keys;
- IndexedDB stores and transactions;
- browser mutation paths;
- tests and validation evidence;
- compatibility and historical roles.

Do not classify code as dead from naming or file size.

### 4. Change map gate

Before implementation, state:

```text
Objective
Files expected to be created
Files expected to be modified
Production files involved
Test and fixture files involved
Documentation involved
Protected identities touched
Behavior that must remain unchanged
Commands intended
Known uncertainty
```

For tasks that define internal gates, stop at the required gate. Otherwise continue within scope.

### 5. Implementation

Work cohesively across the authorized phase.

Codex may iterate independently between approved gates. It should not request approval for every file when the phase boundary is clear.

It must:

- preserve intent across the whole task;
- keep changes bounded;
- avoid unrelated cleanup;
- report significant newly discovered risks;
- add or strengthen evidence for every behavior change;
- prefer reversible changes;
- preserve compatibility and rollback.

### 6. Validation

Run only authorized commands.

Use pure tests for characterization and core logic where possible.

Never operate live Chrome, storage, IndexedDB, migration, resume, archive, import, recovery, rollback, or production-save paths without explicit authorization.

### 7. Self-review

Before reporting completion:

- inspect the full diff;
- search for accidental identity renames;
- search for unauthorized production behavior changes;
- verify documentation command accuracy;
- verify tests are meaningful;
- inspect untracked/generated files;
- rerun relevant checks;
- compare the final result with the task definition of done.

### 8. Evidence report

Return the report required by `DEFINITION-OF-DONE.md`.

Do not hide uncertainty, skipped validation, or deviations.

### 9. Stop

Do not commit, push, open a PR, or proceed to the next architectural phase unless explicitly authorized.

## Review feedback protocol

Byte–Nolan review classifies each significant item:

```text
Accepted
Correction required
Rejected
Needs more evidence
Deferred
Protected contract
False positive
```

For each correction, record:

```text
Review ID
Affected finding or change
Evidence
Reason
Required correction
Validation required
Durable lesson destination
```

Durable lesson destinations:

- architecture contract;
- protected-identity register;
- root or scoped `AGENTS.md`;
- automated test;
- validation protocol;
- reusable Skill;
- task-specific review record only.

Do not add every correction to `AGENTS.md`.

## Escalation rule

Stop for architecture review when:

- the task requires changing authority or persistence doctrine;
- the safest implementation requires a schema or compatibility change;
- lock ordering or mutation semantics are not defined;
- existing requirements conflict;
- live state is needed to resolve uncertainty;
- the test harness cannot characterize the behavior without production changes;
- a failure could strand data.

## Rollback ladder

Use the narrowest rollback:

1. revert the uncommitted task diff;
2. return to the pre-phase branch commit;
3. revert an accepted phase commit;
4. use validated export/import or recovery artifacts where runtime data is involved;
5. consult the retired Chrome Flow repository only as historical recovery evidence.

The retired repository is not the normal development rollback target.

## Skill extraction rule

Create a repository Skill only after a procedure has succeeded repeatedly and has stable inputs, outputs, stop conditions, and validation.

Likely future candidates include:

- repository identity gate;
- protected-identity check;
- clean-diff validation;
- live extension validation;
- evidence report generation.

A Skill does not override this workflow or the architecture contracts.
