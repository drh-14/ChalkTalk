# Design

## Context

- `collaboration_connection_tickets.permission` already allows `read` or `write`; every ticket is issued as `write` today.
- Hocuspocus lets `onAuthenticate` set `connectionConfig.readOnly`. A read-only connection still receives sync and awareness, but Hocuspocus drops its document updates instead of applying them.
- Invitations are `POST /collaboration-sessions/{id}/participants` with `{ userId }`, idempotent for an existing participant.
- Answers allow one student and one staff answer per question; the server picks the kind from the author's role, and a second creation returns `409 answer_kind_exists`. Notes cannot have answers or followups. The web app already has `createFollowup`, `createAnswer`, `listAnswers`, `editAnswer`, and `uploadAttachment`.

## Decisions

### D1. A permission column on participants

Migration 023 adds `collaboration_participants.permission text NOT NULL DEFAULT 'edit' CHECK (permission IN ('edit','view'))`. Existing rows become editors. `create` writes the creator's row as `edit`. `invite` accepts an optional `permission` (default `edit`, otherwise `422 validation_failed`) and inserts it; on conflict it changes nothing. The projection adds `permission` to each participant.

### D2. Read tickets for viewers

`ticket` issues `read` when the caller is a non-staff participant with `view`, and `write` otherwise, including for staff and the creator. The response adds `permission`. The collaboration server copies the ticket permission into the connection context, and for `read` sets `connectionConfig.readOnly = true`. Hocuspocus then neither applies nor broadcasts that connection's updates and keeps it open. `beforeSync` returns early for a read-only context, so whiteboard validation never closes a viewer's connection over an update that would be dropped anyway.

### D3. The viewer's view

`SessionView` reads `permission` from the ticket. With `read`:

- the editor and the whiteboard are read-only;
- the header shows "Viewing" beside the connection state;
- **Post to discussion** is hidden.

The participant list adds "Viewer" to viewers' notes. The invite form gains a **Can edit / Can view** choice.

### D4. Posting through existing APIs

`postFormatting.ts` holds the pure parts, which are unit tested:

- `codeBlock(code, language)` picks a fence one backtick longer than the longest backtick run in the code, with a minimum of three, and labels it with the session language (`cpp`, `python`, and so on; nothing for plain text).
- `postBody(note, block)` joins a trimmed note and the block with a blank line.

The dialog (`PostToDiscussion.tsx`) offers **Followup** to everyone and **Staff answer** to staff:

- **Followup:** `createFollowup(postId, { bodyMarkdown, anonymous: false })`.
- **Staff answer:** `listAnswers(postId)`. If there is a staff answer, `editAnswer` appends the content after a blank line, using its ETag; on a 412 it refetches once and retries. Otherwise it calls `createAnswer`.
- **Board:** the client exports the PNG, creates or updates the text as above (the body is the note or `Whiteboard from the live session "<title>".`), then calls `uploadAttachment(kind, id, file)` with `<slug>-whiteboard.png`.

Idempotency keys are random per submission. On success the dialog shows "Posted" with a link to the post.

The whiteboard tab passes the dialog an export function, so the PNG comes from the same `exportToBlob` call as **Export PNG**.

### D5. Offering posting only where it can succeed

`SessionView` loads the anchor post once (`getPost`) to learn its type and the course status it already has. **Post to discussion** appears only for an active session, an editor, a question, and an active course.

## Risks / Trade-offs

- [Appending to a long staff answer could pass the 100,000-character limit] → The API's `422` message is shown in the dialog.
- [A large board PNG could exceed the attachment size limit] → The upload error is shown; the followup text is already posted and says what the board was.
- [Permission changes need remove and re-invite] → This keeps revocation on the existing removal path.

## Migration Plan

Deploy migration 023 (an added column with a default), then the API, the collaboration server, and the web app. Older clients ignore `permission`.
