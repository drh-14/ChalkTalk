## Why

Course discussions currently support text only, so a member cannot include a diagram or supporting document directly with a post, shared answer, or followup. The validated course-file storage foundation is now available and can be reused without changing standalone course-file permissions.

## What Changes

- Add independently uploaded, immutable attachments to question and note posts, the two shared answer slots, and question-level followups and replies. Do not add followups to notes or link existing standalone course files.
- Permit up to five active attachments per parent, each at most 100 MiB and one of the eight validated file types already supported by course files.
- Authorize add/remove using the parent's existing edit rules, and authorize reads using current course membership and parent visibility. Render images centered beneath body text and other files as download links.
- Preserve text created by the composer when a later attachment fails, with per-file retry. Hide duplicate-source attachments while merged, restore on unmerge, and enqueue storage cleanup after parent or attachment deletion.
- Clear a shared answer's current endorsement after an attachment change while preserving the historical endorsement event.

## Capabilities

### New Capabilities

- `content-attachments`: Parent-scoped attachment API, storage lifecycle, access rules, and in-content presentation.

### Modified Capabilities

- `text-posts`: Active posts expose attachments rather than always an empty list.
- `question-answers`: Answer attachment mutations become available without changing the shared-answer permission model.
- `question-followups`: Followup and reply attachments become available after text creation.
- `course-discussion-frontend`: The save-only discussion UI exposes parent-scoped files with recoverable upload failures.

## Impact

Adds an attachment migration, parent-scoped API routes and projections, S3 cleanup jobs, and frontend composer/view integration. Reuses the existing bounded multipart parser and validated file formats. No standalone course-file API permission change and no non-OpenSpec documentation expansion.
