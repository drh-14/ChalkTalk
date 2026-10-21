# Proposal

## Why

Live sessions are private, so the only way into one is an invitation. Today an invitee is never told: they find the session only by opening its post or being sent the link. During office hours, staff also have no single place to see which sessions are running in their course. Both gaps are on the live session follow-ups list (items 1 and 2), and the user chose email plus an in-app list for invitations.

## What Changes

- When the creator or staff invite a course member, ChalkTalk emails the invitee a link to the session. The email names the person who invited them, the session, and the course. It is queued in the same transaction as the invitation and sent by the job worker, which checks that the invitation still holds before sending. Inviting someone who is already a participant sends nothing.
- A new endpoint, `GET /api/v1/users/me/collaboration-sessions`, lists the viewer's own sessions (created or invited) across their courses, with each session's course name.
- The home page shows **Your live sessions**: the viewer's active sessions across courses, marked as invited or started by them, each with **Join**.
- The course discussion page shows a **Live sessions** list: for students, their own active sessions in the course; for TAs and instructors, every active session in the course, so staff can see and join what is running during office hours. This uses the existing course-scoped list endpoint, which already returns all sessions to staff and only their own to others.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `live-code-sessions`: invitation emails, a cross-course list of the viewer's sessions, and in-app lists on the home and course pages. The capability is introduced by `add-live-code-sessions` and extended by `add-session-whiteboard`; this change adds requirements only.

## Impact

- **API:** the new `GET /api/v1/users/me/collaboration-sessions` route and service method; `invite` queues a job.
- **Worker:** a new `send_collaboration_invitation_email` job kind, its handler, and its metrics label.
- **Web:** the home page section, the course discussion section, and a client function.
- **Docs:** `documentation/api/collaboration-sessions.md`, `documentation/openapi.yaml`, and the job kinds in `documentation/database.md`.
- **Database:** no migration; the `jobs` table already accepts new kinds.
- **Coordination:** stacked on `add-session-whiteboard`, which is stacked on `add-live-code-sessions`.
