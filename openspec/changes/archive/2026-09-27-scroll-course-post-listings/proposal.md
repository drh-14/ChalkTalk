## Why

Long course feeds make members scroll the entire page to reach later cards, moving the search and Create post controls out of view.

## What Changes

- Bound the desktop left feed by the viewport and give its cards and Load more control their own visible scrollbar.
- Keep the view picker, search, and Create post above the scroll region.
- Use the same region for normal and duplicate posts, with an accessible name and keyboard focus.
- Preserve natural page scrolling at the single-column breakpoint.

## Impact

Only the course discussion frontend, its rendered tests, and styling change. There is no API, database, or dependency change.
