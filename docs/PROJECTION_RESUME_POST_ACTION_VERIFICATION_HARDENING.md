# Projection Resume Post-Action Verification Hardening

## Purpose

This slice hardens post-action verification for the first live known-fixture resume path.

It corresponds to:

```text
projection.resume_post_action_verification_hardening
```

## Why This Exists

The first live known-fixture execution passed, but the execution packet revealed a verification timing gap:

```text
snapshotAfter showed two created tabs with empty url/title fields
```

The browser action itself succeeded, and the created tabs appeared visually, but the snapshot was captured before Chrome had fully populated runtime tab metadata for all created tabs.

This slice closes that verification gap.

## Updated File

```text
src/sidepanel/projection-resume-run.js
```

## Behavior Added

After creating the new window, tabs, and groups, the execution path now waits for created-tab runtime metadata before final verification.

The hardening adds:

```text
TAB_METADATA_RETRY_COUNT: 12
TAB_METADATA_RETRY_DELAY_MS: 350
waitForCreatedTabRuntimeMetadata()
readCreatedTabRuntimeMetadata()
createdTabUrlsMatchSavedUrls()
created_tabs_have_runtime_url_metadata verification check
created_tab_urls_match_saved_urls verification check
postActionReadiness packet section
```

## Packet Schema

Execution packet schema is updated to:

```text
projection-resume-execution-packet-v0.2-known-fixture-verification-hardening
```

## New Packet Section

```text
postActionReadiness
```

Expected success shape:

```text
postActionReadiness.status: ready
postActionReadiness.ready: true
postActionReadiness.expectedTabCount: 3
postActionReadiness.observedTabCount: 3
postActionReadiness.createdTabs[].runtimeUrl is not empty
postActionReadiness.createdTabs[].urlMatchesSaved: true
```

## New Verification Checks

```text
created_tabs_have_runtime_url_metadata
created_tab_urls_match_saved_urls
```

These supplement the existing checks:

```text
created_window_exists
created_window_not_present_before
created_tab_count_matches_saved
created_tabs_exist_after
created_tabs_in_created_window
created_group_count_matches_plan
created_groups_only_contain_created_tabs
before_windows_preserved
before_tabs_preserved
chrome_storage_runtime_workspace_unchanged
session_db_active_workspace_unchanged
```

## Boundary Preserved

This slice does not change command authority.

Still preserved:

```text
source.runtimeActionExecuted: true only during live action
source.browserProjectionChanged: true only after browser projection is created
source.sessionDbChanged: false
source.chromeStorageRuntimeChanged: false
existingTabsOrWindowsClosed: false
unrelatedTabsMoved: false
```

## Expected Validation Result

Run the same known-fixture live resume path.

Expected packet result:

```text
packetType: Chrome Flow Projection Resume Execution Packet
extension.schema: projection-resume-execution-packet-v0.2-known-fixture-verification-hardening
execution.status: completed_verified
verification.status: verified
verification.failedChecks: []
postActionReadiness.status: ready
postActionReadiness.ready: true
browserResult.createdTabIds.length: 3
browserResult.createdGroupIds.length: 3
created_tabs_have_runtime_url_metadata: pass
created_tab_urls_match_saved_urls: pass
source.sessionDbChanged: false
source.chromeStorageRuntimeChanged: false
```

## Merge Gate

Do not merge if:

```text
postActionReadiness is omitted
created tab runtime URLs remain empty after retry
created_tab_urls_match_saved_urls fails for the known fixture
verification.status is not verified
execution writes Session DB records
execution replaces chrome.storage.local active workspace
execution closes existing tabs/windows
execution moves unrelated tabs
```
