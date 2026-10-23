## Context

Existing `post_follows`, `post_reads`, and `course_read_marks` already define following and unread. The list query applies privacy before pagination and binds cursors to normalized filters. There is no saved-post table or feed snapshot mechanism. See proposal.md.

## Goals / Non-Goals

**Goals:** Reuse existing viewer state and list predicates, keep saved state private, and detect matching new creations without mutating the displayed feed.

**Non-Goals:** Named lists, staff-curated reading lists, notification changes, live push, or a guarantee across concurrent uncommitted creation transactions.

## Decisions

- Add `saved_posts(post_id, course_id, user_id)` with a composite primary key, membership and post foreign keys, and cascade deletion. It is intentionally one set per user rather than a list-management subsystem. `PUT`/`DELETE /api/v1/posts/{postId}/saved` are idempotent, require normal session/CSRF/origin checks, and reject unreadable posts like normal post retrieval. This mirrors existing follow endpoints.
- Add `unread=true`, `following=true`, and `saved=true` predicates to the existing post list before ordering/pagination, using the same SQL expressions as the projection. Do not duplicate read/follow persistence or change their semantics. Add `saved` to active-post projections.
- The course list issues a server-generated opaque timestamp+UUID high-water token for the course (newest committed post creation tuple, or DB time and minimum UUID if empty). The token is bound to course and viewer; the new-count request reuses the list filter parser and SQL predicates to count visible, active, non-merged creations later than that tuple. It does not fetch or replace feed cards. The browser polls only while the page is visible, pauses for duplicate review, and prompts rather than reordering. Clicking the prompt reloads the first page and resets pagination while preserving detail/composer.
- A database-issued high-water tuple is simpler than a new sequence, immutable creation transaction ID, or row-level coordination. It can miss a post whose transaction began before snapshot issuance and commits afterward; the user explicitly accepted this best-effort limitation. Manual refresh remains available.

## Risks / Trade-offs

- [A concurrent creation commits after its old timestamp is surpassed] → Prompt may miss it; document best-effort behavior and keep manual refresh. No data is lost.
- [A post becomes private or is deleted after being saved] → List predicates always re-check current visibility and active status; deletion cascades saved entry.
- [Polling adds query load] → Poll at a moderate interval only when the tab is visible; count query selects a scalar and uses the course creation index.
- [Token is replayed with other filters] → Token binds course/viewer, not filters, so the currently active filters determine the count; filter changes issue a new snapshot in the UI.

## Migration Plan

Add `041_saved_posts.sql` containing the saved-post table and course creation index. Existing posts require no backfill. Rollback removes saved state but leaves existing follow/read state untouched.
