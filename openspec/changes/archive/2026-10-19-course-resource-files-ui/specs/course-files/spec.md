## MODIFIED Requirements

### Requirement: Validated instructor upload

The API SHALL accept exactly one multipart file on `POST /api/v1/courses/{courseId}/files` from a current instructor in an active course. A file MUST be no more than 100 MiB and be a matching, structurally valid PDF, plain text, Markdown, PNG, JPEG, WebP, DOCX or PPTX. Processing SHALL have bounded memory. A successful persistent upload SHALL return `201`, a course-scoped `Location`, and minimal metadata including file ID, name, verified media type, length, and creation time. It SHALL not expose resource titles, descriptions, versions, processing status, or a single-file metadata-read route.

#### Scenario: Valid original file

- **WHEN** an instructor uploads a valid DOCX, PPTX or PNG to an active course
- **THEN** the API returns `201` and course members can download byte-identical originals

#### Scenario: Invalid upload

- **WHEN** the file is oversized, disguised, malformed, active, macro-capable or unsupported
- **THEN** the API rejects it without a visible file or retained stored bytes under ordinary failure

#### Scenario: Unauthorized or archived upload

- **WHEN** a non-instructor or unauthenticated caller uploads, or an instructor uploads to an archived course
- **THEN** the API rejects the operation without creating a file

#### Scenario: Status transition during upload

- **WHEN** a course is archived or deleted before an in-flight upload commits
- **THEN** the upload does not commit a visible file

## ADDED Requirements

### Requirement: Member file listing

`GET /api/v1/courses/{courseId}/files` SHALL return live course_files metadata only to authenticated current members of an active or archived course. Missing, deleting and inaccessible courses SHALL return 404. Deleted files and other courses' files SHALL be excluded. Responses SHALL use `data` and `page` with `hasMore` and nullable `nextCursor`, default limit 25 and limit 1–100. Files SHALL sort by exact creation timestamp descending, then ID descending. Opaque cursors SHALL preserve PostgreSQL microseconds and bind the course; malformed cursors, unknown query fields and invalid or repeated query values SHALL return 400. Only existing public file metadata SHALL be exposed.

#### Scenario: Member pages files

- **WHEN** a current student, TA or instructor lists a course's files
- **THEN** live files are returned latest first with stable pagination, excluding deleted and other-course files

#### Scenario: Archived and inaccessible courses

- **WHEN** a member lists an archived course
- **THEN** files remain readable, while outsiders and deleting or missing courses receive 404

### Requirement: Course Resources file interface

The Resources route SHALL list actual course files with original filename, type, size, date and authenticated original-byte download links. Only current instructors of active courses SHALL see upload controls, reusing existing upload constraints and permissions. Failed upload SHALL preserve the list and same-file retry SHALL reuse the idempotency key; selecting another file SHALL reset it. Loading, empty, error/retry and pagination feedback SHALL be accessible and responsive. No delete, catalog, link resource, custom metadata, viewer or attachment behavior SHALL be added.

#### Scenario: Instructor uploads

- **WHEN** an active-course instructor uploads a supported file
- **THEN** progress and success or failure feedback appears and success refreshes the list

#### Scenario: Readonly members

- **WHEN** a TA, student or archived-course instructor opens Resources
- **THEN** files can be downloaded but upload controls are absent

