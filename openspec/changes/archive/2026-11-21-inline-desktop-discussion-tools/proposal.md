## Why

The user refined PR271 after verification: desktop New post and Filters must share the full Search field row, and desktop section links should compact to fit the logo row rather than use a dropdown. This preserves visible navigation and reduces header/tool clutter.

## What Changes

- Desktop Search, Filters and New post share one row without overflow; mobile icon row and below-toolbar search stay unchanged.
- Desktop retains every existing section link inline beside the course identity. Compact spacing/control presentation at narrower desktop widths, keeping readable labels, title discoverability and account controls.
- Current-section dropdown remains mobile-only. No APIs, dependencies or filter/navigation semantics change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `course-discussion-frontend`: inline desktop discussion tools and compact full desktop navigation.
- `responsive-course-ui`: desktop section links remain on the logo row; mobile dropdown unchanged.

## Impact

Existing frontend CSS/AppBar presentation and focused component/browser tests, specifications only. Same draft PR271 and final single-commit/full-gate delivery obligations.

- Latest explicit user decision: remove All courses at every width; ChalkTalk logo is the guarded home link.
