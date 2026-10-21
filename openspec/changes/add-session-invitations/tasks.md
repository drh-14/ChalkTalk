# Tasks

## 1. Invitation email

- [x] 1.1 Queue `send_collaboration_invitation_email` in `invite` only for a new participant (design D1); verify HTTP integration tests that an invitation queues one job with the documented payload and key, a repeat invitation queues none, and re-inviting after removal queues another
- [x] 1.2 Handle the job in the worker (design D2) and add its metrics label; verify worker tests for recipient, subject, link, and text, and that a removed invitee, an ended session, or an archived course sends nothing

## 2. Cross-course list

- [x] 2.1 Add `GET /api/v1/users/me/collaboration-sessions` (design D3); verify HTTP tests for the success shape with `courseName`, `status` filtering, pagination and an invalid cursor, exclusion of archived courses, left courses, deleted posts and other users' sessions, and `401` without a session
- [x] 2.2 Document the endpoint and the invitation email in `collaboration-sessions.md` and `openapi.yaml`, and the job kind in `database.md`; verify the YAML parses and references resolve

## 3. Web lists

- [x] 3.1 Add the client function and **Your live sessions** on the home page; verify component tests for invited and started sessions, Join navigation, and the hidden empty state
- [x] 3.2 Add **Live sessions** to the course discussion sidebar; verify component tests for a student's own sessions and staff seeing every session with participants

## 4. Checks

- [x] 4.1 Add a browser test against the running stack: a student invites a TA, the TA's email arrives in Mailpit with the session link, and the TA joins from the home page; capture screenshots
- [x] 4.2 Run format, lint, typecheck, the test suite with `TEST_DATABASE_URL`, and build; record environment-only failures with evidence
  - Local run on Windows, 2026-10-20: API and collaboration suites pass. Web files pass when run alone except the two `App.test.tsx` password-reset tests and two `views.test.tsx` composer timing tests, which fail the same way on `add-session-whiteboard`. Parallel web runs on this laptop time out in the heaviest page-test files; CI is the reference.
- [ ] 4.3 Archive after `add-live-code-sessions` and `add-session-whiteboard` are archived
