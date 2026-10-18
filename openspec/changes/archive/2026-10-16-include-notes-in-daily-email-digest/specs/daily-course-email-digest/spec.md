## MODIFIED Requirements

### Requirement: Per-course previous-day activity

The system SHALL generate at most one durable digest intent per recipient, active course, and UTC activity date with eligible activity. Each course SHALL have its own email. Eligible activity SHALL be creation of visible posts (questions or notes), shared answers, and root or reply followups by others within the half-open UTC day. Questions and notes SHALL be combined into one posts count and individually linked in the email. The system SHALL exclude own activity, edits, votes, endorsements, deleted content, confirmed duplicate questions, hidden parent questions, tombstones, inaccessible courses, and archived courses. Empty course-days SHALL not produce email.

#### Scenario: Two active courses

- **WHEN** another person creates qualifying content in two courses on the previous UTC date
- **THEN** a member of both receives two course-specific emails

#### Scenario: Note-only course day

- **WHEN** another member creates one visible note and no other content on the previous UTC date
- **THEN** the recipient receives one course digest with one post and a link to the note

#### Scenario: Mixed post types

- **WHEN** another member creates a visible question and note on the previous UTC date
- **THEN** the email shows two posts and links both items

#### Scenario: No visible external activity

- **WHEN** a course has only the recipient's own posts or content that is now hidden
- **THEN** no email is sent for that course and date

#### Scenario: Note commits after midnight scan

- **WHEN** a note creation overlaps the midnight scan and commits after it
- **THEN** the note is not permanently missed by that or a later scan
