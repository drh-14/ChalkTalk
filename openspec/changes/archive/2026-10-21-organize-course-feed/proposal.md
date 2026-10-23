## Why

Course members can follow posts and see unread state, but cannot narrow the feed to those posts, keep a personal saved list, or discover matching new posts without refreshing and losing their place.

## What Changes

- Add composable Unread, Following, and Saved filters to the course feed, reusing existing follow/read state.
- Add one private, personal saved-post list per member, with save/unsave controls on posts and server-side filtering.
- Indicate newly created posts matching the active filters without changing the current cards, pagination cursor, selected detail, or composer until the member explicitly refreshes.
- Issue a server-side feed snapshot token for reliable new-post detection; never infer newness from client clocks or first-page comparisons.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `text-posts`: Extend viewer-aware post listing with Unread, Following, and Saved filters, saved-post actions, and a snapshot/new-count contract.
- `course-discussion-frontend`: Add saved-post controls and feed organization/refresh interactions.

## Impact

Post listing API and persistence, course discussion UI, OpenAPI and API/database references, integration and browser tests. Existing follow/read semantics and notification behavior are retained.
