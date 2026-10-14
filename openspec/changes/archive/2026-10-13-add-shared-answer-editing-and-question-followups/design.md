## Context

Main already has two shared answer kinds, Yjs binary document storage, answer contributor records, and append-only contribution events for statistics. It has no public editing, question-level followup, or vote API. The prior closed answer-card branch is reference material only; this change preserves the two-slot constraint.

## Goals / Non-Goals

**Goals:** Atomic REST answer edits and version conflicts; conservative staff floor migration; question-owned followup threads; idempotent votes; identity-safe projections.

**Non-Goals:** Unlimited answer cards, Hocuspocus, collaboration sessions, live cursors, uploads, object storage, or resolution workflow.

## Decisions

1. Keep `(post_id, kind)` uniqueness for active answers. Add immutable creator and floor columns, backfilled from a unique contributor. Staff floor is TA only when that creator currently has TA membership; instructor is the safe fallback for missing/demoted contributors. Ambiguous histories fail migration.
2. Keep answer REST edits within a transaction that locks the answer before its Yjs document and question. Compare ETag under lock; replace `Y.Text('content')`; persist binary, Markdown, revisions, distinct contributor, and event together. Editing clears current endorsement but retains historical endorsement events for statistics; endorsement can be repeated after a later edit.
3. Store question-owned followups with optional same-question parent, versioned Markdown, author, anonymous flag, and soft delete. Page roots and direct children separately using a stable `(created_at,id)` cursor. Keep a bodyless parent tombstone if children exist.
4. Store votes in separate answer and followup tables with unique target/member keys. PUT/DELETE are idempotent and leave content ETags stable. Project counts and viewer state in read responses.
5. Keep the API and UI on separate branches: the backend is independently testable through real PostgreSQL HTTP tests; the frontend branch bases on that backend and uses mocked API browser tests before publication.

## Risks / Trade-offs

- Legacy creator ambiguity → abort migration with a diagnostic; do not silently grant an edit floor.
- Concurrent REST edits → return `412`; the UI preserves the draft and lets the user refresh intentionally.
- One transaction per text edit → acceptable for initial REST editing; future live batching needs a new durability contract.
- Thread pagination costs multiple queries → index the parent and cursor columns and cap page size.

## Migration Plan

Apply a transactional migration before enabling new routes. Existing answer rows and Yjs documents keep their IDs and bytes. Deployment with ambiguous historical rows halts for manual data resolution. Reverting after new followups or votes have been written requires a database backup; no automatic two-slot data conversion is needed.
