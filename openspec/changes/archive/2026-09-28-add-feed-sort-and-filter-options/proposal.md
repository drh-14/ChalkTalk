## Why

Members asked to sort the course feed oldest first, to list pinned posts of a given type, and to see only posts written by instructors or only posts written by TAs, which are different roles. The course posts list API cannot do any of these: it sorts only newest-first or by recent activity, has no pinned filter, and can filter by one author but not by author role. Sorting or filtering in the browser is not an option because the feed is paginated. Separately, the `course-discussion-frontend` spec still names the "Recent activity" sort and omits the My posts and Answered filters that were already built.

## What Changes

- `GET /api/v1/courses/{courseId}/posts` gains three options:
  - **`sort=oldest`:** creation time ascending, with stable cursor pagination.
  - **`pinned=true|false`:** filters by pinned state.
  - **`authorRole=instructor|ta`:** returns posts whose author currently holds that role in the course. Anonymous posts are hidden from students under the existing author-filter identity rule, so the filter cannot reveal an anonymous author's role.
- The API reference (`documentation/api/posts.md`, `documentation/openapi.yaml`) and the identity-visibility policy document the new parameters.
- The web feed adds Oldest to Sort by and four sidebar entries:
  - **Instructor posts** and **TA posts:** under All posts, after My posts.
  - **Pinned (questions):** under Questions, after Unanswered.
  - **Pinned (notes):** under Notes.

  The two Pinned entries have distinct accessible names.
- The frontend spec catches up with what already shipped: the Last updated label, and the My posts and Answered filters.
- Out of scope: sorting by amount of activity, which is deferred until followups or view counts exist.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `text-posts`: the course list requirement adds the oldest sort, the pinned filter, and the instructor and TA author-role filters, with their identity and cursor rules.
- `course-discussion-frontend`: the feed filter and sort requirement lists the full set of sidebar filters and sort options.

## Impact

- API: `postListQuery` in `apps/api/src/http/app.ts` and `PostService.list` in `apps/api/src/posts/service.ts`. There is no migration: `pinned` and course memberships already exist.
- Docs: the list operation in `documentation/api/posts.md` and `documentation/openapi.yaml`, and author filtering in `documentation/api/identity-visibility.md`.
- Web: `apps/web/src/posts/client.ts`, `apps/web/src/posts/types.ts`, and the sort control in `apps/web/src/posts/views.tsx`.
- The backend and API contract belong to other team members, so coordinate with them before implementing.
