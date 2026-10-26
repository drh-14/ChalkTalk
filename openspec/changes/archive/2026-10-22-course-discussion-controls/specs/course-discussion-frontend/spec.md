## ADDED Requirements

### Requirement: Course policy is visible and controls future composers

Course settings SHALL show all three effective discussion switches to members; current instructors SHALL be able to change each one with the existing conditional update and conflict-refresh behavior. New post, answer, followup, and reply composers SHALL omit or disable anonymity controls when disallowed; the new-post composer SHALL not offer a private audience when private posting is disallowed. Existing content and edit controls SHALL remain visible according to their existing authorization. Resolution controls SHALL not offer marker mutation while disabled, while still displaying current marker state. Server rejection SHALL still be presented if policy changes while a composer is open.

#### Scenario: Student views restricted course
- **WHEN** a student opens a course where all three switches are disabled
- **THEN** settings show the effective policy without editable controls, new composers omit disallowed options, and a resolved discussion remains visibly resolved without a resolve action

#### Scenario: Instructor changes policy
- **WHEN** an instructor changes a switch in course settings
- **THEN** the setting saves conditionally and the page shows the server-confirmed value, or refreshes on an ETag conflict
