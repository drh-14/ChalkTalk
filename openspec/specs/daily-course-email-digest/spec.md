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

The system SHALL start dispatch of eligible previous-day digests at or after 00:00 UTC. It SHALL recover eligible dates missed since deployment and retry failed provider sends using durable unique intents and expiring claims. Before the first network send it SHALL persist the exact composed digest including sender, recipient, HTML, plain text, and inline CID image bytes. Every retry SHALL reuse that payload and a stable idempotency key, while rechecking the recipient address, active membership, course digest preference, course status, and current visibility and body of every included item. If any included item becomes inaccessible or substantively changes, the whole frozen digest SHALL be canceled. It SHALL record success only after provider acceptance and SHALL clear the snapshot after success or cancellation. It SHALL not claim exactly-once delivery beyond the provider's idempotency window.

#### Scenario: API process restart
- **WHEN** the API process was unavailable at midnight and restarts later
- **THEN** it discovers eligible missed dates and attempts their per-course digests without creating duplicate intents

#### Scenario: SMTP failure
- **WHEN** SMTP rejects a digest attempt in local development, or Resend rejects or ambiguously accepts a production digest attempt
- **THEN** the intent remains retryable with its identical snapshot and key

#### Scenario: Access revoked before send
- **WHEN** the recipient leaves, changes address, opts out, the course is archived, or any snapshotted item becomes inaccessible or substantively changes
- **THEN** the whole pending digest is canceled and no provider call occurs

### Requirement: Safe email content

The system SHALL send HTML and equivalent plain-text course/day digests with spaced entries containing a linked post title and a safely formatted preview of that activity's own body, without activity-kind prefixes or author identity. The system SHALL parse Markdown, GFM, math and supported HTML instead of using regex Markdown substitution. It SHALL sanitize executable tags, events, styles, user image markup and unsafe URLs. Previews SHALL preserve valid formatting and whole equations and contain at most 600 visible Unicode characters after parsing. An entry SHALL include a Read more link only when its body preview is truncated. Raw source SHALL be bounded to 128 KiB and AST processing SHALL be bounded. Each email SHALL render at most fifty entries and at most 256 KiB HTML while retaining complete activity counts and linking remaining activity. Authenticated application links SHALL open the original full content.

#### Scenario: Complete and truncated previews

- **WHEN** an entry's body fits its preview
- **THEN** its linked title appears without a redundant Read more link
- **WHEN** source, AST, or visible-character limits omit part of a body
- **THEN** its valid preview retains whole equations and includes a Read more link to the full post

#### Scenario: Answer and followup previews

- **WHEN** a digest includes a question, answer and followup
- **THEN** each entry uses the parent title as its link and its own body as the preview, with no `post:` prefix

#### Scenario: Untrusted markup

- **WHEN** a body includes scripts, event handlers, credentials in URLs, or remote image markup
- **THEN** the email contains none of those active attributes or remote images and performs no remote image request

#### Scenario: Anonymous answer

- **WHEN** an eligible answer was posted anonymously
- **THEN** the digest contains its preview without exposing its author's name, identifier, email, or role

### Requirement: Rendered inline mathematics

The system SHALL render supported LaTeX equations locally to CID PNG images using a restricted base/AMS TeX renderer, without a CDN or remote rendering service. Each formula SHALL be limited to 2 KiB TeX, 5 KiB macro buffer, a terminable two-second worker and 200 KiB PNG. One email SHALL include at most twenty rendered equations and at most 1 MiB equation images. Invalid or excessive equations SHALL produce a linked HTML placeholder rather than visible raw commands, with safe source in plain text and alternative text.

#### Scenario: Equation display

- **WHEN** an entry includes inline or display mathematics within the limits
- **THEN** its HTML renders a CID image backed by PNG attachment bytes and its plain-text alternative remains readable

#### Scenario: Formula failure

- **WHEN** math is invalid or rendering exceeds a bound
- **THEN** the worker is terminated if necessary and the digest still includes a safe link to view the equation

### Requirement: Bounded current image copies

The system SHALL embed only currently authorized active image attachments on included entities as private CID inbox copies. It SHALL include at most five images, 5 MiB source and twelve megapixels each, 1200-pixel output width, 1 MiB encoded output each and 5 MiB total user images. Reads and processing SHALL be bounded to three seconds per image. Total inline binary content SHALL not exceed 6 MiB. Missing, invalid or over-limit readable images SHALL use authenticated links; deleted or denied images SHALL expose no metadata. User-provided remote image URLs SHALL never be fetched.

#### Scenario: Embedded attachment

- **WHEN** an eligible entry has a readable image within limits
- **THEN** the email includes a CID image without making the course file public

#### Scenario: Private or removed parent

- **WHEN** an attachment belongs to a private, deleted or inaccessible parent at delivery
- **THEN** neither its bytes nor its filename appears in the digest
