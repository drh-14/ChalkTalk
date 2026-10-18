## Why

Daily emails currently omit notes even though they are course posts. A note-only day therefore looks empty to the recipient.

## What Changes

- Include visible questions and notes in digest eligibility and content.
- Count both types together as posts and link each item.
- Coordinate note creation with the midnight scan just like question creation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `daily-course-email-digest`: Include both post types in the previous-day activity requirement.

## Impact

Digest queries, email rendering, post creation timestamp/locking, tests, and the daily-email API reference. No new API route or dependency.
