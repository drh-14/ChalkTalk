## 1. API list options

- [x] 1.1 Write failing PostgreSQL-backed HTTP tests in `apps/api/src/http/posts.integration.test.ts`, derived from the updated `posts.md` and `openapi.yaml` rules. Cover:
  - **Oldest:** `sort=oldest` returns ascending creation order, pages through every post exactly once via `nextCursor`, works with `q`, and a newest cursor replayed as oldest returns `400`.
  - **Pinned:** `pinned=true` and `pinned=false`, each alone and combined with `type`, and `pinned=yes` returning `400`.
  - **Author role:** `authorRole=instructor` returns only instructor posts and `authorRole=ta` only TA posts. A student sees only nonanonymous matches, while a TA or instructor also sees anonymous ones. A member whose role changed matches only the new role, and posts by a deleted account never match. `authorRole=staff` and `authorRole=student` return `400`.

  Verify the tests fail with `TEST_DATABASE_URL` set.
- [x] 1.2 Implement the three options in `postListQuery` and `PostService.list` as described in design.md. Verify the 1.1 tests and the full API suite pass.
- [x] 1.3 Document `sort=oldest`, `pinned`, and `authorRole` in the list operation of `documentation/api/posts.md` and `documentation/openapi.yaml`. Add the `authorRole` rule to "Author filtering and search" in `documentation/api/identity-visibility.md`. Verify `apps/api/src/http/openapi.contract.test.ts` and the API suite pass.

## 2. Web feed

- [x] 2.1 Write failing tests in `apps/web/src/posts/client.test.ts` for sending `pinned`, `authorRole`, and `sort=oldest`. Then extend `PostListOptions`, `PostSort`, and `listPosts` and verify the tests pass.
- [x] 2.2 Write failing rendered tests in `apps/web/src/posts/views.test.tsx`. Cover:
  - The full sidebar order.
  - The accessible names "Pinned questions" and "Pinned notes".
  - Instructor posts sending `authorRole=instructor` and TA posts sending `authorRole=ta`.
  - Each Pinned entry sending its `type` with `pinned=true`.
  - Oldest sending `sort=oldest`.
  - The sort options with and without a search: Last updated, Newest, and Oldest, plus Best match only while searching.

  Verify they fail.
- [x] 2.3 Add the shared Instructor posts and TA posts entries to `feedFilters` and the type-specific Pinned filters to the post type list, with accessible names, and add Oldest to the sort control. Verify the 2.2 tests and all web tests pass.
- [x] 2.4 In the running app, restart the API, then check each new filter and sort as the AMS161 instructor and as a student account with headless-Chrome screenshots, including an anonymous staff post being hidden from the student.

## 3. Integration checks

- [x] 3.1 Run `npm run lint`, `npm run typecheck`, `npm test` with `TEST_DATABASE_URL` set, `npm run build`, formatting with `--end-of-line auto`, and `openspec validate add-feed-sort-and-filter-options --strict`, and confirm all pass apart from the known Windows line-ending failures.
