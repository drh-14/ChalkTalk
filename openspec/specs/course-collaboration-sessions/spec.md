# course-collaboration-sessions Specification

## Purpose
Enable private, course-level live code and whiteboard collaboration among explicitly participating current course members.

## Requirements

### Requirement: Course-level creation and discovery
The system SHALL allow any current member of an active course to create a session with a title and language, and SHALL list only sessions in which the requester currently participates, including ended sessions. Session creation and listing SHALL NOT require a post.

#### Scenario: Member creates and lists a session
- **WHEN** a current member creates a session in an active course with valid title and language
- **THEN** the session and its Edit-capable creator participation are persisted and the creator can list it under Collaboration

#### Scenario: Nonparticipant cannot discover a session
- **WHEN** a current course member who is not a participant requests the session list, detail, snapshot, or ticket, including when the member is staff
- **THEN** the session is not disclosed and access is denied

### Requirement: Immediate participant invitations
Any current participant SHALL be able to invite a current course member with View or Edit access, granting access immediately. The creator and participating staff SHALL be able to remove invitees; after removal commits, new tickets and newly authorized live edits SHALL be denied and open connections SHALL close promptly. An edit already authorized and in flight before removal commits MAY finish afterward. The creator SHALL NOT be removable. An invite email SHALL be accepted by the delivery provider only while the invitee remains an eligible participant. The invitation worker SHALL hold eligibility locks through provider acceptance, so removal or creator departure MAY wait for an in-flight send before committing.

#### Scenario: Ordinary participant invites another member
- **WHEN** an ordinary participant invites a current course member with View access
- **THEN** the invitee can immediately list and open the session but cannot edit its document

#### Scenario: View-only staff remains read-only
- **WHEN** a TA or instructor participates with View access
- **THEN** the staff member may perform authorized management actions but cannot write to the live document

#### Scenario: Invitee removal races with a live write or email
- **WHEN** the creator or participating staff removes an invitee while that invitee has a WebSocket or queued invitation email
- **THEN** an in-flight email send may delay removal's commit; after commit, no invitation send is accepted, new edits and tickets are denied, and the connection closes promptly; an edit authorized before commit may finish

#### Scenario: Creator departure races with an invitation send
- **WHEN** a creator leaves the course while an invitation email send is in flight
- **THEN** departure may wait for provider acceptance before committing, and no invitation send is accepted after the departure commits

### Requirement: Session management and lifecycle
The creator or participating staff SHALL be able to rename and end a session. A creator's departure from the course SHALL end the session and preserve the last persisted snapshot for other current participants. Existing idle-ending and course-archive read-only behavior SHALL remain. Post editing, merge, or deletion SHALL NOT end or delete a session.

#### Scenario: Creator leaves during editing
- **WHEN** the creator leaves the course during an active session
- **THEN** the session ends, the creator loses access, and remaining participants can open its read-only persisted snapshot

#### Scenario: Final flush cannot be confirmed
- **WHEN** ending a session cannot confirm persistence of all in-memory edits
- **THEN** remaining participants see a last-saved-version warning with the snapshot

### Requirement: Migration preserves existing access and content
Existing post-associated sessions SHALL retain their IDs, course, documents, roster, View/Edit permissions, and session URLs after migration, without expanding access to staff or former post readers. Previously ended sessions SHALL display the conservative last-saved warning.

#### Scenario: Legacy private-post session migrates
- **WHEN** a session anchored to a private post is migrated
- **THEN** only its existing current participants can list and open the same session and document

### Requirement: Collaboration course interface
The course page SHALL show a Collaboration tab immediately after Threads. It SHALL list the viewer's active and ended sessions, allow session creation, and open the existing workspace with a return to Collaboration. It SHALL NOT offer post-specific actions. Home-page shortcuts SHALL observe the same participant-only visibility.

#### Scenario: Member navigates course collaboration
- **WHEN** a member opens Collaboration, creates or selects a session, and returns
- **THEN** the session appears in their course list and no post link or Post to discussion action is presented

### Requirement: Failure and race safety
The live editor SHALL use one-use tickets and recheck current course membership, participant permission, and session state before accepting or persisting edits. On transport or service failure, unconfirmed edits SHALL NOT be presented as durable; reconnect SHALL require fresh authorization. Concurrent invitations, removal, and ending SHALL not restore revoked access.

#### Scenario: Network drops after edit
- **WHEN** a WebSocket disconnects before a durable save is confirmed
- **THEN** the client reconnects through fresh authorization and the system does not claim the unconfirmed edit was saved

#### Scenario: Revoked ticket reconnect
- **WHEN** a removed participant retries with an old or new ticket
- **THEN** the connection is rejected and the document is not disclosed
