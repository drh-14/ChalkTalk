## Why

Moving from course Discussion to Settings currently performs a full document navigation. Members see the app-level session loading screen, then a separate course loading screen, before a visually unrelated settings header appears. The transition feels abrupt even when data loads quickly.

## What Changes

- Keep a shared course header, course name, Back to courses control, and Discussion/Settings navigation mounted across both course views.
- Make Discussion-to-Settings and Settings-to-Discussion navigation client-side while preserving direct URLs and browser Back/Forward behavior.
- Load settings-specific data inside the settings content region, keeping the common course frame visible and providing an accessible loading/error state.
- Retain a narrower settings content column beneath the shared header; preserve the existing membership and administration actions and draft-discard confirmation.
- Add rendered route and interaction tests for continuity, loading, navigation, and failure handling.

## Non-Goals

- Changing course or membership API contracts, database schema, or settings permissions.
- Introducing a routing/state-management dependency or making the full settings content as wide as the discussion feed.
- Adding animation merely to hide a document reload; reduced-motion users must not need an animation to understand the view change.

## Capabilities

### Modified Capabilities

- `course-discussion-frontend`: shared course frame and client-side Discussion/Settings transition.

## Impact

- Affects the web route shell, discussion and course-settings views, styles, and frontend tests.
- No backend, dependency, or migration change.
