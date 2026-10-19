## Context

Question detail already shows student/staff answer slots and uses a simple textarea for answer creation. The backend now serves `kind`, `canEdit`, vote state, and question-level followup pages. REST writes use answer/followup ETags and idempotent creation keys.

## Goals / Non-Goals

**Goals:** Two stable colored answer areas, question-level threaded discussion, accessible text editing and voting, identity-safe projections, and drafts that survive conflicts.

**Non-Goals:** Live collaboration, uploads, object storage, a resolution workflow, or a frontend PR.

## Decisions

1. Keep student and staff answer areas fixed and map returned answers by `kind`; each occupied slot shows content and permitted actions, and each empty slot shows its role-appropriate composer.
2. Use API `canEdit` for answer edits and followup edits, and render contributor/author identity exactly as projected. Vote actions use the server's count and viewer state.
3. Extract the existing post Markdown/LaTeX editor field so post, answer, and followup composers share toolbar, preview, and math diagnostics. Render content through the existing post-body renderer with images disabled for text-only answer/followup content.
4. On `409 answer_kind_exists`, refresh the occupied answer slot while retaining the create draft for explicit user choice. On `412 version_conflict`, keep edit text open, show a conflict message, and offer a refresh that does not overwrite local text.
5. Load answers and followups independently; paginate roots and direct replies with the API cursor. Keep deleted parent tombstones visible when replies exist.

## Risks / Trade-offs

- REST writes detect but do not merge simultaneous drafts; users choose whether to refresh and replace their draft.
- The frontend branch depends on the backend API branch and must be rebased onto its final gated head before verification.
