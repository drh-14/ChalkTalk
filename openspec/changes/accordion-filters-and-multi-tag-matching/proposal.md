## Why

The feed sidebar's Show and Sort by controls are native dropdowns. They cannot be styled to match the redesigned workspace, and they close as soon as a member picks an option or clicks away, so comparing filters takes repeated opening. Members can also filter by only one tag at a time, even though the posts list API already accepts several. Separately, the course switcher repeats the "All courses" link that the header breadcrumb already shows.

## What Changes

- The Show and Sort by dropdowns become accordion sections. Each has a header button that opens and closes it and shows the current value while closed. Headers read as section labels, and options are single-choice rows whose selection is marked with accent-colored text and an accent bar. Choosing an option does not close its section.
- Both sections start open on screens wider than 850px and closed at 850px or less. The open or closed state is not remembered between visits.
- The sidebar gains a Tags section that holds every active tag. Each chip can be removed, a Clear all control removes them all, and an Any/All toggle appears once two or more tags are active. Selecting a tag chip on a card or in the post view adds that tag, or removes it if it is already active. The feed allows at most 10 active tags.
- The app matches **all** selected tags by default. The URL stores tags as repeated `tag` parameters, and stores `tagMatch=any` only when a member chooses Any.
- `GET /api/v1/courses/{courseId}/posts` gains an optional `tagMatch=any|all` parameter:
  - `any` is the default and keeps today's OR behavior.
  - `all` returns only posts that carry every requested tag.
  - Other values return `400 invalid_request`.
  - The list endpoint now also enforces the documented limit of 10 `tag` values, returning `400` above it.
- The course switcher panel no longer links to All courses. The breadcrumb link remains at every width.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `text-posts`: the course list requirement adds the `tagMatch` parameter, the 10-tag limit, and their validation.
- `course-discussion-frontend`:
  - The feed filter and sort requirement changes from dropdowns to accordion sections and from one tag to several tags with Any/All matching.
  - The shared course frame requirement drops the switcher's All courses link.

## Impact

- **API:**
  - `postListQuery` in `apps/api/src/http/app.ts` parses `tagMatch` and enforces the tag limit.
  - `PostService.list` in `apps/api/src/posts/service.ts` applies the all-tags condition. The cursor binding already covers every filter, so it includes `tagMatch`.
  - No migration is needed.
- **Docs:** the list operation in `documentation/api/posts.md` and `documentation/openapi.yaml`.
- **Web:**
  - `apps/web/src/app/routes.ts`: URL tag list and `tagMatch`.
  - `apps/web/src/posts/client.ts`: repeated `tag` values and `tagMatch`.
  - The sidebar and tag chips in `apps/web/src/posts/views.tsx`.
  - `CourseSwitcher` in `apps/web/src/app/App.tsx`.
  - Sidebar and switcher styles in `apps/web/src/styles.css`.
- **Compatibility:**
  - Existing API clients and bookmarked URLs keep working. A single `tag` means the same thing under either match mode.
  - One existing behavior changes: a list request with more than 10 `tag` values now returns `400 invalid_request` instead of being accepted.
