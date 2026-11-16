## ADDED Requirements

### Requirement: Authorized users can import a saved Piazza JSON file from the course home page

The course home page SHALL offer an import action for the JSON format produced by ChalkTalk's Piazza CLI. Before submission it SHALL show the source course name and counts of posts and people, identify how many private posts will be omitted, and require the user to affirm that they are authorized to migrate the remaining content. It SHALL NOT ask for Piazza credentials or claim to accept native Piazza ZIP/CSV exports. A successful import SHALL open the imported ChalkTalk course; failed imports SHALL leave the user able to retry without duplicate submission.

#### Scenario: User confirms a preview and imports

- **WHEN** an authenticated user selects a valid CLI-generated Piazza JSON file and confirms authorization and private-post omission
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

The UI import SHALL treat the file-reported `selfUid` as a historical Piazza identity separate from the authenticated ChalkTalk uploader. It SHALL NOT attribute posts, answers, follow-ups, or related historical activity to the uploader solely because that UID appears as `selfUid`. This SHALL hold on initial import and re-import. The CLI import SHALL continue mapping `selfUid` to its named owner.

#### Scenario: Mixed public and private source

- **WHEN** a source file contains public and private posts with a person referenced only in a private post
- **THEN** the UI import includes public content and relevant people but not the private post or private-only person

#### Scenario: Exporter and uploader differ

- **WHEN** an authorized uploader imports or re-imports a file whose `selfUid` authored retained public content
- **THEN** that content is attributed to a separate historical Piazza account, not to the uploader

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
