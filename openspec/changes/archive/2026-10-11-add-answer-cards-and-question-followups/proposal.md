## Why

Questions need usable answers and followup discussions in the application. The current two-slot answer contract is hidden in the UI and cannot represent independent answer cards or question-level discussions.

## What Changes

- **BREAKING** Replace student/staff answer slots with unlimited answer cards and preserve legacy rows as separate cards.
- Add role-gated, version-checked answer editing that keeps Yjs state and Markdown projection atomic.
- Add question-owned threaded followups with author/staff editing, deletion, tombstones, and anonymous identity projection.
- Add one upvote per member on both answers and followups.
- Update API, database, and OpenAPI references for the new contracts. No attachment or object-store integration.

## Capabilities

### New Capabilities

- `question-followups`: Question-level threaded discussion lifecycle and privacy.
- `content-upvotes`: Member upvotes on answer and followup content.

### Modified Capabilities

- `question-answers`: Unlimited answer cards, role-gated REST editing, and legacy migration.

## Impact

PostgreSQL migrations, answer and new followup/vote API services and routes, API/database/OpenAPI documentation, and integration tests. Existing answer IDs, text, Yjs documents, and contributor records are retained. The question detail UI is tracked on a separate frontend branch.
