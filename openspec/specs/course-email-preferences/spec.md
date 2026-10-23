# course-email-preferences Specification

## Purpose

Let each member independently control activity, announcement, and daily-digest emails for each course without changing in-app notifications.

## Requirements

### Requirement: Each member controls three independent email categories per course

Each course membership SHALL have independent boolean preferences `activityEmails`, `announcementEmails`, and `digestEmails`. An existing membership SHALL preserve the user's former global `notification_emails` choice for activity and start with announcements and digest enabled. A new membership SHALL start with activity disabled and announcements and digest enabled. The in-app notification stream SHALL not change.

#### Scenario: Migration preserves activity choice

- **WHEN** a user with activity emails enabled belongs to two courses during migration
- **THEN** both memberships have activity emails enabled, and their announcement and digest emails enabled

#### Scenario: Independent course settings

- **WHEN** a member turns announcement emails off in one course
- **THEN** announcement emails in another course and both other categories remain unchanged

### Requirement: Members can read and update their own preferences

An authenticated current member SHALL be able to GET and PATCH only their own preferences through `/api/v1/courses/{courseId}/members/me/email-preferences`. PATCH SHALL accept one or more of the three boolean fields, reject unknown or invalid fields with `422 validation_failed`, require CSRF and an `If-Match` ETag, and return an updated ETag. Concurrent updates with stale ETags SHALL return `412 version_conflict`; missing `If-Match` SHALL return `428 precondition_required`. Nonmembers SHALL get `404 not_found`.

#### Scenario: Patch one choice

- **WHEN** a member PATCHes `{ "digestEmails": false }` with the current ETag
- **THEN** only digest preference changes and the response has the next ETag

### Requirement: Email delivery honors the latest preference

Activity jobs SHALL be queued only when activity emails are enabled. Announcement jobs SHALL be queued only when announcement emails are enabled. Digest outbox rows SHALL be scheduled only when digest emails are enabled. Delivery SHALL recheck membership and the corresponding preference immediately before sending; an opt-out completed before that final check SHALL suppress the queued email. An activity or announcement email already in flight MAY finish after opt-out, and its SMTP delivery SHALL NOT block the preference update. Disabling email SHALL not erase in-app notifications or affect already-sent email.

#### Scenario: Opt out after queueing

- **WHEN** a queued announcement, activity email, or digest is due after its recipient turns that category off
- **THEN** the email is not sent

### Requirement: Course settings expose the controls

Every current member SHALL see three labeled email switches in course settings with visible save and error feedback. A failed or conflicting update SHALL not misrepresent the persisted choice. Account Settings SHALL list every enrolled course with three independent labeled switches and accessible save, error, and conflict feedback; it SHALL no longer offer a global activity-email toggle.

#### Scenario: Save one preference

- **WHEN** a member changes the digest switch
- **THEN** only that course's digest preference is saved and feedback is announced accessibly

#### Scenario: Account settings spans course pages

- **WHEN** a member belongs to more courses than one course-list page contains
- **THEN** Account Settings shows preference controls for every course, and changing one category leaves other courses and categories unchanged

#### Scenario: Account settings resolves a conflict

- **WHEN** an account-page preference update conflicts with a newer membership version
- **THEN** current preferences are refreshed and the conflict is announced without showing the attempted choice as saved
