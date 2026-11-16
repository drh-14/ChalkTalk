# piazza-course-import Specification

## Purpose

How a Piazza class export is converted into ChalkTalk content by the developer import tool or an authenticated UI import.

## Requirements

### Requirement: Imported Piazza tables become Markdown tables

When importing a Piazza class, the importer SHALL convert each HTML table in a post, answer, or followup into a GFM pipe table. The first row SHALL become the header row, whether its cells are header or data cells. Rows with fewer cells SHALL be padded with empty cells to the widest row. Each cell SHALL keep its inline formatting and links on one line: line breaks and block content inside a cell SHALL become spaces, and a `|` in cell text SHALL be escaped. A table nested inside a cell SHALL be flattened to its text. Re-importing a class SHALL replace earlier converted content with the table form.

#### Scenario: A grade distribution table is imported

- **WHEN** a Piazza note body contains a table whose first row is an empty cell followed by `Excellent`, `Good`, and whose next row is `Instructor`, `7`, `6`
- **THEN** the imported body contains a pipe table with header `|  | Excellent | Good |`, a delimiter row, and the row `| Instructor | 7 | 6 |`

#### Scenario: A cell contains a pipe and a line break

- **WHEN** a table cell contains `a|b` and a `<br>` between two words
- **THEN** the cell becomes `a\|b` and the two words are separated by a space on one line

### Requirement: Imported image names drop Piazza's NaN suffix

When importing a Piazza class, the importer SHALL remove a trailing `NaN` that Piazza appends to the alternative text of pasted images, so the imported Markdown image shows the original file name. Re-importing a class SHALL replace earlier converted content with the corrected name.

#### Scenario: A pasted screenshot is imported

- **WHEN** a Piazza post contains an image whose alternative text is `Screenshot.jpgNaN`
- **THEN** the imported body contains `![Screenshot.jpg](...)`

### Requirement: Piazza import is an explicit course operation

The developer import command SHALL import only the Piazza class or export explicitly selected by its operator. It SHALL NOT read a demo-password environment variable. Historical imported accounts that do not already have normal ChalkTalk credentials SHALL receive unguessable, non-disclosed credentials rather than a shared login password.

#### Scenario: Operator imports a saved class export

- **WHEN** the operator invokes the import command with an existing owner account and a chosen export file
- **THEN** that course is imported without loading unrelated committed fixtures
- **AND** no demo password is required or accepted

#### Scenario: Import runs without a shared credential

- **WHEN** new historical author identities are created during import
- **THEN** they cannot sign in with a common demo credential

### Requirement: Authorized users can import a saved Piazza JSON file from the course home page

The course home page SHALL offer an import action for the JSON format produced by ChalkTalk's Piazza CLI. Before submission it SHALL show the source course name, the count of importable public posts and people in the source file, identify how many private posts will be omitted, and require the user to affirm that they are authorized to migrate the remaining content. It SHALL NOT ask for Piazza credentials or claim to accept native Piazza ZIP/CSV exports. A successful import SHALL open the imported ChalkTalk course; failed imports SHALL leave the user able to retry without duplicate submission.

#### Scenario: User confirms a preview and imports

- **WHEN** an authenticated user selects a valid CLI-generated Piazza JSON file, reviews the private-post omission preview, and confirms authorization
- **THEN** the browser uploads the file once and opens the course returned by the server

#### Scenario: User has not confirmed authorization

- **WHEN** a user selects a file but has not affirmed authorization
- **THEN** the import action remains unavailable and no upload occurs

### Requirement: The upload API validates and bounds the Piazza source

The API SHALL accept exactly one CLI-generated Piazza JSON file through authenticated multipart upload with session, origin, and CSRF protections. It SHALL derive the owner from the session, reject malformed or structurally invalid JSON before any writes, enforce a 20 MiB file limit and bounded nested content, and delete the temporary source file on success or failure. It SHALL NOT retain or log source content or accept Piazza credentials in the request. On success it SHALL return the imported course ID and aggregate counts; incompatible or oversized files SHALL receive actionable errors.

#### Scenario: Valid first import

- **WHEN** an authorized authenticated user uploads a valid file within the limits
- **THEN** the API creates the course transactionally and returns its ID and aggregate import counts

#### Scenario: Invalid or oversized file

- **WHEN** an upload is malformed, has an unsupported shape, or exceeds the file or structural limit
- **THEN** the API rejects it with a format or size error and makes no import writes

#### Scenario: Missing authorization boundary

- **WHEN** the request lacks a valid session, permitted origin, or CSRF token
- **THEN** the API rejects it without importing content

### Requirement: UI imports omit private Piazza content

The UI import SHALL omit private Piazza posts, their descendants, and historical people referenced only by omitted private content. Public content SHALL retain the existing converter's post, answer, follow-up, authorship, anonymity, and idempotent re-import behavior. The CLI import's existing behavior SHALL remain unchanged.

The UI import SHALL treat the file-reported `selfUid` as a historical Piazza identity separate from the authenticated ChalkTalk uploader. It SHALL NOT attribute newly created posts, answers, follow-ups, or related activity to the uploader solely because that UID appears as `selfUid`. This SHALL hold on initial import and re-import. The CLI import SHALL continue mapping `selfUid` to its named owner. As a legacy exception, a UI re-import SHALL NOT rewrite existing CLI-imported author attribution or related follows, contributors, and activity rows.

#### Scenario: Mixed public and private source

- **WHEN** a source file contains public and private posts with a person referenced only in a private post
- **THEN** the UI import includes public content and relevant people but not the private post or private-only person

#### Scenario: Exporter and uploader differ

- **WHEN** an authorized uploader imports or re-imports a file whose `selfUid` authored newly created public content
- **THEN** that new content is attributed to a separate historical Piazza account, not to the uploader

#### Scenario: UI re-import follows a CLI import

- **WHEN** a CLI-imported course has exporter-authored content attributed to its owner and a current instructor re-imports it through the UI
- **THEN** existing content retains its CLI-written attribution and related activity while newly created content uses the separate historical Piazza identity

### Requirement: UI re-import cannot grant instructor access

For a Piazza class already imported into ChalkTalk, the UI upload SHALL update it only when the authenticated actor is a current instructor of that exact course in the same organization. The authorization check SHALL occur atomically with the import after the import lock and before any enrollment or content write; a revoked or unrelated user SHALL NOT gain instructor access by re-importing. Cross-organization imports SHALL remain rejected. The CLI operator path SHALL retain its existing behavior.

#### Scenario: Instructor updates an imported course

- **WHEN** a current instructor uploads a newer valid JSON file for the same Piazza class
- **THEN** the importer updates the existing course without duplicating its retained content

#### Scenario: Unrelated user attempts re-import

- **WHEN** a user in the same organization who is not an instructor of the imported course uploads the class file
- **THEN** the request is rejected before any enrollment or content change

#### Scenario: Membership is revoked during re-import

- **WHEN** a user's instructor membership is revoked before the import's locked authorization point
- **THEN** the import is rejected and does not restore that membership
