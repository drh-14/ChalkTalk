## Why

Tags help find topics but do not give staff a stable, curated way to organize a course's discussion posts. A separate optional folder lets readers browse staff-defined sections without changing tags or resource sections.

## What Changes

- Add a flat, course-scoped list of post folders managed by course staff.
- Let members put their own posts in one optional folder at creation or edit; staff may organize any post.
- Add folder and Unfiled filters to the existing visibility-safe paginated feed.
- Show folders in the composer, editor, feed, and a staff management control. Deleting a folder makes its posts Unfiled.

## Capabilities

### New Capabilities

- `post-folders`: Folder lifecycle, assignment, filtering, and browser behavior for discussion posts.

### Modified Capabilities

None. Existing tag, post, and feed requirements continue unchanged.

## Impact

Additive database migration, posts service and HTTP routes, post API schemas/references, web post client/feed/composer/editor, and browser/API tests. No new dependency. Course resource sections remain separate.
