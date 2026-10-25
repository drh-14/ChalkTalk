## Context

Posts already use one SQL-backed `PostService`, viewer-specific projections, visibility clauses before pagination, conditional updates, URL-backed feed filters, and an additive migration sequence. Tags are user-entered many-to-many; folders must remain separate. Course-resource sections are unrelated.

## Decisions

- Add `post_folders(id, course_id, name)` with case-insensitive per-course uniqueness and `posts.folder_id` as a nullable composite FK `(course_id, folder_id)` to prevent cross-course assignment even below the API.
- Expose `GET/POST /api/v1/courses/{courseId}/post-folders`, `PATCH/DELETE /api/v1/courses/{courseId}/post-folders/{folderId}`. Reads require membership; writes require active-course staff. `POST` returns 201/Location; mutations use the repository's JSON and CSRF conventions.
- Accept `folderId: uuid|null` on post creation/patch and project `{id,name}|null` as `folder`. A missing assignment defaults to null. Folder changes reuse post ETag/version and edit permission checks. Deleting a folder nulls assignments before removing the definition in one transaction.
- Add `folder` query value as UUID or `unfiled`, included in normalized cursor filter binding. Apply the SQL clause before ordering/limit and after the same viewer visibility predicate as all post lists.
- Load folder definitions for a course, show them in alphabetical filter/picker controls, and keep the choice in the route query. Staff management lives within the discussion sidebar, not the resource-section settings.

## Risks and mitigations

- Concurrent deletion versus assignment: composite FK rejects stale assignment; API returns a validation failure. Staff deletion uses the transaction to keep posts and definitions consistent.
- Privacy: folder lists reveal definitions only to course members, never post counts; post filtering reuses the existing visibility clause.
- Existing posts: null default makes them Unfiled without backfill.

## Verification

Specification-derived integration tests cover permissions, validation, atomic deletion, cross-course references, conditional edits, private visibility, and multi-page filters. UI tests cover desktop and narrow browser flows with mocked API and screenshots. Run typecheck, lint, build, and relevant/full tests before the no-mistakes gate.
