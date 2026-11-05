## MODIFIED Requirements

### Requirement: Validated instructor upload

The API SHALL accept exactly one multipart file on `POST /api/v1/courses/{courseId}/files` from a current instructor in an active course. A file MUST be no more than 100 MiB and be a matching, structurally valid PDF, plain text, Markdown, PNG, JPEG, WebP, DOCX or PPTX. Processing SHALL have bounded memory. PDFs MAY contain absolute HTTP/HTTPS and relative URI actions and internal GoTo navigation, including safe open-page actions. PPTX files MAY contain HTTP/HTTPS and relative external hyperlink relationships. PDFs and PPTX files with unsafe URI schemes or active content SHALL be rejected. A successful persistent upload SHALL return `201`, a course-scoped `Location`, and minimal metadata including file ID, name, verified media type, length, and creation time. It SHALL not expose resource titles, descriptions, versions, processing status, or a single-file metadata-read route.

#### Scenario: Ordinary linked PDF

- **WHEN** an instructor uploads a valid PDF with HTTP/HTTPS or relative links and internal page navigation
- **THEN** the upload succeeds without altering the original bytes

#### Scenario: Unsafe PDF action

- **WHEN** a PDF contains an unsafe URI scheme, script, launch, embedded file or unsupported action
- **THEN** the API rejects it without retaining a visible file

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

#### Scenario: Ordinary linked PPTX

- **WHEN** an instructor uploads a valid PPTX with HTTP, HTTPS, or relative hyperlink relationships
- **THEN** the upload succeeds without altering the original bytes

#### Scenario: Unsafe PPTX relationship

- **WHEN** a PPTX contains an unsafe hyperlink scheme, an external non-hyperlink relationship, or active package content
- **THEN** the API rejects it without retaining a visible file
