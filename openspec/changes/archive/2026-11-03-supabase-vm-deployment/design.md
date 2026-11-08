## Context

The API already uses `DATABASE_URL` with `pg` and `S3_*` with the AWS S3 client. Current VM Compose starts PostgreSQL and SeaweedFS, while development Compose should remain unchanged except explicit local mode flags. Production is fresh, so no object or row transfer is needed; SQL schema migrations still run. See `documentation/design/2026-11-03-supabase-managed-data-deployment.md` for service boundaries and failure analysis.

## Goals / Non-Goals

**Goals:** explicit local/managed configuration; Supabase-backed VM Compose; four named image builds; stable same-origin Caddy gateway; clear setup/validation instructions.

**Non-Goals:** Supabase Auth, frontend SDK access, existing data migration, backup implementation, new database schema, UI behavior.

## Decisions

- Keep existing `DATABASE_URL` and `S3_*` as the single endpoint/secret source. Strict booleans `LOCAL_DATABASE` and `LOCAL_FILE_STORE` default `true`, are independently selectable, and require explicit remote settings when `false`.
- Retain the existing PostgreSQL pool, S3 client, ChalkTalk authorization and private bucket; S3 keys stay server-side because they bypass Supabase Storage RLS.
- Use separately named Dockerfiles for frontend, API, collaboration and worker; migration reuses the API image with a command override. Caddy remains the only published service.
- Use a direct Supabase Postgres connection on IPv6-capable hosts, or dashboard-provided IPv4 session pooler on IPv4-only hosts. Do not use transaction pooling for migrations' session advisory lock.
- Keep `pg_trgm` in `public` to preserve ChalkTalk SQL; do not pre-enable it in Supabase's `extensions` schema. Document the Supabase advisor warning and verify extension placement before launch.

## Risks / Trade-offs

Remote data adds latency and provider dependency; fail-fast startup avoids silently using local or AWS ambient credentials. Four Dockerfiles duplicate some build instructions but make production process ownership explicit. Real Supabase compatibility requires a disposable project and privately configured credentials; a missing live run must be reported as pending, not a pass. Managed services still require backup planning.
