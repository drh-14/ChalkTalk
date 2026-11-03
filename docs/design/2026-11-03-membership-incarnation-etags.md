# Membership incarnation-aware conditional requests

Status: agreed design
Date: 2026-11-03

## Context

Course membership is currently keyed by `(course_id, user_id)`. A join inserts a
new row at `version = 1`; removal deletes the row. The API computes a stable
public membership `id` from the course and user IDs, and uses the same `"vN"`
ETag format for memberships and courses. Consequently, an instructor who reads
`"v1"` can later remove a _different_ membership incarnation after the student
leaves and rejoins at version 1. A confirmation dialog cannot solve this by
refetching before DELETE: the leave/rejoin may occur between that GET and the
DELETE. The course row lock serializes these operations but does not identify
which incarnation the request intended to change.

The user chose to fix this API/database ABA problem in the course-confirmation
PR, accepting a membership ETag format change rather than keeping `"vN"` through
durable per-pair tombstone state. Course ETags, public membership IDs, user IDs,
paths, numeric `version`, roles, CSRF requirements and authorization remain
unchanged. Existing API documentation says `course_memberships` has an `id`
column, but the actual table has a composite primary key; the database reference
must be corrected with this change.

## Decision

Give every active membership row an immutable, random UUID **incarnation token**.
Backfill existing rows once, and generate a fresh token whenever a member joins
after having left. A membership ETag contains both the incarnation token and
the row version, for example `"m:<uuid>:v3"`. The token is an opaque validator,
not an authorization credential; no new value needs to be added to the JSON
membership body. Keep the existing deterministic public membership `id` to
avoid changing list keys or references.

All membership GET, join, and role-update responses return the incarnation-aware
ETag. Instructor PATCH and DELETE compare the complete submitted `If-Match` to
the currently locked row's incarnation-aware ETag. A stale tag, including the
former `"vN"` format, produces the existing `412 version_conflict`; a missing tag
still produces `428 precondition_required`. A client can recover by fetching the
current membership and explicitly confirming the current details. Voluntary
self-leave retains its existing no-ETag contract.

## Structure

```mermaid
sequenceDiagram
  participant Staff as Instructor UI
  participant API as Course API
  participant DB as Postgres
  Staff->>API: GET membership
  API->>DB: Read incarnation A, version 1
  API-->>Staff: ETag m:A:v1
  Note over DB: Student leaves; row A deleted
  Note over DB: Student rejoins; row B inserted at version 1
  Staff->>API: DELETE with If-Match m:A:v1
  API->>DB: Lock course; read current row B
  API-->>Staff: 412 version_conflict
  Staff->>API: GET current membership
  API-->>Staff: ETag m:B:v1
```

The token belongs to the membership row, not to a browser session. The API
does not trust a client-supplied token beyond equality with the current row.
The existing course-row lock continues to serialize join, role change, and
removal, so no new lock service or protocol is required.

### Internal result and idempotency boundary

Keep the public `Membership` projection JSON-ready and free of the incarnation
token. The service methods that return one membership (`join`, `getMember`, and
`updateMember`) instead return an internal `{ value: Membership, etag: string }`
envelope computed from the same database row. `joinIdempotently` adds its
existing `status` to that envelope. HTTP sends only `value` as `data` and the
separate `etag` as its response header; list/page methods still return plain
public memberships. This explicit envelope is preferable to a hidden property
on a serializable object or a second database read after mutation.

For an idempotent join, persist that exact ETag atomically with the public
response body and status in `idempotency_records.response_headers`. A retry
returns the original body, status and header even if the membership was later
updated, removed or rejoined; it must not derive the tag from the current row.
Existing unexpired join records predate stored ETags and originally returned
`"vN"`; they may replay that historical tag for their remaining 24-hour lifetime
but it cannot authorize a mutation after this change. A migration-time backfill
or narrowly scoped legacy replay fallback can preserve that original response.
New records must always store the incarnation-aware ETag, and a malformed new
record must fail visibly rather than silently substituting a current-row tag.

## Alternatives rejected

- **Monotonic version across rejoin:** preserves `"vN"` syntax but requires a
  durable per-course/user counter or tombstone after every removal, including
  cleanup on course deletion. This is more state and a larger write-path change.
- **Timestamp in ETag:** a timestamp is not a robust unique incarnation
  identifier, especially for same-transaction or clock-resolution edge cases.
- **Frontend-only reconfirmation:** narrows the stale window but does not close
  the GET-to-DELETE race; other API clients remain vulnerable.
- **Change public membership `id`:** unnecessary for conditional requests and
  potentially disruptive to UI keys and integrations.

## Trade-offs accepted

This changes a public validator format. A client holding an older `"vN"`
membership ETag must refetch before its next role change or removal. The API
already documents ETags as opaque strings that clients should return unchanged;
course ETags are unaffected. The new UUID consumes a small amount of storage
per active membership and must be included in internal membership reads.

## Failure modes

| Failure                                      | Required behavior                                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Old tag after deployment                     | Return `412`, do not mutate; current GET returns a new tag.                                                                                 |
| Leave/rejoin between confirmation and DELETE | Compare against the new incarnation and return `412`; never remove the new row.                                                             |
| Concurrent PATCH/DELETE or join/removal      | Existing course lock serializes operations; a loser observes current row or absence and receives the existing conflict/not-found semantics. |
| Missing or malformed token in stored row     | Migration and non-null database constraint prevent it; fail visibly rather than accepting a version-only fallback.                          |
| Unauthorized or forged request               | Existing membership/role checks, session, origin and CSRF checks still apply; knowing an ETag grants no access.                             |

## Reversibility

The incarnation column and public ETag shape are the expensive decisions: once
clients use the new tags, reverting to `"vN"` would reintroduce ABA. How the
internal ETag helper is packaged is cheap to change. The token need not be
retained after a membership is deleted because no old tag can match a new
random UUID.

## Open questions

None. Implementation planning should ensure API and database references,
OpenAPI examples, service and HTTP tests, and the confirmation UI all use the
opaque new tag without constructing it client-side.
