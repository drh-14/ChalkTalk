## Why

ChalkTalk's conditional saves prevent lost updates but offer no way to inspect or recover earlier text. Course members need a privacy-safe audit trail for posts and discussions without reviving deleted material or changing the existing save-only editor.

## What Changes

- Record immutable baseline and subsequent text snapshots for active posts (title/body), answers, root followups, and replies. Backfill one baseline of the current text for existing live content, without inventing its prior editors.
- Let a current authorized reader list and compare text revisions; protect anonymous editor identities using the content's existing visibility rules.
- Let current course staff restore a prior text snapshot using a current `If-Match`; restoration creates a new revision and leaves attachments, audience, poll configuration, and moderation state unchanged.
- Purge history when content is deleted, including nested content deleted with a post; never expose history of hidden, deleted, or merged content to ordinary readers.

## Capabilities

### New Capabilities

- `content-revision-history`: Revision capture, baseline migration, visibility, comparison, restore, and deletion lifecycle across post and discussion text.

### Modified Capabilities

None. Existing create/edit/delete contracts and save-only editing remain in force; the new capability adds separate history routes and persistence.

## Impact

PostgreSQL migration (reserve `047`), API routes/services and OpenAPI/API/database references, post and answer/followup text writes and deletion paths, web history/compare/restore UI, and authorization, migration, API, and browser tests. No new dependency or Yjs editing is proposed.
