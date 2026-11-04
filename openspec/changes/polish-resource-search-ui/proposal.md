# Proposal

## Why

OCR resource search works, but its native search input and mixed controls do not match ChalkTalk's existing interface. Instructors must scroll past three management forms to discover search, particularly on mobile.

## What Changes

- Place labeled resource search immediately after the page introduction, before instructor management forms, with the existing discussion search styling and an accessible clear action.
- Use established control, focus, spacing, status, and notice treatments throughout the Resources page.
- Distinguish pending extraction from unavailable contents using text and existing theme colors; keep these notices staff-only.
- Preserve search, upload/edit/remove/order, access control, pagination, and unsaved-editor behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `resource-text-search`: make search prominent and visually consistent, with usable themed controls and state feedback at desktop/mobile widths.

## Impact

Only Resources-page React markup/CSS, focused component/browser tests and screenshots. Reuse the existing theme; no new dependencies, API, worker, database or extraction changes.
