## 1. Time formatting

- [x] 1.1 Write failing unit tests for `formatPostTime` in `apps/web/src/posts/` with a pinned `now`: "just now" under one minute and for a future instant; minute, hour, and day labels at their boundaries (59 s, 60 s, 59 min, 60 min, 23 h, 24 h, 6 d, and 7 d); a short date without the year at seven or more days in the same year and with the year in a prior year; a full local date-time title; `dateTime` equal to the original input; and `undefined` for an unparsable value. Verify they fail with `npx vitest run apps/web/src/posts`.
- [x] 1.2 Implement `formatPostTime` with built-in `Intl` formatters as described in design.md, adding no dependency. Verify the 1.1 tests pass and are independent of the host time zone by also running them with `TZ=America/Los_Angeles` and `TZ=Asia/Tokyo`.

## 2. Byline rendering

- [x] 2.1 Add failing rendered tests in `apps/web/src/posts/views.test.tsx` using `vi.setSystemTime`. Cover these cases:
  - A feed card shows its author followed by a relative time in a `<time>` element whose `dateTime` is the post's `createdAt` and whose title is set.
  - The post detail pane shows the same byline, and an older post shows a calendar date.
  - An anonymous post shows "Anonymous" with the time and no user ID.
  - A post whose `updatedAt` is later than its `createdAt` shows no edited or updated text.
  - The staff review detail pane shows the source's time, while the Duplicate posts card still has no time.
  - The deleted-post state and related-question suggestions show no time.

  Verify the new tests fail.
- [x] 2.2 Add a `PostByline` component and use it at the feed card, post detail, and staff review detail author sites, keeping the existing `<small>` and `.post-author` wrappers, plus a minimal separator style in `apps/web/src/styles.css`. Verify the 2.1 tests and every existing `apps/web` test pass.

## 3. Integration checks

- [x] 3.1 Run `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `openspec validate show-post-created-time --strict`, and confirm that all pass. On the Windows development checkout, `format:check` and the OpenAPI contract regex fail only because `core.autocrlf` produces CRLF line endings. Prettier passes with `--end-of-line auto`, and the changed files pass unchanged.
- [ ] 3.2 In the running full-stack app, create a post as the AMS161 instructor and confirm that the feed and detail show "just now" with a full date-time on hover, and that seeded posts show their seed time.
