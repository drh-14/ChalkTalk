# Proposal

## Why

Every ChalkTalk post is visible to the whole course. Students who need to ask about a grade, an extension, or their own graded code have nowhere to do it, so they email staff or go back to Piazza, where "Instructors" posts are among the most used features. Private posts close the biggest remaining gap with Piazza.

The user decided:

- a private post is visible to its author and every TA and instructor in the course;
- staff can later make a private post public, for example when it is a common question. This notifies the author and keeps the post's anonymity setting.

## What Changes

- **Posting privately.** The composer offers **Post to: Entire class** or **Instructors and TAs** for questions and notes. Any member can post privately. Announcements and polls cannot be private, because both are addressed to the whole class.
- **Who sees it.** Only the author and the course's current TAs and instructors can read a private post, its answers, followups, replies, attachments, and live sessions. Everyone else gets `404 not_found`, exactly as for a post that does not exist. It never appears in their feed, search, related questions, digest, or notifications.
- **Making it public.** The author or any staff member can make a private post public. A public post cannot be made private again, since classmates may already have read it. When staff make it public, the author is notified, and is emailed if they opted in to activity emails.
- **In the feed.** Private posts carry a **Private** badge, the post detail says "Only you and course staff can see this", and a **Private** filter lists them. Students see only their own private posts there; staff see all of them.
- **Duplicates.** A post cannot be merged into a private post, because the source's readers could not follow the redirect. A private post can be merged into a public one.
- **Live sessions.** A session on a private post can invite only people who can read the post: the author and staff.

## Capabilities

### New Capabilities

- `private-posts`: creating private posts, who can read them and everything attached to them, making them public, and how they appear in the feed.

### Modified Capabilities

None. Each read path enforces the new visibility rule defined in `private-posts`.

## Impact

- **Database:** migration `026_private_posts.sql` adds:
  - `posts.private` (boolean, default false), with a check that announcements and polls are never private;
  - the `post_published` notification kind.
- **API:**
  - a `private` field on create, update (only `false` is accepted, to publish), and projections, plus a `private=true` list filter;
  - one shared visibility rule applied in the posts, answers, followups, content-attachments, collaboration (service and WebSocket server), notifications, digest, and job worker queries;
  - new errors `private_announcement`, `private_poll`, `post_already_public` (when trying to make a public post private), `duplicate_target_private`, and `invitee_cannot_read_post`.
- **Web:** the composer's audience choice, the Private badge, filter and detail notice, and the **Make public** button.
- **Docs:** `posts.md`, `notifications.md`, `collaboration-sessions.md`, `identity-visibility.md`, `openapi.yaml`, and `database.md`.
- **Coordination:** stacked on `add-notifications` (PR #66), for the `post_published` notification.
