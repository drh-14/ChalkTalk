# Proposal

## Why

Members cannot direct a post at a particular person. A student who wants a specific TA, or the classmate who asked the same thing, has to hope they follow the post. Piazza-style @mentions close that gap, and notifications already provide the delivery.

The user decided:

- anyone in the course can be mentioned;
- anonymous content may mention people, and the notification shows "Anonymous" exactly as other notifications do;
- `@staff` notifies every TA and instructor, and there is no course-wide mention, because announcements cover that.

## What Changes

- **Writing a mention.** Typing `@` in any Markdown body (post, answer, followup, or reply) suggests matching course members, plus **@staff**. Choosing one inserts a mention token, `[@Name](mention:<userId>)`, and typing `@staff` works as plain text.
- **Showing a mention.** Mentions render as highlighted names, not links.
- **Notifying.** Creating content notifies each newly mentioned member with a `mentioned` notification. Editing notifies only people who were not mentioned before. Mentions reach only current members who can read the post (so a private post never leaks to a mentioned classmate), never the author, and at most 20 people per write; a body with more than 20 individual mentions returns `422 too_many_mentions`. Someone who is both mentioned and a follower receives only the mention notification for that write.
- **Email.** Mentions follow the existing activity-email preference.

## Capabilities

### New Capabilities

- `mentions`: mention syntax, suggestions, rendering, and mention notifications.

### Modified Capabilities

None. The notifications capability gains the `mentioned` kind through `mentions`.

## Impact

- **Database:** migration `028_mentions.sql` adds the `mentioned` notification kind.
- **API:**
  - `GET /api/v1/courses/{courseId}/mention-suggestions?q=&postId=`;
  - mention parsing on post, answer, and followup creation and edits;
  - `recordActivity` mention recipients;
  - the error `too_many_mentions`.
- **Worker:** email wording for `mentioned`.
- **Web:** autocomplete in the shared Markdown editor, mention rendering in `PostBody`, and bell wording.
- **Docs:** `notifications.md` (including the suggestions endpoint), `posts.md`, `answers.md`, `openapi.yaml`, and `database.md`.
- **Coordination:** stacked on `add-followup-triage` (PR #68) for migration order.
