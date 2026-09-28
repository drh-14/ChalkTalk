## ADDED Requirements

### Requirement: Question detail shows the students' and instructors' answers

When the detail pane shows an active question, it SHALL show a Students' answer section and an Instructors' answer section below the question, loaded from the documented answers list for that post. Notes, deleted posts, and staff duplicate review SHALL not show answer sections. Each section SHALL show loading, error with retry, and empty states. An existing answer SHALL render its Markdown safely, like post bodies, together with its creation time and its viewer-projected contributors. An anonymous answer whose contributors are hidden SHALL show "Anonymous", and an answer with no visible contributors SHALL show "Deleted user". An endorsed answer SHALL show that it is endorsed.

A member whose role matches an empty section (students for the students' answer; TAs and instructors for the instructors' answer) SHALL be able to write that answer with an optional anonymity choice. The composer SHALL require a trimmed nonempty body of at most 100,000 characters, send the documented create request with CSRF and an idempotency key, prevent duplicate submission while pending, keep the draft on failure, and explain that the answer cannot be edited after posting in this phase. A `409 answer_kind_exists` response SHALL reload the answers instead of showing a second composer. TAs and instructors SHALL be able to endorse an unendorsed answer and to delete an unendorsed answer after confirming, sending the answer's current ETag. Students SHALL not see endorse or delete controls. Answer controls SHALL be unavailable when the course is archived or deleting.

#### Scenario: A student answers an unanswered question

- **WHEN** a student opens a question with no students' answer and submits a valid answer
- **THEN** the browser sends the documented create request and shows the created answer in the Students' answer section without a composer

#### Scenario: Another student posted first

- **WHEN** a student submits an answer but the API returns `409 answer_kind_exists`
- **THEN** the browser reloads the answers and shows the existing students' answer

#### Scenario: A TA endorses an answer

- **WHEN** a TA endorses the students' answer
- **THEN** the browser sends a conditional endorsement request and the section shows the answer as endorsed without endorse or delete controls

#### Scenario: A student views a note

- **WHEN** a student opens a note
- **THEN** no answer sections or answer composers appear
