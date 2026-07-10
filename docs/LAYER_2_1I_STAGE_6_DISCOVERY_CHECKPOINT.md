# Layer 2.1I Stage 6 Discovery Checkpoint

## Status

Accepted as a partial functional pass and an architectural discovery checkpoint on 2026-07-10.

Stage 6 is intentionally held until Layer 2.1J establishes coherent multi-workspace runtime and window binding.

## Scope exercised

- Workspace Library automatic refresh observability
- Saved-workspace preview
- Resume-gate presentation
- Operator cancellation boundary
- Transactional resume of a different saved workspace
- Behaviour when the selected workspace is already live
- Coexistence of more than one live browser workspace projection

## Operator-confirmed results

- Saved-workspace preview rendered the selected workspace structure correctly.
- Preview opened, closed, moved, or regrouped no browser tabs.
- Resume readiness displayed `ready_for_precheck` with six passing checks and zero failed checks.
- Cancellation preserved browser state and runtime state.
- Transactional resume of another paused workspace reopened its browser projection successfully.
- Attempting to resume the already-open validation workspace produced no duplicate browser projection.
- More than one workspace could remain open in Chrome at the same time.

## Architectural gap discovered

The browser can contain multiple live workspace projections, but the current runtime layer still exposes one global active-workspace object in `chrome.storage.local`.

Consequences:

- a side panel may display metadata for the global active runtime rather than the workspace represented in its host window;
- a resumed workspace may be live in a second window without owning an independent runtime slot;
- `active`, `focused`, `bound`, and `viewed` workspace meanings are currently conflated;
- the existing already-active resume guard prevents duplicates correctly, but the product should offer `Focus Existing Workspace` rather than appearing to do nothing;
- Stage 6 cannot validate cross-window coherence until runtime identity becomes workspace-scoped and window-aware.

## Refresh observability finding

The first Stage 6 packet still showed a synthetic `ui_click` for the hidden Workspace Library refresh control even though automatic refresh diagnostics reported `operatorClickRecorded: false`.

Commit `98f1889` replaces the bubbling synthetic click with a non-bubbling internal refresh event. This correction requires a narrow live closure check before Stage 6 is resumed.

## Accepted verdict

- Preview: pass
- Resume gate: pass
- Cancellation boundary: pass
- Resume of a different saved workspace: functional pass
- Already-live duplicate prevention: functional pass, product response incomplete
- Multi-workspace runtime coherence: architectural gap
- Stage 6 completion: held

## Required next phase

Proceed to Layer 2.1J — Multi-Workspace Runtime and Window Binding Foundation.

After Layer 2.1J validation, resume Stage 6 and validate:

- preview against multiple live workspaces;
- focus-existing behaviour;
- resume of a non-live workspace;
- host-window side-panel coherence;
- cross-workspace navigator read-only peeking;
- automatic Workspace Library updates without synthetic Operator clicks.
