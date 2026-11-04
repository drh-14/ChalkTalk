## Context

Memberships use a composite `(course_id,user_id)` primary key and a stable public ID. Version resets to 1 on rejoin, making a version-only ETag vulnerable to ABA. Course rows already serialize join, role change, and removal.

## Decision

Add a non-null random UUID `incarnation` per membership row. Generate an ETag `"m:<incarnation>:v<version>"` from the row. Keep `incarnation` internal. Compare the complete ETag under the existing course lock for instructor PATCH/DELETE and under the membership row lock for email preferences. Keep course ETags and self-leave unchanged.

Single-member service methods return `{value,etag}` and HTTP emits `value` as the existing body. Idempotent joins save their exact ETag in `idempotency_records.response_headers`. Legacy unexpired records replay their original `"vN"` ETag, which cannot authorize a new write.

See `docs/design/2026-11-03-membership-incarnation-etags.md` for alternatives and failure modes.
