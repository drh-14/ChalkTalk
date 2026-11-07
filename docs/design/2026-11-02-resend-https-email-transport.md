# Resend HTTPS email transport

This design records the earlier SMTP-default setup. For current local and production provider selection, see the [email transport specification](../../openspec/specs/outbound-email-transport/spec.md) and [deployment guides](../../deployment/README.md).

ChalkTalk uses its existing `EmailSender` interface for immediate verification and reset messages, queued notification/announcement/invitation messages, and daily digests. Local development defaults to SMTP through Mailpit. Production may select `EMAIL_PROVIDER=resend` with a verified `EMAIL_FROM` and a sending-only `RESEND_API_KEY`; `RESEND_API_BASE_URL` changes only the API origin for isolated mocks. There is no automatic provider fallback.

Queued jobs and digest outbox rows commit a versioned frozen message before the first network attempt. A retry reuses its exact logical sender, recipient, subject, body, and inline image bytes and a stable Resend idempotency key derived from the job or outbox ID. SMTP uses frozen MIME bytes. The provider binding is immutable for a frozen attempt; a provider or sender change cancels the message. Resend's idempotency window is bounded, so a very late ambiguous retry can duplicate mail.

Immediately before each attempt, the worker checks the current recipient address, email preference, membership, course/content visibility and lifecycle, included content and actor identity, and represented images. A stale email is canceled and scrubbed rather than sent. For private content, relevant database locks remain held through provider handoff, so access revocation waits for an in-flight send. Resend calls are bounded to 30 seconds. A successful API response records acceptance, not guaranteed inbox delivery.

The adapter treats permanent client errors as terminal, authorization errors and HTTP 429 as operator-repair/retry cases, and network drops, timeouts, and server errors as retryable. Tests use a local HTTP API mock and disposable PostgreSQL; no real Resend credential is committed or required for CI.
