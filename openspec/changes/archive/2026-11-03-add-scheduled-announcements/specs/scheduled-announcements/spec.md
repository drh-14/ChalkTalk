# Spec Delta

## ADDED Requirements

### Requirement: Staff schedule announcements

Creating an announcement SHALL accept `scheduledFor`, an ISO 8601 date-time from 1 minute to 365 days after the request. Outside that range it SHALL return `422 schedule_invalid`, and `scheduledFor` on anything other than an announcement SHALL also return `422 schedule_invalid`. A scheduled announcement SHALL be created pinned. It SHALL send no notification, announcement email, or digest entry until it publishes. Every active post projection SHALL include `scheduledFor`, which is `null` once published or when never scheduled.

#### Scenario: An instructor schedules exam logistics

- **WHEN** an instructor creates an announcement with `scheduledFor` set to tomorrow at 8:00
- **THEN** it is saved with that `scheduledFor`, and no member is notified or emailed

### Requirement: Scheduled announcements are hidden from students

A scheduled announcement SHALL be readable only by the course's current TAs and instructors. To every other member it SHALL behave exactly like a post that does not exist, under the same rules as private posts: `404 not_found`, and absent from lists, search, notifications, and the digest.

#### Scenario: A student cannot see it early

- **WHEN** a student lists posts while an announcement is scheduled
- **THEN** it is not listed, and requesting it by ID returns `404 not_found`

### Requirement: The worker publishes on time

At the scheduled time, the job worker SHALL publish the announcement if it is still scheduled for that time, is not deleted, and its course is active. Publishing SHALL:

- clear `scheduledFor`;
- set its creation and last-activity times to the publish time;
- notify and email every other current member exactly as an immediate announcement does.

If the course is not active, the announcement SHALL remain scheduled.

#### Scenario: The announcement goes out

- **WHEN** the scheduled time passes
- **THEN** students can read the announcement, it is pinned at the top of their feed, and each member receives the announcement notification and email

### Requirement: Staff can change a scheduled announcement

Staff SHALL be able to update a scheduled announcement with `PATCH /api/v1/posts/{postId}` under the usual revision check:

- edit its fields;
- set `scheduledFor` to a new valid time to reschedule;
- set `scheduledFor: null` to publish it immediately.

Rescheduling SHALL cancel the earlier time. Deleting SHALL cancel publishing. `scheduledFor` on a post that is not scheduled SHALL return `422 not_scheduled`.

#### Scenario: A TA publishes early

- **WHEN** a TA sets `scheduledFor: null` on a scheduled announcement
- **THEN** it publishes immediately, and the worker does not publish it again at the old time

### Requirement: The interface shows schedules

The composer SHALL offer **Publish now** (the default) or **Publish later**, with a date and time, whenever **Post as announcement** is chosen. Scheduled announcements SHALL show a **Scheduled** badge in the feed and a notice with the local publish time on the post, with **Publish now** and **Reschedule**.

#### Scenario: Staff review what is queued

- **WHEN** a TA opens the feed
- **THEN** scheduled announcements appear with a **Scheduled** badge and their time

### Requirement: Tests cover scheduled announcements

API tests SHALL cover:

- validation, and visibility by role;
- the absence of notifications and emails before publishing;
- rescheduling, publishing immediately, deleting, and `not_scheduled`.

Worker tests SHALL cover on-time publishing with its notifications and emails, and the skip cases: stale time, deleted, and inactive course. Component tests SHALL cover the composer choice, the badge, and the notice. A browser test SHALL show an instructor scheduling an announcement, a student not seeing it, and the announcement appearing after it publishes.

#### Scenario: A scheduled announcement leaks

- **WHEN** a change lets a student read a scheduled announcement before it publishes
- **THEN** an automated test fails
