## Why

Users who opt in need a reliable daily summary of activity in each course. A midnight timer alone can lose messages during outages, so generation and delivery need durable recovery.

## What Changes

- Add an account-wide daily digest opt-in to the authenticated profile.
- Queue one email per recipient, course, and previous UTC activity date when there is eligible activity by others.
- Retry SMTP delivery from a durable outbox and catch up missed dates after worker downtime.
- Document the API, storage, and operational behavior.

## Capabilities

### New Capabilities

- `daily-course-email-digest`: Opt-in, activity selection, UTC scheduling, and durable per-course email delivery.

### Modified Capabilities

- None.

## Impact

Backend profile API, PostgreSQL migration, API worker, existing SMTP transport, API/OpenAPI/database documentation, and tests. No frontend or new third-party dependency.
