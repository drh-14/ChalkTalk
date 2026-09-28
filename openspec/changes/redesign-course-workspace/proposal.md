# Proposal

## Why

The course workspace is where students and staff spend nearly all of their time, but today it reads as a prototype: the app header disappears inside a course, the feed shows about three posts per screen inside a nested card, post cards omit timestamps, tags, pinned and answered state, the reading pane is mostly empty, and settings overflows horizontally on phones. The home page also shows hardcoded placeholder posts and a hardcoded date. ChalkTalk's core promise is that a semester of discussion is easy to scan and search, and the current layout works against that before answers, follow-ups, and semantic search land on top of it.

## What Changes

- Introduce a persistent application top bar on the home, course discussion, and course settings routes: wordmark linking home, a course switcher listing the member's courses, the signed-in user's avatar and Sign out. Inside a course it also carries the course name and the Discussion / Course settings navigation, replacing the current floating course header.
- Restructure course discussion into a full-height, three-region workspace on wide screens: a filter rail, a dense post list, and a full-height reading pane. Each region scrolls independently within the viewport instead of inside fixed-height cards.
- Add a filter rail backed only by list filters the API already implements: All posts, Questions, Notes, and Unanswered (questions with `answered=false`); a sort choice of Recent activity or Newest when no search is applied; and an active tag filter set by selecting a tag on a post. Filter, sort, and tag state is stored in the URL like the existing `q` parameter.
- Make post list rows compact: type marker, title, one-line excerpt, projected author, relative timestamp, tags, and Pinned / Unanswered badges.
- Restructure post detail into a header (type, title, author, timestamps, tags, badges), a Markdown body, and a staff action bar holding the existing Merge as duplicate control plus a Pin / Unpin control using the existing conditional PATCH. The pane's structure leaves a clearly delimited region below the body where answers and follow-ups will attach later; no placeholder answer UI is shown now.
- On screens at or below 850px, present the list and the selected post as separate full-width views, with filters in a horizontally scrolling chip row above the search field and list; no horizontal page overflow on any route at 320px width or more.
- Restyle course settings into labeled sections (course details with join code, members, danger zone) using the shared form and button styles.
- Replace the home page's hardcoded "In the discussion" panel and date with real data only: the current date and the member's course list as the primary content. The placeholder panel is removed.
- Keep route-change focus on the page heading for screen-reader announcement, but suppress the visible focus ring when focus is moved programmatically rather than by keyboard.
- Introduce shared CSS design tokens (colors, spacing, radii, type scale) and migrate the workspace, home, and settings styles to them.

No API, database, or OpenAPI changes. Accessible names used by existing tests (Create post, Search posts, Post view, Course settings, Merge as duplicate, and similar) are preserved.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `course-discussion-frontend`: The course frame requirement changes from a per-course header to a persistent app top bar with a course switcher; the desktop scrolling requirement changes from a single scrollable feed card to independently scrolling full-height regions; the feed requirement gains compact rows with timestamps, tags, and status badges; new requirements add URL-backed type/unanswered/tag/sort filters, a structured detail pane with a staff Pin / Unpin action, narrow-screen list/detail navigation without horizontal overflow, restyled settings sections, a home page that shows only real data, and non-visual programmatic heading focus.

## Impact

- Code: `apps/web/src/app/App.tsx` (Home, CourseFrame, new top bar), `apps/web/src/app/routes.ts` (filter and sort URL parameters), `apps/web/src/posts/views.tsx` (Discussion layout, list rows, detail pane, filters), `apps/web/src/posts/client.ts` (list options for `type`, `answered`, `tag`, `sort`; pin update), `apps/web/src/courses/views.tsx` (settings sections), `apps/web/src/styles.css` (tokens and layout rewrite).
- Tests: `App.test.tsx`, `routes.test.ts`, `posts/views.test.tsx`, `posts/client.test.ts`, and `courses/views.test.tsx` gain coverage for the new behaviors; existing assertions keep passing because accessible names are preserved.
- APIs and database: none. The UI uses only documented and implemented list parameters (`type`, `answered`, `tag`, `sort`) and the existing staff `pinned` PATCH.
- Dependencies: none added.
- Known limits carried forward: `answered` is always `false` until answers ship, so Unanswered currently equals Questions; the API has no course tag index, so tag filtering starts from tags shown on posts rather than a full tag list; the API has no pinned-first ordering, so pinned posts are badged but not floated to the top.
