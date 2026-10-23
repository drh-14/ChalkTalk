## 1. Contract and persistence

- [x] 1.1 Derive PostgreSQL-backed red tests from `documentation/api/posts.md`, `documentation/openapi.yaml`, and `documentation/database.md` for legacy poll preservation, multi-choice validation, all vote errors, privacy in list/detail/mutation responses, auth/CSRF, headers/ETags, close/reopen/release, export, and clone; run them and confirm expected failures before implementation.
- [x] 1.2 Add the next available migration (048 only if still free) for `poll_settings` and multi-row ballots, backfill existing polls and votes, and verify schema/migration tests retain existing ballot counts and reject cross-poll choices.
- [x] 1.3 Extend poll creation and projection on the current post seam, including legacy defaults and viewer-specific result hiding; verify the corresponding red API tests pass without changing basic-poll behavior.
- [x] 1.4 Extend vote/retract to atomic whole-ballot replacement with single-choice request compatibility, maximum enforcement, effective deadline, and archived/closed rejection; verify the vote and race/boundary tests pass.

## 2. Lifecycle, export, and clone

- [x] 2.1 Implement staff-only conditional close/reopen/release operations with monotonic release and effective deadline behavior; verify role, CSRF, ETag, deadline, stale-version, and reopen tests pass.
- [x] 2.2 Implement staff-only aggregate CSV download, including safe CSV escaping and no identity fields; verify content type/disposition, counts, formula-leading labels, and student-denied tests pass.
- [x] 2.3 Implement staff-only clone via the existing post-create path, resetting ballots, deadline, closed and released state; verify clone settings, empty totals, fresh identity, and permission tests pass.
- [x] 2.4 Update `documentation/api/posts.md`, `documentation/openapi.yaml`, and `documentation/database.md` to reflect live contracts and verify OpenAPI parse/reference/contract checks.

## 3. Web behavior

- [x] 3.1 Add failing web client/component tests for composer modes, maximum and deadline, hidden-results states, accessible voting controls, staff lifecycle actions, export/clone, and API-error feedback; run them and confirm expected failures before UI implementation.
- [x] 3.2 Extend the existing post client/types, composer, and `PollCard`/views (not a parallel poll UI); verify component and client tests pass, including old basic polls.
- [x] 3.3 Run real-browser tests with mocked API for each user-visible scenario (single-select compatibility, multi-select voting and limit, hidden/released results, deadline/close/reopen, staff export/clone, and student denial), capture and inspect a screenshot for each scenario, and attach screenshots to the eventual draft PR.

## 4. Integration and delivery

- [x] 4.1 Run format, lint, typecheck, build, affected PostgreSQL suites, browser tests, and `openspec validate advanced-polls --strict`; verify all pass or document baseline failures.
- [x] 4.2 Resolve the stale unarchived #65 `text-posts` spec state with the user before archiving this change, so the published main spec does not contradict live polls; verify the final specs remain coherent.
- [x] 4.3 After implementation checks pass, archive this OpenSpec change; verify archive status and strict validation.
- [x] 4.4 Commit only this scoped change on a feature branch, run and address the no-mistakes gate, squash to one commit, publish a draft PR, and verify the final head has exactly one commit and passing checks.
