# Constellation Definition of Done

## Purpose

This is the repository-wide minimum acceptance contract. A phase or task may add stricter criteria.

Generated code is not complete merely because it compiles, renders, or passes one happy-path test.

## Scope completion

A task is complete only when:

- the approved objective is satisfied;
- all requested deliverables exist;
- no unauthorized work was added;
- unrelated cleanup was avoided;
- changed behavior matches the approved architecture;
- deferred work is stated rather than silently omitted.

## Repository integrity

Required:

- expected branch and upstream confirmed;
- no branch switching or history rewriting outside authorization;
- no unreviewed generated debris;
- `git diff --check` passes;
- every changed path is accounted for;
- no file is deleted or renamed without reference tracing and authorization;
- no dependency is added or updated without justification and authorization.

## Architectural integrity

Required:

- deterministic authority remains explicit;
- Operator authority remains intact;
- browser projection is not promoted to durable authority;
- active runtime and durable memory boundaries remain coherent;
- browser-derived identifiers are revalidated where used;
- mutation semantics are explicit;
- concurrency behavior is characterized or tested where relevant;
- rollback and recovery remain possible;
- compatibility contracts are preserved.

A task is not done if its success depends on an undocumented single-context, single-window, timing, or last-writer-wins assumption.

## Protected identities

Required:

- `PROTECTED-IDENTITIES.md` reviewed;
- touched identities listed in the final report;
- no physical database rename;
- no in-place published-schema rename;
- no global legacy-name cleanup;
- no compatibility bridge retirement without the retirement evidence gate;
- old-only, canonical-only, and dual compatibility behavior tested when affected.

## Testing and validation

Required:

- relevant authorized tests pass;
- characterization tests remain faithful to current behavior;
- regression tests cover the repaired failure path;
- skipped tests are listed with reasons;
- tests do not mutate live Chrome or durable state unless explicitly authorized;
- test execution leaves the repository in the expected state;
- live validation requirements are identified separately;
- static evidence is not overstated as runtime proof.

Where production behavior changes, include negative, conflict, stale, duplicate, replay, and rollback cases appropriate to the operation.

## Safety and privacy

Required:

- no unauthorized network or telemetry surface;
- no new permissions, host access, content scripts, secrets, or external services without approval;
- sensitive URLs, titles, aliases, notes, journals, timelines, and diagnostics are not exposed unexpectedly;
- untrusted input is validated or safely rendered before sensitive sinks;
- exported/copied data implications are reported.

## Documentation

Required:

- public or developer documentation matches actual behavior;
- commands shown in documentation exist and were verified;
- architecture documents are updated when authority or lifecycle changes;
- protected identity documentation is updated only through approved contract changes;
- stale instructions introduced by the task are removed or corrected;
- limitations remain visible.

## Evidence and review

The final report must include:

1. objective;
2. starting repository identity;
3. change summary;
4. files created;
5. files modified;
6. files deleted;
7. production behavior changed;
8. production behavior deliberately preserved;
9. protected identities checked;
10. commands run;
11. tests and results;
12. validations skipped;
13. unexpected findings;
14. architectural decisions;
15. risks and unproven assumptions;
16. rollback path;
17. final Git status and diff summary;
18. deviations from the prompt;
19. advisory next step.

Clearly separate observed fact, inference, and recommendation.

## Authorization boundary

Unless the task explicitly authorizes them, completion does not include:

- commit;
- push;
- pull request creation;
- merge;
- release;
- live extension operation;
- compatibility retirement;
- migration;
- import;
- archive;
- resume;
- recovery;
- rollback execution.

Stop after producing the authorized working-tree result and evidence report.

## Acceptance

Only Nolan, advised by Byte and the validation evidence, accepts a task into Constellation.

A coding agent may report `complete`, but that means the agent believes the bounded deliverables are ready for review. It does not mean the architecture, commit, PR, merge, or release is accepted.
