## Why

The answer-card and question-followup API is delivered separately for backend review. The question detail view still needs to expose those resources and interactions.

## What Changes

- Show independent answer cards with formatted content, contributors, endorsement, and an upvote control beneath each answer.
- Show question-level followups, including the empty-state prompt, threaded replies, and upvotes.
- Reuse the post Markdown and LaTeX editor for answer and followup composition and editing.
- Keep drafts after errors and conflicts, and respect server-projected capabilities and anonymous identities.
- Keep media uploads and object-store integration out of this phase.

## Capabilities

### Modified Capabilities

- `course-discussion-frontend`: Answer and followup interactions in the question view.

## Impact

The web answer client and views, shared post editor and renderer, styles, component tests, and browser screenshots. The backend branch supplies the API and migration. This frontend change stays on a separate branch without a pull request for now.
