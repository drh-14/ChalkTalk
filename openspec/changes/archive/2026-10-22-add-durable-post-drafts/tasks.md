## 1. Contract and persistence tests

- [x] 1.1 Add PostgreSQL-backed HTTP tests for owner-only list/create/read/update/delete, ETag and stale/missing preconditions, partial fields, archived restrictions, membership cleanup, and no expiry; run red before API code.
- [x] 1.2 Add PostgreSQL-backed create-post tests for matching/stale/foreign draft revisions, atomic rollback, and idempotent publish replay; run red before service changes.
- [x] 1.3 Add frontend tests for draft list/reopen, debounced save states, conflict recovery, attachment exclusion, archived access, and chosen leave behavior; run red before UI code.

## 2. API and database

- [x] 2.1 Add migration `049_post_drafts.sql` with membership cascade and list index; verify migration and persistence tests pass.
- [x] 2.2 Implement validated owner-scoped draft service/routes with JSON/ETag/no-store contract; verify focused HTTP tests pass.
- [x] 2.3 Extend post-create transaction to consume a matching draft atomically and preserve idempotency; verify focused PostgreSQL tests pass.

## 3. UI and references

- [x] 3.1 Implement draft client, list/selection, serialized debounced autosave, recovery actions, archived behavior, and attachment messaging; verify frontend tests pass.
- [x] 3.2 Update API/OpenAPI/database docs for the actual request, response, header, error, and persistence contract; verify reference consistency.
- [x] 3.3 Run mocked-API Chromium tests for golden, conflict, archived, and failure flows; capture and review screenshots.

## 4. Verification

- [x] 4.1 Run focused PostgreSQL integration and full repository checks, strict OpenSpec validation, and review the scoped diff before archiving.
