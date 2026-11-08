## Why

Local semantic search currently needs a second Compose override, while all development processes share one generically named Dockerfile. The deployment split should provide one predictable local startup command and the same process-specific Dockerfile names used in production.

## What Changes

- Put pgvector PostgreSQL and its idempotent vector migration in the main local Compose stack; remove the semantic-search override.
- Give the local API, worker, collaboration server, and frontend separately named Dockerfiles. Migrations and seed reuse the API Dockerfile.
- Keep the root Compose compatibility entry, local SeaweedFS, production Compose, and optional embedding-provider behavior.
- Document backing up an existing local PostgreSQL volume before changing its image.

## Capabilities

### New Capabilities

- `local-compose-deployment`: One-command local startup, optional semantic search readiness, and process-specific development images.

### Modified Capabilities

None.

## Impact

`deployment/local/`, the root README, database reference, and executable Compose tests. No production image or API contract changes.
