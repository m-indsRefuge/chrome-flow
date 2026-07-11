# Layer 2.2B.2 — Constellation Developer Diagnostics and Packet Display Branding

## Status

Implemented; awaiting focused live validation.

## Purpose

This slice gives the current Developer Diagnostics and copied diagnostic packet the canonical **Constellation** product identity without prematurely migrating persisted diagnostic storage or the legacy packet producer.

## Canonical visible result

Newly copied diagnostic packets should display:

```text
packetType: Constellation Diagnostic Packet
extension.name: Constellation
notes[0]: This packet is generated locally by Constellation.
```

The clear-diagnostics confirmation should display:

```text
Clear Constellation developer diagnostics?
```

## Compatibility boundary

The following remain unchanged in this slice:

```text
chromeFlowDiagnostics
diagnostic-packet-v0.3
legacy diagnostic producer implementation
existing diagnostic IDs
existing action names and event names
existing workspace and timeline evidence
historical Chrome Flow packets
```

The display bridge recognizes only JSON packets whose schema is:

```text
diagnostic-packet-v0.3
```

It accepts either the former or canonical packet display type and emits the canonical display type.

Non-diagnostic clipboard content is returned unchanged.

## Runtime flow

```text
legacy diagnostic producer builds diagnostic-packet-v0.3
→ clipboard identity bridge validates packet shape and schema
→ display identity changes to Constellation
→ evidence, schema, IDs, counts, diagnostics, and timelines remain unchanged
→ canonical packet is written to clipboard
```

## Authority and privacy boundary

This slice does not:

- alter the active runtime workspace;
- alter Workspace Library records;
- mutate browser tabs, windows, or groups;
- rewrite stored diagnostics;
- add page content;
- change diagnostic retention;
- change action tracing;
- change packet evidence fields.

## Relationship to Layer 2.2C

Layer 2.2C remains responsible for deeper compatibility migration, including:

- canonical diagnostic storage adapters;
- packet producer migration;
- legacy/canonical protocol readers;
- event aliases and retirement rules;
- idempotent persisted-key migration.

The Layer 2.2B.2 bridge may be retired only after the canonical producer is active and live validation proves legacy packet compatibility remains intact.

## Focused live validation

Required checks:

```text
Developer Diagnostics remains available only in internal Developer Mode.
Clear Diagnostics confirmation says Constellation.
Cancel leaves diagnostics unchanged.
Copied packet says Constellation Diagnostic Packet.
Copied packet extension.name says Constellation.
Copied packet first note says generated locally by Constellation.
Packet schema remains diagnostic-packet-v0.3.
Workspace identity and counts remain unchanged.
No browser state changes.
No extension errors.
```
