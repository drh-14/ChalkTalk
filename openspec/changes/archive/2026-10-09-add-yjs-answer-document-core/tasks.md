## 1. Core dependency and specification tests

- [x] 1.1 Add `yjs` to the API workspace and verify installation and typecheck.
- [x] 1.2 Write a PostgreSQL integration test for first load and durable reload, run it red, then implement the minimum private store to pass it.

## 2. Update behavior

- [x] 2.1 Write red integration tests for update, duplicate replay, unchanged text, and concurrent merge; implement atomic persistence and verify them green.
- [x] 2.2 Write red integration tests for malformed/invalid content, lifecycle, mismatch, and endorsement/deletion ordering; implement guards and verify them green.

## 3. Contract and verification

- [x] 3.1 Verify answer GET body and ETag after a core update in a headless HTTP test.
- [x] 3.2 Update answer implementation status and database persistence documentation, then run focused tests, typecheck, lint, format check, and build.
- [x] 3.3 Validate and archive the OpenSpec change after all behavior tests pass.
