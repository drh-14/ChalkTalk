## Why

New-post text should be recovered automatically, not managed as a collection of named drafts. The existing unmerged draft PR asks users to select among multiple drafts and can recreate a published draft from a stale device.

## What Changes

- **BREAKING (unmerged draft API):** replace the multi-draft collection and ID endpoints with one course-scoped draft resource per owner.
- Restore saved text and metadata automatically when opening New post; remove the draft picker and save-as-new flow.
- Keep explicit conflict recovery, confirmed discard, and atomic draft clearing on successful publication. A content-free revision marker prevents stale devices from recreating a published draft.
- Keep draft content private, text/metadata-only, and independent from unsent attachments.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `post-drafts`: singleton lifecycle, autosave, conflict recovery, and publication cleanup.
- `text-posts`: atomic clearing of the course draft during successful post creation.

## Impact

PR #83's unmerged migration 049, post service and HTTP routes, web composer/client, API and database references, and browser/API tests change. No already-deployed data requires conversion.
