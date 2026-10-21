# Tasks

## 1. Schema and visibility

- [x] 1.1 Migration `029_scheduled_announcements.sql` (design D1), documented in `database.md`; verify a schema test for the announcement check
- [x] 1.2 Scheduled posts hidden by `readablePost`/`canReadPost` and the digest (design D2); verify visibility unit tests and a digest test

## 2. API and worker

- [x] 2.1 `announce` and `publish` helpers, scheduling on create, and `scheduledFor` on projections (design D3–D5); verify HTTP tests for validation, staff-only reading, and no notifications or emails before publishing
- [x] 2.2 Rescheduling, publishing immediately, deleting, and `not_scheduled`; verify HTTP tests, including that a stale job does not publish twice
- [x] 2.3 The `publish_scheduled_announcement` worker handler; verify worker tests for on-time publishing, notifications and emails, and the stale, deleted, and inactive-course skips
- [x] 2.4 Update `posts.md`, `identity-visibility.md`, `openapi.yaml`, and `database.md`; verify the YAML parses and references resolve

## 3. Web

- [x] 3.1 Composer **Publish now/later** with the local date and time (design D6); verify component tests for the request body
- [x] 3.2 The **Scheduled** badge, plus the detail notice with **Publish now** and **Reschedule**; verify component tests

## 4. Checks

- [x] 4.1 Browser test against the running stack: an instructor schedules an announcement a minute ahead; a student cannot find it; after it publishes, the student sees it pinned and has the notification. Capture screenshots
- [x] 4.2 Run format, lint, typecheck, the test suite with `TEST_DATABASE_URL`, and build; record environment-only failures with evidence
- [ ] 4.3 Archive after merge
