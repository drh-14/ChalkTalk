## Why

Course members cannot tell when a question or note was posted: the API already returns each post's `createdAt`, but the discussion frontend never renders it, so a stale question and a fresh one look identical.

## What Changes

- Show when each post was created beside its author in the course feed cards, the post detail pane, and the staff duplicate-review detail pane.
- Display a compact relative time (for example, "3h ago") that becomes a short calendar date for older posts, with the exact local date and time available on hover and to assistive technology through a semantic `<time>` element.
- Keep anonymous posts anonymous: the time appears beside "Anonymous" and reveals nothing about the author.
- Show nothing about edits or updates. `updatedAt` and `lastActivityAt` also change when staff pin or merge a post, so they do not mean "edited" and stay out of scope.
- Leave the staff duplicate-review cards, related-question suggestions, merged-post listings, and deleted-post tombstones unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `course-discussion-frontend`: feed cards and post detail gain a creation time; the staff duplicate-review detail pane also shows the source post's creation time.

## Impact

Only the course discussion frontend (`apps/web/src/posts/`), its rendered tests, and styling change. The web `Post` type's use of `createdAt` is unchanged. There is no API, OpenAPI, database, seed, or dependency change. The AMS161 local seed creates every post at the same instant, so its posts will all show the same time until a separate change spreads them.
