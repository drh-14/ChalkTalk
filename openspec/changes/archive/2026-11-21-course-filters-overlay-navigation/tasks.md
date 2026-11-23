## 1. Tests first

- [x] 1.0 Capture actual current UI baseline screenshots at320/390/1280px with mocked APIs before product edits; compare them to existing source tokens/components and retain them for style-drift review.
- [x] 1.1 Add component regressions for closed-by-default overlay, immediate filters/selection retention, no layout-only fetch, focus/Escape/outside dismissal and ignored legacy dimensions; run expected failures before implementation.
- [x] 1.2 Add App navigation tests for mobile current/nested section, existing role-visible links/unread counts, dropdown close/focus and denied/accepted draft navigation; run expected failures.
- [x] 1.3 Replace resize browser expectations with mocked actual-browser overlay scenarios at 320/390/1280px and short landscape, including geometry/no feed shift, internal scroll, route navigation guards and header controls; run expected failures.

## 2. Implement approved presentation

- [x] 2.1 Replace Discussion sidebar/mobile panel with Filters trigger right of Search and bounded scrollable nonmodal overlay; retain existing filter subtree/state and dismissal/focus conventions; verify with overlay component/browser regressions.
- [x] 2.2 Remove useFilterPanel, obsolete resize/collapse/dimension CSS and contradictory tests while preserving relevant no-refetch/filter-retention coverage; verify removed resize interactions and retained filter behavior through public component/browser assertions.
- [x] 2.3 Add mobile section dropdown from CourseFrame's existing tab data/follow handler; move mobile All courses to logo row through minimal AppBar presentation changes, preserve desktop navigation and merged main title/content fixes; verify App navigation regressions and existing responsive browser suite.

## 2a. Latest approved toolbar refinement

- [x] 2a.1 Add observable mobile search/icon and desktop Search→Filters geometry regressions; confirm RED before code.
- [x] 2a.2 Implement the approved icon toolbar and expandable below-toolbar search; preserve existing filtering/focus/navigation behavior and confirm GREEN.
- [x] 2a.3 Tests first: keep desktop navigation on the logo row, switching to current-section dropdown when full links do not fit; preserve guards, title discoverability and focus on viewport changes.

## 3. Verify and archive

- [x] 3.1 Run full web tests, typecheck/lint/format/build, focused overlay and existing responsive-course-ui mocked browser suites; verify keyboard/touch and current-route semantics.
- [x] 3.2 Capture and visually inspect every affected browser state at 320/390/1280px, including filters closed/open/scrolled, navigation dropdown and short viewport; compare with actual UI baselines to verify typography/colors/icons/control styling/content remain unchanged, and keep screenshots ignored for draft PR attachments.
- [x] 3.3 Strict-validate, sync main specs and archive only verified implementation. Keep final gate/publication/one-commit/attachment/CI obligations in the external delivery checklist, not prematurely completed here.
