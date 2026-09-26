## Context

The API and database references define courses and memberships, but SQL migration 002 stores only a minimal subset and the frontend uses dummy courses. The agreed architecture is recorded in `docs/design/2026-09-26-courses-and-memberships.md`.

## Goals / Non-Goals

**Goals:**

- Implement all documented course and course membership endpoints with consistent authentication, conditional updates, pagination, and error behavior.
- Give signed in users live course listing, creation, joining, detail, and role appropriate management actions.
- Make asynchronous deletion durable and preserve the final instructor invariant under concurrency.

**Non-Goals:**

- Implement posts, collaboration, search, or file storage features before their own API work.
- Introduce a separate worker deployment, ORM, frontend router, or global state library.

## Decisions

### Course service owns domain invariants

Express routes adapt the documented HTTP contract and reuse existing session, Origin, and CSRF handling. A course service performs membership authorization and transactional lifecycle changes through `pg`. The approved `GET /api/v1/organizations` prerequisite exposes only the caller's direct `users.organization_id` relationship in the documented organization response shape, allowing browser course creation without exposing organization membership. A valid course ID and join code allow a signed in user to join across organizations.

### Preserve composite membership identity

`course_memberships` keeps `(course_id, user_id)` as its primary key. The documented response `id` is a stable UUIDv5 derived from those values with a fixed namespace. It does not need a database column.

### Deletion uses a durable in process worker

The DELETE transaction changes status to `deleting` and inserts a database job. The API process claims and retries jobs using PostgreSQL row locking and leases. It removes current course owned data before deleting the course. GET exposes `deleting` until cleanup succeeds, then `not_found`.

### Share instructor mutation locking with auth

Course membership changes and account deletion lock the course row before checking final instructor cardinality. Existing auth SQL and role values must remain compatible as migrations move the schema to the documented `ta` role.

### Browser keeps API contract at the client seam

The course client owns paths, cookies, CSRF and ETag headers, response and error parsing. The protected home and course detail views own loading, empty, error, and pending UI states. Frontend tests use the existing Vitest, jsdom, and React Testing Library setup.

## Risks / Trade-offs

- A worker in the API process shares its capacity with requests. Durable jobs and leases keep cleanup recoverable; it can be extracted later if volume warrants it.
- Existing legacy course rows may lack enough instructor data to backfill a creator. Migration must fail clearly rather than fabricate ownership.
- UUIDv5 response IDs become a public stability commitment even though membership lookup paths use course and user IDs.
