# Proposal

## Why

Activity email is currently one account-wide switch, while announcements and daily digests are emailed to every eligible member. Members need independent per-course control without changing in-app notifications.

## What Changes

- Add three independent membership preferences: activity, announcement, and daily-digest emails.
- Backfill activity from each existing user's `notification_emails`; initialize existing announcement and digest preferences to enabled. New memberships default to activity off, announcement on, digest on.
- Provide a self-service preferences API and controls in course settings; remove the account-wide activity-email control.
- Check the relevant preference when enqueueing and again immediately before sending, so queued mail respects subsequent opt-out.
- Preserve existing notification, announcement, and digest content and in-app behavior.

## Capabilities

### New Capabilities

- `course-email-preferences`: member-scoped email delivery choices.

## Impact

- Migration `040_course_notification_preferences.sql` extends course memberships.
- API adds self preference read/update; worker and digest delivery gate on current preferences.
- Course settings UI and API/database docs change. Existing notification/digest infrastructure remains.
