## Context

The post list already applies privacy and other filters before pagination. Readers need a notice for newly matching creations without resetting the visible feed.

## Goals / Non-Goals

**Goals:** Show a passive count of matching new posts without moving the displayed feed or offering an in-notice refresh control.

**Non-Goals:** Saved posts, new personal-state filters, notification changes, live push, or a guarantee across concurrent uncommitted creation transactions.

## Decisions

- The course list issues a server-generated snapshot token based on the list query's statement timestamp, without post IDs. It is unsigned transport data, not proof of issuance or an authorization capability; each count still checks the current viewer's membership and post visibility. For the current API contract, see [the course posts reference](../../../../documentation/api/posts.md). The new-count request reuses existing list filter parsing and SQL predicates; it does not fetch or replace feed cards.
- The browser polls only while the page is visible, pauses for duplicate review, and renders a passive accessible status rather than reordering or providing a refresh action. A normal browser refresh loads a fresh first page.
- The database-issued timestamp is simpler than a new sequence or row-level coordination. It can miss a post whose transaction began before snapshot issuance and commits afterward; the user accepted this best-effort limitation. Manual refresh remains available.

## Risks / Trade-offs

- [A concurrent creation commits after its old timestamp is surpassed] → Status may miss it; manual refresh still finds it.
- [Polling adds query load] → Poll at a moderate interval only when the tab is visible; count query selects a scalar and uses the course creation index.
- [Token is replayed with other filters] → Token binds course/viewer, not filters, so the currently active filters determine the count; filter changes issue a new snapshot in the UI.

## Migration Plan

The unmerged migration adds only the `(course_id, created_at DESC, id DESC)` index on posts. Existing posts require no backfill.
