# Tasks

## 1. Baseline and design tokens

- [ ] 1.1 Capture baseline Playwright screenshots of landing, home, discussion, post, and settings at 1440px and 390px into the scratchpad; verify all ten images exist for later comparison
- [ ] 1.2 Add `:root` color, spacing, radius, font, and `--topbar-h` custom properties to `styles.css` without changing any existing rule; verify `npm run build` passes and the landing screenshot is pixel-identical to baseline

## 2. Client and route contracts

- [ ] 2.1 Extend the web `Post` type with `pinned`, `answered`, and `updatedAt`, and widen `PostListOptions` to `type` (`question`|`note`), `answered: false`, `tag`, and `sort` (`relevance`|`newest`|`recent_activity`); verify new `posts/client.test.ts` cases assert each parameter is serialized, and that All sends none
- [ ] 2.2 Add `setPostPinned` issuing a conditional `PATCH /api/v1/posts/{id}` with `If-Match`, the CSRF header, and body `{ pinned }`; verify `posts/client.test.ts` asserts method, headers, body, and error mapping
- [ ] 2.3 Parse and serialize `type`, `answered`, `tag`, and `sort` in `routes.ts` alongside `q`, ignoring unknown or invalid values; verify `routes.test.ts` covers round-tripping, invalid values, and preservation on post paths

## 3. Application shell and top bar

- [ ] 3.1 Implement `AppShell` with wordmark, avatar, and Sign out, and render `Home` and `CourseFrame` inside it, removing `home-header` and `discussion-header`; verify `App.test.tsx` finds Sign out on home, discussion, and settings routes
- [ ] 3.2 Add the "Switch course" selector populated from `listCourses`, navigating through the draft guard; verify `App.test.tsx` covers switching courses and declining the discard confirmation with a draft open
- [ ] 3.3 Show course name and Discussion/Course settings navigation in the top bar on course routes with `aria-current`; verify existing frame tests for same-document navigation, Back, and settings loading/error states still pass
- [ ] 3.4 Add the `:focus:not(:focus-visible)` rule for programmatic heading focus; verify with a Playwright check that the course heading has no outline after navigation and that a tabbed-to control does

## 4. Workspace layout and post rows

- [ ] 4.1 Rebuild the discussion layout as the viewport-bounded grid (rail, list, reading pane) with independent scrolling and the 1100px and 850px breakpoints; verify existing scroll-region accessibility tests pass and a Playwright check at 1440px confirms the page itself does not scroll while the list does
- [ ] 4.2 Replace post cards with compact `PostRow`s showing type, title, one-line excerpt, projected author, relative `<time>` with full local time in `title`, tags, and Pinned/Unanswered badges; verify `posts/views.test.tsx` asserts each element for a pinned note and an unanswered question
- [ ] 4.3 Distinguish the empty course state from a no-match state with a Clear filters control; verify `posts/views.test.tsx` covers both states and that clearing removes `q` and filters from the URL

## 5. Filters

- [ ] 5.1 Add the Posts filter radiogroup (All, Questions, Notes, Unanswered) and Sort select (disabled and showing Relevance while `q` is applied), wired to URL replacement and pagination reset; verify `posts/views.test.tsx` asserts the request parameters for each option and the URL update
- [ ] 5.2 Add tag chips on rows and in detail that set the tag filter, plus a removable active-tag chip; verify tests show that selecting a tag requests `tag=<name>`, keeps the selected post open, and that removing the chip clears it
- [ ] 5.3 Key the stale-response guard on the combined query and filters; verify a `posts/views.test.tsx` case where a late response for an earlier filter is ignored and a direct-URL load with `type=note&sort=newest` issues the matching first request
- [ ] 5.4 Confirm filters do not close the composer or selected post, and do not apply in Duplicate posts mode; verify tests for changing filters with a draft open and in staff duplicate mode

## 6. Reading pane and staff actions

- [ ] 6.1 Split detail into header (type, title, author, created and last-activity times, tags, badges), body, and a compact staff action bar hosting Merge as duplicate; verify existing detail, tombstone, unavailable, and merge tests pass and a new test asserts that students see no action bar
- [ ] 6.2 Add Pin/Unpin to the staff action bar using `setPostPinned`, updating detail and the visible row on success, and on failure showing the error and refetching the post; verify tests for success, stale-revision failure with refetch, the disabled pending state, hidden for students, and hidden for archived courses
- [ ] 6.3 Replace the empty reading-pane state with the compact choose-or-create prompt; verify the test asserts its text and a working Create post action

## 7. Narrow screens

- [ ] 7.1 At or below 850px, show list or detail at full width, filters as a horizontal chip row, and Back to posts restoring filters and scroll position; verify `posts/views.test.tsx` covers Back restoring filters and a Playwright 390px run shows no side-by-side panes
- [ ] 7.2 Verify with Playwright that `document.documentElement.scrollWidth <= innerWidth` on home, discussion, post, and settings at 320px and 390px, and fix any overflow found

## 8. Course settings

- [ ] 8.1 Restructure `CourseDetail` into Course details, Members, and Danger zone sections with labeled, styled fields, a single role presentation per member, and an instructor-only join code with Copy and a "Copied" status; verify `courses/views.test.tsx` asserts the section headings, a single role per row, join code visibility by role, and copy feedback, and that existing membership and archive/delete tests still pass

## 9. Home

- [ ] 9.1 Remove the hardcoded "In the discussion" panel and date, render today's date via `Intl.DateTimeFormat`, and make the course list the full-width primary content; verify `App.test.tsx` asserts the current date and that no placeholder course names or posts render

## 10. Integration checks

- [ ] 10.1 Run `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`; verify all pass
- [ ] 10.2 Capture post-change Playwright screenshots of the task 1.1 set and compare them with the baseline; verify landing and auth pages are unchanged and review the workspace, settings, and home at both widths against the spec scenarios
