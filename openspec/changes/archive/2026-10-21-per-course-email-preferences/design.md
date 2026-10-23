# Design

## Data and API

Add three non-null boolean columns to `course_memberships`; `activity_emails` is backfilled from `users.notification_emails` after column creation, while new rows use false. Other columns default true. Keep `users.notification_emails` as a legacy migration source but remove its user-facing control. Introduce a self-only preferences resource rather than expose private settings in the course member roster. Its ETag uses the membership's version, and PATCH increments that version.

## Delivery

Filter job/outbox creation by the corresponding membership column to avoid unnecessary work; recheck it at send time, because queueing and delivery are separated. Preserve existing course and content visibility checks. Digest delivery retains its existing membership share lock through SMTP sending. Activity and announcement delivery do not hold a membership lock through SMTP: an already in-flight email can finish after opt-out, while settings updates remain unblocked. They retain their claimed job row lock until completion to avoid duplicate sends from an expired claim.

## UI

Use the existing course settings page and an Account Settings list that traverses all course pages. Both surfaces use the CSRF token, optimistic version/ETag pattern, and error styles. Keep account-wide profile field in the database for compatibility only; the new resource is authoritative for delivery.

## Risks

Old clients that write the legacy profile field will no longer affect delivery; remove the setting from current account UI and update API docs. Jobs queued before migration are safe because send-time gates consult memberships.
