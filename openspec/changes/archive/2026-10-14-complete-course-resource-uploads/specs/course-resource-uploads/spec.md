## Purpose

Course instructors can share validated original files with current course members while the API enforces access and repeatable creation.

## ADDED Requirements

### Requirement: Instructor upload

The API SHALL accept one multipart file with JSON metadata on `POST /api/v1/courses/{courseId}/resources` from a current instructor in an active course. The file MUST be at most 100 MiB and have a matching extension, declared media type, signature and valid bounded structure for one of PDF, plain text, Markdown, PNG, JPEG, WebP, DOCX or PPTX. The API SHALL stage, validate, hash and store the file without loading the complete upload or an expanded package into its heap. It SHALL return `201`, `Location`, `ETag`, and a ready resource with its validated media type and exact byte length only after persistent bytes and metadata are saved.

#### Scenario: Valid upload

- **WHEN** an instructor uploads a valid permitted file with valid metadata
- **THEN** the response is `201 Created` with a ready resource and its original bytes are retrievable

#### Scenario: Invalid or excessive file

- **WHEN** a file exceeds 100 MiB, is unsupported, disguised, corrupt, macro-capable or has unsafe package content
- **THEN** the API rejects it before committing a resource or leaving stored bytes

#### Scenario: Storage or database failure during upload

- **WHEN** persistent storage succeeds but the upload transaction subsequently fails
- **THEN** the API attempts best-effort deletion of the stored object; if S3 also refuses deletion, this slice does not guarantee orphan cleanup

#### Scenario: Unsafe active content or relationship

- **WHEN** a text upload contains active markup, or an Office package contains an executable part or any root or nested relationship whose type is unsafe or whose target does not resolve to an existing part inside the package
- **THEN** the API rejects the file before storing it

#### Scenario: Exactly 100 MiB

- **WHEN** an instructor uploads a valid file of exactly 100 MiB
- **THEN** the API accepts it while keeping upload processing memory bounded

#### Scenario: Unauthorized upload

- **WHEN** a non-instructor attempts an upload or required session, Origin or CSRF validation fails
- **THEN** the API rejects the request without creating a resource

### Requirement: Portable object storage

The API SHALL use an S3-compatible bucket configured by bucket and region. An optional endpoint SHALL enable local SeaweedFS with path-style requests and explicit development credentials. Without an endpoint, the API SHALL use the AWS SDK default credential chain and SHALL NOT probe or create the bucket at startup.

#### Scenario: Managed AWS startup

- **WHEN** a deployment configures a managed bucket without an endpoint or explicit credentials
- **THEN** the API starts using the default credential chain without a bucket-level startup request

### Requirement: Idempotent upload

The API SHALL scope `Idempotency-Key` to the actor, course and creation operation for 24 hours and compare canonical metadata plus file SHA-256. Matching retries, including concurrent retries, SHALL return the same `201`, `Location`, `ETag` and resource without another stored object; changed requests with the same key SHALL return `409 idempotency_key_reused`.

#### Scenario: Identical retry

- **WHEN** an instructor repeats an upload with the same key, metadata and bytes within 24 hours
- **THEN** the original creation result is returned and no second resource or object exists

#### Scenario: Changed retry

- **WHEN** an instructor repeats a key with changed metadata or bytes
- **THEN** the response is `409 idempotency_key_reused` and the original remains unchanged

#### Scenario: Retry after course archival

- **WHEN** a current instructor repeats a matching successful keyed upload after the course becomes archived
- **THEN** the original `201`, `Location`, `ETag`, and resource are replayed, while a new upload is rejected

#### Scenario: Course changes during upload

- **WHEN** a course is archived or deleted while new upload bytes are being stored
- **THEN** the upload does not commit a ready resource after the status transition

### Requirement: Authenticated resource metadata and original-byte download

The API SHALL expose `GET /api/v1/resources/{resourceId}` for ready upload metadata and `GET /api/v1/resources/{resourceId}/download` for original bytes. It SHALL check current course membership on every request, then return the exact stored bytes with the validated content type, byte length and safe attachment disposition. It SHALL return `404` for hidden or absent resources and links.

#### Scenario: Member download

- **WHEN** a current course member downloads a ready upload
- **THEN** the response bytes equal the uploaded file and content headers describe the validated file

#### Scenario: Former member or outsider

- **WHEN** a person without current course membership requests the download
- **THEN** the API does not disclose the resource or bytes

### Requirement: Course deletion cleans stored resource bytes

When a course is deleted, its deletion job SHALL remove its uploaded objects before committing removal of the course and resource metadata. If object deletion fails, the job SHALL retain the course and resource metadata and retry according to the existing job policy.

#### Scenario: Successful course deletion

- **WHEN** a course with uploaded resources is deleted
- **THEN** the uploaded objects and resource metadata are removed

#### Scenario: Storage failure during deletion

- **WHEN** object storage refuses deletion
- **THEN** the course and resource metadata remain and the deletion job is queued for retry
