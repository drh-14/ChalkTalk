## Context
PostService.update already enforces author/staff, active-course, duplicate and If-Match rules. AttachmentManager currently exposes mutations directly in detail. Composer and attachment queues provide the existing authoring patterns.

## Goals / Non-Goals
**Goals:** Keep view read-only for posts, answers and followups; make post drafts explicit and recoverable.
**Non-Goals:** New backend contracts, redesigning answer/followup text editing, atomic text/file transactions or force overwrite.

## Decisions
- Add a post editor using existing MarkdownEditorField and versioned PATCH, without changing immutable type. Use separate local draft state rather than mutating fetched detail.
- Keep attachment management mounted within editing while metadata refreshes; refresh the editor revision after file mutations without replacing local text. The refreshed revision can include concurrent remote text, which the local draft may replace only on the next explicit Save using that revision. Save text before uploading newly selected files, then retry files independently.
- On an actual Save version conflict retain draft and offer loading the latest post for comparison; explicit review precedes retry against that revision. No automatic force-write.
- Cancel discards unsaved text; already-saved text/files are independent mutations and remain persisted. Disable leaving while requests are pending and reuse the existing draft navigation guard.
- Keep answer and followup attachment managers mounted, but allow mutation only while their existing authorized editors are active. Keep existing create-composer uploads and failed-file queues.
- Check draft consent before starting a merge without unmounting the editor. Hold existing editing inert and block new Edit/navigation while merge is pending; discard the editor only after successful merge, preserving it after failure.
- Apply one Edit-button-only class using existing spacing and radius tokens without changing colors.

## Risks / Trade-offs
- Partial file failure → retain successful text/files and original retry keys in the editor.
- Concurrent writes → attachment refresh may learn a newer revision and remote text without changing the local draft; only explicit Save may replace that text using If-Match. A further Save conflict requires review.
- Anonymous identity → only real server-returned author userId or staff membership grants Edit.
