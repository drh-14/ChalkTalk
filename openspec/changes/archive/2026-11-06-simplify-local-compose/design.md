## Context

See proposal.md. Ordinary PostgreSQL migrations deliberately do not depend on pgvector, while the existing optional semantic SQL is idempotent and can run after them.

## Goals / Non-Goals

**Goals:** Keep one local Compose entry; provision vector schema locally without making an embedding provider mandatory; name local Dockerfiles by process.

**Non-Goals:** Change production Supabase provisioning, embedding APIs, database schema shape, or existing data.

## Decisions

- Use the existing `pgvector/pgvector:pg17` image from the prior optional override as the default local PostgreSQL image. This avoids a second Compose file and retains PostgreSQL major version 17.
- Run the existing semantic migration after ordinary migrations in the one-shot migrate service. Its idempotence permits normal restarts. Search still falls back to lexical/fuzzy without an embedding key.
- Use `Dockerfile.api`, `Dockerfile.worker`, `Dockerfile.collaboration`, and `Dockerfile.frontend` under `deployment/local/`; migration and seed reuse the API build. Keep the development source mounts and node_modules-volume entrypoint.

## Risks / Trade-offs

- A developer with a populated local `postgres:17-alpine` volume is changing image variants. Document backup before the switch; do not delete or automatically migrate data volumes.
- Four development Dockerfiles duplicate a short dependency-install recipe, but match the requested explicit service names and require no new image-build orchestration.

## Migration Plan

Back up an existing local PostgreSQL volume if it contains valuable data, then rebuild the local app profile. The semantic migration creates only optional vector structures. Roll back by restoring the old image and volume backup.
