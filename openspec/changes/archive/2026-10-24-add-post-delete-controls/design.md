## Context

The existing `DELETE /api/v1/posts/{postId}` performs membership, visibility, role, archived-course, duplicate, ETag, and CSRF enforcement. The discussion detail has `Post.version`, resolved course role, current user ID, a guarded editor, and loaded feed rows.

## Goals / Non-Goals

**Goals:** Expose existing deletion rights, protect against accidental deletion, and recover safely from stale versions and API conflicts.

**Non-Goals:** New moderation permission, blind staff access to private audiences, or changes to followup/reply deletion.

## Decisions

- Use the same author-or-staff visibility gate as editing, including active course and unmerged post checks. Server remains authoritative.
- Add a client helper that checks only HTTP status for the `204` bodyless success, avoiding JSON parsing of empty responses.
- Keep deletion in detail view, not feed cards; confirm before mutation. On success update local feed state immediately and navigate to the discussion list.
- If editing is underway, do not discard the local editor on cancel or failed deletion. Disable deletion while a save or merge is pending; block stale deletes through `If-Match`.
- On `412`, reload the current post and update only the saved server projection; the keyed local editor remains mounted with its unsaved text. The user must explicitly retry.

## Risks / Trade-offs

A readable canonical may have confirmed duplicates. The UI cannot know this from detail; the API returns `409 canonical_has_duplicates`, which the UI displays. A previously readable post may become inaccessible before deletion; the server responds with its existing privacy-preserving error.
