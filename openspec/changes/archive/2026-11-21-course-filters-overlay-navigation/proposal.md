## Why

The approved redesign replaces persistent filter furniture and the tall mobile section list with controls shown only when needed, keeping more course content visible. This supersedes the resize/collapse design already delivered in draft PR271.

## What Changes

- Actual current ChalkTalk UI is the style source of truth; mockups establish interaction/layout only. Preserve production typography, palette, spacing, icons, control appearance, content and role visibility; do not port invented mockup aesthetics/data.
- Replace desktop sidebar and mobile height panel with the same Filters button immediately right of Search, opening a viewport-bounded overlay without shifting the feed.
- At <=850px show Search and New post as accessible icon buttons alongside the text Filters button on one row. Search expands a field below the toolbar; desktop retains its full search field.
- Preserve existing immediate filter/sort/folder/tag semantics; use internal scrolling, outside/Escape dismissal and accessible focus handling.
- Remove resize handles, dimensions hook and width/height preference reads/writes. Existing saved keys may remain inert; no storage migration or deletion is needed.
- At <=850px replace the course-section tab list with a compact current-section dropdown and move All courses to the logo row, preserving notifications/avatar and course switching at 320px.
- Keep desktop section choices and guarded navigation; place sections on the logo row with a current-section dropdown fallback when links do not fit and preserve main's merged responsive-content/title fixes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `course-discussion-frontend`: overlay filters replace collapse/resize/dimension requirements; compact mobile course navigation retains route guards.
- `responsive-course-ui`: narrow course-header navigation uses a dropdown instead of repeated tabs.

## Impact

Frontend only: apps/web/src/posts/views.tsx, obsolete useFilterPanel.ts, apps/web/src/app/App.tsx, styles.css, related component/browser tests and OpenSpec. Existing PR271 remains the delivery target, draft and one commit; no dependencies, APIs, database or unrelated changes. Approved reference: external overlay-redesign mockups; no screenshots committed.
