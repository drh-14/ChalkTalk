## 1. Approved behavior tests first

- [x] 1.1 Add component tests for default-collapsed state on desktop/mobile including reload, desktop original circular arrow styling/direction plus adjacent visible Filters label in both states, orientation-specific keyboard sizing, separate width/height persistence, collapse across breakpoints, persistence, storage failures, retained selections, and no layout-triggered requests; run focused Vitest and confirm new assertions fail for expected missing behavior.
- [x] 1.2 Add mocked-API browser scenarios for desktop mouse drag, mobile vertical touch resizing and internal scrolling, compact/mobile collapsed states, reload/viewport clamps, and pointer cancellation; run Playwright and confirm expected pre-implementation failures.

## 2. Filter panel implementation

- [x] 2.1 Add initial collapsed state on both breakpoints (without expanded-state persistence), separate preferred/effective desktop width and mobile height state, safe storage handling, container-aware bounds and viewport updates in the existing Discussion view; verify focused state/storage tests pass.
- [x] 2.2 Add breakpoint-appropriate vertical/horizontal separators with pointer capture, cancellation cleanup, and axis-specific arrow/Home/End resizing; verify component input tests and mouse/touch browser scenarios pass.
- [x] 2.3 Update filter layout CSS and collapse markup for a compact stacked, height-resizable/internal-scroll mobile panel and preserved desktop columns with a visible Filters label beside the desktop toggle arrow; verify mobile feed stays full width and moves upward as filters shrink, lower filter controls remain reachable by internal scrolling and the compact edge-grip target does not overlap filter buttons or feed controls, and all tested viewports have no horizontal overflow.

## 3. Verification and delivery

- [x] 3.1 Run affected component and browser regression tests plus typecheck, lint, format check, and web build; record actual outcomes and resolve scoped failures.
- [x] 3.2 Capture screenshots for each browser-tested visible scenario in ignored output and visually inspect the responsive states; verify screenshot files exist without committing them.
- [x] 3.3 Validate and archive the verified implementation and sync its approved delta into the main spec; verify archived artifacts and main spec describe the delivered behavior.
