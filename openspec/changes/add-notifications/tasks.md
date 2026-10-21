# Tasks

## 1. Schema and activity

- [x] 1.1 Add migration `025_notifications.sql` (design D1) and document it in `database.md`; verify schema tests for keys, kind check, and cascades
- [x] 1.2 Add `recordActivity` (design D2) and call it from post, answer, endorsement, followup, and reply writes; verify HTTP tests for automatic following, the sticky unfollow, fan-out per kind, actor exclusion, non-member and deleted-account exclusion, announcements to all members, and queued email jobs only for opted-in recipients

## 2. API

- [x] 2.1 Follow routes and `following`/`unread` on post projections, opening a post marking it read, and read marks (design D3); verify HTTP tests for each, including visibility and CSRF
- [x] 2.2 `NotificationService` and routes (design D4); verify HTTP tests for listing, anonymity by viewer role, deleted actors, visibility filtering, pagination, `unread=true`, counts, marking read by ids and all, and authentication
- [x] 2.3 `notificationEmails` on the profile; verify auth HTTP tests for reading and updating it
- [x] 2.4 The `send_notification_email` worker handler (design D5) and metrics label; verify worker tests for content per kind, anonymity, and each skip condition
- [x] 2.5 Write `documentation/api/notifications.md`, and update `posts.md`, `auth.md`, `openapi.yaml`, and `database.md`; verify the YAML parses and references resolve

## 3. Web

- [x] 3.1 Notifications client and `NotificationBell` with panel (design D6); verify component tests for the count label, polling and focus refresh, the list, choosing an item, and Mark all read
- [x] 3.2 Follow toggle, unread markers, and feed Mark all read; verify component tests
- [x] 3.3 Account page email setting; verify a component test

## 4. Checks

- [x] 4.1 Browser test against the running stack: a TA answers a student's question; the student sees the bell count, opens the notification, lands on the question, and the feed marker clears; capture screenshots
- [x] 4.2 Run format, lint, typecheck, the test suite with `TEST_DATABASE_URL`, and build; record environment-only failures with evidence
- [ ] 4.3 Archive after merge
