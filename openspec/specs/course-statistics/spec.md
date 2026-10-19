# course-statistics Specification

## Purpose

Course statistics let instructors and teaching assistants inspect recorded discussion activity and current student participation without exposing those data to students.

## Requirements

### Requirement: Daily post views

The system SHALL record at most one view for each authenticated member, active canonical post, and UTC date after a successful post-detail read. Failed, redirected, deleted, and duplicate-review reads SHALL NOT record views. A failed recording attempt SHALL NOT fail a successful post read.

#### Scenario: Same-day reload

- **WHEN** a member successfully reads the same active post twice on one UTC date
- **THEN** the system records one view

#### Scenario: Hidden post

- **WHEN** a member is denied a post read or receives a duplicate redirect
- **THEN** the system records no view

### Requirement: Answer contribution activity

The system SHALL record each successful answer creation and each content-changing REST or live answer edit with the actor and timestamp. A student SHALL receive at most one contribution count per distinct answer within a selected period.

#### Scenario: New answer

- **WHEN** a member creates an answer
- **THEN** a contribution event is saved in the same transaction

### Requirement: Staff-only course summary

The system SHALL serve course statistics to current instructors and TAs for `7d`, `30d`, and `course_to_date` periods, defaulting to `30d`. It SHALL provide zero-filled UTC daily questions, answers, and recorded views, total recorded views, and mean response time from question creation to the creation of the answer first endorsed during the selected period. The mean SHALL be null if no question qualifies.

#### Scenario: Authorized summary

- **WHEN** current staff requests a valid period
- **THEN** the system returns a `200` JSON course summary and generated timestamp

#### Scenario: Unauthorized summary

- **WHEN** a current student requests statistics
- **THEN** the system returns `403 permission_denied`

#### Scenario: Invalid period

- **WHEN** staff requests an unsupported period
- **THEN** the system returns `400 invalid_request`

### Requirement: Current student statistics

The system SHALL paginate current student members in stable order, including those with zero activity, and report questions created, distinct answers contributed, and recorded post views in the period. It SHALL retain each creator's question count by UTC day after post soft deletion using a count with no post identifier, and SHALL remove that count on account deletion. Migration SHALL backfill active questions but SHALL NOT reconstruct previously deleted questions. Historical activity SHALL remain in course totals after membership or role changes.

#### Scenario: Deleted question attribution

- **WHEN** a student creates a question and the post is later soft-deleted
- **THEN** the student's period count retains that creation without retaining a link to the deleted post

#### Scenario: Account deletion

- **WHEN** a question creator deletes their account
- **THEN** their per-student question counts are removed while course daily totals remain

#### Scenario: Zero-activity current student

- **WHEN** a current student has no events in the selected period
- **THEN** their row appears with zero counts

#### Scenario: Cursor scoped to request

- **WHEN** a cursor is reused for a different course or period
- **THEN** the system returns `400 invalid_request`

### Requirement: Statistics course tab

The course navigation SHALL show Statistics only to staff and SHALL present period selection, daily activity, summary metrics, pagination, and loading, empty, and retry states. The UI SHALL explain that recorded view history starts at deployment. The average response time caption SHALL read “Time from question to first endorsed answer.” When the selected period has no endorsed answer and the mean response time is null, the metric SHALL display “No answers” in the same size and bold weight as the other metric values.

#### Scenario: No daily activity

- **WHEN** every UTC day in the selected period has zero questions, answers, and views
- **THEN** the UI shows the no-activity state instead of an empty chart

#### Scenario: Staff opens Statistics

- **WHEN** a staff member opens the Statistics tab
- **THEN** they can inspect the selected period and page through current students

#### Scenario: Student course navigation

- **WHEN** a student opens a course
- **THEN** the Statistics tab is absent

#### Scenario: No endorsed answer in the period

- **WHEN** the selected period has no qualifying endorsed answer
- **THEN** the average response time metric shows “No answers” in the same size and bold weight as other metric values
