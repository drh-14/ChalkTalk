## Context

The published API and database references are the source of truth. The prior course change is archived; this is a corrective change.

## Decisions

- Keep the existing HTTP routes and response shapes. Explicit member deletion requires an instructor even when the target is the caller; `/members/me` remains the self-leave route.
- Keep 24-hour idempotency retention. Reuse of an expired key replaces its old record under the existing transaction/advisory-lock protocol.
- Migrate `idempotency_records` to `(scope,key)` primary key and documented state, response status/headers/body and timestamps. Existing completed records are backfilled, and auth and course callers use the new columns.
- Widen organization/course/membership versions to `bigint`; convert PostgreSQL's string representation to safe JSON numbers before generating ETags or responses.
- Get the caller's membership directly, independently of the paged roster. The roster and course list expose next-page loading, failure, and retry states.

## Migration safety

The migration fails on invalid existing domains/names/keys rather than truncating them. It preserves completed idempotency responses and adds defaults/checks needed by current writers.
