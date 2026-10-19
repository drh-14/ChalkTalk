# Design

## Context

See proposal.md for motivation and specs/live-code-sessions/spec.md for required behavior. Current state that shapes the approach:

- The API is one Express app (`apps/api/src/http/app.ts`) with one service class per domain, constructed in `server.ts`. Background jobs run in a separate process (`src/jobs/main.ts`, `npm run dev:worker`). Both share `createPool` and `loadEnvironment`.
- Authenticated routes use `requireSession(request, csrf)`, the configured-origin guard, `If-Match` built from `"v{version}"`, and 24-hour idempotency keys. Errors use `AuthError(status, code, message)`.
- `yjs` is already an API dependency, kept only to verify historical answer state. No WebSocket, Hocuspocus, Redis, or `LISTEN/NOTIFY` code is live. The retired answer design (`docs/design/2026-10-14-live-answer-followup-collaboration.md`) researched Hocuspocus, `y-codemirror.next`, and ticket authentication. Its difficulty came from coexisting with REST edits, endorsements, attribution, and anonymity, none of which apply to temporary sessions.
- `documentation/api/collaboration-sessions.md`, `openapi.yaml`, and `database.md` already describe sessions, tickets, and documents as an unimplemented future contract with any-member access and post or subchannel anchors.
- Posts have no per-post visibility beyond course membership; anonymity hides authors only. Course members can list the roster, so a student creator can pick invitees.
- The web editor (`PostEditor.tsx`) is CodeMirror 6 configured for Markdown and LaTeX. The app routes without a router library (`app/routes.ts`), and Vite proxies `/api` to the API in development.
- Darren's open branches add migrations 016 and 017.

## Goals / Non-Goals

**Goals:**

- One collaboration process that can be reasoned about and restarted without data loss beyond the persistence interval.
- Authorization that is rechecked from PostgreSQL, never trusted from the client, and revoked promptly.
- Reuse of the existing REST conventions, so the new routes look and behave like the rest of the API.
- A code editor that is separate from the Markdown editor, so neither destabilizes the other.

**Non-Goals:**

- Multiple collaboration nodes, Redis, or commit-before-broadcast durability.
- Subchannel anchors, whiteboards, code execution, history or replay, and per-character authorship.
- Offline editing beyond the reconnect window of an open tab.

## Decisions

### D1. A third process: `apps/api/src/collaboration/main.ts`

The collaboration server lives in the API workspace beside the worker, so it shares configuration, the pool, and domain queries. It listens on `COLLABORATION_PORT` (default 3100) and serves Hocuspocus over `ws`. `npm run dev` gains a `collab` process; Docker Compose gains a `collaboration` service mirroring `worker`. In development Vite proxies `/collaboration` (with `ws: true`) to it, so the browser uses `wss://localhost:5173/collaboration` and the existing certificate. The ticket response's `webSocketUrl` comes from `COLLABORATION_PUBLIC_URL`.

*Alternatives:* attaching the WebSocket to the Express server would couple an API restart to dropping every editor, and would mix long-lived connections into request handling. A separate package was rejected because it would duplicate configuration and queries.

### D2. Yjs document model: one `Y.Doc` per session, one `Y.Text('content')`

The document name is `collaboration-session:{id}`. Title, language, and participants are not stored in the document. They are REST-owned rows, so a client cannot change them by editing the document.

### D3. Ticket authentication and per-connection authorization

The REST route creates a 32-byte random ticket, stores its SHA-256 hash with the bindings in `collaboration_connection_tickets`, and returns it once. The provider sends it as Hocuspocus's `token`. In `onAuthenticate`, one transaction:

1. consumes the ticket (`UPDATE … SET consumed_at=now() WHERE token_hash=$1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>now() RETURNING …`),
2. checks that the document name matches,
3. rechecks that the login session is valid, the course is active, the session is active, and the user is the creator, a current staff member, or a current invitee, and
4. loads the display name.

The result becomes the connection context (`userId`, `authSessionId`, `displayName`, `role`). `onConnect` rejects a WebSocket whose `Origin` is not in `FRONTEND_ORIGINS`. Nothing in the connection is taken from client-supplied identity.

### D4. Revocation through PostgreSQL `LISTEN/NOTIFY`, plus a safety sweep

API transactions that change access call `pg_notify('collaboration_events', json)`, which PostgreSQL delivers only on commit. The changes are: invitee removal, session end, title or language change, post deletion or duplicate confirmation, course archive, membership removal or role change, and session logout. The collaboration server holds one dedicated `LISTEN` connection and reacts:

- `access_changed`: recheck the named users' connections.
- `session_updated`: broadcast a stateless `session-updated` message, so clients refetch title and language and reconfigure.
- `session_ending`: flush, then close.

Every 15 seconds a sweep also rechecks every open connection's authorization, which covers missed notifications, a dropped listener, and expired login sessions. Revocation therefore normally takes well under a second and at most one sweep interval. The spec's 5-second bound relies on notifications; the sweep is a backstop. The listener reconnects with backoff and runs a sweep immediately after reconnecting.

*Alternatives:* Redis pub/sub was rejected as a new service with no benefit at one node. Polling alone at under 5 seconds would query once per connection per second.

### D5. Persistence: debounced snapshots

Hocuspocus `onLoadDocument` reads `collaboration_documents.yjs_state`, or starts empty. `onStoreDocument`, with `debounce: 2000` and `maxDebounce: 5000`, writes `yjs_state`, `text_projection`, `persisted_at`, and `persistence_revision + 1`. Hocuspocus also stores when the last connection leaves. This meets "within 5 seconds" and bounds crash loss to the last debounce window, which the user accepted.

### D6. Ending: `ending` handshake with a 5-second fallback

PATCH `status: "ended"` sets `lifecycle_state='ending'` in a transaction that notifies `session_ending`. The collaboration server stores the document, sets `lifecycle_state='ended'` and `ended_at`, sends a stateless `session-ended` message, and closes the session's connections with reason `session-ended`. The API waits for `ended` by polling the row every 100 ms for up to 5 seconds, then completes the transition itself if needed. Tickets are refused once the state is `ending`. Lifecycle-driven ends (archive, post deletion) use the same path without waiting.

### D7. Update validation before apply

The WebSocket server's `maxPayload` rejects any incoming message over 256 KiB. In `beforeSync`, which receives the decoded sync message type and payload before it is applied, the server handles SyncStep2 and Update messages: it applies the update to a scratch copy of the current document and checks that the only populated shared type is `content` and that its length is at most 200,000. On failure it closes the connection with a policy code, before the real document changes. This costs one copy per update, which is acceptable for small sessions. Task 1.2 confirmed that throwing from `beforeSync` closes the connection and leaves the document unchanged and unbroadcast.

### D8. Presence identity from the server

Clients publish cursor and selection data in Yjs awareness. The server's `beforeHandleAwareness` hook rewrites every inbound awareness state's `user` field to `{ userId, name, color }` from the authenticated connection context before it is applied or broadcast, with the color derived from the user ID. A client therefore cannot impersonate another user even if it sets a fake name, which task 1.2 confirmed. The browser labels cursors from `user.name` and builds the participant list from the awareness states. Rewriting presence in place made the separate stateless `participants` message originally planned unnecessary.

### D9. Data model: migration `020_collaboration_sessions.sql`

The tables follow `database.md`, with these differences:

- `collaboration_sessions` drops `subchannel_id`, since there is no `subchannels` table yet. `post_id` becomes NOT NULL, and the column comes back when channels exist. It gains `title text` (1–120 characters) and `language text` (CHECK on the eight values).
- New `collaboration_participants (collaboration_session_id, course_id, user_id, invited_by_user_id, created_at)`, with primary key `(collaboration_session_id, user_id)` and foreign keys to the session and to `course_memberships`. The creator is inserted as a participant.
- Ticket hashes are unique, and an index on `(collaboration_session_id, user_id)` supports revocation.

The number 020 leaves 016–019 free for the open branches and is renumbered at merge if needed. Course deletion cleanup in `jobs/worker.ts` deletes tickets, participants, documents, and sessions before posts.

### D10. Browser: a separate code editor and a session route

- `routes.ts` gains `course-session` for `/courses/{courseId}/sessions/{sessionId}`. It renders inside the existing course app bar and is not a Discussion tab.
- `apps/web/src/sessions/` holds the REST client, `SessionsPanel`, the start dialog, and `SessionView`.
- `CodeEditor.tsx` is a new CodeMirror 6 instance with line numbers, a monospace theme from existing tokens, and a `Compartment` for the language. It uses `@codemirror/lang-python`, `lang-java`, `lang-cpp` (C and C++), `lang-javascript` (JavaScript and TypeScript), and `lang-sql`, plus `yCollab` from `y-codemirror.next` with Yjs undo.
- `HocuspocusProvider` is given `token` as an async function that requests a fresh ticket, so reconnects use new tickets automatically. The provider's status, authentication failure, and close events map to the five spec'd connection states. A close with reason `session-ended`, or a `session-ended` stateless message, switches the editor to read-only and loads the final snapshot. Because the provider is given an explicit `HocuspocusProviderWebsocket`, it must call `attach()`, which task 1.2 found.

The post detail page shows `SessionsPanel` below the post body: active and recent sessions visible to the viewer, plus a **Start live code session** button.

*Alternative:* reusing `PostEditor` was rejected, because its Markdown toolbar, LaTeX diagnostics, and whole-text replacement do not fit a CRDT-bound code buffer.

### D11. Contract and documentation updates

`collaboration-sessions.md` and `openapi.yaml` are updated to the implemented behavior:

- private access,
- `title`, `language`, and `participants`,
- invitation routes and their errors (`not_course_member`, `forbidden`, `session_ended`),
- `If-Match` PATCH for title, language, and end,
- `anchorType` limited to `post`, and
- removal of the "future contract" banners for implemented routes.

`collaboration-websocket.md` documents the session protocol: the ticket as token, close reasons (`session-ended`, `access-removed`, `invalid-update`; authentication failure is the provider's authentication-failed event), stateless messages, and the reconnect rule. Task 1.2 found that a document-level close always reaches the client as code 1000 with only the reason string preserved, so the reason carries the close's meaning. `database.md`, the README, `.env.example`, and the design doc's future-work note are updated.

## Risks / Trade-offs

- [A crash loses up to about 5 seconds of typing] → The user accepted this. Debounce bounds it, and the last-disconnect and end paths store immediately.
- [One process is a single point of failure for live editing] → REST, snapshots, and the rest of ChalkTalk keep working. Clients show "reconnecting" and recover when it restarts. Multi-node is a later change.
- [Hocuspocus hook behavior differs from assumptions, especially pre-apply validation and token callbacks] → Task 1.2 proves the hooks with a spike test before building on them, and validation falls back to closing the connection and reloading from the last persisted state.
- [A missed `NOTIFY` delays revocation] → The 15-second sweep and a sweep on listener reconnect.
- [Validation on a scratch copy costs CPU] → Bounded by the 256 KiB message limit and small participant counts; measured in tests.
- [Participants see each other's real names, even from an anonymous post] → The start dialog warns before creation, and sessions are private.
- [Migration number collisions with open branches] → Use 020 and renumber at merge.
- [WebSocket proxying through Vite over HTTPS on Windows] → Verified early in task 4.1, with the direct `ws://localhost:3100` URL as a documented fallback for local debugging.

## Migration Plan

1. Deploy the migration, which only adds tables.
2. Deploy the API with the new routes, then the collaboration process. Until the collaboration process is running, tickets can be issued but connections fail, and the UI shows a connection error.
3. Roll back by stopping the collaboration process and reverting the API. The tables can stay, since nothing else reads them.

## Open Questions

- Should ended sessions be listed on the post indefinitely, or only for some period? The default lists them indefinitely, newest first, behind a "Show ended sessions" toggle. A time limit would be a UI-only follow-up.
