# local-prototype-fixtures Specification

## Purpose

Provide opt-in, local-only AMS161 discussion data for exercising course, post-search, and duplicate-review workflows without populating CI or production databases.

## Requirements

### Requirement: AMS161 mock data is explicit and local-only

The full-stack Compose profile SHALL run a one-shot mock-data step after migrations and before the API. Unless `MOCK_DATA=true`, the step SHALL succeed without a database write or demo password. An enabled step SHALL require `AMS161_DEMO_INSTRUCTOR_PASSWORD` of 12–128 characters. The tracked environment template SHALL default to `MOCK_DATA=false`, and CI SHALL assert the fixture organization is absent.

#### Scenario: Default CI or local startup

- **WHEN** the mock-data step runs with `MOCK_DATA=false`
- **THEN** it succeeds without inserting fixture records or requiring an instructor password

### Requirement: Prototype contains realistic course discussion

On first enabled run, the step SHALL atomically create AMS161, a loggable full-name instructor, a full-name teaching assistant, and full-name mock student authors, with every non-instructor account given a discarded random credential. It SHALL seed Calculus II questions and notes written by the instructor, the teaching assistant, and students, with creation times spread from minutes to months before the seed ran. Posts SHALL carry tags; some SHALL be pinned, some SHALL be anonymous, and some questions SHALL have student or staff answers, including an endorsed student answer, while others stay unanswered. A post's last activity SHALL be its latest answer, or its creation when it has none. Three questions SHALL have similar counterparts so an instructor can find and merge them manually. No question SHALL start with a duplicate status or target.

#### Scenario: Instructor explores the prototype

- **WHEN** the fixture has been seeded and the instructor signs in with the locally configured password
- **THEN** all seeded posts appear in the ordinary feed, similar questions can be found through search, and the staff duplicate-review list is empty until an instructor merges a question

#### Scenario: Feed filters have data to show

- **WHEN** a course member filters the seeded feed by notes, pinned posts, answered or unanswered questions, TA posts, or a tag
- **THEN** each filter returns at least one seeded post, and the feed shows both recent relative times and older full dates

### Requirement: Repeated startup preserves local edits

The seed SHALL use a reserved UUIDv7 organization marker with a `.invalid` domain and a transaction to make repeat or concurrent runs no-ops after success. The fixed course ID SHALL also be UUIDv7. It SHALL not recreate a deleted course, reset a password, overwrite an edited post, or remerge an unmerged duplicate. A collision with reserved fixture identifiers before initial creation SHALL fail without partial writes.

#### Scenario: Compose starts after a post was edited

- **WHEN** the mock-data step runs again after a successful seed
- **THEN** the edited post and all other fixture state remain unchanged
