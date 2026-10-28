## Context

See `proposal.md` for motivation and `docs/design/2026-10-27-public-course-threads.md` for the approved domain and architecture. Main currently has an Express API, PostgreSQL migrations through `051`, a course app bar, an S3-compatible attachment store, an existing post-notification bell, and a separate Yjs WebSocket runtime. PR #89 changes the bell projection but is not merged; this change shall start from main and avoid adopting its branch.

## Goals / Non-Goals

**Goals:** Atomic conversation/message writes; authorization based on current membership; public REST contracts and safe attachment transfer; durable unread/catch-up state; live WebSocket delivery, including ephemeral conversation-local typing; accessible board/conversation UI and browser evidence.

**Non-Goals:** Team membership records, private Threads, categories, search, email, scheduled expiry, automatic archive, nested replies, message revision history, or a new external service.

## Decisions

1. **Normalized course-owned rows.** Add Thread boards, conversations, messages, attachment metadata, watches, and per-course durable change ledger using UUID IDs and foreign keys. Store author-role-at-posting on messages. Use a per-course counter updated under a row lock in the same transaction as each durable change; a bare sequence would not preserve commit order. Index chronological message pages and watcher/unread queries. Migration `053_public_course_threads.sql` follows PR #89's reserved `052` without depending on its contents. Alternative: reuse Posts tables, rejected because lifecycle, permission, and notification semantics differ.
2. **REST is authoritative.** Board, conversation, message, watch, read-watermark, attachment, and catch-up routes live under `/api/v1/courses/{courseId}/threads/...`. Existing session, Origin, CSRF, idempotency, conditional write, and error conventions apply. List/detail pages use bounded opaque cursors. Every route resolves current course membership; archived courses reject mutations. A transaction locks the board before conversation/reply writes and board delete, serializing the race. Alternative: socket writes, rejected because retries and authorization are already well established over REST.
3. **Read state as a watermark plus bounded exceptions if needed.** A watch is not an access grant; it records follow state and the highest loaded message sequence per conversation. Because opening may load only a newer page while older pages remain unloaded, mark-read records loaded message IDs or a precise range rather than blindly advancing to latest. Unread counts query unmarked visible messages authored by others. Alternative: one global `last_seen` timestamp, rejected because it would falsely mark unloaded or concurrent messages read.
4. **Notifications integrate at the existing bell seam.** Persist Thread reply notices for enabled watchers and project them with current membership and visible message checks. Add a typed Thread destination/preview without making Threads part of the post notification's post foreign key. Keep this module separate enough to merge with #89's card changes later; if #89 lands first, reconcile at integration. Alternative: force Thread replies into `notifications.post_id`, rejected because they are not Posts.
5. **API-owned WebSocket with PostgreSQL signals.** Attach a dedicated `/api/v1/thread-events` `ws` upgrade handler to the API HTTP server; the Yjs/Hocuspocus collaboration socket cannot be reused. Authenticate the session cookie and Origin on upgrade; authorize subscriptions and revalidate them on events/interval. PostgreSQL `LISTEN/NOTIFY` signals only course/board IDs and the committed change counter. Clients subscribe, then fetch bounded REST changes after their cursor; reconnect repeats this order. Typing pulses use the same authenticated socket and a distinct ephemeral PostgreSQL channel so only clients viewing that conversation receive a display-name event. Presence TTL, debounce/rate limit, and stop/blur keep it best effort. Alternative: Redis Pub/Sub or background polling, rejected as unnecessary infrastructure and weaker UX respectively.
6. **Files use the current object-store boundary.** Upload after message persistence with the existing content validation, limits, and S3-compatible client. API-mediated download rechecks current membership and live parent each time. Board/message deletion immediately hides metadata and queues durable object deletion through the existing cleanup worker. Alternative: public signed URLs, rejected due revocation window.
7. **Browser navigation and state.** Add a Threads tab immediately to the right of Discussion. It browses boards and separate conversations, shows watched unread counts, preserves a failed composer, and displays connection state/manual refresh. Only reply composer emits typing; current conversation viewers see transient named presence. Reuse Markdown rendering/sanitization. Include keyboard and narrow-screen behavior, mocked-API browser tests, and screenshots per visible scenario.

## Risks / Trade-offs

- **PR #89 concurrently changes the bell** → Keep Thread notification work modular, compare current main before final integration, rebase deliberately, and run both card and Thread tests; do not stack its branch.
- **Sequence/catch-up races** → Commit counter and change row in the write transaction; test concurrent writes and reconnect gaps in PostgreSQL.
- **Long Thread histories** → Bounded cursor pagination; never return entire history or unbounded counts in one response.
- **Socket authorization may become stale** → Check membership at subscribe and before forwarding; REST remains the final read gate.
- **File deletion can fail after DB commit** → Immediate metadata hiding plus retryable cleanup job.
- **Typing signals can be lost** → Short receiver TTL, no persistence, no impact on saved messages.

## Migration Plan

Deploy migration before API/web processes; old clients ignore new tables and routes. Roll forward if cleanup is interrupted. Rollback code leaves new rows intact; dropping these tables is destructive and requires a separate explicit data-loss decision. No prior Channels/Threads data requires conversion.
