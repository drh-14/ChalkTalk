## MODIFIED Requirements

### Requirement: Public collaborative editing and attachments remain unavailable

`PATCH /api/v1/answers/{answerId}` SHALL accept JSON `bodyMarkdown` and a current `If-Match`. A student answer SHALL be editable by every current member; a staff answer SHALL be editable only by current members at or above its immutable TA or instructor creator-role floor. The server SHALL replace `Y.Text('content')` and save encoded Yjs state, Markdown projection, answer version and timestamp, contributor, and contribution event atomically. Missing/stale ETags SHALL return `428 precondition_required`/`412 version_conflict`; insufficient role `403 permission_denied`; hidden or deleted answers `404`; inactive courses `409 course_archived`. Multipart and attachment edits SHALL remain unavailable. Authorized live editing SHALL be available for existing answer bodies through a document-bound ticket and WebSocket. REST edits SHALL notify open collaboration nodes and remain version-checked against the same durable document.

#### Scenario: A client tries to edit an answer
- **WHEN** an authorized current member submits a valid versioned REST answer edit
- **THEN** the public PATCH route persists the revised Markdown and Yjs state

#### Scenario: Student edits student slot
- **WHEN** a current student saves valid Markdown against the student answer's current ETag
- **THEN** the Markdown and Yjs text match, the version advances, and the editor is recorded once

#### Scenario: Staff floor does not drift
- **WHEN** an instructor edits a TA-created staff answer and a TA edits it later
- **THEN** both edits are permitted because the floor remains TA

#### Scenario: Instructor floor rejects TA
- **WHEN** a TA tries to edit an instructor-created staff answer
- **THEN** the API returns `403 permission_denied` without changing state

#### Scenario: Concurrent REST editors
- **WHEN** two editors save against the same answer ETag
- **THEN** one succeeds and the other receives `412 version_conflict` without overwriting the accepted edit

#### Scenario: Live correction after endorsement
- **WHEN** an authorized editor changes endorsed answer text live
- **THEN** the current endorsement clears, historical endorsement events remain, and the contributor is recorded

## ADDED Requirements

### Requirement: Empty live answers cannot be endorsed

The API SHALL reject endorsement while an answer's live body is blank, without changing endorsement state or historical events. REST create and PATCH SHALL continue requiring nonblank body text.

#### Scenario: Selected-all answer
- **WHEN** staff attempts to endorse an answer that a live editor has temporarily emptied
- **THEN** endorsement is rejected until nonblank content is committed
