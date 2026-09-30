## 1. Verification

- [x] 1.1 Map each scenario in `specs/` to a test, and confirm the layout-only scenarios in the running app:
  - **Switcher and draft guard:** `apps/web/src/app/App.test.tsx`, "switches courses from the top bar after loading the list on demand" and "keeps the course and draft when switching course is declined".
  - **URL filters:** App test "stores filters in the URL without new history entries and keeps them on posts", the `routes.test.ts` filter tests, and the views test "restores filters from props and keeps them on post links".
  - **Tags:** views test "filters by a tag from a row or the post, keeps the selected post, and removes the tag".
  - **Last activity:** views test "shows the last activity time in the post view when it differs from the creation time".
  - **Pinning:** the three pin views tests.
  - **Home:** App test "shows today's date and only real courses on home".
  - **Settings:** `apps/web/src/courses/views.test.tsx` section, student, and leave tests.
  - **Layout-only:** phone-width settings and switcher fit, and the heading focus ring, checked with headless-Chrome screenshots.

  Verify with `npx vitest run --project web` and `openspec validate document-workspace-port --strict`.
