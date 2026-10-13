## MODIFIED Requirements

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
