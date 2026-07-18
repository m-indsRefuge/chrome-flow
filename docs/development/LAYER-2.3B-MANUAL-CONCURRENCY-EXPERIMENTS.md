# Layer 2.3B Operator-Controlled Concurrency Experiments

> **Draft evidence design:** These are evidence-design specifications, not execution-ready live runbooks. Each experiment requires a separately reviewed Operator procedure before execution.

## Authority and common safety rules

These experiments are specifications only. Codex did not execute them. Nolan must explicitly authorize a live phase before use.

For every experiment, first capture the extension ID and loaded path, export a validated recovery package, record the active workspace ID, inventory open tabs/windows/groups, record storage/DB fingerprints through approved diagnostic surfaces, and stop if the backup cannot be independently verified. Never use irreplaceable browsing state. Do not import, delete, clear storage, or repair unexpected state during evidence capture.

Common evidence: timestamps, workspace ID, relevant window/tab/group IDs, diagnostic packet, before/after workspace fingerprints, Session DB counts, screenshots, service-worker console errors, and exact Operator actions.

Common cleanup: stop all actions, export evidence, close only disposable fixtures, restore through the separately approved recovery procedure if and only if its preconditions still pass. An unexpected identity, conflict, missing recovery anchor, unplanned browser mutation, or inability to fingerprint state is a stop condition.

## E1 — Service-worker suspension between schedule and reconciliation

- Purpose: determine whether a scheduled projection update converges after worker suspension.
- Known: timer, trigger set, and queue are module-local. Pure tests show simulated replacement loses them.
- Unproven: Chrome suspension timing and whether another startup/event repairs state.
- Preconditions: disposable workspace/tab; verified backup; service-worker inspection procedure approved.
- Steps: capture baseline; cause one controlled tab metadata event; observe scheduling evidence; use the approved Chrome developer action to terminate the worker before debounce completion; wait without further browser mutations; inspect runtime projection; restart the worker through the approved method; inspect convergence.
- Expected observations: either the update is absent until a later trigger, or startup/restart causes convergence.
- Stop/forbidden: do not edit storage, invoke reconciliation manually, or cause unrelated tab events during the observation interval.
- Pass: durable/restart behavior is reproducible and documented. Fail: projection remains stale after the defined convergence trigger. Inconclusive: suspension or event timing cannot be proven.

## E2 — Two side panels editing one active workspace

- Purpose: observe shared runtime writes from two panel documents.
- Known: panels have independent DOM/module state and one shared active workspace.
- Unproven: actual interleaving and storage-change refresh behavior.
- Preconditions: two supported panel contexts/windows; disposable workspace; backup.
- Steps: open both panels; record displayed workspace fingerprint; pause interaction in A; edit metadata or append a disposable journal note in B; without refreshing A, perform a disjoint action in A; capture final runtime and UI state.
- Expected: both changes survive, one is lost, or A is refreshed/rejected before acting.
- Forbidden: archive, resume, delete, or close real tabs.
- Cleanup: remove only disposable notes through an approved procedure or restore fixture.
- Pass/fail/inconclusive: pass if behavior and ordering are deterministic; fail if silent loss occurs; inconclusive if panels cannot coexist or auto-refresh prevents a controlled stale state.

## E3 — Two windows intended for different active workspaces

- Purpose: demonstrate the difference between browser windows and durable active-workspace assignment.
- Known: `activeWorkspaceId` is one global key.
- Unproven: exact current UI behavior when different panels select/resume workspaces.
- Preconditions: two disposable saved workspaces and windows; no irreplaceable tabs.
- Steps: bind intent only through current supported controls, selecting workspace A from window 1 and B from window 2; inspect both panels and the global setting after each action.
- Expected: one global selection wins or both panels converge to one workspace.
- Forbidden: infer a future assignment schema or directly edit settings.
- Cleanup: return to the recorded original active workspace using normal approved selection.
- Criteria: fail for independent-assignment readiness if both intents cannot be represented; inconclusive if current UI does not permit the setup.

## E4 — Same URL in different windows

- Purpose: verify conservative ambiguity handling across windows.
- Known: exact tab ID wins; unique URL fallback is accepted; ambiguous URL fallback is rejected.
- Unproven: live event ordering and displayed evidence.
- Preconditions: two disposable tabs with identical safe URL in distinct windows; workspace record whose old tab ID is invalid.
- Steps: capture IDs; make the saved/runtime record require fallback through an approved fixture procedure; trigger reconciliation through normal browser activity; inspect match status.
- Expected: `ambiguous_url_matches`, no arbitrary attachment.
- Forbidden: direct storage edits unless separately authorized as fixture preparation; no sensitive URLs.
- Cleanup: close disposable tabs only after evidence.
- Criteria: pass if unresolved; fail if attached arbitrarily; inconclusive if exact ID remained valid.

## E5 — Tab detach/attach across windows

- Purpose: verify projection tracking and identifier revalidation during cross-window movement.
- Known: service worker listens for detach/attach; reconciler records window changes.
- Unproven: ordering, duplicate events, transient missing status.
- Preconditions: disposable workspace tab and destination window.
- Steps: capture record; move tab once through Chrome UI; capture detach/attach/reconcile evidence and final record.
- Expected: one live membership record converges to the destination window without duplication/deletion.
- Forbidden: group unrelated tabs or close source window during the observation.
- Cleanup: move fixture back only if approved and capture the reverse transition.
- Criteria: pass on correct convergence; fail on duplicate membership/arbitrary URL match; inconclusive if evidence ordering is incomplete.

## E6 — Stale side-panel action

- Purpose: determine whether a panel can act from an older workspace view.
- Known: no general context ID/expected revision command contract is observed.
- Unproven: storage listeners may refresh or disable the stale UI first.
- Preconditions: two panels and disposable metadata/journal action.
- Steps: capture A’s displayed state; change workspace state in B; prevent manual refresh in A; immediately perform a disjoint action in A; inspect final state and diagnostics.
- Expected: refresh/rejection or a stale whole-object write.
- Forbidden: destructive tab/archive/resume controls.
- Cleanup: restore disposable fixture from recorded baseline.
- Criteria: pass for current safety if A refreshes/rejects; fail if newer unrelated state is silently lost; inconclusive if timing cannot be controlled.

## E7 — Save overlapping resume or reconciliation

- Purpose: observe whether operation-specific locks permit an inconsistent snapshot.
- Known: save and resume use distinct locks; reconciliation has no observed Web Lock.
- Unproven: actual overlap window and resource conflict.
- Preconditions: entirely disposable saved workspace, verified export, expected browser mutation inventory, explicit authorization for resume.
- Steps: instrument only through approved diagnostic timestamps; begin resume; trigger save at a defined resume checkpoint from another panel, or trigger a benign reconciliation event; capture runtime, durable snapshot, and browser projection.
- Expected: serialized behavior, explicit rejection, or evidence of an intermediate snapshot.
- Stop: any unexpected real tab/window mutation or failed rollback precondition.
- Forbidden: use on primary workspace; do not force storage values.
- Cleanup: execute the approved rollback/fixture disposal procedure.
- Criteria: pass if consistent and reproducible; fail if durable snapshot captures partial resume; inconclusive if overlap cannot be established.

## E8 — Archive overlapping another mutation class

- Purpose: characterize archive interaction with save or metadata mutation.
- Known: no common archive lock was observed.
- Unproven: live overlap and archive controller ordering.
- Preconditions: disposable workspace/window and verified recovery anchor; explicit archive authorization.
- Steps: begin the approved archive action while another panel performs a non-destructive save or metadata update at a defined checkpoint; capture archive, browser-close, runtime, and durable evidence.
- Expected: serialization/rejection or an observable conflict without stranded state.
- Stop: ownership verification failure, unexpected tab target, or rollback uncertainty.
- Forbidden: primary workspace or irreplaceable tabs.
- Cleanup: use only approved restore/recovery workflow.
- Criteria: fail if state is stranded or wrong tabs close; pass if consistent; inconclusive if overlap is not proven.

## E9 — Projection convergence after extension reload

- Purpose: verify restart convergence from persisted runtime and live browser state.
- Known: startup schedules reconciliation; process-local pending work does not persist.
- Unproven: full convergence after reload with pending/stale projection data.
- Preconditions: disposable workspace with one controlled stale projection condition and backup.
- Steps: capture baseline and stale condition; reload extension using approved Chrome procedure; do not perform unrelated tab actions; capture worker startup, panel state, diagnostics, and final projection.
- Expected: idempotent convergence without changing durable membership.
- Forbidden: remove/reinstall extension, clear data, or import recovery package during observation.
- Cleanup: restore fixture only through approved path.
- Criteria: pass if projection converges; fail if it remains stale after the defined startup interval/trigger; inconclusive if reload itself creates unrelated events.
