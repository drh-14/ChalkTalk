## 1. Contracts

- [x] 1.1 Correct the three-endpoint design and validate this OpenSpec change with `openspec validate --strict`.
- [x] 1.2 Update OpenSpec contracts to exactly three course-file routes and a minimal row.

## 2. Behavior, Tests First

- [x] 2.1 Write API/PG/S3 tests for upload, exact replay, bad payload and course access; observe expected RED failures, then make upload/download GREEN.
- [x] 2.2 Write API/PG/S3 tests for uploader-only logical deletion, archival, stale replay, cleanup retries and course-delete tombstones; observe expected RED failures, then make DELETE and worker GREEN.
- [x] 2.3 Replace unmerged migration 011 with minimal `course_files` and durable deletion jobs; verify database constraints and complete integration tests.

## 3. Delivery

- [x] 3.1 Run focused/full tests, typecheck, lint, build, and real SeaweedFS/PostgreSQL smoke; record results.
- [x] 3.2 Sync the course-file spec, retire the superseded resource-upload spec, and archive this change; verify the main specs match the delta.
