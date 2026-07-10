# Layer 2.1I Stage 5 Live Validation

## Status

Accepted on 2026-07-10.

## Scope

This checkpoint validates User Journal persistence, separation from System and Recovery journals, recovery-card behaviour, reopen-without-membership, re-add with role restoration, recovered Chrome-group restoration, automatic durable persistence, and state-based journal action observability.

## Operator-confirmed results

- User Journal note created: pass
- Note persisted after side-panel reopen: pass
- Note persisted after extension reload: pass
- Human note remained separate from System Journal: pass
- Human note remained separate from Recovery Journal: pass
- Remove and Close created a recovery card: pass
- Reopen URL opened the page without restoring workspace membership: pass
- Workspace remained at four records after Reopen URL: pass
- Re-add restored the workspace record without creating a duplicate browser tab: pass
- Original assigned role was restored: pass
- Recovered role group was created: pass
- Final group removal preserved the recovered tab: pass
- Workspace Library reported five tabs and the journal count automatically: pass
- Final workspace state remained five total and five open: pass
- Extension errors: none

## Final diagnostic closure

The final diagnostic packet reported:

- workspaceId: `13cf2c93-9b7c-4612-b21f-9bd6afa2e0c2`
- workspace type: `research`
- total tabs: `5`
- open tabs: `5`
- missing tabs: `0`
- grouped tabs: `0`
- ungrouped tabs: `5`
- unassigned tabs: `0`
- journal entries: `3`
- timeline events: `68`
- pending action traces: none

The final User Journal action produced exactly one `ui_click`, one `action_started`, and one correlated `action_success`.

The state-based success evidence reported:

- journalCountBefore: `2`
- journalCountAfter: `3`
- verificationMode: `journal_count_increased`
- systemTimelineEventRequired: `false`
- humanNoteContentIncludedInDiagnostic: `false`

The System Journal count remained unchanged at `68`, confirming that human journal notes remain isolated from operational history.

The exact Workspace Library snapshot replacement wrote three journal entries while preserving five workspace tabs, one managed session, one managed projection, and 68 timeline events.

## Acceptance rule

Layer 2.1I Stage 5 is complete. Continue to the next Layer 2.1I validation stage without repeating the accepted journal or recovery tests unless a later change touches those paths.
