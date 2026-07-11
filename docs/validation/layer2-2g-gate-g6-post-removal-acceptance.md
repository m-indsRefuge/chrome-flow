# Layer 2.2G Gate G6 Post-Removal Acceptance

Date: 2026-07-11

## Accepted browser state

- Surviving extension ID: `hkakifedpohjilmjiiobcmmgemgighli`
- Surviving loaded repository: `C:\Users\nolan\AIProjects\constellation`
- Former extension ID removed from Chrome: `kdaionpogabdghghejldbgdfefgdbmbi`
- Former local repository remains untouched at `C:\Users\nolan\AIProjects\chrome-flow`

## Operator evidence

The Operator confirmed removal of the former Chrome extension identity and verified that the remaining Constellation identity is `hkakifedpohjilmjiiobcmmgemgighli`.

## Post-removal compatibility evidence

- Packet status: `validated`.
- Failed checks: none.
- All 24 compatibility checks passed.
- Compatibility conflicts: none.
- Workspace count: 10.
- Workspace tab count: 20.
- Session count: 10.
- Projection count: 10.
- Journal entry count: 6.
- Timeline event count: 239.
- Summary card count: 10.
- Settings count: 1.
- Active runtime workspace preserved.
- Durable active workspace ID preserved.
- All IndexedDB store counts preserved.
- All IndexedDB store content fingerprints preserved.
- Physical IndexedDB name remained `chrome-flow-session-db`.
- Logical database identity remained `constellation-session-db`.
- Export package and digest validated.
- Import dry-run remained safe, with no writes and no deletes.
- Canonical and legacy-compatible peers remained equivalent inside the surviving primary extension identity.

## Decision

Gate G6 is accepted.

The former Chrome extension identity is retired. The surviving `hkak...` installation is the sole active Constellation browser identity.

The former local repository is still retained as an intact rollback artifact. Its archival move is a separate Gate G7 operation and must stop unless the repository is clean and its branch, HEAD, remote, and manifest can be verified before and after the move.
