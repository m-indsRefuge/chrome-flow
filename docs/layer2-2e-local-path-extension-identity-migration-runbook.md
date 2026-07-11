# Layer 2.2E Local Path and Extension Identity Migration Runbook

## Purpose

Move the canonical local repository path from `chrome-flow` to `constellation` without removing the working extension or risking its current storage origin.

This is a migration rehearsal under a verified production backup. It is not an in-place folder rename.

## Safety invariants

1. The existing `chrome-flow` repository remains untouched.
2. The existing unpacked extension remains installed and enabled.
3. The canonical destination is created as a clean Git clone at the final intended path.
4. The source and destination must use the same branch and commit.
5. The verified migration package is inspected before any import.
6. The second extension must have a distinct extension ID and loaded path.
7. Import is blocked if the destination is not isolated or the fresh plan contains any conflict.
8. Existing destination records and keys are never overwritten or deleted.
9. The original extension remains available until the migrated identity is fully verified.

## Current accepted anchors

- Current extension ID: `kdaionpogabdghghejldbgdfefgdbmbi`
- Current repository path: `C:\Users\nolan\AIProjects\chrome-flow`
- Canonical destination path: `C:\Users\nolan\AIProjects\constellation`
- Backup path: `C:\Users\nolan\Documents\Constellation-Migration-Backup-2026-07-10.json`
- Backup sidecar: `C:\Users\nolan\Documents\Constellation-Migration-Backup-2026-07-10.json.sha256`
- Accepted whole-file SHA-256: `3041A5A7C081FAD97C50BB9FD32943B01E4DA0AEFF2C7245A151B4BBB456A6CD`
- Accepted payload SHA-256: `d448573bc1c14f506c53d2ec1244a1923b95d9be8726a384bf7e6365d8edffa1`

## Gate A — current identity and package inspection

1. Pull the latest `layer2-validation-surface-debug-gating` branch.
2. Open the current Constellation extension options page.
3. Select the saved production migration package.
4. Click **Inspect Selected Package**.
5. Confirm package schema and digest validation pass.
6. Do not execute import in the current populated identity.
7. Record the current extension ID and Chrome loaded path.

Conflicts in the current populated identity are not a package-integrity failure. Current diagnostics and other runtime state may have advanced since the package was created.

## Gate B — deterministic canonical-path preparation

Run `scripts/Prepare-ConstellationPathMigration.ps1` from the current repository and provide the current extension ID and loaded path.

The script:

- rejects tracked working-tree changes;
- requires local HEAD to equal the remote branch head;
- verifies the backup whole-file SHA-256 sidecar;
- validates the package schema, source extension ID, and package validation flag;
- refuses to overwrite an existing destination path;
- clones the exact branch into `C:\Users\nolan\AIProjects\constellation`;
- verifies source and destination commits match;
- writes a local preflight evidence record;
- does not load Chrome or execute an import.

## Gate C — isolated second extension identity

1. Keep the original extension installed and enabled.
2. In `chrome://extensions`, click **Load unpacked**.
3. Select `C:\Users\nolan\AIProjects\constellation`.
4. Verify Chrome now shows two Constellation extension cards.
5. Record each card's extension ID and loaded path.
6. The new card must use the canonical `constellation` path.
7. The two IDs must be different.

Stop immediately when:

- only one extension card remains;
- Chrome changes the existing card's loaded path;
- both cards report the same ID;
- the original extension becomes disabled or unavailable;
- any extension error appears before package inspection.

Do not open the ordinary side panel in the second identity before recovery inspection.

## Gate D — package inspection in the second identity

1. Open **Details** on the second Constellation card.
2. Open **Extension options**.
3. Confirm the destination extension ID differs from the package source extension ID.
4. Select the verified migration package.
5. Click **Inspect Selected Package**.
6. Copy the **Inspection Packet**.
7. Stop and review the packet before import execution.

The expected plan in a clean isolated identity is:

- package valid;
- internal digest valid;
- status `safe_dry_run`;
- zero conflicts;
- zero deletes planned;
- destination extension ID distinct from the source ID;
- incoming durable records and storage keys classified as creates;
- execution eligible.

## Gate E — import execution

Import execution is allowed only after the Gate D inspection packet is reviewed and accepted.

Execution requires:

- Operator acknowledgement;
- exact authorization phrase `IMPORT CONSTELLATION DATA`;
- a fresh zero-conflict plan immediately before mutation;
- add-only IndexedDB creation;
- missing-key-only storage creation;
- mandatory post-import verification.

## Gate F — post-import continuity proof

After a verified import:

1. Open the second identity's side panel.
2. Confirm 10 Workspace Library records.
3. Confirm all durable store counts and record fingerprints against the source package.
4. Confirm active runtime workspace identity and metadata.
5. Confirm journals, timelines, sessions, projections, summary cards, and settings.
6. Run Layer 2.2C compatibility validation in the migrated identity.
7. Copy the import execution packet and post-import validation packet.
8. Keep the original extension installed until all evidence is accepted.

## Rollback posture

The original extension and `chrome-flow` repository are the primary rollback anchors. The migration package and SHA-256 sidecar are the independent data-recovery anchors. The second identity may be removed only after capturing its execution evidence if migration fails or is abandoned.
