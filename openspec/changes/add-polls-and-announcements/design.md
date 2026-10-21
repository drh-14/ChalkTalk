# Design

## Context

- **Existing contract.** The posts API reference already documents poll creation (`options`, 2–10 labels), the poll projection (`options[]`, `voteCount`, `selected`, `totalVotes`), and `PUT`/`DELETE /posts/{id}/vote` with `not_a_poll`, `poll_option_invalid`, and `poll_closed`, marked as future targets. `database.md` describes `poll_options` and `poll_votes`. The `text-posts` spec currently requires rejecting polls.
- **Post types.** `posts.type` is constrained to `question` and `note`. Answers and followups already reject anything that is not a question.
- **Emails.** The duplicate-post email and the invitation email already use the jobs table, with a recheck in the worker.

## Decisions

### D1. Schema

Migration 024:

- relaxes the `posts.type` check to include `poll`;
- adds `posts.announcement boolean NOT NULL DEFAULT false` with `CHECK (NOT announcement OR (type='note' AND NOT anonymous))`;
- creates `poll_options` (`id`, `course_id`, `post_id`, `position`, `label`; unique `(post_id, position)` and `(course_id, post_id, id)`) and `poll_votes` (primary key `(post_id, user_id)`; foreign key `(course_id, post_id, option_id)` to `poll_options`), as documented;
- deletes options and votes with their post.

Course deletion already removes posts; the worker's course deletion deletes votes and options before posts.

### D2. Poll creation and projection

`postCreateBody` accepts `options` only for polls and `announcement` only for notes, validating as in the spec. `PostService.create`:

- checks the member role for polls and announcements;
- inserts options in order;
- pins announcements.

`project` adds, for polls, one query aggregating `count(*)` per option and the viewer's option, and adds `announcement` for every post. The list reuses `project`, so list items carry the same fields. The list query accepts `type=poll` and `announcement=true`.

### D3. Voting

`PostService.vote(postId, userId, optionId)` runs in a transaction:

1. lock the post row;
2. check membership and that the post is active (otherwise `404`) and a poll (otherwise `422 not_a_poll`);
3. check the course is active (otherwise `409 poll_closed`);
4. check the option belongs to the poll (otherwise `422 poll_option_invalid`);
5. `INSERT … ON CONFLICT (post_id,user_id) DO UPDATE SET option_id, updated_at`;
6. return the poll state.

`unvote` deletes the caller's row; it also requires membership and a poll, but not an active course, since retracting changes nothing visible to others. Neither changes the post's `version` or `last_activity_at`: votes are not edits.

### D4. Announcement emails

In the creating transaction, after the insert, one `jobs` row of kind `send_announcement_email` is inserted per recipient, with payload `{ postId, userId }` and deduplication key `<postId>:<userId>`. Recipients are every member of the course except the author, whose user is not deleted.

The worker rechecks that the post exists, is not deleted, is an announcement, and its course is active, and that the recipient is still a member and not deleted. It then sends:

- **Subject:** `[<course>] <title>`.
- **Text:** `<author> posted an announcement in <course>:` then the title, then the body truncated to 2,000 characters with `…` if cut, then the post URL.

The job kind joins the worker's claim list and metrics labels.

*Alternative:* one fan-out job could send every email. Per-recipient jobs reuse the existing retry and dead-letter handling, so one bad address cannot block the rest.

### D5. Web

- **Composer.** Staff get a third type, **Poll**, with an options editor that starts with two inputs, has add and remove buttons, and limits 2–10 entries of 200 characters. On a note, staff get **Post as announcement (pinned and emailed to the class)**, which disables the anonymous toggle.
- **Poll view (`PollCard`).** Members see one radio per option and **Vote**. Once they have voted, each option shows a bar with its count and percentage, their choice is marked, and **Change vote** and **Retract** are offered. In archived courses it is results only.
- **Feed.** Cards show the badge or a compact results summary (options and total).
- **Filter.** The feed's **Show** group gains **Announcements** (`announcement=true`) and **Polls** (`type=poll`).

## Risks / Trade-offs

- [A large course queues hundreds of jobs at once] → The worker drains them in order; each is small.
- [Per-option count queries on every projected poll] → At most 10 options, aggregated in one query per poll.

## Migration Plan

Deploy migration 024, which adds and relaxes constraints and creates tables, then the API, worker, and web together.
