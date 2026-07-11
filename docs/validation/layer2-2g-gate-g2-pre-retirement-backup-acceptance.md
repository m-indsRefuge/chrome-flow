# Layer 2.2G Gate G2 — Pre-Retirement Backup Acceptance

Date: 2026-07-11

## Accepted primary identity

- Canonical repository: `C:\Users\nolan\AIProjects\constellation`
- Primary extension ID: `hkakifedpohjilmjiiobcmmgemgighli`
- Physical IndexedDB name: `chrome-flow-session-db`
- Logical database identity: `constellation-session-db`

## Backup evidence

- Status: `saved_and_verified`
- Backup path: `C:\Users\nolan\Documents\Constellation-PreRetirement-Backup-2026-07-11.json`
- Sidecar path: `C:\Users\nolan\Documents\Constellation-PreRetirement-Backup-2026-07-11.json.sha256`
- Whole-file SHA-256: `18657052768951AF23C2F7FE851B142590CB29E6C99E41D7E2A00511C77CDBBA`
- Sidecar verification: passed
- Package schema: `constellation-data-migration-package-v0.1`
- Source extension ID: `hkakifedpohjilmjiiobcmmgemgighli`
- Internal payload digest: `4592a77aa5f70806fa289d60f15ec90e2de4d88b8790018b51da910a8aeeed4f`
- Digest evidence mode: `validated_package_payload_digest`
- Package validation: true
- Workspace count: 10
- Journal-entry count: 6
- Timeline-event count: 239

## Decision

Gate G2 is accepted.

The destination-native pre-retirement recovery anchor exists, has been read back, and matches its SHA-256 sidecar. Retirement may proceed to the two-extension baseline and disable-only independence test. No former extension or repository retirement action has yet occurred.
