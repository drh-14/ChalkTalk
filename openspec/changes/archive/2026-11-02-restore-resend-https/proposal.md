## Why

The selected HTTPS provider is being revised after acquisition of a verified sender domain. Deliver through Resend HTTPS while preserving privacy-safe frozen queues and current course collaboration behavior. The Resend capability should be independently mergeable before any Railway integration, without weakening cancellation, privacy, or retry behavior.

## What Changes

- Add an explicit Resend HTTPS provider with a configurable API origin for local testing while retaining SMTP/Mailpit as the local default.
- Freeze exact queued email payloads before the first send, retry with a stable idempotency key, and clear snapshots after success or cancellation.
- Revalidate recipients, preferences, visibility, content, and lifecycle before every attempt; cancel stale messages rather than sending changed or restricted content.
- Document provider configuration and bounded idempotency guarantees.

## Capabilities

### New Capabilities

- `outbound-email-transport`: Provider selection, durable payload retries, and cancellation safeguards for all queued email.

### Modified Capabilities

- `daily-course-email-digest`: Frozen digest retry and whole-digest invalidation.

## Impact

API and worker email adapter/configuration, job and digest delivery, additive PostgreSQL migration, tests, local environment documentation, and the official Resend SDK dependency. Railway deployment changes are deferred; no UI or email trigger changes.
