## Context

The registry already provides durable generation identity and bounded registration leases, while the worker scans posts in bounded batches. The cursor is process-local, so a durable completion flag must be independent of the cursor.

## Decision

Add a default-false completion column and scan epoch to the generation registry. Clear completion and increment the epoch on stale registration; workers reset their local cursors when the epoch changes. A worker marks only its configured generation and current epoch complete after its bounded scan reaches the end. Health requires this flag and no pending catch-up or current-revision jobs. A restarted worker may scan again; completion remains false until the initial scan reaches the end and all discovered work drains.

The bounded scan orders by `(updated_at, id)` and carries the timestamp at PostgreSQL precision between batches. JavaScript `Date` millisecond conversion must not move a cursor backward across equal microsecond timestamps.

## Scope

Do not introduce a whole-post health scan, a new service, or cross-generation completion authority.

## HTTP contract verification

The semantic HTTP fixture must exercise the same readiness lifecycle as a deployment: assert lexical/fuzzy fallback before a generation's initial scan, run the generation-owned worker and bounded backfill until current work drains, and only then assert semantic-only ranking, pagination, and visibility. Tests that create later jobs must settle those jobs before asserting semantic ranking again.
