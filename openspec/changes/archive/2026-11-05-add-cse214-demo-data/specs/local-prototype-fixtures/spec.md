## RENAMED Requirements

- FROM: `### Requirement: Demo seed loads the CSE 416 Piazza course`
- TO: `### Requirement: Demo seed loads the committed Piazza courses`

## MODIFIED Requirements

### Requirement: Demo seed loads the committed Piazza courses

When mock data is enabled, the mock-data step SHALL, after seeding AMS161, import each committed Piazza export (CSE 416-03 Software Engineering, then CSE 214-01 Data Structures) as a course owned by the AMS161 demo instructor, with the same content an import of that export produces. It SHALL import each course only while that course is absent, so a repeated startup SHALL not change it or overwrite local edits, and SHALL report each course as created or already present. Imported accounts SHALL receive `PIAZZA_DEMO_PASSWORD` when it is set to 12–128 characters, and discarded random credentials otherwise; an invalid value SHALL fail the step before any course is imported. With mock data disabled, the step SHALL not import any Piazza course.

#### Scenario: Instructor sees CSE 416 after first startup

- **WHEN** the mock-data step runs for the first time with mock data enabled
- **THEN** the demo instructor is an instructor of CSE 416 and CSE 214, and each course's imported posts appear in its feed

#### Scenario: A repeated startup keeps local edits

- **WHEN** an imported CSE 416 post is edited and the mock-data step runs again
- **THEN** the step reports both courses as already present and the edit remains
