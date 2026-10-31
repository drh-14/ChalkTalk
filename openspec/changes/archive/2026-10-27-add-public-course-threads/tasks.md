## 1. Contracts and test seams

- [x] 1.1 Document Thread REST, WebSocket, notification, and database contracts in `documentation/api/`, `documentation/openapi.yaml`, and `documentation/database.md`; verify OpenAPI and documentation checks pass.
- [x] 1.2 Add failing PostgreSQL/HTTP tests for staff board lifecycle, membership hiding, archived-course rejection, atomic conversation creation, role-snapshot moderation, optimistic conflict, and tombstones; run them and record expected failures.
- [x] 1.3 Add failing tests for watch/unfollow/read counts, reply notices, catch-up ordering, attachment access/cleanup, and course deletion; run them and record expected failures.
- [x] 1.4 Add failing WebSocket tests for authentication, subscription revocation, durable reconnect catch-up, and conversation-local typing with expiry; run them and record expected failures.
- [x] 1.5 Add failing browser tests for Threads navigation, board/conversation flows, unread badges, bell reply notice, attachment recovery, and live typing; run them in Playwright with mocked API and record expected failures.

## 2. Durable backend

- [x] 2.1 Add migration `053_public_course_threads.sql` with course-owned boards, conversations, messages, author-role snapshots, watches, precise read records, attachments, committed change ledger, and cleanup constraints; verify migration/invariant tests pass on disposable PostgreSQL.
- [x] 2.2 Implement board and conversation/message service and authenticated REST routes with pagination, idempotency, ETags, role rules, and archive behavior; verify 1.2 tests pass.
- [x] 2.3 Implement watches, mark-loaded-read, unread projections, and reply notifications in existing bell without email; verify 1.3 watch/notification tests pass.
- [x] 2.4 Implement validated message attachment upload/download/removal, immediate hiding, worker cleanup, and course-deletion integration; verify 1.3 file/lifecycle tests pass.
- [x] 2.5 Implement transactionally ordered change ledger and bounded REST catch-up; verify 1.3 concurrent/reconnect tests pass.

## 3. Live transport and browser

- [x] 3.1 Attach authenticated API-owned WebSocket server with PostgreSQL LISTEN/NOTIFY invalidations, membership rechecks, reconnect contract, and ephemeral conversation-view typing relay; verify 1.4 tests pass.
- [x] 3.2 Add Threads navigation, board/conversation page, message composer, edit/delete controls, attachment queue, and accessible loading/error/confirmation states; verify 1.5 browser tests pass.
- [x] 3.3 Wire live invalidations to REST catch-up, unread recount, bell notices, and reply typing indicator with disconnect/manual-refresh behavior; verify 1.5 browser tests pass including multi-client live scenarios.
- [x] 3.4 Capture and inspect a screenshot for every tested user-visible Threads scenario; verify files exist for draft PR attachment.

## 4. Delivery

- [x] 4.1 Run focused tests, full typecheck/build, lint/format, OpenSpec strict validation, and browser suite; verify all pass and archive the OpenSpec change.
