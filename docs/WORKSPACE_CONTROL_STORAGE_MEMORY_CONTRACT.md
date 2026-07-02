# Workspace Control Storage and Memory Contract

## Purpose

This document formalizes the storage, memory, and authority model for the Workspace Control Layer before broader live browser-control expansion.

It corresponds to:

```text
projection.workspace_control_storage_memory_contract
```

This is a documentation and architecture contract only.

No runtime code is changed by this slice.

## Why This Contract Exists

The resume/rehydrate path has shown that Chrome Flow is no longer only a tab organizer. It is becoming a governed local workspace-control system.

Before live browser projection expands, Chrome Flow must keep these concepts separate:

```text
active runtime state
saved durable state
browser projection evidence
validation evidence
future cognitive memory
future learning/fine-tuning evidence
```

The purpose of this contract is to prevent a temporary implementation detail from becoming accidental product doctrine.

## Current Source-of-Truth Layers

### Active Runtime State

```text
Storage surface: chrome.storage.local
Role: current active workspace and immediate browser-side runtime state
Authority: active runtime authority for the current side panel and current browser workspace
Lifetime: short-to-medium lived local browser extension state
```

Active runtime state may include:

```text
current workspace id
current workspace name
current workspace aim/type
current active workspace tabs
current tab roles/aliases/statuses
current journal/timeline surfaces used by the side panel
```

Active runtime state is allowed to represent what the Operator is currently working with.

It is not the durable memory authority for historical workspace/session/projection reconstruction.

### Durable Workspace Memory

```text
Storage surface: Session DB / IndexedDB
Role: durable local memory for workspace/session/projection records
Authority: durable evidence and saved-workspace authority
Lifetime: persistent local workspace memory
```

Session DB may include:

```text
workspace records
workspace tab records
session records
projection records
summary card records
journal entry records
timeline event records
workspace link records
constellation records
settings needed by the durable workspace layer
```

Session DB is the correct source for candidate selection, validation, resume planning, saved workspace inspection, historical session evidence, and future constellation linking.

### Browser Projection Evidence

```text
Storage surfaces: chrome.storage.local runtime data, Session DB projection records, diagnostics, validation packets
Role: evidence of what happened in Chrome
Authority: evidence only, not durable identity authority
Lifetime: tied to browser/runtime volatility
```

Browser projection evidence may include:

```text
runtime window ids
runtime tab ids
runtime group ids
created window ids
created tab ids
created group ids
last verification timestamps
before/after browser snapshots
```

Chrome runtime ids are volatile. They are useful as evidence, but they must not become permanent workspace identity.

## Non-Negotiable Authority Rules

```text
1. chrome.storage.local remains the active runtime state surface until an explicit migration changes that contract.
2. Session DB is durable memory, not automatic runtime authority.
3. Runtime ids are evidence, not durable authority.
4. The deterministic engine must validate against durable DB records before invoking browser APIs.
5. No command may silently promote Session DB to runtime authority.
6. No command may silently overwrite chrome.storage.local active workspace from a saved projection.
7. No command may treat a stale runtime id as proof that a browser object still exists.
8. No command may perform live browser action from a pasted packet alone.
9. Live browser actions must rebuild their own checks immediately before action.
10. AI/LLM suggestions must not bypass deterministic command gates.
```

## Memory Layer Separation

Chrome Flow should treat memory as layered, not singular.

### Layer M0: Immediate UI State

```text
Purpose: current controls, form values, selected candidate, visible panel state
Authority: UI-local only
Storage: DOM state / transient JS state
```

This layer must not be treated as durable memory.

### Layer M1: Runtime Workspace Memory

```text
Purpose: active workspace currently being operated in the browser
Authority: current runtime surface
Storage: chrome.storage.local
```

This layer supports immediate work:

```text
current tabs
roles
aliases
active workspace timeline
visible workspace state
```

It is allowed to be fast and practical.

It must remain distinct from durable memory.

### Layer M2: Durable Workspace and Session Memory

```text
Purpose: persisted workspace/session/projection structure
Authority: durable local record authority
Storage: Session DB / IndexedDB
```

This layer supports:

```text
saved workspace recovery
resume/rehydrate planning
session history
projection history
workspace summaries
candidate selection
validation suites
future constellation linking
```

This is the primary deterministic memory layer for the Workspace Control Layer.

### Layer M3: Operational Evidence Memory

```text
Purpose: validation and action evidence
Authority: audit/evidence trail
Storage: diagnostic packets, validation packets, timeline events, future verification records
```

This layer supports:

```text
preflight packets
review packets
validation suite packets
execution packets
post-action verification packets
action traces
error/warn diagnostics
```

This layer explains what happened and why Chrome Flow believed an action was safe or unsafe.

### Layer M4: Cognitive/Constellation Memory

```text
Purpose: higher-level organisation and cross-workspace intelligence
Authority: derived intelligence, not browser-action authority
Storage: future summary/link/constellation stores and curated memory records
```

This layer may support:

```text
workspace constellations
cross-workspace links
project/outcome maps
semantic relationships
stale-thread detection
pattern recognition
context-packing for LLMs
operator-facing summaries
```

This layer should be built on top of M2 and M3 evidence.

### Layer M5: Learning and Improvement Memory

```text
Purpose: curated experience for future evaluation, adaptation, training, or fine-tuning
Authority: training/evaluation source material only
Storage: future curated datasets or exportable evidence packs
```

This layer may include:

```text
successful validation traces
failed validation traces
operator approvals/rejections
repair paths
workspace organisation examples
agent mistakes and corrections
future fine-tuning/evaluation samples
```

This layer must be curated. It must not indiscriminately absorb private workspace content.

## Workspace Control Layer Scope

The Workspace Control Layer governs transitions between:

```text
current browser state
active runtime workspace state
Session DB saved workspace state
projection state
future dedicated workspace windows
future workspace constellations
```

Current and future commands include:

```text
resume / rehydrate workspace
deactivate / dehydrate active workspace
switch workspace
verify projected workspace
repair stale projection
archive workspace
restore workspace
export workspace packet
resolve missing tabs
update saved session state
link workspaces into constellations
```

Each command must declare:

```text
source state
target state
authority class
allowed reads
allowed writes
allowed browser effects
required Operator confirmation
preflight requirements
verification requirements
packet output
```

## Fixture Versus Product Policy

### Minimal Technical Fixture

The 3-tab / 3-group candidate is a minimal technical fixture.

```text
workspace: Layer 2 Rehydration Candidate Test
savedTabCount: 3
plannedGroupCreates: 3
purpose: first small safe resume/rehydrate validation target
```

This fixture is not a product limit.

It exists to prove the smallest live browser projection path before expanding general behavior.

### Product Workspace Threshold Policy

The broader product policy remains:

```text
A workspace may begin in the current window.
When a workspace crosses into a larger organisational footprint, especially 4+ tabs, Chrome Flow should recommend or require a dedicated/new window projection to preserve workspace structure.
```

The exact threshold policy should be validated as its own path.

Initial policy:

```text
0-3 tabs: current-window workspace may remain acceptable
4+ tabs: dedicated/new-window projection should be recommended or required, with Operator review
```

This is why a 4-tab fresh fixture is not invalid product behavior.

It is only blocked by the current minimal technical fixture because that fixture is intentionally narrow.

## Resume/Rehydrate Policy

Resume/rehydrate is the first full Workspace Control Layer command because it crosses:

```text
durable saved state -> live browser projection
```

Resume/rehydrate must use the full validation ladder:

```text
candidate selection
preflight
review
programmatic validation suite
Operator approval
live action only after rebuilt checks
post-action verification
execution packet
```

Before any live browser action, the run path must read:

```text
getWorkspace()
getActiveWorkspaceId()
getWorkspaceRecord(workspaceId)
getWorkspaceTabs(workspaceId)
getWorkspaceSessions(workspaceId)
getWorkspaceProjections(workspaceId)
```

Runtime selection mismatch may remain review evidence for the first new-window prototype, but it must not be silently ignored for broader switch/dehydrate commands.

## Dehydrate and Switch Policy

Dehydrate and switch are not the same command as resume.

### Dehydrate

Dehydrate should preserve or record the current runtime workspace state into durable memory without confusing browser state with permanent identity.

Future dehydrate checks should include:

```text
active runtime workspace exists
workspace tab records can be mapped
runtime ids are fresh enough to use as evidence
saved projection record can be updated safely
operator understands whether browser tabs will remain open or be affected
```

### Switch

Switch is a compound high-impact command and should be decomposed.

A safe switch path likely means:

```text
1. review current active workspace
2. optionally dehydrate/save current runtime evidence
3. review target saved workspace
4. prepare target resume plan
5. obtain Operator approval for both sides
6. perform staged action
7. verify no state was lost
```

Switch must not become a one-click opaque action.

## Constellation Policy

Workspace constellations are the higher-level project/outcome structure.

A constellation may contain:

```text
multiple related workspaces
workspace links
cross-references
shared project/outcome aim
summary cards
relationship evidence
future semantic links
future LLM-assisted pattern detection
```

Constellations should not weaken workspace authority boundaries.

A constellation can recommend relationships or surface patterns, but actions still operate through governed workspace commands.

## Deterministic Engine Role

The deterministic engine is the foundation beneath future AI behavior.

It should provide:

```text
candidate scoring
readiness checks
preflight checks
risk classification
authority classification
workspace threshold policy
URL normalization
tab/page deduplication
same-domain clustering
role/group planning
stale-tab detection
validation packet construction
post-action verification
```

The deterministic engine should produce structured evidence that the LLM can read and explain.

It should not be hidden behind opaque model reasoning.

## Future AI/LLM Role

The LLM should sit above deterministic evidence.

Allowed future LLM roles:

```text
explain validation results
summarize workspaces
suggest links between workspaces
identify stale or duplicated research paths
recommend next Operator actions
propose constellation relationships
help with context packing
translate technical evidence into user-facing language
```

Disallowed LLM roles without deterministic gates:

```text
silently execute browser actions
silently mutate Session DB
silently replace chrome.storage.local active workspace
invent workspace state not present in records
bypass Operator confirmation
promote suggestions into action authority
```

## Validation Suite Role

The programmatic validation suite is the beginning of the autonomous validation substrate.

It should evolve from manual packet inspection into:

```text
programmatic scenario runner
assertion engine
candidate matrix evaluator
boundary checker
precondition validator
post-action verifier
regression harness
```

Before a command becomes live, it should have:

```text
positive scenario
negative scenario
boundary scenario
storage authority scenario
runtime mismatch scenario
verification scenario
```

## UI Contract

Current sidepanel surfaces are scaffolding.

The final UI may look completely different.

However, the final UI must preserve these meanings:

```text
what state is being read
what action is being proposed
what will change
what will not change
which authority layer is used
which confirmation is required
what validation passed or failed
what verification proved afterward
```

Labels may change.

The authority grammar must not disappear.

## Build Ladder From This Point

Recommended order after this contract:

```text
1. Merge or stabilize candidate selector and validation suite runner.
2. Validate the storage/memory contract with the Operator.
3. Decide whether first live resume uses the minimal 3-tab fixture or a fresh exact fixture.
4. Keep the 4+ tab threshold as a product-policy path, not a blocker mistake.
5. Implement first live resume only after rebuilt checks and post-action verification are ready.
6. Build 4+ tab dedicated-window threshold validation after minimal live resume proves safe.
7. Generalize resume beyond the fixture.
8. Expand to dehydrate/switch/archive/restore controls using the same command substrate.
9. Add constellation memory and LLM-assisted reasoning only above deterministic evidence.
```

## Open Decisions

```text
Should the first live resume use the known 3-tab fixture or require a fresh exact fixture?
Should the 4+ tab threshold recommend or require a dedicated/new window at first?
When should Session DB become the primary durable storage for all workspace creation paths?
Which chrome.storage.local fields remain necessary for runtime speed and UI continuity?
What evidence should be promoted into future cognitive/constellation memory?
What privacy rules govern learning/fine-tuning export packs?
```

## Merge Gate

Do not proceed to broad live browser-control expansion until this contract is accepted or revised.

Do not merge implementation that violates:

```text
chrome.storage.local runtime authority separation
Session DB durable memory separation
runtime id evidence-only policy
Operator approval gates
validation before action
verification after action
LLM above deterministic evidence
fixture-vs-product-policy distinction
```
