# Layer 2.2D — Transactional Import Implementation Checkpoint

Status: **Code complete; live controlled validation pending**

## Implemented

- dedicated Constellation Data Recovery extension options page;
- local JSON file selection with a 64 MiB limit;
- package schema and canonical SHA-256 payload verification;
- fresh dry-run import planning;
- exact Operator acknowledgement and phrase gate;
- exclusive import execution lock;
- create-or-identical execution policy;
- one multi-store IndexedDB transaction using `add`, never `put`;
- second absence check before creating storage keys;
- no deletion or overwrite execution path;
- post-import per-record and per-key verification;
- diagnostic-ring subset verification by diagnostic identity;
- compensating rollback for records and keys created by the current execution;
- rollback verification;
- structured inspection, execution, and controlled-validation packets;
- dedicated controlled harness for invalid digest, conflict, authorization, no-op, disposable create, cleanup, forced failure, rollback, browser projection preservation, and final baseline restoration.

## Recovery-page access

The page is registered through `options_ui` and opens in a full tab. It is intended to be usable before the ordinary side panel is opened under a newly loaded extension identity.

## Live acceptance requirements

The controlled validation packet must report:

- status: `validated`;
- failed checks: none;
- invalid digest rejected;
- conflict rejected before writes;
- missing authorization rejected;
- identical package verified as no-op;
- disposable create committed and verified;
- disposable create cleanup complete;
- controlled failure triggered;
- controlled failure rolled back;
- rollback fixture absent;
- baseline IndexedDB restored;
- baseline storage restored;
- browser projection preserved;
- physical IndexedDB name preserved.

## Production package boundary

The verified production backup remains unchanged at:

`C:\Users\nolan\Documents\Constellation-Migration-Backup-2026-07-10.json`

Whole-file SHA-256:

`3041A5A7C081FAD97C50BB9FD32943B01E4DA0AEFF2C7245A151B4BBB456A6CD`

Canonical payload SHA-256:

`d448573bc1c14f506c53d2ec1244a1923b95d9be8726a384bf7e6365d8edffa1`

The production package must not be executed during the controlled validation run.

## Blocked until acceptance

- local project-folder rename;
- intentional extension-ID change;
- physical IndexedDB rename;
- import conflict resolution or overwrite modes;
- retirement of legacy storage keys.
