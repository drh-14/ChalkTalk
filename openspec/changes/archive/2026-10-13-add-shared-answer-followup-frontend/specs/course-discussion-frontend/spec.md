## MODIFIED Requirements

### Requirement: Question detail shows the students' and instructors' answers

When the detail pane shows an active question, it SHALL show exactly one Students' answer area and one Instructors' answer area with distinct colors below the question, loaded from the documented answer list. Notes, deleted posts, and staff duplicate review SHALL not show answer areas. Each area SHALL show loading, retryable error, and empty states. A present answer SHALL safely render its Markdown and LaTeX, creation or edit time, viewer-projected contributors, current endorsement, and an upvote control beneath its content. Anonymous contributors hidden by the API SHALL show "Anonymous"; no visible contributors SHALL show "Deleted user".

A member whose role matches an empty slot (student for student, TA or instructor for staff) SHALL be able to create its answer with optional anonymity through the shared Markdown/LaTeX composer. The composer SHALL require a trimmed nonempty body of at most 100,000 characters, send CSRF and an idempotency key, prevent duplicate submission, and retain the draft on failure. A `409 answer_kind_exists` response SHALL refresh the occupied slot while retaining the unfinished draft for comparison or copying. A present answer SHALL offer versioned REST editing only when its server-projected `canEdit` is true. A `412 version_conflict` SHALL keep the editor and draft open and offer an explicit refresh without replacing local text. TAs and instructors SHALL be able to endorse an unendorsed answer and delete an unendorsed answer after confirmation, using its current ETag. A content edit SHALL update the visible answer and may clear its current endorsement. Answer controls SHALL be unavailable in archived or deleting courses.

#### Scenario: A student answers an unanswered question

- **WHEN** a student opens a question with no students' answer and submits a valid answer
- **THEN** the browser sends the documented create request and shows the created answer in the Students' answer area without a composer

#### Scenario: Another student posted first

- **WHEN** a student submits an answer but the API returns `409 answer_kind_exists`
- **THEN** the browser reloads the occupied student slot and preserves the local draft

#### Scenario: A TA endorses an answer

- **WHEN** a TA endorses the students' answer
- **THEN** the browser sends a conditional endorsement request and shows the current endorsement; after a content edit clears it, staff may endorse again

#### Scenario: A student views a note

- **WHEN** a student opens a note
- **THEN** no answer areas or answer composers appear

#### Scenario: Stale answer edit

- **WHEN** an answer save receives `412 version_conflict`
- **THEN** the editor remains open with the local draft and an explicit refresh action

#### Scenario: Member votes on an answer

- **WHEN** a member toggles an answer upvote
- **THEN** the count and viewer state beneath the answer update without changing the content version

## ADDED Requirements

### Requirement: Question detail presents question-level followup discussions

The question detail SHALL show a root followup count and a prominent zero-followup compose prompt. Members SHALL create roots and nested replies using the shared Markdown/LaTeX composer and optional anonymity. The page SHALL list roots and direct replies with cursor-based loading, render bodyless deleted parent tombstones when children remain, and show vote controls beneath active followup content. Author and staff edit/delete controls SHALL follow server-projected `canEdit`; other members SHALL not see them. Failed writes and version conflicts SHALL preserve draft text and offer explicit refresh. Followup content SHALL render Markdown and LaTeX but SHALL not offer media upload.

#### Scenario: Empty followups

- **WHEN** a member opens a question with no followup roots
- **THEN** a zero count and prominent compose prompt are displayed

#### Scenario: Nested followup and tombstone

- **WHEN** a member opens a deleted parent with visible replies
- **THEN** the bodyless tombstone and nested replies remain navigable

#### Scenario: Followup vote and pagination

- **WHEN** a member votes on a followup and loads the next root page
- **THEN** the vote count updates beneath that followup and additional roots append without duplicate entries
