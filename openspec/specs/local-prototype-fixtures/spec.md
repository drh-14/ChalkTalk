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

On first enabled run, the step SHALL atomically create AMS161, a loggable full-name instructor, a full-name teaching assistant, and full-name mock student authors, with non-instructor accounts given discarded random credentials except the dedicated student when its optional password is configured. It SHALL seed Calculus II questions and notes written by the instructor, the teaching assistant, and students, with creation times spread from minutes to months before the seed ran. Posts SHALL carry tags; some SHALL be pinned, some SHALL be anonymous, and some questions SHALL have student or staff answers, including an endorsed student answer, while others stay unanswered. A post's last activity SHALL be its latest answer, or its creation when it has none. Three questions SHALL have similar counterparts so an instructor can find and merge them manually. No question SHALL start with a duplicate status or target.

#### Scenario: Instructor explores the prototype

- **WHEN** the fixture has been seeded and the instructor signs in with the locally configured password
- **THEN** all seeded posts appear in the ordinary feed, similar questions can be found through search, and the staff duplicate-review list is empty until an instructor merges a question

#### Scenario: Feed filters have data to show

- **WHEN** a course member filters the seeded feed by notes, pinned posts, answered or unanswered questions, TA posts, or a tag
- **THEN** each filter returns at least one seeded post, and the feed shows both recent relative times and older full dates

### Requirement: Repeated startup preserves local edits

The seed SHALL use a reserved UUIDv7 organization marker with a `.invalid` domain and a transaction to preserve existing fixture state on repeat or concurrent runs, apart from the conservative statistics repair, exact-original-body formatting repair and dedicated student addition specified by this change. The fixed course ID SHALL also be UUIDv7. Before any repeat-run write, it SHALL lock and check the reserved course's lifecycle status. A missing or deleting course SHALL remain untouched, including no new dedicated student account. It SHALL not recreate a deleted course, reset a password, overwrite an edited post, or remerge an unmerged duplicate. A collision with reserved fixture identifiers before initial creation SHALL fail without partial writes.

#### Scenario: Compose starts after a post was edited

- **WHEN** the mock-data step runs again after a successful seed
- **THEN** the edited post, existing account credentials, user-edited bodies and all endorsements remain unchanged while only the specified safe statistics repair, exact-original-body formatting repair or missing dedicated student addition can run

#### Scenario: Course deletion overlaps a repeat seed

- **WHEN** the reserved course is missing or deleting when a repeat seed obtains its course lock
- **THEN** the seed adds no student account or membership and writes no statistics or body repairs

### Requirement: Fixture statistics reflect persisted activity

The seed SHALL record question creation counts by original UTC creation date and answer contribution events at original answer creation time. It SHALL NOT fabricate view events or change course creation time. An existing reserved demo course SHALL be repaired only when both its question counts and answer contribution events are empty. If either contains records, the seed SHALL preserve both and report that statistics repair was skipped. Repairs SHALL be atomic and serialized against concurrent activity writes.

#### Scenario: Initial seed has useful statistics

- **WHEN** the instructor requests student statistics after an enabled fresh seed
- **THEN** questions and distinct contributed answers appear in their original activity periods and views remain zero

#### Scenario: Existing demo has no tracking records

- **WHEN** an enabled repeat seed finds both tracking tables empty for the reserved course
- **THEN** it restores counts and contributions from persisted content without changing existing accounts or user-edited content, and subsequent runs do not duplicate statistics

#### Scenario: Existing statistics have history

- **WHEN** either tracking table has records for the course
- **THEN** the repeat seed leaves both tracking tables unchanged, including historical counts for deleted questions

### Requirement: Fixture math uses rendered LaTeX

Mathematical expressions in fixture question and answer bodies SHALL use delimiters supported by the existing Markdown renderer. This applies to fresh fixtures and exact original existing fixture bodies. Repeat runs SHALL match reserved course, fixture title/type/author and exact legacy body, and answer kind/contributor identity. Only matching bodies SHALL be replaced with equivalent formatted math and their versions incremented once. All user-edited or already formatted bodies, timestamps, contributors, current and historical endorsements, views and activity SHALL remain unchanged. Report changed/skipped counts. Missing/deleting courses SHALL not be repaired.

#### Scenario: Seeded math is read

- **WHEN** a user views a seeded calculus question and answer
- **THEN** expressions render as formatted math instead of raw commands or plain-text formula syntax

#### Scenario: Existing original math is reformatted safely

- **WHEN** an enabled repeat seed encounters an exact original fixture body
- **THEN** equivalent LaTeX replaces only that body, its version increases once, and current/historical endorsements, contributors, timestamps, views and activity remain unchanged

#### Scenario: Custom and already formatted text is preserved

- **WHEN** the fixture body was edited by a user or already formatted by a prior seed
- **THEN** the body and version remain unchanged

### Requirement: Dedicated demo student login

Enabled AMS161 mock data SHALL include Riley Nguyen at riley.nguyen@ams161.mock.chalktalk.invalid with student course membership and zero seeded activity. AMS161_DEMO_STUDENT_PASSWORD SHALL be optional, validated as 12–128 characters when provided, and used only when creating the dedicated account; absent configuration SHALL retain the existing random discarded mock-password fallback. Repeat runs SHALL add the missing reserved student account/membership to an existing complete demo without changing any existing password, identity fields, roles, content or endorsements. Reserved account ID/email, organization, deleted-account or membership collisions SHALL fail atomically rather than adopt or overwrite another identity. A legacy organization marker without the reserved course SHALL remain unchanged.

#### Scenario: Fresh or existing complete demo creates a student login

- **WHEN** enabled seeding supplies a valid optional student password and the dedicated account does not exist
- **THEN** Riley can authenticate and access AMS161 as a student, and statistics show zero activity for Riley

#### Scenario: Repeated seed preserves an existing login

- **WHEN** seeding runs repeatedly or concurrently with a different optional student password
- **THEN** the original account and credentials remain unchanged and there is exactly one student membership

#### Scenario: Student configuration or identity is unsafe

- **WHEN** a provided student password is invalid or a reserved account/membership identity collides
- **THEN** the seed rejects the operation without partial account, membership or other fixture writes
