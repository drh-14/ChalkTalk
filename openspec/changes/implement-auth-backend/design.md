## Context

The API reference defines a browser-only, cookie-based authentication contract. The existing Express application has no identity boundary and the database has only a migration ledger. This change adds the smallest durable schema and runtime surface that can satisfy the documented account lifecycle without adding course-management features.

The browser runs over local HTTPS and proxies `/api` to Express. Express still owns authentication and validates the browser `Origin`; the proxy simply preserves a same-origin browser surface so the production cookie policy can also be used locally.

## Goals / Non-Goals

**Goals**

- Implement every documented authentication endpoint under `/api/v1`.
- Use opaque, database-backed browser sessions with a secure HttpOnly cookie and a separate CSRF token.
- Keep verification, reset, session revocation, profile versioning, and account deletion transactional.
- Provide local HTTPS and a Mailpit inbox with SMTP configuration that also works with AWS SES.

**Non-Goals**

- Course management, posts, uploads, collaboration, worker processing, or frontend login screens.
- OAuth, bearer-token authentication, external identity providers, or a distributed rate-limit store.
- Infrastructure provisioning for AWS.

## Decisions

### Module boundaries

`apps/api/src/auth` contains route handlers, service rules, repositories, email delivery, token/password helpers, and public types. HTTP middleware owns request IDs, cookie parsing, exact-origin validation, session extraction, CSRF checks, ETag checks, and consistent errors. Route handlers remain thin and call the service layer through injected dependencies, allowing HTTP tests to substitute the email sender and clock where needed.

### Authentication and credentials

Passwords use Argon2id. Sessions, verification tokens, reset tokens, and CSRF tokens are random opaque credentials. PostgreSQL stores only a keyed SHA-256/HMAC digest of each credential; the raw value is returned only in the cookie, email link, or successful session response. Session rows hold a digest of the CSRF token rather than reversible CSRF material.

The cookie is `__Host-chalktalk_session`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, and has no `Domain`. It expires after 30 days. Unsafe authenticated methods require an allowed `Origin` and the session's CSRF token in `X-CSRF-Token`. Login and public token-using endpoints validate their allowed origin where applicable.

### Persistence

Migration `002_authentication.sql` adds only:

- `organizations` and `users`;
- `email_verification_tokens` and `password_reset_tokens`;
- `sessions`, `idempotency_records`, and `rate_limit_buckets`;
- minimal `courses` and `course_memberships`, used only to determine whether a deleting user is a course's final instructor.

All identifiers are PostgreSQL `uuid` values generated as UUIDv7 by the application. A user belongs to exactly one organization through `users.organization_id`, inferred from the verified email's canonical domain. This change deliberately does not add an organization-membership table; multiple organizations, organization roles, invitations, and membership history are out of scope. Database constraints and partial indexes preserve active-email and active-token invariants. Multi-step credential state changes run in a transaction.

### Email and local environment

Email delivery is an `EmailSender` port implemented with Nodemailer SMTP. Local Compose runs Mailpit, which accepts SMTP on port 1025 and exposes its inbox on port 8025. Production supplies SMTP configuration; AWS SES's SMTP endpoint is compatible without an application code change.

Vite reads trusted local certificate and key paths from environment, serves HTTPS, and proxies `/api` without rewriting it. Developers generate trusted local certificates with `mkcert`; private certificate files remain ignored.

### Error and concurrency behavior

Errors follow the existing documented HTTP status and error envelope. User records include a version used to generate an ETag. Profile and deletion mutations require `If-Match`; a missing value returns `428 Precondition Required` and a stale value returns `412 Precondition Failed`. Password resets revoke all sessions. Password changes and account deletion revoke relevant sessions. Account deletion locks every affected course row before checking whether the user is its final instructor; future course-membership writers must use that same lock protocol before changing an instructor role or membership.

Public operations use configuration-backed fixed-window limits: verification requests default to five per normalized email per hour and 100 per source IP per hour; login defaults to ten attempts per normalized email per 15 minutes and 100 per source IP per hour; password-reset requests default to five per normalized email per hour and 100 per source IP per hour; account creation defaults to 100 per source IP per hour. SMTP delivery is synchronous: persist a verification/reset token, attempt delivery, and return `503 service_unavailable` on definite delivery failure; a retry supersedes the unused token. A transactional outbox and worker are intentionally out of scope.

## Risks / Trade-offs

- PostgreSQL rate buckets are sufficient for the current few-hundred-user scope, but horizontal scale may require a shared rate-limit service later.
- Exact origin validation requires deployment configuration to stay synchronized with the web application's public URL.
- Mailpit captures emails locally only; it deliberately does not prove an external SMTP account's deliverability.
- The minimal course tables support one account-deletion safety rule and should be expanded by the future course implementation change rather than treated as a complete course schema.

## Verification

Write unit and HTTP tests before implementation. Cover password/token helpers, cookie and CSRF behavior, origin rejection, successful verification/signup/login, protected profile reads and writes, reset revocation, and final-instructor deletion rejection. Run API tests, type checks, formatting, migration tests, and the full workspace validation after implementation.
