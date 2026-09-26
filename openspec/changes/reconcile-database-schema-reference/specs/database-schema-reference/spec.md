## ADDED Requirements

### Requirement: Database reference records the agreed target schema

`documentation/database.md` SHALL document the agreed intended ChalkTalk
schema independently of the currently implemented migration subset. It SHALL
use `organizations.domain` and `users.email`, normalized tags and post-tag
associations, the agreed composite keys, explicit attachment parents, and the
answer-editor set.

#### Scenario: A schema reader needs the intended model

- **WHEN** a reader consults `documentation/database.md`
- **THEN** they can identify table keys, foreign keys, and integrity rules for
  the agreed target schema without relying on ER diagrams or migration files

### Requirement: Course-scoped references remain internally consistent

The reference SHALL document direct course scope on agreed descendant tables
and composite foreign keys that require that scope to match the referenced
parent.

#### Scenario: A child references a parent in another course

- **WHEN** a future implementation attempts to store mismatched course and
  parent identifiers
- **THEN** the documented composite foreign key design rejects the row

### Requirement: Diagram and migration work is explicitly deferred

This change SHALL not modify ER diagram artifacts, SQL migrations, API code,
or deployed behavior. The reference SHALL retain agreed supporting tables that
current ER views do not depict.

#### Scenario: A reviewer checks the change scope

- **WHEN** the reviewer examines the changed files
- **THEN** they find the database reference and this OpenSpec change, but no
  diagram, migration, or application-behavior change
