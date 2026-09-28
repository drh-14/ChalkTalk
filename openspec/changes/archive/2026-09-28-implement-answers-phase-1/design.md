## Context

See proposal.md for scope. The posts implementation sets the patterns this change follows. `PostService` (`apps/api/src/posts/service.ts`) runs writes in a `tx` helper, and checks membership and course status with `membership()`/`writable()` (`409 course_archived` unless the course is `active`). It stores idempotent create results in `idempotency_records` under a per-caller scope with an advisory lock, builds ETags as `"v{version}"`, and enforces `If-Match` with `428`/`412`. Routes in `apps/api/src/http/app.ts` use `authenticatedUnsafe` (origin and CSRF), `requireJsonRequest`, and `strictBody` validation. Posts are soft-deleted tombstones; confirmed duplicates keep their row but are hidden, and their direct link redirects. Questions currently hardcode `answered: false`, `answered=true` returns an empty page, and `answered=false` returns all questions. The course-deletion worker (`apps/api/src/jobs/worker.ts`) deletes post tags, posts, tags, memberships, and then the course in one transaction. Accounts are soft-deleted with `display_name = 'Deleted user'`.

`documentation/database.md` already defines `answers`, `answer_contributors`, and `answer_collaboration_documents` (`yjs_state bytea`, `lifecycle_state` of `active`/`finalizing`/`closed`, `persisted_at`, `persistence_revision`). It does not state the one-answer-per-kind rule.

## Goals / Non-Goals

**Goals:**

- Match the documented answer contract for every live operation, so phase 2 adds editing without changing responses.
- Leave the data ready for phase 2: every answer already has its collaboration document row and contributor record.

**Non-Goals:**

- Live editing, the Hocuspocus/Yjs server, connection tickets, `PATCH`, attachments, multipart, and followups.
- Changing search ranking to weight endorsed answers.
- Showing answered status on feed cards.

## Decisions

**No Yjs dependency in phase 1; store a valid empty document.** The contract says creation "initializes its persistent Yjs document". The document's internal shape, a `Y.Text` or a `Y.XmlFragment` for a rich-text editor, depends on which editor phase 2 chooses, so seeding the answer text into a Yjs structure now would lock in that decision early. Instead, creation inserts the `answer_collaboration_documents` row with `yjs_state` set to the two-byte encoding of an empty Yjs document (`\x0000`), `lifecycle_state = 'active'`, and `persistence_revision = 0`. `answers.body_markdown` holds the text. Phase 2 seeds the chosen document shape from `body_markdown` the first time it finds an empty state. This departs from the exploration note that phase 1 would add the Yjs library to the API; it keeps phase 1 dependency-free and the decision reversible. The alternative, adding `yjs` and encoding a `Y.Text` now, would be simpler for phase 2 only if phase 2 picks plain text, which is not decided.

**One active answer per kind, enforced twice.** Migration `006_answers.sql` adds a partial unique index `answers(post_id, kind) WHERE deleted_at IS NULL`, and `documentation/database.md` gains the rule. The create transaction locks the question row with `SELECT … FOR UPDATE`, which serializes competing creators and a concurrent post deletion. It checks for an existing active answer and returns `409 answer_kind_exists`. It also maps a unique violation (`23505`) to the same error as a safety net. Locking alone would work, but the index states the rule in the schema, where database.md readers look.

**Soft delete, hidden without followups.** `DELETE` sets `deleted_at`, clears `body_markdown`, sets the document's `lifecycle_state` to `closed`, and increments `version`. With no followups in phase 1, the tombstone is never needed, so deleted answers are absent from every read (`404` and omitted from lists), as the contract allows ("a tombstone is retained when needed to preserve followups"). Keeping the row, rather than hard-deleting it, lets phase 2's followups attach to tombstones without a migration. The partial index lets a new answer of that kind be created.

**Endorsement closes the document.** Endorsing sets `endorsed_at` and `endorsed_by_user_id`, increments `version`, and sets `lifecycle_state = 'closed'`, matching the rule that endorsed answers are unavailable for editing. An endorsed answer with a current `If-Match` returns `200` unchanged. Both endorsement and deletion lock the answer row, then the question, in that order everywhere, to avoid deadlocks.

**Contributor projection.** Contributors come from `answer_contributors` joined to `users`, ordered by display name. Rows for soft-deleted users are omitted because the `Contributor` schema requires a non-null `id` and exposing a deleted account's ID would break identity-visibility's deleted-author rule. `identity-visibility.md` gains that sentence. For an anonymous answer, students receive `null`. The UI shows "Deleted user" for a nonanonymous answer whose list is empty.

**Hidden questions hide their answers.** Every answer read and write resolves the answer's question. A deleted question or a confirmed duplicate source returns `404 not_found`, so answers can never reveal merged or deleted content. Answers of a merged source stay attached to it and reappear if staff unmerge it.

**`answered` and activity.** The posts projection computes `answered` with an `EXISTS` on active answers, and the list filter uses the same predicate for `true` and `false`. Answer create, endorse, and delete set the question's `last_activity_at = now()` without touching its `version`, `updated_at`, or ETag, so an open question view keeps a valid ETag.

**Service shape.** A new `AnswerService` in `apps/api/src/answers/service.ts`, injected into `createApp` like `PostService` and constructed in `server.ts`, mirrors `PostService`'s `tx`, membership, and idempotency code. Idempotency uses the scope `answer-create:{userId}:{postId}`. Extracting a shared helper from `PostService` would touch posts code that this change otherwise leaves alone; the duplication is small and can be consolidated when followups add a third service. Answer routes reuse `authenticatedUnsafe`, `requireJsonRequest`, and `strictBody`.

**Course deletion order.** The worker deletes `answer_contributors`, `answer_collaboration_documents`, and `answers` for the course before post tags and posts, inside the existing transaction, so a retry after failure starts over cleanly.

**Frontend.** `apps/web/src/answers/client.ts` wraps the five operations in the same style as `posts/client.ts`, with ETags as `"v{version}"` and an idempotency key reused only for retries of the same draft. `apps/web/src/answers/views.tsx` exports `AnswerSections`, which `Discussion` renders under an active question's body, above the staff merge control so answers read first. It receives the question ID, the viewer's role (from the existing membership fetch), the course status, and the CSRF token. Answer bodies render through `ReactMarkdown` like post bodies, and bylines reuse the formatter from `posts/time.ts`. A `409 answer_kind_exists` reloads the list. Endorse and delete use `window.confirm` like the existing draft-discard prompt. Answer sections follow the new full-width detail layout.

## Risks / Trade-offs

- [Answers are final once posted, so a typo cannot be fixed until phase 2.] → The composer states this before submission, and staff can delete and allow a fresh answer.
- [The empty Yjs state diverges from `body_markdown` until phase 2.] → Nothing reads the document in phase 1. Phase 2's seeding rule is recorded here and in the `answers.md` status note.
- [This duplicates about 60 lines of transaction and idempotency code from `PostService`.] → Accepted for this phase, as described above.
- [The database and backend belong to other team members.] → The proposal flags coordination before implementation.
