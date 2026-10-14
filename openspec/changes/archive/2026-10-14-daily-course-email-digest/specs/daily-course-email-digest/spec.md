## Purpose

Deliver an opt-in email for each course with relevant previous-day discussion activity, with durable recovery after scheduler or SMTP outages.

## ADDED Requirements

### Requirement: Account-wide opt-in

The system SHALL default daily digest delivery off and SHALL expose an authenticated, version-checked profile preference. Enabling it SHALL make the current UTC activity date eligible for delivery at the next 00:00 UTC. Disabling it SHALL cancel unsent digests; re-enabling SHALL not backfill dates before the new eligibility date.

#### Scenario: Opt in today

- **WHEN** a user enables the preference on October 14 UTC
- **THEN** the first eligible email is dispatched at or after 00:00 UTC October 15 for October 14 activity, including activity earlier on October 14

#### Scenario: Opt out

- **WHEN** a user disables the preference with the current profile ETag
- **THEN** no unsent digest for that user is delivered

### Requirement: Per-course previous-day activity

The system SHALL generate at most one durable digest intent per opted-in recipient, active course, and UTC activity date with eligible activity. Each course SHALL have its own email. Eligible activity SHALL be creation of visible questions, shared answers, and root or reply followups by others within the half-open UTC day. The system SHALL exclude own activity, notes, edits, votes, endorsements, deleted content, confirmed duplicates, hidden parent questions, tombstones, inaccessible courses, and archived courses. Empty course-days SHALL not produce email.

#### Scenario: Two active courses

- **WHEN** another person creates qualifying content in two courses on the previous UTC date
- **THEN** an opted-in member of both receives two course-specific emails

#### Scenario: No visible external activity

- **WHEN** a course has only the recipient's own activity or content that is now hidden
- **THEN** no email is sent for that course and date

### Requirement: Durable midnight dispatch and recovery

The system SHALL start dispatch of eligible previous-day digests at or after 00:00 UTC. It SHALL recover missed UTC dates and retry failed SMTP sends using durable unique intents and expiring claims. Before sending, it SHALL recheck opt-in, active membership, course status, and current item visibility. It SHALL record success only after SMTP acceptance. It SHALL not claim exactly-once SMTP delivery after ambiguous acceptance.

#### Scenario: Worker restart

- **WHEN** the worker was unavailable at midnight and restarts later
- **THEN** it discovers eligible missed dates and attempts their per-course digests without creating duplicate intents

#### Scenario: SMTP failure

- **WHEN** SMTP rejects a digest attempt
- **THEN** the intent remains retryable and records the failure

#### Scenario: Access revoked before send

- **WHEN** a recipient opts out, leaves a course, or that course is archived before a pending send
- **THEN** that pending email is not sent

### Requirement: Safe email content

The system SHALL send plain-text course/day summaries with links to currently visible items, without revealing a hidden anonymous author's identity or embedding raw user HTML.

#### Scenario: Anonymous answer

- **WHEN** an eligible answer was posted anonymously
- **THEN** the digest can link to the answer without exposing its author's name, identifier, email, or role
