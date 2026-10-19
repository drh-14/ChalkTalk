## Why
Posts, answers and followups can receive file uploads while merely being read. Make reading read-only and put attachment management inside their existing authoring flows, adding post Edit.

## What Changes
- Add permission-controlled Edit for questions and notes; retain title, Markdown/LaTeX, tags and anonymity locally until Save.
- Show file selection only in create/edit for posts, both answer slots, root followups and replies, preserving existing read-only images and document links in view.
- Slightly round and pad only Edit buttons, retaining their existing colors.
- Preserve drafts on errors/conflicts and queues on partial file failures; reuse versioned PATCH and independent attachment requests.

## Capabilities
### New Capabilities
None.
### Modified Capabilities
- `course-discussion-frontend`: authorized post editing and edit-only attachment controls for posts, answers and followups.

## Impact
Post and response frontend, HTTP client, unit and mocked Chromium tests. No backend, schema, dependency or Resources changes.
