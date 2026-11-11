## MODIFIED Requirements

### Requirement: Staff-only course summary

The system SHALL serve course statistics to current instructors and TAs for `7d`, `30d`, and `course_to_date` periods, defaulting to `30d`. `course_to_date` SHALL start on the earlier UTC date of course creation or the earliest retained statistics-bearing activity, including historical imported activity. The system SHALL provide zero-filled UTC daily questions, answers, and recorded views, total recorded views, and mean response time from question creation to creation of the answer first endorsed during the selected period. The mean SHALL be null if no question qualifies.

#### Scenario: Imported history precedes course creation

- **WHEN** staff requests `course_to_date` statistics after importing historically dated questions, answers, contribution events, and endorsements
- **THEN** the summary includes those events from their original UTC dates and zero-fills intervening days; `7d` and `30d` retain their fixed windows

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

The system SHALL paginate current student members in stable order, including those with zero activity, and report questions created, distinct answers contributed, and recorded post views in the period. For `course_to_date`, historical imported attribution SHALL be counted from its original UTC date even when it predates course creation. It SHALL retain each creator's question count by UTC day after post soft deletion using a count with no post identifier, and SHALL remove that count on account deletion. Migration SHALL backfill active questions but SHALL NOT reconstruct previously deleted questions. Historical activity SHALL remain in course totals after membership or role changes.

#### Scenario: Imported student attribution

- **WHEN** an imported question or answer contribution predates the ChalkTalk course and its author is a current student
- **THEN** the student's `course_to_date` counts include the retained historical attribution

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

### Requirement: Staff statistics CSV exports

The system SHALL allow current instructors and TAs to download separate UTF-8 CSV files for daily activity and the complete current-student roster for the selected `7d`, `30d`, or `course_to_date` period, defaulting to `30d` when the API period is omitted. `course_to_date` exports SHALL use the same historical boundary as the summary and student endpoints. Daily rows SHALL include every UTC date in the period, including zero-activity dates, with `date,questions_created,answers_created,posts_viewed` columns. Student rows SHALL include every current, non-deleted student, including those with zero activity, in stable user-ID order with `user_id,display_name,questions_created,answers_contributed,posts_viewed` columns. Each export SHALL use the existing statistics counting and privacy rules, not just rows loaded in the browser. CSV text fields SHALL be quoted as needed and neutralized against spreadsheet formula execution. Successful responses SHALL use `text/csv; charset=utf-8`, attachment disposition with a period-specific CSV filename, and `Cache-Control: private, no-store`.

#### Scenario: Export imported history

- **WHEN** staff downloads `course_to_date` daily and roster CSVs for an imported course
- **THEN** both exports include the same pre-creation activity and attribution exposed by their JSON endpoints

#### Scenario: Staff downloads daily activity

- **WHEN** staff requests the daily CSV for a valid period
- **THEN** the response includes one row for every UTC date with the documented columns and counts matching the course summary

#### Scenario: Staff downloads the complete roster

- **WHEN** the current student roster exceeds one browser page and staff requests its CSV
- **THEN** the file includes all current students, including zero-activity students, with the documented columns and counts matching student statistics

#### Scenario: Untrusted student display name

- **WHEN** a display name starts with a spreadsheet formula trigger or contains a CSV delimiter, quote, or line break
- **THEN** the CSV encodes it as data rather than an executable formula or a new column or row

#### Scenario: Unauthorized or invalid export

- **WHEN** a student, nonmember, unauthenticated caller, or staff member with an invalid period requests an export
- **THEN** the API applies the existing statistics access and period errors without exposing CSV data
