## Why

Course staff need to stop new participation on a particular post without hiding its history or archiving the whole course. A per-post lock provides a clear, reversible moderation boundary for questions and polls.

## What Changes

- Staff can lock or unlock an individual question or poll through a conditional API action and visible post controls; notes and announcements remain unlocked.
- A locked post remains readable and editable but rejects new answers, followups, replies, poll ballots or ballot retractions, and answer/followup upvote changes.
- Existing staff resolution-marker changes remain possible. Lock changes do not move a post in recent-activity feed order.
- Post list and detail responses expose lock state to readers.

## Capabilities

### New Capabilities

- `post-discussion-locks`: Staff moderation of per-post participation with consistent API, feed, and UI behavior.

### Modified Capabilities

None; the new cross-cutting lock capability constrains participation on otherwise existing posts, answers, followups, and polls.

## Impact

Post persistence and APIs, answer/followup and poll mutation paths, feed/detail and response UI, API/database references, migration, tests, and screenshots. No new dependency or service.
