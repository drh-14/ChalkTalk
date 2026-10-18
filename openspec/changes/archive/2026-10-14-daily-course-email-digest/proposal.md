## Why

Every active course member should receive a daily summary of relevant discussion in each course. A midnight timer alone can lose messages during outages, so generation and delivery need durable recovery.

## What Changes

- Automatically queue one email per active recipient, course, and previous UTC activity date when there is eligible activity by others; there is no account opt-in or profile field.
- Start with the UTC activity date on which the migration is deployed. Send its first eligible digest at the next 00:00 UTC; do not backfill earlier dates.
- Retry SMTP delivery from a durable outbox and catch up missed dates after worker downtime.
- Document the API, storage, and operational behavior.

## Capabilities

### New Capabilities

- `daily-course-email-digest`: Automatic activity selection, UTC scheduling, and durable per-course email delivery.

### Modified Capabilities

- None.

## Impact

Backend PostgreSQL migration, API worker, existing SMTP transport, API/database documentation, and tests. No frontend, profile API change, or new third-party dependency.
