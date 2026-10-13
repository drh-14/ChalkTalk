## Context

The backend adds unlimited answer cards and question-owned threaded followups. The existing question detail view uses the former student/staff answer slots. The full approved design is recorded in `docs/design/2026-10-11-answer-cards-and-question-followups.md`.

## Goals / Non-Goals

**Goals:** Present answer cards and followups in the question detail view with accessible text-only editing, votes, contributor visibility, and recoverable drafts.

**Non-Goals:** Live Hocuspocus editing, collaboration sessions, image/document upload, or object-store calls.

## Decisions

1. Replace the two answer slots with a list of independent cards. Use the API's `canEdit` and other projected capabilities rather than recomputing role rules in the browser.
2. Extract the existing Markdown/LaTeX editor field from the post composer so answer and followup composition share its toolbar, preview, and math diagnostics.
3. Render answer and followup Markdown with the existing sanitized post-body renderer. Show anonymous identities only as projected by the API.
4. Keep answer and followup drafts on request errors and `412` conflicts. Let the member refresh server state without silently discarding local text.
5. Load answers and followups independently so one failed request does not erase the other section.

## Risks / Trade-offs

- The frontend branch depends on the backend branch's API and migration; it should be tested against that branch before use.
- REST edits detect conflicts but do not merge concurrent drafts; live collaboration remains a separate phase.

## Delivery

Keep this branch separate from the backend draft PR. Retain browser screenshots and tests with the frontend code. No frontend PR is opened in this phase.
