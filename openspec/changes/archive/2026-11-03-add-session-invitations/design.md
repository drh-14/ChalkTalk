# Design

## Context

- `CollaborationSessionService.invite` inserts a `collaboration_participants` row with `ON CONFLICT DO NOTHING`, so a repeat invitation is already a no-op.
- The job worker already sends one kind of email, `send_question_duplicate_email`: the API inserts a `jobs` row with a deduplication key in the same transaction as the change, and the worker rechecks current rows before sending. Job kinds are plain text; there is no database constraint to change.
- `GET /api/v1/courses/{courseId}/collaboration-sessions` returns every session in the course to staff and only their own sessions to others.
- There are no per-user email preferences in ChalkTalk.

## Goals / Non-Goals

**Goals:** tell invitees by email and in the app; give staff a view of the course's running sessions; reuse existing job, email, and list machinery.

**Non-Goals:** email preferences or unsubscribe; push or in-app notifications beyond the lists; notifying staff when any session starts.

## Decisions

### D1. Queue the email with the invitation

`invite` inserts a job only when the participant insert affected a row: kind `send_collaboration_invitation_email`, payload `{ sessionId, inviteeUserId, inviterUserId }`, deduplication key `<sessionId>:<inviteeUserId>:<participant created_at in ms>`. The key makes a retry of the same invitation a no-op, while a new invitation after removal (a new row, a new `created_at`) sends again. The creator's own participant row, written by `create`, never queues an email.

### D2. The worker rechecks before sending

The handler loads the session, course, invitee, and inviter in one query, requiring an active session and course, the invitee still a participant with the same `created_at` and still a course member, and no deleted users. If the row is missing, the job succeeds without sending. The email:

- **To:** the invitee's email.
- **Subject:** `<Inviter name> invited you to a live session`.
- **Text:** `<Inviter name> invited you to the live session "<title>" in <course>.` then the session URL, built from `frontendBaseUrl` as `/courses/{courseId}/sessions/{sessionId}`, then `Only invited participants and course staff can open it.`

Names and titles are collapsed to single spaces, as in the duplicate email.

### D3. A user-scoped list endpoint

`GET /api/v1/users/me/collaboration-sessions` sits beside the other `/users/me` routes. The query joins `collaboration_participants` on the viewer (the creator always has a participant row), active courses, current memberships, and posts that are not deleted or confirmed duplicates. Pagination reuses the course list's `(created_at, id)` cursor, bound to the user and filters. Each item is a `CollaborationSession` plus `courseName`.

*Alternative:* the home page could call the course list once per course. That costs one request per course and still misses courses beyond the first page.

### D4. Two small lists in the web app

- **Home:** `YourLiveSessions` above **Your courses**, loading active sessions once and rendering nothing when there are none.
- **Course discussion:** `CourseLiveSessions` in the discussion sidebar, using the course list with `status=active`. It is titled **Live sessions**, and for staff it notes that it shows every session in the course.

Both link with the existing `sessionRoute`.

## Risks / Trade-offs

- [Email to staff who could open the session anyway] → It is still an explicit request for their attention, so it is sent.
- [Mail delivery is not configured in some environments] → The worker already fails such jobs with an error and retries, as for duplicate emails.
- [The lists can go stale while a page stays open] → They refresh when the page mounts; real-time updates are out of scope.

## Migration Plan

No migration. Deploy the API and worker together. Jobs queued by a new API before the worker updates wait in the queue until the new worker claims them.
