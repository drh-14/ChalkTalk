# question-answers Specification

## Purpose

Lets course members answer question posts through one shared students' answer and one shared instructors' answer per question, which staff can endorse or delete, with identity-safe contributor projections.

## Requirements

### Requirement: Members create one shared answer of their kind per question

`POST /api/v1/posts/{postId}/answers` SHALL retain exactly one active `student` answer and one active `staff` answer per visible question. Students create the student slot; TAs and instructors create the staff slot. Creation SHALL atomically save the answer, Yjs document, initial contributor and append-only contribution event. A staff answer SHALL snapshot the creator's current `ta` or `instructor` role as its immutable edit floor; a student answer SHALL have a `student` floor. The documented validation, authentication, Origin, CSRF, idempotency, `201` response, Location, ETag, active-course and hidden-resource rules SHALL continue. Competing creation for an occupied slot SHALL return `409 answer_kind_exists`.

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

### Requirement: Members read a question's answers

`GET /api/v1/posts/{postId}/answers` SHALL return at most the active student and staff answers in that order. `GET /api/v1/answers/{answerId}` SHALL return one visible active answer and ETag. Answers SHALL retain their `kind` and include body Markdown, identity-safe contributors, current endorsement, version, `canEdit`, `upvoteCount`, and `viewerUpvoted`. Hidden, deleted, merged, cross-course, or nonmember content SHALL return the documented `404`; a note list SHALL return `422 not_a_question`.

#### Scenario: A member lists answers
- **WHEN** a current member lists a question with both answer kinds
- **THEN** the API returns student then staff answer

#### Scenario: Both slots are present
- **WHEN** a current member lists a question with both answer kinds
- **THEN** the student slot precedes the staff slot, each with its vote state and current edit permission

#### Scenario: A former member reads an answer
- **WHEN** a former member requests an answer
- **THEN** the API returns `404 not_found`

### Requirement: Answer contributors follow identity visibility

`contributors` SHALL list active `{id,displayName}` editor identities for a nonanonymous answer. For an anonymous answer, it SHALL be null for students including contributors and visible to current TAs and instructors. The `canEdit` projection SHALL not reveal anonymous identities. A successful text-changing edit SHALL add its authenticated editor once to the distinct contributor set and append an immutable contribution event; content-neutral operations SHALL not add one.

#### Scenario: Student edits an anonymous student answer
- **WHEN** a student edits an anonymous student answer
- **THEN** the answer remains editable to the student and its contributor identities remain hidden from student readers

#### Scenario: A student views an anonymous answer
- **WHEN** a student views an anonymous answer
- **THEN** the contributor list is null

#### Scenario: Staff view an anonymous answer
- **WHEN** a TA reads an anonymous answer
- **THEN** the distinct active contributors are visible

### Requirement: Staff endorse and delete answers conditionally

`PUT /api/v1/answers/{answerId}/endorsement` SHALL let current staff endorse either active answer with a current `If-Match`, advancing its version and recording an append-only endorsement event. Repeating an unchanged endorsement with the current ETag SHALL remain idempotent. `DELETE /api/v1/answers/{answerId}` SHALL let staff delete an unendorsed answer with a current `If-Match`; the slot then becomes available again. The documented missing/stale ETag, role, hidden-resource, inactive-course, and endorsed-deletion errors SHALL continue. A content edit SHALL clear only the current endorsement state; historical endorsement events SHALL remain for statistics, and staff MAY endorse the revised answer again.

#### Scenario: A TA endorses the students' answer
- **WHEN** a TA endorses the student answer with its current ETag
- **THEN** the current endorsement is recorded with a new answer version and ETag

#### Scenario: A student tries to endorse
- **WHEN** a student sends an endorsement request
- **THEN** the API returns `403 permission_denied` without changing the answer

#### Scenario: Staff delete an answer
- **WHEN** an instructor deletes an unendorsed answer with its current ETag
- **THEN** it disappears from ordinary reads and the slot may be recreated

#### Scenario: Edit after endorsement
- **WHEN** an eligible member edits an endorsed answer with its current ETag
- **THEN** content changes, current endorsement clears, historical endorsement data stays, and the answer may be endorsed again

#### Scenario: Staff deletes an answer
- **WHEN** staff delete an unendorsed shared slot with its current ETag
- **THEN** it is absent from ordinary reads and that kind can be recreated

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

### Requirement: Tests derive from the answers contract

PostgreSQL-backed HTTP and migration tests SHALL cover the documented success responses and headers, authentication, CSRF, validation, versions, slot uniqueness, role floors, legacy backfill, anonymity, historical events, idempotency, lifecycle, cross-course isolation, and Yjs/Markdown atomic consistency. Behavior slices SHALL fail for the expected reason before implementation.

#### Scenario: A regression exposes an anonymous contributor
- **WHEN** an anonymous answer response exposes a contributor ID to a student
- **THEN** an integration test fails

#### Scenario: Regression exposes private editor identity
- **WHEN** an anonymous answer response reveals contributor IDs to a student
- **THEN** an integration test fails

### Requirement: Legacy answer role floors are backfilled conservatively

The migration SHALL retain existing answer IDs, kinds, Markdown, Yjs documents, and contributor history. It SHALL infer an existing staff answer's creator from its sole original contributor and assign a TA floor only if that contributor currently has TA membership; otherwise it SHALL assign an instructor floor when that contributor is an instructor, missing, or demoted. Existing student answers SHALL receive a student floor. If multiple contributors make the original creator ambiguous, migration SHALL stop with a diagnostic error and leave the schema unchanged.

#### Scenario: Demoted staff creator
- **WHEN** a legacy staff answer's sole contributor is now a student
- **THEN** its edit floor becomes instructor

#### Scenario: Ambiguous history
- **WHEN** a legacy answer has multiple contributors and its creator cannot be identified
- **THEN** migration fails transactionally without choosing an arbitrary floor

### Requirement: Empty live answers cannot be endorsed

The API SHALL reject endorsement while an answer's live body is blank, without changing endorsement state or historical events. REST create and PATCH SHALL continue requiring nonblank body text.

#### Scenario: Selected-all answer
- **WHEN** staff attempts to endorse an answer that a live editor has temporarily emptied
- **THEN** endorsement is rejected until nonblank content is committed
