## Context

The merged course-file backend already has a file-backed multipart parser, structural validation for eight file types, bounded S3 transfer, a private download route, and worker-managed deletion. Posts, shared answers, and followups have independent visibility and edit rules; their current responses have empty or absent attachment lists. The save-only Markdown answer/followup UI is merged on main; this change integrates attachments without replacing its independent drafts, explicit overwrite, or response-reconciliation rules. See proposal.md and the delta specs for required behavior.

## Goals / Non-Goals

**Goals:** Preserve parent-specific authorization, avoid duplicating file-format validation, keep object bytes private, and make storage cleanup reliable without prolonging requests.

**Non-Goals:** Embedding existing standalone course files; public/presigned URLs; attachment search or extraction; changing standalone course-file upload/download/delete permissions; adding followup discussions to notes.

## Decisions

1. **One parent-scoped attachment table.** Store `course_id`, nullable `post_id`/`answer_id`/`followup_id` with a database check that exactly one parent is set, object key, validated metadata, checksum, and `deleted_at`. Composite foreign keys keep every parent in the same course. A unique object key and a parent-live index support lookups/cap. Parent deletion uses logical hide before asynchronous object cleanup.
2. **Explicit parent route, shared storage engine.** Add multipart POST, DELETE, and authenticated GET download endpoints for each parent type. A common attachment service handles validation, object transfer, idempotency, five-file cap, and lifecycle; parent-specific policy resolution performs current-member, visible-parent, active-course, and edit checks inside the final database transaction. This avoids giving students the standalone instructor-only course-file API.
3. **Serialize cap and lifecycle with parent locks.** The final insert locks the parent and rechecks visibility, edit permission, active course, and count after validation/upload. A concurrent deletion/merge cannot publish an attachment after the parent disappears. An ambiguous commit never deletes bytes until row existence is checked; ordinary rollback attempts best-effort deletion.
4. **Private streaming.** The download route checks membership and parent visibility on every request and streams exact S3 bytes. Validated raster images are served `inline`; documents `attachment`, always `nosniff` and `private, no-store`. The UI obtains an authenticated same-origin URL, not a public storage URL. Metadata omits uploader identity.
5. **Version and endorsement.** Answer add/remove locks the answer, increments its version, clears current endorsement, and records the editor while leaving append-only endorsement events unchanged. Post and followup attachment changes likewise advance parent version so an active editor sees a new ETag. The binary upload is independently idempotent; it does not change body Markdown.
6. **Independent composer retries.** Create text via existing JSON routes, then upload each selected file sequentially with its own stable idempotency key. Failed uploads retain the parent and successful files; retry targets only the failed file.
7. **Worker cleanup.** Attachment removal and parent deletion hide rows transactionally and enqueue `delete_content_attachment` jobs. Confirmed duplicate merges do not delete bytes; ordinary reads and downloads hide attachments while merged. Course deletion includes attachment object keys in its cleanup snapshot.

## Risks / Trade-offs

- **Large files and concurrency:** File-backed validation limits API memory, but temporary disk and S3 transfer still consume resources. The existing 100 MiB and multipart limits apply.
- **Object-store/API split:** A crash between object PUT and database commit can orphan bytes, as with standalone course files. Best-effort rollback cleanup applies; crash-orphan reconciliation remains outside this change.
- **In-flight authorization change:** The final locked recheck rejects stale uploads; a download already streaming when membership is revoked cannot retract bytes already sent.
- **Stale parent response during upload:** The frontend refreshes the parent after each upload/removal rather than assuming its old ETag remains current. Refreshes preserve failed upload queues and version-guard newer projections; answer/followup file mutations participate in the existing activity reconciliation.

## Migration Plan

Add a forward-only attachment table migration and worker job kind. Apply this migration after the save-only answer migration and deploy the worker and API together. No attachment code reads or writes answer Yjs storage. Existing parents start with no attachments; no data backfill. On rollback, stop writes first; retained rows and objects remain recoverable and later cleanup can resume.
