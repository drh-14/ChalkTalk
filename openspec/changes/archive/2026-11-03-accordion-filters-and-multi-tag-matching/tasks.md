## 1. API tag matching

- [x] 1.1 Write failing PostgreSQL-backed HTTP tests in `apps/api/src/http/posts.integration.test.ts`, derived from the `text-posts` delta. Use a course with posts tagged only `recursion`, only `exam-2`, both, and neither. Cover:
  - **Any:** two tags with `tagMatch` omitted, then `tagMatch=any`, return the three tagged posts.
  - **All:** `tagMatch=all` returns only the post with both tags. Mixed-case and duplicate tag values match the same way.
  - **Single tag:** one tag returns the same results under `any` and `all`.
  - **Pagination:** with `limit=1` and `tagMatch=all`, following `nextCursor` returns each match once, and replaying that cursor with `tagMatch=any` returns `400`.
  - **Validation:** `tagMatch=both` returns `400`, and 11 `tag` values return `400`.

  Verify the tests fail with `TEST_DATABASE_URL` set.

- [x] 1.2 Implement `tagMatch` parsing, normalization, and the raw 10-tag limit in `postListQuery`, and the all-tags count condition in `PostService.list`, as described in design.md. Verify the 1.1 tests and the full API suite pass.
- [x] 1.3 Document `tagMatch` and the 10-tag limit in the list operation of `documentation/api/posts.md` and `documentation/openapi.yaml`. The `tag` description should drop its fixed "OR semantics" wording. Verify `apps/api/src/http/openapi.contract.test.ts` and the API suite pass.

## 2. Web tag state and requests

- [x] 2.1 Write failing tests in `apps/web/src/app/routes.test.ts` for the URL rules:
  - Repeated `tag` values parse in order; they are trimmed, capped at 40 characters, deduplicated case-insensitively, and limited to 10.
  - `tagMatch=any` is kept only with two or more tags.
  - Invalid `tagMatch` values are ignored.
  - `feedSearch` round-trips tags and `tagMatch`.

  Then replace `FeedFilters.tag` with `tags` and `tagMatch` in `routes.ts`, and verify the tests pass.

- [x] 2.2 Write failing tests in `apps/web/src/posts/client.test.ts`:
  - Each tag is sent as a repeated `tag` parameter.
  - `tagMatch=all` is sent by default with two or more tags.
  - `tagMatch=any` is sent when chosen.
  - `tagMatch` is omitted with fewer than two tags.

  Then update `PostListOptions` and `listPosts`. Verify the tests pass and `npm run typecheck` reports every remaining `tag` consumer, then fix them.

## 3. Web sidebar accordion and tags

- [x] 3.1 Update the rendered tests in `apps/web/src/posts/views.test.tsx` to the accordion behavior in the `course-discussion-frontend` delta, and verify they fail. Cover:
  - **Existing scenarios, as radios:** the Show and Sort by scenarios now select radios instead of combobox options.
  - **Open and closed:** sections start open when `matchMedia` is absent or wide, and closed when it reports 850px or less. The resize-after-load case is covered. A closed header reads "Show · Questions" with `aria-expanded="false"`, and closing or opening sends no feed request.
  - **Choosing:** choosing a row keeps its section open.
  - **Duplicate review:** choices, chips, and Match are disabled, while headers stay operable.
- [x] 3.2 Replace the Show and Sort by `<select>` controls with accordion sections of header buttons and native radio rows, as described in design.md. Style the rows, selected accent bar, header summary, and chevron in `apps/web/src/styles.css`, including the ≤850px layout and reduced motion. Verify the 3.1 tests and all web tests pass.
- [x] 3.3 Add failing rendered tests for tags:
  - Selecting two chips requests `tag=recursion&tag=exam-2&tagMatch=all` and shows both chips with All selected.
  - Choosing Any requests `tagMatch=any` and updates the URL.
  - Selecting an active chip removes it, and Clear all removes every tag, `tagMatch`, and the section.
  - An 11th chip leaves the feed unchanged and announces the limit.
  - Load more keeps the tags and match mode.
  - The selected post stays open throughout.

  Then implement the Tags section, the Match control, toggling `selectTag`, and active-chip state from the tag list. Verify the tests pass.

## 4. Course switcher

- [x] 4.1 Update `apps/web/src/app/App.test.tsx` so the opened switcher panel lists courses without an All courses link while the breadcrumb link remains, and verify it fails. Then remove the `.switcher-home` link and its styles. Verify the test and the existing switcher and draft-prompt tests pass.

## 5. Integration checks

- [x] 5.1 In the running Docker app, check the following with screenshots as the AMS161 instructor:
  - Wide and ≤850px layouts, with sections open and closed.
  - Filtering by two tags under All and Any.
  - Reloading the shared URL.
  - The switcher panel.
- [x] 5.2 Run `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` with `TEST_DATABASE_URL` set, `npm run build`, and `openspec validate accordion-filters-and-multi-tag-matching --strict`, and confirm all pass.
