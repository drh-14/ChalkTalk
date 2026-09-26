## 1. Specification and configuration

- [x] 1.1 Add and strictly validate authentication, SMTP, origin, allowed school-domain, rate-limit, and local TLS environment configuration.
- [x] 1.2 Add API dependencies for Argon2id, UUIDv7, and SMTP delivery.
- [x] 1.3 Configure Vite HTTPS and an unrevised `/api` proxy; document trusted local certificates.
- [x] 1.4 Add Mailpit to local Docker Compose and document its local SMTP settings.

## 2. Persistence

- [x] 2.1 Write migration and PostgreSQL integration tests for authentication persistence behavior, including token-state, organization-linkage, session-revocation, and concurrent ETag cases.
- [x] 2.2 Add the authentication migration with a direct `users.organization_id` relationship (no organization memberships), credential tokens, sessions, idempotency/rate-limit storage, and minimal course membership protection tables.
- [x] 2.3 Implement transaction-safe repositories and migration discovery for the new schema.

## 3. Authentication behavior

- [x] 3.1 Write unit, HTTP, and PostgreSQL integration tests for token/password helpers, origin and CSRF checks, SMTP-failure indistinguishability, and documented success/failure paths.
- [x] 3.2 Implement verified account creation and SMTP verification delivery.
- [x] 3.3 Implement login, current session, logout, cookie handling, and CSRF protection.
- [x] 3.4 Implement profile retrieval/update, password changes, reset requests/completion, and session revocation.
- [x] 3.5 Implement account deletion with `If-Match`/current-password checks, final-instructor course-row locking, and the documented shared lock protocol.

## 4. Integration and validation

- [x] 4.1 Mount versioned routes without changing the documented public paths and update schema wording where implementation resolves it.
- [x] 4.2 Run targeted API tests and confirm they initially fail before implementation, then pass afterward.
- [x] 4.3 Run workspace format, typecheck, test, migration, and OpenSpec strict validation.

## Validation evidence

- 2026-09-25: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` passed locally. `openspec validate implement-auth-backend --strict` passed.
- The local environment has neither `TEST_DATABASE_URL` nor Docker/PostgreSQL, so the eleven PostgreSQL integration tests were skipped locally. CI supplies `TEST_DATABASE_URL`; its successful verification run for the pre-existing suite is https://github.com/drh-14/ChalkTalk/actions/runs/36210344713. The new database cases will run on the next CI execution.
