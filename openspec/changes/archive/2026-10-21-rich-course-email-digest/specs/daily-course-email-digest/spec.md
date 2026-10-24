## MODIFIED Requirements

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

## ADDED Requirements

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
