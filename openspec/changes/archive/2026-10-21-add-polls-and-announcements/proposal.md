# Proposal

## Why

ChalkTalk's design gives staff two kinds of post that Piazza users expect, and neither exists yet:

- **Polls.** The posts API reference already specifies them as future targets: creation, results, and vote routes.
- **Announcements.** The design overview opens with them ("Instructors post announcements"), but there is no contract.

The user decided that both instructors and TAs can post announcements, and that an announcement is pinned and emailed to every course member.

## What Changes

- **Polls.** TAs and instructors can create a poll: a title, a Markdown body, and 2 to 10 options. Any member can vote for one option, change their vote, or retract it, and everyone sees the counts. Votes are closed in archived courses. Options cannot be changed after creation. Polls take no answers or followups, like notes. The feed's type filter accepts `poll`.
- **Announcements.** TAs and instructors can mark a new note as an announcement. Announcements:
  - are pinned;
  - show an **Announcement** badge;
  - cannot be anonymous;
  - are emailed to every other course member through the job worker, which skips recipients who have left and announcements that were deleted before sending.

  A new list filter, `announcement=true`, finds them.
- **Web.**
  - The composer offers **Poll** to staff, with an options editor, and an **Announcement** checkbox on staff notes.
  - Polls render with voting and live counts in the feed card and the post detail.
  - Announcements get a badge in both places.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `text-posts`: poll posts, voting, and announcements replace the requirement that rejected polls.

## Impact

- **Database:** migration `024_polls_and_announcements.sql`:
  - adds `poll` to `posts.type`;
  - adds `posts.announcement`;
  - creates `poll_options` and `poll_votes` as already described in `database.md`.
- **API:**
  - poll creation and projection in `PostService`;
  - `PUT` and `DELETE /api/v1/posts/{postId}/vote`;
  - the `announcement` field and filter;
  - a `send_announcement_email` job kind and its worker handler.
- **Web:** the post composer, feed cards, post detail, and the posts client.
- **Docs:**
  - `posts.md` and `openapi.yaml` move polls from future targets to implemented and add announcements;
  - `database.md` adds the column and job kind;
  - `design.md` resolves "Create announcement" to TAs and instructors.
