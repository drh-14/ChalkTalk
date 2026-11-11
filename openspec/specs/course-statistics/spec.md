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

### Requirement: Statistics export actions

The Statistics tab SHALL offer separate daily activity and student roster downloads for its selected period. It SHALL report a download failure without replacing the visible statistics or forcing a period change.

#### Scenario: Staff selects a period and downloads

- **WHEN** staff chooses a period and activates either export action
- **THEN** the download request uses that selected period and returns the corresponding server-generated CSV

#### Scenario: Download failure

- **WHEN** an export request fails
- **THEN** the tab displays an actionable error while retaining the displayed statistics

### Requirement: Course pulse over the whole question history

`GET /api/v1/courses/{courseId}/statistics/pulse` SHALL return, to current course TAs and instructors only, a summary of every published, non-deleted question in the course regardless of when the course record was created. It SHALL accept an optional `timeZone` query parameter holding an IANA time zone name, default `UTC`, and SHALL reject an unknown zone with `400 invalid_request`. A student SHALL receive `403 permission_denied`, and a non-member or unknown course `404 not_found`. The response SHALL contain:

- `timeZone`, `firstQuestionAt`, and `lastQuestionAt` (both `null` when there are no questions);
- `questions`, `answered`, and `unanswered` totals, where a question is answered when it has at least one non-deleted answer;
- `medianFirstAnswerMinutes`: the median minutes from a question's creation to its first non-deleted answer, over answered questions, or `null`;
- `hours`: 7 arrays of 24 counts of questions created per local weekday (Sunday first) and local hour;
- `weeks`: one entry per local Sunday-to-Saturday week from the first to the last question's week, with `weekStart` (a local date) and `questions`, including weeks with zero questions;
- `topics`: up to 10 tags ordered by question count, then name, each with `tag`, `questions`, `unanswered`, and `medianFirstAnswerMinutes`;
- `helpers`: up to 5 current course members ordered by the number of distinct non-deleted, non-anonymous answers they contributed to, then name, each with `userId`, `displayName`, `role`, and `answers`.

Anonymous answers SHALL never contribute to `helpers`, so no anonymous author is identified. The response SHALL be private and not cached.

#### Scenario: An instructor reviews an imported semester

- **WHEN** an instructor requests the pulse of a course imported with questions from a previous year, with `timeZone=America/New_York`
- **THEN** the response covers those questions, with weekday and hour counts in New York time and weekly entries spanning the imported semester

#### Scenario: Anonymous answers stay anonymous

- **WHEN** a student's only answers in the course are anonymous
- **THEN** that student does not appear in `helpers`

#### Scenario: A student requests the pulse

- **WHEN** a student requests the course pulse
- **THEN** the API returns `403 permission_denied` without statistics

#### Scenario: An unknown time zone

- **WHEN** a TA requests the pulse with `timeZone=Mars/Olympus`
- **THEN** the API returns `400 invalid_request`

### Requirement: Course pulse view

The Statistics tab SHALL offer two views, **Course pulse** (the default) and **Activity** (the existing period-based summary, student table, and exports), and SHALL show the period selector only for Activity. Course pulse SHALL request the pulse in the viewer's time zone and show:

- headline tiles for the busiest weekday-and-hour block, the peak week and its question count, the median time to first answer, and unanswered questions;
- a weekday-by-hour heatmap shaded from light to dark by question count;
- a weekly questions bar chart labeling the peak week;
- a topics table with a proportional bar for questions, unanswered count, and median first-answer time;
- top helpers with their answer counts.

Every heatmap cell and weekly bar SHALL reveal its exact value on hover or keyboard focus, and the heatmap and weekly data SHALL also be available as tables. A course without questions SHALL show an empty state instead of empty charts.

#### Scenario: A TA opens Statistics

- **WHEN** a TA opens the Statistics tab
- **THEN** Course pulse shows the headline tiles, heatmap, weekly chart, topics, and helpers, with no period selector

#### Scenario: A TA switches to Activity

- **WHEN** a TA selects Activity
- **THEN** the existing period selector, summary, student table, and exports appear

#### Scenario: A course with no questions

- **WHEN** a TA opens Course pulse in a course without questions
- **THEN** an empty state explains that the pulse appears once students ask questions
