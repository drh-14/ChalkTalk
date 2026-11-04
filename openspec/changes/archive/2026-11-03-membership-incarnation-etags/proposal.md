## Why

A member can leave and rejoin after an instructor confirms removal. Both membership rows start at version 1, so a version-only `If-Match` can delete the new membership without confirmation. The API needs a validator that distinguishes membership incarnations.

## What Changes

- Assign each membership row an immutable random incarnation UUID, including existing rows via migration.
- Return an incarnation-aware opaque membership ETag on join, detail, role, and email-preference responses, while keeping JSON membership IDs and versions unchanged.
- Require the complete current membership ETag for conditional membership and preference writes. Preserve exact join ETags on idempotent replay.
- Keep the course and self-leave contracts unchanged; document the new validator and test the leave/rejoin race.

## Capabilities

### Modified Capabilities

- `course-management`: Membership conditional requests distinguish a current membership from a prior leave/rejoin incarnation.

## Impact

Database migration, course service and HTTP handlers, API/database references, tests, and confirmation UI's opaque ETag flow. No new dependencies.
