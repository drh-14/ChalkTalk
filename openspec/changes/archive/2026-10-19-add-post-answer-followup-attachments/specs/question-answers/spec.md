## ADDED Requirements

### Requirement: Shared-answer attachments follow save-only editing permissions

Shared answers SHALL expose active parent-scoped attachment metadata. Attachment uploads and removals SHALL be separate from save-only Markdown text updates, using the same current course membership and immutable role-floor rules as editing the answer. Each successful attachment mutation SHALL advance the answer version so an independent draft with an older ETag requires an explicit conflict decision before overwrite. No attachment operation SHALL read, write, create, or require Yjs snapshots, tickets, WebSockets, or live-edit processes.

#### Scenario: Attachment changes during an independent answer draft

- **WHEN** one editor uploads a file while another editor holds an earlier answer ETag
- **THEN** the attachment is committed and the earlier draft's Save receives `412 version_conflict` without losing either the attachment or the draft

#### Scenario: Markdown save races an attachment upload

- **WHEN** a version-checked Markdown save and an authorized attachment upload target one answer concurrently
- **THEN** serialized parent versions preserve the committed text and attachment, and a stale save cannot silently overwrite a newer parent revision

## RENAMED Requirements

- FROM: `### Requirement: Save-only answer editing remains attachment-free`
- TO: `### Requirement: Save-only answer editing coexists with attachments`

## MODIFIED Requirements

### Requirement: Save-only answer editing coexists with attachments

`PATCH /api/v1/answers/{answerId}` SHALL accept JSON `bodyMarkdown` and a current `If-Match`. A student answer SHALL be editable by every current member; a staff answer SHALL be editable only by current members at or above its immutable TA or instructor creator-role floor. Typing and formatting SHALL remain in an independent local draft until Save. The server SHALL atomically save Markdown, answer version and timestamp, contributor, contribution event, and current endorsement state. Missing/stale ETags SHALL return `428 precondition_required`/`412 version_conflict`; insufficient role `403 permission_denied`; hidden or deleted answers `404`; inactive courses `409 course_archived`. The Markdown PATCH SHALL remain JSON-only; separate parent-scoped attachment upload/removal routes SHALL use the same edit permissions and advance the parent version without changing its Markdown. Saving or explicitly overwriting a text draft SHALL retain current attachments. After a stale save the client SHALL preserve the draft, show the latest saved answer alongside it, and require explicit Overwrite before retrying with a fresh ETag. A further race SHALL repeat the review.

#### Scenario: A client tries to edit an answer

- **WHEN** an authorized current member submits a valid versioned REST answer edit
- **THEN** the public PATCH route persists the revised Markdown only after Save

#### Scenario: Student edits student slot

- **WHEN** a current student saves valid Markdown against the student answer's current ETag
- **THEN** the Markdown changes, the version advances, and the editor is recorded once

#### Scenario: Staff floor does not drift

- **WHEN** an instructor edits a TA-created staff answer and a TA edits it later
- **THEN** both edits are permitted because the floor remains TA

#### Scenario: Instructor floor rejects TA

- **WHEN** a TA tries to edit an instructor-created staff answer
- **THEN** the API returns `403 permission_denied` without changing state

#### Scenario: Concurrent REST editors

- **WHEN** two editors save against the same answer ETag
- **THEN** one succeeds and the other receives `412 version_conflict` without overwriting the accepted edit

#### Scenario: Saved correction after endorsement

- **WHEN** an authorized editor saves a change to endorsed answer text
- **THEN** the current endorsement clears, historical endorsement events remain, and the contributor is recorded
