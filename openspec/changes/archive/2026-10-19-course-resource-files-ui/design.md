## Context
Existing CourseFileService owns immutable course files, instructor creation and member original-byte downloads. Resources currently renders a placeholder.

## Goals / Non-Goals
Expose these files only. No resources catalog, new schema/dependencies, permissions changes, deletion UI or discussion attachments.

## Decisions
Add GET collection using existing authentication and envelope conventions. Authorize current membership and active/archived course before querying live files. Tuple pagination uses exact SQL timestamp text and ID, not the millisecond DTO timestamp, with course-bound strict cursor validation. Reuse existing metadata projection.
Use a separate course-files React module and existing course/session/member props. Fetch list with cookie authentication; download via existing same-origin attachment links. Upload multipart with CSRF and stable per-selection idempotency key. Failed uploads never discard list. Clear stale requests on unmount/course changes.

## Risks / Trade-offs
Concurrent additions appear upon refresh rather than disrupting pagination. No snapshot guarantee across deletions; deterministic keyset pagination avoids duplicates for unchanged records. UI permissions are advisory; existing API authorization remains authoritative.

## Verification
Tests-first HTTP integration with isolated real PostgreSQL schema/S3 bucket; existing upload/download regression tests. Mocked-API real Chromium tests cover listing, pagination, errors, upload/retry, role/archive restrictions and mobile with screenshots. Full repository checks and no-mistakes gate precede one-commit draft PR publication.
