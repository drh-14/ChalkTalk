## Context

`CourseFrame` in `apps/web/src/app/App.tsx` renders the shared `AppBar` followed by `<main className="discussion-shell">`, which holds the course title row and either `CourseDetail` (settings) or `Discussion` (`apps/web/src/posts/views.tsx`). `Discussion` renders `.discussion-columns`, a grid of two bordered, rounded sections: `.discussion-feed` (toolbar plus the focusable `.post-list-scroll` region named "Post listings") and `.discussion-detail` (named "Post detail"). The feed's height is a magic number, `max(18rem, calc(100dvh - 15rem))`, that has been retuned twice as the header changed, and the detail pane grows with its content, so a long post scrolls the whole page. `.post-card` is shared by ordinary post rows and staff duplicate-review rows. At 850px and below, `.has-selection` shows one pane at a time with natural page scrolling.

## Goals / Non-Goals

**Goals:**

- Size the columns from the layout itself instead of a hand-tuned header height, so later header changes cannot reintroduce page scrolling.
- Keep every existing accessible name, focus behavior, and rendered test selector working.

**Non-Goals:**

- Changing the course settings route, the home page, the composer's fields, or any data loading.
- Resizable or collapsible columns.

## Decisions

**Flex column sized to the viewport instead of a height formula.** On the discussion route, `CourseFrame` wraps the app bar and `main` in a container that is exactly `100dvh` tall and lays them out as a flex column. `main` takes the remaining space with `min-height: 0`, the title row keeps its natural height, and `.discussion-columns` takes the rest. Each column scrolls with `overflow-y: auto`. This removes the `15rem` formula entirely, and a wrapping app bar or taller title row simply leaves less room for the columns. The alternative, recomputing `calc(100dvh - X)` for both columns, is what broke twice already. The fixed-height container applies only to the discussion route (a modifier class set from `route.name`), because settings content must keep natural page scrolling.

**Columns span the full width.** The columns sit edge to edge under the title row with no outer padding. The list column has a fixed responsive width of `clamp(18rem, 28%, 26rem)` and a right border as the only divider. The title row and the course variant of the app bar drop their `1500px` maximum width, and all three use the same horizontal padding, so the logo, course name, and first list row align. Keeping the `1500px` cap would leave empty bands beside the columns on wide screens, which is the boxed look this change removes.

**Colors.** The detail pane uses the lightest surface (`#fffdf9`) because it is the reading area. The list column keeps the page tone (`#f8f6ef`). Rows are transparent with a bottom divider (`#e3e1d6`), hover tints them, and the selected row is `#fffdf9` with a `3px` inset accent in the app bar green (`#1f4d3e`), drawn with `box-shadow: inset 3px 0 0` so it does not shift the row's content. This keeps the accent distinct from the tinted background, so selection is not signalled by color alone, together with the existing `aria-current`.

**Rows reuse `.post-card`.** Only the `.post-card` rules change: they lose the border, radius, and gap-separated grid, and gain padding and a divider. Ordinary and duplicate-review rows therefore stay identical, as the spec requires, and the full-card `::after` click target on review rows keeps working. The toolbar gains padding matching the rows because it no longer sits inside a padded panel.

**The detail pane becomes a focusable region.** `.discussion-detail` is already a `<section>` with an accessible name. It gains `tabIndex={0}` and a focus-visible outline matching `.post-list-scroll`. The post article, detail prompt, loading and error states, duplicate review article, and composer render inside a content wrapper that spans the pane's full width inside its padding. An earlier version capped this wrapper at `72ch` for line length; the user chose full width after seeing it, because the cap left a third of a wide screen empty.

**Narrow screens.** The existing 850px rules stay the source of truth for one-pane-at-a-time. They now also reset the fixed-height container, the column overflow, and the detail pane's scrolling to natural page flow, and hide the vertical divider. The flat row styling is shared by both breakpoints.

## Risks / Trade-offs

- [`100dvh` differs from `100vh` on mobile browsers with collapsing toolbars.] → The fixed-height layout applies only above 850px, where desktop browsers treat both the same.
- [jsdom does not compute layout, so rendered tests cannot prove that the page does not scroll.] → Rendered tests cover structure and focusability. A headless Chrome check measures `document.scrollingElement.scrollHeight` against the viewport and records screenshots at desktop and phone widths.
- [A focusable detail pane adds one tab stop.] → This is required for keyboard scrolling of an overflow region, and it matches the existing list region.
- [This change edits the same files as uncommitted header work and the in-progress `show-post-created-time` change.] → Commit or separate those first so this diff contains only the layout.
