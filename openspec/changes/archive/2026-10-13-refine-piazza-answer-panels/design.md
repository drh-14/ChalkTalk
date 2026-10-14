## Context

The question detail already mounts two shared answer slots, a question-level followup area, and the post Markdown/LaTeX editor. The current empty writable slot immediately mounts the editor. Its student panel is blue and staff panel green, unlike the approved Piazza reference.

## Goals / Non-Goals

**Goals:** Compact answer start interaction, clear role-colored areas, unchanged backend integration and draft behavior.

**Non-Goals:** New answer kinds, backend changes, uploads, live collaboration, or changed followup semantics.

## Decisions

1. Keep one local open/closed state per answer slot. Mount the existing `TextComposer` only after a click. Keep it mounted through a create race so the local draft stays available beside the newly occupied answer. Key the response subtree by post ID so navigation to another question starts fresh state.
2. Use a button with an explicit accessible name for the empty prompt. The cancel action closes the composer without a request.
3. Use muted green and amber surfaces with darker borders in the existing light theme. Preserve the shared responsive grid and keep vote actions after the rendered text.

## Risks / Trade-offs

Closing a failed draft through Cancel discards it by user action; request failures themselves leave it open. The staff slot is read-only for students and does not show a fake editing affordance.
