# Projection Confirmation Packet Semantic Note

This note records the semantic polish applied before merging the confirmation packet slice.

Blocked confirmation packets should not estimate future window creation as though a future resume path were still viable.

Expected blocked packet semantics:

```text
previewPlan.status: blocked
confirmation.status: blocked
operatorReview.estimatedTabCount: 0
operatorReview.estimatedWindowCount: 0
confirmation.executionAvailableInThisSlice: false
```

Ready or cancelled packets may still report the estimated future window count from the ready preview plan because the saved workspace has enough tab evidence to describe a future action.

This remains a confirmation-only slice. It does not open tabs, create windows, create groups, mark projections hydrated, or change runtime authority.
