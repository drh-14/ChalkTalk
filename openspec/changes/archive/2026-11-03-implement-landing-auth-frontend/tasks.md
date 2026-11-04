## 1. Browser auth foundation

- [x] 1.1 Add DOM test dependencies and Vitest configuration; verify a rendered React test executes.
- [x] 1.2 Add typed relative auth client and API-reference tests for requests, credentials, idempotency, CSRF, and error parsing.
- [x] 1.3 Add native route utility and tests for routes, history navigation, and emailed-token URL removal.

## 2. Public auth experience

- [x] 2.1 Implement responsive landing, login, verification request, account creation, reset-request, and reset-completion UI; verify rendered flow tests cover success, errors, and pending submissions.
- [x] 2.2 Implement startup session restoration and protected `/home` routing; verify authenticated and unauthenticated navigation tests.
- [x] 2.3 Implement static course/post placeholder home and CSRF-protected sign-out; verify session clearing and redirect behavior.

## 3. Quality and validation

- [x] 3.1 Verify form labels, focus behavior, live feedback, keyboard operation, and responsive styles through rendered tests and manual review.
- [x] 3.2 Run focused web tests, workspace tests, format, lint, typecheck, and build; record the results before completion.

## Validation evidence

- 2026-09-26: focused browser tests passed: 13 tests across the auth client, route utility, and rendered app flows.
- 2026-09-26: `npm test` passed (29 tests); 22 PostgreSQL-dependent API tests skipped because `TEST_DATABASE_URL` is unavailable locally.
- 2026-09-26: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run build`, `git diff --check`, and `npx openspec validate implement-landing-auth-frontend --strict` passed.
