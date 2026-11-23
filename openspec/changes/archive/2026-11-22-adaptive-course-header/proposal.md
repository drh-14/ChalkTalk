## Why

The course selector stretches beyond its name, and desktop sections need an adaptive relationship to the discussion detail pane without compressing their labels. The user approved the two-stage actual-style mockups on 2026-11-22.

## What Changes

- Keep the course selector content-sized within available space.
- Align desktop sections to the discussion detail boundary when natural navigation/account widths fit to its right; otherwise place sections after the selector with the existing responsive gap.
- Preserve full-title discovery, all role-visible links, account/notification state, guards, and mobile dropdown behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `responsive-course-ui`: content-fit two-stage desktop header placement.

## Impact

AppBar desktop sizing, a local header measurement hook, existing CSS, and mocked real-browser tests. No dependencies, API, database, mobile redesign, or unrelated documentation changes.
