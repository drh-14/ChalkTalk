## Context
The native file selector already has approved radius/padding but retains gray platform colors and font. Add link is an existing primary button.

## Goals / Non-Goals
Use the same accent background, warm-white foreground, borderless bold inherited font, radius/padding and minimum height as Add link. Match hover background/translation, visible keyboard focus and disabled opacity/cursor. Keep the actual labeled native file input, accept formats, disabled state and click/Enter picker.

## Decisions
Scope every selector under `.course-files`. Style the native `::file-selector-button`; do not introduce a fake control, change labels or move controls. Use existing accent, accent-hover, focus, radius and spacing tokens. Focus outline belongs to the real input to preserve keyboard feedback.

## Risks / Trade-offs
Browser-native file controls vary, so compare computed visual properties against Add link in real Chromium at desktop/mobile widths and exercise actual native click/Enter filechooser and upload progress.
