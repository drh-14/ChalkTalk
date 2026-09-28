## 1. Layout structure

- [x] 1.1 Add failing rendered tests. In `apps/web/src/posts/views.test.tsx`, the "Post detail" region has `tabindex="0"` alongside the existing focusable "Post listings" region, and a selected post's row is the only row marked `aria-current`. In `apps/web/src/app/App.test.tsx`, the discussion route renders inside the full-height course page container while the settings route does not. Verify the new assertions fail with `npx vitest run --project web`.
- [x] 1.2 In `CourseFrame`, wrap the app bar and `main` in a course page container with a discussion-route modifier. In `Discussion`, make the detail section focusable and wrap its content in a width-capped content element. Verify the 1.1 tests and every existing `apps/web` test pass.

## 2. Styling

- [x] 2.1 In `apps/web/src/styles.css`, replace the discussion layout with the design's approach: a full-height flex layout above 850px, edge-to-edge columns with a single divider, the list column width, and an independently scrolling detail pane with a focus outline. Also flatten `.post-card` into divided rows with a hover tint and an inset accent for the selected row, let the detail content use the full pane width, and remove the `1500px` caps from the title row and course app bar. Remove the `calc(100dvh - 15rem)` feed height. Extend the 850px rules to restore natural page scrolling. Verify with `npm run lint` and the formatting check that the stylesheet is clean, and `npx vitest run --project web` still passes.
- [x] 2.2 Check the running app with headless Chrome, signed in as the AMS161 instructor, and save screenshots:
  - **1440×900:** the feed with no selection, a selected post, Duplicate posts view, and the composer open. The page must not scroll (`scrollHeight` ≤ `innerHeight`).
  - **Long post:** a post longer than the window scrolls only the detail pane while the list stays put. Create the post through the local API if none exists.
  - **390×844:** the feed and a selected post use natural page scrolling.
  - **Settings route:** it still scrolls naturally.

  Fix and re-check any failure.

## 3. Integration checks

- [x] 3.1 Run `npm run lint`, `npm run typecheck`, `npm test` with `TEST_DATABASE_URL` set, `npm run build`, formatting with `--end-of-line auto` on this Windows checkout, and `openspec validate full-page-discussion-layout --strict`, and confirm all pass apart from the known Windows line-ending failures recorded in `show-post-created-time`.
