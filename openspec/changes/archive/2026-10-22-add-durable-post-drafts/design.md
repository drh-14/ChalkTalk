## Context

The current composer stores input only in React state; queued attachments are `File` objects. `PostService.create` already owns one PostgreSQL transaction covering authorization, post insert, tags/poll options, activity, jobs, and idempotency replay. Course creation and post edits use optimistic ETags. The remote default branch currently has private question/note audiences and polls, while other metadata extensions are separate unmerged work.

## Goals / Non-Goals

**Goals:** Durable incomplete text/metadata, multiple owner-scoped drafts, conditional conflict recovery, and consumption in the existing post-create transaction without changing public post semantics.

**Non-Goals:** Attachment/file persistence, draft expiry, collaborative simultaneous editing/merge, copying between courses, or importing unmerged audience/folder code.

## Decisions

- Migration `049_post_drafts.sql` creates a separate `post_drafts` table with UUID ID, course/user composite membership foreign key with cascading cleanup, JSONB `content`, created/updated timestamps, and integer `version`; an owner/course/updated index serves the list. A draft is not a post: partial content cannot satisfy active-post constraints and must not enter feeds/activity. The JSONB document carries only explicitly validated current composer fields and can be extended deliberately when other metadata PRs merge.
- New owner-scoped REST operations are `GET/POST /courses/{courseId}/post-drafts` and `GET/PUT/DELETE /courses/{courseId}/post-drafts/{draftId}`. List/get use no-store JSON; create returns 201 with Location/ETag; full-replacement PUT uses `If-Match` and returns a new ETag; DELETE uses `If-Match` and returns 204. Owner/course mismatch is masked as 404. No pagination is introduced for owner-managed drafts in this increment.
- Draft writes lock the current course/membership and reject archived/deleting courses. Archived members can still read/discard; the course/member FK automatically deletes drafts on departure or deletion. Draft input validation bounds strings/arrays and rejects unknown fields/files but permits incomplete combinations. Ordinary create-post validation remains the publish gate.
- Existing `POST /courses/{courseId}/posts` adds optional paired `draftId`/`draftVersion` fields. The create transaction checks idempotency replay first, then locks and verifies the owned draft revision, performs all ordinary creation work, and deletes the draft before commit. The submitted post input may include final unsaved keystrokes and is authoritative; the version is a concurrency guard, not a claim that post bytes equal saved draft bytes.
- UI loads the owner's draft list in the course discussion, opens a selected draft into the existing composer, and debounces text/metadata saves. Writes for one composer are serialized; stale response handling never overwrites newer local edits. On 412 the user chooses to reload the server revision or create a separate draft from their local content. Queued attachments remain device-local and are explicitly labeled that way. Publish waits for a stable draft revision or reports the conflict; attachments upload separately after successful post creation as today.
- The existing route shell exposes a synchronous `() => boolean` leave guard. A leave attempt with an unsaved or in-flight draft revision therefore returns `false`, starts or waits for the latest save, and shows a visible “saving before leaving” state. Once saved, the member retries navigation/close, which now succeeds without a text-discard prompt. A failed save keeps the composer and offers Retry or explicit Discard local changes; queued attachments require their own discard confirmation. The guard does not silently proceed on save failure or alter the shell's public callback contract.

## Risks / Trade-offs

- [A draft save succeeds but its response is lost] → Retrying a new-draft POST may create a duplicate. The UI keeps one in-flight create at a time and surfaces retry rather than silently spawning more; a future client-key protocol could eliminate this rare case without changing current persistence semantics.
- [Several drafts make list payload larger] → Content is bounded by existing post maxima and list is owner-only. No pagination is introduced until a measured need.
- [Metadata evolves in other parallel PRs] → Keep one scoped JSONB boundary and explicitly rebase its validator, UI snapshot, API docs, and tests after those PRs merge; do not copy their unmerged implementation here.
- [Course state changes during publish] → Existing course lock and writable check plus draft lock keep the post/draft transaction atomic.

## Migration Plan

Apply the additive migration, deploy API then UI, and retain existing posts unchanged. Rollback of application code leaves unused owner-scoped draft rows; dropping the table is destructive and not part of automated rollback. On future metadata branch rebases, extend the draft content contract and tests before deployment.

## Open Questions

None. The member chose wait-for-latest-save behavior for navigation and close.
