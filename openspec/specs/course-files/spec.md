# course-files Specification

## Purpose

Keep validated original files available to current course members without committing to the future course-resources product model or exposing file bytes outside the course.

## Requirements

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

### Requirement: Idempotent file creation

A valid `Idempotency-Key` SHALL bind uploader, course, filename, media type and SHA-256 for 24 hours. An exact repeat by a current instructor while the file remains visible SHALL replay the original `201` and `Location` without another object PUT, including after archival; changed input SHALL return `409`. A deleted file SHALL never be resurrected through replay.

#### Scenario: Exact retry

- **WHEN** the uploader retries with the same key and exact file while it remains visible
- **THEN** the same response is replayed and only one object exists

#### Scenario: Stale or changed retry

- **WHEN** the key is reused for changed input or for a previously deleted file
- **THEN** the API rejects it without creating or revealing another file

### Requirement: Authenticated original-byte download

`GET /api/v1/courses/{courseId}/files/{fileId}/download` SHALL stream exact original bytes to a current member of the matching active or archived course with verified content type, length, safe attachment disposition, `nosniff`, and private no-store caching. Wrong-course, absent, deleted and inaccessible files SHALL be hidden. The API SHALL NOT expose presigned/public storage URLs.

#### Scenario: Member downloads from archived course

- **WHEN** a current member downloads a live file in an archived course
- **THEN** the original bytes and safe headers are returned

#### Scenario: Missing or unauthorized file

- **WHEN** the file is missing, deleted, in another course, or the requester is not a current member
- **THEN** the API returns `404` without bytes

### Requirement: Uploader-controlled logical deletion

`DELETE /api/v1/courses/{courseId}/files/{fileId}` SHALL return `204` only when the original uploader is still a current instructor in an active course. It SHALL atomically hide the file and queue durable, retryable S3 deletion before replying, without waiting for S3. A hidden file SHALL return `404` on later reads, downloads and repeated deletion. Archival SHALL make the course download-only.

#### Scenario: Uploader deletes a file

- **WHEN** its original uploader remains an instructor in an active course and deletes the file
- **THEN** the API returns `204`, a later download returns `404`, and a worker removes stored bytes

#### Scenario: Unauthorized or archived deletion

- **WHEN** another instructor, a former instructor, or an uploader of an archived course tries to delete
- **THEN** the API rejects it and preserves the file

#### Scenario: S3 temporarily unavailable

- **WHEN** physical deletion fails after a successful `204`
- **THEN** the file remains hidden and the job retries or remains visible as dead for operator repair

### Requirement: Portable storage and course cleanup

The API SHALL use an S3-compatible configured bucket. A local endpoint MAY use path-style SeaweedFS credentials; managed AWS SHALL use the SDK default credential chain without startup bucket probes. Course deletion SHALL remove all course-file bytes, including tombstones, before committing metadata deletion; storage failure SHALL retry the course job.

#### Scenario: Managed startup

- **WHEN** only bucket and region are configured
- **THEN** startup uses the default credentials without probing or creating the bucket

#### Scenario: Course deletion includes tombstones

- **WHEN** a course with live and logically deleted files is deleted
- **THEN** all remaining object bytes and file rows are removed, or the deletion job retries after failure

### Requirement: Member file listing

`GET /api/v1/courses/{courseId}/files` SHALL return live course_files metadata only to authenticated current members of an active or archived course. Missing, deleting and inaccessible courses SHALL return 404. Deleted files and other courses' files SHALL be excluded. Responses SHALL use `data` and `page` with `hasMore` and nullable `nextCursor`, default limit 25 and limit 1–100. Files SHALL sort by exact creation timestamp descending, then ID descending. Opaque cursors SHALL preserve PostgreSQL microseconds and bind the course; malformed cursors, unknown query fields and invalid or repeated query values SHALL return 400. Only existing public file metadata SHALL be exposed.

#### Scenario: Member pages files

- **WHEN** a current student, TA or instructor lists a course's files
- **THEN** live files are returned latest first with stable pagination, excluding deleted and other-course files

#### Scenario: Archived and inaccessible courses

- **WHEN** a member lists an archived course
- **THEN** files remain readable, while outsiders and deleting or missing courses receive 404

### Requirement: Course Resources file interface

The Resources route SHALL display actual course files alongside named external links as specified in course-resource-links. Existing immutable file upload, authenticated original-byte download and permissions SHALL remain unchanged. File names SHALL be the download links without additional Download text or buttons. Only current active-course instructors SHALL see upload controls. Failed upload SHALL preserve the list and same-file retry SHALL reuse the idempotency key; selecting another file SHALL reset it. Loading, empty, error/retry and pagination feedback SHALL remain accessible and responsive. No file delete UI or custom viewer SHALL be added.

#### Scenario: Instructor uploads
- **WHEN** an active-course instructor uploads a supported file
- **THEN** progress and success or failure feedback appears and success refreshes the mixed list

#### Scenario: Readonly members
- **WHEN** a TA, student or archived-course instructor opens Resources
- **THEN** files can be downloaded and named external links opened but creation controls are absent
