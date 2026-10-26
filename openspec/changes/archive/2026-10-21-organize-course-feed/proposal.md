## Why

Readers currently need to refresh manually to discover new posts, which can interrupt their place in the feed or an unsent composer.

## What Changes

- Show a notice when newly created posts matching the active feed filters appear; never move existing cards or offer a click-to-refresh action.
- Issue a server-side feed snapshot and count matching creations since it. The notice is best-effort for an in-flight creation transaction.
- Keep existing following and unread behavior. Do not add Saved, Unread, or Following feed filters or saved-post storage/API.

## Capabilities

### Modified Capabilities

- `text-posts`: Add a snapshot/new-count contract to existing post listing.
- `course-discussion-frontend`: Add a passive, accessible new-post count; normal browser refresh remains available.

## Impact

Post listing API, a creation index, course discussion UI, OpenAPI and API/database references, integration and browser tests.
