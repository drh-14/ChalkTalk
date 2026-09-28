## 1. Fixture

- [x] 1.1 Seed a teaching assistant, a fourth student, and questions and notes with spread creation times, tags, pins, anonymous posts, and student and staff answers in `apps/api/src/database/seed-ams161.ts`, keeping the three similar question pairs.
- [x] 1.2 Extend `apps/api/src/database/seed-ams161.integration.test.ts` to cover members, post and answer counts, activity ordering, and the note, pinned, answered, unanswered, TA, and tag filters.
- [x] 1.3 Update the local-development section of `README.md`.

## 2. Verification

- [x] 2.1 Run the seed integration tests with `TEST_DATABASE_URL`, the full test suite, and `openspec validate enrich-ams161-sample-data --strict`.
