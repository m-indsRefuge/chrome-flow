# Layer 2.2B Diagnostic Producer Branding Correction

## Status

The earlier diagnostic display bridge is superseded.

## Finding

Wrapping `window.confirm` and `navigator.clipboard.writeText` did not reliably intercept the native calls used by the side-panel diagnostic producer in live Chrome validation.

## Accepted implementation

`src/sidepanel/diagnostics.js` now imports the canonical Constellation product identity and emits the canonical display name directly at the source for:

- Clear Diagnostics confirmation text.
- Diagnostic logging warning prefix.
- Diagnostic packet `packetType`.
- Diagnostic packet `extension.name`.
- Diagnostic packet generated-locally note.

The obsolete diagnostic product-identity bridge is removed from the side-panel load path and deleted.

## Compatibility preserved

The following remain unchanged in Layer 2.2B:

- `chromeFlowWorkspace` storage key.
- `chromeFlowDiagnostics` storage key.
- `diagnostic-packet-v0.3` schema.
- Existing diagnostic IDs, event IDs, stored evidence, and historical packet contents.

## Governing rule

Brand canonical output at the producer when the producer is under Constellation control. Use compatibility readers and migrations only for persisted identities and external protocol contracts that cannot be changed in place without continuity risk.
