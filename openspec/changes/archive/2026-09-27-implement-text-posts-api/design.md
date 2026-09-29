## Context

`documentation/api/posts.md`, `documentation/api/identity-visibility.md`, `documentation/openapi.yaml`, and `documentation/database.md` describe a larger target system. The approved phase boundary is text-only questions and notes. This OpenSpec design records the implementation slice and its structural decisions.

## Goals / Non-Goals

**Goals:** Implement five JSON post operations with documented response shapes, course authorization, author visibility, search/filter/pagination, duplicate/pin permissions, revisions, idempotency, and tombstones. Verify at the HTTP boundary with isolated PostgreSQL schemas.

**Non-Goals:** Poll and vote state/routes, file storage or multipart, attachment URLs, answers/followups, view events, and frontend work.

## Decisions

### Keep posts in the existing API and database

Express routes handle session, Origin/CSRF, JSON/media validation, envelopes, and headers. A cohesive post service handles transactional authorization, post/tag persistence, revisions, and viewer-aware projections. PostgreSQL full-text search uses a generated `tsvector` and GIN index. No new service or dependency is needed.

### Resolve authorization from current course membership

Course-scoped routes check membership in the path course. Global post-ID routes resolve the stored `course_id` and then check membership before projecting content or returning a field-level permission result. An absent or hidden post returns the same `404 not_found`. Organization affiliation is not sufficient. Archived or deleting courses remain readable to members but reject writes.

### Build each viewer's author projection

Keep the real author ID and anonymity flag in storage. Named authors are shown to all members; anonymous authors are named only to themselves and course staff; deleted authors are shown as `Deleted user` with no ID. No viewer-specific representation is reused across viewers. For `authorId`, exclude identities hidden from a student before ranking, pagination, `hasMore`, or counts. An all-hidden match is an empty `200` page.

### Preserve target response shape for text posts

Active posts include `attachments: []`; questions include `answered: false`. The phase rejects `type: poll` creation with `422 validation_failed`, multipart create/update with `422 validation_failed` (matching the existing JSON-only request guard), and a `type=poll` list filter with `400 invalid_request`. Vote routes are not registered. These are phase limitations, not changes to the long-term target contract.

### Retain transactional invariants

Migration `005` adds only `posts`, `tags`, and `post_tags`; the post type constraint permits `question` and `note` for now. Preserve `(course_id, id)` and a composite same-course duplicate FK. Normalize and deduplicate tag names by course, with the application validating same-course post/tag linkage. Create with an idempotency key atomically stores the response for a 24-hour matching replay. Update/delete lock the post, check current membership and field permissions, and enforce `If-Match` before revision changes.

Any course member may suggest an active same-course duplicate, but only author or staff may edit ordinary content; staff controls confirmation/clearing and pinning. Deletion leaves a minimal seven-field tombstone, strips content and author identity, and advances the version. The course-deletion worker removes post-tag links, posts, and tags before the course and remains retry-safe.

## Module interface and data invariants

The post **module** presents a small **interface** to the HTTP routes: create, list, get, update, and delete for a session user and validated input. The interface includes its error modes, not just method names: hidden resources are `not_found`, malformed list queries are `invalid_request`, field-permission failures are `permission_denied`, and conditional writes distinguish missing from stale ETags. Routes do not assemble author projections or authorization SQL. The module keeps its query construction, transaction handling, tag normalization, cursor encoding, and per-viewer projection in one implementation. PostgreSQL is the only persistence adapter in this phase; a second storage abstraction would add a hypothetical seam without another implementation.

The database must enforce the documented primary/foreign keys, type and status constraints, positive revision, and same-course duplicate target. Active posts have nonempty title/body, a real author, and `deleted_at IS NULL`; tombstones have `deleted_at`, no title/body/author, and the original type and timestamps. `post_tags` links only tags in the post's course, checked by the application as `database.md` specifies. Tag names are normalized per course; a replacement tag list changes only the target post's links. A generated search vector indexes active text, not deleted content. The response model is separate from rows: active text posts always include `attachments: []`, `pinned`, duplicate fields, and the viewer's `author`; questions include `answered: false` until answer data exists. No `post_view_events` write is implied by a read.

The privacy check precedes resource-specific precondition and field-permission checks on global-ID mutations. A signed-in nonmember sending a correct ETag, stale ETag, missing `If-Match`, or forbidden field must not learn which condition applies to a hidden post: the response is the same `404 not_found` as for an absent ID. Session/Origin/CSRF and request syntax checks may run in the route before the database lookup, but their errors must not depend on whether the ID exists. For an accessible post, ordinary precondition and permission errors apply. Mutation authorization and the post revision check occur inside one transaction; tests verify observable behavior rather than a particular SQL statement order.

## Endpoint design

### `POST /api/v1/courses/{courseId}/posts`

The route requires a current session, matching Origin and CSRF token, and JSON media. It accepts exactly a `question` or `note` with required title and Markdown body, optional `anonymous` (default `false`) and tags. The OpenAPI text limits apply: title 1–200 characters, body 1–100,000, at most ten distinct tags of 1–40 characters each. Unknown fields and `type: poll` fail phase validation; multipart is not silently accepted. The post module verifies membership in the path course and that the course accepts writes, then inserts the post, normalized tag rows/links, and—if supplied—the idempotency record in one transaction. The author is always the session user; `pinned` and duplicate state start at their documented defaults.

A successful new request returns `201`, `Location: /api/v1/posts/{id}`, a revision ETag, and `{ data: activePost }` projected for that creator. A matching unexpired `Idempotency-Key` returns the original status, headers, and result without another post; conflicting reuse returns `409 idempotency_key_reused`. The key's scope includes operation, course, and caller. Current membership must be checked even before replaying a stored result, so leaving a course cannot expose a cached post response. A nonmember or hidden course gets `404 not_found`; an archived/deleting course gets the documented write-conflict behavior. Other priority errors are `401` unauthenticated, `403` CSRF, and `422` invalid fields/media in this phase.

Priority tests: create each supported type and assert full shape/headers/defaults and stored tags; anonymous creator sees their own real identity; cross-course/nonmember creation is denied; matching/conflicting/expired and concurrent idempotency retries; poll/multipart and malformed JSON do not write a row; archived/deleting course does not accept writes.

### `GET /api/v1/courses/{courseId}/posts`

The route requires a session and current membership in the path course. It validates `q` (trimmed, nonempty, at most 500 characters), `type` (`question` or `note` in this phase), repeated `tag` values with OR semantics, `authorId`, date range, `answered`, `duplicateStatus`, `sort`, `limit` (default 25, 1–100), and an opaque cursor (at most 2,048 characters). `relevance` requires `q`; with `q` it is the default, otherwise `recent_activity` is the default. Invalid filters, date ordering, or a cursor from another course/viewer/filter/sort return `400 invalid_request`; a nonmember or absent course returns `404 not_found`.

The query checks membership, excludes every deleted post, and applies all filters before rank, sort, and keyset pagination. In particular, an `authorId` filter includes another author's named content but not their anonymous content for a student; staff can match either. `limit + 1` is taken only after the active-post and identity-visibility predicates, so `hasMore` and `nextCursor` reveal no deleted or hidden item. Stable tie-breakers make equal timestamps/ranks deterministic. `answered=true` produces no matches in this phase; `answered=false` matches active question posts. Pinning is returned as a field but does not reorder results: the reference defines relevance, newest, and recent-activity sorts, not a pinned-first sort. Each returned active item is projected independently for the viewer, and the response is `{ data, page }` without an ETag.

The user decided that course lists never contain tombstones, whether unfiltered or filtered. Tombstones remain retrievable by global post ID for current course members. Search ranking, pagination, `hasMore`, and cursors therefore operate only on active posts.

Priority tests: composed filters and sort defaults; repeated-tag OR; pagination with tied sort values; cursor replay across course, viewer, and changed filters; nonmember Course B list; anonymous `authorId` match removed before pagination and `hasMore`; staff versus student projections on the same page; empty visible match returns `200` and `hasMore: false`; deleted posts never appear in unfiltered or filtered lists and never affect pagination.

### `GET /api/v1/posts/{postId}`

After session validation, the module resolves the stored post and its course, confirms current membership, and only then builds a viewer-specific active or tombstone projection. A UUID that is absent and an existing post in another course both return `404 not_found`, including when the caller belongs to the post author's organization. An active post returns `200`, `{ data: activePost }`, and its ETag. A retained tombstone returns `200`, its seven-field `{ data }`, and its current ETag; it never includes `author`, `anonymous`, body, tags, attachment, duplicate, pin, or answer fields. Read access is allowed for current members even when the course is archived/deleting.

Priority tests: author, other student, TA, and instructor receive the correct projection for the same anonymous post; named and soft-deleted authors follow the shared identity policy; Course A member and total nonmember cannot read a Course B post; absent versus hidden IDs are indistinguishable; ETag matches `version`; deleted post returns only the tombstone keys.

### `PATCH /api/v1/posts/{postId}`

The route requires a session, valid Origin/CSRF, JSON media, a nonempty update object, and `If-Match`. It accepts only documented text-post fields: title, body Markdown, anonymity, replacement tags, pinning, duplicate target/status. Attachment-removal fields and multipart uploads are deferred rather than accepted as no-ops. The module resolves post/course membership first so a hidden ID returns `404` before a missing/stale ETag or a field-permission error. An accessible tombstone cannot be edited. An active archived/deleting course rejects writes. Inside the write transaction, lock the post, verify the current ETag, validate referenced duplicate target as active and same-course, check each requested field against the caller's author/staff/member permissions, then change post/tag/duplicate state and advance the revision.

An author or staff member may edit ordinary text fields; any member may submit a duplicate *suggestion* without gaining content-edit permission; only staff may confirm/clear review or pin. A mixed request containing a forbidden field fails as a whole—no permitted subset is applied. Success returns `200`, `{ data: activePost }` for the caller, and a new ETag. Key errors are `403 permission_denied` for accessible forbidden edits, `404 not_found` for an already-deleted post, `409 course_archived`, `412 version_conflict`, `422 validation_failed` for empty/invalid fields, and `428 precondition_required`.

Priority tests: author text/tag edit; staff pin/confirm; nonauthor member suggestion succeeds but text/pin edit and mixed forbidden request fail atomically; self/cross-course/deleted duplicate target rejected; missing/stale ETag and concurrent edits; hidden Course B post always `404` despite stale/missing ETag or forbidden body; archive/deleting rejection; returned author projection and ETag reflect the new state.

### `DELETE /api/v1/posts/{postId}`

The route requires a session, valid Origin/CSRF, and `If-Match`; there is no request body. It resolves post and current course membership before exposing author/staff permission or ETag status. Only the author or course staff may delete an active post, and only while the course accepts writes. The transaction locks the post, verifies the ETag, clears title/body/author identity and tag links, sets `deleted_at`/`updated_at`, and advances the version. The deletion keeps its ID, course, original type, and creation time. It returns `204` with no body; subsequent GET by a member returns the seven-field tombstone. Any future nested relation may still reference that stable post ID.

Key errors mirror PATCH: accessible nonauthor/nonstaff gets `403 permission_denied`; archived/deleting course gets `409 course_archived`; stale ETag gets `412`; missing ETag gets `428`. Hidden and absent global IDs return the same `404` before those resource-specific checks. A repeated DELETE of an accessible tombstone returns `404 not_found` without mutation.

Priority tests: author/staff delete and `204` empty response; nonauthor cannot delete; hidden Course B ID remains `404` with both missing and stale ETags; version and exact tombstone projection after deletion; stale/missing ETag; repeated deletion rejection; course deletion worker removes posts, tag links, and tags without violating self-referential duplicate constraints.

## Risks / Trade-offs

- The canonical reference currently describes future poll and attachment operations. Status annotations identify the deployed subset without deleting those target definitions.
- `answered` is always false and `answered=true` returns an empty page until answers are implemented.
- View events are not recorded, so historical view counts for this phase cannot later be reconstructed.
- A global-ID route must not leak hidden post existence through different error codes or timing-sensitive precondition checks. Tests cover the observable response.

## Verification

Write failing HTTP-plus-isolated-PostgreSQL tests before each implementation slice, confirm the expected failure, implement, and rerun. Prioritize author/other-student/TA/instructor/deleted-author/nonmember fixtures across two courses. Run focused and full PostgreSQL tests, migration checks from clean and existing schemas, format/lint/typecheck/build, strict OpenSpec validation, and a JSON-post Compose smoke test.
