## 1. Persistence and recording

- [x] 1.1 Add migration and backfill event tables; verify migration and uniqueness in PostgreSQL integration tests.
- [x] 1.2 Record successful canonical post views and answer creations; verify success, deduplication, skipped reads, and persistence-failure behavior with tests.
- [x] 1.3 Clean events during course deletion; verify deletion integration test.
- [x] 1.4 Preserve per-student question counts after post deletion without a post link; erase buckets on account and course deletion. Backfill active questions only.

## 2. Statistics API

- [x] 2.1 Add tests first for summary period buckets and response-time calculation, then implement and verify them.
- [x] 2.2 Add tests first for student pagination, zeroes, role access, and validation, then implement and verify them.

## 3. UI and references

- [x] 3.1 Add staff-only tab, API client, period/chart/table and states; verify component tests.
- [x] 3.2 Update statistics, posts, OpenAPI, and database references; verify contract checks.
- [x] 3.3 Run automated real-browser mocked-API flows and capture screenshots for the draft PR; verify all specified scenarios.

## 4. Delivery

- [x] 4.1 Run tests, lint, typecheck, build, and strict OpenSpec validation; verify all pass.
