## 1. Contracts and tests

- [x] 1.1 Add conversation deletion spec and API/database reference changes.
- [x] 1.2 Write failing HTTP/database tests for creator/staff authorization, nonstarter denial, stale version, archive, cascade, replay, and cleanup.
- [x] 1.3 Write failing mocked-browser tests for confirmation, successful removal, staff and nonstarter controls, and stale refresh; capture screenshots.

## 2. Implementation

- [x] 2.1 Add conversation creator/version and transactional deletion; advance version on content and file changes with ordered locks.
- [x] 2.2 Add DELETE route and client control, live list recovery, and cleanup behavior.

## 3. Delivery

- [x] 3.1 Run focused tests, browser suite, typecheck, build, lint, format, and strict OpenSpec validation; archive change.
- [x] 3.2 Verify the final API/browser contract, screenshots, and one-commit draft PR delivery separately through the repository gate.
