# Spec Delta

## Purpose

Let a small, explicitly chosen group of course members, typically a student and course staff during office hours, edit one shared code document together in real time from a post, with private access and durable final text.

## ADDED Requirements

### Requirement: Course members can start a session on a readable post

`POST /api/v1/courses/{courseId}/collaboration-sessions` SHALL create an active session anchored to one post, using the documented session authentication, `Origin` and CSRF checks, and `Idempotency-Key` behavior. The body SHALL contain `anchor.postId` and MAY contain `title` (1–120 characters after trimming; default: the post title truncated to 120 characters) and `language` (one of `plaintext`, `python`, `java`, `c`, `cpp`, `javascript`, `typescript`, `sql`; default `plaintext`). The caller SHALL be a current member of an active course, and the post SHALL be active, not deleted, and not a confirmed duplicate, in the same course. The response SHALL be `201 Created` with `Location`, an `ETag`, and the session projection: `id`, `courseId`, `status`, `anchor`, `title`, `language`, `createdBy`, `endedAt`, `createdAt`, `updatedAt`, and `version`. The creator SHALL become the first participant. A new session SHALL start with empty text.

#### Scenario: A student starts a session from a question

- **WHEN** a student member of an active course creates a session for an active question in that course with `language: "python"`
- **THEN** the API returns `201` with `status: "active"`, `language: "python"`, the post title as `title`, the student as `createdBy`, and an `ETag`

#### Scenario: The course is archived

- **WHEN** a member creates a session in an archived course
- **THEN** the API returns `409 course_archived` and creates nothing

#### Scenario: The anchor is invalid

- **WHEN** a member creates a session for a deleted post, a confirmed duplicate, or a post in another course
- **THEN** the API returns `422 cross_course_anchor` and creates nothing

#### Scenario: An unsupported language is requested

- **WHEN** a member creates a session with `language: "rust"`
- **THEN** the API returns `422 validation_failed`

### Requirement: Sessions are visible only to their authorized participants

A session SHALL be visible only to its creator, to current TAs and instructors of its course, and to current course members invited to it. Every session route, list result, ticket, and snapshot SHALL apply this rule using current membership and invitation state. A caller who is not authorized, including a course member who was never invited, SHALL receive `404 not_found` from single-session routes, exactly as for an absent session. `GET /api/v1/courses/{courseId}/collaboration-sessions` SHALL return only visible sessions, support the documented `status`, `anchorType` (`post` only), `anchorId`, `cursor`, and `limit` parameters, and exclude hidden sessions before pagination and `hasMore` are calculated. The projection SHALL include `participants`: each participant's user ID, display name, and role in the session (`creator` or `invitee`).

#### Scenario: An uninvited student looks for a session

- **WHEN** a student who is a course member but not invited requests a session by ID or lists the course's sessions
- **THEN** the single-session request returns `404 not_found` and the list omits that session without affecting `hasMore`

#### Scenario: A TA lists active sessions on a post

- **WHEN** a TA lists sessions with `status=active&anchorType=post&anchorId={postId}`
- **THEN** the API returns every active session on that post, including those the TA was not invited to

### Requirement: The creator and staff manage invitations

The session creator and current course staff SHALL be able to invite current course members with `POST /api/v1/collaboration-sessions/{id}/participants` (body `userId`) and remove invitees with `DELETE /api/v1/collaboration-sessions/{id}/participants/{userId}`, using the documented CSRF checks. Inviting an existing participant SHALL succeed without duplication. Inviting a user who is not a current course member SHALL return `422 not_course_member`. Invitees SHALL NOT invite or remove others; such requests SHALL return `403 forbidden`. The creator SHALL NOT be removable. Removing an invitee SHALL revoke their unused tickets and close their open connections within 5 seconds. Invitation changes SHALL NOT be allowed after the session ends.

#### Scenario: A student invites a TA and a classmate

- **WHEN** the student who created a session invites a TA and another student from the course
- **THEN** both appear in `participants` and the classmate can now retrieve the session and obtain a ticket

#### Scenario: An invitee tries to invite someone

- **WHEN** an invited student calls the invite route
- **THEN** the API returns `403 forbidden` and the participants are unchanged

#### Scenario: A participant is removed while editing

- **WHEN** the creator removes an invitee who has the editor open
- **THEN** that invitee's connection closes within 5 seconds, their later ticket requests return `404`, and their unsaved edits are not accepted

### Requirement: The creator and staff can change the title and language

`PATCH /api/v1/collaboration-sessions/{id}` SHALL accept `title` and `language` from the creator or current course staff while the session is active, require `If-Match` with the current `ETag`, and return the updated projection and a new `ETag`. A stale `ETag` SHALL return `412 version_conflict`. Connected participants SHALL see a language change take effect in their editor within 2 seconds without reconnecting or losing text.

#### Scenario: The TA switches the language

- **WHEN** a TA changes an active session's language from `plaintext` to `java` with the current `ETag`
- **THEN** the API returns `200` with `language: "java"` and connected editors switch to Java highlighting without losing text

### Requirement: Connection tickets authorize one WebSocket for an active session

`POST /api/v1/collaboration-sessions/{id}/connection-tickets` SHALL issue, to an authorized participant of an active session in an active course, a random one-use ticket bound to the caller's login session, user, and collaboration session, with `write` permission, expiring 5 minutes after issue, and stored only as a hash. The response SHALL have `Cache-Control: no-store` and contain `ticket`, `webSocketUrl` (credential-free), `documentId`, and `expiresAt`. The collaboration server SHALL accept a connection only for an unexpired, unconsumed, unrevoked ticket whose document matches the requested document, and SHALL consume it in the same database transaction that accepts the connection. It SHALL reject a reused, expired, or mismatched ticket, an `Origin` not in the configured frontend origins, and a caller whose login session has ended or whose authorization no longer holds. The connection SHALL never accept a client-supplied user ID or role.

#### Scenario: A ticket is used twice

- **WHEN** a client connects with a ticket and a second connection presents the same ticket
- **THEN** the first connection is accepted and the second is closed with an authentication failure

#### Scenario: A ticket is requested for an ended session

- **WHEN** a participant requests a ticket after the session ended
- **THEN** the API returns `409 session_ended`

### Requirement: Participants edit one shared document in real time

Connected participants SHALL edit a single shared plain-text document. Concurrent edits from any number of participants SHALL merge so that every connected participant converges to the same text without losing either side's insertions. An edit SHALL appear for the other connected participants within 1 second under normal local conditions. The document SHALL be limited to 200,000 characters; the server SHALL reject an update that would exceed the limit or that writes anything other than the session's single text field, without broadcasting it. Each participant SHALL see the other connected participants' display names, a distinct color, and their cursor and selection positions. Presence identity SHALL come from the authenticated ticket, not from the client.

#### Scenario: Two people type at the same place

- **WHEN** a student and a TA type different text at the same position at the same moment
- **THEN** both insertions appear in the same order for both of them, and neither is lost

#### Scenario: A participant sees who is editing

- **WHEN** a TA joins a session a student already has open
- **THEN** the student sees the TA's name in the participant list and the TA's cursor in the editor

### Requirement: Session text is persisted and recovered

The collaboration server SHALL persist the document state and its plain-text projection to PostgreSQL within 5 seconds of an accepted edit while edits continue, when the last participant disconnects, and when the session ends. After a collaboration server restart, a reconnecting participant SHALL receive the most recently persisted state; edits accepted within the last persistence interval before an unclean crash MAY be lost. `GET /api/v1/collaboration-sessions/{id}/snapshot` SHALL return, to an authorized participant, the latest persisted plain text with `sessionStatus`, `persistedAt`, and `capturedAt`, with `Cache-Control: no-store`.

#### Scenario: Everyone leaves and comes back

- **WHEN** all participants close a session's editor and later reopen it
- **THEN** the editor shows the text as it was when the last participant left

#### Scenario: A participant reads the snapshot

- **WHEN** an invited participant requests the snapshot of an active session
- **THEN** the API returns `200` with the persisted text and `Cache-Control: no-store`

### Requirement: The creator or staff can end a session

`PATCH /api/v1/collaboration-sessions/{id}` with `status: "ended"` and the current `If-Match` SHALL end an active session when called by its creator or current course staff, returning `200` with `status: "ended"` and `endedAt` set. Ending SHALL ask the collaboration server to persist the final document state and SHALL wait up to 5 seconds for it to confirm before reporting success. If the collaboration server does not confirm in time, the session SHALL still end, keeping the most recently persisted text. Ending SHALL reject new tickets and close open connections with a session-ended signal so editors become read-only. An ended session SHALL remain visible to its authorized participants, with its final text available through the snapshot route and the session view. Ending an already ended session SHALL return `409 session_ended`. An invitee SHALL receive `403 forbidden`.

#### Scenario: The TA ends office hours

- **WHEN** a TA ends a session while a student is typing
- **THEN** the final persisted text includes the student's edits that the collaboration server accepted before the end, the student's editor becomes read-only showing that text, and new ticket requests return `409 session_ended`

#### Scenario: The collaboration server is down when a session ends

- **WHEN** staff end a session while the collaboration server is unavailable
- **THEN** the API returns `200` with `status: "ended"` after at most 5 seconds, and the snapshot holds the most recently persisted text

### Requirement: Course and post lifecycle changes apply to sessions

Archiving a course SHALL end its active sessions. Deleting a post, or confirming it as a duplicate, SHALL end its active sessions; those sessions SHALL then be unavailable (`404`) to everyone except course staff. Deleting a course SHALL remove its sessions, documents, participants, and tickets during course deletion cleanup. When a user stops being a course member, they SHALL lose access to the course's sessions and their open connections SHALL close within 5 seconds. A staff member who becomes a student SHALL keep access only to sessions they created or were invited to.

#### Scenario: A course is archived during office hours

- **WHEN** an instructor archives a course with an active session that has connected editors
- **THEN** the session ends, its final text is persisted, and the editors become read-only

#### Scenario: A member leaves the course

- **WHEN** an invited student leaves the course while connected to a session
- **THEN** their connection closes within 5 seconds and later requests for the session return `404`

### Requirement: Members can start and join sessions from a post

The post detail view SHALL list the post's sessions that the viewer may open, showing each session's title, language, status, and participant names, and SHALL offer **Start live code session** for posts where creation is allowed. Starting a session SHALL let the member choose a language and optional title, then open the session view. The session view SHALL be routed at `/courses/{courseId}/sessions/{sessionId}`, work as a direct link for authorized participants, and show an unavailable state otherwise. It SHALL contain a code editor with line numbers and syntax highlighting for the session language, the participant list with presence, an invite control (creator and staff only) that selects from current course members, a language control (creator and staff only), an **End session** control (creator and staff only), a link back to the post, and a visible connection state: connecting, connected, reconnecting, ended (read-only), or access removed. Before a member starts a session, the view SHALL tell them that participants will see their name.

#### Scenario: A student starts a session and invites a TA

- **WHEN** a student opens a question, chooses **Start live code session**, selects Python, and invites a TA
- **THEN** the session view opens with an empty Python editor, the TA appears as invited, and the question lists the session

#### Scenario: The connection drops briefly

- **WHEN** a participant's network drops for a few seconds and returns while the session is still active and they are still invited
- **THEN** the view shows "reconnecting", obtains a new ticket, reconnects, and merges edits made while disconnected without losing them

#### Scenario: An uninvited member opens a session link

- **WHEN** a course member who is not authorized opens a session URL
- **THEN** the view shows an unavailable state without the session's title, text, or participants

### Requirement: Tests cover the session contract

Tests SHALL be derived from the updated collaboration-session API reference, OpenAPI document, and database reference. PostgreSQL-backed HTTP tests SHALL cover each route's success response and headers, authentication and CSRF, validation, `If-Match` conflicts, idempotency, access rules (creator, staff, invitee, uninvited member, nonmember), invitation changes, lifecycle effects, and persistence constraints. Collaboration server tests SHALL cover ticket consumption and rejection, two clients converging, presence identity from the ticket, persistence on interval, on last disconnect, and on end, revocation within the stated time, and rejection of oversized or out-of-schema updates. Rendered browser-component tests SHALL cover the post entry point, the session view's states, and the creator/staff-only controls.

#### Scenario: Access control regresses

- **WHEN** a change lets an uninvited course member obtain a ticket or snapshot
- **THEN** an automated test fails
