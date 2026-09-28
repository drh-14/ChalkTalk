## 1. Verification

- [x] 1.1 Map each scenario in `specs/course-discussion-frontend/spec.md` to a rendered test in `apps/web/src/posts/views.test.tsx`: "lays out each card with a type badge, status, preview, and byline from the post type list", "filters the feed from the sidebar and keeps the filter when loading more", "sorts the feed and offers best match only while searching", and "disables the sidebar filters in the staff duplicate view". Add a test for any scenario without one. Verify with `npx vitest run --project web` and `openspec validate document-post-card-types --strict`.
