## Why

The current draft PR enables live editing for followups and replies although the intended release limits collaboration to the two shared answer bodies. Published answer and followup text also needs explicit Markdown/LaTeX rendering coverage at the save transition.

## What Changes

- **BREAKING** Remove live tickets and WebSocket documents for root followups and replies; their existing version-checked REST editor remains.
- Keep Hocuspocus/Yjs concurrency for the two shared answer bodies only.
- Ensure newly created and edited answers, followups, and replies render saved Markdown/LaTeX while the composer retains raw syntax.
- Remove followup Yjs migration, backfill, and synchronization work from this unmerged draft PR.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `live-content-editing`: restrict tickets, transport, and editor to shared answers.
- `question-followups`: keep bodies and conditional editing REST-only.
- `course-discussion-frontend`: require rendered saved content and REST followup/reply editing.

## Impact

Collaboration API/store/server, followup service, migration 014, answer/followup UI, tests, browser evidence, and their API/spec contracts. No new dependency or data ownership boundary.
