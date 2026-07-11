# Layer 2.2G Gate G7 — Reviewed Untracked Artifacts

Date: 2026-07-11

## Context

The former repository at `C:\Users\nolan\AIProjects\chrome-flow` was confirmed to have:

- no modified tracked files;
- no staged changes;
- eight untracked local artifacts;
- historical branch `layer2-validation-surface-debug-gating`;
- historical HEAD `53e6b7ccb9e12bb379e27238e11471f914bb6447`;
- origin `https://github.com/m-indsRefuge/constellation.git`.

The canonical repository remained clean and the pre-retirement backup matched its SHA-256 sidecar.

## Reviewed artifact set

Local tooling and configuration:

- `.editorconfig`
- `.prettierignore`
- `.prettierrc`
- `.vscode/settings.json`
- `AGENTS.md`

Local consolidation artifacts:

- `Apply-V0TabNativeConsolidation.ps1`
- `docs/Apply-V0TabNativeConsolidation_README (1).txt`

Generated safety backup:

- `src/sidepanel/workspace-dedicated-window-threshold-execution.js.bak.20260706-133255`

## Decision

Do not delete, reset, clean, stash, commit, push, or selectively copy these artifacts.

Archive the former repository by moving the complete folder intact. The guarded archive script may proceed only when:

1. there are no tracked or staged changes;
2. the untracked path set matches the reviewed set exactly;
3. the Operator explicitly passes `-AllowReviewedUntrackedArtifacts`;
4. every reviewed artifact is hashed before the move;
5. every path, file size, and SHA-256 hash is identical after the move;
6. the former branch, HEAD, remote, `.git`, and `manifest.json` remain intact;
7. the canonical repository remains unchanged and clean;
8. the recovery package still matches its sidecar.

Any additional, missing, modified, staged, or tracked change blocks the operation.