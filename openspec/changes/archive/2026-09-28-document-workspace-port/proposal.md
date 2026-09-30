## Why

Nine features from Khaihern Low's `redesign-course-workspace` branch were ported onto `discussion-ui-and-answers`, adapted to its layout: a course switcher, tags, URL-backed feed filters, staff Pin/Unpin, a sectioned settings page, a home page with only real data, design tokens, quiet programmatic heading focus, and a last-activity time in the post view. Two current requirements now contradict the product: the browser is specified never to display `lastActivityAt` and never to store filters in the URL. Tags, the course switcher, pinning, and the home and settings changes are not specified at all.

## What Changes

- The course header gains a course switcher beside the course name, and route headings receive focus without a visible focus ring.
- The post view may show a post's last-activity time when it is later than its creation time.
- Post cards and the post view show tags, and selecting a tag filters the feed.
- The sidebar filter, tag, and sort are stored in the URL, restored on load and Back/Forward, and preserved on post links.
- Staff can pin and unpin a post from the post view.
- The home page shows today's date and only the member's real courses, and course settings are grouped into sections.
- No code changes: this records behavior already implemented and tested. Design tokens are an internal styling change with no observable behavior, so no requirement covers them.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `course-discussion-frontend`: the course frame, post creation time, post card, and feed filter requirements change, and a new requirement covers staff pinning.
- `course-management`: new requirements cover the home page's real data and the sectioned settings page.

## Impact

Only `openspec/specs/course-discussion-frontend/spec.md` and `openspec/specs/course-management/spec.md` change, on archive. The implementation is in `apps/web/src/app/`, `apps/web/src/posts/`, `apps/web/src/courses/views.tsx`, and `apps/web/src/styles.css`.
