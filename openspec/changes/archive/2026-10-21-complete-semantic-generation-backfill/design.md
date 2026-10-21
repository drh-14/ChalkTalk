## Context

The registry already provides durable generation identity and bounded registration leases, while the worker scans posts in bounded batches. The cursor is process-local, so a durable completion flag must be independent of the cursor.

## Decision

Add a default-false completion column and scan epoch to the generation registry. Clear completion and increment the epoch on stale registration; workers reset their local cursors when the epoch changes. A worker marks only its configured generation and current epoch complete after its bounded scan reaches the end. Health requires this flag and no pending catch-up or current-revision jobs. A restarted worker may scan again; completion remains false until the initial scan reaches the end and all discovered work drains.

## Scope

Do not introduce a whole-post health scan, a new service, or cross-generation completion authority.
