## Why

Draft PR #43 exposes course resources before that product is designed. Keep its validated original-byte storage but publish only immutable course-scoped files and uploader deletion.

## What Changes

- **BREAKING**: Replace `/resources` upload, metadata and download endpoints with exactly three course-scoped file endpoints: upload, download, delete.
- Replace resource metadata/schema with a minimal course-file row and durable file-deletion job.
- Retain eight validated formats, 100 MiB bound, authenticated course access, 24-hour idempotency, S3 portability, and course-deletion cleanup.
- Update OpenSpec contracts and backend tests; no frontend or course-resource integration.

## Capabilities

### New Capabilities

- `course-files`: Immutable course-scoped upload/download and original-uploader deletion.

### Modified Capabilities

- `course-resource-uploads`: Remove the superseded resource API requirements; this PR remains draft and has no production migration.

## Impact

API routes and storage service, migration 011, job worker, OpenSpec artifacts, and PostgreSQL/SeaweedFS integration tests. No new third-party dependency.
