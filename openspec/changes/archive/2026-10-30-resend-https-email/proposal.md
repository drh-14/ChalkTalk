## Why

Railway's intended deployment cannot rely on outbound SMTP, while ChalkTalk's existing email transport is SMTP-only. Resend HTTPS must deliver the same email events without weakening cancellation, privacy, or retry behavior.

## What Changes

- Add an explicit Resend HTTPS provider for production while retaining SMTP/Mailpit locally.
- Freeze exact queued email payloads before the first send, retry with a stable idempotency key, and clear snapshots after success or cancellation.
- Revalidate recipients, preferences, visibility, content, and lifecycle before every attempt; cancel stale messages rather than sending changed or restricted content.
- Document provider configuration and bounded idempotency guarantees.

## Capabilities

### New Capabilities

- `outbound-email-transport`: Provider selection, durable payload retries, and cancellation safeguards for all queued email.

### Modified Capabilities

- `daily-course-email-digest`: Frozen digest retry and whole-digest invalidation.

## Impact

API and worker email adapter/configuration, job and digest delivery, additive PostgreSQL migration, tests, environment/deployment documentation, and the official Resend SDK dependency. No UI or email trigger changes.
