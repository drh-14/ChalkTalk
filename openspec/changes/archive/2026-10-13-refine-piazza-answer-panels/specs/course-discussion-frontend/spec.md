## MODIFIED Requirements

### Requirement: Question detail shows the students' and instructors' answers

When the detail pane shows an active question, it SHALL show exactly one Students' answer area in green and one Instructors' answer area in amber below the question, loaded from the documented answer list. Notes, deleted posts, and staff duplicate review SHALL not show answer areas. Each area SHALL show loading, retryable error, and empty states. A writable empty area SHALL initially show a compact click-to-start prompt rather than an expanded editor. Activating the prompt SHALL open the shared Markdown/LaTeX composer. Canceling a draft SHALL return to the prompt. Read-only empty areas SHALL state that no answer exists without a write prompt. A present answer SHALL safely render its Markdown and LaTeX, creation or edit time, viewer-projected contributors, current endorsement, and an upvote control beneath its content. Anonymous contributors hidden by the API SHALL show "Anonymous"; no visible contributors SHALL show "Deleted user".

A member whose role matches an empty slot (student for student, TA or instructor for staff) SHALL be able to create its answer with optional anonymity through the shared Markdown/LaTeX composer. The composer SHALL require a trimmed nonempty body of at most 100,000 characters, send CSRF and an idempotency key, prevent duplicate submission, and retain the draft on failure. A `409 answer_kind_exists` response SHALL refresh the occupied slot while retaining the unfinished draft for comparison or copying. A present answer SHALL offer versioned REST editing only when its server-projected `canEdit` is true. A `412 version_conflict` SHALL keep the editor and draft open and offer an explicit refresh without replacing local text. TAs and instructors SHALL be able to endorse an unendorsed answer and delete an unendorsed answer after confirmation, using its current ETag. A content edit SHALL update the visible answer and may clear its current endorsement. Answer controls SHALL be unavailable in archived or deleting courses.

#### Scenario: Student starts an empty answer

- **WHEN** a student opens a question without a student answer and activates the student answer prompt
- **THEN** the student composer opens with Markdown and LaTeX formatting controls and the staff area remains read-only

#### Scenario: Student cancels an empty answer

- **WHEN** a student cancels the empty student answer composer
- **THEN** the compact click-to-start prompt returns and no answer is sent

#### Scenario: Member switches questions with an open draft

- **WHEN** a member navigates to another question while an answer draft is open
- **THEN** the new question starts with its own answer state and does not show the previous question's draft

#### Scenario: Populated answer

- **WHEN** a question has a student or staff answer
- **THEN** the matching colored area renders its answer, with its upvote control beneath the text

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
