## REMOVED Requirements

### Requirement: Instructor upload

**Reason**: Superseded by the course-files capability; resource creation is deferred.
**Migration**: Use `POST /api/v1/courses/{courseId}/files` for an immutable original file.

### Requirement: Portable object storage

**Reason**: Storage portability now belongs to course-files.
**Migration**: Configure the course-files S3-compatible backend.

### Requirement: Idempotent upload

**Reason**: Idempotency now belongs to course-files.
**Migration**: Use an `Idempotency-Key` on the file upload route.

### Requirement: Authenticated resource metadata and original-byte download

**Reason**: Resource metadata is deferred; bytes are course-scoped.
**Migration**: Use `GET /api/v1/courses/{courseId}/files/{fileId}/download`.

### Requirement: Course deletion cleans stored resource bytes

**Reason**: Course deletion now cleans course-file bytes.
**Migration**: Use the course-files deletion lifecycle.
