## ADDED Requirements

### Requirement: Current-generation initial-backfill readiness

Semantic search SHALL use only established full-text and fuzzy results until durable completion state for the current embedding generation confirms its bounded initial scan finished and all current-revision indexing work has completed. Pending current-generation catch-up state, current-revision queued, running or failed jobs, and query-provider failure SHALL also require that fallback. Completion of a different embedding generation SHALL not make the current generation healthy.

#### Scenario: Newly enabled or changed generation
- **WHEN** a generation is first registered or a stale generation restarts before its bounded initial scan completes
- **THEN** search uses only full-text and fuzzy results, including while discovered jobs are queued or running

#### Scenario: Initial scan drains
- **WHEN** the current generation finishes its bounded scan and all current-revision jobs and catch-up state drain
- **THEN** semantic ranking becomes available and stays available across a worker restart

#### Scenario: Concurrent write or failed indexing
- **WHEN** a post changes during initial scanning or indexing fails
- **THEN** pending work prevents semantic ranking until revision-safe recovery, without allowing another generation's worker to declare this one ready
