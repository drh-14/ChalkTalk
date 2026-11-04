# Tasks

## 1. Dependencies and Hocuspocus spike

- [x] 1.1 Add `@hocuspocus/server` and `ws` to the API workspace, and `@hocuspocus/provider`, `y-codemirror.next`, `@codemirror/lang-python`, `@codemirror/lang-java`, `@codemirror/lang-cpp`, `@codemirror/lang-javascript`, and `@codemirror/lang-sql` to the web workspace; verify `npm install`, `npm run typecheck`, and `npm run build` pass
- [x] 1.2 Write a spike test in `apps/api/src/collaboration/hocuspocus.spike.test.ts` that starts an in-process Hocuspocus server and proves: `onAuthenticate` receives the provider token; a `beforeHandleMessage` rejection leaves the document unchanged and nothing is broadcast; `onStoreDocument` honors `debounce` and `maxDebounce` and runs on last disconnect; and stateless messages reach clients. Verify the test passes, and record any deviation from design D3, D5, D7, or D8 in design.md before continuing

## 2. Data model and contract

- [x] 2.1 Add `database/migrations/020_collaboration_sessions.sql` creating `collaboration_sessions` (with `title`, `language`, and `lifecycle_state`, and without `subchannel_id`), `collaboration_documents`, `collaboration_participants`, and `collaboration_connection_tickets`, with the keys, checks, and indexes from design D9, and update `documentation/database.md` to match; verify `npm run db:migrate` applies cleanly twice and a PostgreSQL integration test asserts the language check, the title length check, participant uniqueness, and ticket-hash uniqueness
- [x] 2.2 Update `documentation/api/collaboration-sessions.md`, `documentation/openapi.yaml`, and `documentation/api/collaboration-websocket.md` to the behavior in the spec and design D11; verify the YAML parses, `openapi.contract.test.ts` passes, and every route in the Markdown reference has a matching OpenAPI path and operation

## 3. REST API

- [x] 3.1 Implement `CollaborationSessionService` create, get, and list with the access rule (creator, current staff, current invitee) and wire the routes into `createApp` with origin, CSRF, idempotency, `Location`, and `ETag`; verify PostgreSQL-backed HTTP tests for creation defaults and validation, `course_archived`, `cross_course_anchor`, `404` for uninvited members and nonmembers, list filters, and hidden sessions excluded before `hasMore`
- [x] 3.2 Implement the invite and remove participant routes, with `pg_notify` on removal; verify tests for creator and staff success, idempotent re-invite, `not_course_member`, invitee `403`, the creator not removable, changes refused after the session ends, and removal revoking unused tickets
- [x] 3.3 Implement PATCH for `title` and `language`, and for `status: "ended"` using the `ending` handshake with the 5-second fallback (design D6); verify tests for `If-Match` success and `412`, invitee `403`, `session_ended` on a second end, the fallback ending within 5 seconds with no collaboration server, and the notifications emitted
- [x] 3.4 Implement connection-ticket issuance (hashed, 5-minute, bound to login session, user, and session, with `Cache-Control: no-store`); verify tests for the response shape and headers, the stored hash differing from the returned ticket, `409 session_ended`, an archived course, and `404` for unauthorized callers
- [x] 3.5 Implement the snapshot route; verify tests for the persisted text, `sessionStatus`, timestamps, `Cache-Control: no-store`, and `404` for unauthorized callers
- [x] 3.6 Apply lifecycle effects: end sessions on course archive, post deletion, and duplicate confirmation; hide them from non-staff after post removal; notify on membership removal, role change, and logout; and delete session data in course deletion cleanup; verify integration tests for each effect, including that a demoted TA keeps only sessions they created or were invited to

## 4. Collaboration server

- [x] 4.1 Add `apps/api/src/collaboration/main.ts` with `COLLABORATION_PORT` and `COLLABORATION_PUBLIC_URL` configuration, a `dev:collab` script added to `npm run dev`, a Vite `/collaboration` WebSocket proxy, and a Docker Compose `collaboration` service; verify a provider connects through `wss://localhost:5173/collaboration` in the browser and the Compose configuration validates
- [x] 4.2 Implement ticket authentication and authorization (design D3), including `Origin` rejection; verify tests that a valid ticket connects once, and that reused, expired, revoked, mismatched-document, wrong-origin, logged-out, and uninvited cases are closed
- [x] 4.3 Implement load and debounced store (design D5); verify tests that edits persist within 5 seconds, on last disconnect, and survive a server restart
- [x] 4.4 Implement update validation (design D7); verify tests that an oversized message, a write to another shared type, and content over 200,000 characters are rejected without changing or broadcasting the document
- [x] 4.5 Implement the `LISTEN` handler, the 15-second sweep, and the ending handshake (design D4 and D6); verify tests that removal, membership loss, and logout close connections within 5 seconds, that a dropped listener triggers a sweep on reconnect, and that ending stores the final text, marks the session ended, and closes connections with reason `session-ended`
- [x] 4.6 Implement server-derived presence (design D8); verify a test with two clients converging after concurrent edits at the same position, and that cursor labels come from the server map even when a client puts a fake name in awareness

## 5. Browser experience

- [x] 5.1 Add the sessions REST client and the `course-session` route; verify client tests for each request's method, headers, and body, and route tests for parsing and direct links
- [x] 5.2 Build `CodeEditor.tsx` with line numbers, the eight language modes in a `Compartment`, read-only mode, and `yCollab` binding; verify component tests that switching language keeps the text and that read-only blocks input
- [x] 5.3 Build `SessionView` with the participant list, creator/staff-only invite, language, and End session controls, ticket-refreshing reconnect, and the five connection states; verify component tests for each state, control visibility by role, the invite picker using course members, and the unavailable view revealing nothing
- [x] 5.4 Add `SessionsPanel` and the start dialog to post detail, including the warning that participants will see your name; verify component tests for listing visible sessions, the empty state, starting a session navigating to its view, and the button hidden in archived courses

## 6. Documentation

- [x] 6.1 Update `README.md` local-development steps (three dev processes plus collaboration, the new env keys), `.env.example`, and the "future work" sentence in `documentation/design.md`; verify the README steps run as written on a fresh `.env` copy

## 7. Integration checks

- [x] 7.1 Add `tests/browser/live-code-session.spec.mjs`: a student starts a Python session and invites a TA in one browser context; the TA joins in a second context; both type concurrently and see the same text and each other's cursors; the TA ends the session and both editors become read-only with the final text; verify it passes with `--workers=1`
- [x] 7.2 Run `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` with `TEST_DATABASE_URL`, and `npm run build`; verify all pass, recording any pre-existing environment-only failures with evidence from `main`
  Note: format, lint, typecheck, and build pass. Every collaboration test passes when its file runs alone, and `npm run test:browser:live-sessions` passed three times in a row against the running stack. Full parallel runs on this Windows machine (repository inside OneDrive) show varying load-related timeouts in unrelated files; the two `App.test.tsx` password-reset tests fail identically on `main`. The full suite found one real regression, fixed here: the sessions panel had separated the staff actions from the answers.
