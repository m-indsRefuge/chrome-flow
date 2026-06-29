# V0 Tab Native Consolidation

## Purpose

This local consolidation moves the validated tab-management behavior into `src/sidepanel/sidepanel.js` as the native owner of the tab-control and organisation layer.

## Preserved Separate Modules

These remain separate by design:

```text
diagnostics.js
workspace-session-control.js
```

Diagnostics remain a build/expansion tool. Workspace session control remains part of the future memory/session layer.

## Unloaded Helper Modules

The following validated helper modules remain in the repository temporarily as reference/fallback files, but are no longer loaded by `sidepanel.html` after this patch:

```text
search-workspace-intake.js
remove-workspace-tab-cleanup.js
recovery-group-restore.js
advanced-tab-controls.js
advanced-new-window-stability-v2.js
```

## Consolidated Native Behaviors

The native controller now owns:

```text
selected scanned-tab intake
active tab intake
search auto-intake
role assignment
workspace tab status
native Chrome grouping
group focus
per-role group removal
collapse / expand groups
arrange by role order
move workspace into new window
missing-tab reopen
URL list export
duplicate URL review
close browser tab with recovery
remove + close tab with recovery
reopen URL only
re-add to workspace
recovery role-group restoration
titled recovery groups
```

## Validation Required

After applying this patch, run the full V0 tab-management validation pass before deleting helper files.
