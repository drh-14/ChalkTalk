## 1. Schema

- [x] 1.1 Add `database/migrations/006_answers.sql`, following `documentation/database.md`:
  - **`answers`:** same-course foreign key to `posts`, `kind` check, active and deleted body checks, a paired endorsement check, the `(course_id, id)` unique key, and a partial unique index on `(post_id, kind) WHERE deleted_at IS NULL`.
  - **`answer_contributors`:** composite primary key.
  - **`answer_collaboration_documents`:** `lifecycle_state` check.

  Add the per-kind rule to `documentation/database.md`. Verify that `npm run db:migrate` applies the migration once, that a second run records nothing new, and that a direct duplicate active insert fails in `psql`.

## 2. Answer API: create and read

- [x] 2.1 Write failing PostgreSQL-backed HTTP tests in `apps/api/src/http/answers.integration.test.ts`, derived from `answers.md` and `openapi.yaml`. Cover:
  - **Create:** `201` with `Location` and an ETag, the response shape, student and staff kinds, `409 answer_kind_exists` sequentially and under concurrent requests, validation `422`s, `409 not_a_question`, `409 course_archived`, `404` for deleted, merged, other-course, and non-member posts, CSRF and origin `403`, and idempotent replay and conflicting reuse.
  - **List and get:** ordering, `422 not_a_question`, `404` cases, and the ETag.
  - **Contributors:** visibility for anonymous and nonanonymous answers per viewer role, and omission of deleted accounts.

  Verify they fail with `npx vitest run apps/api/src/http/answers.integration.test.ts` and `TEST_DATABASE_URL` set.
- [x] 2.2 Implement `AnswerService` create, list, and get, register the three routes in `app.ts`, and wire the service in `server.ts`, as described in design.md. Reject multipart create with `422 validation_failed`, and do not register `PATCH`, ticket, or followup routes. Verify the 2.1 tests and all existing API tests pass.

## 3. Answer API: endorse and delete

- [x] 3.1 Add failing tests for `PUT /answers/{id}/endorsement` and `DELETE /answers/{id}`:
  - Staff success with the new ETag.
  - Repeated endorsement with the current revision.
  - `428` and `412`, and `403` for students.
  - `409 course_archived`, `409 answer_endorsed` on delete, and `404` for deleted or hidden answers.
  - After deletion, the answer is absent and a new answer of that kind can be created.
  - The collaboration document closes on endorsement and deletion.
  - An unregistered `PATCH` leaves the answer unchanged.

  Verify they fail.
- [x] 3.2 Implement endorsement and deletion with the lock order from design.md. Verify the 3.1 tests and all API tests pass.

## 4. Posts integration and docs

- [x] 4.1 Add failing tests in `apps/api/src/http/answers.integration.test.ts` (it already wires both the post and answer services) and `apps/api/src/jobs/worker.integration.test.ts`:
  - `answered` becomes true after an answer and false after its deletion.
  - The `answered=true` and `answered=false` filters.
  - Answer activity advances the question's `lastActivityAt` without changing its ETag.
  - Course deletion removes answers, documents, and contributors and succeeds on retry.

  Verify they fail.
- [x] 4.2 Compute `answered` and the filter in `PostService`, bump `last_activity_at` from answer writes, and extend `deleteCourse` in the worker. Verify the 4.1 tests pass.
- [x] 4.3 Update the docs, then verify `apps/api/src/http/openapi.contract.test.ts` and the full API suite pass:
  - **`documentation/api/answers.md`:** an implementation-status note covering what is live, the not-yet-live routes, answers being final in this phase, and the phase-2 rule for seeding the empty document.
  - **`documentation/api/posts.md`:** the implementation-status sentence about `answered`.
  - **`documentation/api/identity-visibility.md`:** the rule for deleted contributors.

## 5. Discussion frontend

- [x] 5.1 Write failing tests for `apps/web/src/answers/client.ts` (request paths, headers, CSRF, idempotency key, `If-Match`, error mapping). Then implement the client and verify the tests pass.
- [x] 5.2 Write failing rendered tests in `apps/web/src/answers/views.test.tsx` and `apps/web/src/posts/views.test.tsx`. Cover:
  - Sections appear for questions only and not for notes, deleted posts, or duplicate review.
  - Loading, error with retry, and empty states.
  - A student composes the students' answer: validation, a pending state with no double submit, the draft kept on failure, the "cannot be edited" notice, and a reload on `409 answer_kind_exists`.
  - Staff see only the instructors' composer, and students only the students' composer.
  - Staff endorse and delete after confirming, with `If-Match`; students see neither control.
  - Anonymous and "Deleted user" bylines.
  - Safe Markdown rendering.
  - No controls in an archived course.

  Verify they fail.
- [x] 5.3 Implement `AnswerSections`, render it under active questions in `Discussion`, and add styles that follow the full-width detail layout. Verify the 5.2 tests and all web tests pass.
- [x] 5.4 In the running full-stack app, migrate the local database, then answer an AMS161 question and endorse the answer as the instructor. As a student account, confirm the students' composer appears and staff controls do not. Capture headless-Chrome screenshots at 1440×900 and 390×844 and fix any layout problem.

## 6. Integration checks

- [x] 6.1 Run `npm run lint`, `npm run typecheck`, `npm test` with `TEST_DATABASE_URL` set, `npm run build`, formatting with `--end-of-line auto`, and `openspec validate implement-answers-phase-1 --strict`, and confirm all pass apart from the known Windows line-ending failures.
