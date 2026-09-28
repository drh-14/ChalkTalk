## Why

Course members can ask questions but nobody can answer them: the API has no answer routes, questions always report `answered: false`, and the discussion page has nowhere to reply. The documented design (`documentation/api/answers.md`) gives each question one shared students' answer and one shared instructors' answer, edited live through a Yjs collaboration server. That live editing is large, architecture-first work, so this change delivers the rest of the answer lifecycle now and leaves text editing for phase 2.

## What Changes

- Add the `answers`, `answer_contributors`, and `answer_collaboration_documents` tables in a new migration, with at most one active answer of each kind per question.
- Implement `POST /api/v1/posts/{postId}/answers`, `GET /api/v1/posts/{postId}/answers`, `GET /api/v1/answers/{answerId}`, `DELETE /api/v1/answers/{answerId}` (staff), and `PUT /api/v1/answers/{answerId}/endorsement` (staff) as documented, with idempotent creation, ETags, `If-Match`, course-archive rules, and identity-safe contributor projections.
- Questions report a real `answered` value, and the `answered` list filter works. Answer activity updates the question's last-activity time.
- Course deletion removes answer data before posts.
- On the discussion page, each question shows a Students' answer and an Instructors' answer section. A member whose role matches an empty section can write that answer, with optional anonymity. Staff can endorse or delete an answer.
- Answer text is fixed once posted in this phase. `PATCH /api/v1/answers/{answerId}`, collaboration connection tickets, attachments, multipart requests, and followups stay documented but not live, and `answers.md` gains an implementation-status note like the one in `posts.md`.

## Capabilities

### New Capabilities

- `question-answers`: the phase-1 answer lifecycle for question posts. It covers creation, listing, retrieval, staff deletion and endorsement, contributor visibility, and the not-yet-live collaborative editing, attachment, and followup routes.

### Modified Capabilities

- `text-posts`: questions report whether an active answer exists, the `answered` filter uses it, and course deletion also removes answers.
- `course-discussion-frontend`: question detail shows the two answer sections, with composing, endorsing, and deleting.

## Impact

- API: a new `apps/api/src/answers/` service, routes in `apps/api/src/http/app.ts`, the posts service's `answered` projection and filter, and the course-deletion worker.
- Database: migration `006_answers.sql`, and `documentation/database.md` gains the per-kind uniqueness rule.
- Docs: implementation-status notes in `documentation/api/answers.md` and `documentation/api/posts.md`, plus the contributor rule for deleted accounts in `identity-visibility.md`.
- Web: an answers client and the answer sections in the post detail pane.
- No new runtime dependency. The Yjs library, the collaboration server, and the editor arrive with phase 2.
- The team split assigns the database and backend to other members, so coordinate before implementing.
