## MODIFIED Requirements

### Requirement: Members create one shared answer of their kind per question

`POST /api/v1/posts/{postId}/answers` SHALL retain exactly one active `student` answer and one active `staff` answer per visible question. Students create the student slot; TAs and instructors create the staff slot. Creation SHALL atomically save the Markdown answer, initial contributor and append-only contribution event; no Yjs document is created. A staff answer SHALL snapshot the creator's current `ta` or `instructor` role as its immutable edit floor; a student answer SHALL have a `student` floor. The documented validation, authentication, Origin, CSRF, idempotency, `201` response, Location, ETag, active-course and hidden-resource rules SHALL continue. Competing creation for an occupied slot SHALL return `409 answer_kind_exists`.

#### Scenario: A student answers a question

- **WHEN** a student creates a valid answer on a question with an empty student slot
- **THEN** the API returns `201`, Location, ETag, and a student answer with its contributor

#### Scenario: A TA answers after a student

- **WHEN** a TA creates a staff answer after a student answer exists
- **THEN** both shared slots are present

#### Scenario: Two students answer at once

- **WHEN** two students concurrently create the student answer on one question
- **THEN** exactly one succeeds and the other receives `409 answer_kind_exists`

#### Scenario: A TA creates the staff slot

- **WHEN** a current TA creates the staff answer
- **THEN** the answer has a TA edit floor and can be edited by current TAs or instructors

#### Scenario: A member tries to answer a note

- **WHEN** a member creates an answer on a note
- **THEN** the API returns `409 not_a_question` without writing an answer

### Requirement: Save-only answer editing remains attachment-free

Each existing shared answer body SHALL be edited only through a local Markdown/LaTeX draft and an explicit version-checked REST Save. Typing SHALL NOT change the saved answer or another member's editor. On a stale `If-Match`, the client SHALL preserve the draft and show the latest saved answer alongside it. Overwrite SHALL require an explicit choice and another version-checked PATCH with the latest ETag. A further race SHALL return to conflict review. Successful Save SHALL update Markdown, version, attribution, and endorsement state transactionally; legacy empty answers SHALL display a placeholder and require nonblank text at Save.

#### Scenario: Two editors save overlapping drafts

- **WHEN** two authorized editors start from the same answer version and the first saves
- **THEN** the second editor's draft remains local and its Save receives a version conflict; no text is overwritten until the second editor reviews the latest text and explicitly chooses Overwrite

#### Scenario: Render saved content

- **WHEN** an answer, followup, or reply is created or saved with Markdown and LaTeX
- **THEN** its display renders formatting while the editor retains raw source

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
