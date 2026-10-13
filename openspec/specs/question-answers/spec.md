# question-answers Specification

## Purpose

Lets course members create and edit independent answer cards on question posts, with role-based edit thresholds, staff endorsement, upvotes, and identity-safe contributor projections.

## Requirements

### Requirement: Members create one shared answer of their kind per question

`POST /api/v1/posts/{postId}/answers` SHALL let a current course member create an independent answer card on a visible active question. The JSON body SHALL contain `bodyMarkdown` of 1–100,000 non-whitespace characters and optional boolean `anonymous`; attachments and unknown fields SHALL fail with `422 validation_failed`. Every answer SHALL snapshot its creator's current role as an immutable edit floor, create its Yjs document and initial contributor atomically, and return `201`, `Location`, ETag, and version 1. A matching idempotency retry SHALL return the original answer and a changed payload with the same key SHALL return `409 idempotency_key_reused`. Multiple answers from members of any role SHALL be allowed. Authentication, CSRF and Origin checks SHALL apply. A note SHALL return `409 not_a_question`; absent, hidden, cross-course or nonmember questions SHALL return `404 not_found`; archived/deleting courses SHALL return `409 course_archived`.

#### Scenario: Two students answer the same question
- **WHEN** two students independently post valid answers to one question
- **THEN** both requests succeed with distinct answer IDs and documents

#### Scenario: A student answers a question
- **WHEN** a student creates a valid answer on a visible question
- **THEN** the API returns an independent card with its Location and ETag

#### Scenario: Two students answer at once
- **WHEN** two students create answers concurrently on one question
- **THEN** both distinct cards are persisted

#### Scenario: A TA answers after a student
- **WHEN** a TA creates an answer after a student has answered
- **THEN** both cards remain visible

#### Scenario: A member tries to answer a note
- **WHEN** a member posts an answer to a note
- **THEN** the API returns `409 not_a_question` without writing an answer

#### Scenario: The same creation is retried
- **WHEN** an answer creation repeats with the same idempotency key and payload
- **THEN** it returns the original answer without inserting another row

### Requirement: Members read a question's answers

`GET /api/v1/posts/{postId}/answers` SHALL return every active answer card in deterministic creation order. `GET /api/v1/answers/{answerId}` SHALL return one active visible answer and ETag. Answers SHALL contain body Markdown, contributor projection, endorsement, version, `canEdit`, `upvoteCount`, and `viewerUpvoted`, without a student/staff kind slot. Hidden/deleted/merged/cross-course questions and nonmembers SHALL receive `404 not_found`; a note list SHALL receive `422 not_a_question`.

#### Scenario: Legacy and new cards coexist
- **WHEN** a question contains migrated student and staff answers and a newly created answer
- **THEN** all three appear as separate cards with their original IDs and text

#### Scenario: A member lists answers
- **WHEN** a current member lists a question's answers
- **THEN** every active card appears in creation order

#### Scenario: A former member reads an answer
- **WHEN** a former member reads a card
- **THEN** the API returns `404 not_found`

### Requirement: Answer contributors follow identity visibility

`contributors` SHALL list non-deleted `{id,displayName}` identities for a nonanonymous answer. For anonymous answers it SHALL be `null` for every student, including contributors, and SHALL list the contributors for TAs and instructors. The server SHALL project `canEdit` independently of identity visibility.

#### Scenario: Student reads an anonymous answer
- **WHEN** a student reads an anonymous answer they are allowed to edit
- **THEN** `contributors` is null and `canEdit` is true

#### Scenario: A student views an anonymous answer
- **WHEN** any student views an anonymous answer
- **THEN** its contributor list is null

#### Scenario: Staff view an anonymous answer
- **WHEN** a current TA views an anonymous answer
- **THEN** its active contributors are visible

### Requirement: Staff endorse and delete answers conditionally

`PUT /api/v1/answers/{answerId}/endorsement` SHALL let staff endorse an active answer with a current `If-Match`; the endorsed answer becomes immutable and its document closes. `DELETE /api/v1/answers/{answerId}` SHALL let staff delete an unendorsed answer with a current `If-Match`; it disappears from reads. Missing and stale ETags SHALL return `428 precondition_required` and `412 version_conflict`. Student requests SHALL return `403 permission_denied`; archived/deleting courses `409 course_archived`; hidden content `404 not_found`; deleting an endorsed answer `409 answer_endorsed`.

#### Scenario: Staff endorses a card
- **WHEN** a TA endorses an unendorsed card with the current ETag
- **THEN** the answer version advances, its document closes, and subsequent edits fail

#### Scenario: A TA endorses the students' answer
- **WHEN** a TA endorses a legacy student-origin card
- **THEN** the card is endorsed and its document closes

#### Scenario: A student tries to endorse
- **WHEN** a student requests endorsement
- **THEN** the API returns `403 permission_denied`

#### Scenario: Staff delete an answer
- **WHEN** staff delete an unendorsed card with its current ETag
- **THEN** it is absent from subsequent lists

### Requirement: Public collaborative editing and attachments remain unavailable

`PATCH /api/v1/answers/{answerId}` SHALL accept a JSON `bodyMarkdown` edit with a current `If-Match` from a current member whose current role is at least the creator-role edit floor. The creator role snapshot SHALL not change as others contribute. The server SHALL update `Y.Text('content')`, persisted Yjs state, Markdown projection, version, timestamp, and distinct contributor atomically. Missing/stale ETags SHALL return `428`/`412`; insufficient role SHALL return `403`; endorsed/deleted/hidden answers and inactive courses SHALL reject edits. The route SHALL reject attachments and multipart requests. WebSocket tickets and public Hocuspocus editing SHALL remain unavailable.

#### Scenario: Student edits student-origin answer
- **WHEN** a current student edits a student-origin answer at its current version
- **THEN** the edited Markdown and Yjs text match, the version advances, and the student appears once in contributors

#### Scenario: Concurrent REST editors
- **WHEN** two editors save against the same answer version
- **THEN** one succeeds and the other receives `412 version_conflict` without changing its draft or persisted text

#### Scenario: Role floor remains stable
- **WHEN** an instructor edits a student-origin answer and a student edits it afterward
- **THEN** the student's edit remains permitted because the creator-role floor is still student

#### Scenario: A client tries to edit an answer
- **WHEN** an authorized member sends a valid versioned Markdown edit
- **THEN** the answer text and Yjs state change atomically

### Requirement: Tests derive from the answers contract

PostgreSQL-backed HTTP tests in isolated schemas SHALL cover success responses and headers, authentication and CSRF, validation, revisions, role floor and current-role checks, legacy migration, anonymity, idempotency, cross-course isolation, lifecycle constraints, and Yjs/Markdown transaction consistency. Each behavior slice SHALL fail for the expected reason before implementation.

#### Scenario: Regression exposes private editor identity
- **WHEN** a student response includes contributors for an anonymous answer
- **THEN** an automated test fails

#### Scenario: A regression exposes an anonymous contributor
- **WHEN** anonymous contributor IDs appear in a student's response
- **THEN** an HTTP test fails
