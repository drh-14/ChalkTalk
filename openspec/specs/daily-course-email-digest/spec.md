# daily-course-email-digest Specification

## Purpose

Deliver an automatic email for each course with relevant previous-day discussion activity, with durable recovery after scheduler or SMTP outages.

## Requirements

### Requirement: Automatic per-course delivery and deployment cutover

The system SHALL generate daily course email digests for active members of active courses with digest emails enabled in their per-course preferences; there SHALL be no account-wide digest preference. The first eligible activity date SHALL be the UTC date on which the database migration is deployed; the first dispatch SHALL occur at or after the next 00:00 UTC. Dates before deployment SHALL not be backfilled.

#### Scenario: First deployment day

- **WHEN** the migration is deployed on October 14 UTC and qualifying activity occurs on October 14
- **THEN** the first eligible digest is dispatched at or after 00:00 UTC October 15 for that activity if the member's course digest preference is enabled, with no email for earlier dates

#### Scenario: No profile preference

- **WHEN** a member reads or updates their profile
- **THEN** the profile has no daily digest preference and an attempt to set one is rejected

### Requirement: Per-course previous-day activity

The system SHALL generate at most one durable digest intent per recipient, active course, and UTC activity date with eligible activity. Each course SHALL have its own email. Eligible activity SHALL be creation of visible posts (questions or notes), shared answers, and root or reply followups by others within the half-open UTC day. Questions and notes SHALL be combined into one posts count and individually linked in the email. The system SHALL exclude own activity, edits, votes, endorsements, deleted content, confirmed duplicate questions, hidden parent questions, tombstones, inaccessible courses, and archived courses. Empty course-days SHALL not produce email.

#### Scenario: Two active courses

- **WHEN** another person creates qualifying content in two courses on the previous UTC date
- **THEN** a member of both with digest emails enabled in both courses receives two course-specific emails

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

### Requirement: Durable midnight dispatch and recovery

The system SHALL start dispatch of eligible previous-day digests at or after 00:00 UTC. It SHALL recover eligible dates missed since deployment and retry failed SMTP sends using durable unique intents and expiring claims. Before sending, it SHALL recheck active membership, the course digest preference, course status, and current item visibility. It SHALL record success only after SMTP acceptance. It SHALL not claim exactly-once SMTP delivery after ambiguous acceptance.

#### Scenario: API process restart

- **WHEN** the API process was unavailable at midnight and restarts later
- **THEN** it discovers eligible missed dates and attempts their per-course digests without creating duplicate intents

#### Scenario: SMTP failure

- **WHEN** SMTP rejects a digest attempt
- **THEN** the intent remains retryable and records the failure

#### Scenario: Access revoked before send

- **WHEN** a recipient leaves a course or that course is archived before a pending send
- **THEN** that pending email is not sent

### Requirement: Safe email content

The system SHALL send plain-text course/day summaries with links to currently visible items, without revealing a hidden anonymous author's identity or embedding raw user HTML.

#### Scenario: Anonymous answer

- **WHEN** an eligible answer was posted anonymously
- **THEN** the digest can link to the answer without exposing its author's name, identifier, email, or role
