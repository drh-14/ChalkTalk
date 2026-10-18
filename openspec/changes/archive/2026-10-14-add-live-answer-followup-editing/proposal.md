## Why

The shared answer and followup editors currently save whole-body replacements through REST. Two authorized people editing at once can conflict instead of seeing each other's changes. This change adds durable live collaboration while retaining the existing role model and REST compatibility.

## What Changes

- Add one-use, session-bound tickets for existing answer and followup bodies, including replies, and a separate Hocuspocus WebSocket service.
- Persist each accepted Yjs edit and its Markdown projection in PostgreSQL before applying or broadcasting it; replicate across nodes through Redis.
- Keep conditional REST edits synchronized with live documents and continue REST for answer, followup, and reply creation, votes, endorsement, and deletion.
- Bind the existing Markdown/LaTeX CodeMirror editor to Yjs, with connection/rejection feedback and identity-safe awareness.
- Allow temporarily empty live text, but continue requiring nonblank REST creation/edit and endorsement.

## Capabilities

### New Capabilities

- `live-content-editing`: Tickets, WebSocket authorization, durable Yjs updates, cross-node synchronization, and live editor behavior.

### Modified Capabilities

- `question-answers`: Remove the prohibition on live editing, synchronize REST edits, and reject endorsement of empty text.
- `question-followups`: Persist followup Yjs documents and keep REST edits synchronized.

## Impact

API routes, collaboration process, answer/followup services, PostgreSQL migrations, Compose and Redis, web editor, API/database/deployment documentation, and browser/integration tests. Adds Hocuspocus 4, its Redis extension and provider, and the CodeMirror Yjs binding. No object-store integration or temporary collaboration sessions.
