## Context

The existing notifications table, REST list/count/read API, follower fan-out, and React bell already provide one inbox. See the approved design at `docs/design/2026-10-27-notification-bell-events.md`.

## Goals / Non-Goals

**Goals:** Atomic response and moderation events; read-time access checks and current-text previews; complete, accessible browser pagination.

**Non-Goals:** New emails, a second bell, real-time push, historical text snapshots, new follow behavior.

## Decisions

- Add nullable answer/followup IDs and merge-target/version fields to notification rows, with kind/target constraints. Existing rows remain valid; response body is never stored.
- Project list and unread count through the same membership and post-state predicate. Deletion is a dedicated exception because its source post is scrubbed; merge requires an active current canonical target and unchanged merge version.
- Use the existing cursor contract and REST endpoints. Browser cards consume typed destinations rather than interpolating arbitrary server HTML.
- Write moderation notifications in the same post transaction; do not enqueue email jobs for them.

## Risks / Trade-offs

- Current-text previews can change after an edit → deliberately resolve on each list request.
- Concurrent inbox changes can shift cursor pages → reopening refreshes the list; this is not an audit log.
- The bell refreshes on its existing interval rather than WebSocket → no extra operational service or connection lifecycle.

## Migration Plan

Apply an additive migration with nullable columns and expanded checks. Existing rows and API clients retain their current fields. Rollback can drop the new columns/constraints only after ceasing new event creation.
