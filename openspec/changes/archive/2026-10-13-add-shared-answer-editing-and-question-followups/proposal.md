## Why

Questions already have one shared student answer and one shared staff answer, but neither can be edited through the public API and the question has no usable discussion or upvotes. This change completes those core interactions while preserving the two shared slots and the existing Yjs persistence model.

## What Changes

- Keep exactly one active student and one active staff answer per question; add version-checked REST editing to each shared slot.
- Snapshot the staff answer creator's TA or instructor role as its edit floor; student answers remain editable by every current member. Backfill legacy rows conservatively and fail ambiguous histories.
- Clear a current endorsement when content changes, preserve append-only contribution and endorsement events for historical statistics, and allow re-endorsement.
- Add question-level threaded followups with author/staff management, tombstones, idempotency, and cursor pagination.
- Add one toggleable upvote per current member on each answer and followup, with counts and viewer state beneath content.
- Update API, database, OpenAPI, design, and UI contract references. No collaboration sessions, Hocuspocus, uploads, or object storage.

## Capabilities

### New Capabilities

- `question-followups`: Question-owned threaded followup creation, reading, editing, deletion, privacy, and pagination.
- `content-upvotes`: One current-member vote per answer or followup, with idempotent toggling and read projections.

### Modified Capabilities

- `question-answers`: Preserve the two shared slots while adding role-gated REST editing, endorsement clearing, historical events, and legacy role-floor backfill.

## Impact

A PostgreSQL migration, answer and new followup/vote API services and routes, OpenAPI and reference documentation, and real PostgreSQL HTTP tests. The question-detail UI is implemented on a separate frontend branch based on this backend change.
