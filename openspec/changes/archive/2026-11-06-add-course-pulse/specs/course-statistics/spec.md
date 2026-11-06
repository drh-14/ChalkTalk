## ADDED Requirements

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
