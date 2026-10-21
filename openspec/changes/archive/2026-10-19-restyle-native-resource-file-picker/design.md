## Context
The prior refinement deliberately left the native chooser unchanged; the user now explicitly includes it. The existing labeled native file input remains the right interaction.

## Goals / Non-Goals
Apply radius-lg and space-3/space-5 padding to only `.course-files input[type="file"]::file-selector-button`. Preserve native foreground/background/border and existing input font, picker, accept filter, disabled behavior and keyboard accessibility. Do not replace with a fake control or change discussion inputs/global CSS.

## Decisions
Set only border-radius and padding on the scoped native pseudo-element. Compare computed colors/border to an unstyled native input in Chromium rather than hardcoding platform colors. Test actual click and keyboard filechooser operation at desktop/mobile sizes.

## Risks / Trade-offs
The chooser grows but the existing responsive input layout accommodates it. Assert no horizontal overflow and capture screenshots before and after choosing a file.
