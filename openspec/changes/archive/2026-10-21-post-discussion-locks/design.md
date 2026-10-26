## Context

Post rows already serialize answer/followup writes and poll votes through row locks. Post versions support conditional editing. Recent feed order uses `last_activity_at`.

## Decisions

- Add `posts.discussion_locked boolean NOT NULL DEFAULT false` in migration `050_post_discussion_locks.sql`. No backfill beyond the default is needed.
- Use dedicated `PUT /api/v1/posts/:postId/discussion-lock` for questions and polls with strict JSON `{locked:boolean}` and `If-Match` on the post version. Return the projected post plus ETag. Only current TA/instructor roles in active courses may change state; notes and announcements return `422 validation_failed` without changing version or activity. Do not change `last_activity_at` for lock/unlock. No-op requests retain version and timestamp.
- Add one `discussion_locked` check inside the transaction that holds the post row for answer/followup creation and votes, including poll unvote. Use `409 discussion_locked`. Check after idempotency replay for creates, so retrying an already-completed request does not create again or fail spuriously.
- Project the lock flag in every active post list/detail object, always `false` for notes and announcements. UI shows a badge in feed/detail, disables discussion and vote controls while locked, and shows staff toggle only for questions and polls in detail. Server remains authoritative for stale views.
- No new network calls in the listing path and no new dependency.

## Risks and mitigations

- **Race at lock boundary:** all participating mutation paths acquire the same parent post row lock; a completed lock precedes any later mutation check.
- **Feed churn:** toggle updates version/updated_at only, never last_activity_at.
- **Concurrent post edits:** ETag protects toggle; post editing retains lock field because ordinary update never writes it.
- **Advanced polls overlap:** this branch changes the current single-ballot paths only; rebase onto future poll work and adapt every new ballot mutation path before merging either feature.
