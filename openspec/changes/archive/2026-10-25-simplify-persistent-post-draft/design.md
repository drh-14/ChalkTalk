## Context

PR #83 currently stores arbitrarily many rows keyed by UUID and offers a draft picker. It is unmerged and has no real saved data. The composer already has debounced autosave and conditional revision handling; post creation already runs in a transaction with idempotency replay before draft consumption.

## Goals / Non-Goals

**Goals:** one automatically recovered owner/course draft; conflict-safe cross-device autosave; atomic publication cleanup; no resurrection by a stale tab.

**Non-Goals:** unsent attachment persistence, editing answer/post drafts, offline sync, migrated production draft data, multiple named drafts.

## Decisions

1. Revise migration 049 to make `(course_id,user_id)` the draft key, with nullable JSON `content`, timestamps, and nonnegative version. A row whose content is null is a tombstone/version marker. A never-used resource is represented by version zero and null content without creating a row on GET.
2. Use singular `/api/v1/courses/:courseId/post-draft`: GET returns `{data:{courseId,content,version,updatedAt}}` and `ETag`; PUT with required `If-Match` atomically replaces content using compare-and-swap, including conditional first insert at version zero; DELETE conditionally sets content null and advances version. Membership and archived rules remain. The old plural/ID endpoints are removed because they are unmerged.
3. Post create optionally accepts `draftVersion`, no ID. Idempotency replay occurs before version comparison; successful post creation always clears owner/course draft content and advances its marker inside the post transaction. The supplied version must match if present. This also clears a saved draft when another API client publishes without a draft version.
4. Composer loads the singleton before enabling autosave, applies saved content over search prefill, and displays restoration. The conflict panel reloads the server or, after confirmation, fetches its current ETag and conditionally writes local content. Another race returns to conflict. Discard confirms, conditionally clears server content, then clears local fields; unsent attachments require their separate confirmation.
5. Preserve existing validation and failed-publish behavior. A save failure blocks navigation until retry or explicit discard as it does today.

## Risks / Trade-offs

- A content-free row remains after publish/discard, but no user text remains in it; it is required to reject stale tabs.
- The new singular endpoint breaks only an unpublished PR contract, not production clients.
- First-write races must use a unique constraint and translate a losing insert into `412`, not a server error.
