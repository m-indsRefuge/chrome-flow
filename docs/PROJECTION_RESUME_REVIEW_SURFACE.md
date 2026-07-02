# Projection Resume Review Surface

## Purpose

This slice adds a review-only Operator panel before the next projection checkpoint.

Implementation file:

```text
src/sidepanel/projection-resume-review.js
```

## Surface

```text
Projection Resume Review
```

Controls:

```text
Prepare Review Packet
Copy Review Packet
```

Required token:

```text
CONFIRM RESUME REVIEW
```

## Packet

```text
projection-resume-review-packet-v0.1
```

## Expected States

```text
ready_for_next_slice
awaiting_operator_confirmation
blocked
```

## Boundary

```text
reviewOnly: true
noStateChange: true
```

The panel does not change saved state or runtime state.

## Group Rule

Saved group evidence remains mandatory for a clean projection path.
