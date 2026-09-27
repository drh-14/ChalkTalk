## Why

The initial course implementation passes its existing tests but misses documented authorization, idempotency expiry, database shape, and paginated browser behavior.

## What Changes

- Enforce the published course and membership access and retry contracts with HTTP, PostgreSQL, and browser tests.
- Migrate the implemented organization, course, membership, and shared idempotency columns to the documented schema, preserving existing auth behavior.
- Let the browser obtain its own membership independently and page through roster and course results with recoverable errors.

## Impact

Course and auth services, HTTP routes, the course browser views, and a forward-only SQL migration change. No endpoint or dependency is added.
