## Why

Commit `a68662a` on `discussion-ui-and-answers` changed the course frame and feed without an OpenSpec change, so `course-discussion-frontend` no longer describes the product. The course header moved into the app bar with a third tab, a placeholder Course resources route was added, and a filter sidebar with a sort control was added to the discussion route. One existing requirement is now contradicted outright: live search is specified to always send `sort=relevance`, but members can now choose another sort while searching. This change records the implemented behavior so the spec and the code agree before the branch is reviewed.

## What Changes

- The shared course frame lives in the app bar: an "All courses › course name" breadcrumb, then centered Discussion, Course resources, and Course settings tabs, persisting across all three course routes.
- A Course resources route (`/courses/{courseId}/resources`) shows a placeholder until resource sharing is built.
- A filter sidebar lets members show all posts, questions, notes, or unanswered questions, and sort by recent activity, newest, or best match while searching.
- Live search defaults to best match but honors a member's chosen sort for the current search.
- The desktop discussion layout gains the filter sidebar as a third full-height column.
- No code changes: this change only records behavior that already exists and is tested.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `course-discussion-frontend`: the shared course frame, live search sorting, and desktop layout requirements are updated. New requirements cover feed filters and sorting and the Course resources placeholder.

## Impact

Only `openspec/specs/course-discussion-frontend/spec.md` changes, and only on archive. The desktop layout requirement modified here is the version introduced by the unarchived `full-page-discussion-layout` change. Archive `full-page-discussion-layout` before this change so this delta applies to that text. The unarchived `show-post-created-time` and `implement-answers-phase-1` changes add separate requirements to the same capability and do not conflict.
