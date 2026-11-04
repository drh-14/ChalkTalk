## ADDED Requirements

### Requirement: Demo seed loads the CSE 416 Piazza course

When mock data is enabled, the mock-data step SHALL, after seeding AMS161, import the committed CSE 416 Piazza export as a course owned by the AMS161 demo instructor, with the same content an import of that export produces. It SHALL import only when the CSE 416 course is absent, so a repeated startup SHALL not change it or overwrite local edits. Imported accounts SHALL receive `PIAZZA_DEMO_PASSWORD` when it is set to 12–128 characters, and discarded random credentials otherwise; an invalid value SHALL fail the step. With mock data disabled, the step SHALL not import CSE 416.

#### Scenario: Instructor sees CSE 416 after first startup

- **WHEN** the mock-data step runs for the first time with mock data enabled
- **THEN** the demo instructor is an instructor of CSE 416 and its imported posts appear in its feed

#### Scenario: A repeated startup keeps local edits

- **WHEN** an imported CSE 416 post is edited and the mock-data step runs again
- **THEN** the step reports CSE 416 as already present and the edit remains
