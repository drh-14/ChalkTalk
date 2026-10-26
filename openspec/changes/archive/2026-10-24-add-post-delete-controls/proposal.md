## Why

The post API permits a current author or course staff to delete a visible post, but the discussion UI offers no action. This makes ordinary moderation and author cleanup inaccessible without an API client.

## What Changes

- Add a confirmed Delete post action to active post detail for the author or current TA/instructor with read access.
- Use the existing conditional DELETE contract with current ETag and CSRF token; on success remove the post from the feed and return to the course discussion list.
- Preserve the current post and unsaved editor text on failure; expose conflicts and refresh the current version after a stale ETag.
- Keep confirmed duplicate sources and archived-course posts non-deletable. Existing followup/reply deletion is unchanged.

## Capabilities

### Modified Capabilities

- `text-posts`: Make existing authorized post deletion available in the discussion UI with safe confirmation and failure handling.

## Impact

Frontend post client and detail view, their tests, and mocked-browser acceptance coverage. No API, database, dependency, or permission change.
