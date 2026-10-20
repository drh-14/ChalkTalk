## Context

Post detail already gates Edit with canEditDetail and preserves merge-pending behavior. Only the action location changes. The user superseded the earlier native file-button styling request and explicitly prohibited screenshot recapture.

## Goals / Non-Goals

**Goals:** Move existing Edit beneath visible post content.
**Non-Goals:** File-input styling, custom picker replacements, changed colors, permissions, save/upload behavior, Resources or other redesign.

## Decisions

- Move existing post Edit after rendered body/attachments, retaining editor placement and existing disabled/permission checks.
- Restore stylesheet and attachment picker behavior exactly to main; remove withdrawn style-specific assertions and helper.
- Run only non-capturing desktop/mobile placement browser cases and component/repository checks. Do not run screenshot-producing browser flows locally or through the revised gate.
- Retain four already-captured placement images with honest historical labeling, remove twenty obsolete styled-picker images, and do not claim a current screenshot of picker appearance.

## Risks / Trade-offs

- No refreshed screenshots → user explicitly accepted this recapture exception; behavioral browser checks and component order assertions verify the retained placement behavior.
