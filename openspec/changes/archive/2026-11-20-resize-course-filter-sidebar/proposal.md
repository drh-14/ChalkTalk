## Why

Course members can collapse desktop filters but cannot adjust their size. Mouse, keyboard, and mobile touch users need control over filter space without sacrificing access to the feed.

## What Changes

- Add desktop right-edge width resizing and mobile bottom-edge height resizing, usable with mouse, touch, and keyboard.
- Default filters to collapsed on desktop and mobile on each course discussion mount; expanding restores the saved dimension for that breakpoint.
- Add a visible Filters label beside the existing circular desktop arrow toggle, preserving its original shape, icon and directional behavior.
- Remember desktop width and mobile height separately, constraining rendered dimensions to available space.
- Make mobile filters compact and internally scrollable, stacked above the full-width feed; shrinking or collapsing filters gives the feed more vertical room.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `course-discussion-frontend`: Resizable filters and collapse controls across viewport sizes.

## Impact

Scoped to the filter layout in `apps/web/src/posts/views.tsx`, `apps/web/src/styles.css`, associated component/browser tests, and OpenSpec artifacts. No API, database, dependency, navigation-sidebar, or PR #269 changes.
