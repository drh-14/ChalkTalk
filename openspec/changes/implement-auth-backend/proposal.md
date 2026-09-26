## Why

ChalkTalk has an API contract for accounts and session authentication, but the API currently exposes only a health check. Implementing authentication now establishes the security and identity boundary required before course and discussion features can be built.

## What Changes

- Implement the documented account verification, account creation, session, profile, password, reset, and account-deletion endpoints.
- Add the authentication schema and the minimal course-membership schema needed to prevent deleting a course's final instructor.
- Add secure browser session, CSRF, exact-origin, idempotency, and rate-limit behavior.
- Add local HTTPS development, a Vite API proxy, and Mailpit for local email capture; use an SMTP abstraction compatible with AWS SES in production.
- Correct internal schema terminology: store CSRF token hashes, use PostgreSQL `uuid` columns with application-generated UUIDv7 values, and name a newly created organization from its canonical domain.
- Model a user's organization directly with `users.organization_id`; do not introduce organization memberships in this change.

## Capabilities

### New Capabilities

- `authentication`: Account identity, verified signup, browser sessions, CSRF protection, password recovery, profile management, and protected account deletion.

### Modified Capabilities

- None.

## Impact

- Adds raw SQL migrations and API modules under `apps/api`.
- Adds Argon2id password hashing, Nodemailer SMTP delivery, and UUIDv7 generation dependencies.
- Updates local Docker Compose, Vite development configuration, environment documentation, database documentation, and the API reference where the implementation resolves schema wording.
- Does not add course-management routes, product tables, worker processing, WebSocket collaboration, object storage, or frontend authentication screens.
