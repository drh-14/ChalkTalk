## 1. Tests first

- [x] 1.1 Add integration tests for note-only, mixed post counts/links, own and deleted notes, and midnight overlap; confirm expected failures.

## 2. Implementation

- [x] 2.1 Include both post types in digest scheduling and rendering, with a combined posts count.
- [x] 2.2 Coordinate note creation with digest scanning while retaining question-only statistics.
- [x] 2.3 Update daily digest API documentation and canonical spec.

## 3. Verification and delivery

- [x] 3.1 Run focused PostgreSQL/Mailpit tests, full tests, typecheck, lint, format, and OpenSpec validation.
- [ ] 3.2 Archive OpenSpec, run no-mistakes, update draft PR #40 to one commit, and verify final-head CI.
