## Approach

Keep the existing React and CSS structure. Bound display and inline KaTeX content with local horizontal scrolling. Add a reusable table wrapper that measures overflow with ResizeObserver and shows a visual cue only when needed; make the scroller focusable with an accessible name. Keep table previews on one line without the cue. Tighten narrow-screen header spacing and enlarge tab and statistics hit boxes without clipping the course switcher's focus ring. Remove the desktop title's width cap so it uses available header space while preserving the existing adaptive stacked-tabs behavior; show the full title when the switcher receives keyboard focus on desktop and mobile.

## Tradeoffs

A visual table cue needs overflow measurement to avoid a false cue on narrow tables. ResizeObserver is built in; no dependency or global scroll logic is needed. Long desktop names may still truncate when account controls or navigation use the header width, so keyboard focus on the switcher reveals the complete name visually while its accessible button name remains unchanged.

## Verification

Write browser assertions first for 320/390/1440 viewports with mocked API data and screenshots for math, tables, navigation, statistics, and title. Confirm expected red failures before implementation; then run focused tests, typecheck, build, lint, full unit suite, no-mistakes, and draft-PR CI.
