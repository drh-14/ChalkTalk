## Why

New-post text currently exists only in the active browser composer. Closing the page, changing devices, or a reload can lose it; the composer also cannot manage several unfinished posts in one course.

## What Changes

- Save multiple private, durable, owner-scoped new-post drafts per course, with text and current post metadata but never queued attachments.
- Add list, create, read, conditional update, and discard APIs with ETag/version conflict handling and no expiration.
- Add debounced composer autosave and conflict recovery choices to reload the server revision or save local content as a new draft.
- Publish a selected draft through the existing create-post operation, checking its current version and deleting it atomically with post creation.
- Allow a member to read/discard drafts in an archived course, but not create/update/publish them. Course/account/membership cleanup removes drafts.

## Capabilities

### New Capabilities

- `post-drafts`: Private durable draft storage, API lifecycle, conflict handling, and composer management.

### Modified Capabilities

- `text-posts`: A post may be created from a matching draft revision in the same transaction, without changing ordinary post creation behavior.

## Impact

Adds one PostgreSQL migration and draft service/routes, extends the existing post-create transaction and JSON contract, updates the course composer and API/OpenAPI/database references, and adds API/DB/browser tests. No dependency, attachment persistence, expiration, or cross-course copying.
