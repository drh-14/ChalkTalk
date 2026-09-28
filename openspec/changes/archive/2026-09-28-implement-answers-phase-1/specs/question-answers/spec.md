## Purpose

Lets course members answer question posts through one shared students' answer and one shared instructors' answer per question, which staff can endorse or delete, with identity-safe contributor projections.

## ADDED Requirements

### Requirement: Members create one shared answer of their kind per question

`POST /api/v1/posts/{postId}/answers` SHALL accept the documented JSON `CreateContentRequest` from a current member of the question's course, derive `kind` as `student` for students and `staff` for TAs and instructors, and return `201` with `Location: /api/v1/answers/{answerId}`, an ETag, and the documented active answer (`version: 1`, `attachments: []`, `endorsedAt: null`, `endorsedBy: null`). In one transaction the server SHALL create the answer, its collaboration document record, and a contributor record for the caller, and SHALL roll back all three if any part fails. A question SHALL have at most one active answer of each kind, including under concurrent requests; a second attempt SHALL return `409 answer_kind_exists`. `bodyMarkdown` SHALL be a string of 1–100,000 characters that is not only whitespace, and `anonymous` SHALL be an optional boolean defaulting to `false`; other fields or invalid values SHALL return `422 validation_failed`. A matching `Idempotency-Key` retry within 24 hours SHALL return the original result without creating another answer, document, or contributor record, and reuse with a different body SHALL return `409 idempotency_key_reused`. Creating an answer on a note SHALL return `409 not_a_question`; on a deleted, merged-duplicate, absent, or other-course post, or for a non-member, it SHALL return `404 not_found`; in an archived or deleting course it SHALL return `409 course_archived`. Unsafe answer requests SHALL require an allowed `Origin` and the session CSRF token.

#### Scenario: A student answers a question

- **WHEN** a student posts a valid answer to an unanswered question
- **THEN** the API returns `201`, `Location`, an ETag, and a `student` answer whose contributors list the student

#### Scenario: Two students answer at once

- **WHEN** two students concurrently create the students' answer to the same question
- **THEN** exactly one succeeds and the other receives `409 answer_kind_exists`

#### Scenario: A TA answers after a student

- **WHEN** a TA creates an answer to a question that already has a students' answer
- **THEN** the API creates a separate `staff` answer

#### Scenario: A member tries to answer a note

- **WHEN** a member posts an answer to a note
- **THEN** the API returns `409 not_a_question` and writes nothing

### Requirement: Members read a question's answers

`GET /api/v1/posts/{postId}/answers` SHALL return `200` with a `data` array containing at most the active students' answer and the active staff answer, students' answer first. It SHALL return `422 not_a_question` for a note and `404 not_found` for an absent, deleted, merged-duplicate, or other-course post or a non-member. `GET /api/v1/answers/{answerId}` SHALL return `200` with the active answer and its ETag, and `404 not_found` for an absent or deleted answer, an answer whose question is deleted or a merged duplicate, or a non-member. Every read SHALL require a valid session.

#### Scenario: A member lists answers

- **WHEN** a course member lists the answers to a question with both answer kinds
- **THEN** the API returns the students' answer followed by the staff answer

#### Scenario: A former member reads an answer

- **WHEN** a user whose course membership was removed requests an answer by ID
- **THEN** the API returns `404 not_found`

### Requirement: Answer contributors follow identity visibility

`contributors` SHALL list `{id, displayName}` for each contributor of a nonanonymous answer. For an anonymous answer it SHALL list contributors to TAs and instructors and SHALL be `null` for every student, including the answer's own contributors. Contributors whose accounts are deleted SHALL be omitted, so no deleted account's ID is exposed. `endorsedBy` SHALL be the endorsing staff member's user ID.

#### Scenario: A student views an anonymous answer

- **WHEN** a student, including the answer's author, reads an anonymous answer
- **THEN** `anonymous` is `true` and `contributors` is `null`

#### Scenario: Staff view an anonymous answer

- **WHEN** a TA reads an anonymous answer
- **THEN** `contributors` lists the answer's contributors

### Requirement: Staff endorse and delete answers conditionally

`PUT /api/v1/answers/{answerId}/endorsement` SHALL let a TA or instructor endorse an active answer of either kind, setting `endorsedAt`, `endorsedBy`, a new `version`, and ETag, and closing the answer's collaboration document. Repeating it with `If-Match` equal to the current endorsed revision SHALL return `200` with the unchanged answer. `DELETE /api/v1/answers/{answerId}` SHALL let a TA or instructor delete an unendorsed answer and return `204`. After deletion the answer SHALL be absent from reads, and a new answer of that kind MAY be created. Both operations SHALL require `If-Match` (`428 precondition_required` when missing, `412 version_conflict` when stale), SHALL return `403 permission_denied` to students, `409 course_archived` in an archived or deleting course, and `404 not_found` for absent, deleted, or hidden answers. Deleting an endorsed answer SHALL return `409 answer_endorsed`.

#### Scenario: A TA endorses the students' answer

- **WHEN** a TA endorses a students' answer with its current ETag
- **THEN** the API returns `200` with `endorsedAt`, `endorsedBy`, and a new ETag

#### Scenario: A student tries to endorse

- **WHEN** a student sends an endorsement request
- **THEN** the API returns `403 permission_denied` and the answer is unchanged

#### Scenario: Staff delete an answer

- **WHEN** an instructor deletes an unendorsed answer with its current ETag
- **THEN** the API returns `204`, the answer disappears from the list, and a new answer of that kind can be created

### Requirement: Collaborative editing and attachments remain outside phase 1

In this phase, `PATCH /api/v1/answers/{answerId}`, answer collaboration connection tickets, answer followup routes, and multipart answer requests SHALL not be live. Their routes SHALL not be registered, and a multipart create request SHALL return `422 validation_failed`. Answer text SHALL not change after creation. `documentation/api/answers.md` SHALL carry an implementation-status note naming what is live and what remains the target contract, while the target definitions are kept.

#### Scenario: A client tries to edit an answer

- **WHEN** a client sends `PATCH /api/v1/answers/{answerId}`
- **THEN** the route is unavailable and the answer is unchanged

### Requirement: Tests derive from the answers contract

PostgreSQL-backed HTTP tests in isolated schemas SHALL be derived from `documentation/api/answers.md`, `documentation/openapi.yaml`, `documentation/database.md`, and `identity-visibility.md`. They SHALL cover each live operation's success response and headers, authentication and CSRF, validation, revision and conflict errors, archived courses, per-kind uniqueness under concurrency, idempotent replay, contributor visibility, cross-course isolation, the `answered` projection and filter, and course-deletion cleanup. Each behavior slice SHALL fail for the expected reason before its implementation.

#### Scenario: A regression exposes an anonymous contributor

- **WHEN** a change returns contributor identities of an anonymous answer to a student
- **THEN** an automated test fails
