## Context

The existing answer table and API enforce one active student and staff answer per question. Each answer has an authoritative Yjs document plus Markdown projection, but the public API cannot edit. This change delivers the data model and API independently of the question UI.

## Goals / Non-Goals

**Goals:** Preserve legacy answer identities and bodies; provide independent answer resources, question discussions, versioned edits, and upvotes through the API.

**Non-Goals:** Hocuspocus, live cursors, collaboration sessions, image/document upload, object-store calls, or separate student/instructor answer slots.

## Decisions

1. Migrate answer rows in place, drop the `(post_id,kind)` uniqueness index and public `kind`, snapshot `created_by_user_id` and `edit_role_floor`. For legacy rows, use the single contributor's current membership role; if absent, map old student to student and old staff to instructor. Fail on ambiguous multi-contributor histories. This preserves documents and IDs instead of merging content.
2. Answer REST edits lock the answer and its document in one transaction. After authorization and ETag comparison, replace `Y.Text('content')`, then save the encoded state, Markdown projection, incremented revisions, and distinct contributor. Lock ordering matches endorsement and deletion. This avoids Yjs/projection divergence; standalone Markdown overwrite is rejected.
3. Followups use question ID and optional parent ID, a versioned Markdown body, author ID, anonymous flag, and soft delete. Root and child lists are separately paginated. A deleted parent with children is projected as a tombstone; leaf deletion is hidden. This avoids unbounded recursive page reads.
4. Separate answer and followup vote tables have unique target/member pairs. PUT/DELETE are idempotent and do not touch content versions. The API projects counts and viewer state rather than asking the client to infer them.
5. Preserve anonymous identity rules for answer contributors and followup authors. Staff can see anonymous identities; students cannot see an answer's contributor list even when they contributed.

## Risks / Trade-offs

- Legacy creator cannot be inferred from multiple contributors → fail migration with an actionable diagnostic rather than grant an arbitrary edit floor.
- Concurrent REST edits conflict → `412` lets clients preserve drafts and refresh; live synchronization is deferred.
- Root count and descendant pagination need separate queries → index `(post_id,parent_followup_id,created_at,id)` and cap page size.

## Migration Plan

Apply a transactional database migration that backfills legacy creator/floor and retains answer rows/Yjs state, then creates followup and vote tables. The existing question UI does not consume these answer and followup endpoints; its replacement is tracked separately. Rollback requires restoring the prior application and schema backup once new independent answers or question-owned discussions have been written; do not silently collapse those records into two slots.
