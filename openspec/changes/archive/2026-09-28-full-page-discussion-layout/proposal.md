## Why

The course discussion page nests bordered, rounded boxes three deep: every post is a card, the post list is a card around those cards, and the post view is another card beside it. The result looks cramped and uniform, and the post list and post view compete as equal panels instead of reading as one working surface.

## What Changes

- On desktop, the discussion area fills the window below the course header as two full-height columns, the post list and the post view, separated by a single divider. The rounded panel boxes are removed.
- Posts in the list become flat rows separated by thin dividers. The selected row gets a tinted background and a green accent bar on its leading edge. Staff duplicate-review rows use the same treatment.
- The post view scrolls independently of the list, and the page itself no longer scrolls on the discussion route. The post view becomes a named, keyboard-focusable scroll region like the list.
- Post text, and the composer inside the post view, use the full width of the pane.
- The course app bar and course header span the full width to line up with the new columns.
- Narrow screens (850px and below) keep one pane at a time with natural page scrolling. Only the flat styling carries over.
- The course settings route, the home page, and its dashboard cards are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `course-discussion-frontend`: the desktop scrolling requirement expands to full-height columns with an independently scrolling, focusable post view; a new requirement describes flat post rows and full-width reading.

## Impact

Only the web frontend changes: the discussion layout markup in `apps/web/src/posts/views.tsx` and `apps/web/src/app/App.tsx`, `apps/web/src/styles.css`, and their rendered tests. There is no API, database, or dependency change. This change builds on the uncommitted course header work (the green app bar and restyled course title row) and on the in-progress `show-post-created-time` change, both of which touch the same files.
