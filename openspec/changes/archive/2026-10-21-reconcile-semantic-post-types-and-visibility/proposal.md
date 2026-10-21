## Why
PR51 must integrate current main's private posts, polls, announcements and notification jobs while retaining its approved questions-and-notes semantic scope.

## What Changes
- Preserve upstream private read predicates before semantic ranking/pagination and existing worker/activity behavior.
- Explicitly restrict semantic indexing, catch-up and candidate expansion to questions/notes. Polls retain main's lexical search behavior.
- Add public HTTP and worker regressions for roles, membership, private visibility transitions, pagination and poll exclusion.

## Capabilities
### New Capabilities
### Modified Capabilities
- `text-posts`: Semantic compatibility with current post types and existing private visibility rules.

## Impact
Existing semantic/post modules and tests; mechanical merge unions. No new audience model, migrations, dependencies or statistics behavior.
