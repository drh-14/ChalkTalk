# Spec Delta

## ADDED Requirements

### Requirement: Invitees are emailed a link to the session

When the creator or staff invite a course member who is not already a participant, ChalkTalk SHALL send that member one email with a link to the session view. The email SHALL name the person who sent the invitation, the session title, and the course name, and SHALL say that only invited participants and course staff can open the session. The email SHALL be queued in the same transaction as the invitation and delivered by the job worker. Before sending, the worker SHALL confirm that the session is still active, the course is still active, and the invitee is still a participant and course member; otherwise it SHALL send nothing. Inviting someone who is already a participant SHALL not send another email; inviting someone again after they were removed SHALL.

#### Scenario: A student invites a TA

- **WHEN** a student invites a TA to their active session
- **THEN** the TA receives one email naming the student, the session, and the course, with a link that opens the session

#### Scenario: The invitee is removed before the email is sent

- **WHEN** an invitee is removed from the session before the worker processes the email
- **THEN** no email is sent

#### Scenario: The same member is invited twice

- **WHEN** the creator invites a member who is already a participant
- **THEN** the request succeeds and no second email is queued

### Requirement: Members can list their own sessions across courses

`GET /api/v1/users/me/collaboration-sessions` SHALL return the sessions the authenticated user created or was invited to, in courses that are active and of which they are still a member, excluding sessions whose post is deleted or a confirmed duplicate. It SHALL accept `status` (`active` or `ended`), `limit` (1–100, default 25), and `cursor`, order sessions newest first, and include each session's `courseName` with the usual session fields. Staff SHALL see only their own sessions here; the course-scoped list remains the way to see every session in a course. Unauthenticated requests SHALL get `401`.

#### Scenario: A TA checks their invitations

- **WHEN** a TA invited to sessions in two courses requests their active sessions
- **THEN** both sessions are returned with their course names, and sessions in an archived course or after the TA left a course are not

### Requirement: The home and course pages list live sessions

The home page SHALL show **Your live sessions**, listing the viewer's active sessions across courses with the course name, the session title, whether the viewer was invited or started it, and a **Join** action; it SHALL be hidden when there are none. The course discussion page SHALL show a **Live sessions** list of active sessions in that course: a student SHALL see their own sessions, and TAs and instructors SHALL see every active session in the course with its participants, so they can join any of them.

#### Scenario: An invited TA opens ChalkTalk

- **WHEN** a TA who was invited to a session opens the home page
- **THEN** **Your live sessions** lists the session as invited, and **Join** opens it

#### Scenario: An instructor checks office hours

- **WHEN** an instructor opens the course discussion page while two students each have a session with a TA
- **THEN** the **Live sessions** list shows both sessions and their participants

### Requirement: Tests cover invitations and session lists

API tests SHALL cover the new endpoint's success response, filters, pagination, exclusions, and authentication, and that inviting queues exactly one email job only for a new participant. Worker tests SHALL cover the email's recipient, subject, link, and content, and that a stale invitation sends nothing. Component tests SHALL cover the home and course lists for students and staff. A browser test against the running stack SHALL show an invitee receiving the email and joining from the home page.

#### Scenario: An email is sent for a removed invitee

- **WHEN** a change lets the worker email someone who was removed from the session
- **THEN** an automated test fails
