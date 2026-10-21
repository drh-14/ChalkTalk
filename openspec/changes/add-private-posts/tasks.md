# Tasks

## 1. Schema and the visibility rule

- [x] 1.1 Add migration `026_private_posts.sql` (design D1) and document `posts.private` and the `post_published` kind in `database.md`; verify schema tests for the default, the announcement/poll check, and the new kind
- [x] 1.2 Add `apps/api/src/posts/visibility.ts` with `readablePost` and `canReadPost` (design D2); verify unit tests for author, student, TA, and instructor on public and private rows

## 2. Posts API

- [x] 2.1 Create, project, and get with `private` (design D3), including `private_announcement` and `private_poll`; verify HTTP tests for each role reading a private post and for the rejected combinations
- [x] 2.2 Lists, search, related questions, and the `private=true` filter (design D4); verify HTTP tests that classmates never see a private post, staff and the author do, and invalid filter values return `400`
- [x] 2.3 Making a post public, `post_already_public`, `duplicate_target_private`, and `vote`/`setFollowing`/`delete` returning `404` for classmates; verify HTTP tests, including the version bump, the kept anonymity, and `last_activity_at`
- [x] 2.4 Update `documentation/api/posts.md`, `identity-visibility.md`, and `openapi.yaml` for the field, the filter, and the errors; verify the YAML parses and references resolve

## 3. Content around a post

- [x] 3.1 Answers, endorsements, followups, replies, and upvotes use `canReadPost`; verify HTTP tests that a classmate gets `404` on each, and the author and staff succeed
- [x] 3.2 Attachments on a private post and on its answers and followups; verify HTTP tests for upload, download, and listing by role
- [x] 3.3 Live sessions: anchoring, reading, listing, tickets, the WebSocket server check, and `invitee_cannot_read_post`; update `collaboration-sessions.md`; verify HTTP and server integration tests

## 4. Notifications, digest, and worker

- [x] 4.1 `recordActivity` recipients and `NotificationService` listing use `readablePost`; publishing by staff notifies the author with `post_published` (design D3); update `notifications.md`; verify HTTP tests for fan-out, listing, counts, and the publish notification
- [x] 4.2 Digest queries exclude private posts and their answers and followups (design D5); verify digest integration tests
- [x] 4.3 The worker's notification, announcement, and duplicate emails recheck visibility, and the `post_published` email wording; verify worker tests

## 5. Web

- [x] 5.1 Posts client `private` field, filter, and publish call; verify client tests
- [x] 5.2 Composer **Post to** choice, which disables the announcement option (design D6); verify component tests for the request body and the disabled checkbox
- [x] 5.3 Feed badge, **Private** filter, detail notice, and **Make public** with confirmation; bell wording for `post_published`; verify component tests

## 6. Checks

- [x] 6.1 Browser test against the running stack: a student posts privately; a classmate cannot find it in the feed or search; a TA sees it, answers it, and makes it public; the classmate then finds it, still anonymous if it was; the student gets the bell notification. Capture screenshots
- [x] 6.2 Run format, lint, typecheck, the test suite with `TEST_DATABASE_URL`, and build; record environment-only failures with evidence
- [ ] 6.3 Archive after merge
