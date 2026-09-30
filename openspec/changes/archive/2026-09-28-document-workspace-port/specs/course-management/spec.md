## ADDED Requirements

### Requirement: Home shows only real course data

The signed-in home page SHALL show a greeting with the member's first name, today's date in the viewer's locale, and the member's real course list with its create and join actions. It SHALL not show placeholder discussion content or a hardcoded date.

#### Scenario: A member opens home

- **WHEN** a signed-in member opens `/home` on Tuesday, March 3
- **THEN** the page shows "Tuesday, March 3" and the member's courses, and no sample discussion panel

### Requirement: Course settings are grouped into sections

The course settings route SHALL group its content into labeled sections:

- **Course details:** the course name form, the course status, and the join code with a copy control whenever the API returns one (only for instructors).
- **Members:** the roster, showing each member's role once, as a control where the viewer may manage that member and as a label otherwise.
- **Danger zone:** for instructors, archive or unarchive and delete actions; for other members, Leave course. It is hidden while the course is being deleted.

The page SHALL not overflow horizontally at phone widths. Existing role-based controls, conditional requests, and self-administration restrictions remain unchanged.

#### Scenario: An instructor opens settings

- **WHEN** an instructor opens course settings
- **THEN** the page shows Course details with a copyable join code, Members with one role control per member, and a Danger zone with the archive and delete actions

#### Scenario: A student opens settings

- **WHEN** a student opens course settings
- **THEN** Course details shows no join code, and the Danger zone offers only Leave course

#### Scenario: A member opens settings on a phone

- **WHEN** a member opens course settings at 390px width
- **THEN** every section fits the screen without horizontal scrolling
