# Layer 2.2B — Constellation Product and Code Branding Migration

## Status

In progress.

This migration changes current product presentation and new source-level identity from **Chrome Flow** to **Constellation** without renaming persisted storage, database, packet-schema, or legacy event contracts prematurely.

## Completed branding slice

The following current product surfaces now use the canonical identity:

- Chrome extension manifest name;
- Chrome extension action title;
- manifest product description;
- side-panel document title;
- side-panel primary heading and current descriptive copy;
- Workspace Tabs and System Journal visible product language;
- transactional Workspace Library resume confirmation language;
- current README identity and repository description;
- background installation log;
- canonical source identity module for new implementation work.

Canonical source module:

```text
src/core/product-identity.js
```

New code should import canonical identity from that module rather than introducing another hard-coded product-name constant.

## Compatibility identities intentionally preserved

The following remain unchanged during Layer 2.2B:

```text
chromeFlowWorkspace
chromeFlowDiagnostics
chromeFlowWorkspaceLibrarySaveCoordinator
chrome-flow-reconcile-workspace-projection
chrome-flow-workspace-library-save-completed
chromeFlowDeveloperModeEnabled
chromeFlowDeveloperMode
chrome-flow-developer-mode-changed
```

These are persisted keys, query/data compatibility contracts, or internal event/message contracts. They will be handled through explicit compatibility adapters in Layer 2.2C rather than global replacement.

IndexedDB / Session DB names and object-store identities also remain unchanged.

## Diagnostic packet boundary

The current `diagnostic-packet-v0.3` schema remains unchanged during the first product-shell slice.

Developer packet display identity will move to Constellation in a dedicated follow-up commit that:

- keeps `diagnostic-packet-v0.3` readable;
- does not rename the diagnostics storage key;
- does not invalidate historical Chrome Flow packets;
- records the former product name only as compatibility metadata where useful;
- avoids changing envelope or parser contracts reserved for Layer 2.2C.

## Required invariants

This branding migration must not:

- create or delete a workspace;
- change any workspace ID or workspace-tab ID;
- modify Workspace Library record counts;
- alter active runtime authority;
- move, close, group, or reopen browser tabs;
- clear journals, timeline events, recovery records, sessions, or projections;
- change the unpacked-extension path or extension identity.

## Validation checkpoint for the completed slice

After pulling and reloading the extension, verify:

```text
Chrome Extensions card name: Constellation
Extension action tooltip: Open Constellation
Side-panel title and heading: Constellation
Current workspace data preserved
Workspace Library count preserved
No browser tabs or groups changed
Transactional resume confirmation names Constellation
No extension errors
```

## Remaining Layer 2.2B work

```text
2.2B.2 — Developer diagnostics and packet display branding
2.2B.3 — Remaining current Operator-facing language audit
2.2B.4 — Source-level former-name classification and branding closure
```

After those pass, Layer 2.2C will introduce storage, event, database, and packet compatibility adapters.
