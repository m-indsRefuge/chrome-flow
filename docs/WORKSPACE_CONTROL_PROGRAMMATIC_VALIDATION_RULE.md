# Workspace Control Programmatic Validation Rule

## Purpose

This document records the validation rule adopted during the dedicated-window threshold preflight work.

## Rule

```text
All Workspace Control Layer validation gates should be programmatic by default.
```

Manual Operator validation should be reserved for:

```text
visible UI presence
copy/paste packet transport
actual live browser side effects that must be visually confirmed
exceptional fallback when programmatic validation is not yet available
```

## Reason

Manual validation became too complex and too prone to Operator mismatch once the system introduced layered policy, preflight, validation, review, execution, and post-action verification packets.

Programmatic validation reduces:

```text
manual ordering mistakes
workspace switching mistakes
stale packet mistakes
copying the wrong packet type
ambiguous validation evidence
```

## Applied Current Slice

The dedicated-window threshold preflight now includes:

```text
Dedicated Window Threshold Preflight Validation Suite
```

The suite validates preflight logic using internal fixtures:

```text
0 tabs blocks
1 tab blocks
3 tabs blocks
4 tabs with roles and URLs passes
4 tabs with missing role blocks
4 tabs with missing URL blocks
5 tabs with roles and URLs passes
boundary flags remain false
```

The active runtime workspace is still reported as diagnostic evidence, but the suite pass/fail is based on deterministic fixture scenarios.

## Future Native Refactor Direction

The current sidepanel modules are scaffolding and validation surfaces.

After behavior stabilizes, refactor toward:

```text
core policy engine
core preflight engine
core validation runner
core execution verifier
sidepanel/debug UI as a thin adapter
```

The native system should reuse the same deterministic logic behind:

```text
operator-facing UI
validation packets
live action gates
automated test harnesses
future AI/tool orchestration layer
```

## Merge Gate Addition

Do not introduce a new Workspace Control Layer action without one of:

```text
programmatic validation suite
explicit reason why programmatic validation is not yet possible
small temporary manual validation note with follow-up validation-suite task
```
