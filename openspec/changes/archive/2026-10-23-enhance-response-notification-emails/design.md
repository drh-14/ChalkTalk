## Context

See proposal.md. `recordActivity` creates follower and mention notifications in the response transaction and queues `send_notification_email` jobs. The worker currently resolves a notification into a post-level URL and sends through the configured SMTP adapter. Question detail loads answers and cursor-paged followups independently.

## Goals / Non-Goals

**Goals:** Keep one notification/email pipeline, use delivery-time authority for private excerpts, and make the link useful even for off-page nested replies.

**Non-Goals:** Change default email preferences, create owner-only messages, email deletions/join/leave, or change notification API projections.

## Decisions

- Add an optional `{ kind: "answer" | "followup", id }` reference to new job JSON payloads, including deduplicated mention jobs. Do not migrate jobs; a legacy job without the reference retains post-level mail. This avoids a schema/public API change. Alternatives: persist a new notification foreign key (migration and API implications) or copy response body into the queue (stale/private content risk).
- The worker reads the current response inside its send transaction and suppresses deleted/mismatched references. It checks membership, preference, unread state, current post visibility through the shared visibility predicate, and current follow state for follower events. Mention jobs remain independent of follow. This makes queued messages reflect revocation; the existing in-flight SMTP race remains.
- Compose a plain-text excerpt from at most three nonempty logical lines with a fixed character bound; do not include attachment contents. Keep anonymous actors as “Someone”. Avoid putting response text into subject lines.
- Use `#answer-{id}` and `#followup-{id}` URL fragments. Stable element IDs and focus/scroll logic reveal an answer after load. For a followup, load its authorized ancestor chain via the existing get-followup endpoint and inject only the linked path into the existing paginated tree, leaving ordinary pagination intact. A missing or forbidden target leaves the post usable without revealing it. Alternative: expand every cursor page, which is unbounded and slow.
- Tests use the existing PostgreSQL-backed service/worker seam and browser flow. A separate isolated stack test sends through real SMTP to Mailpit with disposable PostgreSQL and mock users.

## Risks / Trade-offs

- [A response can be edited between creation and delivery] → Deliberately use current visible text; suppress if deleted. The mail records current response, not an immutable creation snapshot.
- [An already-starting SMTP send may finish after opt-out] → Preserve the agreed final-check semantics and do not hold locks across unrelated settings updates beyond the existing worker transaction.
- [A hash target may become inaccessible] → Fail closed on API reads, show the normal post without stale target content.

## Migration Plan

No migration. Deploy API/worker before frontend if separated; new links still open the post until the updated frontend loads. Rollback leaves optional job fields ignored by older workers, which still send post-level mail.
