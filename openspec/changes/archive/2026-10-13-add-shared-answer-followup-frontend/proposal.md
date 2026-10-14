## Why

The backend now exposes two shared answer slots, question-level followups, versioned REST edits, and upvotes. The question detail page still presents the original read-only answer experience and does not expose followup discussions.

## What Changes

- Render a distinct student answer area and staff answer area with formatted Markdown/LaTeX, contributor bylines, endorsements, and an upvote control beneath each answer.
- Render question-level followup roots and nested replies, including a prominent zero-followup compose prompt, pagination, editing, deletion, tombstones, and upvotes beneath content.
- Share the post Markdown/LaTeX composer for answer and followup creation and edits.
- Preserve local draft text through creation races, request failures, and `412` version conflicts, with an explicit refresh action.
- Respect server-projected edit capabilities, current role, anonymous identities, and archived course state. No media uploads, object storage, collaboration sessions, or WebSockets.

## Capabilities

### Modified Capabilities

- `course-discussion-frontend`: Present shared answer slots and question-owned followup interactions in question detail.

## Impact

Web answer client and views, shared post editor and renderer, styles, component tests, and mocked-API browser screenshots. This frontend branch is based on the backend branch and has no pull request in this phase.
