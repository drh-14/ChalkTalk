# Spec Delta

## ADDED Requirements

### Requirement: Members follow posts

A member SHALL automatically follow a post when they create it, create or edit an answer on it, or create a followup or reply on it, unless they have explicitly unfollowed that post. `PUT /api/v1/posts/{postId}/follow` SHALL follow and `DELETE /api/v1/posts/{postId}/follow` SHALL unfollow a post the caller can read, both returning `200` with `{ "following": true|false }`, requiring CSRF protection, and returning `404 not_found` for a post the caller cannot read. An explicit unfollow SHALL persist: later activity by that member SHALL not re-follow them automatically. Every active post projection SHALL include `following` for the viewer.

#### Scenario: A student follows their own question

- **WHEN** a student creates a question
- **THEN** the question reports `following: true` for them

#### Scenario: Unfollowing sticks

- **WHEN** a TA unfollows a question and later edits its staff answer
- **THEN** the TA still does not follow the question

### Requirement: Activity on followed posts notifies followers

These events SHALL create, in the same transaction, one notification for each follower of the post other than the actor who is a current course member with an account that is not deleted:

- `answer_created` and `answer_edited`, for a student or staff answer;
- `answer_endorsed`;
- `followup_created`;
- `reply_created`.

Creating an announcement SHALL create an `announcement` notification for every other current course member. A notification SHALL record its kind, course, post, actor, whether the actor was anonymous, and its creation and read times.

#### Scenario: A TA answers a student's question

- **WHEN** a TA creates the staff answer on a student's question
- **THEN** the student, who follows their question, receives one `answer_created` notification naming the TA

#### Scenario: The actor is not notified

- **WHEN** a student replies to a followup on their own question
- **THEN** the student receives no notification for their own reply

### Requirement: Members read and clear notifications

`GET /api/v1/users/me/notifications` SHALL list the caller's notifications newest first, across courses, with `limit` (1–100, default 25), `cursor`, and `unread=true`. Each item SHALL include `id`, `kind`, `courseId`, `courseName`, `postId`, `postTitle`, `actor` (`{ displayName }`, `{ displayName: "Anonymous" }` for an anonymous actor seen by a student, or `null` for a deleted account), `createdAt`, and `readAt`. Notifications SHALL be omitted when the caller is no longer a member of the course, or the post is deleted or a confirmed duplicate. `GET /api/v1/users/me/notifications/unread-count` SHALL return `{ "count": n }` under the same visibility rules. `POST /api/v1/users/me/notifications/read` SHALL mark the given `ids` (1–100 of the caller's own) or, with an empty body, all of the caller's notifications as read, and return `204`. Opening a post SHALL mark the caller's notifications for that post as read. All of these SHALL require authentication; writes SHALL require CSRF protection.

#### Scenario: A student checks the bell

- **WHEN** a student with two unread notifications opens the bell and chooses one
- **THEN** they land on that post, and the unread count drops to one

### Requirement: Notification emails are opt-in

The user profile SHALL include `notificationEmails`, default `false`, changeable through `PATCH /api/v1/users/me`. When a notification other than an announcement is created for a user with `notificationEmails: true`, a `send_notification_email` job SHALL be queued in the same transaction; announcements keep their own email to every member and SHALL not queue a second one. Before sending, the worker SHALL confirm that the notification still exists and is unread, that the recipient still has the setting on and is still a member of the course, and that the post is still visible; otherwise it SHALL send nothing. The email SHALL name the course, the actor (respecting anonymity), what happened, and the post title, link to the post, and say how to turn these emails off. The account page SHALL offer the setting.

#### Scenario: A student opts in

- **WHEN** a student turns on activity emails and a TA answers their question
- **THEN** the student receives one email linking to the question

#### Scenario: The notification was already read

- **WHEN** the student opens the question before the worker sends the email
- **THEN** no email is sent

### Requirement: The feed shows unread posts

An active post SHALL be `unread` for a member when its last activity is later than both the time they last opened it and the course's read mark for them, or when neither exists. Opening a post SHALL record it as read for the caller. A member's own post creation, answer, edit, endorsement, followup, or reply SHALL record the post as read for them. `POST /api/v1/courses/{courseId}/read-marks` SHALL mark every post in the course read for the caller as of now and return `204`. Every active post projection SHALL include `unread`. The feed SHALL show unread posts with a marker and offer **Mark all read**.

#### Scenario: A new answer makes a question unread

- **WHEN** a TA answers a question a student opened yesterday
- **THEN** the question is unread for the student until they open it again, and it is not unread for the TA

### Requirement: The bell is always reachable

The app bar SHALL show a notifications button with the unread count, labeled for assistive technology (for example "Notifications, 2 unread"). It SHALL refresh the count at least every 60 seconds while the page is visible and when the window regains focus. It SHALL open a panel listing the newest notifications, with **Mark all read**, in which choosing an item navigates to its post. The post detail SHALL show **Follow** or **Following**.

#### Scenario: A TA follows a question

- **WHEN** a TA chooses **Follow** on a student's question
- **THEN** the button shows **Following**, and the TA is notified of later activity on it

### Requirement: Tests cover notifications

API tests SHALL cover following (automatic, manual, a sticky unfollow, and visibility), notification fan-out for each event kind (actor excluded, non-members and deleted accounts excluded), anonymity in the actor projection, listing, unread filtering, counts, marking read, opening a post marking it read, unread state and read marks, the email preference, and queued email jobs. Worker tests SHALL cover the email content and each skip condition. Component tests SHALL cover the bell, panel, Follow button, unread markers, and the account setting. A browser test SHALL show a student seeing a TA's answer in the bell and the feed, and opening it.

#### Scenario: An anonymous answer leaks its author

- **WHEN** a change shows a student the name behind an anonymous answer in a notification
- **THEN** an automated test fails
