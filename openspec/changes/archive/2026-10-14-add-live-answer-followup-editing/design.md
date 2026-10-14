## Context

The existing answer path stores a complete Yjs state and Markdown projection transactionally; followups store only Markdown. Both expose version-checked REST edits. See [approved architecture](../../../docs/design/2026-10-14-live-answer-followup-collaboration.md) for the detailed sequence and failure model.

## Goals / Non-Goals

**Goals:** Commit every accepted inbound Yjs SyncStep2 and Update before Hocuspocus applies them, keep REST and live writers on one PostgreSQL authority, preserve role and anonymity rules, and run multiple nodes with Redis fanout.

**Non-Goals:** Temporary collaboration sessions, named presence or cursors, offline durable queues, attachments, and changing REST operations other than body synchronization.

## Decisions

- Use Hocuspocus 4's awaited `beforeSync` hook: source inspection of v4.7.1 confirms it runs before `readSyncStep2` and `readUpdate`, and each connection serializes frames. Parse only SyncStep2/Update payloads there and transactionally persist the Yjs delta; reject before apply on error. Tests must prove both paths.
- PostgreSQL row locks serialize live, REST, endorsement, and deletion. The persisted complete Yjs state and Markdown projection are authoritative; Redis only fans out accepted updates. Use periodic revision checks for missed REST notices.
- Hash and consume random five-minute tickets in PostgreSQL; recheck session and role inside every update transaction. Never use client-supplied awareness identity.
- Add a followup Yjs document table and migrate old followup bodies in place. Existing answer document state is retained.
- Use the official Hocuspocus Redis extension. Fail closed on Redis unavailability and force reconnection/reload after recovery instead of accepting edits into isolated node memory.
- Bind the existing CodeMirror 6 Markdown/LaTeX editor through `y-codemirror.next`; toolbar edits operate on ranges rather than replacing the full string.

## Risks / Trade-offs

- A database transaction on every accepted update increases write rate → apply strict update/state/text limits, bounded timeouts, and benchmark with two-node tests.
- Redis can fail between PostgreSQL commit and publish → never lose durable text; reconnection and revision reconciliation reload the authoritative state.
- REST full-body replacement may merge awkwardly with concurrent CRDT changes → retain `If-Match` and show converged text in the live editor.
- Hocuspocus internals may shift in a future release → pin major/minor versions and retain protocol tests for both initial sync and later updates.

## Migration Plan

Deploy followup document/ticket tables and empty-body constraint adjustment first; backfill followup Yjs bytes from existing Markdown. Deploy API ticket/REST synchronization, then Redis and collaboration nodes, then enable browser live editing. Rollback browser and collaboration services first; preserve migrated Yjs bytes and use existing REST editing. Do not roll back a schema while live clients still write.
