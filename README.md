# Constellation

Constellation is a local-first browser cognitive workspace for organising live research, durable workspace memory, recovery, and future deterministic, algorithmic, and AI-assisted workflows.

Former project name: **Chrome Flow**.

## Current product direction

Constellation is being built as a Chrome extension that helps the Operator:

- create and maintain browser workspaces;
- assign aliases and research roles to workspace tabs;
- organise tabs into native Chrome groups;
- preserve User Journal, System Journal, and Recovery Journal records separately;
- save exact workspace snapshots into the Workspace Library;
- resume paused or archived workspaces through checked transactional actions;
- maintain browser projection metadata automatically;
- support several simultaneous live workspaces through the forthcoming multi-workspace runtime and window-binding foundation.

The deterministic system owns workspace identity, browser projection, persistence, recovery, permissions, and recall. Future algorithms may infer relationships, and future AI integrations may explain patterns, but neither layer may silently replace deterministic authority or Operator control.

## Current development install

The GitHub repository has been renamed to:

```text
https://github.com/m-indsRefuge/constellation.git
```

During the controlled extension-identity migration, the unpacked extension still loads from the legacy local path:

```text
C:\Users\nolan\AIProjects\chrome-flow
```

Development steps:

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Enable Chrome Extensions Developer mode.
4. Click **Load unpacked**.
5. Select `C:\Users\nolan\AIProjects\chrome-flow` until the local-path migration is explicitly completed.
6. Click the **Constellation** extension action.
7. The side panel should open.

Do not rename the local folder yet. Runtime and Workspace Library continuity will first be protected by a deterministic export/import safety package and extension-identity validation.

## Build principle

Constellation Core owns workspace state.

The product must remain useful with no AI provider configured. AI providers may later assist with summaries, relationship explanations, pattern recognition, and workflow recommendations only above the deterministic and algorithmic foundations.
