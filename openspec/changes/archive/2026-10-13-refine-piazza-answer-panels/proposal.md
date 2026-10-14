## Why

The existing answer integration opens a full editor on an unanswered question and colors the two answer areas blue and green. The approved Piazza reference instead uses a compact click-to-start answer prompt with distinct student green and staff amber areas.

## What Changes

- Show a compact click-to-start prompt in a writable empty shared answer area; clicking it opens the existing Markdown and LaTeX composer. Cancel returns to the compact prompt.
- Style the student answer area green and the staff answer area amber, including occupied and empty states, while preserving readable ChalkTalk colors and responsive layout.
- Keep answer upvotes beneath content and retain the question-level followup prompt, API behavior, permissions, and draft recovery.

## Capabilities

### Modified Capabilities

- `course-discussion-frontend`: Refine the two shared answer areas and their empty-state interaction.

## Impact

Frontend answer views and styles, affected UI tests, and mocked-API browser screenshots. No backend contract changes.
