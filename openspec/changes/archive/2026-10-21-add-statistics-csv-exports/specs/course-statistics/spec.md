## ADDED Requirements

### Requirement: Staff statistics CSV exports

The system SHALL allow current instructors and TAs to download separate UTF-8 CSV files for daily activity and the complete current-student roster for the selected `7d`, `30d`, or `course_to_date` period, defaulting to `30d` when the API period is omitted. Daily rows SHALL include every UTC date in the period, including zero-activity dates, with `date,questions_created,answers_created,posts_viewed` columns. Student rows SHALL include every current, non-deleted student, including those with zero activity, in stable user-ID order with `user_id,display_name,questions_created,answers_contributed,posts_viewed` columns. Each export SHALL use the existing statistics counting and privacy rules, not just rows loaded in the browser. CSV text fields SHALL be quoted as needed and neutralized against spreadsheet formula execution. Successful responses SHALL use `text/csv; charset=utf-8`, attachment disposition with a period-specific CSV filename, and `Cache-Control: private, no-store`.

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
