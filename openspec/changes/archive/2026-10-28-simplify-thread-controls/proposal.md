## Why

The public Threads interface offers an attachment control that is not needed for the course-project rollout, and its recently enlarged buttons take too much space. Existing uploaded files must remain readable.

## What Changes

- Remove the Threads attachment picker from the browser UI only. Keep the upload API and storage implementation unchanged, and keep existing attachment links visible.
- Reduce all Threads action-button dimensions by approximately 20% while retaining the shared button visual hierarchy and keyboard focus treatment.

## Scope

Threads frontend, browser evidence, and UI specification only. No API or database contract changes.
