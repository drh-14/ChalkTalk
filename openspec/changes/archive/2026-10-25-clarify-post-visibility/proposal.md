## Why

The existing post composer describes its audience as a destination rather than clearly saying who can read a post. A Public/Private visibility choice makes the already-supported privacy behavior understandable at creation.

## What Changes

- Questions and ordinary notes offer an explicit Visibility choice: Public — everyone in course (default), or Private — only you and current instructors/TAs.
- Polls and announcements remain public-only. The existing author-plus-staff access rule, API `private` field, and private-to-public publication behavior remain unchanged.
- This focused replacement of the unshipped expanded-audiences PR removes its selected-staff and managed-group features, migration, and API changes. No deployed data uses them.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `course-discussion-frontend`: make visibility explicit in the creation composer.

## Impact

- Web post composer and its component/browser tests.
- No API, database, dependency, or migration changes relative to main.
