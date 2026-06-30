# Chrome Flow V0 Tab Management Policy

## 1. Purpose

This document defines the policy boundary for the Chrome Flow V0 Tab Management and Organisation Layer.

Where `TAB_MANAGEMENT_COMMAND_CONTRACT.md` defines the command surface, this policy defines what the future AI layer may suggest, what it may prepare, what it may never do silently, and what must remain under explicit Operator control.

This policy exists to prevent the future AI layer from turning deterministic browser controls into ambiguous autonomous browser control.

## 2. Current Policy Decision

```text
AI runtime: deferred
AI command execution: deferred
AI natural-language tab control: deferred
AI planning over tab commands: deferred
AI-readiness documentation: active
```

The tab-management layer is currently deterministic and Operator-driven. The future AI layer may be designed against this policy later, but no AI execution is enabled by this policy.

## 3. Core Policy Statement

The AI must not control the browser directly.

The AI may eventually help the Operator understand, plan, and choose tab-management actions, but all meaningful browser or workspace changes must pass through approved deterministic commands and appropriate confirmation gates.

## 4. Operator Authority

The Operator is the final authority over:

```text
- adding tabs to a workspace;
- closing browser tabs;
- removing workspace records;
- grouping or ungrouping tabs;
- moving tabs between windows;
- restoring tabs from recovery history;
- clearing workspace records;
- changing workspace type or organisational meaning.
```

The AI may not override, simulate, or infer Operator approval.

## 5. Policy Goals

The tab-management policy has six goals:

```text
1. Protect user control over browser state.
2. Preserve separation between workspace records and live browser state.
3. Prevent silent destructive actions.
4. Require evidence for every meaningful action.
5. Keep recovery available where practical.
6. Create a safe future boundary for AI suggestions and tool calls.
```

## 6. Scope

This policy applies to the tab-management behavior owned by:

```text
src/sidepanel/sidepanel.js
```

It covers:

```text
workspace tab records
live browser tabs
Chrome tab groups
Chrome windows used by workspace tabs
workspace role assignments
tab aliases
recovery timeline actions
missing-tab recovery
duplicate URL review
advanced tab controls
```

It does not cover the future memory/session layer except where tab-management actions produce timeline or workspace state that memory/session may later read.

## 7. Out-of-Scope Systems

The following are intentionally outside this policy:

```text
diagnostics runtime internals
workspace session control implementation
AI provider integration
LLM prompt design
natural-language command parser
full tool registry runtime
memory/session layer policy
archive/session restore policy
```

Diagnostics and workspace session control remain separate layers.

## 8. Authority Classes

Every future AI-facing tab action must be assigned one of these authority classes.

### 8.1 Read-Only

Read-only actions inspect state only.

Examples:

```text
inspect workspace tabs
inspect tab status
inspect duplicate URLs
inspect recovery history
```

AI permission:

```text
Allowed to suggest and summarize.
Allowed to run only after a future read-only tool registry exists.
No destructive effect permitted.
```

### 8.2 Soft Workspace Write

Soft writes modify Chrome Flow workspace records but do not directly close or move live browser tabs.

Examples:

```text
assign tab role
update tab alias
save workspace details
add selected scanned tabs
add active tab
clear scanned tabs
```

AI permission:

```text
May suggest.
May prepare a command packet.
Must wait for Operator confirmation when changing organisational meaning.
Must not silently change roles or aliases.
```

### 8.3 Browser Organisation

Browser organisation actions change live Chrome grouping, focus, ordering, or window placement without intentionally closing tabs.

Examples:

```text
create Chrome groups
remove Chrome groups
collapse groups
expand groups
arrange tabs by role
move workspace into new window
focus tab
focus group
```

AI permission:

```text
May suggest.
May explain expected effects.
Must request approval before broad layout changes.
May not silently move tabs, ungroup tabs, regroup tabs, or create new windows.
```

### 8.4 Recovery

Recovery actions restore URLs, workspace records, or grouping from timeline snapshots.

Examples:

```text
reopen URL
re-add to workspace
restore role group
reopen missing tabs
recreate Chrome groups
```

AI permission:

```text
May identify available recovery options.
May recommend the safest recovery path.
Must not silently reopen or restore tabs.
Must present what will be restored before execution.
```

### 8.5 Destructive

Destructive actions close tabs, remove workspace records, or clear collections of records.

Examples:

```text
close browser tab
remove + close tab
clear workspace tabs
```

AI permission:

```text
May warn, explain, and propose.
Must never execute silently.
Requires explicit Operator confirmation.
Should include recovery availability before execution.
```

## 9. Permission Model

### 9.1 No AI Action Without Command Boundary

The AI must never act directly on browser state. It may only request a command that exists in the deterministic command contract.

### 9.2 No Silent Destructive Operations

The AI must never silently:

```text
close a browser tab
remove a workspace tab record
clear workspace tabs
move a workspace into a new window
remove Chrome groups
reopen tabs from history
re-add tabs to workspace
```

### 9.3 Approval Must Be Specific

Approval must be tied to a specific command and target.

Unacceptable approval:

```text
"Clean up my tabs."
```

Acceptable approval:

```text
"Remove and close the Wikipedia tab from this workspace."
"Move these 5 workspace tabs into a new Chrome window."
"Re-add the IBM AI Safety tab from recovery and restore its role group."
```

### 9.4 AI Must Not Bundle Destructive Actions Without Disclosure

If a command includes multiple effects, all effects must be disclosed.

Example:

```text
Remove + Close Tab
```

Must be presented as:

```text
This will remove the Chrome Flow workspace record and close the live browser tab. A recovery snapshot will be kept.
```

## 10. Confirmation Requirements

### 10.1 No Confirmation Required

The following may be low-risk when invoked by the Operator directly:

```text
scan current window tabs
select/deselect scanned tabs
refresh tab status
inspect duplicate URLs
focus tab
focus group
copy workspace URL list
```

For future AI execution, even low-risk actions should still be visible in the command trace.

### 10.2 Confirmation Recommended

The following should request confirmation when AI-suggested:

```text
add selected tabs
add active tab
open search tab and auto-add
assign multiple tab roles
create Chrome groups
remove Chrome groups
collapse/expand all groups
arrange tabs by role
reopen missing tabs
recreate groups from recovery
```

### 10.3 Confirmation Required

The following always require explicit confirmation:

```text
move workspace into new window
close browser tab
remove + close tab
clear workspace tabs
re-add to workspace from recovery
reopen URL from recovery when AI-suggested
```

## 11. State Separation Policy

The AI must always distinguish between:

```text
Chrome Flow workspace record
live Chrome browser tab
native Chrome tab group
Chrome window
recovery timeline snapshot
```

Policy examples:

```text
Reopen URL opens a browser tab only.
Re-add to Workspace restores workspace membership and grouping where appropriate.
Remove + Close Tab removes the workspace record and closes the live browser tab.
Clear Workspace Tabs clears records only and must keep browser tabs open.
Remove Chrome Group ungroups browser tabs but keeps browser tabs and workspace records.
```

The AI must not collapse these meanings into generic phrases like "remove tab" without explaining which state is affected.

## 12. Duplicate URL Policy

Duplicate URL handling must remain instance-aware.

The system must distinguish:

```text
exact same live tab already in workspace
same URL open in a separate live tab
same domain but different URL/thread/session
same service with distinct conversation URLs, such as separate ChatGPT threads
```

Future AI must not assume that two tabs are duplicates merely because their titles or domains look similar.

Future UI wording should clarify:

```text
Exact tab already in workspace
Same URL already exists in workspace
Separate live instance available to add
```

## 13. Recovery Policy

Recovery actions must preserve user understanding of what is being restored.

### 13.1 Reopen URL

Policy:

```text
Only opens the saved URL.
Does not re-add the tab to workspace.
Does not restore grouping.
```

### 13.2 Re-add to Workspace

Policy:

```text
Restores the workspace record from snapshot.
Reuses an already reopened tab where safely resolvable.
May reopen the URL if needed.
Restores the tab into the matching role group when possible.
Applies a group title when creating a recovery group.
```

### 13.3 Missing Tab Recovery

Policy:

```text
Only safely missing tabs may be reopened.
Ambiguous URL matches must be skipped.
Grouping is not implied; grouping can be recreated after reopening.
```

### 13.4 Recovery Evidence

Recovery commands must preserve:

```text
recoverySourceEventId
workspaceTabId
saved URL
role
workspace type
previous groupId when available
restoreMode
created/reused/reopened tab evidence
```

## 14. Trace and Evidence Policy

All meaningful actions must produce timeline events.

Timeline events should answer:

```text
What happened?
Which workspace record was affected?
Which browser tab was affected?
Which group/window was affected?
Was the command successful, skipped, failed, or cancelled?
Is recovery available?
What matching/resolution mode was used?
```

Trace wording should be clear enough for a non-technical Operator to understand.

Deferred cleanup:

```text
Some recovery traces currently say a tab was already in workspace/open even when the record is being restored. This is behaviorally acceptable but should be polished in a later trace-language cleanup pass.
```

## 15. Diagnostics Policy

Diagnostics are build and expansion tooling, not the source of product authority.

Policy:

```text
Diagnostics may observe commands.
Diagnostics may report warnings.
Diagnostics may lag behind event naming during development.
Diagnostics must not decide whether a browser action is allowed.
```

Deferred cleanup:

```text
Focus Tab and Focus Group emit valid workspace events, but diagnostics may still expect older terminal event names in some traces. This is not a tab-layer blocker.
```

## 16. UI Policy Notes

The current V0 UI is validated functionally, not visually final.

Deferred UI polish items:

```text
clean tab-card badge / record layout
separate record id, open/missing state, group state, role state, and match status visually
possibly hide exact match status behind debug/details mode
improve duplicate URL state wording
improve destructive action labels and descriptions where needed
```

UI polish must not change command semantics without updating this policy and the command contract.

## 17. AI Suggestion Policy

A future AI may suggest actions in this form:

```text
I found 4 open workspace tabs that are role-assigned but ungrouped.
Suggested action: Create Chrome Tab Groups.
Expected effect: create 3 native Chrome groups and keep all tabs open.
Risk: browser tab layout will change.
Requires approval: yes.
```

The AI must include:

```text
suggested command
reason
expected effect
risk
confirmation requirement
recovery implication if relevant
```

The AI should not present suggestions as commands already executed.

## 18. AI Prohibited Behaviors

The future AI must never:

```text
silently close tabs
silently clear workspace records
silently move tabs to a new window
silently group or ungroup tabs
silently reopen recovery items
silently re-add recovery items to workspace
silently classify roles without user review
ignore ambiguous tab resolution
act on tabs outside the current workspace without explicit scope
infer that similar-looking tabs are duplicates without evidence
hide failed or skipped actions
```

## 19. AI Allowed Behaviors Before Runtime Tool Execution

Before the AI runtime exists, the AI may still help by:

```text
explaining tab state
summarizing workspace organisation
identifying missing or ungrouped tabs
suggesting the next deterministic UI action
explaining command consequences
preparing validation checklists
reviewing workspace/diagnostic packets
helping draft command contracts and policy docs
```

## 20. Future Tool Registry Preconditions

Before any AI is allowed to call tab-management tools directly, the following must exist:

```text
formal tool registry
schema validation
permission gate
operator confirmation UI
command preview packet
command result packet
failure/timeout handling
recovery visibility
diagnostic trace integration
policy classification per command
memory/session context boundary
```

## 21. Relationship to Memory/Session Layer

The memory/session layer should be built before runtime AI tab control.

Reason:

```text
The AI needs stable context about sessions, workspaces, archives, and state continuity before it can safely reason over tab actions.
```

The tab-management policy should be referenced by the future memory/session policy, but memory/session should define its own command contract after that layer stabilizes.

## 22. Policy Acceptance Criteria

This policy is accepted when:

```text
- AI runtime remains deferred;
- current deterministic behavior remains unchanged;
- command authority classes are clear;
- destructive operations require confirmation;
- workspace state and browser state are clearly separated;
- duplicate URL handling remains instance-aware;
- recovery semantics are explicit;
- deferred UI, trace, and diagnostics items are recorded as non-blocking;
- future AI boundaries are explicit enough to prevent silent browser control.
```

## 23. Current Decision

```text
Decision: Do not build AI tab-control runtime now.
Decision: Preserve the tab-management contract and policy now.
Decision: Proceed next into memory/session discovery and design.
Decision: Return to AI tool registry only after deterministic layers are stable.
```
