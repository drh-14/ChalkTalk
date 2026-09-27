## 1. Contract and persistence

- [x] 1.1 Annotate canonical Markdown/OpenAPI with the current text-only implementation status without removing long-term poll or attachment definitions.
- [x] 1.2 Correct the tombstone example, duplicate-suggestion access wording, and hidden-resource mutation errors in the API references.
- [x] 1.3 Add migration `005` for question/note posts, normalized course tags, post-tag links, same-course duplicate keys, revisions, tombstones, and generated full-text search with a GIN index; verify clean and existing-schema migration paths.

## 2. Tests-first post behavior

- [x] 2.1 Establish HTTP-plus-isolated-PostgreSQL fixtures for author, another student, TA, instructor, deleted author, nonmember, and two courses.
- [x] 2.2 Write failing tests for JSON question/note creation and retrieval, response shape/headers, idempotency, author visibility, and cross-course/global-ID `404`; confirm red, implement, and confirm green.
- [x] 2.3 Write failing tests for composed list/search/filter/sort/cursor behavior, especially author visibility before pagination and `hasMore` and exclusion of deleted posts from every list; confirm red, implement, and confirm green.
- [x] 2.4 Write failing tests for conditional update/delete, content versus duplicate/pin permissions, same-course duplicate targets, archived/deleting writes, and exact tombstones; confirm red, implement, and confirm green.
- [x] 2.5 Test selected authentication, CSRF, validation, unsupported-variant, stale/missing ETag, and persistence error paths.

## 3. Lifecycle and validation

- [x] 3.1 Write a failing course-deletion cleanup test, then extend the worker to remove post-tag links, posts, and tags retry-safely.
- [x] 3.2 Run focused and full PostgreSQL tests, format, lint, typecheck, build, strict OpenSpec validation, and a JSON-post Compose smoke test.
- [x] 3.3 Record results and remaining limitations; archive this OpenSpec change only after implementation and verification are complete.

Verification: PostgreSQL-backed full suite passed (119 tests across 17 files), as did format, lint, typecheck, build, and strict OpenSpec validation. Migration `005` passed on clean isolated schemas and the existing Compose database. Authenticated Compose smoke passed signup/login, course creation, JSON question create/get/update/delete, list exclusion, and direct tombstone retrieval; the temporary course and account were cleaned up. Phase limitations remain polls/votes, attachments/multipart, answers, view events, and frontend work.

Post-archive review: an HTTP/PostgreSQL regression test now checks malformed cursor sort values return `400 invalid_request` rather than a database-cast `500`. The deleted-author identity test also verifies that student `authorId` filtering excludes both named and anonymous content after account deletion, while staff can match it. Both were observed failing before the service fixes. The updated full PostgreSQL suite passes 120 tests across 17 files.
