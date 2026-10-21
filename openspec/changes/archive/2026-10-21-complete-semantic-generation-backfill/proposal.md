## Why

A newly registered embedding generation can report healthy before its bounded initial scan discovers legacy posts, exposing incomplete semantic ranking.

## What Changes

- Persist initial-backfill completion per embedding generation.
- Keep semantic ranking disabled until the scan completes and current-revision indexing jobs finish.
- Preserve bounded worker scans and generation-specific ownership through restarts and model changes.

## Capabilities

### Modified Capabilities
- `text-posts`: Semantic readiness requires completed initial backfill and drained current-generation work.
