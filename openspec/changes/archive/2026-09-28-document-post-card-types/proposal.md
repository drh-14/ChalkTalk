## Why

The course feed's post cards were redesigned so that type, title, preview, author, and time are easier to tell apart, and so that new post types such as polls can be added without redesigning the card. The cards and the sidebar filters now come from one list of post types in the frontend. `course-discussion-frontend` still describes cards only as a title and excerpt and lists the filters as four fixed options, so it no longer matches the product.

## What Changes

- Each post card shows a type badge beside its title, type-specific and shared status pills (Answered or Unanswered for questions; Pinned for any post), a preview clamped to two lines, and the author and time together in a footer.
- A post type the frontend does not recognize renders as a neutral "Post" card rather than failing.
- The sidebar filters are generated from the same post type list: All posts, then each known type, with type-specific filters such as Unanswered listed beneath their type.
- The empty detail prompt no longer names specific post types.
- No code changes: this records behavior already implemented and tested on `discussion-ui-and-answers`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `course-discussion-frontend`: the feed filter requirement reflects filters generated from post types, and a new requirement describes post card anatomy and type handling.

## Impact

Only `openspec/specs/course-discussion-frontend/spec.md` changes, on archive. The implementation is in `apps/web/src/posts/types.ts`, `apps/web/src/posts/views.tsx`, and `apps/web/src/styles.css`.
