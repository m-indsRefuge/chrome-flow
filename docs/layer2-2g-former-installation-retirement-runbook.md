# Layer 2.2G — Former Installation Retirement Runbook

Date: 2026-07-11

## Purpose

Retire the former unpacked Chrome extension identity and former local repository only after proving that the accepted Constellation identity operates independently.

This phase is deliberately reversible until its final acceptance checkpoint.

## Accepted identities

Primary installation:

- repository: `C:\Users\nolan\AIProjects\constellation`
- extension ID: `hkakifedpohjilmjiiobcmmgemgighli`

Former rollback installation:

- repository: `C:\Users\nolan\AIProjects\chrome-flow`
- extension ID: `kdaionpogabdghghejldbgdfefgdbmbi`

## Safety invariants

1. Never identify the extensions by card position; use the exact extension ID.
2. Do not delete either local repository during this phase.
3. Do not remove the former extension before a disable-only observation gate passes.
4. Keep a destination-native pre-retirement migration package with a matching SHA-256 sidecar.
5. The primary extension must remain loaded from the canonical `constellation` path.
6. The former repository must be archived by moving it intact, including `.git`, not by copying selected files.
7. Stop on any extension error, workspace-count change, missing journal data, unexpected browser mutation, or compatibility conflict.

## Gate G1 — Re-establish primary readiness

- Pull the accepted branch in the canonical repository.
- Confirm the working tree is clean.
- Confirm the primary extension ID and loaded path.
- Run Layer 2.2C compatibility validation.
- Require `validated`, no failed checks, 10 workspaces, 239 timeline events, and zero conflicts.

## Gate G2 — Create the pre-retirement recovery anchor

From the primary extension, copy a fresh migration data package after the final live-write proof.

Use `scripts/Save-ConstellationClipboardBackup.ps1` to save:

- `C:\Users\nolan\Documents\Constellation-PreRetirement-Backup-2026-07-11.json`
- `C:\Users\nolan\Documents\Constellation-PreRetirement-Backup-2026-07-11.json.sha256`

Required package identity:

- source extension: `hkakifedpohjilmjiiobcmmgemgighli`
- physical database: `chrome-flow-session-db`
- logical database: `constellation-session-db`
- workspaces: 10
- journal entries: 6
- timeline events: 239
- package validation: true
- whole-file sidecar verification: true

## Gate G3 — Capture the former installation baseline

Before changing Chrome:

- confirm two Constellation extension cards are present;
- confirm the primary card is enabled and loaded from `constellation`;
- confirm the former card is enabled and loaded from `chrome-flow`;
- record both exact IDs;
- confirm both cards report no extension errors.

No browser or repository mutation occurs in this gate.

## Gate G4 — Disable-only observation

Disable only the former extension ID `kdaionpogabdghghejldbgdfefgdbmbi`.

Do not remove it.

Then verify the primary extension:

- remains enabled;
- opens its side panel;
- retains the active workspace identity and metadata;
- retains 4 active workspace tab records;
- retains 2 active User Journal entries;
- retains 10 Workspace Library records;
- reports no extension error;
- performs no unintended browser tab or group mutation.

Run Layer 2.2C compatibility validation and copy a diagnostic packet after the former identity is disabled.

## Gate G5 — Independence acceptance

The disable-only evidence must prove:

- primary extension operational;
- former extension disabled;
- canonical and legacy storage peers equivalent inside the primary identity;
- all durable counts preserved;
- physical database name preserved;
- no compatibility conflicts;
- no dependency on the former extension identity;
- no browser mutation caused by retirement.

The former extension must remain installed but disabled until this gate is explicitly accepted.

## Gate G6 — Remove the former Chrome extension

After explicit Gate G5 acceptance:

- remove only `kdaionpogabdghghejldbgdfefgdbmbi` from Chrome;
- confirm exactly one Constellation card remains;
- confirm its ID is `hkakifedpohjilmjiiobcmmgemgighli`;
- confirm its loaded path is `C:\Users\nolan\AIProjects\constellation`;
- reopen and validate the primary side panel once more.

Do not touch either local folder during this gate.

## Gate G7 — Archive the former repository intact

After Chrome removal is accepted:

1. Record former repository branch, HEAD, remote, and working-tree status.
2. Require a clean working tree or stop for review.
3. Create `C:\Users\nolan\AIProjects\_retired` if absent.
4. Move the complete folder:

   `C:\Users\nolan\AIProjects\chrome-flow`

   to:

   `C:\Users\nolan\AIProjects\_retired\chrome-flow-retired-2026-07-11`

5. Confirm `.git`, `manifest.json`, and the recorded HEAD remain present at the archived path.
6. Confirm the canonical repository and primary extension are unaffected.

The former repository is archived, not deleted.

## Gate G8 — Final retirement acceptance

Final evidence must record:

- one active Constellation extension identity;
- primary ID and canonical loaded path;
- former extension removed from Chrome;
- former repository archived intact;
- destination-native backup and sidecar paths and hashes;
- primary compatibility validation status;
- durable store counts;
- no extension errors;
- no unintended browser mutation;
- rollback materials retained.

Only after Gate G8 may Layer 2.2G be declared complete.
