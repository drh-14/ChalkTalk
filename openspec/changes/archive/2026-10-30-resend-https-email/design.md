## Context

The API sends immediate authentication mail through `EmailSender`; the worker sends queued jobs and rich daily digests. Queued jobs already have durable claims and retries, but email content is recomposed per attempt and several paths send while holding a database transaction. Rich digest rendering can generate random CID values and multi-megabyte inline images.

## Goals / Non-Goals

**Goals:** Select Resend HTTPS in production without changing local Mailpit; persist exact queued payloads before first external send; retry safely with stable keys and revalidate current eligibility for every attempt; verify network and invalidation cases.

**Non-Goals:** Change email triggers, build a new generic queue, introduce inbound mail/webhooks, guarantee exactly-once delivery after Resend's 24-hour key window, or change UI.

## Decisions

- Retain the `EmailSender` boundary, adding optional `from`, `defaultFrom`, and `idempotencyKey`. The official Resend SDK is isolated in the adapter. `EMAIL_PROVIDER` selects `smtp` or `resend`; Resend requires `RESEND_API_KEY` and `EMAIL_FROM`, with no SMTP fallback.
- Add nullable versioned `frozen_email` JSONB to `jobs` and `digest_outbox`. The serialized payload includes base64 inline attachment bytes and validation references. A transaction commits the snapshot before any provider call. Stable keys derive from row IDs.
- Recheck current account address, preferences, content visibility/body, and course state before sending. Send-time row locks preserve revocation ordering where currently provided. On ineligibility, cancel and clear the snapshot. A frozen digest is canceled as a whole if any included item becomes invalid.
- Keep immediate authentication sends synchronous, including password-reset abort behavior. Queued messages retain existing retry scheduling and claim semantics. Permanent provider errors must not silently fall back or be marked sent.
- Bound an otherwise unbounded Resend HTTP request to 30 seconds; an existing shorter authentication abort signal remains authoritative. This stays below both queued claim leases.

## Risks / Trade-offs

- Inline digest snapshots may grow PostgreSQL during an outage; existing image/HTML caps constrain individual rows, and terminal states clear snapshots.
- An accepted request with a failed local acknowledgment can be retried after the 24-hour provider idempotency window, so duplicates remain possible.
- Frozen title wording can become stale, whereas body changes cancel to avoid misrepresenting substantive content.
