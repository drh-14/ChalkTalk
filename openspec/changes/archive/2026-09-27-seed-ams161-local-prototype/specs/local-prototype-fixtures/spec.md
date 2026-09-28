## ADDED Requirements

### Requirement: AMS161 mock data is explicit and local-only

The full-stack Compose profile SHALL run a one-shot mock-data step after migrations and before the API. Unless `MOCK_DATA=true`, the step SHALL succeed without a database write or demo password. An enabled step SHALL require `AMS161_DEMO_INSTRUCTOR_PASSWORD` of 12–128 characters. The tracked environment template SHALL default to `MOCK_DATA=false`, and CI SHALL assert the fixture organization is absent.

#### Scenario: Default CI or local startup

- **WHEN** the mock-data step runs with `MOCK_DATA=false`
- **THEN** it succeeds without inserting fixture records or requiring an instructor password

### Requirement: Prototype contains realistic course discussion

On first enabled run, the step SHALL atomically create AMS161, a loggable full-name instructor, three full-name mock student authors with discarded random credentials, nine Calculus II questions, and three confirmed same-course duplicates that target active canonical questions. Confirmed duplicates SHALL follow the existing post visibility rules.

#### Scenario: Instructor explores the prototype

- **WHEN** the fixture has been seeded and the instructor signs in with the locally configured password
- **THEN** the instructor can access AMS161 and review three confirmed duplicates while student search excludes them

### Requirement: Repeated startup preserves local edits

The seed SHALL use a reserved UUIDv7 organization marker with a `.invalid` domain and a transaction to make repeat or concurrent runs no-ops after success. The fixed course ID SHALL also be UUIDv7. It SHALL not recreate a deleted course, reset a password, overwrite an edited post, or remerge an unmerged duplicate. A collision with reserved fixture identifiers before initial creation SHALL fail without partial writes.

#### Scenario: Compose starts after a post was edited

- **WHEN** the mock-data step runs again after a successful seed
- **THEN** the edited post and all other fixture state remain unchanged
