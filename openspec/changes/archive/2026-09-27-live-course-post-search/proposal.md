## Why

The course discussion feed currently waits for Enter or the Search button. Members want results to update while typing, without an extra submit step or an oversized browser history.

## What Changes

- Replace submit-only course-post search with a 300 ms debounced live search field; remove the Search button.
- Keep the existing PostgreSQL web-search syntax, relevance ordering, course scoping, cursor behavior, and URL-shareable `q` value. Clear an empty query immediately.
- Replace the current URL entry for live query edits rather than pushing one entry per edit. Keep the selected post or unsent composer open as the left feed updates, and ignore stale search responses.
- Increase only the discussion course-title font modestly. Do not change the left-panel width.
- Update rendered interaction tests and the active OpenSpec contract.

## Non-Goals

- Changing the posts API, PostgreSQL search implementation, or database schema.
- Semantic/fuzzy search, cross-course search, or a new router dependency.
- Changing Related questions search in the composer.

## Capabilities

### Modified Capabilities

- `course-discussion-frontend`: live course-scoped main-feed search and URL behavior.

## Impact

- Changes the browser discussion view, route synchronization, tests, and a small scoped CSS rule.
- No server endpoint, migration, or dependency change.
