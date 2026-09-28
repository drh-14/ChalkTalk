# Verification

- Entire repository suite with `TEST_DATABASE_URL` in the running Compose API container: 171/171 passed across 19 files, including all PostgreSQL integration tests.
- PostgreSQL-backed posts HTTP contract suite: 22/22 passed, including confirmed-source concealment, redirect, staff review, unmerge, and canonical protection.
- Frontend post/client and app interaction tests: 49/49 passed. These cover staff merge selection, staff review and unmerge, student control absence, and redirect navigation.
- `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run format:check`: passed.
- OpenAPI contract test: passed. `openspec validate merge-duplicate-text-posts --strict`: passed.

No manual browser pass was performed. No new migration or dependency was introduced.
