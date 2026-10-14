## Context

See [proposal.md](proposal.md) for motivation and [specs/text-posts/spec.md](specs/text-posts/spec.md) for behavior. `PostService.update` already confirms duplicates inside a PostgreSQL transaction, and `jobs` already provides durable, deduplicated, leased work with retries. `JobWorker` currently handles course deletion only. `EmailSender` and `FRONTEND_BASE_URL` already exist for account email and links.

## Goals / Non-Goals

**Goals:** Make successful question confirmations independently deliverable without turning a mail outage into a misleading API failure; avoid duplicate queued jobs for one confirmation; preserve existing merge response and authorization.

**Non-Goals:** Emails for notes, suggestions, unmerges, other post updates, or a general notifications framework. No frontend changes or new mail provider.

## Decisions

1. **Queue within the merge transaction.** After all existing permission, revision, and target checks pass and the post row is updated, insert a `jobs` row of kind `send_question_duplicate_email` in the same transaction. Use a deduplication key containing source post ID and its new version. A rolled-back merge therefore cannot leave a notification, and a committed merge cannot omit its intent. Sending synchronously inside PATCH was rejected because SMTP failure would either roll back a valid merge or leave a committed merge behind a `5xx` response.
2. **Reuse the existing job lease/retry machinery.** Extend the worker's kind dispatch rather than create a second queue or database table. The payload contains only source ID, canonical ID, acting staff user ID, and acting role; it does not store a mail address or display name. The worker loads those just before delivery. A missing or deleted staff account uses a generic role label rather than retaining the deleted person's name in a job payload. The same success/failure/dead-letter states remain observable. A separate mail outbox would add a migration and duplicate the existing retry pattern for one event.
3. **Revalidate before sending.** Check that the source is still a confirmed question pointing to the same active canonical post; the author account and course membership are active; and the course remains active. Cancel a stale job without sending. This avoids emailing a link the recipient cannot currently open. A second successful merge after an unmerge gets a new source version and therefore a new job.
4. **Plain-text email.** Compose the exact subject and sentence from the source title, current actor display name when the account remains active, and role captured at merge time. Use an unnamed role label if the staff account has been deleted. Collapse title whitespace so untrusted newlines cannot distort the message. Append an absolute canonical URL built from the configured `FRONTEND_BASE_URL`. Existing `EmailSender` is sufficient; HTML rendering and a new dependency are unnecessary.

## Risks / Trade-offs

- **SMTP acceptance followed by a crash** → The lease can expire and resend the message. This rare duplicate is accepted; the job key prevents duplicate intents, not exactly-once delivery.
- **Mail delivery repeatedly fails** → The existing bounded retry policy can mark the job dead with `last_error`; this must remain observable rather than reporting that the merge failed.
- **Recipient or course access changes before dispatch** → The worker cancels the notification rather than sending an inaccessible link.
- **Staff account is deleted before dispatch** → The worker uses an unnamed role label to avoid retaining erased profile data; ordinary sends use the current staff name and the role at merge time.

## Migration Plan

No schema migration is needed: the existing `jobs` table supports another kind. Deploy the API and worker together; old queued course-deletion jobs remain compatible. Rollback can stop claiming the new kind while retaining its queued rows for a later redeploy.
