## 1. Contract and tests

- [x] 1.1 Update OpenSpec contracts for this slice.
- [x] 1.2 Write PostgreSQL plus SeaweedFS HTTP smoke tests for PNG, DOCX and PPTX exact-byte round trips with teardown, idempotency, roles and rejected payloads. Confirm expected red tests.

## 2. Implementation

- [x] 2.1 Add object-storage configuration, client and Compose wiring.
- [x] 2.2 Add resource persistence, multipart parsing, bounded structural validation and idempotent create.
- [x] 2.3 Add authenticated original-byte download and error handling.
- [x] 2.4 Delete uploaded objects in the existing course-deletion worker, with retry tests.

## 3. Verification and delivery

- [x] 3.1 Run focused and relevant tests, typecheck, lint, formatting and OpenSpec validation; archive change.

## 4. Completion follow-up

- [x] 4.1 Rebase the scoped upload commit on current main while retaining its OpenSpec contracts.
- [x] 4.2 Add tests that expose whole-file buffering and verify staged-file lifecycle and streamed S3 bytes.
- [x] 4.3 Make all eight validators file-backed with bounded process memory at the 100 MiB limit.
- [x] 4.4 Configure local SeaweedFS and managed AWS through generic S3 settings without a managed startup bucket call.
- [x] 4.5 Run real PostgreSQL and SeaweedFS round trips, idempotency and deletion checks; run focused repository checks.
- [x] 4.6 Archive the updated OpenSpec change and deliver one scoped commit.
