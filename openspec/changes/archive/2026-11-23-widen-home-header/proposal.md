# Widen the home-page header

## Why

The authenticated home header centers its logo and account controls inside a 64rem region, leaving large unused margins on wide screens. The user wants the logo left and notifications/profile right across the available header width.

## What Changes

- Remove the home header's width cap while retaining its existing 1.25rem (20px at the default root size) horizontal padding.
- Preserve the existing logo, green bar, height, controls, menus, focus styling and centered home content.
- Keep course-page headers unchanged.
- Constrain only the home notification panel to the horizontal space available to the left of its bell anchor, fixing pre-existing mobile clipping without changing notifications or controls.
- Keep Create course and Join a course in their existing order on one row at desktop/mobile widths, preserving full labels, style and gap. At 320px, labels may wrap within the buttons instead of shrinking text or targets.

## Capabilities

### New Capabilities

- `home-header`: full-width authenticated home header with existing outer spacing and accessible controls.

### Modified Capabilities

None.

## Impact

Home-scoped CSS, focused real-browser layout tests, and registration in the existing mocked-browser CI command. No dependencies, API changes, data changes, shared component redesign or modifications to PR271.

## Approval

The user approved the actual-style header mockup and browser test seam, then approved the home mobile notification-panel mockup and same-row course-actions mockup. The approved 320px tradeoff preserves full labels and typography by wrapping labels inside taller buttons rather than reducing touch targets.
