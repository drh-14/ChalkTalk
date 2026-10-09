## Why

Answer creation persists an empty Yjs marker and Markdown text, but no code can load, merge, and durably save the corresponding CRDT document. The isolated core makes that documented persistence model testable before any editing transport is exposed.

## What Changes

- Add a private answer document store that seeds `Y.Text('content')` once, loads binary Yjs state, applies updates, and atomically persists the Markdown projection.
- Guard loads and writes against inactive answer, document, or course lifecycle and reject invalid updates without partial writes.
- Add headless PostgreSQL integration tests for merge, idempotence, lifecycle, and REST-facing projection.
- Clarify documentation status and persistence invariants.

## Capabilities

### New Capabilities

- `answer-document-core`: Private, durable Yjs answer document load and update behavior.

### Modified Capabilities

None. Existing answer HTTP routes and contracts remain unchanged.

## Impact

API workspace gains the `yjs` dependency and a private answer document module. It uses existing `answers` and `answer_collaboration_documents` tables without a migration. There is no ticket API, Hocuspocus or WebSocket server, temporary collaboration session, Compose service, or UI.
