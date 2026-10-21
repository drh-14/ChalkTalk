# Design

## Context

- **Activity time.** Answer creation, edits, endorsements, and followup and reply creation each update `posts.last_activity_at` inside their service transaction. Post creation sets it too.
- **Views.** `PostService.get` already records a daily `post_view_events` row for the viewer.
- **Emails.** The worker already sends job-queued emails that are rechecked before sending (duplicate, invitation, announcement).
- **Preferences.** There are no notification preferences today.

## Decisions

### D1. Schema (migration 025)

- `post_follows (post_id, course_id, user_id, following boolean, created_at, updated_at)`, primary key `(post_id, user_id)`, foreign keys to the post and to the course membership (cascading, so leaving a course drops follows). An explicit unfollow is a row with `following=false`, which automatic follows never overwrite.
- `notifications (id uuid_v7, user_id, course_id, post_id, kind, actor_user_id null, actor_anonymous boolean, created_at, read_at null)`.
  - `kind` is checked against `answer_created`, `answer_edited`, `answer_endorsed`, `followup_created`, `reply_created`, `announcement`.
  - Index `(user_id, created_at DESC, id DESC)` and partial `(user_id) WHERE read_at IS NULL`.
  - Foreign key to the post with cascade.
- `post_reads (post_id, user_id, read_at)`, primary key `(post_id, user_id)`, cascading with the post.
- `course_read_marks (course_id, user_id, read_before)`, primary key `(course_id, user_id)`, cascading with the membership.
- `users.notification_emails boolean NOT NULL DEFAULT false`.

### D2. `recordActivity`

`apps/api/src/notifications/activity.ts` exports `recordActivity(db, { courseId, postId, actorId, kind, anonymous, follow })`. Each service calls it in the same transaction as the change. It:

1. if `follow`, inserts `post_follows (…, following=true)` `ON CONFLICT DO NOTHING`;
2. upserts `post_reads` for the actor at `now()`, so their own activity leaves the post read;
3. inserts one notification per recipient with `INSERT … SELECT` from `post_follows` joined to current memberships and non-deleted users, excluding the actor (for `announcement`, from all course memberships instead);
4. inserts a `send_notification_email` job for each new notification whose recipient has `notification_emails`, with deduplication key `<notificationId>`.

Call sites:

| Event | Kind | Follows the actor |
|---|---|---|
| Post creation | none (`announcement` for announcements) | yes |
| Answer creation | `answer_created` | yes |
| Answer edit | `answer_edited` | yes |
| Endorsement | `answer_endorsed` | no (staff often endorse without wanting updates) |
| Followup | `followup_created` | yes |
| Reply | `reply_created` | yes |

`anonymous` comes from the answer, followup, or reply being anonymous.

### D3. Reads and unread

- **Projection.** `PostService.project` adds `following` and `unread` from one query per post. It reads `post_follows`, `post_reads`, and `course_read_marks` for the viewer and compares them with `last_activity_at`.
- **Opening a post.** `PostService.get`, for an active post, upserts `post_reads` and sets `read_at=now()` on the viewer's unread notifications for that post. Like the view event, a failure is logged without failing the read.
- **Mark all read.** `POST /courses/{id}/read-marks` upserts `course_read_marks.read_before=now()` for a current member.

### D4. Notification API

`NotificationService` in `apps/api/src/notifications/service.ts` provides `list`, `unreadCount`, and `markRead`.

- **Visibility.** Lists join the post (not deleted, not a confirmed duplicate), the course (for its name), and the caller's current membership.
- **Actor.** A notification whose actor was anonymous shows `Anonymous` unless the caller is staff in that course; a deleted actor gives `null`.
- **Cursor.** `(created_at, id)`, bound to the user and filter, as in other lists.
- **Routes.** They sit under `/api/v1/users/me/notifications`; following sits under `/api/v1/posts/{postId}/follow`.

### D5. Emails

Announcements queue no notification email, because every member already gets the announcement email.

The worker's `send_notification_email` handler loads the notification with its post, course, actor, and recipient, and requires:

- `read_at IS NULL`;
- the recipient still has `notification_emails`, is still a member, and is not deleted;
- the post is visible.

It then sends:

- **Subject:** `[<course>] <phrase> "<title>"`. The phrase is one of `New answer on`, `Answer updated on`, `Answer endorsed on`, `New followup on`, or `New reply on`.
- **Text:** `<actor> <verb> "<title>" in <course>.`, then the post URL, then `To stop these emails, turn off "Email me about activity on posts I follow" in your account settings.`

The actor is "Someone" when anonymous, since the email can't tell whether the reader is staff.

### D6. Web

- **`NotificationBell`** in the app bar for signed-in pages:
  - shows the count from `unread-count`, polled every 60 seconds while visible and on window focus;
  - its button opens a panel with the latest 20 notifications and **Mark all read**;
  - choosing an item marks it read and navigates to the post.
- **Post detail:** a **Follow**/**Following** toggle near the title.
- **Feed:** cards with `unread` get a dot and a bold title, and the list header offers **Mark all read** (read-marks), which refetches the feed.
- **Account page:** a checkbox for `notificationEmails`.

## Risks / Trade-offs

- [Fan-out on a busy question writes many rows in the request] → Followers are usually few; announcements are bounded by course size and already queue one email job per member.
- [A per-post unread query in lists] → It uses primary-key lookups; a page has at most 100 posts.
- [Notifications for long-gone posts accumulate] → Lists filter them, and they cascade away with the post.

## Migration Plan

Deploy migration 025 (new tables and a defaulted column), then the API, worker, and web together. Existing posts start unread for everyone, which matches a first visit; **Mark all read** clears them.
