# Design

## Context

See proposal.md for motivation. Current state that shapes the approach:

- `App.tsx` renders `Home` with its own `home-header`, and `CourseFrame` with a separate `discussion-header` that has no wordmark, avatar, or sign-out. The two headers share no component.
- `posts/views.tsx` `DiscussionContent` owns feed state (query, cursor pages, stale-response guards, selection, composer draft guard) and renders a two-column grid. The feed is a fixed-height card with a nested scroll region; detail is a card sized to content.
- `posts/client.ts` `listPosts` supports `q`, `sort=relevance`, `cursor`, `type=question`, and `limit`. Its `Post` type omits `pinned` and `answered`, although the API returns both. There is no generic post-update helper; only `confirmMergePost` and `unmergePost` issue conditional PATCHes.
- The API implements `type`, `tag` (repeatable, OR), `answered`, and `sort` (`relevance`, `newest`, `recent_activity`). `answered=true` always returns an empty page and `answered=false` equals `type=question` until answers exist. There is no pinned-first ordering and no tag index endpoint. `joinCode` is non-null only for instructors.
- `styles.css` is about 980 lines with about 108 literal hex colors and no custom properties; breakpoints are 850px and 760px.
- Tests locate elements by accessible role and name, so existing names must be preserved.

## Goals / Non-Goals

**Goals:**

- One shell component for the top bar used by home, discussion, and settings.
- A viewport-height workspace layout implemented with CSS grid, keeping `DiscussionContent`'s existing data flow intact.
- Filter state that follows the same URL and stale-response discipline already used for `q`.
- A token layer so later screens (answers, resources, notifications) can reuse the look without adding more literal colors.

**Non-Goals:**

- No API, database, or OpenAPI changes, including pinned-first ordering or a course tag index.
- No answer, follow-up, poll, attachment, or notification UI, and no placeholders for them.
- No new runtime dependencies (no router, CSS framework, date library, or component library).
- No dark theme; tokens make it possible later but it is not delivered here.
- No change to the related-questions composer behavior beyond restyling.

## Decisions

### D1. A single `AppShell` component wraps protected routes

`AppShell` renders the top bar (wordmark, course switcher, optional course name plus Discussion/Settings nav, avatar, Sign out) and a main slot. `Home` and `CourseFrame` render inside it, and `CourseFrame` passes the course name and active tab. The course switcher is a "Switch course" disclosure button that opens a panel of course links. It calls the existing `listCourses` each time it opens, so a newly created or joined course shows up without extra refresh wiring. The panel closes on Escape (returning focus to the button) or on an outside pointer press. Navigation from it goes through the same `beforeLeave` guard that `CourseFrame.follow` uses today.

*Alternatives:* a native `<select>` filled on mount was rejected. It would add a course-list request to every page render, which reorders the requests existing tests expect, and a select filled lazily on focus opens before its options exist. The disclosure is plain links, not an ARIA menu, which keeps focus handling small. Keeping two headers was rejected because it is the root cause of the header disappearing inside courses.

### D2. Workspace layout is a CSS grid bounded by the viewport

Above 850px, `.workspace` is `grid-template-columns: 13rem minmax(20rem, 26rem) 1fr`, with height `calc(100dvh - var(--topbar-h))`. Each column sets `overflow: auto` and `min-height: 0`. The filter rail collapses into the list column (grid of two columns) between 851px and 1100px. At or below 850px the grid becomes a single column with natural page scrolling. The existing rule that the list scroll region has an accessible name and `tabIndex=0` is kept on the list column.

*Alternative:* a JavaScript-measured height was rejected; `dvh` plus grid handles this without resize listeners.

### D3. Filters extend the existing query state rather than adding a store

`routes.ts` gains parsing and serialization for `type`, `answered`, `tag`, and `sort` alongside `q`, producing a `FeedFilters` value in `Route`. `DiscussionContent` treats `{ q, ...filters }` as the applied feed key. The existing request-generation or abort guard that prevents stale `q` responses is keyed on that whole object, so filter changes reuse it. URL updates use the existing replace-current-entry path (`onQueryChange`, generalized to accept filters). Post selection builds the post path with the current search string so filters survive selection and Back.

The rail is a `radiogroup` of Posts filters (All/Questions/Notes/Unanswered) plus a Sort `select`. When `q` is non-empty, the sort control is disabled and shows "Relevance". Tag chips on rows and in detail are buttons named "Filter by tag {name}". The active tag renders as a removable chip named "Remove tag filter {name}".

*Alternatives:* a context or reducer store was rejected because it would duplicate state the URL already owns. Tag multi-select was rejected because the API ORs tags, which users would likely misread as AND.

### D4. Client additions stay minimal and typed to the documented contract

- `Post` adds `pinned: boolean`, `answered?: boolean`, and `updatedAt`.
- `PostListOptions` widens to `type?: "question" | "note"`, `answered?: false`, `tag?: string`, and `sort?: "relevance" | "newest" | "recent_activity"`.
- A new `setPostPinned(postId, pinned, etag, csrfToken)` sends `PATCH /api/v1/posts/{id}` with `If-Match` and `{ pinned }`, following the header pattern of `confirmMergePost`.

Detail already obtains an ETag through `getPost`; after a failed pin it re-runs that fetch.

### D5. Rows and detail are restructured, not rewritten

Each list item becomes a compact row: the existing `.post-card` link gains a metadata line (type, badges, relative time), and tag chips sit beside the link inside the row's `<li>`, because buttons cannot be nested in a link. Relative time uses `Intl.RelativeTimeFormat` inside a `<time dateTime>` element. Its `title` holds the full local time for hover, and visually hidden text gives screen readers the full local time instead of the relative phrase. Detail is split into `PostHeader`, the body, and a `StaffActions` bar containing `MergeControl` and the new pin control. An empty `<section aria-label="Discussion">` placeholder is not rendered; the reserved region is only a layout slot in CSS, so no dead UI reaches users.

### D6. Settings reuse the existing `CourseDetail` logic with new section markup

Sections: "Course details" (labeled name input, Save, and, for instructors, the join code with a Copy button using `navigator.clipboard` and a visible "Copied" status), "Members" (one role presentation per row), and "Danger zone" (Archive, Delete). Mutation handlers and confirmations are untouched.

### D7. Tokens are CSS custom properties introduced alongside the rewrite

`:root` defines color tokens (`--surface`, `--surface-raised`, `--ink`, `--ink-muted`, `--accent`, `--accent-ink`, `--danger`, `--line`, `--badge-*`), spacing (`--space-1`…`--space-8`), radii, the three font families, and `--topbar-h`. Styles for the shell, workspace, rows, detail, settings, and home use tokens. Landing and auth styles are left as they are, to keep the diff focused; they can migrate later.

### D8. Route headings never draw a focus outline

Headings keep `tabIndex={-1}` and the existing `.focus()` call. CSS removes the outline from `h1[tabindex="-1"]:focus` and `h2[tabindex="-1"]:focus`. `tabIndex=-1` takes these headings out of the Tab order, so they only receive focus from script, and keyboard users never land on them. Interactive controls keep their focus rings.

*Alternative:* `:focus:not(:focus-visible)` was tried first. Chromium treats script focus after a page load with no pointer input as focus-visible, so a directly loaded course URL still drew the outline.

### D9. Home removes the placeholder panel

The "In the discussion" article is deleted, the date comes from `Intl.DateTimeFormat` with `weekday, month, day`, and `CourseHome` becomes the full-width primary content with course tiles. Showing real recent posts across courses was considered and deferred, because it needs one list request per course and no aggregate endpoint exists.

## Risks / Trade-offs

- [Unanswered equals Questions until answers exist, which may look redundant] → The filter is kept because the contract is stable and it becomes meaningful with no UI change when answers land. Its tooltip explains that it shows questions without an answer.
- [Tag filtering is limited to tags visible on loaded posts] → This is acceptable for now. A course tag index endpoint is a separate API change.
- [Pinned posts are not floated to the top] → The Pinned badge stays visible. Pinned-first ordering needs an API change and is noted as a follow-up.
- [The large CSS rewrite may regress landing or auth pages] → Those selectors are not touched (D7). Before merging, compare Playwright screenshots of landing, home, discussion, post, and settings at 1440px and 390px.
- [Existing tests assert DOM structure beyond accessible names] → The migration tasks run the full web test suite after each structural step. Assertions are updated only where they target removed placeholder content, and each such update is recorded in the task notes.
- [`100dvh` is unsupported in very old browsers] → Fall back with a preceding `height: calc(100vh - var(--topbar-h))` declaration.

## Migration Plan

This is a frontend-only change, deployed with the next web build. There is no data migration. Rollback is a revert of the change's commits, since no persisted state or URL is invalidated: new query parameters are ignored by older builds, and older URLs remain valid.
