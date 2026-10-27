## Why

The existing bell hides useful response context and stops at the first page, while post authors receive no durable in-app notice when staff edit, merge, or delete their work. A single, access-checked notification stream makes these actions discoverable without adding another inbox or email channel.

## What Changes

- Add current-text response previews and exact response destinations to existing follower and mention notifications.
- Notify a post author when another staff member meaningfully edits its title/body, confirms a question merge, or deletes the post.
- Render rectangular, accessible cards in the existing bell with a visible Load more control.
- Keep all existing notification kinds, follow/unfollow behavior, anonymity, and email behavior.

## Capabilities

### New Capabilities

- `notification-bell-cards`: Secure in-app response and moderation cards with paginated browsing.

### Modified Capabilities

None.

## Impact

Adds nullable notification-target fields and constrained kinds, extends the notification API and content transaction writers, and updates the existing React bell. No new service or dependency.
