# Proposal

## Why

ChalkTalk tells people almost nothing as it happens. The only messages are a daily digest email and a few one-off emails (duplicate notices, session invitations, announcements). A student whose question gets answered learns it only by checking. The course feed also gives no sense of what changed since a member's last visit. Both are core to Piazza, and both are missing.

The user decided:

- members follow posts they create, answer, or follow up on, and any post has a Follow button;
- notifications appear in an in-app bell, with optional email that is off by default;
- the feed marks posts with unread activity.

## What Changes

- **Following.** Members automatically follow a post when they create it, contribute to an answer, or post a followup or reply. Any post shows **Follow** or **Following**. An explicit unfollow sticks: later activity by the same member does not re-follow them.
- **Notifications.** Activity on a followed post creates a notification for each other follower who can still see the post: a new or edited answer, an endorsement, a new followup, or a reply. An announcement notifies every course member. Notifications show who acted, unless the actor posted anonymously, in which case students see "Anonymous".
- **Bell.** The app bar shows a bell with the unread count, refreshed every minute and when the window regains focus. It opens a panel listing recent notifications across courses, with **Mark all read**. Opening a notification goes to the post and marks it read, and opening a post marks its notifications read.
- **Email (opt-in).** A new account setting, **Email me about activity on posts I follow** (off by default), emails each notification through the job worker.
- **Unread in the feed.** A post is unread for a member when it has activity after they last opened it, or they have never opened it. The feed marks unread posts with a dot and a bold title, and **Mark all read** clears a course. A member's own activity never makes a post unread for them.

## Capabilities

### New Capabilities

- `notifications`: following, notifications, the unread state of posts, and notification emails.

### Modified Capabilities

None; post projections gain `following` and `unread`, defined in the new capability.

## Impact

- **Database:** migration `025_notifications.sql` adds:
  - `post_follows`, `notifications`, `post_reads`, and `course_read_marks`;
  - `users.notification_emails`;
  - the `send_notification_email` job kind.
- **API:**
  - a shared `recordActivity` called from post, answer, endorsement, and followup writes;
  - `PUT` and `DELETE /api/v1/posts/{postId}/follow`;
  - `GET /api/v1/users/me/notifications`, `GET …/notifications/unread-count`, and `POST …/notifications/read`;
  - `POST /api/v1/courses/{courseId}/read-marks`;
  - `notificationEmails` on the user profile;
  - `following` and `unread` on post projections.
- **Worker:** the notification email handler.
- **Web:** the bell and panel in the app bar, the Follow button, unread markers and **Mark all read** in the feed, and the account setting.
- **Docs:** a new `documentation/api/notifications.md`, plus updates to `posts.md`, `auth.md` (profile), `openapi.yaml`, and `database.md`.
- **Coordination:** stacked on `add-polls-and-announcements` (PR #65), for announcement notifications.
