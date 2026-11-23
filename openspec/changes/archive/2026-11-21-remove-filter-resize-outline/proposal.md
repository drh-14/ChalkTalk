## Why

The user requests that the resize drag handle never show a yellow focus outline.

## What Changes

- Remove only the resize handle outline in all input states.
- Preserve keyboard resizing, touch dragging, accessible separator semantics, and all other focus styles.

## Capabilities

### Modified Capabilities

- `course-discussion-frontend`: resize handle visual treatment.

## Impact

Frontend handle CSS and real-browser regression; no API or dependency changes. A deliberately reduced keyboard-focus affordance is the user-approved accessibility tradeoff; hover/focus tint remains.
