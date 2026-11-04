## ADDED Requirements

### Requirement: Course settings confirm destructive instructor actions

Course settings SHALL require an explicit in-app confirmation before an instructor removes another member or starts deleting a course. The confirmation SHALL identify the affected member or course, explain the consequence, and offer both Cancel and an action-specific destructive button. Opening or canceling the confirmation SHALL NOT issue a destructive request. The confirmation SHALL support keyboard dismissal and contain keyboard focus while open; dismissing it SHALL restore focus to its trigger when available. A failed request SHALL remain recoverable. Following a stale-version response, retrying the destructive action SHALL require a fresh confirmation of current course or member details rather than directly resending the deletion.

#### Scenario: Instructor cancels member removal

- **WHEN** an instructor opens the Remove confirmation for another member and selects Cancel or presses Escape
- **THEN** no membership deletion is sent and the member remains on the roster

#### Scenario: Instructor confirms member removal

- **WHEN** an instructor confirms removal of a named member
- **THEN** the existing conditional membership deletion is sent once and the roster refreshes on success

#### Scenario: Instructor cancels course deletion

- **WHEN** an instructor opens the Delete course confirmation and selects Cancel or presses Escape
- **THEN** no course deletion is sent and the course remains available

#### Scenario: Instructor confirms course deletion

- **WHEN** an instructor confirms deletion of the named course
- **THEN** the existing conditional course deletion is sent once and the deleting state is shown on success

#### Scenario: Destructive mutation has stale state

- **WHEN** a confirmed course or member deletion receives a stale-version response
- **THEN** course settings refreshes current details and a retry opens a fresh confirmation without deleting automatically
