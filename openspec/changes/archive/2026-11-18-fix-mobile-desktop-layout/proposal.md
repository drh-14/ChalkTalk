## Why

Live-production review found horizontal page overflow in math posts, cramped mobile course navigation and undersized targets, unclear table overflow, and desktop course-title truncation. These issues make course content harder to read and controls harder to use.

## What Changes

- Contain wide rendered math within the post body with local horizontal scrolling, never page-wide overflow.
- Compact the narrow-screen course header without hiding course navigation or controls.
- Increase mobile course-navigation and statistics-view toggle hit areas.
- Show a visible and accessible horizontal-scroll cue for overflowing post tables.
- Give the desktop course title more available width and expose its full name on hover/focus.

## Capabilities

### New Capabilities

- `responsive-course-ui`: Responsive display and interaction requirements for course content and navigation.

### Modified Capabilities

- None.

## Impact

Web frontend markup/CSS and mocked-API browser tests only. No API, database, dependency, or route changes. This is an independent PR from the pending links/dialogs/navigation work.
